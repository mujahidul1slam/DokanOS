import { useEffect, useState, useMemo } from "react";
import { Search, Plus, RefreshCw, MoreHorizontal, Pencil, Trash2, Image as ImageIcon, ChevronLeft, ChevronRight, PackageCheck, PackageX, Eye, EyeOff, Tags, AlertTriangle, Download, Star, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import ProductDetailSheet from "@/components/products/ProductDetailSheet";
import { TableSkeleton } from "@/components/ui/loading-states";
import { downloadCsv } from "@/lib/exportCsv";
import { format } from "date-fns";
import CategoryFilter from "@/components/CategoryFilter";
import { useDebounce } from "@/hooks/useDebounce";

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
  is_featured: boolean;
  sales_count: number;
  categoryNames?: string[];
  storeName?: string;
}

interface CategoryNode {
  id: string;
  name: string;
  parent_id: string | null;
  children: CategoryNode[];
}

const normalizeStockStatus = (status: string) => {
  const map: Record<string, string> = {
    instock: "in_stock", outofstock: "out_of_stock", onbackorder: "on_backorder",
    in_stock: "in_stock", out_of_stock: "out_of_stock", on_backorder: "on_backorder",
  };
  return map[status] || status;
};

const stockBadge = (status: string) => {
  const normalized = normalizeStockStatus(status);
  switch (normalized) {
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

const MANAGE_STOCK_FILTER_OPTIONS = [
  { value: "all", label: "All Stock Tracking" },
  { value: "tracked", label: "Stock Added" },
  { value: "untracked", label: "No Stock Added" },
];

const PAGE_SIZE = 200;

function buildCategoryTree(categories: { id: string; name: string; parent_id: string | null }[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  categories.forEach(c => map.set(c.id, { ...c, children: [] }));
  const roots: CategoryNode[] = [];
  map.forEach(node => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(r => r.children.sort((a, b) => a.name.localeCompare(b.name)));
  return roots;
}

function flattenCategoryTree(nodes: CategoryNode[], depth = 0): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth });
    result.push(...flattenCategoryTree(node.children, depth + 1));
  }
  return result;
}

