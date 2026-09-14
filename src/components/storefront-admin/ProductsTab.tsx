import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/useCurrency";
import { ChevronDown, ChevronUp, Loader2, Plus, Star, Trash2 } from "lucide-react";
import type { Storefront } from "./shared";

interface SfProduct {
  id: string;
  product_id: string;
  position: number;
  is_featured: boolean;
  badge: string | null;
  product?: { id: string; name: string; price: number; image_url: string | null; stock_quantity: number };
}

/** Manual product curation (refactor of the old ProductCuration — no behavior change). */
export default function ProductsTab({ sf }: { sf: Storefront }) {
  return <ProductCuration storefrontId={sf.id} />;
}

function ProductCuration({ storefrontId }: { storefrontId: string }) {
  const { symbol } = useCurrency();
  const [items, setItems] = useState<SfProduct[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: links } = await supabase
      .from("storefront_products")
      .select("*")
      .eq("storefront_id", storefrontId)
      .order("position");
    const ids = (links || []).map((l: any) => l.product_id);
    let prodMap = new Map<string, any>();
    if (ids.length) {
      const { data: prods } = await supabase
        .from("products")
        .select("id,name,price,image_url,stock_quantity")
        .in("id", ids);
      prodMap = new Map((prods || []).map((p: any) => [p.id, p]));
    }
    setItems((links || []).map((l: any) => ({ ...l, product: prodMap.get(l.product_id) })));
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storefrontId]);

  async function runSearch(q: string) {
    setSearch(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const existingIds = new Set(items.map((i) => i.product_id));
    const { data } = await supabase
      .from("products")
      .select("id,name,price,image_url,stock_quantity,is_active")
      .ilike("name", `%${q}%`)
      .eq("is_active", true)
      .limit(15);
    setResults((data || []).filter((p: any) => !existingIds.has(p.id)));
  }

  async function add(productId: string) {
    const nextPos = items.length;
    await supabase.from("storefront_products").insert({
      storefront_id: storefrontId,
      product_id: productId,
      position: nextPos,
    });
    setResults((r) => r.filter((p) => p.id !== productId));
    load();
  }

  async function remove(id: string) {
    await supabase.from("storefront_products").delete().eq("id", id);
    load();
  }

  async function toggleFeatured(it: SfProduct) {
    await supabase.from("storefront_products").update({ is_featured: !it.is_featured }).eq("id", it.id);
    load();
  }

  async function move(it: SfProduct, dir: -1 | 1) {
    const idx = items.findIndex((i) => i.id === it.id);
    const swap = items[idx + dir];
    if (!swap) return;
    await Promise.all([
      supabase.from("storefront_products").update({ position: swap.position }).eq("id", it.id),
      supabase.from("storefront_products").update({ position: it.position }).eq("id", swap.id),
    ]);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-xs">Add a product</Label>
        <Input placeholder="Search products by name…" value={search} onChange={(e) => runSearch(e.target.value)} />
        {results.length > 0 && (
          <div className="mt-2 border border-border rounded-lg divide-y divide-border max-h-64 overflow-auto">
            {results.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-2 hover:bg-muted/50">
                <div className="h-10 w-10 bg-muted rounded overflow-hidden flex-shrink-0">
                  {p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {symbol}
                    {p.price} · stock {p.stock_quantity}
                  </div>
                </div>
                <Button size="sm" onClick={() => add(p.id)} className="gap-1">
                  <Plus className="h-3 w-3" /> Add
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Curated products ({items.length})</h3>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products yet. Search above to add some.</p>
        ) : (
          <div className="border border-border rounded-lg divide-y divide-border">
            {items.map((it, idx) => (
              <div key={it.id} className="flex items-center gap-3 p-3">
                <div className="text-xs text-muted-foreground w-6 text-center">{idx + 1}</div>
                <div className="h-12 w-12 bg-muted rounded overflow-hidden flex-shrink-0">
                  {it.product?.image_url && <img src={it.product.image_url} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{it.product?.name || "(deleted product)"}</div>
                  <div className="text-xs text-muted-foreground">
                    {symbol}
                    {it.product?.price ?? "—"}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => move(it, -1)} disabled={idx === 0} aria-label="Move up">
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => move(it, 1)} disabled={idx === items.length - 1} aria-label="Move down">
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant={it.is_featured ? "default" : "ghost"}
                  onClick={() => toggleFeatured(it)}
                  title="Toggle featured"
                  aria-label="Toggle featured"
                >
                  <Star className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(it.id)} className="text-destructive" aria-label="Remove item">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

