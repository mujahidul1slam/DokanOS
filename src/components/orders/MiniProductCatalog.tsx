import { useState, useMemo, useCallback } from "react";
import { Search, ScanBarcode, Plus, Package, SlidersHorizontal, ArrowUpDown, Eye, EyeOff, Tag, Star, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import CategoryFilter from "@/components/CategoryFilter";
import Fuse from "fuse.js";
import { useGlobalStockEnabled, getEffectiveStock } from "@/lib/stockSettings";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  stock_quantity: number;
  image_url: string | null;
  category: string | null;
  description: string | null;
  manage_stock?: boolean;
  stock_status?: string;
  is_featured?: boolean;
  sales_count?: number;
  created_at?: string;
  barcode?: string;
  store_id?: string;
}

interface Props {
  products: Product[];
  categories: { id: string; name: string; parent_id?: string | null; store_id: string | null }[];
  productCatMap?: Map<string, Set<string>>;
  stores: { id: string; name: string }[];
  onSelectProduct: (p: Product) => void;
  onAddCustomItem: () => void;
  className?: string;
}

const PER_PAGE_OPTIONS = [12, 24, 48, 96];

const MiniProductCatalog = ({ products, categories, productCatMap, stores, onSelectProduct, onAddCustomItem, className }: Props) => {
  const globalStockEnabled = useGlobalStockEnabled();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "newest" | "price_asc" | "price_desc" | "popularity">("name");
  const [hideOutOfStock, setHideOutOfStock] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(24);

  const filtered = useMemo(() => {
    let list = products;
    if (activeCategory !== "all") {
      list = list.filter((p) => {
        const ids = productCatMap?.get(p.id);
        if (ids?.has(activeCategory)) return true;
        const cat = categories.find((c) => c.id === activeCategory);
        return cat ? p.category === cat.name : false;
      });
    }
    if (hideOutOfStock) list = list.filter((p) => !getEffectiveStock(p, globalStockEnabled).outOfStock);
    if (selectedStore !== "all") list = list.filter((p) => (p as any).store_id === selectedStore);
    if (search) {
      const q = search.trim().toLowerCase();
      const exact = list.filter(
        (p) =>
          (p.sku || "").toLowerCase() === q ||
          ((p as any).barcode || "").toLowerCase() === q
      );
      if (exact.length > 0) {
        list = exact;
      } else {
        const fuse = new Fuse(list, {
          keys: [
            { name: "name", weight: 0.6 },
            { name: "sku", weight: 0.25 },
            { name: "barcode", weight: 0.15 },
          ],
          threshold: 0.4,
          ignoreLocation: true,
          minMatchCharLength: 2,
        });
        list = fuse.search(q).map((r) => r.item);
      }
    }

    const featured = list.filter((p) => (p as any).is_featured);
    const nonFeatured = list.filter((p) => !(p as any).is_featured);

    const sortFn = (a: Product, b: Product) => {
      switch (sortBy) {
        case "newest":
          return ((b as any).created_at || "").localeCompare((a as any).created_at || "");
        case "price_asc":
          return Number(a.price) - Number(b.price);
        case "price_desc":
          return Number(b.price) - Number(a.price);
        case "popularity":
          return ((b as any).sales_count || 0) - ((a as any).sales_count || 0);
        default:
          return a.name.localeCompare(b.name);
      }
    };

    featured.sort(sortFn);
    nonFeatured.sort(sortFn);
    return [...featured, ...nonFeatured];
  }, [products, search, activeCategory, sortBy, hideOutOfStock, selectedStore, productCatMap, categories, globalStockEnabled]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex flex-col gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              className="pl-8 h-9 text-sm bg-secondary/50"
            />
            {search && (
              <button 
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onAddCustomItem} className="h-9 gap-1 px-2 shrink-0">
            <Plus className="h-3.5 w-3.5" /> <span>Custom</span>
          </Button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <CategoryFilter
            mode="single"
            categories={categories}
            stores={stores}
            storeFilter={selectedStore}
            value={activeCategory}
            onChange={(v) => { setActiveCategory(v); setPage(1); }}
            placeholder="Categories"
            size="sm"
            className="h-8 w-auto min-w-[100px] text-[11px] shrink-0"
          />

          <Select value={sortBy} onValueChange={(v) => { setSortBy(v as any); setPage(1); }}>
            <SelectTrigger className="h-8 w-auto min-w-[100px] text-[11px] shrink-0">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">A-Z</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="price_asc">Price ↑</SelectItem>
              <SelectItem value="price_desc">Price ↓</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={hideOutOfStock ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2 text-[11px] shrink-0"
            onClick={() => { setHideOutOfStock(!hideOutOfStock); setPage(1); }}
          >
            {hideOutOfStock ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
            OOS
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 -mr-2 pr-2">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 pb-4">
          {paginated.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectProduct(p)}
              className="group flex flex-col rounded-md border border-border bg-card overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-sm"
            >
              <div className="relative aspect-square bg-secondary/30 flex items-center justify-center overflow-hidden">
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => {
                      const img = e.currentTarget;
                      img.style.display = "none";
                      const fb = img.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = "flex";
                    }}

                  />
                ) : null}
                <div className={`absolute inset-0 items-center justify-center bg-secondary/30 ${p.image_url ? 'hidden' : 'flex'}`}>
                  <Package className="h-6 w-6 text-muted-foreground/30" />
                </div>
                {(() => {
                  const eff = getEffectiveStock(p, globalStockEnabled);
                  if (eff.outOfStock) {
                    return <Badge variant="destructive" className="absolute top-1 right-1 text-[9px] px-1 py-0 h-4">Out</Badge>;
                  }
                  return null;
                })()}
              </div>
              <div className="p-2 flex flex-col gap-0.5">
                <p className="text-[11px] font-medium line-clamp-1 leading-tight">{p.name}</p>
                <p className="text-[11px] font-semibold text-primary">৳{Number(p.price).toLocaleString()}</p>
              </div>
            </button>
          ))}
        </div>
        {paginated.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <p className="text-xs">No products</p>
          </div>
        )}
      </ScrollArea>

      <div className="flex items-center justify-between gap-1 pt-2 border-t border-border mt-auto">
        <span className="text-[10px] text-muted-foreground truncate">{filtered.length} products</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-6 w-6" disabled={currentPage <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="text-[10px] min-w-[30px] text-center">{currentPage}/{totalPages}</span>
          <Button variant="outline" size="icon" className="h-6 w-6" disabled={currentPage >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next page">
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MiniProductCatalog;
