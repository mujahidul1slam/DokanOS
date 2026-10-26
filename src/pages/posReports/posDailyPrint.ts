import { thermalTextCss } from "@/lib/pickupSlipHtml";
import { PRINT_BOOTSTRAP } from "@/lib/printWindow";

/*
 * POS daily summary print (issue #24).
 *
 * DAILY ONLY: the summary covers exactly one day (Today, Yesterday, or a
 * one-day custom range). Weekly/monthly summaries are explicitly deferred —
 * do not add range aggregation here.
 *
 * The document goes through the existing printWindow pattern (PRINT_BOOTSTRAP
 * prints once and closes). Thermal output is strictly monochrome and honors
 * the "Bold thermal text" option; A4 keeps plain report styling.
 */

export interface PosDailySales {
  orderCount: number;
  gross: number;
  discounts: number;
  returns: number;
  net: number;
  shipping: number;
  tax: number;
  totalInvoiced: number;
}

export interface PosDailyCash {
  collectedTotal: number;
  onPriorOrders: number;
  refundsTotal: number;
  netCash: number;
  byMethod: { name: string; value: number }[];
}

export interface PosDailyFulfillment {
  walkinDelivered: number;
  pickupPending: number;
  pickupCompleted: number;
  deliveryPending: number;
  deliveryCompleted: number;
  cancelled: number;
  returned: number;
}

export interface PosDailySummaryData {
  /** The single day being reported, e.g. "Oct 27, 2026". */
  dateLabel: string;
  businessName: string;
  /** Store filter label — "All Stores" or the selected store's name. */
  storeLabel?: string | null;
  currencySymbol: string;
  /** Rendered print timestamp; defaults to now. */
  printedAt?: string;
  sales: PosDailySales;
  cash: PosDailyCash;
  fulfillment?: PosDailyFulfillment | null;
  topProducts?: { name: string; qty: number; revenue: number }[];
}

const money = (sym: string, n: number) => `${sym}${Number(n || 0).toLocaleString()}`;

/** Escape external strings (product names, business/store labels) for the document. */
const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

function rowsHtml(sym: string, rows: [string, number][], strongLast = false): string {
  return rows
    .map(
      ([label, value], i) =>
        `<div class="row${strongLast && i === rows.length - 1 ? " row-strong" : ""}"><span class="label">${label}</span><span class="value">${money(sym, value)}</span></div>`,
    )
    .join("");
}

/**
 * Build the printable POS daily summary document.
 *
 * `bold` is the per-document "Bold thermal text" option (issue #24) and only
 * affects thermal output — the POS print settings own the choice.
 */
