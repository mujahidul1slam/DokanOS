import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Image as ImageIcon, Plus, Upload, X } from "lucide-react";
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
import { useBusinessContext, type Brand } from "@/hooks/useBusinessContext";
import { SettingsSection } from "./SettingsSection";

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
  const [drafts, setDrafts] = useState<Record<string, BrandDraft>>({});
  const [originals, setOriginals] = useState<Record<string, BrandDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
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
          <BrandCard
            key={brand.id}
            brand={brand}
            draft={drafts[brand.id]}
            dirty={isDirty(brand.id)}
            saving={savingId === brand.id}
            onField={updateField}
            onSave={() => handleSave(brand)}
          />
        ))}
      </div>
    </SettingsSection>
  );
}

function BrandCard({
  brand,
  draft,
  dirty,
  saving,
  onField,
  onSave,
}: {
  brand: Brand;
  draft?: BrandDraft;
  dirty: boolean;
  saving: boolean;
  onField: (id: string, key: keyof BrandDraft, value: string | boolean) => void;
  onSave: () => void;
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
          <Button size="sm" disabled={saving || !dirty} onClick={onSave} className="min-w-[72px]">
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

