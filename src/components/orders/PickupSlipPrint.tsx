import { useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInvoiceSettings, type PickupSlipTemplateConfig } from "@/hooks/useInvoiceSettings";

interface SlipOrder {
  order_number: string;
  total: number;
  customers: { name: string; phone: string | null; address: string | null } | null;
  productItems: { name: string; qty: number }[];
}

interface Props {
  orders: SlipOrder[];
}

export default function PickupSlipPrint({ orders }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const { settings } = useInvoiceSettings();
  const tpl: PickupSlipTemplateConfig = settings.pickup_slip_template;
  const format = settings.default_print_format;

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const isA4 = format === "a4";
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;

    if (isA4) {
      // A4 landscape with 8 slips per page (2 cols × 4 rows)
      const slipsHtml = orders.map((order) => {
        const customFieldsHtml = tpl.custom_fields.filter(f => f.label && f.value).map(f =>
          `<div style="font-size:9px;margin-top:2px;"><strong>${f.label}:</strong> ${f.value}</div>`
        ).join("");
        return `<div class="slip">
          ${tpl.show_order_number ? `<div class="header"><h2>${tpl.title || "PICKUP SLIP"}</h2><div class="order-num">#${order.order_number}</div></div>` : `<div class="header"><h2>${tpl.title || "PICKUP SLIP"}</h2></div>`}
          ${tpl.show_customer_name || tpl.show_customer_phone || tpl.show_customer_address ? `<div class="section">
            <div class="section-title">Customer</div>
            ${tpl.show_customer_name ? `<div class="customer-name">${order.customers?.name || "Walk-in"}</div>` : ""}
            ${tpl.show_customer_phone && order.customers?.phone ? `<div class="customer-detail">📞 ${order.customers.phone}</div>` : ""}
            ${tpl.show_customer_address && order.customers?.address ? `<div class="customer-detail">📍 ${order.customers.address}</div>` : ""}
          </div>` : ""}
          ${tpl.show_items ? `<div class="section"><div class="section-title">Items</div>
            <table><thead><tr><th>Product</th>${tpl.show_item_qty ? '<th class="qty">Qty</th>' : ""}</tr></thead><tbody>
            ${order.productItems.map((item) => `<tr><td>${item.name}</td>${tpl.show_item_qty ? `<td class="qty">${item.qty}</td>` : ""}</tr>`).join("")}
            </tbody></table></div>` : ""}
          ${customFieldsHtml}
          ${tpl.show_total ? `<div class="total-row">Total: ৳${Number(order.total).toLocaleString()}</div>` : ""}
        </div>`;
      }).join("");

      printWindow.document.write(`<html><head><title>Pickup Slips</title><style>
        @page { size: A4 landscape; margin: 8mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color: #111; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(4, 1fr); gap: 6px; width: 100%; height: 100vh; }
        .slip { border: 1px dashed #aaa; padding: 8px; overflow: hidden; page-break-inside: avoid; display: flex; flex-direction: column; }
        .header { text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 6px; }
        .header h2 { font-size: 11px; font-weight: 700; }
        .header .order-num { font-size: 12px; font-weight: 700; }
        .section { margin-bottom: 6px; }
        .section-title { font-size: 8px; font-weight: 600; text-transform: uppercase; color: #666; margin-bottom: 2px; }
        .customer-name { font-weight: 600; font-size: 10px; }
        .customer-detail { color: #444; font-size: 9px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 8px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding: 2px 0; }
        td { padding: 2px 0; font-size: 9px; border-bottom: 1px solid #f0f0f0; }
        .qty { text-align: center; width: 30px; }
        .total-row { margin-top: auto; text-align: right; font-weight: 700; font-size: 11px; border-top: 1px solid #333; padding-top: 4px; }
        @media print { body { margin: 0; } }
      </style></head><body>
        <div class="grid">${slipsHtml}</div>
      </body></html>`);
    } else {
      // Thermal format — single column
      printWindow.document.write(`<html><head><title>Pickup Slips</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #111; }
        .slip { page-break-after: always; padding: 16px; border: 1px dashed #ccc; margin-bottom: 8px; }
        .slip:last-child { page-break-after: auto; }
        .header { text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 10px; }
        .header h2 { font-size: 14px; font-weight: 700; }
        .header .order-num { font-size: 16px; font-weight: 700; margin-top: 4px; }
        .section { margin-bottom: 10px; }
        .section-title { font-size: 10px; font-weight: 600; text-transform: uppercase; color: #666; margin-bottom: 4px; letter-spacing: 0.5px; }
        .customer-name { font-weight: 600; font-size: 13px; }
        .customer-detail { color: #444; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 10px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding: 4px 0; }
        td { padding: 4px 0; font-size: 12px; border-bottom: 1px solid #f0f0f0; }
        .qty { text-align: center; width: 40px; }
        .total-row { margin-top: 8px; text-align: right; font-weight: 700; font-size: 14px; border-top: 1px solid #333; padding-top: 6px; }
        @media print { body { margin: 0; } .slip { border: none; } }
      </style></head><body>${content.innerHTML}</body>
      <script>window.onload=function(){window.print();window.close();}<\/script></html>`);
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
        {orders.map((order) => (
          <div key={order.order_number} className="slip">
            <div className="header">
              <h2>{tpl.title || "PICKUP SLIP"}</h2>
              {tpl.show_order_number && <div className="order-num">#{order.order_number}</div>}
            </div>
            {(tpl.show_customer_name || tpl.show_customer_phone || tpl.show_customer_address) && (
              <div className="section">
                <div className="section-title">Customer</div>
                {tpl.show_customer_name && <div className="customer-name">{order.customers?.name || "Walk-in"}</div>}
                {tpl.show_customer_phone && order.customers?.phone && <div className="customer-detail">📞 {order.customers.phone}</div>}
                {tpl.show_customer_address && order.customers?.address && <div className="customer-detail">📍 {order.customers.address}</div>}
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
          </div>
        ))}
      </div>
    </>
  );
}
