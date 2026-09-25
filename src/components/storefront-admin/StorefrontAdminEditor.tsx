import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
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
import EditorPage from "@/components/storefront-admin/EditorPage";

/**
 * Editor bridge (Phase A): maps the admin route's :surface to the existing tab
 * component, wrapped in the shared editor chrome (preview iframe per surface).
 * Save-then-reload contract: each tab manages its own draft; on save we bump
 * the preview key so the iframe reloads with the persisted settings.
 */

const PREVIEW_SURFACE: Record<string, string> = {
  "header-footer": "home",
  "product-page": "_product_page",
  "product-card": "_shop_page",
  "shop-page": "_shop_page",
  "builder": "home",
  "theme": "home",
  "animations": "home",
};

export default function StorefrontAdminEditor({ surface }: { surface: string }) {
  const { slug } = useParams();
  const [sf, setSf] = useState<Storefront | null | undefined>(undefined);
  const [liveSf, setLiveSf] = useState<Storefront | null>(null);

  useEffect(() => {
    let alive = true;
    if (!slug) { setSf(null); return; }
    supabase.from("storefronts").select("*").eq("slug", slug).maybeSingle()
      .then(({ data }) => { if (alive) setSf((data as unknown as Storefront) || null); });
    return () => { alive = false; };
  }, [slug]);

  if (sf === undefined) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!sf) {
    return <div className="text-center py-20 text-muted-foreground">Storefront not found.</div>;
  }

  // Save → fresh row → live preview swap via postMessage (overhaul 1.3)
  const onUpdate = (s: Storefront) => {
    setSf(s);
    setLiveSf(s);
  };

  const previewSurface = PREVIEW_SURFACE[surface];
  // Builder preview shows the DRAFT working copy (?draft=home drives BrandProvider)
  const previewUrl = previewSurface
    ? `/storefronts/preview/${slug}/${previewSurface}?surface=${previewSurface}${surface === "builder" ? "&draft=home" : ""}`
    : undefined;

  const tab = (() => {
    switch (surface) {
      case "identity": return <BrandProfileTab sf={sf} onUpdate={onUpdate} />;
      case "policies": return <SocialPoliciesTab sf={sf} onUpdate={onUpdate} />;
      case "domains": return <DomainsTab sf={sf} onUpdate={onUpdate} />;
      case "products": return <ProductsTab sf={sf} />;
      case "pages": return <PagesTab sf={sf} />;
      case "collections": return <CollectionsTab sf={sf} />;
      case "settings": return <SettingsTab sf={sf} onUpdate={onUpdate} />;
      case "product-card": return <CardStyleTab sf={sf} onUpdate={onUpdate} />;
      case "product-page": return <ProductPageTab sf={sf} onUpdate={onUpdate} />;
      case "shop-page": return <ShopPageTab sf={sf} onUpdate={onUpdate} />;
      case "header-footer": return <HeaderFooterTab sf={sf} onUpdate={onUpdate} />;
      case "animations": return <AnimationsTab sf={sf} onUpdate={onUpdate} />;
      case "delivery": return <DeliveryTab sf={sf} onUpdate={onUpdate} />;
      case "payments": return <PaymentsTab sf={sf} onUpdate={onUpdate} />;
      default: return <div className="text-muted-foreground text-sm">Unknown surface.</div>;
    }
  })();

  return (
    <EditorPage previewUrl={previewUrl} liveStorefront={liveSf}>
      {tab}
    </EditorPage>
  );
}
