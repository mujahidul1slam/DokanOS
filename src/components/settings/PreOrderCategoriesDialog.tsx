import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { logAction, logChange } from "@/lib/auditLog";
import {
  fetchPreOrderCategoriesFromDB,
  setPreOrderCategoryIds,
} from "@/lib/preOrderSettings";

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  store_id: string | null;
}
interface StoreRow { id: string; name: string }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface TreeNode extends CategoryRow {
  depth: number;
  children: TreeNode[];
}

function buildTree(cats: CategoryRow[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  cats.forEach((c) => map.set(c.id, { ...c, depth: 0, children: [] }));
  const roots: TreeNode[] = [];
  map.forEach((n) => {
    if (n.parent_id && map.has(n.parent_id)) {
      map.get(n.parent_id)!.children.push(n);
    } else {
      roots.push(n);
    }
  });
  const setDepth = (n: TreeNode, d: number) => {
    n.depth = d;
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach((c) => setDepth(c, d + 1));
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach((r) => setDepth(r, 0));
  return roots;
}
function flatten(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => { out.push(n); n.children.forEach(walk); };
  nodes.forEach(walk);
  return out;
}

const PreOrderCategoriesDialog = ({ open, onOpenChange }: Props) => {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [originalIds, setOriginalIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [{ data: cats }, { data: sts }] = await Promise.all([
        supabase.from("categories").select("id, name, parent_id, store_id").order("name"),
        supabase.from("stores").select("id, name").order("name"),
      ]);
      setCategories((cats || []) as CategoryRow[]);
      setStores((sts || []) as StoreRow[]);
      const dbIds = await fetchPreOrderCategoriesFromDB();
      const ids = dbIds || [];
      setSelected(new Set(ids));
      setOriginalIds(ids);
      setLoading(false);
    })();
  }, [open]);

  const grouped = useMemo(() => {
    const storeNameMap = new Map(stores.map((s) => [s.id, s.name]));
    const byStore = new Map<string, { storeName: string; cats: CategoryRow[] }>();
    categories.forEach((c) => {
      const key = c.store_id ?? "__none__";
      const storeName = c.store_id ? (storeNameMap.get(c.store_id) || "Unknown Store") : "Uncategorized";
      if (!byStore.has(key)) byStore.set(key, { storeName, cats: [] });
      byStore.get(key)!.cats.push(c);
    });
    const q = search.trim().toLowerCase();
    return Array.from(byStore.values())
      .map((g) => ({ ...g, tree: buildTree(g.cats) }))
      .map((g) => ({
        ...g,
        rows: flatten(g.tree).filter((n) => !q || n.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.rows.length > 0)
      .sort((a, b) => a.storeName.localeCompare(b.storeName));
  }, [categories, stores, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const ids = Array.from(selected);
    try {
      await setPreOrderCategoryIds(ids);
      // Resolve names for readable diff
      const nameMap = new Map(categories.map((c) => [c.id, c.name]));
      const beforeNames = originalIds.map((id) => nameMap.get(id) || id).sort();
      const afterNames = ids.map((id) => nameMap.get(id) || id).sort();
      await logChange("settings_preorder_categories", undefined,
        { categories: beforeNames, count: originalIds.length },
        { categories: afterNames, count: ids.length },
      );
      toast.success("Pre-Order categories saved");
      onOpenChange(false);
    } catch {
      toast.error("Pre-Order categories could not be saved");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pre-Order Categories</DialogTitle>
          <DialogDescription>
            Orders containing any product from a selected category will be treated as Pre-Orders.
            Selecting a parent category automatically includes its sub-categories.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search categories…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="rounded-md border max-h-[50vh] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-sm text-muted-foreground text-center">Loading…</div>
            ) : grouped.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">No categories found</div>
            ) : (
              grouped.map((group, gi) => (
                <div key={gi} className={gi > 0 ? "border-t" : ""}>
                  <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                    {group.storeName}
                  </div>
                  {group.rows.map((n) => (
                    <label
                      key={n.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm"
                      style={{ paddingLeft: `${12 + n.depth * 16}px` }}
                    >
                      <Checkbox checked={selected.has(n.id)} onCheckedChange={() => toggle(n.id)} />
                      {n.depth > 0 && <span className="text-muted-foreground/60">└</span>}
                      <span className="truncate">{n.name}</span>
                    </label>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{selected.size} selected</span>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PreOrderCategoriesDialog;
