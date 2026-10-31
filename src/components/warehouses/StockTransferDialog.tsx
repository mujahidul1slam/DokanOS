import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { parseVariationAttributes, joinVariationOptions } from "@/lib/variations";
import {
  applyStockTransfer,
  holderKey,
  type StockHolder,
  type TransferLine,
} from "@/lib/stockHolders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
}
interface VariationOption {
  id: string;
  product_id: string;
  name: string | null;
  sku: string | null;
  attributes: unknown;
}

export interface OnHandEntry {
  productId: string;
  variationId: string | null;
  holderKey: string;
  quantity: number;
}

interface ItemRow {
  uid: string;
  productId: string;
  variationId: string | null;
  quantity: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  holders: StockHolder[];
  /** Current `product_locations` quantities, for the "available" hints + validation. */
  onHand: OnHandEntry[];
  /** The brand's product store ids (legacy link) to scope the picker. */
  productStoreIds: string[];
  onDone: () => void;
}

const variationLabel = (variation: VariationOption | undefined): string => {
  if (!variation) return "";
  return joinVariationOptions(parseVariationAttributes(variation.attributes)) || variation.name || "";
};

/**
 * Simple holder→holder transfer (spec §3, Q14): pick two stock holders of the
 * brand, add item lines, and the move is applied to `product_locations` with a
 * `stock_transfers` ledger line per product/variation.
 */
export function StockTransferDialog({ open, onOpenChange, brandId, holders, onHand, productStoreIds, onDone }: Props) {
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [note, setNote] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [variations, setVariations] = useState<VariationOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = holders.find((h) => h.key === fromKey) ?? null;
  const to = holders.find((h) => h.key === toKey) ?? null;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNote("");
    setItems([{ uid: crypto.randomUUID(), productId: "", variationId: null, quantity: "1" }]);
    setFromKey(holders[0]?.key ?? "");
    setToKey(holders[1]?.key ?? "");
    let cancelled = false;
    (async () => {
      if (productStoreIds.length === 0) {
        setProducts([]);
        setVariations([]);
        return;
      }
      const [prodRes, varRes] = await Promise.all([
        supabase.from("products").select("id, name, sku").in("store_id", productStoreIds).eq("is_active", true).order("name"),
        supabase.from("product_variations").select("id, product_id, name, sku, attributes"),
      ]);
      if (cancelled) return;
      const prods = (prodRes.data ?? []) as ProductOption[];
      setProducts(prods);
      const ids = new Set(prods.map((p) => p.id));
      setVariations(((varRes.data ?? []) as VariationOption[]).filter((v) => ids.has(v.product_id)));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, holders, productStoreIds]);

  const toOptions = useMemo(() => holders.filter((h) => h.key !== fromKey), [holders, fromKey]);

  const availableFor = (item: ItemRow): number | null => {
    if (!from || !item.productId) return null;
    const entry = onHand.find(
      (e) =>
        e.holderKey === from.key &&
        e.productId === item.productId &&
        (e.variationId ?? null) === (item.variationId ?? null),
    );
    return entry?.quantity ?? 0;
  };

  const productVariations = (productId: string) => variations.filter((v) => v.product_id === productId);

  const submit = async () => {
    if (saving || !from || !to) return;
    const lines: TransferLine[] = items.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      const variation = variations.find((v) => v.id === item.variationId);
      return {
        productId: item.productId,
        variationId: item.variationId,
        quantity: Number(item.quantity),
        label: `${product?.name ?? "item"}${variation ? ` · ${variationLabel(variation)}` : ""}`,
      };
    });
    setSaving(true);
    setError(null);
    try {
      await applyStockTransfer({ brandId, from, to, lines, note: note.trim() || null });
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Transfer stock</DialogTitle>
          <DialogDescription>
            Move items between stock holders — warehouses and stock-holding order
            sources. Stock quantities move with the transfer.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>From</Label>
            <SearchableSelect
              options={holders.map((h) => ({ value: h.key, label: `${h.name} (${h.kind === "warehouse" ? "warehouse" : "source"})` }))}
              value={fromKey}
              onChange={setFromKey}
              placeholder="From holder"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <SearchableSelect
              options={toOptions.map((h) => ({ value: h.key, label: `${h.name} (${h.kind === "warehouse" ? "warehouse" : "source"})` }))}
              value={toKey}
              onChange={setToKey}
              placeholder="To holder"
              className="h-9"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Items</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setItems((prev) => [...prev, { uid: crypto.randomUUID(), productId: "", variationId: null, quantity: "1" }])}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add item
            </Button>
          </div>
          {items.map((item) => {
            const itemVariations = item.productId ? productVariations(item.productId) : [];
            const available = availableFor(item);
            return (
              <div key={item.uid} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <SearchableSelect
                    options={products.map((p) => ({ value: p.id, label: p.sku ? `${p.name} (${p.sku})` : p.name }))}
                    value={item.productId}
                    onChange={(v) =>
                      setItems((prev) =>
                        prev.map((i) => (i.uid === item.uid ? { ...i, productId: v, variationId: null } : i)),
                      )
                    }
                    placeholder="Product"
                    className="h-9"
                  />
                  {available !== null && (
                    <p className="text-[10px] text-muted-foreground">
                      Available at {from?.name}: {available}
                    </p>
                  )}
                </div>
                {itemVariations.length > 0 && (
                  <div className="w-40">
                    <SearchableSelect
                      options={itemVariations.map((v) => ({ value: v.id, label: variationLabel(v) || v.name || v.sku || "Variation" }))}
                      value={item.variationId ?? ""}
                      onChange={(v) =>
                        setItems((prev) =>
                          prev.map((i) => (i.uid === item.uid ? { ...i, variationId: v || null } : i)),
                        )
                      }
                      placeholder="Variation"
                      className="h-9"
                    />
                  </div>
                )}
                <div className="w-24 space-y-1">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={item.quantity}
                    onChange={(e) =>
                      setItems((prev) => prev.map((i) => (i.uid === item.uid ? { ...i, quantity: e.target.value } : i)))
                    }
                    className="h-9"
                    aria-label="Quantity"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => setItems((prev) => prev.filter((i) => i.uid !== item.uid))}
                  aria-label="Remove item"
                  disabled={items.length === 1}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="transfer-note">Note (optional)</Label>
          <Input id="transfer-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this move?" maxLength={200} />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !from || !to}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
