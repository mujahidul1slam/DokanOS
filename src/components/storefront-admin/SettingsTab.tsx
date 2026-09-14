import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";
import type { Storefront } from "./shared";
import { mergeSettings, validateSettings, type StorefrontSettings } from "@/storefront/lib/settings";

/** Storefront settings object editor (Phase 5 / §8.4). `{}` = today's behavior.
 *  The checkout runtime + storefront-checkout fn honor these server-side. */
export default function SettingsTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [draft, setDraft] = useState<StorefrontSettings>(() => mergeSettings((sf as any).settings));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(mergeSettings((sf as any).settings));
  }, [sf]);

  function set<T>(path: (string | number)[], value: T) {
    // Immutable-update drilldown is overkill for v1: rebuild via structured clone.
    const next: any = JSON.parse(JSON.stringify(draft));
    let node = next;
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
    node[path[path.length - 1]] = value;
    setDraft(next as StorefrontSettings);
  }

  async function save() {
    const problems = validateSettings(draft);
    if (problems.length) {
      toast({ title: "Invalid settings", description: problems[0], variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("storefronts")
      .update({ settings: draft as any })
      .eq("id", sf.id)
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    onUpdate(data as any);
    toast({ title: "Settings saved" });
  }

  const m = draft.checkout.methods;

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-1">Payment methods</h3>
          <p className="text-xs text-muted-foreground mb-3">Disabled methods are hidden on checkout and rejected server-side.</p>
          <div className="flex flex-wrap gap-4">
            {(["cod", "bkash", "nagad"] as const).map((k) => (
              <label key={k} className="inline-flex items-center gap-2 text-sm">
                <Switch checked={m[k]} onCheckedChange={(v) => set(["checkout", "methods", k], v)} />
                {k === "cod" ? "Cash on delivery" : k === "bkash" ? "bKash" : "Nagad"}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium">Checkout</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Minimum order amount</Label>
              <Input
                type="number"
                min={0}
                value={draft.checkout.min_order_amount}
                onChange={(e) => set(["checkout", "min_order_amount"], Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">0 = no minimum. Carts below this are blocked.</p>
            </div>
            <div>
              <Label className="text-xs">Order instructions (shown above Place order)</Label>
              <Input value={draft.checkout.order_instructions} onChange={(e) => set(["checkout", "order_instructions"], e.target.value)} />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2">Shipping</h3>
          <div className="max-w-xs">
            <Label className="text-xs">Free shipping threshold (0 = off)</Label>
            <Input
              type="number"
              min={0}
              value={draft.shipping.free_threshold}
              onChange={(e) => set(["shipping", "free_threshold"], Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-1">Announcement</h3>
          <div className="space-y-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <Switch checked={draft.announcement.enabled} onCheckedChange={(v) => set(["announcement", "enabled"], v)} />
              Show announcement bar
            </label>
            {draft.announcement.enabled && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Announcement text</Label>
                  <Input value={draft.announcement.text} onChange={(e) => set(["announcement", "text"], e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Link (optional)</Label>
                  <Input value={draft.announcement.href} onChange={(e) => set(["announcement", "href"], e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2">Analytics pixels (stored now, loaded in analytics)</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">GA4 ID</Label>
              <Input value={draft.pixels.ga4} onChange={(e) => set(["pixels", "ga4"], e.target.value)} placeholder="G-XXXXXX" />
            </div>
            <div>
              <Label className="text-xs">Meta Pixel</Label>
              <Input value={draft.pixels.meta} onChange={(e) => set(["pixels", "meta"], e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">TikTok Pixel</Label>
              <Input value={draft.pixels.tiktok} onChange={(e) => set(["pixels", "tiktok"], e.target.value)} />
            </div>
          </div>
        </div>

        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </Button>
      </CardContent>
    </Card>
  );
}