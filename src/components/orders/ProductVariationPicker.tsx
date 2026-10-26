import { useEffect, useMemo, useState } from "react";
import { Package, Plus } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCurrency } from "@/hooks/useCurrency";
import {
  getProductVariations,
  joinVariationOptions,
  parseVariationAttributes,
  type ParsedAttr,
} from "@/lib/variations";

export interface PickableProduct {
  id: string;
  name: string;
  sku: string | null;
  price: number;
}

export interface PickableVariation {
  id: string;
  product_id: string;
  name?: string | null;
  sku?: string | null;
  price?: number | null;
  stock_quantity?: number | null;
  manage_stock?: boolean | null;
  attributes?: unknown;
}

export interface VariationPick {
  product: PickableProduct;
  variation: PickableVariation | null;
  /** `Name - L / Red` — the order_items.product_name convention. */
  lineName: string;
  attributes: ParsedAttr[];
  price: number;
}

/**
 * The order line naming convention used everywhere size is parsed back out
 * (measurement size detection reads the ` - ` suffix).
 */
export const variationLineName = (
  productName: string,
  attrs: ParsedAttr[],
  variationName?: string | null,
): string => {
  const label = joinVariationOptions(attrs) || (variationName || "").trim();
  return label ? `${productName} - ${label}` : productName;
};

const variationLabel = (v: PickableVariation): string => {
  const attrs = parseVariationAttributes(v.attributes);
  return joinVariationOptions(attrs) || v.name || v.sku || "Default";
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: PickableProduct[];
  variations: PickableVariation[];
  /** When set, the product is fixed and only its variations are offered. */
  lockProductId?: string | null;
  onPick: (pick: VariationPick) => void;
  title?: string;
  description?: string;
}

/**
 * Shared product + variation/size picker (issue #20).
 *
 * Order Detail's add-item flow and ExchangeDialog both use this so size never
 * has to be typed by hand, and both produce the same `Name - variation` line
 * convention. Variation attributes are read through lib/variations so all
 * three historical attribute shapes work.
 */
export default function ProductVariationPicker({
  open,
  onOpenChange,
  products,
  variations,
  lockProductId,
  onPick,
  title = "Choose product & size",
  description = "Pick the exact variation so the order line keeps its size label.",
}: Props) {
  const { symbol } = useCurrency();
  const [productId, setProductId] = useState(lockProductId || "");

  useEffect(() => {
    if (open) setProductId(lockProductId || "");
  }, [open, lockProductId]);

  const product = useMemo(
    () => products.find((p) => p.id === productId) || null,
    [products, productId],
  );

  const productVariations = useMemo(
    () => getProductVariations(productId, variations)
      .sort((a, b) => variationLabel(a).localeCompare(variationLabel(b))),
    [productId, variations],
  );

  const pick = (variation: PickableVariation | null) => {
    if (!product) return;
    const attributes = variation ? parseVariationAttributes(variation.attributes) : [];
    const rawPrice = variation?.price ?? product.price;
    onPick({
      product,
      variation,
      lineName: variationLineName(product.name, attributes, variation?.name),
      attributes,
      price: Number(rawPrice) || 0,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!lockProductId && (
            <SearchableSelect
              options={products.map((p) => ({
                value: p.id,
                label: `${p.name}${p.sku ? ` (${p.sku})` : ""} — ${symbol}${Number(p.price).toLocaleString()}`,
              }))}
              value={productId}
              onChange={setProductId}
              placeholder="Select a product…"
              searchPlaceholder="Search products by name or SKU…"
              emptyText="No products found."
            />
          )}

          {product && productVariations.length === 0 && (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between h-auto py-2"
              onClick={() => pick(null)}
            >
              <span className="flex items-center gap-2">
                <Plus className="h-3.5 w-3.5" /> {product.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {symbol}{Number(product.price).toLocaleString()}
              </span>
            </Button>
          )}

          {product && productVariations.length > 0 && (
            <ScrollArea className="max-h-72 pr-2">
              <div className="space-y-1.5">
                {productVariations.map((v) => {
                  const outOfStock = v.manage_stock !== false
                    && v.stock_quantity != null
                    && Number(v.stock_quantity) <= 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={outOfStock}
                      onClick={() => pick(v)}
                      className="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate">{variationLabel(v)}</span>
                      <span className="flex items-center gap-2 shrink-0 text-xs">
                        {outOfStock && <Badge variant="destructive" className="text-[10px]">Out</Badge>}
                        <span className="font-medium text-primary">
                          {symbol}{Number(v.price ?? product.price).toLocaleString()}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {!product && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Pick a product to see its sizes and variations.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
