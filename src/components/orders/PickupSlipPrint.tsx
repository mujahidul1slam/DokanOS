import { useRef } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;

    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Pickup Slips</title>
          <style>
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
          </style>
        </head>
        <body>${content.innerHTML}</body>
        <script>window.onload=function(){window.print();window.close();}<\/script>
      </html>
    `);
    printWindow.document.close();
  };

  if (orders.length === 0) return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
        <Printer className="h-4 w-4" /> Print Pickup Slip{orders.length > 1 ? "s" : ""}
      </Button>

      {/* Hidden print content */}
      <div ref={printRef} className="hidden">
        {orders.map((order) => (
          <div key={order.order_number} className="slip">
            <div className="header">
              <h2>PICKUP SLIP</h2>
              <div className="order-num">#{order.order_number}</div>
            </div>

            <div className="section">
              <div className="section-title">Customer</div>
              <div className="customer-name">{order.customers?.name || "Walk-in"}</div>
              {order.customers?.phone && <div className="customer-detail">📞 {order.customers.phone}</div>}
              {order.customers?.address && <div className="customer-detail">📍 {order.customers.address}</div>}
            </div>

            <div className="section">
              <div className="section-title">Items</div>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="qty">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {order.productItems.map((item, i) => (
                    <tr key={i}>
                      <td>{item.name}</td>
                      <td className="qty">{item.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="total-row">Total: ৳{Number(order.total).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </>
  );
}
