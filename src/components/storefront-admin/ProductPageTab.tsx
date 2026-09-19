import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Save, RotateCcw, Plus, Trash2 } from "lucide-react";
import type { Storefront } from "./shared";
import { mergeSettings, DEFAULT_PRODUCT, type StorefrontProductPageSettings } from "@/storefront/lib/settings";

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <Label className="text-sm">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const VISIBILITY: { key: keyof StorefrontProductPageSettings; label: string }[] = [
  { key: "show_category_label", label: "Category label" },
  { key: "show_wishlist", label: "Wishlist (heart)" },
  { key: "show_size_chart", label: "Size chart" },
  { key: "show_sku", label: "SKU" },
  { key: "show_quantity", label: "Quantity selector" },
  { key: "show_price_breakdown", label: "Price breakdown" },
  { key: "show_stock_status", label: "Stock status" },
  { key: "show_sold_count", label: "Sold count" },
  { key: "show_share", label: "Share button" },
];

function ButtonEditor({ label, corners, height, fill, color, textColor, onChange }: {
  label: string;
  corners: string; height: string; fill: string; color: string; textColor: string;
  onChange: (k: "corners" | "height" | "fill" | "color" | "text_color", v: string) => void;
}) {
  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">Corners</Label>
          <Select value={corners} onValueChange={(v) => onChange("corners", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rounded">Rounded</SelectItem>
              <SelectItem value="pill">Pill</SelectItem>
              <SelectItem value="square">Square</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Height</Label>
          <Select value={height} onValueChange={(v) => onChange("height", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="compact">Compact</SelectItem>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="large">Large</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Fill</Label>
          <Select value={fill} onValueChange={(v) => onChange("fill", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="solid">Solid</SelectItem>
              <SelectItem value="outline">Outline</SelectItem>
              <SelectItem value="tinted">Tinted</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Button color (blank = accent)</Label>
          <Input value={color} onChange={(e) => onChange("color", e.target.value)} placeholder="#hex" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Text color</Label>
          <Input value={textColor} onChange={(e) => onChange("text_color", e.target.value)} placeholder="#hex or blank" className="h-8 text-xs" />
        </div>
      </div>
    </div>
  );
}

export default function ProductPageTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [p, setP] = useState<StorefrontProductPageSettings>(() => mergeSettings((sf as any).settings).product);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setP(mergeSettings((sf as any).settings).product);
  }, [sf]);

  function set<K extends keyof StorefrontProductPageSettings>(k: K, v: StorefrontProductPageSettings[K]) {
    setP({ ...p, [k]: v });
  }
  function setAtc(k: string, v: string) { setP({ ...p, [`atc_${k}`]: v } as StorefrontProductPageSettings); }
  function setBuy(k: string, v: string) { setP({ ...p, [`buy_${k}`]: v } as StorefrontProductPageSettings); }

  async function save() {
    setSaving(true);
    const settings = { ...mergeSettings((sf as any).settings), product: p };
    const { data, error } = await supabase.from("storefronts").update({ settings: settings as any }).eq("id", sf.id).select().single();
    setSaving(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    onUpdate(data as any);
    toast({ title: "Product page saved" });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Layout &amp; images</h3>
          <Row label="Layout">
            <Select value={p.layout} onValueChange={(v) => set("layout", v as any)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="classic">Classic</SelectItem>
                <SelectItem value="split">Split focus</SelectItem>
                <SelectItem value="gallery-left">Gallery left</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Image shape">
            <Select value={p.image_shape} onValueChange={(v) => set("image_shape", v as any)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="landscape">Landscape</SelectItem>
                <SelectItem value="square">Square</SelectItem>
                <SelectItem value="portrait">Portrait</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Info panel style" hint="How the title/price/stack is rendered on the right">
            <Select value={p.info_panel} onValueChange={(v) => set("info_panel", v as any)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="open">Open</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Related products per row (desktop)">
            <Select value={String(p.related_per_row_pc)} onValueChange={(v) => set("related_per_row_pc", Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Related products per row (phone)">
            <Select value={String(p.related_per_row_phone)} onValueChange={(v) => set("related_per_row_phone", Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Accent color override" hint="Blank = store accent color">
            <Input value={p.accent_override} onChange={(e) => set("accent_override", e.target.value)} placeholder="#hex" className="w-36" />
          </Row>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <ButtonEditor label="Add to Cart" corners={p.atc_corners} height={p.atc_height} fill={p.atc_fill} color={p.atc_color} textColor={p.atc_text_color} onChange={setAtc} />
        <ButtonEditor label="Buy Now" corners={p.buy_corners} height={p.buy_height} fill={p.buy_fill} color={p.buy_color} textColor={p.buy_text_color} onChange={setBuy} />
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm">Price in button</Label>
              <p className="text-xs text-muted-foreground">e.g. “Add to Cart — ৳850”</p>
            </div>
            <Switch checked={p.price_in_button} onCheckedChange={(v) => set("price_in_button", v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Visibility</h3>
          {VISIBILITY.map((v) => (
            <Row key={v.key} label={v.label}>
              <Switch checked={Boolean((p as any)[v.key])} onCheckedChange={(on) => set(v.key as keyof StorefrontProductPageSettings, on as any)} />
            </Row>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Trust badges</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Shown under the purchase buttons</p>
            </div>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => set("trust_badges", [...p.trust_badges, ""] )}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {p.trust_badges.map((b, i) => (
              <div key={i} className="flex gap-2">
                <Input value={b} onChange={(e) => { const n = [...p.trust_badges]; n[i] = e.target.value; set("trust_badges", n); }} placeholder={`Badge ${i + 1}`} />
                <Button size="icon" variant="ghost" onClick={() => set("trust_badges", p.trust_badges.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {p.trust_badges.length === 0 && <p className="text-xs text-muted-foreground">No badges.</p>}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save product page
        </Button>
        <Button variant="outline" onClick={() => setP(DEFAULT_PRODUCT)} className="gap-2">
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
      </div>
    </div>
  );
}
