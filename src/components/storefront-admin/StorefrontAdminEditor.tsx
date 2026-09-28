import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import type { Storefront } from "@/storefront/lib/brand";
import BrandProfileTab from "@/components/storefront-admin/BrandProfileTab";
import SocialPoliciesTab from "@/components/storefront-admin/SocialPoliciesTab";
import DomainsTab from "@/components/storefront-admin/DomainsTab";
import ProductsTab from "@/components/storefront-admin/ProductsTab";
import PagesTab from "@/components/storefront-admin/PagesTab";
import CollectionsTab from "@/components/storefront-admin/CollectionsTab";
import SettingsTab from "@/components/storefront-admin/SettingsTab";
import CardStyleTab from "@/components/storefront-admin/CardStyleTab";
import ProductPageTab from "@/components/storefront-admin/ProductPageTab";
import ShopPageTab from "@/components/storefront-admin/ShopPageTab";
import HeaderFooterTab from "@/components/storefront-admin/HeaderFooterTab";
import AnimationsTab from "@/components/storefront-admin/AnimationsTab";
import DeliveryTab from "@/components/storefront-admin/DeliveryTab";
import PaymentsTab from "@/components/storefront-admin/PaymentsTab";
import ThemeTokensEditor from "@/components/storefront-admin/ThemeTokensEditor";
import HealthPanel from "@/components/storefront-admin/HealthPanel";
import { StorefrontOverview } from "@/components/storefront-admin/AdminPages";
import EditorPage from "@/components/storefront-admin/EditorPage";

/**
 * Editor bridge (fix C): renders the surface editor for the given storefront.
 * Called with a preloaded storefront by StorefrontsPage (route-free inline
 * mode) or resolves the :slug route param when deep-linked.
 *
 * Save-then-reload contract: each tab manages its own draft; the preview
 * iframe swaps live via postMessage after every save.
 */

const PREVIEW_SURFACE: Record<string, string> = {
  "header-footer": "home",
  "product-page": "_product_page",
  "product-card": "_shop_page",
  "shop-page": "_shop_page",
  "builder": "home",
  "theme": "home",
  "tokens": "home",
  "animations": "home",
};

export default function StorefrontAdminEditor({ sf: sfProp, surface, onUpdate }: {
  sf?: Storefront;
  surface: string;
  onUpdate: (s: Storefront) => void;
}) {
  const { slug } = useSlugParam();
  const [sfState, setSfState] = useState<Storefront | null | undefined>(sfProp === undefined ? undefined : sfProp);
  const [liveSf, setLiveSf] = useState<Storefront | null>(sfProp ?? null);

  // Deep-link mode: resolve the storefront from the URL
  useEffect(() => {
    if (sfProp !== undefined || !slug) return;
    let alive = true;
    supabase.from("storefronts").select("*").eq("slug", slug).maybeSingle()
      .then(({ data }) => { if (alive) setSfState((data as unknown as Storefront) || null); });
    return () => { alive = false; };
  }, [slug, sfProp]);

  if (sfState === undefined) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!sfState) {
    return <div className="text-center py-20 text-muted-foreground">Storefront not found.</div>;
  }
  const sf = sfState;

  // Save → fresh row → live preview swap via postMessage (overhaul 1.3)
  const handleUpdate = (s: Storefront) => {
    setSfState(s);
    setLiveSf(s);
    onUpdate(s);
  };

  const previewSurface = PREVIEW_SURFACE[surface];
  const previewUrl = previewSurface
    ? `/storefronts/preview/${sf.slug}/${previewSurface}?surface=${previewSurface}${surface === "builder" ? "&draft=home" : ""}`
    : undefined;

  const tab = (() => {
    switch (surface) {
      case "identity": return <BrandProfileTab sf={sf} onUpdate={handleUpdate} />;
      case "policies": return <SocialPoliciesTab sf={sf} onUpdate={handleUpdate} />;
      case "domains": return <DomainsTab sf={sf} onUpdate={handleUpdate} />;
      case "products": return <ProductsTab sf={sf} />;
      case "pages": return <PagesTab sf={sf} />;
      case "collections": return <CollectionsTab sf={sf} />;
      case "settings": return <SettingsTab sf={sf} onUpdate={handleUpdate} />;
      case "product-card": return <CardStyleTab sf={sf} onUpdate={handleUpdate} />;
      case "product-page": return <ProductPageTab sf={sf} onUpdate={handleUpdate} />;
      case "shop-page": return <ShopPageTab sf={sf} onUpdate={handleUpdate} />;
      case "header-footer": return <HeaderFooterTab sf={sf} onUpdate={handleUpdate} />;
      case "animations": return <AnimationsTab sf={sf} onUpdate={handleUpdate} />;
      case "delivery": return <DeliveryTab sf={sf} onUpdate={handleUpdate} />;
      case "payments": return <PaymentsTab sf={sf} onUpdate={handleUpdate} />;
      case "tokens": return <ThemeTokensEditor sf={sf} onUpdate={handleUpdate} />;
      case "health": return <HealthPanel />;
      case "dashboard":
      case "overview":
        // Overview dashboard (fix C): the admin home for this storefront
        return <StorefrontOverview />;
      default: return <div className="text-muted-foreground text-sm">Unknown surface.</div>;
    }
  })();

  return (
    <EditorPage previewUrl={previewUrl} liveStorefront={liveSf}>
      {tab}
    </EditorPage>
  );
}

function useSlugParam(): { slug?: string } {
  // Safe outside a Router context: useParams falls back to an empty object.
  return useParams();
}
