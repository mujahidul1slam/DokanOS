import { useEffect, useRef } from "react";
import type { PickupSlipTemplateConfig } from "@/hooks/useInvoiceSettings";
import {
  A4_MAX_SLIP_H_MM,
  A4_MAX_SLIP_W_MM,
  A4_PAGE_MARGIN_MM,
  A4_PRINTABLE_H_MM,
  A4_PRINTABLE_W_MM,
  A4_SLIP_COLUMNS,
  A4_SLIP_GAP_MM,
  a4SlipsPerSheet,
  buildSlipCss,
  buildSlipPagesHtml,
  type SlipOrderData,
} from "@/lib/pickupSlipHtml";

const sampleOrders: SlipOrderData[] = [
  {
    order_number: "DKN-12847",
    total: 2450,
    amount_to_collect: 2530,
    customer_name: "Tanvir Ahmed",
    customer_phone: "01711-234567",
    customer_address: "House 42, Road 7, Block C, Banani, Dhaka 1213",
    special_instruction: "Call before delivery — gate closes after 8pm.",
    productItems: [
      { name: "Premium Cotton Shirt — L / Navy Blue", qty: 1 },
      { name: "Slim Fit Chinos — 32 / Khaki", qty: 2 },
      { name: "Leather Belt — Brown", qty: 1 },
    ],
  },
  {
    order_number: "DKN-12848",
    total: 890,
    amount_to_collect: 890,
    customer_name: "Sadia Rahman",
    customer_phone: "01822-998877",
    customer_address: "Flat 3B, House 12, Road 4, Dhanmondi, Dhaka",
    productItems: [
      { name: "Linen Kurti — M / Olive", qty: 1 },
    ],
  },
  {
    order_number: "DKN-12849",
    total: 5120,
    amount_to_collect: 5200,
    customer_name: "Mehedi Hasan",
    customer_phone: "01933-554433",
    customer_address: "Village: Char Bhadrasan, P.O. Faridpur Sadar, Faridpur 7800",
    special_instruction: "Fragile — do not fold the blazer.",
    productItems: [
      { name: "Wool Blazer — XL / Charcoal", qty: 1 },
      { name: "Formal Trouser — 34 / Black", qty: 1 },
      { name: "Oxford Shirt — L / White", qty: 2 },
      { name: "Silk Tie — Maroon", qty: 1 },
      { name: "Leather Loafers — 42 / Tan", qty: 1 },
      { name: "Cufflinks — Silver", qty: 1 },
    ],
  },
  {
    order_number: "DKN-12850",
    total: 1340,
    amount_to_collect: 0,
    customer_name: "Walk-in Customer",
    customer_phone: "",
    customer_address: "",
    productItems: [
      { name: "Cotton T-Shirt — M / White", qty: 2 },
      { name: "Denim Cap — Blue", qty: 1 },
    ],
  },
];

/** CSS reference pixels per millimetre — the ratio the iframe itself uses. */
const PX_PER_MM = 96 / 25.4;

/** Full A4 landscape sheet, margins included. */
const SHEET_W_MM = A4_PRINTABLE_W_MM + A4_PAGE_MARGIN_MM * 2;
const SHEET_H_MM = A4_PRINTABLE_H_MM + A4_PAGE_MARGIN_MM * 2;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += Math.max(1, size)) out.push(arr.slice(i, i + Math.max(1, size)));
  return out.length > 0 ? out : [[]];
}

interface Props {
  tpl: PickupSlipTemplateConfig;
  format: "thermal" | "a4";
}

export default function PickupSlipPreview({ tpl, format }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const render = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const css = buildSlipCss(tpl, format);
      const html = format === "a4" ? buildA4Preview(tpl, css, iframe.clientWidth) : buildThermalPreview(tpl, css);
      doc.open();
      doc.write(html);
      doc.close();
    };

    render();

    // The A4 sheet is scaled to whatever width the panel currently has, so it
    // has to be recomputed when that width changes — otherwise the sheet is
    // cropped or floats in dead space after a sidebar toggle or window resize.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(render);
    ro.observe(iframe);
    return () => ro.disconnect();
  }, [tpl, format]);

  return (
    <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
      <iframe
        ref={ref}
        title="Pickup slip preview"
        className="w-full bg-white"
        style={{ height: 720, border: 0 }}
      />
    </div>
  );
}

