import { useEffect, useState } from "react";
import { ShoppingCart, DollarSign, Package, Truck } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";

interface OrderRow {
  id: string;
  order_number: string;
  total: number;
  status: string;
  source: string;
  created_at: string;
  customers: { name: string } | null;
}

const Dashboard = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [stats, setStats] = useState({ revenue: 0, totalOrders: 0, products: 0, inTransit: 0, lowStock: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [ordersRes, productsRes] = await Promise.all([
        supabase.from("orders").select("id, order_number, total, status, source, created_at, customers(name)").order("created_at", { ascending: false }).limit(10),
        supabase.from("products").select("id, stock_quantity"),
      ]);

      const allOrders = (ordersRes.data || []) as unknown as OrderRow[];
      const allProducts = productsRes.data || [];

      setOrders(allOrders);
      setStats({
        revenue: allOrders.reduce((s, o) => s + Number(o.total), 0),
        totalOrders: allOrders.length,
        products: allProducts.length,
        inTransit: allOrders.filter((o) => o.status === "shipped").length,
        lowStock: allProducts.filter((p) => p.stock_quantity > 0 && p.stock_quantity <= 10).length,
      });
      setLoading(false);
    };
    load();
  }, []);

  // Simple revenue chart from real order data grouped by date
  const revenueData = orders.reduce<Record<string, { online: number; pos: number }>>((acc, o) => {
    const day = new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (!acc[day]) acc[day] = { online: 0, pos: 0 };
    if (o.source === "pos") acc[day].pos += Number(o.total);
    else acc[day].online += Number(o.total);
    return acc;
  }, {});

  const chartData = Object.entries(revenueData).reverse().map(([date, v]) => ({ date, ...v }));

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your operations</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={DollarSign} title="Revenue" value={`৳${stats.revenue.toLocaleString()}`} />
        <StatCard icon={ShoppingCart} title="Total Orders" value={String(stats.totalOrders)} />
        <StatCard icon={Package} title="Products" value={String(stats.products)} change={stats.lowStock > 0 ? `${stats.lowStock} low stock` : undefined} changeType="negative" />
        <StatCard icon={Truck} title="In Transit" value={String(stats.inTransit)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="col-span-3 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground">Revenue by Date</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="online" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(217,91%,60%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(217,91%,60%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="pos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(142,71%,45%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(142,71%,45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(225,12%,16%)" />
                <XAxis dataKey="date" tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(225,14%,10%)", border: "1px solid hsl(225,12%,16%)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "hsl(220,10%,92%)" }} />
                <Area type="monotone" dataKey="online" stroke="hsl(217,91%,60%)" fill="url(#online)" strokeWidth={2} />
                <Area type="monotone" dataKey="pos" stroke="hsl(142,71%,45%)" fill="url(#pos)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex gap-5">
            <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> Online</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-success" /> POS</span>
          </div>
        </div>

        <div className="col-span-2 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground">Recent Orders</h2>
          <div className="mt-4 space-y-3">
            {orders.slice(0, 5).map((order) => (
              <div key={order.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-card-foreground">{order.order_number}</p>
                  <p className="truncate text-xs text-muted-foreground">{order.customers?.name || "Unknown"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-card-foreground">৳{Number(order.total).toLocaleString()}</span>
                  <StatusBadge status={order.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
