import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { Loader2, Save, RotateCcw } from "lucide-react";
import type { Storefront } from "./shared";
import { mergeSettings, DEFAULT_CARD, type StorefrontCardSettings } from "@/storefront/lib/settings";

const FONTS = [
  { value: "theme", label: "Default (theme)" },
  { value: "inter", label: "Inter — Modern Sans" },
  { value: "poppins", label: "Poppins — Geometric" },
  { value: "montserrat", label: "Montserrat — Bold" },
  { value: "playfair", label: "Playfair — Elegant Serif" },
  { value: "lora", label: "Lora — Editorial Serif" },
  { value: "space", label: "Space Grotesk — Techy" },
  { value: "dm", label: "DM Sans — Clean" },
];

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

export default function CardStyleTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [card, setCard] = useState<StorefrontCardSettings>(() => mergeSettings((sf as any).settings).card);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCard(mergeSettings((sf as any).settings).card);
  }, [sf]);

  function set<K extends keyof StorefrontCardSettings>(k: K, v: StorefrontCardSettings[K]) {
    setCard({ ...card, [k]: v });
  }

  async function save() {
    setSaving(true);
    const settings = { ...mergeSettings((sf as any).settings), card };
    const { data, error } = await supabase.from("storefronts").update({ settings: settings as any }).eq("id", sf.id).select().single();
    setSaving(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    onUpdate(data as any);
    toast({ title: "Card style saved" });
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-1">
            <h3 className="text-sm font-medium mb-2">Card appearance</h3>
            <Row label="Card style">
              <Select value={card.style} onValueChange={(v) => set("style", v as any)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="classic">Classic</SelectItem>
                  <SelectItem value="minimal">Minimal</SelectItem>
                  <SelectItem value="bordered">Bordered</SelectItem>
                  <SelectItem value="elevated">Elevated</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Corners (px)">
              <div className="flex items-center gap-2 w-44">
                <Slider value={[card.corner_px]} min={0} max={28} onValueChange={([v]) => set("corner_px", v)} />
                <span className="text-xs w-8 tabular-nums">{card.corner_px}px</span>
              </div>
            </Row>
            <Row label="Shadow">
              <Select value={card.shadow} onValueChange={(v) => set("shadow", v as any)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="soft">Soft</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Image ratio">
              <Select value={card.image_ratio} onValueChange={(v) => set("image_ratio", v as any)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="square">1:1</SelectItem>
                  <SelectItem value="tall">Tall</SelectItem>
                  <SelectItem value="wide">Wide</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Hover effect">
              <Select value={card.hover} onValueChange={(v) => set("hover", v as any)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="zoom">Zoom</SelectItem>
                  <SelectItem value="lift">Lift</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-1">
            <h3 className="text-sm font-medium mb-2">Show on card</h3>
            <Row label="Wishlist"><Switch checked={card.show_wishlist} onCheckedChange={(v) => set("show_wishlist", v)} /></Row>
            <Row label="Category"><Switch checked={card.show_category} onCheckedChange={(v) => set("show_category", v)} /></Row>
            <Row label="Price"><Switch checked={card.show_price} onCheckedChange={(v) => set("show_price", v)} /></Row>
            <Row label="Rating"><Switch checked={card.show_rating} onCheckedChange={(v) => set("show_rating", v)} /></Row>
            <Row label="Add to Cart button"><Switch checked={card.show_add_to_cart} onCheckedChange={(v) => set("show_add_to_cart", v)} /></Row>
            <Row label="Buy Now button"><Switch checked={card.show_buy_now} onCheckedChange={(v) => set("show_buy_now", v)} /></Row>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-1">
            <h3 className="text-sm font-medium mb-2">Buttons</h3>
            <Row label="Layout">
              <Select value={card.button_layout} onValueChange={(v) => set("button_layout", v as any)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="side">Side by side</SelectItem>
                  <SelectItem value="stacked">Stacked</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Position">
              <Select value={card.button_position} onValueChange={(v) => set("button_position", v as any)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="below">Below details</SelectItem>
                  <SelectItem value="overlay">On image (hover)</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Add to Cart icon">
              <Select value={card.add_to_cart_icon} onValueChange={(v) => set("add_to_cart_icon", v as any)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cart">Cart</SelectItem>
                  <SelectItem value="bag">Bag</SelectItem>
                  <SelectItem value="plus">Plus</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Buy Now icon">
              <Select value={card.buy_now_icon} onValueChange={(v) => set("buy_now_icon", v as any)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="zap">Zap</SelectItem>
                  <SelectItem value="arrow">Arrow</SelectItem>
                  <SelectItem value="bag">Bag</SelectItem>
                  <SelectItem value="cart">Cart</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <h3 className="text-sm font-medium">Card font</h3>
            <Select value={card.font} onValueChange={(v) => set("font", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save design
          </Button>
          <Button variant="outline" onClick={() => setCard(DEFAULT_CARD)} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
