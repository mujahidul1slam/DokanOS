import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Warehouse as WarehouseIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { canCreateBusinessResources } from "@/lib/accounts/rolePresentation";
import {
  buildStockHolders,
  holderKey,
  type StockHolder,
  type StockHoldingSourceRow,
  type WarehouseRow,
} from "@/lib/stockHolders";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BrandWarehouseSection,
  type StockRow,
  type TransferRow,
} from "@/components/warehouses/BrandWarehouseSection";
import { WarehouseDialog } from "@/components/warehouses/WarehouseDialog";
import { StockTransferDialog, type OnHandEntry } from "@/components/warehouses/StockTransferDialog";

interface EmbeddedHolderRow {
  id: string;
  product_id: string;
  variation_id: string | null;
  stock_quantity: number | string;
  warehouse_id: string | null;
  stock_holder_order_source_id: string | null;
  products: { name: string; sku: string | null } | null;
  product_variations: { name: string | null; sku: string | null; attributes: unknown } | null;
}

interface EmbeddedTransferRow {
  id: string;
  from_warehouse_id: string | null;
  from_order_source_id: string | null;
  to_warehouse_id: string | null;
  to_order_source_id: string | null;
  quantity: number | string;
  status: string;
  note: string | null;
  created_at: string;
  products: { name: string; sku: string | null } | null;
  product_variations: { name: string | null; sku: string | null; attributes: unknown } | null;
}

/**
 * Settings → Warehouses (Task 7, spec §3): brand-level stock world — warehouses
 * CRUD, on-hand per stock holder (warehouses + stock-holding order sources),
 * and simple holder→holder transfers. Replaces the StoresHub Locations tab
 * (which stays routable until Task 11).
 */
