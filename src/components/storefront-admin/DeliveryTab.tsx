import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { Save, Loader2 } from "lucide-react";
import type { Storefront } from "./shared";
import { mergeSettings, type StorefrontDeliverySettings } from "@/storefront/lib/settings";

export default function DeliveryTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [d, setD] = useState<StorefrontDeliverySettings>(() => mergeSettings((sf as any).settings).delivery);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setD(mergeSettings((sf as any).settings).delivery);
  }, [sf]);

  function set<K extends keyof StorefrontDeliverySettings>(k: K, v: StorefrontDeliverySettings[K]) {
    setD({ ...d, [k]: v });
  }

  async function save() {
    setSaving(true);
    const settings = { ...mergeSettings((sf as any).settings), delivery: d };
    const { data, error } = await supabase.from("storefronts").update({ settings: settings as any }).eq("id", sf.id).select().single();
    setSaving(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    onUpdate(data as any);
    toast({ title: "Delivery settings saved" });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <h3 className="text-sm font-medium">Default charge</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Default delivery charge (৳)</Label>
              <Input type="number" min={0} value={d.default_charge} onChange={(e) => set("default_charge", Number(e.target.value))} />
              <p className="text-xs text-muted-foreground mt-1">Applied when no zone/product-specific charge overrides it.</p>
            </div>
            <div>
              <Label className="text-xs">Delivery label</Label>
              <Input value={d.default_label} onChange={(e) => set("default_label", e.target.value)} placeholder="Delivery" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <h3 className="text-sm font-medium">Cash on Delivery</h3>
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground space-y-1.5">
            <p>COD is controlled from the <b>Payments</b> tab (checkout.methods.cod).</p>
            <p>Free-shipping threshold lives in <b>Settings → Shipping</b>.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-2">
          <h3 className="text-sm font-medium mb-2">Address &amp; checkout</h3>
          <div className="flex items-center justify-between py-1.5">
            <div className="pr-4">
              <Label className="text-sm">Show upazila field</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Upazila dropdown appears at checkout. Turning this off collapses checkout to city + zone.</p>
            </div>
            <Switch checked={d.show_upazila} onCheckedChange={(v) => set("show_upazila", v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <h3 className="text-sm font-medium">Advance payment</h3>
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <Label className="text-sm">Enable advance payment</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Customer pays a portion online, rest on delivery</p>
            </div>
            <Switch checked={d.advance_payment_enabled} onCheckedChange={(v) => set("advance_payment_enabled", v)} />
          </div>
          {d.advance_payment_enabled && (
            <div>
              <Label className="text-xs">Advance percent (0–50)</Label>
              <Input type="number" min={0} max={50} value={d.advance_percent} onChange={(e) => set("advance_percent", Number(e.target.value))} />
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save delivery settings
      </Button>
    </div>
  );
}
