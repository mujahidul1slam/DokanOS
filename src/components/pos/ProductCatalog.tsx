import { useState, useMemo, RefObject } from "react";
import Fuse from "fuse.js";
import { Search, ScanBarcode, Plus, Package, SlidersHorizontal, ArrowUpDown, Eye, EyeOff, Tag, Star, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import CategoryFilter from "@/components/CategoryFilter";
import type { Product } from "./types";
import { useGlobalStockEnabled, getEffectiveStock } from "@/lib/stockSettings";

interface Props {
  products: Product[];
  categories: { id: string; name: string; parent_id?: string | null; store_id: string | null }[];
  productCatMap?: Map<string, Set<string>>;
  stores: { id: string; name: string }[];
  onSelectProduct: (p: Product) => void;
  onAddCustomItem: () => void;
  searchInputRef?: RefObject<HTMLInputElement>;
}

const PER_PAGE_OPTIONS = [12, 24, 48, 96];

const ProductCatalog = ({ products, categories, productCatMap, stores, onSelectProduct, onAddCustomItem, searchInputRef }: Props) => {
  const globalStockEnabled = useGlobalStockEnabled();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all"); // category id or "all"
  const [sortBy, setSortBy] = useState<"name" | "newest" | "price_asc" | "price_desc" | "popularity">("name");
  const [hideOutOfStock, setHideOutOfStock] = useState(false);
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(24);

  const filtered = useMemo(() => {
    let list = products;
    if (activeCategory !== "all") {
      list = list.filter((p) => {
        const ids = productCatMap?.get(p.id);
        if (ids?.has(activeCategory)) return true;
        // Fallback: match by category name (legacy data without product_categories rows)
        const cat = categories.find((c) => c.id === activeCategory);
        return cat ? p.category === cat.name : false;
      });
    }
    if (hideOutOfStock) list = list.filter((p) => !getEffectiveStock(p, globalStockEnabled).outOfStock);
    if (selectedStore !== "all") list = list.filter((p) => (p as any).store_id === selectedStore);
    if (search) {
      const q = search.trim().toLowerCase();
      // Exact SKU/barcode match short-circuits (for scanners)
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

    // Featured products always first
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
  }, [products, search, activeCategory, sortBy, hideOutOfStock, onSaleOnly, selectedStore, productCatMap, categories, globalStockEnabled]);

  // Reset page on filter change
  useMemo(() => { setPage(1); }, [search, activeCategory, sortBy, hideOutOfStock, selectedStore, perPage]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);

  const activeFilterCount = [hideOutOfStock, onSaleOnly, selectedStore !== "all"].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={searchInputRef as any}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Scan or search... (F1)"
            className="pl-11 h-11 md:h-12 text-base bg-secondary border-border"
            data-barcode-enabled="true"
          />
        </div>
        <Button onClick={onAddCustomItem} className="h-11 md:h-12 gap-1.5 px-3 md:px-5 shrink-0">
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Custom</span>
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-3 overflow-x-auto scrollbar-none -mx-1 px-1">
        <CategoryFilter
          mode="single"
          categories={categories}
          stores={stores}
          storeFilter={selectedStore}
          value={activeCategory}
          onChange={setActiveCategory}
          placeholder="All Categories"
          size="sm"
          className="h-9 w-36 md:w-44 bg-secondary text-sm shrink-0"
        />

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="h-9 w-32 md:w-40 bg-secondary text-sm shrink-0">
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name A-Z</SelectItem>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="price_asc">Price: Low-High</SelectItem>
            <SelectItem value="price_desc">Price: High-Low</SelectItem>
            <SelectItem value="popularity">Popularity</SelectItem>
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-secondary border-border shrink-0">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <Badge className="text-[10px] px-1.5 py-0 ml-0.5">{activeFilterCount}</Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="text-xs">Visibility</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={hideOutOfStock} onCheckedChange={setHideOutOfStock}>
              <EyeOff className="h-3.5 w-3.5 mr-2" /> Hide Out of Stock
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={onSaleOnly} onCheckedChange={setOnSaleOnly}>
              <Tag className="h-3.5 w-3.5 mr-2" /> On Sale Only
            </DropdownMenuCheckboxItem>
            {stores.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Store</DropdownMenuLabel>
                <DropdownMenuCheckboxItem checked={selectedStore === "all"} onCheckedChange={() => setSelectedStore("all")}>
                  All Stores
                </DropdownMenuCheckboxItem>
                {stores.map((s) => (
                  <DropdownMenuCheckboxItem key={s.id} checked={selectedStore === s.id} onCheckedChange={() => setSelectedStore(selectedStore === s.id ? "all" : s.id)}>
                    {s.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Show All toggle — desktop only (mobile uses dropdown) */}
        <Button
          variant={hideOutOfStock ? "default" : "outline"}
          size="sm"
          className="h-9 gap-1.5 ml-auto shrink-0 hidden md:inline-flex"
          onClick={() => setHideOutOfStock(!hideOutOfStock)}
        >
          {hideOutOfStock ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {hideOutOfStock ? "Hiding OOS" : "Show All"}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 pr-3">
          {paginated.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectProduct(p)}
              className="group flex flex-col rounded-lg border border-border bg-card overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="relative aspect-square bg-secondary flex items-center justify-center overflow-hidden">
                {p.image_url ? (
                  <>
                    <img
                      src={p.image_url}
                      alt={p.name}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const img = e.currentTarget;
                        img.style.display = "none";
                        const fb = img.nextElementSibling as HTMLElement | null;
                        if (fb) fb.style.display = "flex";
                      }}
                    />
                    <span className="hidden absolute inset-0 items-center justify-center bg-secondary">
                      <Package className="h-10 w-10 text-muted-foreground/40" />
                    </span>
                  </>
                ) : (
                  <Package className="h-10 w-10 text-muted-foreground/40" />
                )}
                {(() => {
                  const eff = getEffectiveStock(p, globalStockEnabled);
                  if (!eff.tracked) {
                    return (
                      <Badge variant="default" className="absolute top-2 right-2 text-[10px]">
                        In stock
                      </Badge>
                    );
                  }
                  return (
                    <Badge
                      variant={eff.quantity > 5 ? "default" : eff.quantity > 0 ? "secondary" : "destructive"}
                      className="absolute top-2 right-2 text-[10px]"
                    >
                      {eff.outOfStock ? "Out" : `${eff.quantity} in stock`}
                    </Badge>
                  );
                })()}
                {(p as any).is_featured && (
                  <Star className="absolute top-2 left-2 h-4 w-4 text-yellow-400 fill-yellow-400" />
                )}
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
          {paginated.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Search className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">No products found</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-2 pt-2 md:pt-3 border-t border-border mt-2 pb-20 md:pb-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden md:inline">Show</span>
          <Select value={String(perPage)} onValueChange={(v) => setPerPage(Number(v))}>
            <SelectTrigger className="h-8 w-16 md:w-20 text-xs bg-secondary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PER_PAGE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground truncate">
            <span className="hidden md:inline">of </span>{filtered.length}<span className="hidden sm:inline"> products</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground px-2">
            {currentPage} / {totalPages}
          </span>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductCatalog;
