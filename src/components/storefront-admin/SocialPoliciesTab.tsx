import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { Field, type Storefront } from "./shared";

/** Social links + policies tab (refactor of the old "content" TabsContent). */
export default function SocialPoliciesTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [form, setForm] = useState(sf);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(sf), [sf]);

  /** Update a field inside a jsonb column (social / policies). */
  function setJson(key: "social" | "policies", field: string, value: string) {
    setForm((f) => ({
      ...f,
      [key]: { ...((f[key] as Record<string, string>) || {}), [field]: value } as Record<string, string>,
    }));
  }

  async function save() {
    setSaving(true);
    const { data, error } = await supabase
      .from("storefronts")
      .update({
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
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Social links</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Shown as icons in the storefront footer. Enter a username or a full URL.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Instagram" value={form.social?.instagram || ""} onChange={(v) => setJson("social", "instagram", v)} placeholder="yourbrand" />
          <Field label="Facebook" value={form.social?.facebook || ""} onChange={(v) => setJson("social", "facebook", v)} placeholder="yourbrand" />
          <Field label="TikTok" value={form.social?.tiktok || ""} onChange={(v) => setJson("social", "tiktok", v)} placeholder="@yourbrand" />
          <Field label="WhatsApp" value={form.social?.whatsapp || ""} onChange={(v) => setJson("social", "whatsapp", v)} placeholder="+8801XXXXXXXXX" />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium mb-1">Policies</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Markdown supported. Published on the storefront policies page and linked in the footer.
        </p>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Shipping policy</Label>
            <Textarea rows={4} value={form.policies?.shipping || ""} onChange={(e) => setJson("policies", "shipping", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Returns &amp; exchanges</Label>
            <Textarea rows={4} value={form.policies?.returns || ""} onChange={(e) => setJson("policies", "returns", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Privacy policy</Label>
            <Textarea rows={4} value={form.policies?.privacy || ""} onChange={(e) => setJson("policies", "privacy", e.target.value)} />
          </div>
        </div>
      </div>
      <Button onClick={save} disabled={saving} className="gap-2">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Save changes
      </Button>
    </div>
  );
}
