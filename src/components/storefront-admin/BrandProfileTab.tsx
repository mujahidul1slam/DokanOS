import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { AiContentDialog, Field, type GeneratedContent, type Storefront } from "./shared";

/** Brand profile tab (refactor of the old "profile" TabsContent — no behavior change). */
export default function BrandProfileTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [form, setForm] = useState(sf);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(sf), [sf]);

  /** Fill the form with AI-generated content (nothing is saved until Save changes). */
  function applyGenerated(c: GeneratedContent) {
    setForm((f) => ({
      ...f,
      hero_title: c.hero_title || f.hero_title,
      hero_subtitle: c.hero_subtitle || f.hero_subtitle,
      about_md: c.about_md || f.about_md,
      policies: { ...(f.policies || {}), ...(c.policies || {}) } as Record<string, string>,
    }));
  }

  async function save() {
    setSaving(true);
    const { data, error } = await supabase
      .from("storefronts")
      .update({
        name: form.name,
        hero_title: form.hero_title,
        hero_subtitle: form.hero_subtitle,
        hero_image_url: form.hero_image_url,
        logo_url: form.logo_url,
        about_md: form.about_md,
        contact_email: form.contact_email,
        contact_phone: form.contact_phone,
        accent_hex: form.accent_hex,
        is_active: form.is_active,
        theme: form.theme,
        favicon_url: form.favicon_url,
        social: form.social || {},
        policies: form.policies || {},
      })
      .eq("id", form.id)
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    onUpdate(data as any);
    toast({ title: "Saved" });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AiContentDialog sf={sf} onApply={applyGenerated} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        {/* Theme & accent moved to the Theme & Styling group (overhaul 5.2):
            admin panel → Theme. Identity keeps name, logos, hero, contact only. */}
        <div className="space-y-1 sm:col-span-2 rounded-md border border-dashed border-border p-3">
          <p className="text-xs text-muted-foreground">
            Theme & accent color live in <b>Theme & Styling → Theme</b> now. Identity keeps brand info only.
          </p>
        </div>
        <Field label="Hero title" value={form.hero_title} onChange={(v) => setForm({ ...form, hero_title: v })} className="sm:col-span-2" />
        <Field label="Hero subtitle" value={form.hero_subtitle} onChange={(v) => setForm({ ...form, hero_subtitle: v })} className="sm:col-span-2" />
        <Field label="Hero image URL" value={form.hero_image_url} onChange={(v) => setForm({ ...form, hero_image_url: v })} />
        <Field label="Logo URL" value={form.logo_url} onChange={(v) => setForm({ ...form, logo_url: v })} />
        <Field label="Favicon URL" value={form.favicon_url} onChange={(v) => setForm({ ...form, favicon_url: v })} />
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
    </div>
  );
}
