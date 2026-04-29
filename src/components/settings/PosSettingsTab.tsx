import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { logChange } from "@/lib/auditLog";
import { SettingsSection, SaveButton } from "./SettingsSection";

const PosSettingsTab = () => {
  const [shippingPresets, setShippingPresets] = useState<number[]>([80, 150]);
  const [originalPresets, setOriginalPresets] = useState<number[]>([80, 150]);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("invoice_settings" as any)
      .select("id, shipping_presets")
      .limit(1)
      .single()
      .then(({ data }: any) => {
        if (data) {
          setSettingsId(data.id);
          const p = data.shipping_presets || [80, 150];
          setShippingPresets(p);
          setOriginalPresets(p);
        }
      });
  }, []);

  const handleSave = async () => {
    if (!settingsId) return;
    setSaving(true);
    const { error } = await supabase
      .from("invoice_settings" as any)
      .update({ shipping_presets: shippingPresets } as any)
      .eq("id", settingsId);

    setSaving(false);
    if (error) { toast.error("Failed to save"); return; }
    await logChange("pos_settings", settingsId,
      { shipping_presets: originalPresets },
      { shipping_presets: shippingPresets },
    );
    setOriginalPresets(shippingPresets);
    toast.success("POS settings saved");
  };

  return (
    <SettingsSection
      title="POS Settings"
      description="Configure Point of Sale specific options."
      footer={<SaveButton saving={saving} onClick={handleSave} label="Save POS Settings" />}
    >
      <div className="space-y-1.5">
        <Label>Shipping Charge Presets</Label>
        <p className="text-xs text-muted-foreground mb-2">Quick-select buttons shown when Delivery is chosen in POS.</p>
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
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setShippingPresets(shippingPresets.filter((_, j) => j !== i))}>
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

      <p className="text-xs text-muted-foreground">
        POS &amp; Manual order number prefix/suffix have moved to the <span className="font-medium">Orders</span> tab.
      </p>
    </SettingsSection>
  );
};

export default PosSettingsTab;
