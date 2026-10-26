import type { Cart } from "./types";
import { defaultInvoiceTemplate, type InvoiceSettings, type InvoiceTemplateConfig } from "@/hooks/useInvoiceSettings";
import { openPrintWindow } from "@/lib/printWindow";
import { buildInvoicePrintDocument, type InvoiceBizInfo } from "@/lib/invoiceHtml";
import { thermalTextCss } from "@/lib/pickupSlipHtml";

/**
 * Post-process a built invoice document for thermal output (issue #24).
 *
 * The shared invoice builder (src/lib/invoiceHtml.ts) is format-agnostic and
 * also serves the settings live preview, so the thermal-only rules layer on
 * here: strictly monochrome text — every color collapses to the neutral scale,
 * the red due row and blue custom tag included — plus the per-document "Bold
 * thermal text" option (opt-out). A4 documents are returned untouched.
 */
export function applyThermalInvoiceStyles(html: string, opts: { bold?: boolean } = {}): string {
  const css = thermalTextCss(".invoice", {
    bold: opts.bold !== false,
    grayClasses: [".meta", ".variation", ".custom-tag", ".terms", ".footer"],
  });
  return html.replace("</head>", `<style>${css}</style></head>`);
}

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
  // popup and the settings live preview always agree. Thermal output then gets
  // the issue #24 rules (monochrome + "Bold thermal text"); A4 keeps styling.
  let html = buildInvoicePrintDocument({ orderNumber, cart, subtotal, total }, tpl, biz, format);
  if (format === "thermal") {
    html = applyThermalInvoiceStyles(html, { bold: tpl.bold_thermal_text !== false });
  }

  openPrintWindow(html);
};
