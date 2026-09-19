import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, Loader2, Phone, MessageCircle } from "lucide-react";
import type { Storefront } from "./shared";
import { mergeSettings, DEFAULT_HEADER, type StorefrontHeaderFooterSettings } from "@/storefront/lib/settings";

const ICON_CHOICES = ["Phone", "WhatsApp", "Messenger", "Mail"] as const;

export default function HeaderFooterTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [h, setH] = useState<StorefrontHeaderFooterSettings>(() => mergeSettings((sf as any).settings).header);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setH(mergeSettings((sf as any).settings).header);
  }, [sf]);

  function set<K extends keyof StorefrontHeaderFooterSettings>(k: K, v: StorefrontHeaderFooterSettings[K]) {
    setH({ ...h, [k]: v });
  }

  async function save() {
    setSaving(true);
    const settings = { ...mergeSettings((sf as any).settings), header: h };
    const { data, error } = await supabase.from("storefronts").update({ settings: settings as any }).eq("id", sf.id).select().single();
    setSaving(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    onUpdate(data as any);
    toast({ title: "Header & footer saved" });
  }

  function iconFor(kind: string) {
    if (kind === "Phone") return <Phone className="h-4 w-4" />;
    return <MessageCircle className="h-4 w-4" />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-3">
          <h3 className="text-sm font-medium">Announcement bar</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Control: Settings → Announcement. This editor covers header/footer content only.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Header</h3>
          <div className="flex items-center justify-between py-2">
            <div>
              <Label className="text-sm">Dark mode toggle</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Skip for now — storefront dark theme adoption is theme-dependent (P1). Not rendered yet.</p>
            </div>
            <Switch checked={false} disabled />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Custom header icons</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Phone, WhatsApp or chat links</p>
            </div>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => set("custom_icons", [...h.custom_icons, { icon: "Phone", href: "" }])}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {h.custom_icons.map((ic, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="border border-input rounded px-2 py-1.5 text-muted-foreground">{iconFor(ic.icon)}</div>
                <select
                  value={ic.icon}
                  onChange={(e) => { const n = [...h.custom_icons]; n[i] = { ...ic, icon: e.target.value }; set("custom_icons", n); }}
                  className="border border-input rounded-md px-2 py-1.5 text-sm bg-background"
                >
                  {ICON_CHOICES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <Input className="flex-1" value={ic.href} onChange={(e) => { const n = [...h.custom_icons]; n[i] = { ...ic, href: e.target.value }; set("custom_icons", n); }} placeholder="tel:+880… or https://wa.me/880…" />
                <Button size="icon" variant="ghost" onClick={() => set("custom_icons", h.custom_icons.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {h.custom_icons.length === 0 && <p className="text-xs text-muted-foreground">None added.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Custom menu links</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Extra items added to the header nav</p>
            </div>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => set("custom_links", [...h.custom_links, { label: "", href: "" }])}>
              <Plus className="h-3.5 w-3.5" /> Add link
            </Button>
          </div>
          <div className="space-y-2">
            {h.custom_links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Input value={l.label} onChange={(e) => { const n = [...h.custom_links]; n[i] = { ...l, label: e.target.value }; set("custom_links", n); }} placeholder="About" className="w-36" />
                <Input value={l.href} onChange={(e) => { const n = [...h.custom_links]; n[i] = { ...l, href: e.target.value }; set("custom_links", n); }} placeholder="/storefront/your-brand/about" className="flex-1" />
                <Button size="icon" variant="ghost" onClick={() => set("custom_links", h.custom_links.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {h.custom_links.length === 0 && <p className="text-xs text-muted-foreground">None added — nav in the Pages tab controls the rest.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Footer</h3>
          <div className="flex items-center justify-between py-2">
            <div>
              <Label className="text-sm">Footer CTA</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Show a call-to-action block in the footer</p>
            </div>
            <Switch checked={h.show_footer_cta} onCheckedChange={(v) => set("show_footer_cta", v)} />
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save header &amp; footer
      </Button>
    </div>
  );
}
