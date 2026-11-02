import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Image as ImageIcon, Loader2, Plus, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logChange } from "@/lib/auditLog";
import { slugify } from "@/lib/slug";
import { defaultPathaoStoreForAccount } from "@/lib/dispatchAccounts";
import { useBusinessContext, type Brand } from "@/hooks/useBusinessContext";
import { useRegisterDirty } from "@/hooks/useSettingsDirty";
import { SettingsSection, SettingsSaveHandler } from "./SettingsSection";

interface BrandDraft {
  name: string;
  slug: string;
  logo_url: string;
  is_active: boolean;
}

const draftFromBrand = (b: Brand): BrandDraft => ({
  name: b.name,
  slug: b.slug,
  logo_url: b.logo_url || "",
  is_active: b.is_active,
});

const sameDraft = (a?: BrandDraft | null, b?: BrandDraft | null) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export default function BrandSettingsTab() {
  const { active, brands, loading, refresh } = useBusinessContext();
  const setDirty = useRegisterDirty();
  const [drafts, setDrafts] = useState<Record<string, BrandDraft>>({});
  const [originals, setOriginals] = useState<Record<string, BrandDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  // Per-brand dirty flags for the "Order identity defaults" sub-sections
  // (Pathao Account), reported up by BrandIdentityDefaults.
  const [identityDirty, setIdentityDirty] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  // Sync local editable drafts from the context's brand list. In-progress
  // edits (draft differing from its server original) survive refetches;
  // saved rows re-seed from the fresh values.
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, BrandDraft> = {};
      for (const b of brands) {
        const fresh = draftFromBrand(b);
        next[b.id] = sameDraft(prev[b.id], fresh) ? fresh : prev[b.id] ?? fresh;
      }
      return next;
    });
    setOriginals(Object.fromEntries(brands.map((b): [string, BrandDraft] => [b.id, draftFromBrand(b)])));
  }, [brands]);

  const updateField = (id: string, key: keyof BrandDraft, value: string | boolean) => {
    setDrafts((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const updated = { ...current, [key]: value } as BrandDraft;
      return { ...prev, [id]: updated };
    });
  };

  const isDirty = (id: string) => !sameDraft(drafts[id], originals[id]);

  // Universal save: brand card drafts and the identity-default sections all
  // count towards the tab's dirty state so the sticky save bar and the
  // route-away guard cover every pending edit.
  const anyBrandDirty = brands.some((b) => isDirty(b.id));
  const anyIdentityDirty = Object.values(identityDirty).some(Boolean);
  useEffect(() => {
    setDirty(anyBrandDirty || anyIdentityDirty);
    return () => setDirty(false);
  }, [anyBrandDirty, anyIdentityDirty, setDirty]);

  const setIdentityDirtyFor = (brandId: string, dirty: boolean) => {
    setIdentityDirty((prev) => (prev[brandId] === dirty ? prev : { ...prev, [brandId]: dirty }));
  };

  const handleSave = async (brand: Brand) => {
    const draft = drafts[brand.id];
    const original = originals[brand.id];
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error("Brand name is required");
      return;
    }
    const slug = slugify(draft.slug) || slugify(name);
    if (!slug) {
      toast.error("Slug is required");
      return;
    }
    setSavingId(brand.id);
    const next: BrandDraft = { ...draft, name, slug };
    const { error } = await supabase
      .from("brands")
      .update({
        name: next.name,
        slug: next.slug,
        logo_url: next.logo_url || null,
        is_active: next.is_active,
      })
      .eq("id", brand.id);
    setSavingId(null);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "That name or slug is already in use"
          : "Failed to save brand",
      );
      return;
    }
    await logChange("brand", brand.id, original, next);
    setOriginals((prev) => ({ ...prev, [brand.id]: next }));
    setDrafts((prev) => ({ ...prev, [brand.id]: next }));
    await refresh();
    toast.success(`Brand "${next.name}" saved`);
  };

  /** Universal save: persist every dirty brand card, in list order. */
  const handleSaveAll = async () => {
    for (const brand of brands) {
      if (isDirty(brand.id)) await handleSave(brand);
    }
  };

  const handleCreate = async () => {
    if (!active) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error("Brand name is required");
      return;
    }
    const finalSlug = slugify(newSlug) || slugify(trimmed);
    if (!finalSlug) {
      toast.error("Slug is required");
      return;
    }
    setCreating(true);
    const { data, error } = await supabase
      .from("brands")
      .insert({ business_id: active.id, name: trimmed, slug: finalSlug })
      .select("id")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(
        error?.code === "23505"
          ? "A brand with that name or slug already exists"
          : "Failed to create brand",
      );
      return;
    }
    await logChange("brand", data.id, null, { business_id: active.id, name: trimmed, slug: finalSlug }, undefined, { action: "create" });
    setCreateOpen(false);
    setNewName("");
    setNewSlug("");
    setSlugTouched(false);
    await refresh();
    toast.success(`Brand "${trimmed}" created`);
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <SettingsSection
      title="Brand Settings"
      description={
        active
          ? `Selling identities under ${active.name}. Brands group locations, channels and catalogs.`
          : "Selling identities under your business."
      }
    >
      {/* Universal save: the sticky save bar commits every dirty brand card
          and the per-brand identity defaults. The former per-card and
          per-select Save buttons are gone. */}
      <SettingsSaveHandler
        label="Save Brands"
        disabled={savingId !== null || !anyBrandDirty}
        run={handleSaveAll}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {brands.length} brand{brands.length === 1 ? "" : "s"}
          {active ? ` under ${active.name}` : ""}
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" disabled={!active}>
              <Plus className="h-4 w-4" />
              New Brand
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New brand</DialogTitle>
              <DialogDescription>
                {active ? `Creates a selling identity under ${active.name}.` : "Creates a selling identity under your business."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label>Brand name</Label>
                <Input
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (!slugTouched) setNewSlug(slugify(e.target.value));
                  }}
                  placeholder="e.g. Enveil"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input
                  value={newSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setNewSlug(e.target.value);
                  }}
                  placeholder="auto-generated from name"
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, numbers and hyphens. Must be unique across the platform.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating || !active}>
                {creating ? "Creating…" : "Create brand"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {brands.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No brands yet. Brands are created automatically when a WooCommerce store is connected — or create one manually above.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {brands.map((brand) => (
          <div key={brand.id} className="space-y-3">
            <BrandCard
              brand={brand}
              draft={drafts[brand.id]}
              dirty={isDirty(brand.id)}
              onField={updateField}
            />
            <BrandIdentityDefaults
              brand={brand}
              onDirtyChange={(dirty) => setIdentityDirtyFor(brand.id, dirty)}
            />
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

function BrandCard({
  brand,
  draft,
  dirty,
  onField,
}: {
  brand: Brand;
  draft?: BrandDraft;
  dirty: boolean;
  onField: (id: string, key: keyof BrandDraft, value: string | boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2MB");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `brand-${brand.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("invoice-assets").upload(path, file, { upsert: true });
    if (error) {
      toast.error("Upload failed");
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("invoice-assets").getPublicUrl(path);
    onField(brand.id, "logo_url", urlData.publicUrl);
    setUploading(false);
    toast.success("Logo uploaded — remember to save");
  };

  if (!draft) return null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-4">
        {draft.logo_url ? (
          <div className="relative shrink-0">
            <img src={draft.logo_url} alt={`${draft.name} logo`} className="h-12 w-12 rounded-md border border-border object-contain bg-white p-0.5" />
            <button
              onClick={() => onField(brand.id, "logo_url", "")}
              className="absolute -top-2 -right-2 rounded-full bg-destructive p-0.5 text-destructive-foreground"
              aria-label="Remove logo"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground">
            <ImageIcon className="h-5 w-5" />
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              value={draft.name}
              onChange={(e) => onField(brand.id, "name", e.target.value)}
              className="h-8 max-w-xs"
            />
            {dirty && (
              <Badge variant="secondary" className="shrink-0">Unsaved</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={draft.slug}
              onChange={(e) => onField(brand.id, "slug", e.target.value)}
              className="h-8 max-w-[220px] font-mono text-xs"
            />
            {brand.woo_store_id ? (
              <Badge variant="outline" className="shrink-0">WooCommerce linked</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 text-muted-foreground">No store linked</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "…" : "Logo"}
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogo} />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Active</span>
            <Switch
              checked={draft.is_active}
              onCheckedChange={(v) => onField(brand.id, "is_active", v)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface IdentityPathaoIntegration {
  id: string;
  name: string;
  is_active: boolean;
}

interface IdentityPathaoStore {
  pathao_store_id: number;
  store_name: string;
}

interface IdentityPathaoLink {
  id: string;
  woo_store_id: string;
  pathao_integration_id: string;
  default_pathao_store_id: number | null;
}

/**
 * Existing-table defaults used by order entry and courier dispatch. Pathao
 * defaults live on the existing Woo-store-to-Pathao mapping (keyed by the
 * brand's woo_store_id). Task 16 retired selling_points, so there is no
 * per-brand default order source to set here — an order's source is chosen at
 * order entry. Pending edits are committed through the universal save bar
 * (SettingsSaveHandler) and reported to the parent for the tab-level dirty flag.
 */
function BrandIdentityDefaults({
  brand,
  onDirtyChange,
}: {
  brand: Brand;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [integrations, setIntegrations] = useState<IdentityPathaoIntegration[]>([]);
  const [pathaoStores, setPathaoStores] = useState<IdentityPathaoStore[]>([]);
  const [pathaoLink, setPathaoLink] = useState<IdentityPathaoLink | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [selectedPathaoStore, setSelectedPathaoStore] = useState("");
  // Server-side snapshots of the selections; a selection differing from its
  // snapshot is a pending edit the universal save must commit.
  const [savedIntegration, setSavedIntegration] = useState("");
  const [savedPathaoStore, setSavedPathaoStore] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingStores, setLoadingStores] = useState(false);
  const [savingPathao, setSavingPathao] = useState(false);
  // Set when the user switches the Default Courier (Pathao account): the new
  // account's default pickup store is auto-selected once its stores load.
  const autoPickDefaultStoreRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data: integrationData } = await supabase
        .from("pathao_integrations_safe" as any)
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;

      const activeIntegrations = (integrationData || []) as unknown as IdentityPathaoIntegration[];
      let link: IdentityPathaoLink | null = null;
      if (brand.woo_store_id) {
        const { data } = await supabase
          .from("pathao_store_links")
          .select("id, woo_store_id, pathao_integration_id, default_pathao_store_id")
          .eq("woo_store_id", brand.woo_store_id)
          .maybeSingle();
        link = (data || null) as IdentityPathaoLink | null;
      }

      setIntegrations(activeIntegrations);
      setPathaoLink(link);

      const linkedIntegration = link && activeIntegrations.some((item) => item.id === link!.pathao_integration_id)
        ? link.pathao_integration_id
        : "";
      const initialStore =
        linkedIntegration && link?.default_pathao_store_id != null
          ? String(link.default_pathao_store_id)
          : "";
      setSelectedIntegration(linkedIntegration);
      setSavedIntegration(linkedIntegration);
      setSelectedPathaoStore(initialStore);
      setSavedPathaoStore(initialStore);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [brand.id, brand.woo_store_id]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedIntegration) {
      setPathaoStores([]);
      setLoadingStores(false);
      return () => { cancelled = true; };
    }
    setLoadingStores(true);
    void (async () => {
      const { data } = await supabase
        .from("pathao_stores")
        .select("pathao_store_id, store_name")
        .eq("integration_id", selectedIntegration)
        .eq("is_active", true)
        .order("store_name");
      if (cancelled) return;
      const stores = (data || []) as IdentityPathaoStore[];
      setPathaoStores(stores);
      setSelectedPathaoStore((current) => {
        // Default Courier just changed: auto-select the new account's default
        // pickup store instead of keeping the old account's store or leaving
        // the field blank.
        if (autoPickDefaultStoreRef.current) {
          autoPickDefaultStoreRef.current = false;
          const accountDefault = defaultPathaoStoreForAccount(stores);
          return accountDefault ? String(accountDefault.pathao_store_id) : "";
        }
        return current && stores.some((store) => String(store.pathao_store_id) === current) ? current : "";
      });
      setLoadingStores(false);
    })();
    return () => { cancelled = true; };
  }, [selectedIntegration]);

  // A blank placeholder selection ("Choose …") is not a pending edit — the
  // save actions cannot persist it, so it must not dirty the tab either.
  const pathaoDirty =
    Boolean(selectedIntegration) &&
    (selectedIntegration !== savedIntegration || selectedPathaoStore !== savedPathaoStore);
  const dirty = pathaoDirty;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyChangeRef.current(dirty);
  }, [dirty]);

  const savePathaoDefault = async () => {
    if (!brand.woo_store_id) {
      toast.error("Connect a WooCommerce store to configure a default Pathao Account");
      return;
    }
    if (!selectedIntegration) {
      toast.error("Choose a Pathao Account first");
      return;
    }
    setSavingPathao(true);
    const payload = {
      woo_store_id: brand.woo_store_id,
      pathao_integration_id: selectedIntegration,
      default_pathao_store_id: selectedPathaoStore ? Number(selectedPathaoStore) : null,
    };
    const result = pathaoLink
      ? await supabase
          .from("pathao_store_links")
          .update({
            pathao_integration_id: payload.pathao_integration_id,
            default_pathao_store_id: payload.default_pathao_store_id,
          })
          .eq("id", pathaoLink.id)
          .select("id, woo_store_id, pathao_integration_id, default_pathao_store_id")
          .maybeSingle()
      : await supabase
          .from("pathao_store_links")
          .insert(payload)
          .select("id, woo_store_id, pathao_integration_id, default_pathao_store_id")
          .single();
    setSavingPathao(false);
    if (result.error) {
      toast.error(
        result.error.code === "42501"
          ? "You do not have permission to change Pathao defaults. Ask a platform admin."
          : result.error.message || "Could not save the Pathao Account default",
      );
      return;
    }
    if (result.data) setPathaoLink(result.data as IdentityPathaoLink);
    setSavedIntegration(selectedIntegration);
    setSavedPathaoStore(selectedPathaoStore);
    toast.success("Default Pathao Account saved");
  };

  return (
    <>
      {/* Universal save: the sticky save bar commits the pending Pathao
          Account default for this brand. */}
      <SettingsSaveHandler
        label="Save Pathao Accounts"
        disabled={savingPathao || !pathaoDirty || !selectedIntegration}
        run={savePathaoDefault}
      />
      <div className="rounded-lg border border-border bg-card/60 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Order identity defaults</h3>
        <p className="text-xs text-muted-foreground">
          Defaults used by Add Order and courier dispatch. The order's Brand and Order Source are chosen at order entry; the Pathao Account default below is what dispatch resolves against.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading identity defaults…
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Default Pathao Account</Label>
            {!brand.woo_store_id ? (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                Connect a WooCommerce store to this brand before linking its default Pathao Account.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <select
                    className="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    value={selectedIntegration}
                    onChange={(event) => {
                      // Changing the Default Courier: the new account's
                      // default pickup store is auto-selected once its stores
                      // load (see the stores effect above).
                      autoPickDefaultStoreRef.current = true;
                      setSelectedIntegration(event.target.value);
                    }}
                    disabled={integrations.length === 0}
                  >
                    <option value="">Choose a Pathao Account…</option>
                    {integrations.map((integration) => <option key={integration.id} value={integration.id}>{integration.name}</option>)}
                  </select>
                </div>
                {integrations.length === 0 && (
                  <p className="text-xs text-muted-foreground">No active Pathao Accounts. Add one under Integrations.</p>
                )}
                {selectedIntegration && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Default pickup store (optional)</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={selectedPathaoStore}
                      onChange={(event) => setSelectedPathaoStore(event.target.value)}
                      disabled={loadingStores}
                    >
                      <option value="">Choose later</option>
                      {pathaoStores.map((store) => <option key={store.pathao_store_id} value={String(store.pathao_store_id)}>{store.store_name}</option>)}
                    </select>
                    {pathaoStores.length === 0 && !loadingStores && (
                      <p className="text-xs text-muted-foreground">No active pickup stores cached for this account. Refresh its Pathao data under Integrations.</p>
                    )}
                  </div>
                )}
                {pathaoLink && !integrations.some((integration) => integration.id === pathaoLink.pathao_integration_id) && (
                  <p className="text-xs text-amber-600">The saved Pathao Account is inactive or unavailable; choose an active account to replace it.</p>
                )}
              </>
            )}
          </div>
        </>
      )}
      </div>
    </>
  );
}

