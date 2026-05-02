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

export function buildSlipInnerHtml(order: SlipOrderData, tpl: PickupSlipTemplateConfig): string {
  const s = tpl.sizing;
  const dueAmount = order.amount_to_collect || 0;
  const customFieldsHtml = tpl.custom_fields.filter(f => f.label && f.value).map(f =>
    `<div class="custom-field"><strong>${f.label}:</strong> ${f.value}</div>`
  ).join("");
  const barcodeSvg = tpl.show_order_number
    ? makeBarcodeSvg(order.order_number, { height: s.barcode_height, fontSize: s.barcode_font_size, width: s.barcode_bar_width })
    : "";

  return `<div class="header">
      <h2>${tpl.title || "PICKUP SLIP"}</h2>
      ${tpl.show_order_number ? `<div class="order-num">#${order.order_number}</div>${barcodeSvg ? `<div class="barcode">${barcodeSvg}</div>` : ""}` : ""}
    </div>
    ${(tpl.show_customer_name || tpl.show_customer_phone || tpl.show_customer_address) ? `<div class="section">
      <div class="section-title">Customer</div>
      ${tpl.show_customer_name ? `<div class="customer-name">${order.customer_name || "Walk-in"}</div>` : ""}
      ${tpl.show_customer_phone && order.customer_phone ? `<div class="customer-detail">📞 ${order.customer_phone}</div>` : ""}
      ${tpl.show_customer_address && order.customer_address ? `<div class="customer-detail">📍 ${order.customer_address}</div>` : ""}
    </div>` : ""}
    ${tpl.show_items ? `<div class="section"><div class="section-title">Items</div>
      <table><thead><tr><th>Product</th>${tpl.show_item_qty ? '<th class="qty">Qty</th>' : ""}</tr></thead><tbody>
      ${order.productItems.map((item) => `<tr><td>${item.name}</td>${tpl.show_item_qty ? `<td class="qty">${item.qty}</td>` : ""}</tr>`).join("")}
      </tbody></table></div>` : ""}
    ${customFieldsHtml}
    ${tpl.show_total ? `<div class="total-row">Total: ৳${Number(order.total).toLocaleString()}</div>` : ""}
    ${tpl.show_due && dueAmount > 0 ? `<div class="due-row">Due: ৳${dueAmount.toLocaleString()}</div>` : ""}`;
}

export function buildSlipCss(tpl: PickupSlipTemplateConfig, format: "thermal" | "a4"): string {
  const s = tpl.sizing;
  const isA4 = format === "a4";
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; }
    .slip {
      ${isA4
        ? `border: 1px dashed #aaa; padding: ${s.a4_slip_padding_mm}mm; overflow: hidden; page-break-inside: avoid; display: flex; flex-direction: column;`
        : `padding: ${s.thermal_padding_mm}mm; border: 1px dashed #ccc; margin-bottom: 8px; page-break-after: always;`}
    }
    .slip:last-child { page-break-after: auto; }
    .header { text-align: center; border-bottom: 1px solid #ddd; padding-bottom: ${isA4 ? 6 : 10}px; margin-bottom: ${isA4 ? 8 : 12}px; }
    .header h2 { font-size: ${s.title_size}px; font-weight: 700; }
    .header .order-num { font-size: ${s.order_number_size}px; font-weight: 700; margin-top: ${isA4 ? 2 : 6}px; }
    .barcode { margin-top: ${isA4 ? 4 : 8}px; display: flex; justify-content: center; }
    .barcode svg { max-width: 100%; height: auto; }
    .section { margin-bottom: ${isA4 ? 8 : 12}px; }
    .section-title { font-size: ${s.section_title_size}px; font-weight: 600; text-transform: uppercase; color: #666; margin-bottom: ${isA4 ? 3 : 6}px; letter-spacing: 0.5px; }
    .customer-name { font-weight: 600; font-size: ${s.customer_name_size}px; }
    .customer-detail { color: #444; font-size: ${s.customer_detail_size}px; margin-top: 3px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: ${s.section_title_size}px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding: ${isA4 ? 3 : 5}px 0; }
    td { padding: ${isA4 ? 3 : 5}px 0; font-size: ${s.item_size}px; border-bottom: 1px solid #f0f0f0; }
    .qty { text-align: center; width: 50px; }
    .custom-field { font-size: ${s.custom_field_size}px; margin-top: 3px; }
    .total-row { ${isA4 ? "margin-top: auto;" : "margin-top: 10px;"} text-align: right; font-weight: 700; font-size: ${s.total_size}px; border-top: 1px solid #333; padding-top: ${isA4 ? 5 : 8}px; }
    .due-row { text-align: right; font-weight: 700; font-size: ${s.due_size}px; color: #dc2626; margin-top: 5px; }
  `;
}

export function buildPrintDocument(orders: SlipOrderData[], tpl: PickupSlipTemplateConfig, format: "thermal" | "a4"): string {
  const css = buildSlipCss(tpl, format);
  const slipsHtml = orders.map(o => `<div class="slip">${buildSlipInnerHtml(o, tpl)}</div>`).join("");
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
    @page { size: ${s.thermal_width_mm}mm auto; margin: 0; }
    ${css}
    @media print { body { margin: 0; } .slip { border: none; } }
  </style></head><body>${slipsHtml}
  <script>window.onload=function(){window.print();window.close();}<\/script></body></html>`;
}
