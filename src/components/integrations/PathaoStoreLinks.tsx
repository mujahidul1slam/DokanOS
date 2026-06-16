import { useEffect, useState } from "react";
import { Loader2, Link2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props {
  integrationId: string;
}

interface WooStore { id: string; name: string }
interface PathaoStore { pathao_store_id: number; store_name: string }
interface Link { id: string; woo_store_id: string; pathao_integration_id: string; default_pathao_store_id: number | null }

const PathaoStoreLinks = ({ integrationId }: Props) => {
  const [wooStores, setWooStores] = useState<WooStore[]>([]);
  const [pathaoStores, setPathaoStores] = useState<PathaoStore[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newWooStore, setNewWooStore] = useState("");
  const [newPathaoStore, setNewPathaoStore] = useState("");
  const { toast } = useToast();

  const load = async () => {
    const [{ data: woo }, { data: pathao }, { data: lk }] = await Promise.all([
      supabase.from("stores").select("id, name").order("name"),
      supabase.from("pathao_stores").select("pathao_store_id, store_name").eq("integration_id", integrationId).eq("is_active", true),
      supabase.from("pathao_store_links").select("*").eq("pathao_integration_id", integrationId),
    ]);
    setWooStores((woo || []) as WooStore[]);
    setPathaoStores((pathao || []) as PathaoStore[]);
    setLinks((lk || []) as Link[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [integrationId]);

  const linkedWooIds = new Set(links.map((l) => l.woo_store_id));
  const availableWoo = wooStores.filter((w) => !linkedWooIds.has(w.id));

  const handleAdd = async () => {
    if (!newWooStore) return;
    setSaving("new");
    const { error } = await supabase.from("pathao_store_links").insert({
      woo_store_id: newWooStore,
      pathao_integration_id: integrationId,
      default_pathao_store_id: newPathaoStore ? Number(newPathaoStore) : null,
    });
    setSaving(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Store linked" });
    setNewWooStore(""); setNewPathaoStore("");
    load();
  };

  const handleUpdateDefault = async (linkId: string, pathaoStoreId: string) => {
    setSaving(linkId);
    const { error } = await supabase.from("pathao_store_links")
      .update({ default_pathao_store_id: pathaoStoreId ? Number(pathaoStoreId) : null })
      .eq("id", linkId);
    setSaving(null);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const handleDelete = async (linkId: string) => {
    const { error } = await supabase.from("pathao_store_links").delete().eq("id", linkId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Link removed" });
    load();
  };

  const wooName = (id: string) => wooStores.find((w) => w.id === id)?.name || "Unknown";

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-heading text-lg font-semibold">Linked WooCommerce Stores</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Orders from these WooCommerce stores will be dispatched through this Pathao account by default.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading...
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {links.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No WooCommerce stores linked yet.</p>
            )}
            {links.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-md border border-border p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">{wooName(l.woo_store_id)}</p>
                  <p className="text-xs text-muted-foreground">WooCommerce Store</p>
                </div>
                <div className="w-[240px]">
                  <Select
                    value={l.default_pathao_store_id ? String(l.default_pathao_store_id) : ""}
                    onValueChange={(v) => handleUpdateDefault(l.id, v)}
                    disabled={saving === l.id}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Default Pathao merchant store" />
                    </SelectTrigger>
                    <SelectContent>
                      {pathaoStores.map((s) => (
                        <SelectItem key={s.pathao_store_id} value={String(s.pathao_store_id)}>
                          {s.store_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(l.id)} aria-label="Delete store link">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          {availableWoo.length > 0 && (
            <div className="flex items-end gap-3 rounded-md border border-dashed border-border p-3">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">WooCommerce Store</Label>
                <Select value={newWooStore} onValueChange={setNewWooStore}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>
                    {availableWoo.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">Default Pathao Store (optional)</Label>
                <Select value={newPathaoStore} onValueChange={setNewPathaoStore}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Pick later" /></SelectTrigger>
                  <SelectContent>
                    {pathaoStores.map((s) => (
                      <SelectItem key={s.pathao_store_id} value={String(s.pathao_store_id)}>
                        {s.store_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={handleAdd} disabled={!newWooStore || saving === "new"}>
                {saving === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null} Link
              </Button>
            </div>
          )}

          {pathaoStores.length === 0 && (
            <p className="text-xs text-warning-foreground bg-warning/15 rounded px-2 py-1.5">
              Refresh location data above to load this account's Pathao merchant stores first.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default PathaoStoreLinks;
