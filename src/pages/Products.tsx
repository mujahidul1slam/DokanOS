import { useEffect, useState, useMemo } from "react";
import { Search, Plus, RefreshCw, MoreHorizontal, Pencil, Trash2, Image as ImageIcon } from "lucide-react";
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
  categoryNames?: string[];
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

const Products = () => {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [dbCategories, setDbCategories] = useState<{ id: string; name: string }[]>([]);

  const loadProducts = async () => {
    setLoading(true);

    // Load products
    const { data } = await supabase
      .from("products")
      .select("id, name, sku, category, image_url, stock_quantity, manage_stock, stock_status, price, is_active")
      .order("name");

    // Load product_categories with category names
    const { data: pcData } = await supabase
      .from("product_categories")
      .select("product_id, category_id");

    const { data: cats } = await supabase
      .from("categories")
      .select("id, name");

    setDbCategories(cats || []);

    const catNameMap = new Map((cats || []).map((c: any) => [c.id, c.name]));
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
    }));

    setProducts(enriched as ProductRow[]);
    setLoading(false);
  };

  useEffect(() => { loadProducts(); }, []);

  const categories = useMemo(() => {
    return dbCategories.map(c => c.name).sort();
  }, [dbCategories]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      const q = search.toLowerCase();
      const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q);
      const matchCategory = categoryFilter === "all" || (p.categoryNames || []).includes(categoryFilter);
      const matchStock = stockFilter === "all" || p.stock_status === stockFilter;
      return matchSearch && matchCategory && matchStock;
    });
  }, [products, search, categoryFilter, stockFilter]);

  const allSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(p => p.id)));
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

  const handleSyncCategories = async () => {
    toast({ title: "Syncing categories from WooCommerce…" });
    const { data: stores } = await supabase.from("stores").select("id").eq("status", "connected");
    if (stores) {
      for (const s of stores) {
        await supabase.functions.invoke("woo-sync", { body: { store_id: s.id } });
      }
    }
    await loadProducts();
    toast({ title: "Categories synced!" });
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Products</h1>
          <p className="text-sm text-muted-foreground">Central product catalog — {products.length} products</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSyncCategories}>
            <RefreshCw className="h-3.5 w-3.5" /> Sync Categories
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> Add New Product
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
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary">
              <th className="w-10 px-4 py-3"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Product</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Stock Status</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Stock Qty</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Price (BDT)</th>
              <th className="w-12 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No products found.</td></tr>
            )}
            {filtered.map(p => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/50 cursor-pointer" onClick={() => openEdit(p.id)}>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      )}
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
                      ? (p.categoryNames || []).map((c, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>
                        ))
                      : <span className="text-muted-foreground">—</span>
                    }
                  </div>
                </td>
                <td className="px-4 py-3">{stockBadge(p.stock_status)}</td>
                <td className="px-4 py-3 text-right font-mono text-foreground">
                  {p.manage_stock ? p.stock_quantity : "∞"}
                </td>
                <td className="px-4 py-3 text-right font-medium text-foreground">৳{Number(p.price).toLocaleString()}</td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(p.id)}>
                        <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(p.id)}>
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ProductDetailSheet
        productId={editProductId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={loadProducts}
      />
    </div>
  );
};

export default Products;
