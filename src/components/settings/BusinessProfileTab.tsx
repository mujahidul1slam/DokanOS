import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, X, FileText } from "lucide-react";
import { logAction } from "@/lib/auditLog";
import { SettingsSection, SaveButton } from "./SettingsSection";

interface BusinessProfile {
  id: string;
  business_name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string;
}

export default function BusinessProfileTab() {
  const [data, setData] = useState<BusinessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase
      .from("invoice_settings" as any)
      .select("id, business_name, tagline, address, phone, email, logo_url")
      .limit(1)
      .single()
      .then(({ data: row }: any) => {
        if (row) setData(row);
      });
  }, []);

  const update = (key: keyof BusinessProfile, value: string) => {
    if (!data) return;
    setData({ ...data, [key]: value });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !data) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Logo must be under 2MB"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("invoice-assets").upload(path, file, { upsert: true });
    if (error) { toast.error("Upload failed"); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("invoice-assets").getPublicUrl(path);
    update("logo_url", urlData.publicUrl);
    setUploading(false);
    toast.success("Logo uploaded");
  };

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    const { error } = await supabase
      .from("invoice_settings" as any)
      .update({
        business_name: data.business_name,
        tagline: data.tagline,
        address: data.address,
        phone: data.phone,
        email: data.email,
        logo_url: data.logo_url,
      } as any)
      .eq("id", data.id);
    setSaving(false);
    if (error) { toast.error("Failed to save"); return; }
    await logAction("update", "business_profile", data.id, {
      business_name: data.business_name,
      phone: data.phone,
      email: data.email,
    });
    toast.success("Business profile saved");
  };

  if (!data) {
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
      title="Business Profile"
      description="Appears on invoices, pickup slips and measurement slips."
      footer={<SaveButton saving={saving} onClick={handleSave} label="Save Profile" />}
    >
      {/* Logo */}
      <div className="space-y-2">
        <Label>Business Logo</Label>
        <div className="flex items-center gap-4">
          {data.logo_url ? (
            <div className="relative">
              <img src={data.logo_url} alt="Logo" className="h-16 w-auto rounded-md border border-border object-contain bg-white p-1" />
              <button onClick={() => update("logo_url", "")} className="absolute -top-2 -right-2 rounded-full bg-destructive p-0.5 text-destructive-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex h-16 w-24 items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground">
              <FileText className="h-6 w-6" />
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
          <Input value={data.business_name} onChange={(e) => update("business_name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Tagline</Label>
          <Input value={data.tagline || ""} onChange={(e) => update("tagline", e.target.value)} placeholder="Optional short tagline" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Address</Label>
        <Textarea value={data.address || ""} onChange={(e) => update("address", e.target.value)} rows={2} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input value={data.phone || ""} onChange={(e) => update("phone", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" value={data.email || ""} onChange={(e) => update("email", e.target.value)} />
        </div>
      </div>
    </SettingsSection>
  );
}
