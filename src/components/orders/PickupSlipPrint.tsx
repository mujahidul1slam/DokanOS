import { useRef } from "react";
import { Printer } from "lucide-react";
import JsBarcode from "jsbarcode";
import { Button } from "@/components/ui/button";
import { useInvoiceSettings, type PickupSlipTemplateConfig } from "@/hooks/useInvoiceSettings";

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

interface SlipOrder {
  order_number: string;
  total: number;
  amount_to_collect?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  productItems: { name: string; qty: number }[];
}

interface Props {
  orders: SlipOrder[];
}

export default function PickupSlipPrint({ orders }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const { settings } = useInvoiceSettings();
  const tpl: PickupSlipTemplateConfig = settings.pickup_slip_template;
  const format = settings.pickup_slip_print_format || "thermal";

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const isA4 = format === "a4";
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;

    if (isA4) {
      const slipsHtml = orders.map((order) => {
        const dueAmount = order.amount_to_collect || 0;
        const customFieldsHtml = tpl.custom_fields.filter(f => f.label && f.value).map(f =>
          `<div style="font-size:13px;margin-top:3px;"><strong>${f.label}:</strong> ${f.value}</div>`
        ).join("");
        const barcodeSvg = tpl.show_order_number ? makeBarcodeSvg(order.order_number, { height: 36, fontSize: 12, width: 1.6 }) : "";
        return `<div class="slip">
          <div class="header">
            <h2>${tpl.title || "PICKUP SLIP"}</h2>
            ${tpl.show_order_number ? `<div class="order-num">#${order.order_number}</div>${barcodeSvg ? `<div class="barcode">${barcodeSvg}</div>` : ""}` : ""}
          </div>
          ${tpl.show_customer_name || tpl.show_customer_phone || tpl.show_customer_address ? `<div class="section">
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
          ${tpl.show_due && dueAmount > 0 ? `<div style="text-align:right;font-weight:700;font-size:14px;color:#dc2626;margin-top:3px;">Due: ৳${dueAmount.toLocaleString()}</div>` : ""}
        </div>`;
      }).join("");

      printWindow.document.write(`<html><head><title>Pickup Slips</title><style>
        @page { size: A4 landscape; margin: 8mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #111; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(4, 1fr); gap: 6px; width: 100%; height: 100vh; }
        .slip { border: 1px dashed #aaa; padding: 10px; overflow: hidden; page-break-inside: avoid; display: flex; flex-direction: column; }
        .header { text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 8px; }
        .header h2 { font-size: 15px; font-weight: 700; }
        .header .order-num { font-size: 17px; font-weight: 700; margin-top: 2px; }
        .barcode { margin-top: 4px; display: flex; justify-content: center; }
        .barcode svg { max-width: 100%; height: auto; }
        .section { margin-bottom: 8px; }
        .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; color: #666; margin-bottom: 3px; }
        .customer-name { font-weight: 600; font-size: 14px; }
        .customer-detail { color: #444; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding: 3px 0; }
        td { padding: 3px 0; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
        .qty { text-align: center; width: 40px; }
        .total-row { margin-top: auto; text-align: right; font-weight: 700; font-size: 15px; border-top: 1px solid #333; padding-top: 5px; }
        @media print { body { margin: 0; } }
      </style></head><body>
        <div class="grid">${slipsHtml}</div>
      </body></html>`);
    } else {
      // Thermal: rebuild HTML with barcode injected per order
      const slipsHtml = orders.map((order) => {
        const dueAmount = order.amount_to_collect || 0;
        const barcodeSvg = tpl.show_order_number ? makeBarcodeSvg(order.order_number, { height: 60, fontSize: 18, width: 2 }) : "";
        return `<div class="slip">
          <div class="header">
            <h2>${tpl.title || "PICKUP SLIP"}</h2>
            ${tpl.show_order_number ? `<div class="order-num">#${order.order_number}</div>${barcodeSvg ? `<div class="barcode">${barcodeSvg}</div>` : ""}` : ""}
          </div>
          ${tpl.show_customer_name || tpl.show_customer_phone || tpl.show_customer_address ? `<div class="section">
            <div class="section-title">Customer</div>
            ${tpl.show_customer_name ? `<div class="customer-name">${order.customer_name || "Walk-in"}</div>` : ""}
            ${tpl.show_customer_phone && order.customer_phone ? `<div class="customer-detail">📞 ${order.customer_phone}</div>` : ""}
            ${tpl.show_customer_address && order.customer_address ? `<div class="customer-detail">📍 ${order.customer_address}</div>` : ""}
          </div>` : ""}
          ${tpl.show_items ? `<div class="section"><div class="section-title">Items</div>
            <table><thead><tr><th>Product</th>${tpl.show_item_qty ? '<th class="qty">Qty</th>' : ""}</tr></thead><tbody>
            ${order.productItems.map((item) => `<tr><td>${item.name}</td>${tpl.show_item_qty ? `<td class="qty">${item.qty}</td>` : ""}</tr>`).join("")}
            </tbody></table></div>` : ""}
          ${tpl.show_total ? `<div class="total-row">Total: ৳${Number(order.total).toLocaleString()}</div>` : ""}
          ${tpl.show_due && dueAmount > 0 ? `<div class="due-row">Due: ৳${dueAmount.toLocaleString()}</div>` : ""}
        </div>`;
      }).join("");

      printWindow.document.write(`<html><head><title>Pickup Slips</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 16px; color: #111; }
        .slip { page-break-after: always; padding: 18px; border: 1px dashed #ccc; margin-bottom: 8px; }
        .slip:last-child { page-break-after: auto; }
        .header { text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 10px; margin-bottom: 12px; }
        .header h2 { font-size: 20px; font-weight: 700; }
        .header .order-num { font-size: 22px; font-weight: 700; margin-top: 6px; }
        .barcode { margin-top: 8px; display: flex; justify-content: center; }
        .barcode svg { max-width: 100%; height: auto; }
        .section { margin-bottom: 12px; }
        .section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; color: #666; margin-bottom: 6px; letter-spacing: 0.5px; }
        .customer-name { font-weight: 600; font-size: 18px; }
        .customer-detail { color: #444; font-size: 16px; margin-top: 3px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 13px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding: 5px 0; }
        td { padding: 5px 0; font-size: 16px; border-bottom: 1px solid #f0f0f0; }
        .qty { text-align: center; width: 50px; }
        .total-row { margin-top: 10px; text-align: right; font-weight: 700; font-size: 19px; border-top: 1px solid #333; padding-top: 8px; }
        .due-row { text-align: right; font-weight: 700; font-size: 17px; color: #dc2626; margin-top: 5px; }
        @media print { body { margin: 0; } .slip { border: none; } }
      </style></head><body>${slipsHtml}
      <script>window.onload=function(){window.print();window.close();}<\/script></body></html>`);
    }

    printWindow.document.close();
    if (isA4) {
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    }
  };

  if (orders.length === 0) return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
        <Printer className="h-4 w-4" /> Print Pickup Slip{orders.length > 1 ? "s" : ""}
      </Button>

      {/* Hidden print content for thermal */}
      <div ref={printRef} className="hidden">
        {orders.map((order) => {
          const dueAmount = order.amount_to_collect || 0;
          return (
            <div key={order.order_number} className="slip">
              <div className="header">
                <h2>{tpl.title || "PICKUP SLIP"}</h2>
                {tpl.show_order_number && <div className="order-num">#{order.order_number}</div>}
              </div>
              {(tpl.show_customer_name || tpl.show_customer_phone || tpl.show_customer_address) && (
                <div className="section">
                  <div className="section-title">Customer</div>
                  {tpl.show_customer_name && <div className="customer-name">{order.customer_name || "Walk-in"}</div>}
                  {tpl.show_customer_phone && order.customer_phone && <div className="customer-detail">📞 {order.customer_phone}</div>}
                  {tpl.show_customer_address && order.customer_address && <div className="customer-detail">📍 {order.customer_address}</div>}
                </div>
              )}
              {tpl.show_items && (
                <div className="section">
                  <div className="section-title">Items</div>
                  <table>
                    <thead><tr><th>Product</th>{tpl.show_item_qty && <th className="qty">Qty</th>}</tr></thead>
                    <tbody>
                      {order.productItems.map((item, i) => (
                        <tr key={i}><td>{item.name}</td>{tpl.show_item_qty && <td className="qty">{item.qty}</td>}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {tpl.show_total && <div className="total-row">Total: ৳{Number(order.total).toLocaleString()}</div>}
              {tpl.show_due && dueAmount > 0 && <div className="due-row">Due: ৳{dueAmount.toLocaleString()}</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}
