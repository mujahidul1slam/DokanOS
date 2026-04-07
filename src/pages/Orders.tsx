import { Search, Filter } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { orders } from "@/lib/mockData";

const Orders = () => (
  <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Orders</h1>
        <p className="text-sm text-muted-foreground">Unified view across all channels</p>
      </div>
    </div>

    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search orders..."
          className="h-9 w-full rounded-md border border-border bg-secondary pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <button className="flex h-9 items-center gap-2 rounded-md border border-border bg-secondary px-3 text-sm text-secondary-foreground hover:bg-muted">
        <Filter className="h-4 w-4" /> Filter
      </button>
    </div>

    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Order</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customer</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Source</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Store</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
              <td className="px-4 py-3 font-medium text-foreground">{order.id}</td>
              <td className="px-4 py-3 text-foreground">{order.customer}</td>
              <td className="px-4 py-3">
                <span className={`text-xs ${order.source === "POS" ? "text-success" : "text-primary"}`}>{order.source}</span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{order.store}</td>
              <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
              <td className="px-4 py-3 text-right font-medium text-foreground">৳{order.total.toLocaleString()}</td>
              <td className="px-4 py-3 text-muted-foreground">{order.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default Orders;
