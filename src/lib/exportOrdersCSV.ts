import type { OrderRow } from "@/hooks/useDashboardData";
import type { DatePreset } from "@/components/DatePresetPicker";

export const exportOrdersToCSV = (orders: OrderRow[], datePreset: DatePreset) => {
  const headers = "Order Number,Customer,Total,Status,Payment,Source,Date\n";
  const csv = orders
    .map(
      (o) =>
        `${o.order_number},"${o.customer_name || ""}",${o.total},${o.status},${o.payment_status},${o.source},${new Date(o.created_at).toLocaleDateString()}`,
    )
    .join("\n");
  const blob = new Blob([headers + csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dashboard-${datePreset}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
