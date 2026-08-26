import JsBarcode from "jsbarcode";
import type { PickupSlipTemplateConfig } from "@/hooks/useInvoiceSettings";
import { PRINT_BOOTSTRAP } from "./printWindow";

export interface SlipOrderData {
  order_number: string;
  total: number;
  amount_to_collect?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  special_instruction?: string | null;
  productItems: { name: string; qty: number }[];
}

/*
 * A4 sheet geometry. These are the single source of truth for the printed
 * layout — the settings screen and the live preview both derive from them, so
 * what the operator is told and what the printer does cannot drift apart.
 */
/** A4 landscape width (297mm) minus the @page margins. */
export const A4_PRINTABLE_W_MM = 281;
/** A4 landscape height (210mm) minus the @page margins. */
export const A4_PRINTABLE_H_MM = 194;
export const A4_PAGE_MARGIN_MM = 8;
export const A4_SLIP_GAP_MM = 5;
export const A4_SLIP_COLUMNS = 2;

/** Widest slip that still fits two columns plus the gutter. */
export const A4_MAX_SLIP_W_MM = Math.floor(
  (A4_PRINTABLE_W_MM - A4_SLIP_GAP_MM * (A4_SLIP_COLUMNS - 1)) / A4_SLIP_COLUMNS,
);

/** Tallest slip that still leaves room for a second row. */
export const A4_MAX_SLIP_H_MM = A4_PRINTABLE_H_MM;

/**
 * How many slips actually land on one A4 landscape sheet at a given slip
 * height. Rows are whatever fits in the printable height once gutters are
 * counted; a height of 0 means the slip sizes to its content, so only one row
 * can be guaranteed.
 */
export function a4SlipsPerSheet(slipHeightMm: number): number {
  if (!slipHeightMm || slipHeightMm <= 0) return A4_SLIP_COLUMNS;
  const rows = Math.max(
    1,
    Math.floor((A4_PRINTABLE_H_MM + A4_SLIP_GAP_MM) / (slipHeightMm + A4_SLIP_GAP_MM)),
  );
  return rows * A4_SLIP_COLUMNS;
}

/*
 * Icons are inline vector, deliberately NOT emoji.
 *
 * Color emoji are bitmap glyphs (CBDT/COLR tables). Chrome's print path cannot
 * express them as vector drawing commands, so it falls back to rasterizing the
 * whole page at the driver's native DPI. On an 80mm thermal roll at 203 DPI
 * that costs ~2MB per page and nobody notices; on A4 landscape at 600 DPI it
 * is ~133MB per page, which is how a slip batch turned into a multi-gigabyte
 * spool file that hung the machine before printing anything.
 *
 * Same class of bug as the barcode viewBox normalization below — every glyph on
 * the slip has to stay vector. Do not reintroduce emoji here.
 */
const ICON_PHONE =
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 ` +
  `19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 ` +
  `2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 ` +
  `2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

