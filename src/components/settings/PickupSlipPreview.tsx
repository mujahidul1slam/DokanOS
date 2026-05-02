import { useEffect, useRef } from "react";
import type { PickupSlipTemplateConfig } from "@/hooks/useInvoiceSettings";
import { buildSlipCss, buildSlipPagesHtml, type SlipOrderData } from "@/lib/pickupSlipHtml";

const sampleOrders: SlipOrderData[] = [
  {
    order_number: "DKN-12847",
    total: 2450,
    amount_to_collect: 2530,
    customer_name: "Tanvir Ahmed",
    customer_phone: "01711-234567",
    customer_address: "House 42, Road 7, Block C, Banani, Dhaka 1213",
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

interface Props {
  tpl: PickupSlipTemplateConfig;
  format: "thermal" | "a4";
}

export default function PickupSlipPreview({ tpl, format }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const css = buildSlipCss(tpl, format);
    const isA4 = format === "a4";
    const widthMm = isA4 ? tpl.sizing.a4_slip_width_mm : tpl.sizing.thermal_width_mm;
    const heightMm = isA4 ? tpl.sizing.a4_slip_height_mm : tpl.sizing.thermal_height_mm;
    const heightStyle = heightMm && heightMm > 0 ? `height: ${heightMm}mm;` : "";

    const slipsHtml = sampleOrders
      .map((o) => `<div class="slip-wrap"><div class="slip">${buildSlipInnerHtml(o, tpl)}</div></div>`)
      .join("");

    const html = `<html><head><style>
      ${css}
      html, body { background: hsl(0 0% 96%); }
      body { padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
      .slip-wrap {
        width: ${widthMm}mm;
        ${heightStyle}
        background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        overflow: hidden;
      }
    </style></head><body>${slipsHtml}</body></html>`;

    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
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
