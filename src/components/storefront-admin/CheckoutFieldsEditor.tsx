import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Save, Loader2 } from "lucide-react";
import type { Storefront } from "@/storefront/lib/brand";
import { mergeSettings, type StorefrontCheckoutFields } from "@/storefront/lib/settings";

/**
 * Checkout Fields editor (overhaul 5.1 / fix G): its own admin item under
 * CHECKOUT & SHIPPING — toggles for optional fields + regional zone-required
 * presets. Honored by the checkout runtime and the edge function.
 */
export default function CheckoutFieldsEditor({ sf: sfProp, onUpdate }: { sf?: Storefront; onUpdate?: (s: Storefront) => void }) {
  const [cf, setF] = useState<StorefrontCheckoutFields | null>(null);
  const [sf, setSf] = useState<Storefront | null>(sfProp ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (sfProp) { setSf(sfProp); return; }
    // Deep-link mode: resolve from :slug route
    const slug = window.location.pathname.match(/^\/storefronts\/([^/]+)/)?.[1];
    if (!slug) return;
    supabase.from("storefronts").select("*").eq("slug", slug).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSf(data as unknown as Storefront);
          setF(mergeSettings((data as any).settings).checkout.fields);
        }
      });
  }, [sfProp]);

  if (!sf || !cf) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  function set<K extends keyof StorefrontCheckoutFields>(k: K, v: StorefrontCheckoutFields[K]) {
    setF({ ...cf!, [k]: v });
  }

  async function save() {
    setSaving(true);
    const settings = { ...mergeSettings((sf as any).settings), checkout: { ...mergeSettings((sf as any).settings).checkout, fields: cf } };
    const { data, error } = await supabase.from("storefronts").update({ settings: settings as any }).eq("id", sf!.id).select().single();
    setSaving(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    onUpdate?.(data as any);
    toast({ title: "Checkout fields saved" });
  }

  const toggles: { key: keyof StorefrontCheckoutFields; label: string; hint: string }[] = [
    { key: "show_email", label: "Email", hint: "Optional contact field at checkout" },
    { key: "show_company", label: "Company", hint: "Optional company field" },
    { key: "show_address2", label: "Address line 2", hint: "Second address line (apartment, floor…)" },
    { key: "show_postal_code", label: "Postal code", hint: "Optional postal code field" },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Checkout fields</h3>
          <p className="text-xs text-muted-foreground mb-2">Toggle which fields customers fill in at checkout.</p>
          {toggles.map((t) => (
            <div key={t.key} className="flex items-center justify-between py-2">
              <div className="pr-4">
                <Label className="text-sm">{t.label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{t.hint}</p>
              </div>
              <Switch checked={!!cf[t.key]} onCheckedChange={(v) => set(t.key, v as never)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Regional delivery presets</h3>
          <p className="text-xs text-muted-foreground mb-2">Whether the zone dropdown is required for customers in each region.</p>
          <div className="flex items-center justify-between py-2">
            <div className="pr-4">
              <Label className="text-sm">Zone required inside Dhaka</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Off = customers in Dhaka can skip the zone dropdown</p>
            </div>
            <Switch checked={cf.inside_dhaka_required} onCheckedChange={(v) => set("inside_dhaka_required", v)} />
          </div>
          <div className="flex items-center justify-between py-2">
            <div className="pr-4">
              <Label className="text-sm">Zone required outside Dhaka</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Off = customers outside Dhaka can skip the zone dropdown</p>
            </div>
            <Switch checked={cf.outside_dhaka_required} onCheckedChange={(v) => set("outside_dhaka_required", v)} />
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save checkout fields
      </Button>
    </div>
  );
}
