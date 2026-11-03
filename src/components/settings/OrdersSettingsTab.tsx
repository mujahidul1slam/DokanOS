import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logChange } from "@/lib/auditLog";
import { useRegisterDirty } from "@/hooks/useSettingsDirty";
import { SettingsSection, SettingsSaveHandler } from "./SettingsSection";

interface StoreRow {
  id: string;
  name: string;
  pos_order_prefix: string;
  pos_order_suffix: string;
  manual_order_prefix: string;
  manual_order_suffix: string;
}

const PreviewRow = ({ prefix, base, suffix }: { prefix: string; base: string; suffix: string }) => (
  <span className="text-xs text-muted-foreground ml-2">
    Preview: <span className="font-mono">{prefix}{base}{suffix}</span>
  </span>
);

const OrdersSettingsTab = () => {
  const [defaults, setDefaults] = useState({
    pos_prefix: "", pos_suffix: "",
    manual_prefix: "", manual_suffix: "",
  });
  const [originalDefaults, setOriginalDefaults] = useState(defaults);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [originalStores, setOriginalStores] = useState<StoreRow[]>([]);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const setDirty = useRegisterDirty();

  // Universal save: pending prefix/suffix edits (defaults and per-store) must
  // mark the tab dirty so the sticky save bar appears and the guard prompts.
  const isDirty =
    JSON.stringify(defaults) !== JSON.stringify(originalDefaults) ||
    JSON.stringify(stores) !== JSON.stringify(originalStores);
  useEffect(() => {
    setDirty(isDirty);
    return () => setDirty(false);
  }, [isDirty, setDirty]);

  useEffect(() => {
    supabase
      .from("invoice_settings" as any)
      .select("id, pos_order_prefix, pos_order_suffix, manual_order_prefix, manual_order_suffix")
      .limit(1).single()
      .then(({ data }: any) => {
        if (data) {
          setSettingsId(data.id);
          const d = {
            pos_prefix: data.pos_order_prefix || "", pos_suffix: data.pos_order_suffix || "",
            manual_prefix: data.manual_order_prefix || "", manual_suffix: data.manual_order_suffix || "",
          };
          setDefaults(d);
          setOriginalDefaults(d);
        }
      });

    supabase
      .from("stores" as any)
      .select("id, name, pos_order_prefix, pos_order_suffix, manual_order_prefix, manual_order_suffix")
      .order("name")
      .then(({ data }: any) => { if (data) { setStores(data as StoreRow[]); setOriginalStores(data as StoreRow[]); } });
  }, []);

  const handleSave = async () => {
    if (!settingsId) return;
    setSaving(true);
    const { error } = await supabase
      .from("invoice_settings" as any)
      .update({
        pos_order_prefix: defaults.pos_prefix, pos_order_suffix: defaults.pos_suffix,
        manual_order_prefix: defaults.manual_prefix, manual_order_suffix: defaults.manual_suffix,
      } as any)
      .eq("id", settingsId);

    for (const s of stores) {
      await supabase.from("stores" as any).update({
        pos_order_prefix: s.pos_order_prefix || "", pos_order_suffix: s.pos_order_suffix || "",
        manual_order_prefix: s.manual_order_prefix || "", manual_order_suffix: s.manual_order_suffix || "",
      } as any).eq("id", s.id);
    }

    setSaving(false);
    if (error) { toast.error("Failed to save"); return; }
    await logChange("orders_settings", settingsId,
      { defaults: originalDefaults, stores: originalStores },
      { defaults, stores },
    );
    setOriginalDefaults(defaults);
    setOriginalStores(stores);
    toast.success("Order number settings saved");
  };

  const updateStore = (i: number, patch: Partial<StoreRow>) => {
    const next = [...stores]; next[i] = { ...next[i], ...patch }; setStores(next);
  };

  return (
    <>
      {/* Universal save: the sticky save bar commits the order-number edits. */}
      <SettingsSaveHandler
        label="Save Order Settings"
        disabled={saving || !isDirty}
        run={handleSave}
      />
      <SettingsSection
        title="Order Number Format"
        description="Add prefix/suffix branding to order numbers. POS & Manual orders use a 4-digit sequence (from 3000)."
      >
      <div className="space-y-4">
        <h3 className="font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">Defaults</h3>

        <div className="space-y-2">
          <Label className="text-sm">POS Orders</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <Input placeholder="Prefix" value={defaults.pos_prefix}
              onChange={(e) => setDefaults({ ...defaults, pos_prefix: e.target.value })} className="w-28" />
            <span className="font-mono text-muted-foreground text-sm">3000</span>
            <Input placeholder="Suffix" value={defaults.pos_suffix}
              onChange={(e) => setDefaults({ ...defaults, pos_suffix: e.target.value })} className="w-28" />
            <PreviewRow prefix={defaults.pos_prefix} base="3000" suffix={defaults.pos_suffix} />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm">Manual Orders</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <Input placeholder="Prefix" value={defaults.manual_prefix}
              onChange={(e) => setDefaults({ ...defaults, manual_prefix: e.target.value })} className="w-28" />
            <span className="font-mono text-muted-foreground text-sm">3000</span>
            <Input placeholder="Suffix" value={defaults.manual_suffix}
              onChange={(e) => setDefaults({ ...defaults, manual_suffix: e.target.value })} className="w-28" />
            <PreviewRow prefix={defaults.manual_prefix} base="3000" suffix={defaults.manual_suffix} />
          </div>
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t border-border">
        <h3 className="font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-Store Overrides</h3>
        {stores.length === 0 && (
          <p className="text-xs text-muted-foreground">No connected stores yet.</p>
        )}
        {stores.map((s, i) => (
          <div key={s.id} className="rounded-md border border-border p-3 space-y-2">
            <div className="font-medium text-sm">{s.name}</div>

            <div className="grid grid-cols-[70px_1fr] items-center gap-2">
              <Label className="text-xs text-muted-foreground">POS</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <Input placeholder="Prefix" value={s.pos_order_prefix || ""}
                  onChange={(e) => updateStore(i, { pos_order_prefix: e.target.value })} className="w-24 h-8" />
                <span className="font-mono text-muted-foreground text-xs">3000</span>
                <Input placeholder="Suffix" value={s.pos_order_suffix || ""}
                  onChange={(e) => updateStore(i, { pos_order_suffix: e.target.value })} className="w-24 h-8" />
                <span className="text-xs text-muted-foreground ml-1 font-mono">{s.pos_order_prefix || ""}3000{s.pos_order_suffix || ""}</span>
              </div>

              <Label className="text-xs text-muted-foreground">Manual</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <Input placeholder="Prefix" value={s.manual_order_prefix || ""}
                  onChange={(e) => updateStore(i, { manual_order_prefix: e.target.value })} className="w-24 h-8" />
                <span className="font-mono text-muted-foreground text-xs">3000</span>
                <Input placeholder="Suffix" value={s.manual_order_suffix || ""}
                  onChange={(e) => updateStore(i, { manual_order_suffix: e.target.value })} className="w-24 h-8" />
                <span className="text-xs text-muted-foreground ml-1 font-mono">{s.manual_order_prefix || ""}3000{s.manual_order_suffix || ""}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      </SettingsSection>
    </>
  );
};

export default OrdersSettingsTab;
