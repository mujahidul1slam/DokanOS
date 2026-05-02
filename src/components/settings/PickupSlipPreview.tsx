import { useEffect, useRef } from "react";
import type { PickupSlipTemplateConfig } from "@/hooks/useInvoiceSettings";
import { buildSlipCss, buildSlipInnerHtml, type SlipOrderData } from "@/lib/pickupSlipHtml";

const sampleOrder: SlipOrderData = {
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
};

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
    const inner = buildSlipInnerHtml(sampleOrder, tpl);
    const widthMm = format === "a4" ? tpl.sizing.a4_slip_width_mm : tpl.sizing.thermal_width_mm;
    const heightStyle = format === "a4" ? `height: ${tpl.sizing.a4_slip_height_mm}mm;` : "";
    const html = `<html><head><style>
      ${css}
      html, body { background: #fff; }
      body { padding: 8px; }
      .slip-wrap { width: ${widthMm}mm; ${heightStyle} margin: 0 auto; background: #fff; }
    </style></head><body><div class="slip-wrap"><div class="slip">${inner}</div></div></body></html>`;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
  }, [tpl, format]);

  return (
    <div className="rounded-md border border-border bg-muted/30 overflow-auto">
      <iframe
        ref={ref}
        title="Pickup slip preview"
        className="w-full bg-white"
        style={{ height: format === "a4" ? 320 : 560, border: 0 }}
      />
    </div>
  );
}
