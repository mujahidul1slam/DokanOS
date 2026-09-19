import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Save, RotateCcw } from "lucide-react";
import type { Storefront } from "./shared";
import { mergeSettings, DEFAULT_SHOP, type StorefrontShopPageSettings } from "@/storefront/lib/settings";

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

export default function ShopPageTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [s, setS] = useState<StorefrontShopPageSettings>(() => mergeSettings((sf as any).settings).shop);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setS(mergeSettings((sf as any).settings).shop);
  }, [sf]);

  function set<K extends keyof StorefrontShopPageSettings>(k: K, v: StorefrontShopPageSettings[K]) {
    setS({ ...s, [k]: v });
  }

  async function save() {
    setSaving(true);
    const settings = { ...mergeSettings((sf as any).settings), shop: s };
    const { data, error } = await supabase.from("storefronts").update({ settings: settings as any }).eq("id", sf.id).select().single();
    setSaving(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    onUpdate(data as any);
    toast({ title: "Shop page settings saved" });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Layout</h3>
          <Row label="Products per page" hint="Fewer loads faster; more means less clicking. 48 max.">
            <Select value={String(s.per_page)} onValueChange={(v) => set("per_page", Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[8, 12, 16, 20, 24, 32, 40, 48].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Columns · desktop">
            <Select value={String(s.columns_pc)} onValueChange={(v) => set("columns_pc", Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["2", "3", "4", "5"].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Columns · phone">
            <Select value={String(s.columns_phone)} onValueChange={(v) => set("columns_phone", Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <h3 className="text-sm font-medium">Heading</h3>
          <div>
            <Label className="text-xs">Page heading</Label>
            <Input value={s.heading} onChange={(e) => set("heading", e.target.value)} placeholder="Shop" />
          </div>
          <div>
            <Label className="text-xs">Heading description</Label>
            <Input value={s.heading_desc} onChange={(e) => set("heading_desc", e.target.value)} placeholder="Optional line under the heading" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Shop filters</h3>
          <Row label="Result count" hint='e.g. "Showing 1 to 12 of 40 products"'>
            <Switch checked={s.result_count} onCheckedChange={(v) => set("result_count", v)} />
          </Row>
          <Row label="Sorting" hint='Shows the "Sort by" dropdown'>
            <Switch checked={s.show_sorting} onCheckedChange={(v) => set("show_sorting", v)} />
          </Row>
          <Row label="Price filters" hint="Customer can narrow by price band">
            <Switch checked={s.show_filters} onCheckedChange={(v) => set("show_filters", v)} />
          </Row>
          {s.show_filters && (
            <div className="space-y-2">
              <Label className="text-xs">Price bands (৳) — comma separated ascending edges</Label>
              <Input
                value={s.price_bands.join(", ")}
                onChange={(e) => {
                  const bands = e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n >= 0);
                  const sorted = [...new Set(bands)].sort((a, b) => a - b);
                  set("price_bands", sorted.length ? sorted : s.price_bands);
                }}
                placeholder="0, 500, 1000, 2000, 5000"
              />
              <p className="text-xs text-muted-foreground">Defaults: 0–500, 500–1k, 1–2k, 2–5k, 5k+</p>
            </div>
          )}
          </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-1">
          <h3 className="text-sm font-medium mb-2">Pagination</h3>
          <Row label="Style">
            <Select value={s.pagination} onValueChange={(v) => set("pagination", v as any)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buttons">Numbered pages</SelectItem>
                <SelectItem value="numbers">Compact numbers</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save shop page
        </Button>
        <Button variant="outline" onClick={() => setS(DEFAULT_SHOP)} className="gap-2">
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
      </div>
    </div>
  );
}
