import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, X, FileText } from "lucide-react";

interface InvoiceSettings {
  id: string;
  business_name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string;
  footer_text: string;
  terms_text: string;
}

const InvoiceSettingsTab = () => {
  const [settings, setSettings] = useState<InvoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase
      .from("invoice_settings" as any)
      .select("*")
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setSettings(data as any);
      });
  }, []);

  const updateField = (field: keyof InvoiceSettings, value: string) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !settings) return;

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
    const path = `logo-${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from("invoice-assets")
      .upload(path, file, { upsert: true });

    if (error) {
      toast.error("Upload failed");
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("invoice-assets")
      .getPublicUrl(path);

    updateField("logo_url", urlData.publicUrl);
    setUploading(false);
    toast.success("Logo uploaded");
  };

  const removeLogo = () => {
    if (!settings) return;
    updateField("logo_url", "");
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);

    const { error } = await supabase
      .from("invoice_settings" as any)
      .update({
        business_name: settings.business_name,
        tagline: settings.tagline,
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        logo_url: settings.logo_url,
        footer_text: settings.footer_text,
        terms_text: settings.terms_text,
      } as any)
      .eq("id", settings.id);

    setSaving(false);
    if (error) {
      toast.error("Failed to save");
    } else {
      toast.success("Invoice settings saved");
    }
  };

  if (!settings) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Invoice Template</h2>
          <p className="text-sm text-muted-foreground">
            Customize how your printed invoices and receipts look.
          </p>
        </div>

        {/* Logo */}
        <div className="space-y-2">
          <Label>Business Logo</Label>
          <div className="flex items-center gap-4">
            {settings.logo_url ? (
              <div className="relative">
                <img
                  src={settings.logo_url}
                  alt="Logo"
                  className="h-16 w-auto rounded-md border border-border object-contain bg-white p-1"
                />
                <button
                  onClick={removeLogo}
                  className="absolute -top-2 -right-2 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex h-16 w-24 items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground">
                <FileText className="h-6 w-6" />
              </div>
            )}
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5"
              >
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Upload Logo"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">PNG or JPG, max 2MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoUpload}
            />
          </div>
        </div>

        {/* Business Info */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Business Name</Label>
              <Input
                value={settings.business_name}
                onChange={(e) => updateField("business_name", e.target.value)}
                placeholder="Your Business Name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tagline / Subtitle</Label>
              <Input
                value={settings.tagline}
                onChange={(e) => updateField("tagline", e.target.value)}
                placeholder="e.g. Fashion & Tailoring"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Business Address</Label>
            <Textarea
              value={settings.address}
              onChange={(e) => updateField("address", e.target.value)}
              placeholder="Street, City, Country"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={settings.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                placeholder="+880 1XXX-XXXXXX"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                value={settings.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="info@yourbusiness.com"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Footer & Terms</h2>
          <p className="text-sm text-muted-foreground">
            These appear at the bottom of every invoice.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Footer Text</Label>
            <Input
              value={settings.footer_text}
              onChange={(e) => updateField("footer_text", e.target.value)}
              placeholder="Thank you for shopping with us!"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Terms & Conditions</Label>
            <Textarea
              value={settings.terms_text}
              onChange={(e) => updateField("terms_text", e.target.value)}
              placeholder="Return policy, warranty info, etc."
              rows={3}
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Invoice Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceSettingsTab;
