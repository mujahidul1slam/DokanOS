import { useState, useMemo, RefObject } from "react";
import { Search, ScanBarcode, Plus, Package, SlidersHorizontal, ArrowUpDown, Eye, EyeOff, Tag, Store as StoreIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import type { Product } from "./types";

interface Props {
  products: Product[];
  categories: string[];
  stores: { id: string; name: string }[];
  onSelectProduct: (p: Product) => void;
  onAddCustomItem: () => void;
  searchInputRef?: RefObject<HTMLInputElement>;
}

const ProductCatalog = ({ products, categories, stores, onSelectProduct, onAddCustomItem, searchInputRef }: Props) => {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "newest" | "price_asc" | "price_desc">("name");
  const [hideOutOfStock, setHideOutOfStock] = useState(false);
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string>("all");

  const filtered = useMemo(() => {
    let list = products;
    if (activeCategory !== "all") list = list.filter((p) => p.category === activeCategory);
    if (hideOutOfStock) list = list.filter((p) => p.stock_quantity > 0);
    if (selectedStore !== "all") list = list.filter((p) => (p as any).store_id === selectedStore);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku || "").toLowerCase().includes(q) ||
          ((p as any).barcode || "").toLowerCase().includes(q)
      );
    }
    switch (sortBy) {
      case "newest":
        list = [...list].sort((a, b) => ((b as any).created_at || "").localeCompare((a as any).created_at || ""));
        break;
      case "price_asc":
        list = [...list].sort((a, b) => Number(a.price) - Number(b.price));
        break;
      case "price_desc":
        list = [...list].sort((a, b) => Number(b.price) - Number(a.price));
        break;
      default:
        list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [products, search, activeCategory, sortBy, hideOutOfStock, onSaleOnly, selectedStore]);

  const activeFilterCount = [hideOutOfStock, onSaleOnly, selectedStore !== "all"].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1">
          <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            ref={searchInputRef as any}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Scan barcode or search products... (F1)"
            className="pl-11 h-12 text-base bg-secondary border-border"
            data-barcode-enabled="true"
          />
        </div>
        <Button onClick={onAddCustomItem} className="h-12 gap-2 px-5 shrink-0">
          <Plus className="h-4 w-4" /> Custom
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Select value={activeCategory} onValueChange={setActiveCategory}>
          <SelectTrigger className="h-9 w-44 bg-secondary text-sm">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="h-9 w-40 bg-secondary text-sm">
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name A-Z</SelectItem>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="price_asc">Price: Low-High</SelectItem>
            <SelectItem value="price_desc">Price: High-Low</SelectItem>
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-secondary border-border">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <Badge className="text-[10px] px-1.5 py-0 ml-1">{activeFilterCount}</Badge>
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

        <Button
          variant={hideOutOfStock ? "default" : "outline"}
          size="sm"
          className="h-9 gap-1.5 ml-auto"
          onClick={() => setHideOutOfStock(!hideOutOfStock)}
        >
          {hideOutOfStock ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {hideOutOfStock ? "Hiding OOS" : "Show All"}
        </Button>
      </div>

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
                  <img src={p.image_url} alt={p.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
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
