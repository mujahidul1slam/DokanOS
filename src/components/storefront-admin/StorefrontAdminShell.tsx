import { ReactNode, useMemo, useState, useEffect } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  LayoutDashboard, Palette, LayoutTemplate, Files, FolderOpen, Building2,
  PanelsTopLeft, Square, Grid3X3, List, ShoppingBag, Truck, CreditCard,
  Globe, FileText, Settings, HelpCircle, Search, ExternalLink, X, Loader2, ChevronLeft,
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

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
}

const GROUPS: { label: string; items: { label: string; path: string; icon: ReactNode }[] }[] = [
  {
    label: "OVERVIEW",
    items: [{ label: "Dashboard", path: "dashboard", icon: <LayoutDashboard className="h-4 w-4" /> }],
  },
  {
    label: "STORE IDENTITY",
    items: [
      { label: "Theme", path: "theme", icon: <Palette className="h-4 w-4" /> },
      { label: "Homepage Builder", path: "builder", icon: <LayoutTemplate className="h-4 w-4" /> },
      { label: "Store Identity", path: "identity", icon: <Building2 className="h-4 w-4" /> },
    ],
  },
  {
    label: "PAGE LAYOUT",
    items: [
      { label: "Pages", path: "pages", icon: <Files className="h-4 w-4" /> },
      { label: "Collections", path: "collections", icon: <FolderOpen className="h-4 w-4" /> },
      { label: "Products", path: "products", icon: <List className="h-4 w-4" /> },
    ],
  },
  {
    label: "STOREFRONT",
    items: [
      { label: "Header & Footer", path: "header-footer", icon: <PanelsTopLeft className="h-4 w-4" /> },
      { label: "Scroll Animations", path: "animations", icon: <ShoppingBag className="h-4 w-4" /> },
    ],
  },
  {
    label: "PRODUCT DISPLAY",
    items: [
      { label: "Product Page", path: "product-page", icon: <Square className="h-4 w-4" /> },
      { label: "Product Card", path: "product-card", icon: <Grid3X3 className="h-4 w-4" /> },
      { label: "Shop Page", path: "shop-page", icon: <List className="h-4 w-4" /> },
    ],
  },
  {
    label: "CHECKOUT",
    items: [
      { label: "Delivery & Shipping", path: "delivery", icon: <Truck className="h-4 w-4" /> },
      { label: "Payment Methods", path: "payments", icon: <CreditCard className="h-4 w-4" /> },
    ],
  },
  {
    label: "SETTINGS",
    items: [
      { label: "Domains", path: "domains", icon: <Globe className="h-4 w-4" /> },
      { label: "Social & Policies", path: "policies", icon: <FileText className="h-4 w-4" /> },
      { label: "General Settings", path: "settings", icon: <Settings className="h-4 w-4" /> },
    ],
  },
  {
    label: "HELP",
    items: [{ label: "Support", path: "help", icon: <HelpCircle className="h-4 w-4" /> }],
  },
];

export default function StorefrontAdminShell({ children }: { children: ReactNode }) {
  const { slug } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sf, setSf] = useState<Storefront | null | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [search, setSearch] = useState("");

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
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Storefront not found.</div>;
  }

  const base = `/storefronts/${slug}/admin`;

  // Jump-to-surface command palette: filter group items by search text
  const paletteItems = useMemo(() => {
    const all = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q));
  }, [search]);

  const surfacePages: Record<string, boolean> = {
    "header-footer": true, "product-page": true, "product-card": true, "shop-page": true,
    "builder": true, "theme": true, "animations": true, "identity": false, "delivery": false,
    "payments": false, "domains": false, "policies": false, "settings": false, "pages": true,
    "collections": true, "products": true, "help": false, "dashboard": false,
  };

  const currentSurface = loc.pathname.replace(`${base}/`, "").split("/")[0] || "dashboard";
  const hasPreview = !!surfacePages[currentSurface];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Left sidebar — Bonik-style grouped nav */}
      <aside className="w-64 shrink-0 border-r border-border bg-card/40 flex flex-col sticky top-0 h-screen overflow-y-auto">
        <div className="p-4 border-b border-border">
          <Link to="/storefronts" className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition">
            <ChevronLeft className="h-4 w-4" /> All storefronts
          </Link>
          <div className="mt-3">
            <div className="text-base font-semibold">{sf.name}</div>
            <div className="text-xs text-muted-foreground">/{sf.slug}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mx-4 mt-4 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 transition"
        >
          <Search className="h-3.5 w-3.5" /> Search…
          <kbd className="ml-auto text-[10px] border border-border rounded px-1">⌘K</kbd>
        </button>

        <nav className="flex-1 p-4 space-y-5">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">{g.label}</div>
              <div className="space-y-0.5">
                {g.items.map((item) => {
                  const to = `${base}/${item.path}`;
                  const active = loc.pathname === to || (item.path === "dashboard" && loc.pathname === base);
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
            {hasPreview && (
              <a href={`/storefront/${slug}`} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" className="gap-2">
                  <ExternalLink className="h-3.5 w-3.5" /> View Store
                </Button>
              </a>
            )}
          </div>
        </header>

        <main className="p-6">{children}</main>
      </div>

      {/* Command palette overlay */}
      {paletteOpen && (
        <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-24" onClick={() => setPaletteOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Jump to a surface…"
                className="flex-1 bg-transparent text-sm outline-none"
              />
              <button onClick={() => setPaletteOpen(false)} aria-label="Close">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="max-h-80 overflow-auto p-2">
              {paletteItems.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3">No surfaces match.</p>
              ) : (
                paletteItems.map((i) => (
                  <button
                    key={i.path}
                    type="button"
                    onClick={() => { setPaletteOpen(false); setSearch(""); navigate(`${base}/${i.path}`); }}
                    className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-left hover:bg-muted transition"
                  >
                    {i.icon}
                    <span className="flex-1">{i.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{i.group}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
