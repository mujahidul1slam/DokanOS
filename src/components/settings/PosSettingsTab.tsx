import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { logAction } from "@/lib/auditLog";

interface StoreRow {
  id: string;
  name: string;
  pos_order_prefix: string;
  pos_order_suffix: string;
}

const PosSettingsTab = () => {
  const [shippingPresets, setShippingPresets] = useState<number[]>([80, 150]);
  const [defaultPrefix, setDefaultPrefix] = useState("");
  const [defaultSuffix, setDefaultSuffix] = useState("");
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("invoice_settings" as any)
      .select("id, shipping_presets, pos_order_prefix, pos_order_suffix")
      .limit(1)
      .single()
      .then(({ data }: any) => {
        if (data) {
          setSettingsId(data.id);
          setShippingPresets(data.shipping_presets || [80, 150]);
          setDefaultPrefix(data.pos_order_prefix || "");
          setDefaultSuffix(data.pos_order_suffix || "");
        }
      });

    supabase
      .from("stores" as any)
      .select("id, name, pos_order_prefix, pos_order_suffix")
      .order("name")
      .then(({ data }: any) => {
        if (data) setStores(data as StoreRow[]);
      });
  }, []);

  const handleSave = async () => {
    if (!settingsId) return;
    setSaving(true);
    const { error } = await supabase
      .from("invoice_settings" as any)
      .update({
        shipping_presets: shippingPresets,
        pos_order_prefix: defaultPrefix,
        pos_order_suffix: defaultSuffix,
      } as any)
      .eq("id", settingsId);

    // Save each store prefix/suffix
    for (const s of stores) {
      await supabase
        .from("stores" as any)
        .update({ pos_order_prefix: s.pos_order_prefix || "", pos_order_suffix: s.pos_order_suffix || "" } as any)
        .eq("id", s.id);
    }

    setSaving(false);
    if (error) { toast.error("Failed to save"); return; }
    await logAction("update", "pos_settings", settingsId, {
      shipping_presets: shippingPresets,
      default_prefix: defaultPrefix,
      default_suffix: defaultSuffix,
      stores: stores.map(s => ({ id: s.id, prefix: s.pos_order_prefix, suffix: s.pos_order_suffix })),
    });
    toast.success("POS settings saved");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">POS Settings</h2>
          <p className="text-sm text-muted-foreground">Configure Point of Sale specific options.</p>
        </div>

        <div className="space-y-1.5">
          <Label>Shipping Charge Presets</Label>
          <p className="text-xs text-muted-foreground mb-2">These appear as quick-select buttons when Delivery is chosen in POS.</p>
          <div className="flex items-center gap-2 flex-wrap">
            {shippingPresets.map((amt, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input
                  type="number"
                  value={amt}
                  onChange={(e) => {
                    const presets = [...shippingPresets];
                    presets[i] = parseFloat(e.target.value) || 0;
                    setShippingPresets(presets);
                  }}
                  className="w-24"
                  placeholder={`Preset ${i + 1}`}
                />
                {shippingPresets.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShippingPresets(shippingPresets.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setShippingPresets([...shippingPresets, 0])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Order Number Format</h2>
          <p className="text-sm text-muted-foreground">
            Order numbers are 4-digit sequential (starting at 3000). Add a prefix/suffix per store
            to brand your order numbers (e.g. <span className="font-mono">SH-3142</span> or
            <span className="font-mono"> 3142-BD</span>). Reflects on receipts, pickup slips, and reports.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Default (used when order has no store)</Label>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Prefix"
              value={defaultPrefix}
              onChange={(e) => setDefaultPrefix(e.target.value)}
              className="w-32"
            />
            <span className="font-mono text-muted-foreground text-sm">3000</span>
            <Input
              placeholder="Suffix"
              value={defaultSuffix}
              onChange={(e) => setDefaultSuffix(e.target.value)}
              className="w-32"
            />
            <span className="text-xs text-muted-foreground ml-2">
              Preview: <span className="font-mono">{defaultPrefix}3000{defaultSuffix}</span>
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <Label>Per-Store Prefix / Suffix</Label>
          {stores.length === 0 && (
            <p className="text-xs text-muted-foreground">No connected stores yet.</p>
          )}
          {stores.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className="w-44 text-sm truncate">{s.name}</div>
              <Input
                placeholder="Prefix"
                value={s.pos_order_prefix || ""}
                onChange={(e) => {
                  const next = [...stores];
                  next[i] = { ...s, pos_order_prefix: e.target.value };
                  setStores(next);
                }}
                className="w-32"
              />
              <span className="font-mono text-muted-foreground text-sm">3000</span>
              <Input
                placeholder="Suffix"
                value={s.pos_order_suffix || ""}
                onChange={(e) => {
                  const next = [...stores];
                  next[i] = { ...s, pos_order_suffix: e.target.value };
                  setStores(next);
                }}
                className="w-32"
              />
              <span className="text-xs text-muted-foreground ml-2">
                <span className="font-mono">{s.pos_order_prefix || ""}3000{s.pos_order_suffix || ""}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save POS Settings"}</Button>
      </div>
    </div>
  );
};

export default PosSettingsTab;
