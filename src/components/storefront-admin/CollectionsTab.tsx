import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import type { Storefront } from "./shared";

interface CollectionRow {
  id: string;
  storefront_id: string;
  slug: string;
  title: string;
  description: string | null;
  position: number;
  is_active: boolean;
}

interface JunctionRow {
  id: string;
  collection_id: string;
  product_id: string;
  position: number;
  product?: { id: string; name: string; price: number; image_url: string | null } | null;
}

/** Collections admin (Phase 2 / §5.4). */
export default function CollectionsTab({ sf }: { sf: Storefront }) {
  const [items, setItems] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CollectionRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CollectionRow | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("storefront_collections")
      .select("*")
      .eq("storefront_id", sf.id)
      .order("position", { ascending: true })
      .order("title", { ascending: true });
    setItems((data as unknown as CollectionRow[]) || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sf.id]);

  async function remove(c: CollectionRow) {
    setDeleteTarget(null);
    await supabase.from("storefront_collections").delete().eq("id", c.id);
    toast({ title: "Collection deleted" });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Collections</h3>
          <p className="text-xs text-muted-foreground">
            Group products for browsable shop tabs and the collection-grid section.
          </p>
        </div>
        <Button size="sm" className="gap-1" onClick={() => setEditing("new")}>
          <Plus className="h-3 w-3" /> New collection
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No collections yet.</p>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {items.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.title}</span>
                  <Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Active" : "Hidden"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  /collections/{c.slug}
                  {c.description ? ` · ${c.description}` : ""}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                Edit
              </Button>
              <Button size="icon" variant="ghost" className="text-destructive" aria-label="Delete collection" onClick={() => setDeleteTarget(c)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <CollectionDialog sf={sf} state={editing} onClose={() => setEditing(null)} onSaved={load} />

      {deleteTarget && (
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Delete “{deleteTarget.title}”?</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => remove(deleteTarget)}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CollectionDialog({
  sf,
  state,
  onClose,
  onSaved,
}: {
  sf: Storefront;
  state: CollectionRow | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = state !== null;
  const isNew = state === "new";
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [links, setLinks] = useState<JunctionRow[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isNew) {
      setTitle("");
      setSlug("");
      setDescription("");
      setIsActive(true);
      setLinks([]);
      return;
    }
    const c = state as CollectionRow;
    setTitle(c.title);
    setSlug(c.slug);
    setDescription(c.description || "");
    setIsActive(c.is_active);
    loadProducts(c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, sf.id]);

  async function loadProducts(collectionId: string) {
    setLoadingProducts(true);
    const { data: rows } = await supabase
      .from("storefront_collection_products")
      .select("*")
      .eq("collection_id", collectionId)
      .order("position", { ascending: true });
    const ids = (rows || []).map((r: any) => r.product_id);
    let prodMap = new Map<string, any>();
    if (ids.length) {
      const { data: prods } = await supabase.from("products").select("id,name,price,image_url").in("id", ids);
      prodMap = new Map((prods || []).map((p: any) => [p.id, p]));
    }
    setLinks((rows || []).map((r: any) => ({ ...r, product: prodMap.get(r.product_id) })));
    setLoadingProducts(false);
  }

  async function runSearch(q: string) {
    setSearch(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const existingIds = new Set(links.map((l) => l.product_id));
    const { data } = await supabase
      .from("products")
      .select("id,name,price,image_url,is_active")
      .ilike("name", `%${q}%`)
      .eq("is_active", true)
      .limit(15);
    setResults((data || []).filter((p: any) => !existingIds.has(p.id)));
  }

  async function save() {
    if (!title.trim() || !slug.trim()) return;
    setSaving(true);
    let collectionId: string | null = null;
    if (isNew) {
      const { data, error } = await supabase
        .from("storefront_collections")
        .insert({ storefront_id: sf.id, title: title.trim(), slug: slug.trim(), is_active: isActive })
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        toast({ title: "Could not create collection", description: error?.message, variant: "destructive" });
        return;
      }
      collectionId = (data as any).id;
    } else {
      const c = state as CollectionRow;
      const { error } = await supabase
        .from("storefront_collections")
        .update({ title: title.trim(), slug: slug.trim(), description: description.trim() || null, is_active: isActive })
        .eq("id", c.id);
      if (error) {
        setSaving(false);
        toast({ title: "Could not save collection", description: error.message, variant: "destructive" });
        return;
      }
      collectionId = c.id;
    }
    setSaving(false);
    toast({ title: isNew ? "Collection created" : "Collection saved" });
    onClose();
    onSaved();
  }

  async function addProduct(productId: string) {
    const cid = isNew ? null : (state as CollectionRow).id;
    if (!cid) return;
    const nextPos = links.length;
    const { error } = await supabase
      .from("storefront_collection_products")
      .insert({ collection_id: cid, product_id: productId, position: nextPos });
    if (error) {
      toast({ title: "Could not add product", description: error.message, variant: "destructive" });
      return;
    }
    setResults((r) => r.filter((p) => p.id !== productId));
    loadProducts(cid);
  }

  async function removeProduct(junc: JunctionRow) {
    await supabase.from("storefront_collection_products").delete().eq("id", junc.id);
    loadProducts(junc.collection_id);
  }

  async function moveProduct(junc: JunctionRow, dir: -1 | 1) {
    const idx = links.findIndex((x) => x.id === junc.id);
    const swap = links[idx + dir];
    if (!swap) return;
    await Promise.all([
      supabase.from("storefront_collection_products").update({ position: swap.position }).eq("id", junc.id),
      supabase.from("storefront_collection_products").update({ position: junc.position }).eq("id", swap.id),
    ]);
    loadProducts(junc.collection_id);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "New collection" : `Edit “${(state as CollectionRow)?.title}”`}</DialogTitle>
          <DialogDescription>Group products for a browsable shop tab.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer Edit" />
            </div>
            <div>
              <Label className="text-xs">Slug</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="summer-edit"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional short description" />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            Active (visible on shop/collection-grid)
          </label>

          {!isNew && (
            <>
              <div>
                <Label className="text-xs">Products</Label>
                <Input placeholder="Search products to add…" value={search} onChange={(e) => runSearch(e.target.value)} />
                {results.length > 0 && (
                  <div className="mt-2 border border-border rounded-lg divide-y divide-border max-h-40 overflow-auto">
                    {results.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 p-2">
                        <div className="flex-1 min-w-0 truncate text-sm">{p.name}</div>
                        <Button size="sm" onClick={() => addProduct(p.id)}>
                          <Plus className="h-3 w-3" /> Add
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                {loadingProducts ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : links.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No products yet.</p>
                ) : (
                  <div className="border border-border rounded-lg divide-y divide-border">
                    {links.map((j, idx) => (
                      <div key={j.id} className="flex items-center gap-3 p-2">
                        <div className="text-xs text-muted-foreground w-6 text-center">{idx + 1}</div>
                        <div className="flex-1 min-w-0 truncate text-sm">{j.product?.name || "(deleted product)"}</div>
                        <Button size="icon" variant="ghost" onClick={() => moveProduct(j, -1)} disabled={idx === 0} aria-label="Move up">
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => moveProduct(j, 1)} disabled={idx === links.length - 1} aria-label="Move down">
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" aria-label="Remove" onClick={() => removeProduct(j)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !title.trim() || !slug.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isNew ? "Create collection" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}