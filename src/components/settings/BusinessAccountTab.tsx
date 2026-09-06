import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Building2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logChange } from "@/lib/auditLog";
import { slugify } from "@/lib/slug";
import { useBusinessContext, type Business } from "@/hooks/useBusinessContext";
import { SettingsSection, SaveButton, LabelWithHint } from "./SettingsSection";

const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "MYR", "SAR", "AED"];
const TIMEZONES = [
  "Asia/Dhaka",
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
];

interface BusinessDraft {
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  address: string;
  email: string;
  phone: string;
  logo_url: string;
}

const draftFromBusiness = (b: Business): BusinessDraft => ({
  name: b.name,
  slug: b.slug,
  currency: b.currency || "BDT",
  timezone: b.timezone || "Asia/Dhaka",
  address: b.address || "",
  email: b.email || "",
  phone: b.phone || "",
  logo_url: b.logo_url || "",
});

export default function BusinessAccountTab() {
  const { active, loading, refresh } = useBusinessContext();
  const [draft, setDraft] = useState<BusinessDraft | null>(null);
  const [original, setOriginal] = useState<BusinessDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-seed the draft when a DIFFERENT business becomes active. Keyed on id so
  // an unrelated context refresh never wipes in-progress edits mid-typing.
  useEffect(() => {
    if (!active) {
      setDraft(null);
      setOriginal(null);
      return;
    }
    const d = draftFromBusiness(active);
    setDraft(d);
    setOriginal(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const update = (key: keyof BusinessDraft, value: string) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const handleLogoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !active) return;
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
    const path = `business-${active.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("invoice-assets").upload(path, file, { upsert: true });
    if (error) {
      toast.error("Upload failed");
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("invoice-assets").getPublicUrl(path);
    update("logo_url", urlData.publicUrl);
    setUploading(false);
    toast.success("Logo uploaded — remember to save");
  };

  const handleSave = async () => {
    if (!active || !draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error("Business name is required");
      return;
    }
    const slug = slugify(draft.slug) || slugify(name);
    if (!slug) {
      toast.error("Slug is required");
      return;
    }
    setSaving(true);
    const next: BusinessDraft = { ...draft, name, slug };
    const { error } = await supabase
      .from("businesses")
      .update({
        name: next.name,
        slug: next.slug,
        currency: next.currency,
        timezone: next.timezone,
        address: next.address || null,
        email: next.email || null,
        phone: next.phone || null,
        logo_url: next.logo_url || null,
      })
      .eq("id", active.id);
    setSaving(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "That slug is already taken by another business"
          : "Failed to save business account",
      );
      return;
    }
    await logChange("business_account", active.id, original, next);
    setOriginal(next);
    setDraft(next);
    await refresh();
    toast.success("Business account saved");
  };

  if (loading || (active && !draft)) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (!active) {
    return <CreateBusinessForm />;
  }

  return (
    <SettingsSection
      title="Business Account"
      description="Details for the business selected in the sidebar switcher. Used across DokanOS."
      icon={Building2}
      footer={<SaveButton saving={saving} onClick={handleSave} label="Save Business" />}
    >
      {/* Logo */}
      <div className="space-y-2">
        <Label>Business Logo</Label>
        <div className="flex items-center gap-4">
          {draft?.logo_url ? (
            <div className="relative">
              <img src={draft.logo_url} alt="Business logo" className="h-16 w-auto rounded-md border border-border object-contain bg-white p-1" />
              <button
                onClick={() => update("logo_url", "")}
                className="absolute -top-2 -right-2 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                aria-label="Remove logo"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex h-16 w-24 items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground">
              <Building2 className="h-6 w-6" />
            </div>
          )}
          <div>
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Uploading…" : "Upload Logo"}
            </Button>
            <p className="text-xs text-muted-foreground mt-1">PNG or JPG, max 2MB</p>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Business Name</Label>
          <Input value={draft?.name ?? ""} onChange={(e) => update("name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <LabelWithHint hint="Platform identifier. Lowercase letters, numbers and hyphens — must be unique across businesses.">
            Slug
          </LabelWithHint>
          <Input value={draft?.slug ?? ""} onChange={(e) => update("slug", e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Currency</Label>
          <Select value={draft?.currency ?? ""} onValueChange={(v) => update("currency", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              {(draft && !CURRENCIES.includes(draft.currency) ? [draft.currency, ...CURRENCIES] : CURRENCIES).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Timezone</Label>
          <Select value={draft?.timezone ?? ""} onValueChange={(v) => update("timezone", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {(draft && !TIMEZONES.includes(draft.timezone) ? [draft.timezone, ...TIMEZONES] : TIMEZONES).map((tz) => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Address</Label>
        <Textarea value={draft?.address ?? ""} onChange={(e) => update("address", e.target.value)} rows={2} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input value={draft?.phone ?? ""} onChange={(e) => update("phone", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" value={draft?.email ?? ""} onChange={(e) => update("email", e.target.value)} />
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * Fresh-install path: no businesses exist for this sign-in yet. Platform
 * admins (the first user) can provision the first business here; staff
 * accounts are blocked by RLS and pointed at an admin.
 */
function CreateBusinessForm() {
  const { refresh } = useBusinessContext();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Business name is required");
      return;
    }
    const finalSlug = slugify(slugTouched ? slug : trimmed);
    if (!finalSlug) {
      toast.error("Slug is required");
      return;
    }
    setCreating(true);
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .insert({ name: trimmed, slug: finalSlug, currency: "BDT", timezone: "Asia/Dhaka" })
      .select("id")
      .single();
    if (bizErr || !biz) {
      setCreating(false);
      toast.error(
        bizErr?.code === "23505"
          ? "That slug is already taken"
          : "Could not create the business — only account admins can provision new businesses",
      );
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      toast.error("Session expired — please sign in again");
      return;
    }
    const { error: accessErr } = await supabase.from("user_business_access").insert({
      user_id: user.id,
      business_id: biz.id,
      role: "owner",
    });
    if (accessErr) {
      setCreating(false);
      toast.error("Business created, but linking your membership failed: " + accessErr.message);
      return;
    }
    setCreating(false);
    await logChange("business_account", biz.id, null, { name: trimmed, slug: finalSlug }, undefined, { action: "create" });
    await refresh();
    toast.success(`Business "${trimmed}" created`);
  };

  return (
    <SettingsSection
      title="Business Account"
      description="No business account exists yet for your sign-in. Create one to organize brands, locations and channels."
      icon={Building2}
      footer={<SaveButton saving={creating} onClick={handleCreate} label="Create Business" />}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Business Name</Label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            placeholder="e.g. Enveil Vincent"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Slug</Label>
          <Input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="auto-generated from name"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Currency and timezone start at BDT / Asia/Dhaka and can be changed after creation.
      </p>
    </SettingsSection>
  );
}
