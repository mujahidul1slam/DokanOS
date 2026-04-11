import { useEffect, useState, useMemo } from "react";
import { Search, Plus, RefreshCw, MoreHorizontal, Pencil, Trash2, Image as ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import ProductDetailSheet from "@/components/products/ProductDetailSheet";

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  image_url: string | null;
  stock_quantity: number;
  manage_stock: boolean;
  stock_status: string;
  price: number;
  is_active: boolean;
  store_id: string | null;
  categoryNames?: string[];
  storeName?: string;
}

const stockBadge = (status: string) => {
  switch (status) {
    case "in_stock": return <Badge className="bg-success/15 text-success border-0 hover:bg-success/25">In Stock</Badge>;
    case "out_of_stock": return <Badge className="bg-destructive/15 text-destructive border-0 hover:bg-destructive/25">Out of Stock</Badge>;
    case "on_backorder": return <Badge className="bg-warning/15 text-warning border-0 hover:bg-warning/25">On Backorder</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
};

const STOCK_FILTER_OPTIONS = [
  { value: "all", label: "All Stock" },
  { value: "in_stock", label: "In Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
  { value: "on_backorder", label: "On Backorder" },
];

const PAGE_SIZE = 20;

const ProductList = () => {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [dbCategories, setDbCategories] = useState<{ id: string; name: string }[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(1);

  const loadProducts = async () => {
    setLoading(true);

    const [{ data }, { data: pcData }, { data: cats }, { data: storeData }] = await Promise.all([
      supabase.from("products").select("id, name, sku, category, image_url, stock_quantity, manage_stock, stock_status, price, is_active, store_id").order("name"),
      supabase.from("product_categories").select("product_id, category_id"),
      supabase.from("categories").select("id, name"),
      supabase.from("stores").select("id, name"),
    ]);

    setDbCategories(cats || []);
    setStores(storeData || []);

    const catNameMap = new Map((cats || []).map((c: any) => [c.id, c.name]));
    const storeNameMap = new Map((storeData || []).map((s: any) => [s.id, s.name]));
    const productCatMap = new Map<string, string[]>();
    for (const pc of pcData || []) {
      const names = productCatMap.get(pc.product_id) || [];
      const catName = catNameMap.get(pc.category_id);
      if (catName) names.push(catName);
      productCatMap.set(pc.product_id, names);
    }

    const enriched = (data || []).map((p: any) => ({
      ...p,
      categoryNames: productCatMap.get(p.id) || (p.category ? [p.category] : []),
      storeName: p.store_id ? storeNameMap.get(p.store_id) || "Unknown" : "—",
    }));

    setProducts(enriched as ProductRow[]);
    setLoading(false);
  };

  useEffect(() => { loadProducts(); }, []);

  const categories = useMemo(() => dbCategories.map(c => c.name).sort(), [dbCategories]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      const q = search.toLowerCase();
      const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q);
      const matchCategory = categoryFilter === "all" || (p.categoryNames || []).includes(categoryFilter);
      const matchStock = stockFilter === "all" || p.stock_status === stockFilter;
      const matchStore = storeFilter === "all" || p.store_id === storeFilter;
      return matchSearch && matchCategory && matchStock && matchStore;
    });
  }, [products, search, categoryFilter, stockFilter, storeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, categoryFilter, stockFilter, storeFilter]);

  const allSelected = paginated.length > 0 && paginated.every(p => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(paginated.map(p => p.id)));
  };
  const toggleOne = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const openNew = () => { setEditProductId(null); setSheetOpen(true); };
  const openEdit = (id: string) => { setEditProductId(id); setSheetOpen(true); };

  const handleDelete = async (id: string) => {
    await supabase.from("product_categories").delete().eq("product_id", id);
    await supabase.from("product_variations").delete().eq("product_id", id);
    await supabase.from("products").delete().eq("id", id);
    toast({ title: "Product deleted" });
    loadProducts();
  };

  const handleSyncProducts = async () => {
    setSyncing(true);
    toast({ title: "Syncing products from WooCommerce…" });
    const { data: connectedStores } = await supabase.from("stores").select("id").eq("status", "connected");
    if (connectedStores) {
      for (const s of connectedStores) {
        await supabase.functions.invoke("woo-sync", { body: { store_id: s.id } });
      }
    }
    await loadProducts();
    setSyncing(false);
    toast({ title: "Products synced!" });
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{filtered.length} products</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSyncProducts} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Sync Products
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> Add Product
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or SKU…" className="pl-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={setStockFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Stock Status" /></SelectTrigger>
          <SelectContent>
            {STOCK_FILTER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Store" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
            {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary">
              <th className="w-10 px-4 py-3"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Product</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Store</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Stock Status</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Stock Qty</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Price (BDT)</th>
              <th className="w-12 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No products found.</td></tr>
            )}
            {paginated.map(p => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/50 cursor-pointer" onClick={() => openEdit(p.id)}>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{p.name}</p>
                      <p className="text-xs font-mono text-muted-foreground">{p.sku || "—"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(p.categoryNames || []).length > 0
                      ? (p.categoryNames || []).map((c, i) => <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>)
                      : <span className="text-muted-foreground">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-foreground">{p.storeName}</td>
                <td className="px-4 py-3">{stockBadge(p.stock_status)}</td>
                <td className="px-4 py-3 text-right font-mono text-foreground">{p.manage_stock ? p.stock_quantity : "∞"}</td>
                <td className="px-4 py-3 text-right font-medium text-foreground">৳{Number(p.price).toLocaleString()}</td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(p.id)}><Pencil className="h-3.5 w-3.5 mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-3.5 w-3.5 mr-2" /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
            .reduce<(number | "…")[]>((acc, p, idx, arr) => {
              if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              p === "…" ? (
                <span key={`e${i}`} className="px-2 text-muted-foreground">…</span>
              ) : (
                <Button key={p} variant={p === currentPage ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setPage(p)}>
                  {p}
                </Button>
              )
            )}
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ProductDetailSheet productId={editProductId} open={sheetOpen} onOpenChange={setSheetOpen} onSaved={loadProducts} />
    </div>
  );
};

export default ProductList;
