import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInvoiceSettings } from "@/hooks/useInvoiceSettings";
import { buildPrintDocument, type SlipOrderData } from "@/lib/pickupSlipHtml";
import { supabase } from "@/integrations/supabase/client";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { logAction } from "@/lib/auditLog";

interface Props {
  orders: SlipOrderData[];
  onPrinted?: (orderIds: string[]) => void;
}

export default function PickupSlipPrint({ orders, onPrinted }: Props) {
  const { settings } = useInvoiceSettings();
  const tpl = settings.pickup_slip_template;
  const format = (settings.pickup_slip_print_format || "thermal") as "thermal" | "a4";

  const handlePrint = async () => {
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;
    printWindow.document.write(buildPrintDocument(orders, tpl, format));
    printWindow.document.close();
    if (format === "a4") {
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    }

    // Stamp printed-at on each order and log timeline + audit entries.
    const printedOrders = orders.filter((o: any) => o.id);
    const ids = printedOrders.map((o: any) => o.id);
    if (ids.length > 0) {
      try {
        await supabase
          .from("orders")
          .update({ pickup_slip_printed_at: new Date().toISOString() } as any)
          .in("id", ids);
        onPrinted?.(ids);

        // Order timeline entry per order (also mirrors to Woo notes).
        await addOrderTimeline(
          printedOrders.map((o: any) => ({
            order_id: o.id,
            event: "pickup_slip_printed",
            description: `Pickup slip printed (${format.toUpperCase()})`,
            metadata: { format, batch_size: ids.length },
          })),
        );

        // Audit log: single entry summarising the batch.
        await logAction("print", "pickup_slip", ids.length === 1 ? ids[0] : undefined, {
          order_ids: ids,
          order_numbers: printedOrders.map((o: any) => o.order_number).filter(Boolean),
          count: ids.length,
          format,
        });
      } catch (e) {
        console.warn("Failed to stamp/log pickup slip print:", e);
      }
    }
  };

  if (orders.length === 0) return null;

  return (
    <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
      <Printer className="h-4 w-4" /> Print Pickup Slip{orders.length > 1 ? "s" : ""}
    </Button>
  );
}
