import { useState, useMemo } from "react";
import { Search, ScanBarcode, Plus, Package } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { Product } from "./types";

interface Props {
  products: Product[];
  categories: string[];
  onSelectProduct: (p: Product) => void;
  onAddCustomItem: () => void;
}

const ProductCatalog = ({ products, categories, onSelectProduct, onAddCustomItem }: Props) => {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = products;
    if (activeCategory) list = list.filter((p) => p.category === activeCategory);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, search, activeCategory]);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Top Bar */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1">
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Scan barcode or search products..."
            className="pl-11 h-12 text-base bg-secondary border-border"
          />
        </div>
        <Button onClick={onAddCustomItem} className="h-12 gap-2 px-5 shrink-0">
          <Plus className="h-4 w-4" /> Custom Item
        </Button>
      </div>

      {/* Category Pills */}
      <ScrollArea className="mb-3 w-full">
        <div className="flex gap-2 pb-2">
          <button
            onClick={() => setActiveCategory(null)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              !activeCategory
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-muted"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-muted"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Product Grid */}
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 pr-3">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectProduct(p)}
              className="group flex flex-col rounded-lg border border-border bg-card overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="relative aspect-square bg-secondary flex items-center justify-center overflow-hidden">
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <Package className="h-10 w-10 text-muted-foreground/40" />
                )}
                <Badge
                  variant={p.stock_quantity > 5 ? "default" : p.stock_quantity > 0 ? "secondary" : "destructive"}
                  className="absolute top-2 right-2 text-[10px]"
                >
                  {p.stock_quantity > 0 ? `${p.stock_quantity} in stock` : "Out"}
                </Badge>
              </div>
              <div className="p-3 flex flex-col gap-1">
                <p className="text-sm font-medium text-card-foreground line-clamp-2 leading-snug">{p.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{p.sku || "—"}</p>
                <p className="font-heading text-base font-semibold text-card-foreground mt-auto pt-1">
                  ৳{Number(p.price).toLocaleString()}
                </p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Search className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">No products found</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ProductCatalog;
