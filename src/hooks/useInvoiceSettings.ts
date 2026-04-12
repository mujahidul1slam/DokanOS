import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface InvoiceSettings {
  business_name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string;
  footer_text: string;
  terms_text: string;
}

const defaults: InvoiceSettings = {
  business_name: "OmniSync",
  tagline: "",
  address: "",
  phone: "",
  email: "",
  logo_url: "",
  footer_text: "Thank you for shopping with us!",
  terms_text: "",
};

export function useInvoiceSettings() {
  const [settings, setSettings] = useState<InvoiceSettings>(defaults);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("invoice_settings" as any)
      .select("business_name, tagline, address, phone, email, logo_url, footer_text, terms_text")
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setSettings(data as any);
        setLoading(false);
      });
  }, []);

  return { settings, loading };
}
