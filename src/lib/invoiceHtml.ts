import type { Cart } from "@/components/pos/types";
import type { InvoiceTemplateConfig } from "@/hooks/useInvoiceSettings";
import { makeBarcodeSvg } from "./barcodeSvg";
import { PRINT_BOOTSTRAP } from "./printWindow";

/*
 * Shared invoice layout builder — the single source of truth for the printed
 * invoice, mirroring how pickupSlipHtml.ts serves the pickup slip. The print
 * popup (printInvoice) and the settings live preview (InvoicePreview) both
 * render through buildInvoiceInnerHtml / buildInvoiceCss, so the preview can
 * never drift from what the printer actually does. If they disagree, fix it
 * here — not in two places.
 */

/** Business-level fields the invoice prints (name, contact, terms, footer…). */
export interface InvoiceBizInfo {
  business_name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string;
  footer_text: string;
  terms_text: string;
}

export interface InvoiceData {
  orderNumber: string;
  cart: Cart;
  subtotal: number;
  total: number;
}

const taka = (n: number) => `৳${Number(n).toLocaleString()}`;

/**
 * The invoice body — everything inside <div class="invoice">. All sizing lives
 * in the CSS (buildInvoiceCss), so this is format-independent; `date` is
 * injectable so tests are deterministic.
 */
export function buildInvoiceInnerHtml(
  data: InvoiceData,
  tpl: InvoiceTemplateConfig,
  biz: InvoiceBizInfo,
  date: Date = new Date(),
): string {
  const { orderNumber, cart, subtotal, total } = data;
  const discount = cart.discount || 0;
  const shipping = cart.fulfillment === "delivery" ? cart.shippingFee : 0;
  const totalPaid = cart.payments.reduce((s, p) => s + p.amount, 0);
  const dueAmount = Math.max(0, total - totalPaid);
  const s = tpl.sizing;

  const barcodeSvg = tpl.show_barcode
    ? makeBarcodeSvg(orderNumber, { height: s.barcode_height, fontSize: s.barcode_font_size, width: s.barcode_bar_width })
    : "";

  const logoHtml = tpl.show_logo && biz.logo_url ? `<img class="logo" src="${biz.logo_url}" alt="Logo" />` : "";
  const contactLine = [biz.phone, biz.email].filter(Boolean).join(" | ");

  const headerHtml = `<div class="header">
    ${logoHtml}
    <h1>${biz.business_name}</h1>
    ${tpl.show_tagline && biz.tagline ? `<p class="meta">${biz.tagline}</p>` : ""}
    ${tpl.show_address && biz.address ? `<p class="meta">${biz.address}</p>` : ""}
    ${tpl.show_contact && contactLine ? `<p class="meta">${contactLine}</p>` : ""}
  </div>`;

  const metaHtml = `<div class="meta-block">
    <div class="invoice-num">Invoice: ${orderNumber}</div>
    ${barcodeSvg ? `<div class="barcode">${barcodeSvg}</div>` : ""}
    ${tpl.show_order_date ? `<div class="meta">Date: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}</div>` : ""}
    ${tpl.show_fulfillment ? `<div class="meta">Fulfillment: ${cart.fulfillment === "delivery" ? "Home Delivery" : cart.fulfillment === "pickup" ? "Shop Pickup" : "Walk-In"}</div>` : ""}
  </div>`;

  const customerHtml = tpl.show_customer && cart.customer
    ? `<div class="customer-block">
        <div class="name">${cart.customer.name}</div>
        ${tpl.show_customer_phone && cart.customer.phone ? `<div>${cart.customer.phone}</div>` : ""}
        ${tpl.show_customer_address && cart.customer.address ? `<div>${cart.customer.address}</div>` : ""}
        ${tpl.show_customer_address && (cart.customer.city || cart.customer.zone)
          ? `<div>${[cart.customer.city, cart.customer.zone].filter(Boolean).join(", ")}</div>` : ""}
      </div>`
    : "";

  const customFieldsHtml = tpl.custom_fields
    .filter((f) => f.label && f.value)
    .map((f) => `<div class="custom-field"><strong>${f.label}:</strong> ${f.value}</div>`)
    .join("");

  const itemsRows = cart.items
    .map(
      (i) => `<tr>
        <td>${i.name}${i.variationLabel ? ` <span class="variation">- ${i.variationLabel}</span>` : ""}${i.customTailoring ? ` <span class="custom-tag">[Custom]</span>` : ""}</td>
        ${tpl.show_item_qty ? `<td class="qty">${i.qty}</td>` : ""}
        ${tpl.show_item_price ? `<td class="price">${taka(i.price)}</td>` : ""}
        ${tpl.show_item_total ? `<td class="price">${taka(i.price * i.qty)}</td>` : ""}
      </tr>`,
    )
    .join("");

  const itemsHtml = `<table><thead><tr>
    <th>Item</th>
    ${tpl.show_item_qty ? '<th class="qty">Qty</th>' : ""}
    ${tpl.show_item_price ? '<th class="price">Price</th>' : ""}
    ${tpl.show_item_total ? '<th class="price">Total</th>' : ""}
  </tr></thead><tbody>${itemsRows}</tbody></table>`;

  const totalsHtml = `<div class="totals">
    ${tpl.show_subtotal ? `<div>Subtotal: ${taka(subtotal)}</div>` : ""}
    ${tpl.show_discount && discount > 0 ? `<div>Discount: -${taka(discount)}</div>` : ""}
    ${tpl.show_shipping && shipping > 0 ? `<div>Shipping: ${taka(shipping)}</div>` : ""}
    ${tpl.show_total ? `<div class="total-row">Total: ${taka(total)}</div>` : ""}
  </div>`;

  const paymentsHtml = tpl.show_payments && cart.payments.length > 0
    ? `<div class="payments"><strong>Payments:</strong><br/>${cart.payments.map((p) => `${p.method.toUpperCase()}: ${taka(p.amount)}`).join("<br/>")}</div>`
    : "";

  const dueHtml = tpl.show_due && dueAmount > 0 ? `<div class="due-row">Due Amount: ${taka(dueAmount)}</div>` : "";
  const notesHtml = tpl.show_notes && cart.notes ? `<div class="notes"><strong>Notes:</strong> ${cart.notes}</div>` : "";
  const termsHtml = tpl.show_terms && biz.terms_text ? `<div class="terms"><strong>Terms:</strong><br/>${biz.terms_text}</div>` : "";
  const footerHtml = tpl.show_footer ? `<div class="footer">${biz.footer_text || "Thank you for shopping with us!"}</div>` : "";

  return `${headerHtml}${metaHtml}${customerHtml}${customFieldsHtml}${itemsHtml}${totalsHtml}${paymentsHtml}${dueHtml}${notesHtml}${termsHtml}${footerHtml}`;
}

