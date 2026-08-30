import type { Cart } from "./types";
import { defaultInvoiceTemplate, type InvoiceSettings, type InvoiceTemplateConfig } from "@/hooks/useInvoiceSettings";
import { openPrintWindow } from "@/lib/printWindow";
import { buildInvoicePrintDocument, type InvoiceBizInfo } from "@/lib/invoiceHtml";

interface InvoiceData {
  orderNumber: string;
  cart: Cart;
  subtotal: number;
  total: number;
  invoiceSettings?: InvoiceSettings;
}

const fallbackBiz: InvoiceBizInfo = {
  business_name: "DokanOS",
  tagline: "",
  address: "",
  phone: "",
  email: "",
  logo_url: "",
  footer_text: "Thank you for shopping with us!",
  terms_text: "",
};

export const printInvoice = (data: InvoiceData, format: "thermal" | "a4") => {
  const { orderNumber, cart, subtotal, total, invoiceSettings } = data;

  const biz: InvoiceBizInfo = invoiceSettings
    ? {
        business_name: invoiceSettings.business_name || fallbackBiz.business_name,
        tagline: invoiceSettings.tagline || "",
        address: invoiceSettings.address || "",
        phone: invoiceSettings.phone || "",
        email: invoiceSettings.email || "",
        logo_url: invoiceSettings.logo_url || "",
        footer_text: invoiceSettings.footer_text || fallbackBiz.footer_text,
        terms_text: invoiceSettings.terms_text || "",
      }
    : fallbackBiz;

  // Spread over defaults so a template stored before sizing existed still
  // renders with the default geometry instead of crashing on undefined.
  const tpl: InvoiceTemplateConfig = {
    ...defaultInvoiceTemplate,
    ...(invoiceSettings?.invoice_template || {}),
  };

  // Layout comes from the shared builder (src/lib/invoiceHtml.ts) so the print
  // popup and the settings live preview always agree.
  const html = buildInvoicePrintDocument({ orderNumber, cart, subtotal, total }, tpl, biz, format);

  openPrintWindow(html);
};
