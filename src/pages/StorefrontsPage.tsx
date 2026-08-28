import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Loader2, Plus, Trash2, Star, ChevronUp, ChevronDown, Store as StoreIcon, Globe } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { invalidateSlugCache } from "@/storefront/lib/brand";

/** Available theme presets for new storefronts */
const THEME_PRESETS = [
  { value: "editorial", label: "Editorial (Light)", description: "Warm, elegant magazine style" },
  { value: "cinematic", label: "Cinematic (Dark)", description: "Bold, dark immersive layout" },
  { value: "minimal", label: "Minimal (Clean)", description: "Clean, modern, black & white" },
  { value: "warm", label: "Warm (Earthy)", description: "Earthy, warm-toned and inviting" },
] as const;

interface Storefront {
  id: string; slug: string; name: string; accent_hex: string; theme: string;
  hero_title: string; hero_subtitle: string; hero_image_url: string; logo_url: string;
  about_md: string; contact_email: string; contact_phone: string; is_active: boolean;
  store_id: string | null; currency: string;
}

interface SfProduct {
  id: string; product_id: string; position: number; is_featured: boolean; badge: string;
  product?: { id: string; name: string; price: number; image_url: string | null; stock_quantity: number };
}

export default function StorefrontsPage() {
  const [list, setList] = useState<Storefront[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  async function reload() {
    const { data } = await supabase.from("storefronts").select("*").order("name");
    setList((data as any) || []);
    invalidateSlugCache();
    return data;
  }

  useEffect(() => {
    supabase.from("storefronts").select("*").order("name").then(({ data }) => {
      setList((data as any) || []);
      setActiveId((data?.[0] as any)?.id ?? null);
      setLoading(false);
    });
  }, []);

  const active = list.find((s) => s.id === activeId);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Storefronts</h1>
          <p className="text-sm text-muted-foreground">Manage your native online stores</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {list.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={s.id === activeId ? "default" : "outline"}
              onClick={() => setActiveId(s.id)}
            >
              {s.name}
            </Button>
          ))}
          <CreateStorefrontDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreate={async (newSf) => {
              const data = await reload();
              setActiveId(newSf.id);
            }}
          />
        </div>
      </div>

      {active && <StorefrontEditor sf={active} onUpdate={(s) => { setList((l) => l.map((x) => x.id === s.id ? s : x)); invalidateSlugCache(); }} />}
    </div>
  );
}

