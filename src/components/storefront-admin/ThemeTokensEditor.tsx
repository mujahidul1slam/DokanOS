import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { Save, Loader2, RotateCcw } from "lucide-react";
import type { Storefront } from "@/storefront/lib/brand";
import { mergeSettings, DEFAULT_TOKENS, type StorefrontTokens } from "@/storefront/lib/settings";

const FONT_FAMILIES = [
  "", "Inter", "Poppins", "Montserrat", "Playfair Display", "Lora", "Space Grotesk", "DM Sans",
];

function TokenRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <Label className="text-sm">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ColorToken({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#888888"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 rounded border border-border cursor-pointer bg-transparent"
          aria-label={`${label} picker`}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="theme" className="w-28 h-8 text-xs" />
        {value && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => onChange("")}>clear</Button>
        )}
      </div>
    </div>
  );
}

/** Theme token customizer (overhaul 4.2): fonts, colors, radius, shadows, width. */
export default function ThemeTokensEditor({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [t, setT] = useState<StorefrontTokens>(() => mergeSettings((sf as any).settings).tokens);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setT(mergeSettings((sf as any).settings).tokens);
  }, [sf]);

  function set<K extends keyof StorefrontTokens>(k: K, v: StorefrontTokens[K]) {
    setT({ ...t, [k]: v });
  }

  async function save() {
    setSaving(true);
    const settings = { ...mergeSettings((sf as any).settings), tokens: t };
    const { data, error } = await supabase.from("storefronts").update({ settings: settings as any }).eq("id", sf.id).select().single();
    setSaving(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    onUpdate(data as any);
    toast({ title: "Design tokens saved" });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-3">
          <h3 className="text-sm font-medium">Typography</h3>
          <TokenRow label="Heading font">
            <Select value={t.font_display} onValueChange={(v) => set("font_display", v)}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Theme default" /></SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((f) => <SelectItem key={f || "theme"} value={f}>{f || "Theme default"}</SelectItem>)}
              </SelectContent>
            </Select>
          </TokenRow>
          <TokenRow label="Body font">
            <Select value={t.font_body} onValueChange={(v) => set("font_body", v)}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Theme default" /></SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((f) => <SelectItem key={f || "theme"} value={f}>{f || "Theme default"}</SelectItem>)}
              </SelectContent>
            </Select>
          </TokenRow>
          <p className="text-xs text-muted-foreground">Fonts load from Google Fonts automatically when set.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Colors</h3>
          <p className="text-xs text-muted-foreground mb-2">Blank = inherit the theme's value. Set a token to override it store-wide.</p>
          <ColorToken label="Primary" value={t.color_primary} onChange={(v) => set("color_primary", v)} />
          <ColorToken label="Secondary" value={t.color_secondary} onChange={(v) => set("color_secondary", v)} />
          <ColorToken label="Surface / background" value={t.color_surface} onChange={(v) => set("color_surface", v)} />
          <ColorToken label="Text" value={t.color_text} onChange={(v) => set("color_text", v)} />
          <ColorToken label="Muted text" value={t.color_muted} onChange={(v) => set("color_muted", v)} />
          <ColorToken label="Border" value={t.color_border} onChange={(v) => set("color_border", v)} />
          <ColorToken label="Accent" value={t.color_accent} onChange={(v) => set("color_accent", v)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <h3 className="text-sm font-medium">Shape & layout</h3>
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Corner radius</Label>
              <span className="text-xs text-muted-foreground tabular-nums">{t.corner_radius_px}px</span>
            </div>
            <Slider value={[t.corner_radius_px]} min={0} max={28} onValueChange={([v]) => set("corner_radius_px", v)} />
          </div>
          <TokenRow label="Card shadow">
            <Select value={t.card_shadow} onValueChange={(v) => set("card_shadow", v as any)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="soft">Soft</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
              </SelectContent>
            </Select>
          </TokenRow>
          <TokenRow label="Container width">
            <Select value={t.container_width} onValueChange={(v) => set("container_width", v as any)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="narrow">Narrow (5xl)</SelectItem>
                <SelectItem value="default">Default (7xl)</SelectItem>
                <SelectItem value="wide">Wide (full)</SelectItem>
              </SelectContent>
            </Select>
          </TokenRow>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save tokens
        </Button>
        <Button variant="outline" onClick={() => setT(DEFAULT_TOKENS)} className="gap-2">
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
      </div>
    </div>
  );
}
