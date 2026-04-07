import { useState } from "react";
import { Truck, Send } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { dispatchOrders } from "@/lib/mockData";

const Dispatch = () => {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAll = () =>
    setSelected((prev) => (prev.length === dispatchOrders.length ? [] : dispatchOrders.map((o) => o.id)));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Courier Dispatch</h1>
          <p className="text-sm text-muted-foreground">Bulk dispatch via Pathao</p>
        </div>
        <button
          disabled={selected.length === 0}
          className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="h-4 w-4" /> Dispatch {selected.length > 0 && `(${selected.length})`}
        </button>
      </div>

      {dispatchOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16">
          <Truck className="h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No orders pending dispatch</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary">
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.length === dispatchOrders.length}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Order</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Store</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Items</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {dispatchOrders.map((order) => (
                <tr key={order.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(order.id)}
                      onChange={() => toggle(order.id)}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{order.id}</td>
                  <td className="px-4 py-3 text-foreground">{order.customer}</td>
                  <td className="px-4 py-3 text-muted-foreground">{order.store}</td>
                  <td className="px-4 py-3 text-foreground">{order.items}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">৳{order.total.toLocaleString()}</td>
                  <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Dispatch;
