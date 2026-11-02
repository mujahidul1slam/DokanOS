import { ReactNode, useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard, Palette, LayoutTemplate, Files, FolderOpen, Building2,
  PanelsTopLeft, Square, Grid3X3, List, Truck, CreditCard, Sparkles,
  Globe, FileText, Settings, HelpCircle, ExternalLink, Loader2, ChevronLeft, Activity, Plus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import type { Storefront } from "@/storefront/lib/brand";

/**
 * Storefront admin shell (Bonik parity Phase A) — dedicated full-bleed layout
 * for /storefronts/:slug/admin/* routes. Own sidebar; AppSidebar never renders
 * inside. Grouped sections mirror Bonik's seller panel.
 */

/** Surface → preview path segment (mirrors StorefrontAdminEditor.PREVIEW_SURFACE).
 *  Used by the header button so "Preview" opens the surface you're editing (E4). */
const PREVIEW_SURFACE: Record<string, string> = {
  "header-footer": "home",
  "product-page": "_product_page",
  "product-card": "_shop_page",
  "shop-page": "_shop_page",
  builder: "home",
  theme: "home",
  tokens: "home",
  animations: "home",
};

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
}

const GROUPS: { label: string; items: { label: string; path: string; icon: ReactNode }[] }[] = [
  {
    label: "GENERAL",
    items: [
      { label: "Overview", path: "dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
      { label: "Pages", path: "pages", icon: <Files className="h-4 w-4" /> },
      { label: "Collections", path: "collections", icon: <FolderOpen className="h-4 w-4" /> },
      { label: "Products", path: "products", icon: <List className="h-4 w-4" /> },
      { label: "Social & Policies", path: "policies", icon: <FileText className="h-4 w-4" /> },
      { label: "Settings", path: "settings", icon: <Settings className="h-4 w-4" /> },
      { label: "Support", path: "help", icon: <HelpCircle className="h-4 w-4" /> },
      { label: "Health", path: "health", icon: <Activity className="h-4 w-4" /> },
    ],
  },
  {
    label: "IDENTITY",
    items: [
      { label: "Store Identity", path: "identity", icon: <Building2 className="h-4 w-4" /> },
    ],
  },
  {
    label: "THEME & STYLING",
    items: [
      { label: "Theme", path: "theme", icon: <Palette className="h-4 w-4" /> },
      { label: "Design tokens", path: "tokens", icon: <Palette className="h-4 w-4" /> },
      { label: "Homepage Builder", path: "builder", icon: <LayoutTemplate className="h-4 w-4" /> },
      { label: "Header & Footer", path: "header-footer", icon: <PanelsTopLeft className="h-4 w-4" /> },
      { label: "Product Page", path: "product-page", icon: <Square className="h-4 w-4" /> },
      { label: "Product Card", path: "product-card", icon: <Grid3X3 className="h-4 w-4" /> },
      { label: "Shop Page", path: "shop-page", icon: <List className="h-4 w-4" /> },
      { label: "Scroll Animations", path: "animations", icon: <Sparkles className="h-4 w-4" /> },
    ],
  },
  {
    label: "CHECKOUT & SHIPPING",
    items: [
      { label: "Delivery & Shipping", path: "delivery", icon: <Truck className="h-4 w-4" /> },
      { label: "Checkout Fields", path: "checkout-fields", icon: <List className="h-4 w-4" /> },
      { label: "Payment Methods", path: "payments", icon: <CreditCard className="h-4 w-4" /> },
    ],
  },
  {
    label: "DOMAINS",
    items: [
      { label: "Domains", path: "domains", icon: <Globe className="h-4 w-4" /> },
    ],
  },
];

export default function StorefrontAdminShell({ children, sfOverride, list, onSwitch, onCreate, surface = "dashboard" }: {
  children: ReactNode;
  /** The active storefront — resolved by the parent (StorefrontsPage). */
  sfOverride?: Storefront;
  /** All storefronts — powers the switcher in the header. */
  list?: Storefront[];
  /** Switch storefront (parent navigates / persists). */
  onSwitch?: (s: Storefront) => void;
  /** Open the create dialog (parent owns it). */
  onCreate?: () => void;
  /** Current surface key (dashboard/theme/builder/...). */
  surface?: string;
}) {
  const { user } = useAuth();
  const sf = sfOverride ?? null;

  // Hooks-order rule: ALL hooks must run before any early return.
  // Real brand names for the switcher badge (review C1) — the literal
  // "brand" string named nothing.
  const brandIds = useMemo(
    () =>
      Array.from(
        new Set(
          ((list || []) as Array<Storefront & { brand_id?: string | null }>)
            .map((s) => s.brand_id)
            .filter((b): b is string => !!b),
        ),
      ),
    [list],
  );
  const [brandNames, setBrandNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (brandIds.length === 0) { setBrandNames({}); return; }
    supabase.from("brands").select("id,name").in("id", brandIds).then(({ data }) => {
      const m: Record<string, string> = {};
      ((data || []) as Array<{ id: string; name: string }>).forEach((b) => { m[b.id] = b.name; });
      setBrandNames(m);
    });
  }, [brandIds]);

  if (!sf) {
    return <div className="flex h-[60vh] items-center justify-center text-muted-foreground">Storefront not found.</div>;
  }

  const base = `/storefronts/${sf.slug}/admin`;

  const currentSurface = surface;

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[32rem] rounded-xl border border-border bg-background text-foreground overflow-hidden">
      {/* Left sub-sidebar (Bonik-style grouped nav) — in-content panel (overhaul 2.1),
          rendered inside the main dashboard shell around it. */}
      <aside className="w-56 shrink-0 border-r border-border bg-card/40 flex flex-col h-full overflow-y-auto">
        <div className="p-4 border-b border-border">
          <Link to="/storefronts" className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition">
            <ChevronLeft className="h-4 w-4" /> All storefronts
          </Link>
          <div className="mt-3">
            <div className="text-base font-semibold">{sf.name}</div>
            <div className="text-xs text-muted-foreground">/{sf.slug}</div>
          </div>
          {/* Storefront switcher (fix C) */}
          {list && list.length > 1 && (
            <div className="mt-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Switch storefront</div>
              <div className="space-y-0.5">
                {list.map((s) => {
                  const brandId = (s as Storefront & { brand_id?: string | null }).brand_id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSwitch?.(s)}
                      className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                        s.id === sf.id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <span className="truncate">{s.name}</span>
                      {brandId && brandNames[brandId] && (
                        <span className="max-w-[80px] truncate text-[9px] text-muted-foreground shrink-0">
                          {brandNames[brandId]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-4 space-y-5">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">{g.label}</div>
              <div className="space-y-0.5">
                {g.items.map((item) => {
                  const to = `${base}/${item.path}`;
                  const active = currentSurface === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={to}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                        active ? "bg-primary/10 text-primary font-medium" : "text-foreground/75 hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
              {(user?.email || "U").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{user?.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Content area */}
      <div className="flex-1 min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur px-6 py-3 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold capitalize">
            {GROUPS.flatMap((g) => g.items).find((i) => i.path === currentSurface)?.label || "Dashboard"}
          </h1>
          <div className="flex items-center gap-2">
            {onCreate && (
              <Button variant="outline" size="sm" className="gap-1" onClick={onCreate}>
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            )}
            {/* Review E4: point the button at the CURRENT SURFACE's preview when
                one exists (theme/product-page/card/builder…), else the live store.
                Previously it always opened the live storefront. */}
            {(() => {
              const previewSurface = PREVIEW_SURFACE[currentSurface];
              const href = previewSurface
                ? `/storefronts/preview/${sf.slug}/${previewSurface}?surface=${previewSurface}${currentSurface === "builder" ? "&draft=home" : ""}`
                : `/storefront/${sf.slug}`;
              return (
                <a href={href} target="_blank" rel="noreferrer" title={previewSurface ? "Open the current surface's preview" : "Open your live storefront"}>
                  <Button variant="outline" size="sm" className="gap-2">
                    <ExternalLink className="h-3.5 w-3.5" /> {previewSurface ? "Preview" : "View Store"}
                  </Button>
                </a>
              );
            })()}
          </div>
        </header>

        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
