import { useEffect, useState, useMemo } from "react";
import {
  DollarSign, TrendingUp, ShoppingCart, CreditCard, Package, BarChart3, Download,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatsSkeleton } from "@/components/ui/loading-states";
import StatCard from "@/components/StatCard";
import { startOfDay, subDays, startOfYear, format } from "date-fns";
import { downloadCsv } from "@/lib/exportCsv";

interface OrderRow {
  id: string;
  total: number;
  subtotal: number;
  discount: number | null;
  shipping_cost: number | null;
  source: string;
  status: string;
  payment_status: string;
  created_at: string;
}

interface OrderItemRow {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_id: string | null;
}

interface ProductRow {
  id: string;
  name: string;
  price: number;
  cost_price: number | null;
}

type DatePreset = "7d" | "30d" | "90d" | "year" | "all";

const presetLabel: Record<DatePreset, string> = {
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
  year: "This Year",
  all: "All Time",
};

const COLORS = [
  "hsl(217,91%,60%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)",
  "hsl(291,64%,42%)", "hsl(0,84%,60%)", "hsl(199,89%,48%)",
];

const getDateFrom = (preset: DatePreset): Date | null => {
  const now = new Date();
  switch (preset) {
    case "7d": return subDays(now, 7);
    case "30d": return subDays(now, 30);
    case "90d": return subDays(now, 90);
    case "year": return startOfYear(now);
    case "all": return null;
  }
};

const Analytics = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const dateFrom = getDateFrom(datePreset);

      let ordersQuery = supabase.from("orders").select("id, total, subtotal, discount, shipping_cost, source, status, payment_status, created_at").order("created_at", { ascending: false });
      let itemsQuery = supabase.from("order_items").select("product_name, quantity, unit_price, line_total, product_id");

      if (dateFrom) {
        ordersQuery = ordersQuery.gte("created_at", dateFrom.toISOString());
      }

      const [ordersRes, itemsRes, productsRes] = await Promise.all([
        ordersQuery,
        itemsQuery,
        supabase.from("products").select("id, name, price, cost_price"),
      ]);

      setOrders((ordersRes.data || []) as OrderRow[]);
      setOrderItems((itemsRes.data || []) as OrderItemRow[]);
      setProducts((productsRes.data || []) as ProductRow[]);
      setLoading(false);
    };
    load();
  }, [datePreset]);

  // Filter order items to match date range
  const filteredOrders = orders;

  const stats = useMemo(() => {
    const revenue = filteredOrders.reduce((s, o) => s + Number(o.total), 0);
    const totalDiscount = filteredOrders.reduce((s, o) => s + Number(o.discount || 0), 0);
    const avgOrder = filteredOrders.length > 0 ? revenue / filteredOrders.length : 0;

    // Profit calculation
    const costMap = new Map(products.map((p) => [p.id, Number(p.cost_price || 0)]));
    const totalCost = orderItems.reduce((s, i) => {
      const cost = i.product_id ? (costMap.get(i.product_id) || 0) : 0;
      return s + cost * i.quantity;
    }, 0);
    const profit = revenue - totalCost;

    return { revenue, totalOrders: filteredOrders.length, avgOrder, totalDiscount, profit, totalCost };
  }, [filteredOrders, orderItems, products]);

  // Revenue by day
  const revenueByDay = useMemo(() => {
    const grouped: Record<string, { online: number; pos: number }> = {};
    for (const o of filteredOrders) {
      const day = format(new Date(o.created_at), "MMM d");
      if (!grouped[day]) grouped[day] = { online: 0, pos: 0 };
      if (o.source === "pos") grouped[day].pos += Number(o.total);
      else grouped[day].online += Number(o.total);
    }
    return Object.entries(grouped).reverse().map(([date, v]) => ({ date, ...v, total: v.online + v.pos }));
  }, [filteredOrders]);

  // Top products
  const topProducts = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const i of orderItems) {
      const key = i.product_name;
      if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0 };
      map[key].qty += i.quantity;
      map[key].revenue += Number(i.line_total);
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [orderItems]);

  // Payment method breakdown
  const paymentBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of filteredOrders) {
      const status = o.payment_status || "unpaid";
      map[status] = (map[status] || 0) + 1;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filteredOrders]);

  // Source breakdown
  const sourceBreakdown = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const o of filteredOrders) {
      const src = o.source === "pos" ? "POS" : "Online";
      if (!map[src]) map[src] = { count: 0, revenue: 0 };
      map[src].count++;
      map[src].revenue += Number(o.total);
    }
    return Object.entries(map).map(([name, v]) => ({ name, ...v }));
  }, [filteredOrders]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div><h1 className="font-heading text-2xl font-semibold">Sales Analytics</h1></div>
        <StatsSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Sales Analytics</h1>
          <p className="text-sm text-muted-foreground">Revenue, profits, and product performance</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={datePreset} onValueChange={(v) => setDatePreset(v as DatePreset)}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(presetLabel).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => {
            const headers = ["Date", "Order Count", "Revenue", "Online", "POS"];
            const rows = revenueByDay.map((d) => [d.date, "", String(d.total), String(d.online), String(d.pos)]);
            downloadCsv(`analytics-${datePreset}.csv`, headers, rows);
          }} className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={DollarSign} title="Revenue" value={`৳${stats.revenue.toLocaleString()}`} />
        <StatCard icon={ShoppingCart} title="Orders" value={String(stats.totalOrders)} change={`Avg ৳${Math.round(stats.avgOrder).toLocaleString()}`} />
        <StatCard icon={TrendingUp} title="Gross Profit" value={`৳${Math.round(stats.profit).toLocaleString()}`} change={stats.revenue > 0 ? `${Math.round((stats.profit / stats.revenue) * 100)}% margin` : ""} changeType={stats.profit > 0 ? "positive" : "negative"} />
        <StatCard icon={CreditCard} title="Discounts" value={`৳${stats.totalDiscount.toLocaleString()}`} />
        <StatCard icon={Package} title="COGS" value={`৳${Math.round(stats.totalCost).toLocaleString()}`} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Revenue Trend</h2>
          <div className="h-64">
            {revenueByDay.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueByDay}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(217,91%,60%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(217,91%,60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(225,12%,16%)" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(225,14%,10%)", border: "1px solid hsl(225,12%,16%)", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="total" stroke="hsl(217,91%,60%)" fill="url(#rev)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Source Breakdown */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Sales by Channel</h2>
          <div className="h-64">
            {sourceBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sourceBreakdown} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {sourceBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(225,14%,10%)", border: "1px solid hsl(225,12%,16%)", borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Top Products */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Top Products by Revenue</h2>
        <div className="h-72">
          {topProducts.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts.slice(0, 8)} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(225,12%,16%)" />
                <XAxis type="number" tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "hsl(220,8%,52%)", fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                <Tooltip contentStyle={{ background: "hsl(225,14%,10%)", border: "1px solid hsl(225,12%,16%)", borderRadius: 8 }} />
                <Bar dataKey="revenue" fill="hsl(217,91%,60%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Payment Status & Product Table */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Payment Status</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={paymentBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`}>
                  {paymentBreakdown.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Top Products Table</h2>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {topProducts.slice(0, 10).map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
                  <span className="truncate text-foreground">{p.name}</span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-muted-foreground">{p.qty} sold</span>
                  <span className="font-medium text-foreground">৳{p.revenue.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