/**
 * Renders the real printed layout: A4 landscape sheets with the page margin as
 * visible white space, slips ganged in the same grid buildPrintDocument uses,
 * and one sheet per page break. Scaled down to fit the panel, because a true
 * 297mm sheet is ~1122px wide and would otherwise need sideways scrolling.
 *
 * This mirrors buildPrintDocument deliberately — the previous preview stacked
 * slips in a single column, so the operator could not see how many landed on a
 * sheet or that a too-wide slip pushed the second column off the paper.
 */
function buildA4Preview(tpl: PickupSlipTemplateConfig, css: string, panelWidth: number): string {
  const slipW = Math.min(tpl.sizing.a4_slip_width_mm, A4_MAX_SLIP_W_MM);
  const slipH = Math.min(tpl.sizing.a4_slip_height_mm, A4_MAX_SLIP_H_MM);

  const allSlips = sampleOrders.flatMap((o) =>
    buildSlipPagesHtml(o, tpl).map((h) => `<div class="slip">${h}</div>`),
  );
  const sheets = chunk(allSlips, a4SlipsPerSheet(slipH));

  const avail = Math.max(280, (panelWidth || 640) - 40);
  const scale = Math.min(1, avail / (SHEET_W_MM * PX_PER_MM));
  const outerW = SHEET_W_MM * PX_PER_MM * scale;
  const outerH = SHEET_H_MM * PX_PER_MM * scale;

  const sheetsHtml = sheets
    .map(
      (slips, i) => `<div class="sheet-block">
        <div class="sheet-frame">
          <div class="sheet"><div class="grid">${slips.join("")}</div></div>
        </div>
        <div class="sheet-label">Sheet ${i + 1} of ${sheets.length} — A4 landscape, ${slips.length} slip${slips.length === 1 ? "" : "s"}</div>
      </div>`,
    )
    .join("");

  return `<html><head><style>
    ${css}
    html, body { background: hsl(0 0% 94%); }
    body { padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 20px; }
    .sheet-block { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    /* The frame reserves the scaled footprint; transform alone does not affect
       layout, so without it every sheet would overlap the next. */
    .sheet-frame { width: ${outerW}px; height: ${outerH}px; }
    .sheet {
      width: ${SHEET_W_MM}mm;
      height: ${SHEET_H_MM}mm;
      padding: ${A4_PAGE_MARGIN_MM}mm;
      background: #fff;
      box-shadow: 0 1px 5px rgba(0,0,0,0.2);
      transform: scale(${scale});
      transform-origin: top left;
      overflow: hidden;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(${A4_SLIP_COLUMNS}, ${slipW}mm);
      gap: ${A4_SLIP_GAP_MM}mm;
      align-content: start;
      justify-content: center;
      height: 100%;
    }
    .slip { width: ${slipW}mm; ${slipH && slipH > 0 ? `height: ${slipH}mm;` : ""} overflow: hidden; }
    .sheet-label {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      letter-spacing: 0.3px;
    }
  </style></head><body>${sheetsHtml}</body></html>`;
}

/** Thermal is one slip per roll segment, so a simple vertical stack is accurate. */
function buildThermalPreview(tpl: PickupSlipTemplateConfig, css: string): string {
  const widthMm = tpl.sizing.thermal_width_mm;
  const heightMm = tpl.sizing.thermal_height_mm;
  const slipsHtml = sampleOrders
    .flatMap((o) =>
      buildSlipPagesHtml(o, tpl).map((h) => `<div class="slip-wrap"><div class="slip">${h}</div></div>`),
    )
    .join("");

  return `<html><head><style>
    ${css}
    html, body { background: hsl(0 0% 94%); }
    body { padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
    .slip-wrap {
      width: ${widthMm}mm;
      ${heightMm && heightMm > 0 ? `height: ${heightMm}mm;` : ""}
      background: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12);
      overflow: hidden;
    }
  </style></head><body>${slipsHtml}</body></html>`;
}
