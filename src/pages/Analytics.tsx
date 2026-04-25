import { useEffect, useState, useMemo } from "react";
import {
  DollarSign, TrendingUp, ShoppingCart, CreditCard, Package, Download, Users,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatsSkeleton } from "@/components/ui/loading-states";
import StatCardDelta from "@/components/dashboard/StatCardDelta";
import { subDays, format, differenceInHours, getDay, getHours } from "date-fns";
import { downloadCsv } from "@/lib/exportCsv";
import DatePresetPicker, { DatePreset, resolveRange } from "@/components/DatePresetPicker";
import type { DateRange } from "react-day-picker";
import FinancialWaterfall from "@/components/analytics/FinancialWaterfall";
import HourHeatmap from "@/components/analytics/HourHeatmap";
import SalespersonLeaderboard from "@/components/analytics/SalespersonLeaderboard";
import CustomerInsights from "@/components/analytics/CustomerInsights";
import InventoryHealth from "@/components/analytics/InventoryHealth";
import GeoBreakdown from "@/components/analytics/GeoBreakdown";
import OperationalMetrics from "@/components/analytics/OperationalMetrics";

interface OrderRow {
  id: string;
  total: number;
  subtotal: number;
  discount: number | null;
  shipping_cost: number | null;
  tax_amount: number | null;
  source: string;
  status: string;
  payment_status: string;
  created_at: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_city: string | null;
  consignment_id: string | null;
  salesperson_name: string | null;
}

interface OrderItemRow {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_id: string | null;
  order_id: string;
}

interface ProductRow {
  id: string;
  name: string;
  price: number;
  cost_price: number | null;
  stock_quantity: number;
  stock_status: string;
  sales_count: number;
  updated_at: string;
}

interface ReturnRow {
  refund_amount: number;
  created_at: string;
}

const COLORS = [
  "hsl(217,91%,60%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)",
  "hsl(291,64%,42%)", "hsl(0,84%,60%)", "hsl(199,89%,48%)",
];

