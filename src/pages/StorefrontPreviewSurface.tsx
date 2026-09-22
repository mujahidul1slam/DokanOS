import { useEffect, useState } from "react";
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
 * Storefront preview surface (Phase F / plan C6-F1 fix).
 *
 * Rendered DIRECTLY by StorefrontPreviewPage — no StorefrontApp, no Router,
 * no catch-all, no detectBrand. The iframe URL never matches a storefront
 * route; unknown surfaces render a placeholder, never a Navigate.
 *
 * Preview contract: iframe mirrors the SAVED state. When the editor saves,
 * the iframe reloads (same URL, new settings read) — no live typing.
 */
export default function StorefrontPreviewSurface() {
  const { slug, surface } = useParams();

  const [sf, setSf] = useState<Storefront | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (!slug) { setSf(null); return; }
    supabase.from("storefronts").select("*").eq("slug", slug).maybeSingle()
      .then(({ data }) => { if (alive) setSf((data as unknown as Storefront) || null); });
    return () => { alive = false; };
  }, [slug]);

  if (sf === undefined) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!sf) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Select a page to preview</div>;
  }

  // Theme override (from ?theme_override= in the preview URL — BrandContext-level swap)
  const params = new URLSearchParams(window.location.search);
  const themeOverride = params.get("theme_override");
  const effectiveSf = themeOverride ? { ...sf, theme: themeOverride } : sf;

  return (
    <BrandProvider brand={sf.slug} storefrontOverride={effectiveSf}>
      <SurfaceFrame surface={surface || "home"} brand={sf.slug} />
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
    case "_identity":
      return (
        <MemoryRouter initialEntries={[`/storefront/${brand}`]}>
          <StorefrontLayout><Home /></StorefrontLayout>
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
