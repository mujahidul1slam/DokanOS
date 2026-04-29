import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, X, FileText, Plus, Trash2 } from "lucide-react";
import { logChange } from "@/lib/auditLog";
import type { InvoiceTemplateConfig, PickupSlipTemplateConfig } from "@/hooks/useInvoiceSettings";

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
  default_print_format: string;
  pickup_slip_print_format: string;
  invoice_template: InvoiceTemplateConfig;
  pickup_slip_template: PickupSlipTemplateConfig;
  shipping_presets: number[];
  shipping_inside_dhaka: number;
  shipping_outside_dhaka: number;
}

const defaultInvoiceTemplate: InvoiceTemplateConfig = {
  show_logo: true, show_tagline: true, show_address: true, show_contact: true,
  show_customer: true, show_customer_phone: true, show_customer_address: true,
  show_item_price: true, show_item_qty: true, show_item_total: true,
  show_subtotal: true, show_discount: true, show_shipping: true, show_tax: true,
  show_total: true, show_payments: true, show_notes: true, show_terms: true,
  show_footer: true, show_order_date: true, show_fulfillment: true,
  show_due: true,
  custom_fields: [],
};

const defaultPickupSlipTemplate: PickupSlipTemplateConfig = {
  show_order_number: true, show_customer_name: true, show_customer_phone: true,
  show_customer_address: true, show_items: true, show_item_qty: true,
  show_total: true, show_due: true, show_notes: false, title: "PICKUP SLIP",
  custom_fields: [],
};

