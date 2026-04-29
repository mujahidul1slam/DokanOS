import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface InvoiceTemplateConfig {
  show_logo: boolean;
  show_tagline: boolean;
  show_address: boolean;
  show_contact: boolean;
  show_customer: boolean;
  show_customer_phone: boolean;
  show_customer_address: boolean;
  show_item_price: boolean;
  show_item_qty: boolean;
  show_item_total: boolean;
  show_subtotal: boolean;
  show_discount: boolean;
  show_shipping: boolean;
  show_tax: boolean;
  show_total: boolean;
  show_payments: boolean;
  show_notes: boolean;
  show_terms: boolean;
  show_footer: boolean;
  show_order_date: boolean;
  show_fulfillment: boolean;
  show_due: boolean;
  custom_fields: { label: string; value: string }[];
}

export interface PickupSlipTemplateConfig {
  show_order_number: boolean;
  show_customer_name: boolean;
  show_customer_phone: boolean;
  show_customer_address: boolean;
  show_items: boolean;
  show_item_qty: boolean;
  show_total: boolean;
  show_due: boolean;
  show_notes: boolean;
  title: string;
  custom_fields: { label: string; value: string }[];
}

export interface InvoiceSettings {
  business_name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string;
  footer_text: string;
  terms_text: string;
  default_print_format: "thermal" | "a4";
  pickup_slip_print_format: "thermal" | "a4";
  invoice_template: InvoiceTemplateConfig;
  pickup_slip_template: PickupSlipTemplateConfig;
  shipping_presets: number[];
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

const defaults: InvoiceSettings = {
  business_name: "DokanOS",
  tagline: "",
  address: "",
  phone: "",
  email: "",
  logo_url: "",
  footer_text: "Thank you for shopping with us!",
  terms_text: "",
  default_print_format: "thermal",
  pickup_slip_print_format: "thermal",
  invoice_template: defaultInvoiceTemplate,
  pickup_slip_template: defaultPickupSlipTemplate,
  shipping_presets: [80, 150],
};

export function useInvoiceSettings() {
  const [settings, setSettings] = useState<InvoiceSettings>(defaults);
  const [loading, setLoading] = useState(true);

  const load = () => {
    supabase
      .from("invoice_settings" as any)
      .select("*")
      .limit(1)
      .single()
      .then(({ data }: any) => {
        if (data) {
          setSettings({
            ...defaults,
            ...data,
            pickup_slip_print_format: data.pickup_slip_print_format || "thermal",
            invoice_template: { ...defaultInvoiceTemplate, ...(data.invoice_template || {}) },
            pickup_slip_template: { ...defaultPickupSlipTemplate, ...(data.pickup_slip_template || {}) },
            shipping_presets: data.shipping_presets || [80, 150],
          });
        }
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  return { settings, loading, reload: load };
}