function StorefrontEditor({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [form, setForm] = useState(sf);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(sf), [sf]);

  async function save() {
    setSaving(true);
    const { data, error } = await supabase.from("storefronts").update({
      name: form.name, hero_title: form.hero_title, hero_subtitle: form.hero_subtitle,
      hero_image_url: form.hero_image_url, logo_url: form.logo_url, about_md: form.about_md,
      contact_email: form.contact_email, contact_phone: form.contact_phone,
      accent_hex: form.accent_hex, is_active: form.is_active, theme: form.theme,
    }).eq("id", form.id).select().single();
    setSaving(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    onUpdate(data as any);
    toast({ title: "Saved" });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{sf.name}</CardTitle>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline">/{sf.slug}</Badge>
            <Badge variant={sf.is_active ? "default" : "secondary"}>{sf.is_active ? "Live" : "Hidden"}</Badge>
          </div>
        </div>
        <a href={`/storefront/${sf.slug}`} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm" className="gap-2"><ExternalLink className="h-4 w-4" /> View live</Button>
        </a>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile">Brand profile</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
          </TabsList>
          <TabsContent value="profile" className="space-y-4 pt-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <div className="space-y-1">
                <Label className="text-xs">Theme</Label>
                <Select value={form.theme || "editorial"} onValueChange={(v) => setForm({ ...form, theme: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {THEME_PRESETS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field label="Accent color (hex)" value={form.accent_hex} onChange={(v) => setForm({ ...form, accent_hex: v })} />
              <Field label="Hero title" value={form.hero_title} onChange={(v) => setForm({ ...form, hero_title: v })} className="sm:col-span-2" />
              <Field label="Hero subtitle" value={form.hero_subtitle} onChange={(v) => setForm({ ...form, hero_subtitle: v })} className="sm:col-span-2" />
              <Field label="Hero image URL" value={form.hero_image_url} onChange={(v) => setForm({ ...form, hero_image_url: v })} />
              <Field label="Logo URL" value={form.logo_url} onChange={(v) => setForm({ ...form, logo_url: v })} />
              <Field label="Contact email" value={form.contact_email} onChange={(v) => setForm({ ...form, contact_email: v })} />
              <Field label="Contact phone" value={form.contact_phone} onChange={(v) => setForm({ ...form, contact_phone: v })} />
              <div className="sm:col-span-2">
                <Label className="text-xs">About (plain text or markdown)</Label>
                <Textarea rows={6} value={form.about_md} onChange={(e) => setForm({ ...form, about_md: e.target.value })} />
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Storefront is live
              </label>
            </div>
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </TabsContent>
          <TabsContent value="products" className="pt-4 space-y-6">
            <StoreLink sf={sf} onChange={(store_id) => onUpdate({ ...sf, store_id })} />
            {!sf.store_id && <ProductCuration storefrontId={sf.id} />}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      <Input value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ProductCuration({ storefrontId }: { storefrontId: string }) {
  const [items, setItems] = useState<SfProduct[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: links } = await supabase
      .from("storefront_products").select("*").eq("storefront_id", storefrontId).order("position");
    const ids = (links || []).map((l: any) => l.product_id);
    let prodMap = new Map<string, any>();
    if (ids.length) {
      const { data: prods } = await supabase
        .from("products").select("id,name,price,image_url,stock_quantity").in("id", ids);
      prodMap = new Map((prods || []).map((p: any) => [p.id, p]));
    }
    setItems((links || []).map((l: any) => ({ ...l, product: prodMap.get(l.product_id) })));
    setLoading(false);
  }
  useEffect(() => { load(); }, [storefrontId]);

  async function runSearch(q: string) {
    setSearch(q);
    if (!q.trim()) { setResults([]); return; }
    const existingIds = new Set(items.map((i) => i.product_id));
    const { data } = await supabase
      .from("products")
      .select("id,name,price,image_url,stock_quantity,is_active")
      .ilike("name", `%${q}%`)
      .eq("is_active", true)
      .limit(15);
    setResults((data || []).filter((p: any) => !existingIds.has(p.id)));
  }

  async function add(productId: string) {
    const nextPos = items.length;
    await supabase.from("storefront_products").insert({
      storefront_id: storefrontId, product_id: productId, position: nextPos,
    });
    setResults((r) => r.filter((p) => p.id !== productId));
    load();
  }

  async function remove(id: string) {
    await supabase.from("storefront_products").delete().eq("id", id);
    load();
  }

  async function toggleFeatured(it: SfProduct) {
    await supabase.from("storefront_products").update({ is_featured: !it.is_featured }).eq("id", it.id);
    load();
  }

  async function move(it: SfProduct, dir: -1 | 1) {
    const idx = items.findIndex((i) => i.id === it.id);
    const swap = items[idx + dir];
    if (!swap) return;
    await Promise.all([
      supabase.from("storefront_products").update({ position: swap.position }).eq("id", it.id),
      supabase.from("storefront_products").update({ position: it.position }).eq("id", swap.id),
    ]);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-xs">Add a product</Label>
        <Input placeholder="Search products by name…" value={search} onChange={(e) => runSearch(e.target.value)} />
        {results.length > 0 && (
          <div className="mt-2 border border-border rounded-lg divide-y divide-border max-h-64 overflow-auto">
            {results.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-2 hover:bg-muted/50">
                <div className="h-10 w-10 bg-muted rounded overflow-hidden flex-shrink-0">
                  {p.image_url && <img src={p.image_url} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">৳{p.price} · stock {p.stock_quantity}</div>
                </div>
                <Button size="sm" onClick={() => add(p.id)} className="gap-1"><Plus className="h-3 w-3" /> Add</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Curated products ({items.length})</h3>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products yet. Search above to add some.</p>
        ) : (
          <div className="border border-border rounded-lg divide-y divide-border">
            {items.map((it, idx) => (
              <div key={it.id} className="flex items-center gap-3 p-3">
                <div className="text-xs text-muted-foreground w-6 text-center">{idx + 1}</div>
                <div className="h-12 w-12 bg-muted rounded overflow-hidden flex-shrink-0">
                  {it.product?.image_url && <img src={it.product.image_url} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{it.product?.name || "(deleted product)"}</div>
                  <div className="text-xs text-muted-foreground">৳{it.product?.price ?? "—"}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => move(it, -1)} disabled={idx === 0} aria-label="Move up"><ChevronUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => move(it, 1)} disabled={idx === items.length - 1} aria-label="Move down"><ChevronDown className="h-4 w-4" /></Button>
                <Button size="icon" variant={it.is_featured ? "default" : "ghost"} onClick={() => toggleFeatured(it)} title="Toggle featured" aria-label="Toggle featured">
                  <Star className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => remove(it.id)} className="text-destructive" aria-label="Remove item">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StoreLink({ sf, onChange }: { sf: Storefront; onChange: (store_id: string | null) => void }) {
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("stores").select("id,name").order("name").then(({ data }) => setStores(data || []));
  }, []);

  async function update(store_id: string | null) {
    setSaving(true);
    const { error } = await supabase.from("storefronts").update({ store_id }).eq("id", sf.id);
    setSaving(false);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
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
              Leave unlinked to curate products manually below.
            </p>
            <div className="flex gap-2 items-center">
              <Select value={sf.store_id ?? "none"} onValueChange={(v) => update(v === "none" ? null : v)} disabled={saving}>
                <SelectTrigger className="max-w-sm"><SelectValue placeholder="Select a store…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None (manual curation) —</SelectItem>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
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

function CreateStorefrontDialog({ open, onOpenChange, onCreate }: { open: boolean, onOpenChange: (open: boolean) => void, onCreate: (sf: any) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [theme, setTheme] = useState("editorial");
  const [saving, setSaving] = useState(false);

  // Auto-generate slug from name if user hasn't explicitly typed one
  useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setTheme("editorial");
    }
  }, [open]);

  function handleNameChange(val: string) {
    setName(val);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !slug) return;
    
    setSaving(true);
    
    // Default accent colors based on theme picked
    const defaultAccents: Record<string, string> = {
      editorial: "#814037",
      cinematic: "#ffffff",
      minimal: "#000000",
      warm: "#b56149"
    };

    const { data: storeData } = await supabase.from('stores').select('id, store_currency').limit(1).single();
    
    const { data, error } = await supabase.from("storefronts").insert({
      name,
      slug,
      theme,
      accent_hex: defaultAccents[theme] || "#000000",
      store_id: storeData?.id || null,
      currency: storeData?.store_currency || "BDT"
    }).select().single();
    
    setSaving(false);
    
    if (error) {
      toast({ title: "Failed to create", description: error.message, variant: "destructive" });
    } else if (data) {
      toast({ title: "Storefront created successfully" });
      onCreate(data);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> New Storefront
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>Create new storefront</DialogTitle>
            <DialogDescription>
              Launch a new native storefront brand. You can configure domains and content later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-6">
            <div className="grid gap-2">
              <Label htmlFor="name">Storefront Name</Label>
              <Input id="name" value={name} onChange={(e) => handleNameChange(e.target.value)} required placeholder="e.g. My Brand" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slug">URL Slug</Label>
              <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required placeholder="e.g. my-brand" />
              <p className="text-xs text-muted-foreground">Will be accessible at shohoz.biz/storefront/{slug || '...'}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="theme">Initial Theme</Label>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THEME_PRESETS.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <div>
                        <div>{t.label}</div>
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !name || !slug}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
