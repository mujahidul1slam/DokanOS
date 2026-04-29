import { Hourglass } from "lucide-react";
import PreOrderCategoriesDialog from "./PreOrderCategoriesDialog";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  usePreOrderCategoryIds,
  expandWithDescendants,
} from "@/lib/preOrderSettings";

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  store_id: string | null;
}
interface StoreRow { id: string; name: string }

const PreOrdersSettingsTab = () => {
  const ids = usePreOrderCategoryIds();
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: cats }, { data: sts }] = await Promise.all([
        supabase.from("categories").select("id, name, parent_id, store_id"),
        supabase.from("stores").select("id, name"),
      ]);
      setCategories((cats || []) as CategoryRow[]);
      setStores((sts || []) as StoreRow[]);
    })();
  }, [open]);

  const expanded = expandWithDescendants(ids, categories);
  const directLabels = categories
    .filter((c) => ids.has(c.id))
    .map((c) => {
      const storeName = c.store_id ? (stores.find((s) => s.id === c.store_id)?.name || "Unknown Store") : "Uncategorized";
      return { id: c.id, name: c.name, storeName };
    })
    .sort((a, b) => a.storeName.localeCompare(b.storeName) || a.name.localeCompare(b.name));

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold mb-1 flex items-center gap-2">
          <Hourglass className="h-4 w-4" /> Pre-Order Categories
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose which product categories trigger an order to be flagged as a Pre-Order.
          Any order containing at least one product from these categories (or their sub-categories)
          will appear under the Pre-Orders screen instead of New Orders.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {ids.size === 0
                ? "No categories selected"
                : `${ids.size} ${ids.size === 1 ? "category" : "categories"} selected`}
            </p>
            <p className="text-xs text-muted-foreground">
              {ids.size === 0
                ? "Pre-Orders will only contain orders manually set to a Pre-Order status."
                : `${expanded.size} total categories included (with sub-categories).`}
            </p>
          </div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            {ids.size === 0 ? "Select Categories" : "Edit"}
          </Button>
        </div>

        {directLabels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2 border-t">
            {directLabels.map((c) => (
              <Badge key={c.id} variant="secondary" className="text-xs">
                <span className="text-muted-foreground mr-1">{c.storeName}:</span>{c.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <PreOrderCategoriesDialog open={open} onOpenChange={setOpen} />
    </div>
  );
};

export default PreOrdersSettingsTab;