export function buildPosDailyPrintDocument(
  data: PosDailySummaryData,
  format: "thermal" | "a4",
  opts: { bold?: boolean } = {},
): string {
  const isThermal = format === "thermal";
  const sym = data.currencySymbol;
  const printedAt = data.printedAt || new Date().toLocaleString();

  const methodRows = data.cash.byMethod
    .map(
      (m) =>
        `<div class="row"><span class="label">${esc(m.name)}</span><span class="value">${money(sym, m.value)}</span></div>`,
    )
    .join("");

  const fulfillment = data.fulfillment
    ? `<div class="section">
        <div class="section-title">Fulfillment</div>
        <div class="row"><span class="label">Walk-in</span><span class="value">${data.fulfillment.walkinDelivered}</span></div>
        <div class="row"><span class="label">Pickup (pending / done)</span><span class="value">${data.fulfillment.pickupPending} / ${data.fulfillment.pickupCompleted}</span></div>
        <div class="row"><span class="label">Delivery (pending / done)</span><span class="value">${data.fulfillment.deliveryPending} / ${data.fulfillment.deliveryCompleted}</span></div>
        <div class="row"><span class="label">Cancelled / Returned</span><span class="value">${data.fulfillment.cancelled} / ${data.fulfillment.returned}</span></div>
      </div>`
    : "";

  const topProducts = data.topProducts && data.topProducts.length > 0
    ? `<div class="section">
        <div class="section-title">Top Products</div>
        <table><thead><tr><th>Product</th><th class="qty">Qty</th><th class="amount">Revenue</th></tr></thead><tbody>
        ${data.topProducts
          .map(
            (p) =>
              `<tr><td>${esc(p.name)}</td><td class="qty">${p.qty}</td><td class="amount">${money(sym, p.revenue)}</td></tr>`,
          )
          .join("")}
        </tbody></table>
      </div>`
    : "";

  return `<!DOCTYPE html><html><head><title>POS Daily Summary - ${esc(data.dateLabel)}</title><style>
    @page { size: ${isThermal ? "80mm auto" : "A4"}; margin: ${isThermal ? "0" : "12mm"}; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; }
    .report { width: ${isThermal ? "80mm" : "100%"}; padding: ${isThermal ? "4mm" : "0"}; margin: 0 auto; font-size: ${isThermal ? "11px" : "13px"}; }
    .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
    .header h1 { font-size: ${isThermal ? "15px" : "20px"}; letter-spacing: 1px; }
    .header .subtitle { font-size: ${isThermal ? "12px" : "14px"}; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 2px; }
    .meta { color: #555; font-size: ${isThermal ? "10px" : "12px"}; line-height: 1.5; margin-top: 4px; }
    .section { margin-bottom: 10px; }
    .section-title { font-size: ${isThermal ? "11px" : "12px"}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 1px solid #999; padding-bottom: 2px; margin-bottom: 4px; }
    .row { display: flex; justify-content: space-between; gap: 8px; line-height: 1.6; }
    .row .label { color: #444; }
    .row .value { white-space: nowrap; }
    .row-strong { font-weight: 700; border-top: 1px solid #111; margin-top: 2px; padding-top: 2px; }
    .row-strong .label { color: #111; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { text-align: left; font-size: ${isThermal ? "10px" : "11px"}; text-transform: uppercase; color: #555; border-bottom: 1px solid #bbb; padding: 2px 0; }
    td { padding: 2px 0; border-bottom: 1px solid #eee; word-break: break-word; }
    .qty { text-align: center; width: 40px; }
    .amount { text-align: right; white-space: nowrap; }
    .footer { margin-top: 10px; padding-top: 6px; border-top: 1px solid #999; color: #666; font-size: ${isThermal ? "9px" : "11px"}; text-align: center; }
    ${isThermal ? thermalTextCss(".report", { bold: opts.bold !== false, grayClasses: [".meta", ".row .label", "th", ".footer"] }) : ""}
  </style></head><body><div class="report">
    <div class="header">
      <h1>${esc(data.businessName)}</h1>
      <div class="subtitle">POS Daily Summary</div>
      <div class="meta">${esc(data.dateLabel)}${data.storeLabel ? ` · ${esc(data.storeLabel)}` : ""}<br/>Printed ${esc(printedAt)}</div>
    </div>

    <div class="section">
      <div class="section-title">Sales</div>
      <div class="row"><span class="label">Orders</span><span class="value">${data.sales.orderCount}</span></div>
      ${rowsHtml(sym, [
        ["Gross sales", data.sales.gross],
        ["Discounts", -data.sales.discounts],
        ["Returns", -data.sales.returns],
        ["Net sales", data.sales.net],
        ["Shipping", data.sales.shipping],
        ["Tax", data.sales.tax],
      ])}
      ${rowsHtml(sym, [["Total invoiced", data.sales.totalInvoiced]], true)}
    </div>

    <div class="section">
      <div class="section-title">Cash Collected</div>
      ${rowsHtml(sym, [
        ["Collected", data.cash.collectedTotal],
        ["On prior orders", data.cash.onPriorOrders],
        ["Refunds", -data.cash.refundsTotal],
      ])}
      ${methodRows}
      ${rowsHtml(sym, [["Net cash", data.cash.netCash]], true)}
    </div>

    ${fulfillment}
    ${topProducts}

    <div class="footer">POS Daily Summary · ${esc(data.dateLabel)} · ${esc(data.storeLabel || "All Stores")}</div>
  </div>${PRINT_BOOTSTRAP}</body></html>`;
}
