import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInvoiceSettings } from "@/hooks/useInvoiceSettings";
import { buildPrintDocument, type SlipOrderData } from "@/lib/pickupSlipHtml";

interface Props {
  orders: SlipOrderData[];
}

export default function PickupSlipPrint({ orders }: Props) {
  const { settings } = useInvoiceSettings();
  const tpl = settings.pickup_slip_template;
  const format = (settings.pickup_slip_print_format || "thermal") as "thermal" | "a4";

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;
    printWindow.document.write(buildPrintDocument(orders, tpl, format));
    printWindow.document.close();
    if (format === "a4") {
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    }
  };

  if (orders.length === 0) return null;

  return (
    <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
      <Printer className="h-4 w-4" /> Print Pickup Slip{orders.length > 1 ? "s" : ""}
    </Button>
  );
}
