import { useEffect, useRef } from "react";
import type { InvoiceTemplateConfig } from "@/hooks/useInvoiceSettings";
import type { Cart } from "@/components/pos/types";
import { buildInvoiceCss, buildInvoiceInnerHtml, type InvoiceBizInfo, type InvoiceData } from "@/lib/invoiceHtml";

/*
 * Sample cart covers every invoice element — multi-item table with variation
 * labels and a custom-tailoring tag, delivery shipping + discount, split
 * payments with a remaining due, and notes — so the preview exercises the
 * whole template, exactly like PickupSlipPreview does for slips.
 */
const sampleCart: Cart = {
  id: "preview-cart",
  label: "PREVIEW",
  items: [
    { uid: "i1", productId: "p1", name: "Premium Cotton Shirt", variationLabel: "L / Navy Blue", price: 1450, qty: 1, customTailoring: false },
    { uid: "i2", productId: "p2", name: "Slim Fit Chinos", variationLabel: "32 / Khaki", price: 950, qty: 2, customTailoring: false },
    { uid: "i3", productId: "p3", name: "Leather Belt", variationLabel: "Brown", price: 50, qty: 1, customTailoring: false },
    { uid: "i4", productId: "p4", name: "Wool Blazer", variationLabel: "XL / Charcoal", price: 1200, qty: 1, customTailoring: true },
  ],
  customer: {
    name: "Tanvir Ahmed",
    phone: "01711-234567",
    address: "House 42, Road 7, Block C, Banani, Dhaka 1213",
    city: "Dhaka",
    zone: "",
  },
  fulfillment: "delivery",
  shippingAddress: "",
  pathaoZone: "",
  discount: 100,
  discountType: "flat",
  shippingFee: 80,
  payments: [
    { id: "pay1", method: "cash", amount: 2000 },
    { id: "pay2", method: "bkash", amount: 1330 },
  ],
  notes: "Call before delivery — gate closes after 8pm.",
  taxRate: 0,
};

const sampleSubtotal = sampleCart.items.reduce((s, i) => s + i.price * i.qty, 0);
const sampleData: InvoiceData = {
  orderNumber: "DKN-12847",
  cart: sampleCart,
  subtotal: sampleSubtotal,
  total: sampleSubtotal - sampleCart.discount + (sampleCart.fulfillment === "delivery" ? sampleCart.shippingFee : 0),
};

/** CSS reference pixels per millimetre — the ratio the iframe itself uses. */
const PX_PER_MM = 96 / 25.4;

/** A4 portrait — the full-page invoice format (unlike the landscape slip grid). */
const A4_W_MM = 210;
const A4_H_MM = 297;

interface Props {
  tpl: InvoiceTemplateConfig;
  biz: InvoiceBizInfo;
  format: "thermal" | "a4";
}

export default function InvoicePreview({ tpl, biz, format }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const render = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const css = buildInvoiceCss(tpl, format);
      const html = format === "a4" ? buildA4Preview(tpl, biz, css, iframe.clientWidth) : buildThermalPreview(tpl, biz, css);
      doc.open();
      doc.write(html);
      doc.close();
    };

    render();

    // The A4 page is scaled to whatever width the panel currently has, so it
    // has to be recomputed when that width changes — otherwise the page is
    // cropped or floats in dead space after a sidebar toggle or window resize.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(render);
    ro.observe(iframe);
    return () => ro.disconnect();
  }, [tpl, biz, format]);

  return (
    <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
      <iframe
        ref={ref}
        title="Invoice preview"
        className="w-full bg-white"
        style={{ height: 720, border: 0 }}
      />
    </div>
  );
}

/**
 * Renders the real printed A4 layout: one portrait page per invoice, with the
 * configured @page margin drawn as the sheet's padding. Scaled down to fit the
 * panel — the frame reserves the scaled footprint because transform alone does
 * not affect layout (same trick as the pickup slip preview).
 */
function buildA4Preview(tpl: InvoiceTemplateConfig, biz: InvoiceBizInfo, css: string, panelWidth: number): string {
  const marginMm = tpl.sizing.a4_margin_mm;
  const inner = buildInvoiceInnerHtml(sampleData, tpl, biz);

  const avail = Math.max(200, (panelWidth || 640) - 40);
  const scale = Math.min(1, avail / (A4_W_MM * PX_PER_MM));
  const outerW = A4_W_MM * PX_PER_MM * scale;
  const outerH = A4_H_MM * PX_PER_MM * scale;

  return `<html><head><style>
    ${css}
    html, body { background: hsl(0 0% 94%); }
    body { padding: 16px; display: flow-root; }
    .page-block { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .page-frame { width: ${outerW}px; height: ${outerH}px; }
    .page {
      width: ${A4_W_MM}mm;
      height: ${A4_H_MM}mm;
      padding: ${marginMm}mm;
      background: #fff;
      box-shadow: 0 1px 5px rgba(0,0,0,0.2);
      transform: scale(${scale});
      transform-origin: top left;
      overflow: hidden;
    }
    .page-label {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      letter-spacing: 0.3px;
    }
  </style></head><body>
    <div class="page-block">
      <div class="page-frame"><div class="page"><div class="invoice">${inner}</div></div></div>
      <div class="page-label">A4 portrait — 1 invoice per page</div>
    </div>
  </body></html>`;
}

/** Thermal is one continuous roll, so a single receipt-width strip is accurate. */
function buildThermalPreview(tpl: InvoiceTemplateConfig, biz: InvoiceBizInfo, css: string): string {
  const s = tpl.sizing;
  const inner = buildInvoiceInnerHtml(sampleData, tpl, biz);

  return `<html><head><style>
    ${css}
    html, body { background: hsl(0 0% 94%); }
    body { padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
    .receipt-wrap {
      width: ${s.thermal_width_mm}mm;
      ${s.thermal_height_mm && s.thermal_height_mm > 0 ? `height: ${s.thermal_height_mm}mm;` : ""}
      background: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12);
      overflow: hidden;
    }
  </style></head><body><div class="receipt-wrap"><div class="invoice">${inner}</div></div></body></html>`;
}