/** Invoice layout CSS, driven entirely by tpl.sizing (mirrors buildSlipCss). */
export function buildInvoiceCss(tpl: InvoiceTemplateConfig, format: "thermal" | "a4"): string {
  const s = tpl.sizing;
  const isA4 = format === "a4";
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; }
    .invoice {
      ${isA4
        ? `width: 100%; padding: ${s.a4_padding_mm}mm;`
        : `width: ${s.thermal_width_mm}mm; padding: ${s.thermal_padding_mm}mm;`}
      margin: 0 auto;
      font-size: ${s.item_size}px;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { text-align: left; padding: 4px 2px; border-bottom: 2px solid #333; font-size: ${s.section_title_size}px; }
    td { padding: 4px 2px; border-bottom: 1px solid #eee; font-size: ${s.item_size}px; word-break: break-word; }
    .qty { text-align: center; width: 36px; }
    .price { text-align: right; white-space: nowrap; }
    .variation { color: #888; }
    .custom-tag { color: #3b82f6; font-size: 10px; }
    .header { text-align: center; margin-bottom: 10px; }
    .header .logo { max-height: ${isA4 ? 60 : 40}px; max-width: ${isA4 ? 180 : 120}px; object-fit: contain; margin: 0 auto 6px; display: block; }
    .header h1 { font-size: ${s.business_name_size}px; }
    .meta { color: #666; font-size: ${s.meta_size}px; }
    .meta-block { margin-bottom: 10px; }
    .invoice-num { font-size: ${s.invoice_number_size}px; font-weight: 700; }
    .barcode { margin-top: 4px; }
    .barcode svg { width: 100%; max-width: ${isA4 ? 55 : 60}mm; height: ${Math.max(10, Math.round(s.barcode_height * 0.25))}mm; display: block; }
    .customer-block { margin-bottom: 10px; font-size: ${s.customer_detail_size}px; }
    .customer-block .name { font-size: ${s.customer_name_size}px; font-weight: 700; }
    .custom-field { font-size: ${s.custom_field_size}px; margin-top: 4px; }
    .totals { text-align: right; margin-top: 10px; font-size: ${s.subtotal_size}px; }
    .total-row { font-size: ${s.total_size}px; font-weight: 700; margin-top: 4px; border-top: 2px solid #333; padding-top: 4px; }
    .payments { margin-top: 8px; font-size: ${s.payment_size}px; }
    .due-row { margin-top: 6px; font-size: ${s.due_size}px; font-weight: 700; color: #dc2626; }
    .notes { margin-top: 8px; font-size: ${s.notes_size}px; }
    .terms { margin-top: 12px; padding-top: 8px; border-top: 1px solid #ddd; font-size: ${s.terms_size}px; color: #888; }
    .footer { text-align: center; margin-top: 16px; font-size: ${s.footer_size}px; color: #888; }
  `;
}

/**
 * Full print document for the popup. Thermal drives the @page size off the
 * configured roll (margin 0 — the padding is inside .invoice); A4 applies the
 * configured page margin. The document carries PRINT_BOOTSTRAP — nothing here
 * calls print() itself.
 */
export function buildInvoicePrintDocument(
  data: InvoiceData,
  tpl: InvoiceTemplateConfig,
  biz: InvoiceBizInfo,
  format: "thermal" | "a4",
): string {
  const css = buildInvoiceCss(tpl, format);
  const s = tpl.sizing;
  const inner = buildInvoiceInnerHtml(data, tpl, biz);

  if (format === "a4") {
    return `<!DOCTYPE html><html><head><title>Invoice - ${data.orderNumber}</title><style>
      @page { size: A4; margin: ${s.a4_margin_mm}mm; }
      ${css}
    </style></head><body><div class="invoice">${inner}</div>${PRINT_BOOTSTRAP}</body></html>`;
  }

  return `<!DOCTYPE html><html><head><title>Invoice - ${data.orderNumber}</title><style>
    @page { size: ${s.thermal_width_mm}mm ${s.thermal_height_mm > 0 ? `${s.thermal_height_mm}mm` : "auto"}; margin: 0; }
    ${css}
  </style></head><body><div class="invoice">${inner}</div>${PRINT_BOOTSTRAP}</body></html>`;
}