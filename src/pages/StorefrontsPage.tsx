import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { invalidateSlugCache } from "@/storefront/lib/brand";
import type { Storefront } from "@/storefront/lib/brand";
import { useActiveBusinessStoreIds, hasStoreScope } from "@/hooks/useActiveBusinessStoreIds";
import StorefrontAdminShell from "@/components/storefront-admin/StorefrontAdminShell";
import { StorefrontOverview } from "@/components/storefront-admin/AdminPages";
import StorefrontAdminEditor from "@/components/storefront-admin/StorefrontAdminEditor";
import { CreateStorefrontDialog } from "@/components/storefront/StorefrontSubOnboarding";

/**
 * Storefronts (overhaul 2.1 / fix C + D): clicking "Storefronts" in the main
 * sidebar renders the admin panel DIRECTLY — no secondary page, no button.
 * The legacy tabbed editor is removed. Storefront switching happens in the
 * panel header; each storefront shows its brand (2.2).
 *
 * Storefront creation is the shared sub-onboarding (Task 14, spec §6a step 6):
 * `CreateStorefrontDialog` from src/components/storefront runs the same
 * name/slug → theme → payments → publish flow the onboarding wizard uses.
 *
 * URL forms handled:
 *   /storefronts                          → last-used (or first) storefront, Overview
 *   /storefronts/:slug/admin              → that storefront, Overview
 *   /storefronts/:slug/admin/<surface>    → that storefront, that surface
 */
const LAST_SF_KEY = "dokanos-admin-last-storefront";

function useSlugFromUrl(): string | undefined {
  const loc = useLocation();
  const m = loc.pathname.match(/^\/storefronts\/([^/]+)(?:\/|$)/);
  return m?.[1];
}
function useSurfaceFromUrl(): string | null {
  const loc = useLocation();
  const m = loc.pathname.match(/^\/storefronts\/[^/]+\/admin\/([^/]+)/);
  return m?.[1] || null;
}

export default function StorefrontsPage() {
  const navigate = useNavigate();
  const urlSlug = useSlugFromUrl();
  const urlSurface = useSurfaceFromUrl();
  const [list, setList] = useState<Storefront[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const businessStoreIds = useActiveBusinessStoreIds();

  async function reload() {
    // Fail closed (issue #16): without the active business's store scope, no
    // storefronts are readable — an empty scope is "no stores", not "all stores".
    if (!hasStoreScope(businessStoreIds)) {
      setList([]);
      invalidateSlugCache();
      return [];
    }
    const { data } = await supabase
      .from("storefronts")
      .select("*")
      .in("store_id", businessStoreIds)
      .order("name");
    setList((data as any) || []);
    invalidateSlugCache();
    return data;
  }

  useEffect(() => {
    reload().then(() => setLoading(false));
    // businessStoreIds has stable identity per store set (see seam docs), so
    // the list reloads exactly when the active business's scope changes.
  }, [businessStoreIds]);

  // Resolve the active storefront: URL slug → last-used → first
  const active =
    (urlSlug && list.find((s) => s.slug === urlSlug)) ||
    list.find((s) => s.slug === localStorage.getItem(LAST_SF_KEY)) ||
    list[0] ||
    null;

  // Persist the selection for plain /storefronts visits
  useEffect(() => {
    if (active) localStorage.setItem(LAST_SF_KEY, active.slug);
  }, [active?.slug]);

  const surface = urlSurface || "dashboard";

  // Keep the URL in sync when the resolved storefront differs from the URL
  // (e.g. plain /storefronts → /storefronts/<slug>/admin/dashboard).
  useEffect(() => {
    if (!loading && active && (!urlSlug || urlSlug !== active.slug)) {
      navigate(`/storefronts/${active.slug}/admin/${surface}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, active?.slug, urlSlug]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  if (!active) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center space-y-4">
        <h1 className="text-2xl font-semibold">Storefronts</h1>
        <p className="text-sm text-muted-foreground">No storefronts yet. Create your first one to get started.</p>
        <CreateStorefrontDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreate={async (newSf) => { await reload(); navigate(`/storefronts/${newSf.slug}/admin/dashboard`); }}
          autoOpen
        />
      </div>
    );
  }

  return (
    <StorefrontAdminShell
      sfOverride={active}
      list={list}
      onSwitch={(s) => navigate(`/storefronts/${s.slug}/admin/${surface}`)}
      onCreate={() => setCreateOpen(true)}
      surface={surface}
    >
      <StorefrontAdminEditor sf={active} surface={surface} onUpdate={(s) => {
        setList((l) => l.map((x) => (x.id === s.id ? s : x)));
        invalidateSlugCache();
      }} />
      <CreateStorefrontDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (newSf) => { await reload(); navigate(`/storefronts/${newSf.slug}/admin/dashboard`); }}
      />
    </StorefrontAdminShell>
  );
}
