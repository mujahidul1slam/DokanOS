import { useEffect, useRef, useState } from "react";
import { useParams, MemoryRouter } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useBrand, BrandProvider } from "@/storefront/BrandContext";
import type { Storefront } from "@/storefront/lib/brand";
import { useScrollAnimations } from "@/storefront/lib/animations";
import { mergeSettings } from "@/storefront/lib/settings";
import Home from "@/storefront/pages/Home";
import Shop from "@/storefront/pages/Shop";
import Product from "@/storefront/pages/Product";
import StorefrontLayout from "@/storefront/components/StorefrontLayout";
import { Loader2 } from "lucide-react";

/**
 * Storefront preview surface (overhaul 1.3 — postMessage pipeline).
 *
 * Rendered DIRECTLY — no StorefrontApp, no Router, no catch-all, no
 * detectBrand. Unknown surfaces render a placeholder, never a Navigate.
 *
 * Live preview contract:
 *  - Parent editor posts {type: "preview-storefront", storefront} after a
 *    save → this surface swaps the storefront (settings + branding) in
 *    place — pages re-render against the new state with NO reload.
 *  - {type: "preview-refresh"} → bumps refreshKey → page components remount
 *    and refetch (used for builder draft sections, which live in the DB
 *    working copy rather than the storefront row).
 *  - ?draft=<pageSlug> → BrandProvider receives draftPageSlug so Home
 *    renders the DRAFT working copy (homepage builder preview).
 *  - ?theme_override=<preset> → theme swapped at the BrandContext level.
 *  - Acks with {type: "preview-ack"} so the parent can retry posts until
 *    the iframe app is ready.
 */
export default function StorefrontPreviewSurface() {
  const { slug, pageSlug } = useParams();
  const params = new URLSearchParams(window.location.search);
  const surface = params.get("surface") || pageSlug || "home";
  const draftPageSlug = params.get("draft") || null;

  const [sf, setSf] = useState<Storefront | null | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const sfRef = useRef(sf);
  sfRef.current = sf;

  // Initial load from the DB (staff client — RLS enforced server-side)
  useEffect(() => {
    let alive = true;
    if (!slug) { setSf(null); return; }
    supabase.from("storefronts").select("*").eq("slug", slug).maybeSingle()
      .then(({ data }) => { if (alive) setSf((data as unknown as Storefront) || null); });
    return () => { alive = false; };
  }, [slug]);

  // Live pipeline: listen for editor posts; ack readiness
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "preview-storefront" && e.data.storefront) {
        setSf(e.data.storefront as Storefront);
        setRefreshKey((k) => k + 1);
      } else if (e.data.type === "preview-refresh") {
        setRefreshKey((k) => k + 1);
      } else if (e.data.type === "preview-ping") {
        e.source?.postMessage({ type: "preview-ack", surface }, { targetOrigin: e.origin || "*" });
        if (e.data.storefront) setSf(e.data.storefront as Storefront);
      }
    };
    window.addEventListener("message", onMessage);
    // Tell the parent we're up (parent retries anyway; this speeds first paint)
    window.parent?.postMessage({ type: "preview-ack", surface }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [surface]);

  if (sf === undefined) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!sf) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Select a page to preview</div>;
  }

  const themeOverride = params.get("theme_override");
  const effectiveSf = themeOverride ? { ...sf, theme: themeOverride } : sf;

  return (
    <BrandProvider brand={sf.slug} storefrontOverride={effectiveSf} draftPageSlug={draftPageSlug ?? undefined}>
      <SurfaceFrame key={refreshKey} surface={surface} brand={sf.slug} />
    </BrandProvider>
  );
}

function SurfaceFrame({ surface, brand }: { surface: string; brand: string }) {
  const { storefront } = useBrand();
  useScrollAnimations(mergeSettings(storefront.settings).animations);
  const [firstProductSlug, setFirstProductSlug] = useState<string | null>(null);

  // _product_page preview needs a real product to render — load the first one
  useEffect(() => {
    if (surface !== "_product_page") return;
    let alive = true;
    import("@/storefront/lib/catalog").then(async (m) => {
      const all = await m.listStorefrontProducts(storefront.id);
      if (alive && all.length) setFirstProductSlug(all[0].slug);
    });
    return () => { alive = false; };
  }, [surface, storefront.id]);

  // MemoryRouter lets the real page components use useParams/useNavigate
  // without touching the iframe's address bar — the URL stays frozen.
  switch (surface) {
    case "home":
    case "_builder":
    case "_identity":
      return (
        <MemoryRouter initialEntries={[`/storefront/${brand}`]}>
          <StorefrontLayout><Home /></StorefrontLayout>
        </MemoryRouter>
      );
    case "_product_page":
      return firstProductSlug ? (
        <MemoryRouter initialEntries={[`/storefront/${brand}/product/${firstProductSlug}`]}>
          <StorefrontLayout><Product slugOverride={firstProductSlug} /></StorefrontLayout>
        </MemoryRouter>
      ) : (
        <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
      );
    case "_shop_page":
      return (
        <MemoryRouter initialEntries={[`/storefront/${brand}/shop`]}>
          <StorefrontLayout><Shop /></StorefrontLayout>
        </MemoryRouter>
      );
    default:
      return (
        <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
          Select a page to preview
        </div>
      );
  }
}