const InvoiceSettingsTab = () => {
  const [settings, setSettings] = useState<InvoiceSettings | null>(null);
  const [original, setOriginal] = useState<InvoiceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase
      .from("invoice_settings" as any)
      .select("*")
      .limit(1)
      .single()
      .then(({ data }: any) => {
        if (data) {
          const merged: InvoiceSettings = {
            ...data,
            pickup_slip_print_format: data.pickup_slip_print_format || "thermal",
            invoice_template: { ...defaultInvoiceTemplate, ...(data.invoice_template || {}) },
            pickup_slip_template: { ...defaultPickupSlipTemplate, ...(data.pickup_slip_template || {}) },
            shipping_presets: data.shipping_presets || [80, 150],
            shipping_inside_dhaka: data.shipping_inside_dhaka ?? 80,
            shipping_outside_dhaka: data.shipping_outside_dhaka ?? 150,
          };
          setSettings(merged);
          setOriginal(merged);
        }
      });
  }, []);

  const updateField = (field: keyof InvoiceSettings, value: any) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  const updateInvoiceTemplate = (field: keyof InvoiceTemplateConfig, value: any) => {
    if (!settings) return;
    setSettings({ ...settings, invoice_template: { ...settings.invoice_template, [field]: value } });
  };

  const updatePickupTemplate = (field: keyof PickupSlipTemplateConfig, value: any) => {
    if (!settings) return;
    setSettings({ ...settings, pickup_slip_template: { ...settings.pickup_slip_template, [field]: value } });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !settings) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Logo must be under 2MB"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("invoice-assets").upload(path, file, { upsert: true });
    if (error) { toast.error("Upload failed"); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from("invoice-assets").getPublicUrl(path);
    updateField("logo_url", urlData.publicUrl);
    setUploading(false);
    toast.success("Logo uploaded");
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
        default_print_format: settings.default_print_format,
        pickup_slip_print_format: settings.pickup_slip_print_format,
        invoice_template: settings.invoice_template,
        pickup_slip_template: settings.pickup_slip_template,
        shipping_presets: settings.shipping_presets,
        shipping_inside_dhaka: settings.shipping_inside_dhaka,
        shipping_outside_dhaka: settings.shipping_outside_dhaka,
      } as any)
      .eq("id", settings.id);
    setSaving(false);
    if (error) { toast.error("Failed to save"); return; }
    const trackedKeys: (keyof InvoiceSettings)[] = [
      "business_name", "tagline", "address", "phone", "email", "logo_url", "footer_text", "terms_text",
      "default_print_format", "pickup_slip_print_format", "invoice_template", "pickup_slip_template",
      "shipping_presets", "shipping_inside_dhaka", "shipping_outside_dhaka",
    ];
    const pick = (s: InvoiceSettings | null) => {
      if (!s) return null;
      const o: Record<string, unknown> = {};
      trackedKeys.forEach((k) => (o[k as string] = (s as any)[k]));
      return o;
    };
    await logChange("invoice_settings", settings.id, pick(original), pick(settings));
    setOriginal(settings);
    toast.success("Invoice settings saved");
  };

  if (!settings) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
        </div>
      </div>
    );
  }

  const invoiceTpl = settings.invoice_template;
  const pickupTpl = settings.pickup_slip_template;

  return (
    <div className="space-y-4">
      {/* Business Info */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Invoice Template</h2>
          <p className="text-sm text-muted-foreground">Customize how your printed invoices and receipts look.</p>
        </div>

        {/* Logo */}
        <div className="space-y-2">
          <Label>Business Logo</Label>
          <div className="flex items-center gap-4">
            {settings.logo_url ? (
              <div className="relative">
                <img src={settings.logo_url} alt="Logo" className="h-16 w-auto rounded-md border border-border object-contain bg-white p-1" />
                <button onClick={() => updateField("logo_url", "")} className="absolute -top-2 -right-2 rounded-full bg-destructive p-0.5 text-destructive-foreground">
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

        {/* Fields */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Business Name</Label><Input value={settings.business_name} onChange={(e) => updateField("business_name", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Tagline</Label><Input value={settings.tagline} onChange={(e) => updateField("tagline", e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Address</Label><Textarea value={settings.address} onChange={(e) => updateField("address", e.target.value)} rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Phone</Label><Input value={settings.phone} onChange={(e) => updateField("phone", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input value={settings.email} onChange={(e) => updateField("email", e.target.value)} /></div>
          </div>
        </div>
      </div>

      {/* Print Format & Footer */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Print & Footer</h2>
          <p className="text-sm text-muted-foreground">Default print format and footer content.</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Default Invoice Print Format</Label>
            <Select value={settings.default_print_format} onValueChange={(v) => updateField("default_print_format", v)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thermal">Thermal (80mm)</SelectItem>
                <SelectItem value="a4">A4 Full Page</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used automatically when printing invoices — no popup.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Default Pickup Slip Print Format</Label>
            <Select value={settings.pickup_slip_print_format || "thermal"} onValueChange={(v) => updateField("pickup_slip_print_format", v)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thermal">Thermal (80mm)</SelectItem>
                <SelectItem value="a4">A4 (8 slips per page, landscape)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">A4 prints 8 pickup slips horizontally on one page.</p>
          </div>
          <div className="space-y-1.5"><Label>Footer Text</Label><Input value={settings.footer_text} onChange={(e) => updateField("footer_text", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Terms & Conditions</Label><Textarea value={settings.terms_text} onChange={(e) => updateField("terms_text", e.target.value)} rows={3} /></div>
        </div>
      </div>

      {/* Invoice Template Editor */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Invoice Element Visibility</h2>
          <p className="text-sm text-muted-foreground">Show or hide specific sections on the printed invoice.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {([
            ["show_logo", "Logo"],
            ["show_tagline", "Tagline"],
            ["show_address", "Business Address"],
            ["show_contact", "Phone & Email"],
            ["show_order_date", "Order Date"],
            ["show_fulfillment", "Fulfillment Type"],
            ["show_customer", "Customer Name"],
            ["show_customer_phone", "Customer Phone"],
            ["show_customer_address", "Customer Address"],
            ["show_item_price", "Item Unit Price"],
            ["show_item_qty", "Item Quantity"],
            ["show_item_total", "Item Line Total"],
            ["show_subtotal", "Subtotal"],
            ["show_discount", "Discount"],
            ["show_shipping", "Shipping"],
            ["show_tax", "Tax"],
            ["show_total", "Grand Total"],
            ["show_payments", "Payment Details"],
            ["show_notes", "Order Notes"],
            ["show_terms", "Terms & Conditions"],
            ["show_footer", "Footer Text"],
            ["show_due", "Due Amount"],
          ] as [keyof InvoiceTemplateConfig, string][]).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm">{label}</span>
              <Switch checked={!!invoiceTpl[key]} onCheckedChange={(v) => updateInvoiceTemplate(key, v)} />
            </div>
          ))}
        </div>

        {/* Custom fields */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Custom Fields</Label>
          {invoiceTpl.custom_fields.map((cf, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder="Label" value={cf.label} onChange={(e) => {
                const fields = [...invoiceTpl.custom_fields];
                fields[i] = { ...fields[i], label: e.target.value };
                updateInvoiceTemplate("custom_fields", fields);
              }} className="flex-1" />
              <Input placeholder="Value" value={cf.value} onChange={(e) => {
                const fields = [...invoiceTpl.custom_fields];
                fields[i] = { ...fields[i], value: e.target.value };
                updateInvoiceTemplate("custom_fields", fields);
              }} className="flex-1" />
              <Button variant="ghost" size="icon" onClick={() => {
                updateInvoiceTemplate("custom_fields", invoiceTpl.custom_fields.filter((_, j) => j !== i));
              }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => updateInvoiceTemplate("custom_fields", [...invoiceTpl.custom_fields, { label: "", value: "" }])} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Field
          </Button>
        </div>
      </div>

      {/* Pickup Slip Template Editor */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Pickup Slip Template</h2>
          <p className="text-sm text-muted-foreground">Configure what appears on pickup slips.</p>
        </div>

        <div className="space-y-1.5">
          <Label>Slip Title</Label>
          <Input value={pickupTpl.title} onChange={(e) => updatePickupTemplate("title", e.target.value)} className="w-64" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {([
            ["show_order_number", "Order Number"],
            ["show_customer_name", "Customer Name"],
            ["show_customer_phone", "Customer Phone"],
            ["show_customer_address", "Customer Address"],
            ["show_items", "Item List"],
            ["show_item_qty", "Item Quantity"],
            ["show_total", "Order Total"],
            ["show_notes", "Notes"],
          ] as [keyof PickupSlipTemplateConfig, string][]).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm">{label}</span>
              <Switch checked={!!pickupTpl[key]} onCheckedChange={(v) => updatePickupTemplate(key, v)} />
            </div>
          ))}
        </div>

        {/* Custom fields */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Custom Fields</Label>
          {pickupTpl.custom_fields.map((cf, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder="Label" value={cf.label} onChange={(e) => {
                const fields = [...pickupTpl.custom_fields];
                fields[i] = { ...fields[i], label: e.target.value };
                updatePickupTemplate("custom_fields", fields);
              }} className="flex-1" />
              <Input placeholder="Value" value={cf.value} onChange={(e) => {
                const fields = [...pickupTpl.custom_fields];
                fields[i] = { ...fields[i], value: e.target.value };
                updatePickupTemplate("custom_fields", fields);
              }} className="flex-1" />
              <Button variant="ghost" size="icon" onClick={() => {
                updatePickupTemplate("custom_fields", pickupTpl.custom_fields.filter((_, j) => j !== i));
              }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => updatePickupTemplate("custom_fields", [...pickupTpl.custom_fields, { label: "", value: "" }])} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Field
          </Button>
        </div>
      </div>

      {/* Shipping Cost Defaults */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Shipping Cost Defaults</h2>
          <p className="text-sm text-muted-foreground">
            These costs auto-fill the shipping field when creating an order, based on whether
            the customer's city is Dhaka or outside. They also appear as one-click quick buttons
            next to the shipping cost field.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Inside Dhaka (৳)</Label>
            <Input
              type="number"
              value={settings.shipping_inside_dhaka}
              onChange={(e) => updateField("shipping_inside_dhaka", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Outside Dhaka (৳)</Label>
            <Input
              type="number"
              value={settings.shipping_outside_dhaka}
              onChange={(e) => updateField("shipping_outside_dhaka", Number(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save All Settings"}</Button>
      </div>
    </div>
  );
};

export default InvoiceSettingsTab;
