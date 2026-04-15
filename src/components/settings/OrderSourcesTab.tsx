import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Source {
  id: string;
  name: string;
  is_default: boolean;
  sort_order: number;
}

const OrderSourcesTab = () => {
  const [sources, setSources] = useState<Source[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchSources = async () => {
    const { data } = await supabase.from("order_sources").select("*").order("sort_order");
    setSources((data || []) as Source[]);
    setLoading(false);
  };

  useEffect(() => { fetchSources(); }, []);

  const handleAdd = async () => {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    if (sources.some(s => s.name === name)) { toast.error("Source already exists"); return; }
    const { error } = await supabase.from("order_sources").insert({ name, sort_order: sources.length + 1 });
    if (error) toast.error(error.message);
    else { toast.success("Source added"); setNewName(""); fetchSources(); }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("order_sources").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Source removed"); fetchSources(); }
  };

  const handleRename = async (id: string, name: string) => {
    await supabase.from("order_sources").update({ name: name.toLowerCase() }).eq("id", id);
    fetchSources();
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-6">
      <div>
        <h2 className="font-heading text-lg font-semibold mb-1">Order Sources</h2>
        <p className="text-sm text-muted-foreground">Manage where orders can come from. These appear in the Add Order dialog.</p>
      </div>

      <div className="space-y-2">
        {sources.map(s => (
          <div key={s.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              defaultValue={s.name}
              onBlur={(e) => { if (e.target.value !== s.name) handleRename(s.id, e.target.value); }}
              className="h-8 flex-1 capitalize"
            />
            {s.is_default && <Badge variant="secondary" className="text-xs shrink-0">Default</Badge>}
            {!s.is_default && (
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleDelete(s.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New source name..."
          className="flex-1"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <Button onClick={handleAdd} size="sm" disabled={!newName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Add Source
        </Button>
      </div>
    </div>
  );
};

export default OrderSourcesTab;
