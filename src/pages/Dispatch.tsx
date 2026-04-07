import { useEffect, useState } from "react";
import { Truck, Send } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";

interface DispatchOrder {
  id: string;
  order_number: string;
  total: number;
  status: string;
  customers: { name: string } | null;
  stores: { name: string } | null;
  itemCount: number;
}

const Dispatch = () => {
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, order_number, total, status, customers(name), stores(name), order_items(id)")
        .eq("status", "processing")
        .order("created_at", { ascending: false });

      setOrders(
        (data || []).map((o: any) => ({
          id: o.id,
          order_number: o.order_number,
          total: o.total,
          status: o.status,
          customers: o.customers,
          stores: o.stores,
          itemCount: o.order_items?.length || 0,
        }))
      );
      setLoading(false);
    };
    load();
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAll = () =>
    setSelected((prev) => (prev.length === orders.length ? [] : orders.map((o) => o.id)));

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

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

      {orders.length === 0 ? (
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
                  <input type="checkbox" checked={selected.length === orders.length && orders.length > 0} onChange={toggleAll} className="h-4 w-4 rounded border-border accent-primary" />
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
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.includes(order.id)} onChange={() => toggle(order.id)} className="h-4 w-4 rounded border-border accent-primary" />
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{order.order_number}</td>
                  <td className="px-4 py-3 text-foreground">{order.customers?.name || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{order.stores?.name || "—"}</td>
                  <td className="px-4 py-3 text-foreground">{order.itemCount}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">৳{Number(order.total).toLocaleString()}</td>
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
