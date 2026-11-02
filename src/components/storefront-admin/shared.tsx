import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, Store as StoreIcon, Sparkles } from "lucide-react";
import type { Storefront } from "@/storefront/lib/brand";

export type { Storefront };

/** Available theme presets for new storefronts */
export const THEME_PRESETS = [
  { value: "editorial", label: "Editorial (Light)", description: "Warm, elegant magazine style" },
  { value: "cinematic", label: "Cinematic (Dark)", description: "Bold, dark immersive layout" },
  { value: "minimal", label: "Minimal (Clean)", description: "Clean, modern, black & white" },
  { value: "warm", label: "Warm (Earthy)", description: "Earthy, warm-toned and inviting" },
  { value: "nimbus", label: "Nimbus (Tech)", description: "Crisp blues for tech & gadgets" },
  { value: "saffron", label: "Saffron (Food)", description: "Warm, appetizing food & beverage tones" },
] as const;

/** Content returned by the generate-storefront-content edge function */
export interface GeneratedContent {
  hero_title: string;
  hero_subtitle: string;
  about_md: string;
  policies: { shipping: string; returns: string; privacy: string };
}

export function Field({
  label,
  value,
  onChange,
  className = "",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <Input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function StoreLink({ sf, onChange }: { sf: Storefront; onChange: (store_id: string | null) => void }) {
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("stores").select("id,name").order("name").then(({ data }) => setStores(data || []));
  }, []);

  async function update(store_id: string | null) {
    setSaving(true);
    const { error } = await supabase.from("storefronts").update({ store_id }).eq("id", sf.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    onChange(store_id);
    toast({ title: store_id ? "Store linked" : "Store unlinked" });
  }

  const current = stores.find((s) => s.id === sf.store_id);

  return (
    <Card className="border-dashed">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-start gap-3">
          <StoreIcon className="h-5 w-5 mt-1 text-muted-foreground" />
          <div className="flex-1">
            <h3 className="text-sm font-medium">Link to a store</h3>
            <p className="text-xs text-muted-foreground mb-3">
              When linked, this storefront automatically shows all active products from the selected store.
              Leave unlinked to curate products manually in the Products tab.
            </p>
            <div className="flex gap-2 items-center">
              <Select value={sf.store_id ?? "none"} onValueChange={(v) => update(v === "none" ? null : v)} disabled={saving}>
                <SelectTrigger className="max-w-sm">
                  <SelectValue placeholder="Select a store…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None (manual curation) —</SelectItem>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {current && <Badge variant="secondary">Linked: {current.name}</Badge>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AiContentDialog({ sf, onApply }: { sf: Storefront; onApply: (c: GeneratedContent) => void }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GeneratedContent | null>(null);

  useEffect(() => {
    if (!open) {
      setBrief("");
      setResult(null);
    }
  }, [open]);

  async function generate() {
    setLoading(true);
    try {
      // Product names give the model concrete things to write about
      const { data: rows } = await supabase
        .from("storefront_products")
        .select("products(name)")
        .eq("storefront_id", sf.id)
        .limit(8);
      const productNames = ((rows || []) as Array<{ products?: { name?: string } | null }>)
        .map((r) => r.products?.name || "")
        .filter(Boolean);

      const { data, error } = await supabase.functions.invoke("generate-storefront-content", {
        body: {
          name: sf.name,
          theme: sf.theme,
          accent_hex: sf.accent_hex,
          brief: brief.trim() || undefined,
          product_names: productNames,
        },
      });
      if (error) throw new Error(error.message);
      const content = (data as { content?: GeneratedContent })?.content;
      if (!content) throw new Error("No content returned");
      setResult(content);
    } catch (e) {
      toast({
        title: "Generation failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Sparkles className="h-4 w-4" /> Generate with AI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Generate storefront content with AI</DialogTitle>
          <DialogDescription>
            Drafts hero copy, an About page and policies for {sf.name}. Nothing is saved until you
            apply it and press Save changes.
          </DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="ai-brief">Brief (optional)</Label>
              <Textarea
                id="ai-brief"
                rows={3}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="e.g. Luxury Eid capsule for Dhaka — muted tones, handwoven fabrics"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={generate} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? "Generating…" : "Generate"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="space-y-3 max-h-[50vh] overflow-auto pr-1 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Hero title</div>
                <div className="text-base font-medium">{result.hero_title}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Hero subtitle</div>
                <div>{result.hero_subtitle}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">About</div>
                <pre className="whitespace-pre-wrap font-sans text-muted-foreground">{result.about_md}</pre>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Shipping</div>
                  <pre className="whitespace-pre-wrap font-sans text-muted-foreground">{result.policies.shipping}</pre>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Returns</div>
                  <pre className="whitespace-pre-wrap font-sans text-muted-foreground">{result.policies.returns}</pre>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Privacy</div>
                  <pre className="whitespace-pre-wrap font-sans text-muted-foreground">{result.policies.privacy}</pre>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setResult(null)}>
                Regenerate
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onApply(result);
                  setOpen(false);
                  toast({ title: "Applied to form", description: "Review the fields and press Save changes." });
                }}
              >
                Apply to form
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