const ProductList = () => {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [manageStockFilter, setManageStockFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const [featuredFilter, setFeaturedFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [dbCategories, setDbCategories] = useState<{ id: string; name: string; parent_id: string | null; store_id: string | null }[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(1);

  // Bulk action state
  const [bulkBusy, setBulkBusy] = useState(false);
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [selectedBulkCats, setSelectedBulkCats] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const loadProducts = async () => {
    setLoading(true);

    const [{ data }, { data: pcData }, { data: cats }, { data: storeData }] = await Promise.all([
      supabase.from("products").select("id, name, sku, category, image_url, stock_quantity, manage_stock, stock_status, price, is_active, store_id, is_featured, sales_count").order("name"),
      supabase.from("product_categories").select("product_id, category_id"),
      supabase.from("categories").select("id, name, parent_id, store_id"),
      supabase.from("stores").select("id, name"),
    ]);

    setDbCategories((cats || []) as any);
    setStores(storeData || []);

    const catNameMap = new Map((cats || []).map((c: any) => [c.id, c.name]));
    const storeNameMap = new Map((storeData || []).map((s: any) => [s.id, s.name]));
    const productCatMap = new Map<string, string[]>();
    const productCatIdMap = new Map<string, Set<string>>();
    for (const pc of pcData || []) {
      const names = productCatMap.get(pc.product_id) || [];
      const catName = catNameMap.get(pc.category_id);
      if (catName) names.push(catName);
      productCatMap.set(pc.product_id, names);

      if (!productCatIdMap.has(pc.product_id)) productCatIdMap.set(pc.product_id, new Set());
      productCatIdMap.get(pc.product_id)!.add(pc.category_id);
    }
    setProductCatIdMap(productCatIdMap);

    const enriched = (data || []).map((p: any) => ({
      ...p,
      categoryNames: productCatMap.get(p.id) || (p.category ? [p.category] : []),
      storeName: p.store_id ? storeNameMap.get(p.store_id) || "Unknown" : "—",
    }));

    setProducts(enriched as ProductRow[]);
    setLoading(false);
  };

  useEffect(() => { loadProducts(); }, []);

  const scopedDbCategories = useMemo(
    () => storeFilter === "all" ? dbCategories : dbCategories.filter(c => c.store_id === storeFilter),
    [dbCategories, storeFilter]
  );
  const categoryTree = useMemo(() => buildCategoryTree(scopedDbCategories), [scopedDbCategories]);
  const flatCategories = useMemo(() => flattenCategoryTree(categoryTree), [categoryTree]);

  // Map product -> set of category IDs (used for filtering by ID)
  const [productCatIdMap, setProductCatIdMap] = useState<Map<string, Set<string>>>(new Map());

  const debouncedSearch = useDebounce(search, 200);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return products.filter(p => {
      if (q) {
        const hit = p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (categoryFilter !== "all" && !(productCatIdMap.get(p.id)?.has(categoryFilter) ?? false)) return false;
      if (stockFilter !== "all" && p.stock_status !== stockFilter) return false;
      if (manageStockFilter === "tracked" && !p.manage_stock) return false;
      if (manageStockFilter === "untracked" && p.manage_stock) return false;
      if (storeFilter !== "all" && p.store_id !== storeFilter) return false;
      if (featuredFilter === "featured" && !p.is_featured) return false;
      if (featuredFilter === "not_featured" && p.is_featured) return false;
      return true;
    });
  }, [products, debouncedSearch, categoryFilter, stockFilter, manageStockFilter, storeFilter, featuredFilter, productCatIdMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  useEffect(() => { setPage(1); }, [debouncedSearch, categoryFilter, stockFilter, manageStockFilter, storeFilter, featuredFilter]);

  const allSelected = paginated.length > 0 && paginated.every(p => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(paginated.map(p => p.id)));
  };
  const toggleOne = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const selectAllFiltered = () => setSelected(new Set(filtered.map(p => p.id)));

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

  /* ====== BULK ACTIONS ====== */
  const selectedIds = Array.from(selected);
  const selectedCount = selectedIds.length;

  const bulkSetStockStatus = async (status: string) => {
    if (selectedCount === 0) return;
    setBulkBusy(true);
    try {
      for (const id of selectedIds) {
        await supabase.from("products").update({ stock_status: status }).eq("id", id);
        await supabase.from("product_variations").update({ stock_status: status }).eq("product_id", id);
      }
      const { data: linkedProducts } = await supabase.from("products").select("id, woo_product_id, store_id").in("id", selectedIds).not("woo_product_id", "is", null);
      if (linkedProducts) {
        for (const prod of linkedProducts) {
          if (prod.store_id) {
            try { await supabase.functions.invoke("woo-push", { body: { action: "push_stock", product_id: prod.id } }); } catch {}
          }
        }
      }
      toast({ title: `${selectedCount} products updated to ${status.replace(/_/g, " ")}` });
      setSelected(new Set());
      await loadProducts();
    } finally { setBulkBusy(false); }
  };

  const bulkSetActive = async (isActive: boolean) => {
    if (selectedCount === 0) return;
    setBulkBusy(true);
    try {
      for (const id of selectedIds) { await supabase.from("products").update({ is_active: isActive }).eq("id", id); }
      const { data: linkedProducts } = await supabase.from("products").select("id, woo_product_id, store_id").in("id", selectedIds).not("woo_product_id", "is", null);
      if (linkedProducts) {
        for (const prod of linkedProducts) {
          if (prod.store_id) {
            try { await supabase.functions.invoke("woo-push", { body: { action: "push_product", product_id: prod.id } }); } catch {}
          }
        }
      }
      toast({ title: `${selectedCount} products ${isActive ? "activated" : "deactivated"}` });
      setSelected(new Set());
      await loadProducts();
    } finally { setBulkBusy(false); }
  };

  const bulkDelete = async () => {
    if (selectedCount === 0) return;
    setBulkBusy(true);
    try {
      for (const id of selectedIds) {
        await supabase.from("product_categories").delete().eq("product_id", id);
        await supabase.from("product_variations").delete().eq("product_id", id);
        await supabase.from("products").delete().eq("id", id);
      }
      toast({ title: `${selectedCount} products deleted` });
      setSelected(new Set());
      setDeleteDialogOpen(false);
      await loadProducts();
    } finally { setBulkBusy(false); }
  };

  const openCatDialog = () => { setSelectedBulkCats(new Set()); setCatDialogOpen(true); };
  const toggleBulkCat = (id: string) => {
    setSelectedBulkCats(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const bulkAssignCategories = async () => {
    if (selectedCount === 0 || selectedBulkCats.size === 0) return;
    setBulkBusy(true);
    try {
      for (const productId of selectedIds) {
        await supabase.from("product_categories").delete().eq("product_id", productId);
        const rows = Array.from(selectedBulkCats).map(catId => ({ product_id: productId, category_id: catId }));
        await supabase.from("product_categories").insert(rows);
        const catNames = dbCategories.filter(c => selectedBulkCats.has(c.id)).map(c => c.name);
        await supabase.from("products").update({ category: catNames.join(", ") }).eq("id", productId);
      }
      toast({ title: `Categories assigned to ${selectedCount} products` });
      setSelected(new Set());
      setCatDialogOpen(false);
      await loadProducts();
    } finally { setBulkBusy(false); }
  };

  const bulkSetFeatured = async (featured: boolean) => {
    if (selectedCount === 0) return;
    setBulkBusy(true);
    try {
      for (const id of selectedIds) { await supabase.from("products").update({ is_featured: featured } as any).eq("id", id); }
      toast({ title: `${selectedCount} products ${featured ? "marked as featured" : "unmarked"}` });
      setSelected(new Set());
      await loadProducts();
    } finally { setBulkBusy(false); }
  };

  if (loading) return <TableSkeleton rows={10} cols={7} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{filtered.length} products</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
            const headers = ["Name", "SKU", "Category", "Price", "Stock", "Stock Status", "Store", "Active"];
            const rows = filtered.map((p) => [
              p.name, p.sku || "", p.category || "", String(p.price),
              String(p.stock_quantity), p.stock_status, p.storeName || "", p.is_active ? "Yes" : "No",
            ]);
            downloadCsv(`products-${format(new Date(), "yyyy-MM-dd")}.csv`, headers, rows);
          }}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSyncProducts} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Sync Products
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> Add Product
          </Button>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">{selectedCount} selected</span>
          {selectedCount < filtered.length && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={selectAllFiltered}>
              Select all {filtered.length}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8" disabled={bulkBusy}>
                  <PackageCheck className="h-3.5 w-3.5" /> Stock Status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => bulkSetStockStatus("in_stock")}>
                  <Badge className="bg-success/15 text-success border-0 mr-2">●</Badge> In Stock
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkSetStockStatus("out_of_stock")}>
                  <Badge className="bg-destructive/15 text-destructive border-0 mr-2">●</Badge> Out of Stock
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkSetStockStatus("on_backorder")}>
                  <Badge className="bg-warning/15 text-warning border-0 mr-2">●</Badge> On Backorder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="outline" size="sm" className="gap-1.5 h-8" disabled={bulkBusy} onClick={openCatDialog}>
              <Tags className="h-3.5 w-3.5" /> Categories
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8" disabled={bulkBusy}>
                  <Eye className="h-3.5 w-3.5" /> Status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => bulkSetActive(true)}><Eye className="h-3.5 w-3.5 mr-2" /> Activate</DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkSetActive(false)}><EyeOff className="h-3.5 w-3.5 mr-2" /> Deactivate</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8" disabled={bulkBusy}>
                  <Star className="h-3.5 w-3.5" /> Featured
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => bulkSetFeatured(true)}>
                  <Star className="h-3.5 w-3.5 mr-2 fill-yellow-400 text-yellow-400" /> Mark Featured
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkSetFeatured(false)}>
                  <Star className="h-3.5 w-3.5 mr-2" /> Unmark Featured
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline" size="sm"
              className="gap-1.5 h-8 text-destructive hover:bg-destructive/10 border-destructive/30"
              disabled={bulkBusy} onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>

            <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or SKU…" className="pl-9" />
        </div>
        <CategoryFilter
          mode="single"
          categories={dbCategories}
          stores={stores}
          storeFilter={storeFilter}
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholder="All Categories"
          className="w-[200px] justify-start"
        />
        <Select value={stockFilter} onValueChange={setStockFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Stock Status" /></SelectTrigger>
          <SelectContent>
            {STOCK_FILTER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={manageStockFilter} onValueChange={setManageStockFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Stock Tracking" /></SelectTrigger>
          <SelectContent>
            {MANAGE_STOCK_FILTER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={storeFilter} onValueChange={setStoreFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Store" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stores</SelectItem>
            {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={featuredFilter} onValueChange={setFeaturedFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Featured" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            <SelectItem value="featured">⭐ Featured</SelectItem>
            <SelectItem value="not_featured">Not Featured</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {paginated.length === 0 && (
          <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">No products found.</div>
        )}
        {paginated.map(p => (
          <div
            key={p.id}
            onClick={() => openEdit(p.id)}
            className={`rounded-lg border border-border bg-card p-3 active:bg-accent/50 transition-colors ${selected.has(p.id) ? "border-primary bg-primary/5" : ""}`}
          >
            <div className="flex items-start gap-3">
              <div onClick={e => e.stopPropagation()} className="pt-1">
                <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} className="h-5 w-5" />
              </div>
              <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-foreground truncate flex items-center gap-1.5">
                    {p.name}
                    {p.is_featured && <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400 shrink-0" />}
                  </div>
                  <div className="font-semibold text-foreground whitespace-nowrap">৳{Number(p.price).toLocaleString()}</div>
                </div>
                <div className="text-[11px] font-mono text-muted-foreground">{p.sku || "—"} · {p.storeName}</div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {stockBadge(p.stock_status)}
                    <span className="text-xs text-muted-foreground">Qty: {p.manage_stock ? p.stock_quantity : "∞"}</span>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Product actions"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(p.id)}><Pencil className="h-3.5 w-3.5 mr-2" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={async () => {
                          await supabase.from("products").update({ is_featured: !p.is_featured }).eq("id", p.id);
                          toast({ title: p.is_featured ? "Removed from featured" : "Marked as featured" });
                          loadProducts();
                        }}>
                          <Star className={`h-3.5 w-3.5 mr-2 ${p.is_featured ? "fill-yellow-400 text-yellow-400" : ""}`} />
                          {p.is_featured ? "Unmark Featured" : "Mark Featured"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-3.5 w-3.5 mr-2" /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-hidden rounded-lg border border-border">
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
              <tr key={p.id} className={`virtual-row border-b border-border last:border-0 hover:bg-secondary/50 cursor-pointer ${selected.has(p.id) ? "bg-primary/5" : ""}`} onClick={() => openEdit(p.id)}>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center overflow-hidden shrink-0 relative">
                      {p.image_url ? (
                        <>
                          <img
                            src={p.image_url}
                            alt={p.name}
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            onError={(e) => {
                              const img = e.currentTarget;
                              img.style.display = "none";
                              const fb = img.nextElementSibling as HTMLElement | null;
                              if (fb) fb.style.display = "flex";
                            }}
                          />
                          <span className="hidden absolute inset-0 items-center justify-center bg-muted">
                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          </span>
                        </>
                      ) : (
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-foreground truncate">{p.name}</p>
                        {p.is_featured && <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400 shrink-0" />}
                      </div>
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
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Product actions"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(p.id)}><Pencil className="h-3.5 w-3.5 mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={async () => {
                        await supabase.from("products").update({ is_featured: !p.is_featured }).eq("id", p.id);
                        toast({ title: p.is_featured ? "Removed from featured" : "Marked as featured" });
                        loadProducts();
                      }}>
                        <Star className={`h-3.5 w-3.5 mr-2 ${p.is_featured ? "fill-yellow-400 text-yellow-400" : ""}`} />
                        {p.is_featured ? "Unmark Featured" : "Mark Featured"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
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
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">
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
                <Button key={p} variant={p === currentPage ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setPage(p)} aria-label={`Go to page ${p}`} aria-current={p === currentPage ? "page" : undefined}>
                  {p}
                </Button>
              )
            )}
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ProductDetailSheet productId={editProductId} open={sheetOpen} onOpenChange={setSheetOpen} onSaved={loadProducts} />

      {/* Bulk Category Dialog */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Categories to {selectedCount} Products</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Select the categories to assign. This will replace existing categories on the selected products.</p>
          <div className="rounded-lg border border-border p-3 space-y-1 max-h-64 overflow-y-auto">
            {dbCategories.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No categories found.</p>
            )}
            {flatCategories.map(c => (
              <label key={c.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/50 cursor-pointer" style={{ paddingLeft: `${8 + c.depth * 16}px` }}>
                <Checkbox checked={selectedBulkCats.has(c.id)} onCheckedChange={() => toggleBulkCat(c.id)} />
                <span className="text-sm text-foreground">
                  {c.depth > 0 && <span className="text-muted-foreground mr-1">└</span>}
                  {c.name}
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
            <Button onClick={bulkAssignCategories} disabled={bulkBusy || selectedBulkCats.size === 0}>
              {bulkBusy ? "Assigning…" : `Assign to ${selectedCount} Products`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Delete {selectedCount} Products?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete {selectedCount} product{selectedCount > 1 ? "s" : ""} and their variations. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={bulkDelete} disabled={bulkBusy}>
              {bulkBusy ? "Deleting…" : `Delete ${selectedCount} Products`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProductList;
