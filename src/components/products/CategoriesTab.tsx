import { useEffect, useState } from "react";
import { Plus, RefreshCw, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  store_id: string | null;
  woo_category_id: number | null;
  created_at: string;
}

interface Store {
  id: string;
  name: string;
  status: string;
}

const CategoriesTab = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // form state
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState<string>("none");
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());

  const loadData = async () => {
    setLoading(true);
    const [{ data: cats }, { data: storeData }] = await Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("stores").select("id, name, status"),
    ]);
    setCategories(cats || []);
    setStores(storeData || []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleSyncCategories = async () => {
    setSyncing(true);
    toast({ title: "Syncing categories from WooCommerce…" });
    const connected = stores.filter(s => s.status === "connected");
    for (const s of connected) {
      await supabase.functions.invoke("woo-sync", { body: { store_id: s.id } });
    }
    await loadData();
    setSyncing(false);
    toast({ title: "Categories synced!" });
  };

  const openNew = () => {
    setEditId(null);
    setName("");
    setSlug("");
    setParentId("none");
    setSelectedStores(new Set(stores.filter(s => s.status === "connected").map(s => s.id)));
    setDialogOpen(true);
  };

  const openEdit = (cat: Category) => {
    setEditId(cat.id);
    setName(cat.name);
    setSlug(cat.slug);
    setParentId(cat.parent_id || "none");
    setSelectedStores(cat.store_id ? new Set([cat.store_id]) : new Set());
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    const catSlug = slug.trim() || name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const parentVal = parentId === "none" ? null : parentId;

    // For each selected store, create/update category
    const storeIds = Array.from(selectedStores);
    if (storeIds.length === 0) storeIds.push(""); // at least save once with no store

    if (editId) {
      await supabase.from("categories").update({ name: name.trim(), slug: catSlug, parent_id: parentVal }).eq("id", editId);

      // Push to WooCommerce for connected stores
      for (const sid of storeIds) {
        if (sid) {
          try {
            await supabase.functions.invoke("woo-push", {
              body: { store_id: sid, type: "category", action: "update", payload: { name: name.trim(), slug: catSlug, parent_id: parentVal, category_id: editId } },
            });
          } catch { /* ignore push errors */ }
        }
      }
      toast({ title: "Category updated" });
    } else {
      // Create category for each selected store
      for (const sid of storeIds) {
        const insertData: any = { name: name.trim(), slug: catSlug, parent_id: parentVal };
        if (sid) insertData.store_id = sid;

        const { data: newCat } = await supabase.from("categories").insert(insertData).select().single();

        // Push to WooCommerce
        if (sid && newCat) {
          try {
            await supabase.functions.invoke("woo-push", {
              body: { store_id: sid, type: "category", action: "create", payload: { name: name.trim(), slug: catSlug, parent_id: parentVal, category_id: newCat.id } },
            });
          } catch { /* ignore push errors */ }
        }
      }
      toast({ title: "Category created" });
    }

    setSaving(false);
    setDialogOpen(false);
    loadData();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("product_categories").delete().eq("category_id", id);
    await supabase.from("categories").delete().eq("id", id);
    toast({ title: "Category deleted" });
    loadData();
  };

  const toggleStore = (id: string) => {
    setSelectedStores(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const getParentName = (parentId: string | null) => {
    if (!parentId) return null;
    return categories.find(c => c.id === parentId)?.name || null;
  };

  const getStoreName = (storeId: string | null) => {
    if (!storeId) return null;
    return stores.find(s => s.id === storeId)?.name || null;
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{categories.length} categories</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSyncCategories} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Sync Categories
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> Add Category
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slug</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Parent</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Store</th>
              <th className="w-12 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No categories found.</td></tr>
            )}
            {categories.map(cat => (
              <tr key={cat.id} className="border-b border-border last:border-0 hover:bg-secondary/50 cursor-pointer" onClick={() => openEdit(cat)}>
                <td className="px-4 py-3 font-medium text-foreground">{cat.name}</td>
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{cat.slug}</td>
                <td className="px-4 py-3">
                  {getParentName(cat.parent_id) ? (
                    <Badge variant="secondary" className="text-xs">{getParentName(cat.parent_id)}</Badge>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3">
                  {getStoreName(cat.store_id) ? (
                    <Badge variant="outline" className="text-xs">{getStoreName(cat.store_id)}</Badge>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(cat.id)} aria-label="Delete category">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Category Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Category" : "Add New Category"}</DialogTitle>
            <DialogDescription>
              {editId ? "Update category details." : "Create a new category and sync it to selected stores."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={name} onChange={e => { setName(e.target.value); if (!editId) setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")); }} placeholder="Category name" />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder="auto-generated" />
            </div>
            <div className="space-y-2">
              <Label>Parent Category</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Top-level)</SelectItem>
                  {categories.filter(c => c.id !== editId).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sync to Stores</Label>
              <div className="space-y-2 rounded-md border border-border p-3">
                {stores.filter(s => s.status === "connected").length === 0 && (
                  <p className="text-sm text-muted-foreground">No connected stores.</p>
                )}
                {stores.filter(s => s.status === "connected").map(s => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedStores.has(s.id)}
                      onCheckedChange={() => toggleStore(s.id)}
                    />
                    <span className="text-sm">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CategoriesTab;
