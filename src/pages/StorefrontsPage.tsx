import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";
import { invalidateSlugCache } from "@/storefront/lib/brand";
import type { Storefront } from "@/storefront/lib/brand";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { THEME_PRESETS } from "@/components/storefront-admin/shared";
import StorefrontAdminShell from "@/components/storefront-admin/StorefrontAdminShell";
import { StorefrontOverview } from "@/components/storefront-admin/AdminPages";
import StorefrontAdminEditor from "@/components/storefront-admin/StorefrontAdminEditor";

/**
 * Storefronts (overhaul 2.1 / fix C + D): clicking "Storefronts" in the main
 * sidebar renders the admin panel DIRECTLY — no secondary page, no button.
 * The legacy tabbed editor is removed. Storefront switching happens in the
 * panel header; each storefront shows its brand (2.2).
 *
 * URL forms handled:
 *   /storefronts                          → last-used (or first) storefront, Overview
 *   /storefronts/:slug/admin              → that storefront, Overview
 *   /storefronts/:slug/admin/<surface>    → that storefront, that surface
 */
const LAST_SF_KEY = "dokanos-admin-last-storefront";

function useSlugFromUrl(): string | undefined {
  const loc = useLocation();
  const m = loc.pathname.match(/^\/storefronts\/([^/]+)(?:\/|$)/);
  return m?.[1];
}
function useSurfaceFromUrl(): string | null {
  const loc = useLocation();
  const m = loc.pathname.match(/^\/storefronts\/[^/]+\/admin\/([^/]+)/);
  return m?.[1] || null;
}

export default function StorefrontsPage() {
  const navigate = useNavigate();
  const urlSlug = useSlugFromUrl();
  const urlSurface = useSurfaceFromUrl();
  const [list, setList] = useState<Storefront[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  async function reload() {
    const { data } = await supabase.from("storefronts").select("*").order("name");
    setList((data as any) || []);
    invalidateSlugCache();
    return data;
  }

  useEffect(() => {
    reload().then(() => setLoading(false));
  }, []);

  // Resolve the active storefront: URL slug → last-used → first
  const active =
    (urlSlug && list.find((s) => s.slug === urlSlug)) ||
    list.find((s) => s.slug === localStorage.getItem(LAST_SF_KEY)) ||
    list[0] ||
    null;

  // Persist the selection for plain /storefronts visits
  useEffect(() => {
    if (active) localStorage.setItem(LAST_SF_KEY, active.slug);
  }, [active?.slug]);

  const surface = urlSurface || "dashboard";

  // Keep the URL in sync when the resolved storefront differs from the URL
  // (e.g. plain /storefronts → /storefronts/<slug>/admin/dashboard).
  useEffect(() => {
    if (!loading && active && (!urlSlug || urlSlug !== active.slug)) {
      navigate(`/storefronts/${active.slug}/admin/${surface}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, active?.slug, urlSlug]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  if (!active) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center space-y-4">
        <h1 className="text-2xl font-semibold">Storefronts</h1>
        <p className="text-sm text-muted-foreground">No storefronts yet. Create your first one to get started.</p>
        <CreateStorefrontDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreate={async (newSf) => { await reload(); navigate(`/storefronts/${newSf.slug}/admin/dashboard`); }}
          autoOpen
        />
      </div>
    );
  }

  return (
    <StorefrontAdminShell
      sfOverride={active}
      list={list}
      onSwitch={(s) => navigate(`/storefronts/${s.slug}/admin/${surface}`)}
      onCreate={() => setCreateOpen(true)}
    >
      <StorefrontAdminEditor sf={active} surface={surface} onUpdate={(s) => {
        setList((l) => l.map((x) => (x.id === s.id ? s : x)));
        invalidateSlugCache();
      }} />
      <CreateStorefrontDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (newSf) => { await reload(); navigate(`/storefronts/${newSf.slug}/admin/dashboard`); }}
      />
    </StorefrontAdminShell>
  );
}

/* ---------------- Create storefront (fix D: brand picker + auto-create) ---------------- */

function CreateStorefrontDialog({ open, onOpenChange, onCreate, autoOpen }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (sf: any) => void;
  /** Empty-state mode: the trigger button is hidden (page auto-opens the dialog). */
  autoOpen?: boolean;
}) {
  const { active: activeBusiness } = useBusinessContext();
  const businessId = activeBusiness?.id ?? null;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [theme, setTheme] = useState("editorial");
  const [brandChoice, setBrandChoice] = useState<string>("__new");
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  // Brands of the active business (fix D: pick existing instead of always creating)
  useEffect(() => {
    if (!businessId) { setBrands([]); return; }
    supabase.from("brands").select("id,name").eq("business_id", businessId).order("name")
      .then(({ data }) => setBrands((data as any) || []));
  }, [businessId, open]);

  useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setTheme("editorial");
      setBrandChoice("__new");
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

    const defaultAccents: Record<string, string> = {
      editorial: "#814037",
      cinematic: "#ffffff",
      minimal: "#000000",
      warm: "#b56149",
      nimbus: "#2563EB",
      saffron: "#C2410C",
    };

    const { data: storeData } = await supabase.from("stores").select("id").limit(1).maybeSingle();

    // Overhaul 2.2 + fix D: brand is the root container. Use the picked
    // existing brand; "__new" auto-creates one matching the storefront name.
    let brandId: string | null = null;
    if (businessId) {
      if (brandChoice !== "__new" && brands.some((b) => b.id === brandChoice)) {
        brandId = brandChoice;
      } else {
        const { data: brandRow, error: brandErr } = await supabase
          .from("brands")
          .insert({ name: name.trim(), slug: slug.trim(), business_id: businessId })
          .select()
          .single();
        if (brandErr) {
          toast({ title: "Brand creation failed", description: brandErr.message, variant: "destructive" });
        }
        brandId = (brandRow as any)?.id ?? null;
      }
    }

    const { data, error } = await supabase.from("storefronts").insert({
      name,
      slug,
      theme,
      accent_hex: defaultAccents[theme] || "#000000",
      store_id: storeData?.id || null,
      brand_id: brandId,
      currency: "BDT",
    }).select().single();

    setSaving(false);
    if (error) {
      toast({ title: "Failed to create", description: error.message, variant: "destructive" });
    } else if (data) {
      // Overhaul 3.3: scaffold essential pages (Home + themed starter sections + Contact)
      try {
        const { scaffoldStorefront } = await import("@/storefront/lib/pages");
        await scaffoldStorefront((data as any).id, name, theme);
      } catch {
        /* scaffolding is best-effort; page creation can continue manually */
      }
      toast({ title: "Storefront created", description: "Starter pages (Home, Contact) were scaffolded." });
      onCreate(data);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!autoOpen && (
        <DialogTrigger asChild>
          <Button variant="default" size="sm" className="gap-2">
            <Plus className="h-4 w-4" /> New Storefront
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>Create new storefront</DialogTitle>
            <DialogDescription>
              Launch a new native storefront under a brand. Starter pages are created automatically.
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
              <p className="text-xs text-muted-foreground">Will be accessible at /storefront/{slug || "..."}</p>
            </div>
            <div className="grid gap-2">
              <Label>Brand</Label>
              <Select value={brandChoice} onValueChange={setBrandChoice}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a brand…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__new">Create new brand (“{name || "name"}”)</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Every storefront belongs to a brand — pick an existing one or create a new one.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="theme">Initial Theme</Label>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THEME_PRESETS.map((t) => (
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