const WarehousesTab = () => {
  const { brands, myRole, loading: ctxLoading } = useBusinessContext();
  const canCreate = canCreateBusinessResources(myRole);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [sources, setSources] = useState<StockHoldingSourceRow[]>([]);
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "warehouse"; brandId: string; warehouse: WarehouseRow | null }
    | { kind: "transfer"; brandId: string }
    | null
  >(null);
  const [pendingDelete, setPendingDelete] = useState<WarehouseRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const brandIds = brands.map((b) => b.id);
    if (brandIds.length === 0) {
      setWarehouses([]);
      setSources([]);
      setStockRows([]);
      setTransfers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [whRes, srcRes, trRes] = await Promise.all([
        supabase.from("warehouses").select("*").in("brand_id", brandIds).order("name"),
        supabase
          .from("order_sources")
          .select("id, brand_id, name, type, is_stock_holding")
          .in("brand_id", brandIds)
          .order("name"),
        supabase
          .from("stock_transfers")
          .select(
            "id, brand_id, from_warehouse_id, from_order_source_id, to_warehouse_id, to_order_source_id, product_id, variation_id, quantity, status, note, created_at, products(name, sku), product_variations(name, sku, attributes)",
          )
          .in("brand_id", brandIds)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      const failed = [whRes, srcRes, trRes].find((r) => r.error);
      if (failed?.error) throw failed.error;
      const loadedWarehouses = (whRes.data as WarehouseRow[]) || [];
      const loadedSources = (srcRes.data as StockHoldingSourceRow[]) || [];
      setWarehouses(loadedWarehouses);
      setSources(loadedSources);

      const holders = buildStockHolders(loadedWarehouses, loadedSources);
      const warehouseIds = holders.filter((h) => h.kind === "warehouse").map((h) => h.id);
      const sourceIds = holders.filter((h) => h.kind === "source").map((h) => h.id);
      let rows: StockRow[] = [];
      if (warehouseIds.length + sourceIds.length > 0) {
        const orParts = [
          warehouseIds.length > 0 ? `warehouse_id.in.(${warehouseIds.join(",")})` : null,
          sourceIds.length > 0 ? `stock_holder_order_source_id.in.(${sourceIds.join(",")})` : null,
        ].filter(Boolean);
        const { data: plRes, error: plErr } = await supabase
          .from("product_locations")
          .select(
            "id, product_id, variation_id, stock_quantity, warehouse_id, stock_holder_order_source_id, products(name, sku), product_variations(name, sku, attributes)",
          )
          .or(orParts.join(","));
        if (plErr) throw plErr;
        rows = ((plRes ?? []) as unknown as EmbeddedHolderRow[]).map((r) => ({
          id: r.id,
          product_id: r.product_id,
          variation_id: r.variation_id,
          stock_quantity: Number(r.stock_quantity),
          holderKey: r.warehouse_id
            ? holderKey("warehouse", r.warehouse_id)
            : holderKey("source", r.stock_holder_order_source_id),
          product: r.products ?? null,
          variation: r.product_variations ?? null,
        }));
      }
      setStockRows(rows);
      setTransfers(
        ((trRes.data ?? []) as unknown as EmbeddedTransferRow[]).map((r) => ({
          id: r.id,
          fromKey: r.from_warehouse_id
            ? holderKey("warehouse", r.from_warehouse_id)
            : r.from_order_source_id
              ? holderKey("source", r.from_order_source_id)
              : null,
          toKey: r.to_warehouse_id
            ? holderKey("warehouse", r.to_warehouse_id)
            : r.to_order_source_id
              ? holderKey("source", r.to_order_source_id)
              : null,
          product: r.products ?? null,
          variation: r.product_variations ?? null,
          quantity: Number(r.quantity),
          status: r.status,
          note: r.note,
          created_at: r.created_at,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load warehouses");
    } finally {
      setLoading(false);
    }
  }, [brands]);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const { error: delError } = await supabase.from("warehouses").delete().eq("id", pendingDelete.id);
    setDeleting(false);
    if (delError) {
      toast.error(delError.message);
      return;
    }
    toast.success(`Warehouse "${pendingDelete.name}" deleted`);
    setPendingDelete(null);
    load();
  };

  const holdersByBrand = new Map<string, StockHolder[]>();
  for (const brand of brands) {
    holdersByBrand.set(
      brand.id,
      buildStockHolders(
        warehouses.filter((w) => w.brand_id === brand.id),
        sources.filter((s) => s.brand_id === brand.id),
      ),
    );
  }

  const onHandFor = (brandId: string): OnHandEntry[] => {
    const holders = holdersByBrand.get(brandId) ?? [];
    const keys = new Set(holders.map((h) => h.key));
    return stockRows
      .filter((row) => keys.has(row.holderKey))
      .map((row) => ({
        productId: row.product_id,
        variationId: row.variation_id,
        holderKey: row.holderKey,
        quantity: row.stock_quantity,
      }));
  };

  if (ctxLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
          <WarehouseIcon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <h2 className="font-heading text-lg font-semibold">Warehouses</h2>
          <p className="text-sm text-muted-foreground">
            Brand-level stock: warehouses (stock-only), stock-holding order
            sources, and transfers between them.
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm flex-1">{error}</p>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading warehouses" />
        </div>
      ) : brands.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Warehouses belong to a brand. Create a brand first.
          </p>
        </div>
      ) : (
        brands.map((brand) => {
          const holders = holdersByBrand.get(brand.id) ?? [];
          const holderKeys = new Set(holders.map((h) => h.key));
          return (
            <BrandWarehouseSection
              key={brand.id}
              brand={brand}
              warehouses={warehouses.filter((w) => w.brand_id === brand.id)}
              holders={holders}
              stockRows={stockRows.filter((r) => holderKeys.has(r.holderKey))}
              transfers={transfers.filter(
                (t) => (t.fromKey && holderKeys.has(t.fromKey)) || (t.toKey && holderKeys.has(t.toKey)),
              )}
              canCreate={canCreate}
              onAddWarehouse={(brandId) => setDialog({ kind: "warehouse", brandId, warehouse: null })}
              onEditWarehouse={(warehouse) => setDialog({ kind: "warehouse", brandId: warehouse.brand_id, warehouse })}
              onDeleteWarehouse={setPendingDelete}
              onTransfer={(brandId) => setDialog({ kind: "transfer", brandId })}
            />
          );
        })
      )}

      {dialog?.kind === "warehouse" && (
        <WarehouseDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          brandId={dialog.brandId}
          brandName={brands.find((b) => b.id === dialog.brandId)?.name}
          warehouse={dialog.warehouse}
          onSaved={load}
        />
      )}
      {dialog?.kind === "transfer" && (
        <StockTransferDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          brandId={dialog.brandId}
          holders={buildStockHolders(
            warehouses.filter((w) => w.brand_id === dialog.brandId),
            sources.filter((s) => s.brand_id === dialog.brandId),
          )}
          onHand={onHandFor(dialog.brandId)}
          productStoreIds={(() => {
            const brand = brands.find((b) => b.id === dialog.brandId);
            return brand?.woo_store_id ? [brand.woo_store_id] : [];
          })()}
          onDone={load}
        />
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete warehouse "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Its stock rows are removed with it. This cannot be undone — use a
              transfer first if the stock should move elsewhere.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WarehousesTab;