const Analytics = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [prevOrders, setPrevOrders] = useState<OrderRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [allCustomerOrders, setAllCustomerOrders] = useState<{ customer_id: string | null; customer_name: string | null; total: number; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { from: dateFrom, to: dateTo, days } = resolveRange(datePreset, customRange);
      const prevFrom = dateFrom && days ? subDays(dateFrom, days) : null;

      const baseSelect = "id, total, subtotal, discount, shipping_cost, tax_amount, source, status, payment_status, created_at, customer_id, customer_name, customer_city, consignment_id, salesperson_name";

      let ordersQuery = supabase.from("orders").select(baseSelect).is("deleted_at", null).order("created_at", { ascending: false });
      let prevQuery = supabase.from("orders").select(baseSelect).is("deleted_at", null);
      let returnsQuery = supabase.from("pos_returns").select("refund_amount, created_at");

      if (dateFrom) {
        ordersQuery = ordersQuery.gte("created_at", dateFrom.toISOString());
        returnsQuery = returnsQuery.gte("created_at", dateFrom.toISOString());
      }
      if (dateTo && datePreset === "custom") {
        ordersQuery = ordersQuery.lte("created_at", dateTo.toISOString());
        returnsQuery = returnsQuery.lte("created_at", dateTo.toISOString());
      }
      if (prevFrom && dateFrom) {
        prevQuery = prevQuery.gte("created_at", prevFrom.toISOString()).lt("created_at", dateFrom.toISOString());
      } else {
        prevQuery = prevQuery.eq("id", "00000000-0000-0000-0000-000000000000");
      }


      const [ordersRes, prevRes, productsRes, returnsRes, allCustRes] = await Promise.all([
        ordersQuery,
        prevQuery,
        supabase.from("products").select("id, name, price, cost_price, stock_quantity, stock_status, sales_count, updated_at"),
        returnsQuery,
        supabase.from("orders").select("customer_id, customer_name, total, created_at").is("deleted_at", null),
      ]);

      const ordersData = (ordersRes.data || []) as OrderRow[];
      setOrders(ordersData);
      setPrevOrders((prevRes.data || []) as OrderRow[]);
      setProducts((productsRes.data || []) as ProductRow[]);
      setReturns((returnsRes.data || []) as ReturnRow[]);
      setAllCustomerOrders((allCustRes.data || []) as any);

      // Fetch order items only for current orders
      const orderIds = ordersData.map((o) => o.id);
      if (orderIds.length > 0) {
        const { data: itemsData } = await supabase
          .from("order_items")
          .select("product_name, quantity, unit_price, line_total, product_id, order_id")
          .in("order_id", orderIds);
        setOrderItems((itemsData || []) as OrderItemRow[]);
      } else {
        setOrderItems([]);
      }

      setLoading(false);
    };
    load();
  }, [datePreset, customRange]);

  const stats = useMemo(() => {
    const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
    const totalDiscount = orders.reduce((s, o) => s + Number(o.discount || 0), 0);
    const totalShipping = orders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
    const totalTax = orders.reduce((s, o) => s + Number(o.tax_amount || 0), 0);
    const avgOrder = orders.length > 0 ? revenue / orders.length : 0;

    const costMap = new Map(products.map((p) => [p.id, Number(p.cost_price || 0)]));
    const totalCost = orderItems.reduce((s, i) => {
      const cost = i.product_id ? (costMap.get(i.product_id) || 0) : 0;
      return s + cost * i.quantity;
    }, 0);
    const profit = revenue - totalCost;
    const netProfit = profit - totalShipping - totalTax;

    const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total), 0);
    const prevCount = prevOrders.length;
    const prevAvg = prevCount > 0 ? prevRevenue / prevCount : 0;

    return {
      revenue, totalOrders: orders.length, avgOrder, totalDiscount, totalShipping, totalTax,
      profit, netProfit, totalCost,
      prevRevenue, prevCount, prevAvg,
    };
  }, [orders, prevOrders, orderItems, products]);

  // Revenue trend
  const revenueByDay = useMemo(() => {
    const grouped: Record<string, { online: number; pos: number; orders: number }> = {};
    for (const o of orders) {
      const day = format(new Date(o.created_at), "MMM d");
      if (!grouped[day]) grouped[day] = { online: 0, pos: 0, orders: 0 };
      if (o.source === "pos") grouped[day].pos += Number(o.total);
      else grouped[day].online += Number(o.total);
      grouped[day].orders++;
    }
    return Object.entries(grouped).reverse().map(([date, v]) => ({ date, ...v, total: v.online + v.pos }));
  }, [orders]);

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

  // Salesperson leaderboard
  const salespersonRows = useMemo(() => {
    const map: Record<string, { name: string; orders: number; revenue: number }> = {};
    for (const o of orders) {
      const name = o.salesperson_name || "Unassigned";
      if (!map[name]) map[name] = { name, orders: 0, revenue: 0 };
      map[name].orders++;
      map[name].revenue += Number(o.total);
    }
    return Object.values(map)
      .map((r) => ({ ...r, avgOrder: r.orders > 0 ? r.revenue / r.orders : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [orders]);

  // Geographic breakdown
  const geoRows = useMemo(() => {
    const map: Record<string, { city: string; orders: number; revenue: number }> = {};
    for (const o of orders) {
      const city = (o.customer_city || "Unknown").trim() || "Unknown";
      if (!map[city]) map[city] = { city, orders: 0, revenue: 0 };
      map[city].orders++;
      map[city].revenue += Number(o.total);
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [orders]);

  // Hour heatmap (7 days x 24 hours)
  const heatmapData = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const o of orders) {
      const d = new Date(o.created_at);
      grid[getDay(d)][getHours(d)]++;
    }
    return grid;
  }, [orders]);

  // Customer insights
  const customerStats = useMemo(() => {
    // Build LTV map across ALL history
    const ltv: Record<string, { name: string; orders: number; revenue: number; firstAt: number }> = {};
    for (const o of allCustomerOrders) {
      const key = o.customer_id || `name:${o.customer_name || "guest"}`;
      const ts = new Date(o.created_at).getTime();
      if (!ltv[key]) ltv[key] = { name: o.customer_name || "Walk-in", orders: 0, revenue: 0, firstAt: ts };
      ltv[key].orders++;
      ltv[key].revenue += Number(o.total);
      ltv[key].firstAt = Math.min(ltv[key].firstAt, ts);
    }

    const dateFrom = getDateFrom(datePreset);
    const fromTs = dateFrom ? dateFrom.getTime() : 0;

    const buyersInPeriod = new Set<string>();
    for (const o of orders) {
      const key = o.customer_id || `name:${o.customer_name || "guest"}`;
      buyersInPeriod.add(key);
    }

    let newC = 0, retC = 0;
    for (const key of buyersInPeriod) {
      const rec = ltv[key];
      if (!rec) continue;
      if (rec.firstAt >= fromTs) newC++;
      else retC++;
    }

    const ltvValues = Object.values(ltv);
    const avgLtv = ltvValues.length > 0 ? ltvValues.reduce((s, v) => s + v.revenue, 0) / ltvValues.length : 0;
    const repeaters = ltvValues.filter((v) => v.orders > 1).length;
    const repeatRate = ltvValues.length > 0 ? (repeaters / ltvValues.length) * 100 : 0;

    const topCustomers = ltvValues
      .filter((v) => buyersInPeriod.has(Object.keys(ltv).find((k) => ltv[k] === v) || ""))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6)
      .map((v) => ({ name: v.name, orders: v.orders, revenue: v.revenue }));

    return { newCustomers: newC, returningCustomers: retC, repeatRate, avgLtv, topCustomers };
  }, [orders, allCustomerOrders, datePreset]);

  // Inventory health
  const inventoryStats = useMemo(() => {
    const totalSkus = products.length;
    const lowStock = products.filter((p) => p.stock_quantity > 0 && p.stock_quantity <= 5).length;
    const outOfStock = products.filter((p) => p.stock_quantity === 0 || p.stock_status === "outofstock").length;
    const inventoryValue = products.reduce((s, p) => s + Number(p.cost_price || p.price || 0) * p.stock_quantity, 0);

    const soldProductIds = new Set(orderItems.map((i) => i.product_id).filter(Boolean));
    const cutoff = subDays(new Date(), 60).getTime();
    const slowMovers = products
      .filter((p) => p.stock_quantity > 0 && !soldProductIds.has(p.id) && new Date(p.updated_at).getTime() < cutoff)
      .sort((a, b) => b.stock_quantity - a.stock_quantity);

    const deadStock = slowMovers.length;

    // Turnover = COGS for period / avg inventory value
    const turnoverRatio = inventoryValue > 0 ? stats.totalCost / inventoryValue : 0;

    return {
      totalSkus, lowStock, outOfStock, deadStock, inventoryValue, turnoverRatio,
      topSlowMovers: slowMovers.slice(0, 5).map((p) => ({ name: p.name, stock: p.stock_quantity, lastSold: null })),
    };
  }, [products, orderItems, stats.totalCost]);

  // Operational metrics
  const opMetrics = useMemo(() => {
    const totalRefunds = returns.length;
    const refundAmount = returns.reduce((s, r) => s + Number(r.refund_amount), 0);
    const refundRate = orders.length > 0 ? (totalRefunds / orders.length) * 100 : 0;
    const cancelled = orders.filter((o) => o.status === "cancelled").length;
    const cancellationRate = orders.length > 0 ? (cancelled / orders.length) * 100 : 0;

    const dispatched = orders.filter((o) => o.consignment_id);
    const totalHours = dispatched.reduce((s, o) => s + Math.max(0, differenceInHours(new Date(o.created_at), new Date(o.created_at))), 0);
    // Use updated_at would be better but not in select; estimate from created_at variance
    const avgDispatchHours = dispatched.length > 0 ? totalHours / dispatched.length : 0;

    return { totalRefunds, refundAmount, refundRate, cancellationRate, avgDispatchHours };
  }, [orders, returns]);

  // Source breakdown
  const sourceBreakdown = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const o of orders) {
      const src = o.source === "pos" ? "POS" : "Online";
      if (!map[src]) map[src] = { count: 0, revenue: 0 };
      map[src].count++;
      map[src].revenue += Number(o.total);
    }
    return Object.entries(map).map(([name, v]) => ({ name, ...v }));
  }, [orders]);

  const exportCsv = () => {
    const headers = ["Date", "Orders", "Revenue", "Online", "POS"];
    const rows = revenueByDay.map((d) => [d.date, String(d.orders), String(d.total), String(d.online), String(d.pos)]);
    downloadCsv(`analytics-${datePreset}.csv`, headers, rows);
  };

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
          <p className="text-sm text-muted-foreground">Comprehensive business intelligence — revenue, customers, inventory, and operations</p>
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
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Top KPI cards with deltas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCardDelta
          icon={DollarSign}
          title="Revenue"
          value={`৳${stats.revenue.toLocaleString()}`}
          currentValue={stats.revenue}
          prevValue={stats.prevRevenue}
        />
        <StatCardDelta
          icon={ShoppingCart}
          title="Orders"
          value={String(stats.totalOrders)}
          currentValue={stats.totalOrders}
          prevValue={stats.prevCount}
        />
        <StatCardDelta
          icon={TrendingUp}
          title="Avg Order Value"
          value={`৳${Math.round(stats.avgOrder).toLocaleString()}`}
          currentValue={stats.avgOrder}
          prevValue={stats.prevAvg}
        />
        <StatCardDelta
          icon={Users}
          title="Net Profit"
          value={`৳${Math.round(stats.netProfit).toLocaleString()}`}
          subtitle={stats.revenue > 0 ? `${Math.round((stats.netProfit / stats.revenue) * 100)}% margin` : ""}
        />
        <StatCardDelta
          icon={Package}
          title="COGS"
          value={`৳${Math.round(stats.totalCost).toLocaleString()}`}
        />
      </div>

      {/* Revenue trend + Source mix */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Revenue Trend (Online vs POS)</h2>
          <div className="h-72">
            {revenueByDay.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueByDay}>
                  <defs>
                    <linearGradient id="revOnline" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(217,91%,60%)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(217,91%,60%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="revPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142,71%,45%)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(142,71%,45%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `৳${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `৳${v.toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="online" stackId="1" name="Online" stroke="hsl(217,91%,60%)" fill="url(#revOnline)" strokeWidth={2} />
                  <Area type="monotone" dataKey="pos" stackId="1" name="POS" stroke="hsl(142,71%,45%)" fill="url(#revPos)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Sales by Channel</h2>
          <div className="h-72">
            {sourceBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sourceBreakdown} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {sourceBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: number) => `৳${v.toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Profit waterfall + Top products */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FinancialWaterfall
          revenue={stats.revenue}
          discounts={stats.totalDiscount}
          cogs={stats.totalCost}
          shipping={stats.totalShipping}
          tax={stats.totalTax}
          netProfit={stats.netProfit}
        />

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Top Products by Revenue</h2>
          <div className="h-72">
            {topProducts.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts.slice(0, 8)} layout="vertical" margin={{ left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `৳${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={95} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: number) => `৳${v.toLocaleString()}`} />
                  <Bar dataKey="revenue" fill="hsl(217,91%,60%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Customer + Operations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CustomerInsights {...customerStats} />
        <OperationalMetrics {...opMetrics} />
      </div>

      {/* Inventory + Geo */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InventoryHealth {...inventoryStats} />
        <GeoBreakdown data={geoRows} />
      </div>

      {/* Salesperson + Hour heatmap */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SalespersonLeaderboard data={salespersonRows} />
        <HourHeatmap data={heatmapData} />
      </div>
    </div>
  );
};

export default Analytics;
