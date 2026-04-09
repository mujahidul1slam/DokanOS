import { useState, useEffect } from "react";
import { Ruler, Tag } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import type { Product, Variation, CartItem, CustomMeasurements } from "./types";

interface Props {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onAddToCart: (item: CartItem) => void;
}

const emptyMeasurements: CustomMeasurements = { chest: "", length: "", sleeves: "", shoulders: "", waist: "", notes: "" };

const VariationModal = ({ product, open, onClose, onAddToCart }: Props) => {
  const [variations, setVariations] = useState<Variation[]>([]);
  const [selectedVar, setSelectedVar] = useState<Variation | null>(null);
  const [customTailoring, setCustomTailoring] = useState(false);
  const [measurements, setMeasurements] = useState<CustomMeasurements>(emptyMeasurements);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (!product || !open) return;
    setSelectedVar(null);
    setCustomTailoring(false);
    setMeasurements(emptyMeasurements);
    setQty(1);

    supabase
      .from("product_variations")
      .select("id, product_id, name, sku, price, stock_quantity, attributes")
      .eq("product_id", product.id)
      .then(({ data }) => setVariations((data || []) as Variation[]));
  }, [product, open]);

  if (!product) return null;

  // Parse variation attributes into groups
  const attrGroups: Record<string, { value: string; varId: string }[]> = {};
  variations.forEach((v) => {
    const attrs = Array.isArray(v.attributes) ? v.attributes : [];
    (attrs as Record<string, string>[]).forEach((a) => {
      const key = Object.keys(a)[0];
      if (key) {
        if (!attrGroups[key]) attrGroups[key] = [];
        if (!attrGroups[key].find((x) => x.value === a[key]))
          attrGroups[key].push({ value: a[key], varId: v.id });
      }
    });
  });

  const finalPrice = selectedVar ? Number(selectedVar.price) : Number(product.price);

  const handleAdd = () => {
    const item: CartItem = {
      uid: crypto.randomUUID(),
      productId: product.id,
      variationId: selectedVar?.id,
      name: product.name,
      variationLabel: selectedVar?.name,
      price: finalPrice,
      qty,
      customTailoring,
      measurements: customTailoring ? measurements : undefined,
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

        {/* Variation selectors */}
        {variations.length > 0 && (
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
                  {v.stock_quantity <= 3 && v.stock_quantity > 0 && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">Low</Badge>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom tailoring toggle */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-secondary p-4">
          <div className="flex items-center gap-3">
            <Ruler className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Custom Tailoring</p>
              <p className="text-xs text-muted-foreground">Add measurements for bespoke fit</p>
            </div>
          </div>
          <Switch checked={customTailoring} onCheckedChange={setCustomTailoring} />
        </div>

        {/* Measurement fields */}
        {customTailoring && (
          <div className="space-y-3 rounded-lg border border-border p-4 bg-card">
            <div className="grid grid-cols-2 gap-3">
              {(["chest", "length", "sleeves", "shoulders", "waist"] as const).map((field) => (
                <div key={field}>
                  <Label className="text-xs capitalize">{field} (inches)</Label>
                  <Input
                    value={measurements[field]}
                    onChange={(e) => setMeasurements({ ...measurements, [field]: e.target.value })}
                    placeholder="0.0"
                    className="h-9 mt-1 bg-secondary"
                  />
                </div>
              ))}
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={measurements.notes}
                onChange={(e) => setMeasurements({ ...measurements, notes: e.target.value })}
                placeholder="Special instructions..."
                className="mt-1 bg-secondary min-h-[60px]"
              />
            </div>
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

        <Button onClick={handleAdd} className="w-full h-12 text-base font-medium">
          Add to Cart
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default VariationModal;
