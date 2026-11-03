import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Loader2, Package, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { canCreateBusinessResources } from "@/lib/accounts/rolePresentation";
import type { OrderSourceRow } from "@/lib/orderSources";
import { Button } from "@/components/ui/button";
import {
  BrandSourceSection,
  type RecentSourceOrder,
  type SourceOrderStat,
} from "@/components/order-sources/BrandSourceSection";
import { type LegacyRows, type LegacyStoreRow } from "@/components/order-sources/LegacySourceRows";
import { OrderSourceDialog } from "@/components/order-sources/OrderSourceDialog";
import { ConnectorSection } from "@/components/integrations/ConnectorSection";

const EMPTY_LEGACY_ROWS: LegacyRows = {
  stores: [],
};

/**
 * Order Sources management, living on the Integrations page (Task 6, spec
 * §2/§8): one section per brand listing its order sources with type badges and
 * connection/sync status, the read-only legacy Woo-store rows that remain
 * mapped through order_sources.legacy_* columns after the Task 16 contract
 * drop, and the default-source picker the Add Order form follows.
 */
export function OrderSourcesPanel() {
  const { brands, myRole } = useBusinessContext();
  const canCreate = canCreateBusinessResources(myRole);
  const [sources, setSources] = useState<OrderSourceRow[]>([]);
  const [orderStats, setOrderStats] = useState<Record<string, SourceOrderStat>>({});
  const [legacy, setLegacy] = useState<LegacyRows>(EMPTY_LEGACY_ROWS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; brandId: string; source: OrderSourceRow | null }>({
    open: false,
    brandId: "",
    source: null,
  });

  const load = useCallback(async () => {
    const brandIds = brands.map((b) => b.id);
    if (brandIds.length === 0) {
      setSources([]);
      setLegacy(EMPTY_LEGACY_ROWS);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const storeIds = brands
        .map((b) => b.woo_store_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const [srcRes, stRes] = await Promise.all([
        supabase.from("order_sources").select("*").in("brand_id", brandIds).order("name"),
        storeIds.length > 0
          ? supabase
              .from("stores")
              .select("id, name, url, status, last_synced_at")
              .in("id", storeIds)
          : supabase.from("stores").select("id, name, url, status, last_synced_at").limit(0),
      ]);
      const failed = [srcRes, stRes].find((r) => r.error);
      if (failed?.error) throw failed.error;
      const loadedSources = (srcRes.data as OrderSourceRow[]) || [];
      setSources(loadedSources);
      setLegacy({
        stores: (stRes.data as LegacyStoreRow[]) || [],
      });

      // Orders attributed to each source — a created order must appear under
      // its source (Task 6 acceptance). Counts are per source (head queries);
      // recent orders come from one bounded fetch.
      const stats: Record<string, SourceOrderStat> = {};
      if (loadedSources.length > 0) {
        const sourceIds = loadedSources.map((s) => s.id);
        const results = (await Promise.all([
          supabase
            .from("orders")
            .select("id, order_number, customer_name, total, created_at, order_source_id")
            .in("order_source_id", sourceIds)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(100),
          ...sourceIds.map((id) =>
            supabase
              .from("orders")
              .select("id", { count: "exact", head: true })
              .eq("order_source_id", id)
              .is("deleted_at", null),
          ),
        ])) as Array<{ data: unknown; error: { message: string } | null; count?: number | null }>;
        const recentRes = results[0];
        if (recentRes.error) throw recentRes.error;
        sourceIds.forEach((id, i) => {
          stats[id] = { count: results[i + 1]?.count ?? 0, recent: [] };
        });
        for (const row of (recentRes.data ?? []) as Array<RecentSourceOrder & { order_source_id: string | null }>) {
          if (row.order_source_id && stats[row.order_source_id]) {
            stats[row.order_source_id].recent.push(row);
          }
        }
      }
      setOrderStats(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order sources");
    } finally {
      setLoading(false);
    }
  }, [brands]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Mark a source as the brand's default for the Add Order form. The current
   * default is cleared first — the partial unique index (one default per
   * brand) rejects a second default while one exists.
   */
  const setDefault = useCallback(async (source: OrderSourceRow) => {
    if (source.is_default) return;
    try {
      const clear = await supabase
        .from("order_sources")
        .update({ is_default: false })
        .eq("brand_id", source.brand_id)
        .eq("is_default", true);
      if (clear.error) throw clear.error;
      const set = await supabase.from("order_sources").update({ is_default: true }).eq("id", source.id);
      if (set.error) throw set.error;
      setSources((prev) =>
        prev.map((s) => (s.brand_id === source.brand_id ? { ...s, is_default: s.id === source.id } : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set the default order source");
    }
  }, []);

  return (
    <ConnectorSection
      id="order-sources-heading"
      title="Order Sources"
      description="Every channel that creates orders — synced connectors and staff-entered ones. Click the star to choose the default source the Add Order form starts with."
      icon={<Package className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
      count={sources.length}
      layout="stack"
      actions={
        canCreate && brands.length > 0 ? (
          <Button size="sm" onClick={() => setDialog({ open: true, brandId: brands[0].id, source: null })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New source
          </Button>
        ) : undefined
      }
    >
      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm flex-1">{error}</p>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading order sources" />
        </div>
      ) : brands.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Order sources belong to a brand. Create a brand first — brands can
            exist without stores.
          </p>
          <Button size="sm" className="mt-4" asChild>
            <Link to="/brands">Create a brand</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {brands.map((brand) => (
            <BrandSourceSection
              key={brand.id}
              brand={brand}
              sources={sources.filter((s) => s.brand_id === brand.id)}
              stats={orderStats}
              legacy={{
                stores: legacy.stores.filter((s) => brand.woo_store_id === s.id),
              }}
              canCreate={canCreate}
              onAdd={(brandId) => setDialog({ open: true, brandId, source: null })}
              onEdit={(source) => setDialog({ open: true, brandId: source.brand_id, source })}
              onSetDefault={setDefault}
            />
          ))}
        </div>
      )}

      <OrderSourceDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        brandId={dialog.brandId}
        brandName={brands.find((b) => b.id === dialog.brandId)?.name}
        source={dialog.source}
        onSaved={load}
      />
    </ConnectorSection>
  );
}
