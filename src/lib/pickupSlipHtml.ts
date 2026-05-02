import JsBarcode from "jsbarcode";
import type { PickupSlipTemplateConfig } from "@/hooks/useInvoiceSettings";

export interface SlipOrderData {
  order_number: string;
  total: number;
  amount_to_collect?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  productItems: { name: string; qty: number }[];
}

function makeBarcodeSvg(value: string, opts: { height: number; fontSize: number; width: number }): string {
  try {
    if (!value) return "";
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(el, String(value), {
      format: "CODE128",
      displayValue: true,
      height: opts.height,
      fontSize: opts.fontSize,
      width: opts.width,
      margin: 0,
      textMargin: 2,
      background: "#ffffff",
      lineColor: "#000000",
    });
    return new XMLSerializer().serializeToString(el);
  } catch {
    return "";
  }
}

const ITEMS_PER_SLIP = 5;

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function buildSlipInnerHtml(order: SlipOrderData, tpl: PickupSlipTemplateConfig): string {
  // Single-page render (used by preview for first page)
  return buildSlipPagesHtml(order, tpl).join("");
}

/** Returns one HTML string per physical slip (paginated when items > ITEMS_PER_SLIP). */
export function buildSlipPagesHtml(order: SlipOrderData, tpl: PickupSlipTemplateConfig): string[] {
  const s = tpl.sizing;
  const dueAmount = order.amount_to_collect || 0;
  const customFieldsHtml = tpl.custom_fields.filter(f => f.label && f.value).map(f =>
    `<div class="custom-field"><strong>${f.label}:</strong> ${f.value}</div>`
  ).join("");
  const barcodeSvg = tpl.show_order_number
    ? makeBarcodeSvg(order.order_number, { height: s.barcode_height, fontSize: s.barcode_font_size, width: s.barcode_bar_width })
    : "";

  const itemPages = tpl.show_items ? chunk(order.productItems, ITEMS_PER_SLIP) : [[]];
  const totalPages = itemPages.length;

  return itemPages.map((pageItems, idx) => {
    const isLast = idx === totalPages - 1;
    const isFirst = idx === 0;
    const pageBadge = totalPages > 1 ? `<span class="page-badge">${idx + 1}/${totalPages}</span>` : "";

    const header = `<div class="header">
      <h2>${tpl.title || "PICKUP SLIP"} ${pageBadge}</h2>
      ${tpl.show_order_number ? `<div class="order-num">#${order.order_number}</div>${barcodeSvg ? `<div class="barcode">${barcodeSvg}</div>` : ""}` : ""}
    </div>`;

    const customer = (isFirst && (tpl.show_customer_name || tpl.show_customer_phone || tpl.show_customer_address)) ? `<div class="section customer-section">
      ${tpl.show_customer_name ? `<div class="customer-name">${order.customer_name || "Walk-in"}</div>` : ""}
      ${tpl.show_customer_phone && order.customer_phone ? `<div class="customer-detail">📞 ${order.customer_phone}</div>` : ""}
      ${tpl.show_customer_address && order.customer_address ? `<div class="customer-detail">📍 ${order.customer_address}</div>` : ""}
    </div>` : "";

    const items = tpl.show_items && pageItems.length > 0 ? `<div class="section"><div class="section-title">Items${totalPages > 1 ? ` (cont.)` : ""}</div>
      <table><thead><tr><th>Product</th>${tpl.show_item_qty ? '<th class="qty">Qty</th>' : ""}</tr></thead><tbody>
      ${pageItems.map((item) => `<tr><td>${item.name}</td>${tpl.show_item_qty ? `<td class="qty">${item.qty}</td>` : ""}</tr>`).join("")}
      </tbody></table></div>` : "";

    const footer = isLast ? `${customFieldsHtml}
      ${tpl.show_total ? `<div class="total-row">Total: ৳${Number(order.total).toLocaleString()}</div>` : ""}
      ${tpl.show_due && dueAmount > 0 ? `<div class="due-row">Due: ৳${dueAmount.toLocaleString()}</div>` : ""}` : `<div class="continued-row">Continued on next slip →</div>`;

    return `${header}${customer}${items}${footer}`;
  });
}

export function buildSlipCss(tpl: PickupSlipTemplateConfig, format: "thermal" | "a4"): string {
  const s = tpl.sizing;
  const isA4 = format === "a4";
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; font-weight: 700; }
    .slip, .slip * { font-weight: 700 !important; }
    .slip {
      ${isA4
        ? `border: 1px dashed #aaa; padding: ${s.a4_slip_padding_mm}mm; overflow: hidden; page-break-inside: avoid; display: flex; flex-direction: column;`
        : `padding: ${s.thermal_padding_mm}mm; border: 1px dashed #ccc; margin-bottom: 8px; page-break-after: always;`}
    }
    .slip:last-child { page-break-after: auto; }
    .header { text-align: center; padding-bottom: ${isA4 ? 2 : 4}px; margin-bottom: ${isA4 ? 3 : 5}px; border-bottom: 1px solid #ddd; }
    .header h2 { font-size: ${s.title_size}px; font-weight: 700; line-height: 1.1; }
    .header .order-num { font-size: ${s.order_number_size}px; font-weight: 700; margin-top: ${isA4 ? 1 : 2}px; line-height: 1.1; }
    .page-badge { font-size: ${Math.max(9, Math.round(s.section_title_size * 0.85))}px; font-weight: 600; color: #555; margin-left: 4px; }
    .barcode { margin-top: ${isA4 ? 2 : 4}px; display: flex; justify-content: center; line-height: 0; }
    .barcode svg { max-width: 100%; height: auto; display: block; }
    .section { margin-bottom: ${isA4 ? 3 : 5}px; }
    .customer-section { margin-bottom: ${isA4 ? 4 : 6}px; }
    .section-title { font-size: ${s.section_title_size}px; font-weight: 600; text-transform: uppercase; color: #666; margin-bottom: ${isA4 ? 1 : 2}px; letter-spacing: 0.4px; line-height: 1.1; }
    .customer-name { font-weight: 600; font-size: ${s.customer_name_size}px; line-height: 1.15; }
    .customer-detail { color: #444; font-size: ${s.customer_detail_size}px; margin-top: 1px; line-height: 1.2; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: ${s.section_title_size}px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding: ${isA4 ? 1 : 2}px 0; line-height: 1.1; }
    td { padding: ${isA4 ? 1 : 2}px 0; font-size: ${s.item_size}px; border-bottom: 1px solid #f0f0f0; line-height: 1.2; }
    .qty { text-align: center; width: 44px; }
    .custom-field { font-size: ${s.custom_field_size}px; margin-top: 2px; line-height: 1.2; }
    .total-row { ${isA4 ? "margin-top: auto;" : "margin-top: 4px;"} text-align: right; font-weight: 700; font-size: ${s.total_size}px; border-top: 1px solid #333; padding-top: ${isA4 ? 2 : 3}px; line-height: 1.15; }
    .due-row { text-align: right; font-weight: 700; font-size: ${s.due_size}px; color: #dc2626; margin-top: 2px; line-height: 1.15; }
    .continued-row { ${isA4 ? "margin-top: auto;" : "margin-top: 4px;"} text-align: right; font-style: italic; font-size: ${s.section_title_size}px; color: #666; border-top: 1px dashed #999; padding-top: ${isA4 ? 2 : 3}px; }
  `;
}

export function buildPrintDocument(orders: SlipOrderData[], tpl: PickupSlipTemplateConfig, format: "thermal" | "a4"): string {
  const css = buildSlipCss(tpl, format);
  // Expand each order into one or more physical slips (overflow paging).
  const allSlips = orders.flatMap(o => buildSlipPagesHtml(o, tpl).map(html => `<div class="slip">${html}</div>`));
  const slipsHtml = allSlips.join("");
  const s = tpl.sizing;
  if (format === "a4") {
    return `<html><head><title>Pickup Slips</title><style>
      @page { size: A4 landscape; margin: 8mm; }
      ${css}
      .grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(4, 1fr); gap: 6px; width: 100%; height: 100vh; }
      @media print { body { margin: 0; } }
    </style></head><body><div class="grid">${slipsHtml}</div></body></html>`;
  }
  return `<html><head><title>Pickup Slips</title><style>
    @page { size: ${s.thermal_width_mm}mm ${s.thermal_height_mm > 0 ? `${s.thermal_height_mm}mm` : "auto"}; margin: 0; }
    .slip { ${s.thermal_height_mm > 0 ? `height: ${s.thermal_height_mm}mm;` : ""} }
    ${css}
    @media print { body { margin: 0; } .slip { border: none; } }
  </style></head><body>${slipsHtml}
  <script>window.onload=function(){window.print();window.close();}<\/script></body></html>`;
}