const ICON_PIN =
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/>` +
  `<circle cx="12" cy="10" r="3"/></svg>`;

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
    // Normalize: convert JsBarcode's fixed px width/height into a viewBox so
    // the browser renders the SVG as pure vector at whatever CSS size we ask
    // for. Without this, Chrome's PDF/raster pipeline can balloon to GB-sized
    // output when printing to a non-thermal printer (the SVG gets rasterized
    // at the printer's native DPI per slip).
    const widthAttr = el.getAttribute("width");
    const heightAttr = el.getAttribute("height");
    const w = widthAttr ? parseFloat(widthAttr) : 0;
    const h = heightAttr ? parseFloat(heightAttr) : 0;
    if (w > 0 && h > 0 && !el.getAttribute("viewBox")) {
      el.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
    el.removeAttribute("width");
    el.removeAttribute("height");
    el.setAttribute("preserveAspectRatio", "xMidYMid meet");
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
    const pageBadge = totalPages > 1 ? `<span class="page-badge">${idx + 1}/${totalPages}</span>` : "";

    const header = `<div class="header">
      <h2>${tpl.title || "PICKUP SLIP"} ${pageBadge}</h2>
      ${tpl.show_order_number ? `<div class="order-num">#${order.order_number}</div>${barcodeSvg ? `<div class="barcode">${barcodeSvg}</div>` : ""}` : ""}
    </div>`;

    const customer = (tpl.show_customer_name || tpl.show_customer_phone || tpl.show_customer_address) ? `<div class="section customer-section">
      ${tpl.show_customer_name ? `<div class="customer-name">${order.customer_name || "Walk-in"}</div>` : ""}
      ${tpl.show_customer_phone && order.customer_phone ? `<div class="customer-detail">${ICON_PHONE}<span>${order.customer_phone}</span></div>` : ""}
      ${tpl.show_customer_address && order.customer_address ? `<div class="customer-detail">${ICON_PIN}<span>${order.customer_address}</span></div>` : ""}
    </div>` : "";

    const items = tpl.show_items && pageItems.length > 0 ? `<div class="section"><div class="section-title">Items${totalPages > 1 ? ` (cont.)` : ""}</div>
      <table><thead><tr><th>Product</th>${tpl.show_item_qty ? '<th class="qty">Qty</th>' : ""}</tr></thead><tbody>
      ${pageItems.map((item) => `<tr><td>${item.name}</td>${tpl.show_item_qty ? `<td class="qty">${item.qty}</td>` : ""}</tr>`).join("")}
      </tbody></table></div>` : "";

    // The special instruction is what whoever packs or collects the order needs
    // to act on, so it reads before the money lines. Only on the last slip.
    const noteHtml = tpl.show_notes && order.special_instruction
      ? `<div class="note-row"><span class="note-label">Note:</span> ${order.special_instruction}</div>`
      : "";

    const footer = isLast ? `${customFieldsHtml}${noteHtml}
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
        ? `border: 1px dashed #aaa; padding: ${s.a4_slip_padding_mm}mm; page-break-inside: avoid; break-inside: avoid; display: flex; flex-direction: column; background: #fff;`
        : `padding: ${s.thermal_padding_mm}mm; border: 1px dashed #ccc; margin-bottom: 8px; page-break-after: always;`}
    }
    .slip:last-child { page-break-after: auto; }
    .header { text-align: center; padding-bottom: ${isA4 ? 2 : 4}px; margin-bottom: ${isA4 ? 3 : 5}px; border-bottom: 1px solid #ddd; }
    .header h2 { font-size: ${s.title_size}px; font-weight: 700; line-height: 1.1; }
    .header .order-num { font-size: ${s.order_number_size}px; font-weight: 700; margin-top: ${isA4 ? 1 : 2}px; line-height: 1.1; }
    .page-badge { font-size: ${Math.max(9, Math.round(s.section_title_size * 0.85))}px; font-weight: 600; color: #555; margin-left: 4px; }
    .barcode { margin-top: ${isA4 ? 2 : 4}px; display: flex; justify-content: center; line-height: 0; }
    .barcode svg { width: 100%; max-width: ${isA4 ? 55 : 60}mm; height: ${Math.max(10, Math.round(s.barcode_height * 0.25))}mm; display: block; }
    .section { margin-bottom: ${isA4 ? 3 : 5}px; }
    .customer-section { margin-bottom: ${isA4 ? 4 : 6}px; }
    .section-title { font-size: ${s.section_title_size}px; font-weight: 600; text-transform: uppercase; color: #666; margin-bottom: ${isA4 ? 1 : 2}px; letter-spacing: 0.4px; line-height: 1.1; }
    .customer-name { font-weight: 600; font-size: ${s.customer_name_size}px; line-height: 1.15; }
    /* Flex rather than inline, so a long address hangs indented beside its icon
       instead of wrapping underneath it. */
    .customer-detail { color: #444; font-size: ${s.customer_detail_size}px; margin-top: 1px; line-height: 1.2; display: flex; align-items: flex-start; gap: 4px; }
    .customer-detail > span { min-width: 0; word-break: break-word; }
    .ico { width: 1em; height: 1em; flex: 0 0 auto; margin-top: 0.12em; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { text-align: left; font-size: ${s.section_title_size}px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding: ${isA4 ? 1 : 2}px 0; line-height: 1.1; }
    td { padding: ${isA4 ? 1 : 2}px 0; font-size: ${s.item_size}px; border-bottom: 1px solid #f0f0f0; line-height: 1.2; word-break: break-word; }
    th:first-child, td:first-child { padding-right: 6px; }
    .qty { text-align: center; width: 44px; }
    .custom-field { font-size: ${s.custom_field_size}px; margin-top: 2px; line-height: 1.2; }
    .note-row { font-size: ${s.custom_field_size}px; margin-top: 2px; line-height: 1.25; word-break: break-word; }
    .note-label { text-transform: uppercase; letter-spacing: 0.4px; color: #666; }
    .total-row { ${isA4 ? "margin-top: 4px;" : "margin-top: 4px;"} text-align: right; font-weight: 700; font-size: ${s.total_size}px; border-top: 1px solid #333; padding-top: ${isA4 ? 2 : 3}px; line-height: 1.15; }
    .due-row { text-align: right; font-weight: 700; font-size: ${s.due_size}px; color: #dc2626; margin-top: 2px; line-height: 1.15; }
    .continued-row { ${isA4 ? "margin-top: 4px;" : "margin-top: 4px;"} text-align: right; font-style: italic; font-size: ${s.section_title_size}px; color: #666; border-top: 1px dashed #999; padding-top: ${isA4 ? 2 : 3}px; }
  `;
}

export function buildPrintDocument(orders: SlipOrderData[], tpl: PickupSlipTemplateConfig, format: "thermal" | "a4"): string {
  const css = buildSlipCss(tpl, format);
  const allSlips = orders.flatMap(o => buildSlipPagesHtml(o, tpl).map(html => `<div class="slip">${html}</div>`));
  const slipsHtml = allSlips.join("");
  const s = tpl.sizing;
  if (format === "a4") {
    // Clamped here as well as in the settings UI: a width past A4_MAX_SLIP_W_MM
    // pushes the second column off the sheet, and the driver silently clips it.
    const slipW = Math.min(s.a4_slip_width_mm, A4_MAX_SLIP_W_MM);
    const slipH = Math.min(s.a4_slip_height_mm, A4_MAX_SLIP_H_MM);
    return `<html><head><title>Pickup Slips</title><style>
      @page { size: A4 landscape; margin: ${A4_PAGE_MARGIN_MM}mm; }
      html, body { width: ${A4_PRINTABLE_W_MM}mm; }
      ${css}
      .grid {
        display: grid;
        grid-template-columns: repeat(${A4_SLIP_COLUMNS}, ${slipW}mm);
        gap: ${A4_SLIP_GAP_MM}mm;
        align-content: start;
        justify-content: center;
      }
      .slip {
        width: ${slipW}mm;
        ${slipH && slipH > 0 ? `height: ${slipH}mm;` : ""}
        overflow: hidden;
      }
      @media print { body { margin: 0; } .slip { border: none; } }
    </style></head><body><div class="grid">${slipsHtml}</div>
    ${PRINT_BOOTSTRAP}</body></html>`;
  }
  return `<html><head><title>Pickup Slips</title><style>
    @page { size: ${s.thermal_width_mm}mm ${s.thermal_height_mm > 0 ? `${s.thermal_height_mm}mm` : "auto"}; margin: 0; }
    .slip { ${s.thermal_height_mm > 0 ? `height: ${s.thermal_height_mm}mm;` : ""} }
    ${css}
    @media print { body { margin: 0; } .slip { border: none; } }
  </style></head><body>${slipsHtml}
  ${PRINT_BOOTSTRAP}</body></html>`;
}

