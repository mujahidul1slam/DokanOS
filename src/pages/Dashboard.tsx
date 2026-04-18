import { useEffect, useState, useMemo } from "react";
import { ShoppingCart, DollarSign, Package, Truck, TrendingUp, TrendingDown, Download, AlertTriangle } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatsSkeleton, TableSkeleton } from "@/components/ui/loading-states";
import { startOfDay, subDays, startOfWeek, startOfMonth, startOfYear, format } from "date-fns";

interface OrderRow {
  id: string;
  order_number: string;
  total: number;
  status: string;
  source: string;
  created_at: string;
  customer_name: string | null;
}

type DatePreset = "today" | "7d" | "30d" | "90d" | "year" | "all";

const presetLabel: Record<DatePreset, string> = {
  today: "Today",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
  year: "This Year",
  all: "All Time",
};

const getDateFrom = (preset: DatePreset): Date | null => {
  const now = new Date();
  switch (preset) {
    case "today": return startOfDay(now);
    case "7d": return subDays(now, 7);
    case "30d": return subDays(now, 30);
    case "90d": return subDays(now, 90);
    case "year": return startOfYear(now);
    case "all": return null;
  }
};

const Dashboard = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [allOrdersCount, setAllOrdersCount] = useState(0);
  const [stats, setStats] = useState({ revenue: 0, totalOrders: 0, products: 0, inTransit: 0, lowStock: 0, profit: 0 });
  const [lowStockProducts, setLowStockProducts] = useState<{ name: string; stock_quantity: number; sku: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const dateFrom = getDateFrom(datePreset);

      let ordersQuery = supabase.from("orders").select("id, order_number, total, status, source, created_at, customers(name)").is("deleted_at", null).order("created_at", { ascending: false });
      if (dateFrom) {
        ordersQuery = ordersQuery.gte("created_at", dateFrom.toISOString());
      }

      const [ordersRes, productsRes, allCountRes] = await Promise.all([
        ordersQuery,
        supabase.from("products").select("id, name, sku, stock_quantity, price, cost_price"),
        supabase.from("orders").select("id", { count: "exact", head: true }),
      ]);

      const allOrders = (ordersRes.data || []) as unknown as OrderRow[];
      const allProducts = productsRes.data || [];

      setOrders(allOrders);
      setAllOrdersCount(allCountRes.count || 0);

      const lowStockList = allProducts
        .filter((p: any) => p.stock_quantity > 0 && p.stock_quantity <= 10)
        .sort((a: any, b: any) => a.stock_quantity - b.stock_quantity)
        .slice(0, 10);
      setLowStockProducts(lowStockList as any);

      // Calculate profit from cost_price
      const revenue = allOrders.reduce((s, o) => s + Number(o.total), 0);

      setStats({
        revenue,
        totalOrders: allOrders.length,
        products: allProducts.length,
        inTransit: allOrders.filter((o) => o.status === "shipped").length,
        lowStock: allProducts.filter((p: any) => p.stock_quantity > 0 && p.stock_quantity <= 10).length,
        profit: 0, // Calculated in analytics for accuracy
      });
      setLoading(false);
    };
    load();
  }, [datePreset]);

  const revenueData = useMemo(() => {
    const grouped = orders.reduce<Record<string, { online: number; pos: number }>>((acc, o) => {
      const day = format(new Date(o.created_at), "MMM d");
      if (!acc[day]) acc[day] = { online: 0, pos: 0 };
      if (o.source === "pos") acc[day].pos += Number(o.total);
      else acc[day].online += Number(o.total);
      return acc;
    }, {});
    return Object.entries(grouped).reverse().map(([date, v]) => ({ date, ...v }));
  }, [orders]);

  const handleExportCSV = () => {
    const headers = "Order Number,Customer,Total,Status,Source,Date\n";
    const csv = orders.map((o) =>
      `${o.order_number},"${o.customers?.name || ""}",${o.total},${o.status},${o.source},${new Date(o.created_at).toLocaleDateString()}`
    ).join("\n");
    const blob = new Blob([headers + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${datePreset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Overview of your operations</p>
          </div>
        </div>
        <StatsSkeleton />
        <TableSkeleton rows={5} cols={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of your operations</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(presetLabel).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={DollarSign} title="Revenue" value={`৳${stats.revenue.toLocaleString()}`} change={`${presetLabel[datePreset]}`} />
        <StatCard icon={ShoppingCart} title="Orders" value={String(stats.totalOrders)} change={`${allOrdersCount} all time`} />
        <StatCard icon={Package} title="Products" value={String(stats.products)} change={stats.lowStock > 0 ? `${stats.lowStock} low stock` : "All stocked"} changeType={stats.lowStock > 0 ? "negative" : "positive"} />
        <StatCard icon={Truck} title="In Transit" value={String(stats.inTransit)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="col-span-1 lg:col-span-3 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground">Revenue by Date</h2>
          <div className="mt-4 h-64">
            {revenueData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No revenue data for this period</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData}>
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
            )}
          </div>
          <div className="mt-3 flex gap-5">
            <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-primary" /> Online</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 rounded-full bg-success" /> POS</span>
          </div>
        </div>

        <div className="col-span-1 lg:col-span-2 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground">Recent Orders</h2>
          <div className="mt-4 space-y-3">
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No orders in this period</p>
            ) : orders.slice(0, 7).map((order) => (
              <div key={order.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-card-foreground">{order.order_number}</p>
                  <p className="truncate text-xs text-muted-foreground">{order.customers?.name || "Walk-in"}</p>
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

      {/* Low Stock Alerts */}
      {lowStockProducts.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h2 className="font-heading text-sm font-medium text-foreground">Low Stock Alert ({stats.lowStock} products)</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {lowStockProducts.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.sku || "No SKU"}</p>
                </div>
                <span className={`text-sm font-semibold ${p.stock_quantity <= 3 ? "text-red-400" : "text-amber-400"}`}>
                  {p.stock_quantity} left
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
