import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

function formatDate(d: string | null | undefined): string {
  if (!d) return new Date().toISOString().split("T")[0];
  try {
    return new Date(d).toISOString().split("T")[0];
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const slugParam = url.searchParams.get("slug") || url.searchParams.get("brand");
    const forwardedHost = req.headers.get("x-forwarded-host");
    const rawHost = forwardedHost || req.headers.get("host") || url.host;
    const host = rawHost.split(":")[0].toLowerCase();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve storefront
    let sf: any = null;
    if (slugParam) {
      const { data } = await supabase
        .from("storefronts")
        .select("id, slug, name, store_id, is_active, updated_at, social")
        .eq("slug", slugParam)
        .eq("is_active", true)
        .maybeSingle();
      sf = data;
    }

    if (!sf) {
      // Host-based match
      const { data: allSf } = await supabase
        .from("storefronts")
        .select("id, slug, name, store_id, is_active, updated_at, social")
        .eq("is_active", true);

      if (allSf) {
        // Subdomain or custom domain match
        const subdomain = host.split(".")[0];
        sf = allSf.find((s: any) => {
          if (s.slug === subdomain) return true;
          const customDomains = Array.isArray(s.social?.custom_domains) ? s.social.custom_domains : [];
          return customDomains.some((d: string) => d.toLowerCase() === host || `www.${d.toLowerCase()}` === host);
        });
      }
    }

    if (!sf) {
      return new Response("Storefront not found", { status: 404, headers: corsHeaders });
    }

    const baseUrl = `https://${rawHost}`;

    // 1. Static and builder pages
    const urls: { loc: string; lastmod: string; changefreq: string; priority: string }[] = [
      { loc: `${baseUrl}/`, lastmod: formatDate(sf.updated_at), changefreq: "daily", priority: "1.0" },
      { loc: `${baseUrl}/shop`, lastmod: formatDate(sf.updated_at), changefreq: "daily", priority: "0.9" },
    ];

    // Fetch published builder pages
    const { data: pages } = await supabase
      .from("storefront_pages")
      .select("slug, updated_at")
      .eq("storefront_id", sf.id)
      .eq("status", "published");

    if (pages) {
      for (const pg of pages) {
        if (pg.slug !== "home") {
          urls.push({
            loc: `${baseUrl}/pages/${escapeXml(pg.slug)}`,
            lastmod: formatDate(pg.updated_at),
            changefreq: "weekly",
            priority: "0.7",
          });
        }
      }
    }

    // 2. Collections
    const { data: collections } = await supabase
      .from("storefront_collections")
      .select("collection_id, collections!inner(slug, updated_at)")
      .eq("storefront_id", sf.id);

    if (collections) {
      for (const c of collections as any[]) {
        if (c.collections?.slug) {
          urls.push({
            loc: `${baseUrl}/collections/${escapeXml(c.collections.slug)}`,
            lastmod: formatDate(c.collections.updated_at),
            changefreq: "weekly",
            priority: "0.8",
          });
        }
      }
    }

    // 3. Products
    let productRows: any[] = [];
    if (sf.store_id) {
      const { data: prods } = await supabase
        .from("products")
        .select("slug, updated_at")
        .eq("store_id", sf.store_id)
        .eq("is_active", true);
      productRows = prods || [];
    } else {
      const { data: sfProds } = await supabase
        .from("storefront_products")
        .select("product_id, products!inner(slug, updated_at, is_active)")
        .eq("storefront_id", sf.id);
      productRows = (sfProds || [])
        .map((sp: any) => sp.products)
        .filter((p: any) => p && p.is_active);
    }

    for (const prod of productRows) {
      if (prod.slug) {
        urls.push({
          loc: `${baseUrl}/product/${escapeXml(prod.slug)}`,
          lastmod: formatDate(prod.updated_at),
          changefreq: "daily",
          priority: "0.8",
        });
      }
    }

    // Generate XML
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (e: any) {
    return new Response(`Error: ${e?.message || "Internal error"}`, {
      status: 500,
      headers: corsHeaders,
    });
  }
});
