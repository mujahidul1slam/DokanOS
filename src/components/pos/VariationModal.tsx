import { useState, useEffect } from "react";
import { Ruler, Tag, ShoppingCart } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getGroupsForProduct, type MeasurementGroup } from "@/lib/measurements";
import { getEffectiveStock, useGlobalStockEnabled } from "@/lib/stockSettings";
import type { Product, Variation, CartItem, MeasurementGroupCapture } from "./types";

interface Props {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onAddToCart: (item: CartItem) => void;
}

interface ParsedAttr { key: string; value: string; }

function parseAttributes(attrs: any): ParsedAttr[] {
  if (!Array.isArray(attrs)) return [];
  return attrs.map((a: any) => {
    if (a.key && a.value) return { key: a.key, value: a.value };
    const k = Object.keys(a).find((k) => k !== "key" && k !== "value");
    if (k) return { key: k, value: a[k] };
    return null;
  }).filter(Boolean) as ParsedAttr[];
}

const VariationModal = ({ product, open, onClose, onAddToCart }: Props) => {
  const [variations, setVariations] = useState<Variation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVar, setSelectedVar] = useState<Variation | null>(null);
  const [customTailoring, setCustomTailoring] = useState(false);
  const [qty, setQty] = useState(1);
  const globalStockEnabled = useGlobalStockEnabled();

  // Dynamic measurement groups
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [groups, setGroups] = useState<MeasurementGroup[]>([]);
  // Map of groupId -> { fieldId: value }
  const [groupValues, setGroupValues] = useState<Record<string, Record<string, string>>>({});
  const [groupNotes, setGroupNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!product || !open) return;
    setSelectedVar(null);
    setCustomTailoring(false);
    setQty(1);
    setGroupValues({});
    setGroupNotes({});
    setLoading(true);

    Promise.all([
      supabase.from("product_variations").select("id, product_id, name, sku, price, stock_quantity, stock_status, manage_stock, attributes").eq("product_id", product.id),
      supabase.from("invoice_settings" as any).select("pos_custom_measurements_enabled").limit(1).single(),
      getGroupsForProduct(product.id),
    ]).then(([vars, settings, grps]) => {
      setVariations((vars.data || []) as Variation[]);
      setGlobalEnabled(((settings as any).data?.pos_custom_measurements_enabled) !== false);
      setGroups(grps);
      setLoading(false);
    });
  }, [product, open]);

  if (!product) return null;

  const attrGroups: Record<string, { value: string; variations: Variation[] }[]> = {};
  variations.forEach((v) => {
    parseAttributes(v.attributes).forEach((attr) => {
      if (!attrGroups[attr.key]) attrGroups[attr.key] = [];
      const existing = attrGroups[attr.key].find((x) => x.value === attr.value);
      if (existing) existing.variations.push(v);
      else attrGroups[attr.key].push({ value: attr.value, variations: [v] });
    });
  });

  const attrKeys = Object.keys(attrGroups);
  const hasVariations = variations.length > 0;
  const finalPrice = selectedVar ? Number(selectedVar.price) : Number(product.price);
  const showMeasurementToggle = globalEnabled && groups.length > 0;
  const selectedStock = getEffectiveStock(selectedVar || product, globalStockEnabled);
  const addDisabled = (hasVariations && !selectedVar) || selectedStock.outOfStock;

  const handleAdd = () => {
    const measurementGroups: MeasurementGroupCapture[] = customTailoring
      ? groups
          .map((g) => {
            const vals = groupValues[g.id] || {};
            const filled = g.fields
              .map((f) => ({ name: f.name, value: vals[f.id] || "" }))
              .filter((v) => v.value.trim() !== "");
            if (filled.length === 0 && !groupNotes[g.id]) return null;
            return {
              groupId: g.id,
              groupName: g.name,
              displayFormat: g.display_format,
              unit: g.unit,
              values: filled,
              notes: groupNotes[g.id] || undefined,
            };
          })
          .filter(Boolean) as MeasurementGroupCapture[]
      : [];

    const item: CartItem = {
      uid: crypto.randomUUID(),
      productId: product.id,
      variationId: selectedVar?.id,
      name: product.name,
      variationLabel: selectedVar?.name,
      price: finalPrice,
      qty,
      customTailoring,
      measurementGroups: measurementGroups.length > 0 ? measurementGroups : undefined,
    };
    onAddToCart(item);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{product.name}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {product.sku && <span className="font-mono text-xs">SKU: {product.sku}</span>}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-4 text-center text-sm text-muted-foreground animate-pulse">Loading…</div>
        )}

        {!loading && hasVariations && attrKeys.length > 0 && (
          <div className="space-y-4">
            {attrKeys.map((key) => (
              <div key={key}>
                <p className="text-sm font-medium flex items-center gap-2 mb-2 capitalize">
                  <Tag className="h-4 w-4" /> {key}
                </p>
                <div className="flex flex-wrap gap-2">
                  {attrGroups[key].map((opt) => {
                    const isSelected = selectedVar && opt.variations.some((v) => v.id === selectedVar.id);
                    return (
                      <button
                        key={opt.value}
                        onClick={() => {
                          const match = opt.variations[0];
                          setSelectedVar(selectedVar?.id === match.id ? null : match);
                        }}
                        className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-secondary text-secondary-foreground hover:border-primary/40"
                        }`}
                      >
                        <span>{opt.value}</span>
                        {opt.variations.some((v) => {
                          const stock = getEffectiveStock(v, globalStockEnabled);
                          return stock.tracked && stock.quantity <= 3 && stock.quantity > 0;
                        }) && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">Low</Badge>
                        )}
                        {opt.variations.every((v) => getEffectiveStock(v, globalStockEnabled).outOfStock) && (
                          <Badge variant="destructive" className="ml-2 text-[10px]">OOS</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && hasVariations && attrKeys.length === 0 && (
          <div className="space-y-4">
            <p className="text-sm font-medium flex items-center gap-2">
              <Tag className="h-4 w-4" /> Select Variation
            </p>
            <div className="flex flex-wrap gap-2">
              {variations.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVar(selectedVar?.id === v.id ? null : v)}
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    selectedVar?.id === v.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary text-secondary-foreground hover:border-primary/40"
                  }`}
                >
                  <span>{v.name || "Variant"}</span>
                  {(() => {
                    const stock = getEffectiveStock(v, globalStockEnabled);
                    return stock.tracked && stock.quantity <= 3 && stock.quantity > 0;
                  })() && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">Low</Badge>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && !hasVariations && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <ShoppingCart className="h-4 w-4" />
            <span>Simple product — no variations</span>
          </div>
        )}

        {/* Custom measurements toggle (only if assigned groups exist) */}
        {showMeasurementToggle && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary p-4">
            <div className="flex items-center gap-3">
              <Ruler className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Custom Measurements</p>
                <p className="text-xs text-muted-foreground">
                  {groups.length === 1 ? `Add ${groups[0].name}` : `${groups.length} measurement groups available`}
                </p>
              </div>
            </div>
            <Switch checked={customTailoring} onCheckedChange={setCustomTailoring} />
          </div>
        )}

        {/* Measurement field groups */}
        {customTailoring && showMeasurementToggle && (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.id} className="space-y-3 rounded-lg border border-border p-4 bg-card">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{g.name}</h4>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{g.unit}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {g.fields.map((f) => (
                    <div key={f.id}>
                      <Label className="text-xs">{f.name}</Label>
                      <Input
                        value={groupValues[g.id]?.[f.id] || ""}
                        onChange={(e) => setGroupValues({
                          ...groupValues,
                          [g.id]: { ...(groupValues[g.id] || {}), [f.id]: e.target.value },
                        })}
                        placeholder="0.0"
                        className="h-9 mt-1 bg-secondary"
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Textarea
                    value={groupNotes[g.id] || ""}
                    onChange={(e) => setGroupNotes({ ...groupNotes, [g.id]: e.target.value })}
                    placeholder="Special instructions..."
                    className="mt-1 bg-secondary min-h-[50px]"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Qty & Add */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Qty:</Label>
            <div className="flex items-center border border-border rounded-md">
              <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-3 py-1.5 text-sm hover:bg-muted">−</button>
              <span className="px-3 py-1.5 text-sm font-medium border-x border-border min-w-[2.5rem] text-center">{qty}</span>
              <button onClick={() => setQty(qty + 1)} className="px-3 py-1.5 text-sm hover:bg-muted">+</button>
            </div>
          </div>
          <p className="font-heading text-xl font-semibold">৳{(finalPrice * qty).toLocaleString()}</p>
        </div>

        <Button
          onClick={handleAdd}
          disabled={addDisabled}
          className="w-full h-12 text-base font-medium"
        >
          {selectedStock.outOfStock ? "Out of stock" : hasVariations && !selectedVar ? "Select a variation" : "Add to Cart"}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default VariationModal;
