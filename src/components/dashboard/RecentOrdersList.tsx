import StatusBadge from "@/components/StatusBadge";
import type { OrderRow } from "@/hooks/useDashboardData";

interface RecentOrdersListProps {
  orders: OrderRow[];
  limit?: number;
}

const RecentOrdersList = ({ orders, limit = 7 }: RecentOrdersListProps) => (
  <div className="col-span-1 lg:col-span-2 rounded-lg border border-border bg-card p-5">
    <h2 className="font-heading text-sm font-medium text-card-foreground">Recent Orders</h2>
    <div className="mt-4 space-y-3">
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No orders in this period</p>
      ) : (
        orders.slice(0, limit).map((order) => (
          <div
            key={order.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm text-card-foreground">{order.order_number}</p>
              <p className="truncate text-xs text-muted-foreground">
                {order.customer_name || "Walk-in"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-card-foreground">
                ৳{Number(order.total).toLocaleString()}
              </span>
              <StatusBadge status={order.status} />
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);

export default RecentOrdersList;
