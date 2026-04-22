import { useEffect, useMemo, useState } from "react";
import {
  DollarSign, ShoppingCart, TrendingUp, Receipt, RotateCcw, Wallet, Download, Users, Clock,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatsSkeleton } from "@/components/ui/loading-states";
import StatCardDelta from "@/components/dashboard/StatCardDelta";
import SalespersonLeaderboard from "@/components/analytics/SalespersonLeaderboard";
import HourHeatmap from "@/components/analytics/HourHeatmap";
import { startOfYear, subDays, format, getDay, getHours } from "date-fns";
import { downloadCsv } from "@/lib/exportCsv";

interface PosOrder {
  id: string;
  total: number;
  subtotal: number;
  discount: number | null;
  tax_amount: number | null;
  status: string;
  payment_status: string;
  payment_method: string | null;
  created_at: string;
  customer_id: string | null;
  customer_name: string | null;
  salesperson_name: string | null;
  store_id: string | null;
}

interface PosItemRow {
  product_name: string;
  quantity: number;
  line_total: number;
  product_id: string | null;
  order_id: string;
}

interface PaymentRow {
  method: string;
  amount: number;
  order_id: string;
}

interface ShiftRow {
  id: string;
  user_email: string | null;
  status: string;
  opening_float: number;
  closing_balance: number | null;
  expected_balance: number | null;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  bkash_sales: number;
  bank_sales: number;
  transaction_count: number;
  opened_at: string;
  closed_at: string | null;
}

interface ReturnRow {
  id: string;
  refund_amount: number;
  refund_method: string;
  reason: string | null;
  created_at: string;
}

interface StoreRow {
  id: string;
  name: string;
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

const presetDays: Record<DatePreset, number> = {
  today: 1, "7d": 7, "30d": 30, "90d": 90, year: 365, all: 365,
};

const COLORS = ["hsl(217,91%,60%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)", "hsl(291,64%,42%)", "hsl(0,84%,60%)"];

const getDateFrom = (preset: DatePreset): Date | null => {
  const now = new Date();
  switch (preset) {
    case "today": { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    case "7d": return subDays(now, 7);
    case "30d": return subDays(now, 30);
    case "90d": return subDays(now, 90);
    case "year": return startOfYear(now);
    case "all": return null;
  }
};

const PosReports = () => {
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [prevOrders, setPrevOrders] = useState<PosOrder[]>([]);
  const [items, setItems] = useState<PosItemRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [storeFilter, setStoreFilter] = useState<string>("all");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const dateFrom = getDateFrom(datePreset);
      const days = presetDays[datePreset];
      const prevFrom = dateFrom ? subDays(dateFrom, days) : null;

      const baseSelect = "id, total, subtotal, discount, tax_amount, status, payment_status, payment_method, created_at, customer_id, customer_name, salesperson_name, store_id";

      let curQ = supabase.from("orders").select(baseSelect).eq("source", "pos").is("deleted_at", null).order("created_at", { ascending: false });
      let prevQ = supabase.from("orders").select(baseSelect).eq("source", "pos").is("deleted_at", null);
      let shiftsQ = supabase.from("pos_shifts").select("id, user_email, status, opening_float, closing_balance, expected_balance, total_sales, cash_sales, card_sales, bkash_sales, bank_sales, transaction_count, opened_at, closed_at").order("opened_at", { ascending: false });
      let returnsQ = supabase.from("pos_returns").select("id, refund_amount, refund_method, reason, created_at");

      if (storeFilter !== "all") {
        curQ = curQ.eq("store_id", storeFilter);
        prevQ = prevQ.eq("store_id", storeFilter);
        shiftsQ = shiftsQ.eq("store_id", storeFilter);
        returnsQ = returnsQ.eq("store_id", storeFilter);
      }

      if (dateFrom) {
        curQ = curQ.gte("created_at", dateFrom.toISOString());
        shiftsQ = shiftsQ.gte("opened_at", dateFrom.toISOString());
        returnsQ = returnsQ.gte("created_at", dateFrom.toISOString());
      }
      if (prevFrom && dateFrom) {
        prevQ = prevQ.gte("created_at", prevFrom.toISOString()).lt("created_at", dateFrom.toISOString());
      } else {
        prevQ = prevQ.eq("id", "00000000-0000-0000-0000-000000000000");
      }

      const [curRes, prevRes, shiftsRes, returnsRes, storesRes] = await Promise.all([
        curQ, prevQ, shiftsQ, returnsQ,
        supabase.from("stores").select("id, name"),
      ]);

      const curData = (curRes.data || []) as PosOrder[];
      setOrders(curData);
      setPrevOrders((prevRes.data || []) as PosOrder[]);
      setShifts((shiftsRes.data || []) as ShiftRow[]);
      setReturns((returnsRes.data || []) as ReturnRow[]);
      setStores((storesRes.data || []) as StoreRow[]);

      const ids = curData.map((o) => o.id);
      if (ids.length > 0) {
        const [itemsRes, paymentsRes] = await Promise.all([
          supabase.from("order_items").select("product_name, quantity, line_total, product_id, order_id").in("order_id", ids),
          supabase.from("order_payments").select("method, amount, order_id").in("order_id", ids),
        ]);
        setItems((itemsRes.data || []) as PosItemRow[]);
        setPayments((paymentsRes.data || []) as PaymentRow[]);
      } else {
        setItems([]);
        setPayments([]);
      }

      setLoading(false);
    };
    load();
  }, [datePreset, storeFilter]);

  const stats = useMemo(() => {
    const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
    const totalDiscount = orders.reduce((s, o) => s + Number(o.discount || 0), 0);
    const totalTax = orders.reduce((s, o) => s + Number(o.tax_amount || 0), 0);
    const itemsSold = items.reduce((s, i) => s + i.quantity, 0);
    const avgBasket = orders.length > 0 ? revenue / orders.length : 0;
    const itemsPerTxn = orders.length > 0 ? itemsSold / orders.length : 0;
    const refundAmt = returns.reduce((s, r) => s + Number(r.refund_amount), 0);
    const netRevenue = revenue - refundAmt;

    const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total), 0);
    const prevCount = prevOrders.length;
    const prevAvg = prevCount > 0 ? prevRevenue / prevCount : 0;

    return {
      revenue, totalDiscount, totalTax, itemsSold, avgBasket, itemsPerTxn,
      refundAmt, netRevenue, totalOrders: orders.length, totalReturns: returns.length,
      prevRevenue, prevCount, prevAvg,
    };
  }, [orders, prevOrders, items, returns]);

  // Revenue trend
  const trendData = useMemo(() => {
    const grouped: Record<string, { date: string; revenue: number; orders: number; items: number }> = {};
    for (const o of orders) {
      const day = format(new Date(o.created_at), "MMM d");
      if (!grouped[day]) grouped[day] = { date: day, revenue: 0, orders: 0, items: 0 };
      grouped[day].revenue += Number(o.total);
      grouped[day].orders++;
    }
    for (const i of items) {
      const order = orders.find((o) => o.id === i.order_id);
      if (!order) continue;
      const day = format(new Date(order.created_at), "MMM d");
      if (grouped[day]) grouped[day].items += i.quantity;
    }
    return Object.values(grouped).reverse();
  }, [orders, items]);

  // Payment method breakdown
  const paymentBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of payments) {
      const m = (p.method || "other").toLowerCase();
      map[m] = (map[m] || 0) + Number(p.amount);
    }
    return Object.entries(map).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
    })).sort((a, b) => b.value - a.value);
  }, [payments]);

  // Top products
  const topProducts = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const i of items) {
      const key = i.product_name;
      if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0 };
      map[key].qty += i.quantity;
      map[key].revenue += Number(i.line_total);
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [items]);

  // Salesperson rows
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

  // Heatmap
  const heatmapData = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const o of orders) {
      const d = new Date(o.created_at);
      grid[getDay(d)][getHours(d)]++;
    }
    return grid;
  }, [orders]);

  // Shift summary
  const shiftStats = useMemo(() => {
    const closed = shifts.filter((s) => s.status === "closed");
    const open = shifts.filter((s) => s.status === "open");
    const totalOverShort = closed.reduce((s, sh) => {
      const expected = Number(sh.expected_balance || 0);
      const closing = Number(sh.closing_balance || 0);
      return s + (closing - expected);
    }, 0);
    return { closed: closed.length, open: open.length, totalOverShort, totalShifts: shifts.length };
  }, [shifts]);

  // Returns by reason
  const returnReasons = useMemo(() => {
    const map: Record<string, { reason: string; count: number; amount: number }> = {};
    for (const r of returns) {
      const reason = r.reason?.trim() || "Unspecified";
      if (!map[reason]) map[reason] = { reason, count: 0, amount: 0 };
      map[reason].count++;
      map[reason].amount += Number(r.refund_amount);
    }
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [returns]);

  const exportCsv = () => {
    const headers = ["Date", "Orders", "Items Sold", "Revenue"];
    const rows = trendData.map((d) => [d.date, String(d.orders), String(d.items), String(d.revenue)]);
    downloadCsv(`pos-report-${datePreset}.csv`, headers, rows);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div><h1 className="font-heading text-2xl font-semibold">POS Reports</h1></div>
        <StatsSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">POS Reports</h1>
          <p className="text-sm text-muted-foreground">In-store sales performance, shifts, payments, and returns</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stores.length > 0 && (
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Store" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCardDelta icon={DollarSign} title="POS Revenue" value={`৳${stats.revenue.toLocaleString()}`} currentValue={stats.revenue} prevValue={stats.prevRevenue} />
        <StatCardDelta icon={ShoppingCart} title="Transactions" value={String(stats.totalOrders)} currentValue={stats.totalOrders} prevValue={stats.prevCount} />
        <StatCardDelta icon={TrendingUp} title="Avg Basket" value={`৳${Math.round(stats.avgBasket).toLocaleString()}`} currentValue={stats.avgBasket} prevValue={stats.prevAvg} subtitle={`${stats.itemsPerTxn.toFixed(1)} items/txn`} />
        <StatCardDelta icon={Receipt} title="Items Sold" value={stats.itemsSold.toLocaleString()} />
        <StatCardDelta icon={RotateCcw} title="Refunds" value={`৳${Math.round(stats.refundAmt).toLocaleString()}`} subtitle={`${stats.totalReturns} returns`} invertDelta />
      </div>

      {/* Trend + Payment mix */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">POS Sales Trend</h2>
          <div className="h-72">
            {trendData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No POS sales in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="posRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142,71%,45%)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(142,71%,45%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `৳${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `৳${v.toLocaleString()}`} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(142,71%,45%)" fill="url(#posRev)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4">
            <h2 className="font-heading text-sm font-medium text-card-foreground">Payment Methods</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Cash · Card · bKash · Bank</p>
          </div>
          <div className="h-56">
            {paymentBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No payment data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {paymentBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: number) => `৳${v.toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 space-y-1">
            {paymentBreakdown.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-foreground">{p.name}</span>
                </div>
                <span className="font-medium text-foreground">৳{p.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Products + Shifts summary */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Top Products at POS</h2>
          <div className="h-72">
            {topProducts.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts.slice(0, 8)} layout="vertical" margin={{ left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `৳${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} width={95} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: number, name: string) => name === "revenue" ? `৳${v.toLocaleString()}` : v} />
                  <Bar dataKey="revenue" fill="hsl(142,71%,45%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4">
            <h2 className="font-heading text-sm font-medium text-card-foreground">Shift Summary</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Cash drawer reconciliation</p>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-md bg-muted/40 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wallet className="h-3.5 w-3.5" /> Open Shifts</div>
              <p className="mt-1 font-heading text-xl font-semibold text-foreground">{shiftStats.open}</p>
            </div>
            <div className="rounded-md bg-muted/40 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Closed Shifts</div>
              <p className="mt-1 font-heading text-xl font-semibold text-foreground">{shiftStats.closed}</p>
            </div>
            <div className={`col-span-2 rounded-md p-3 border ${shiftStats.totalOverShort < 0 ? "bg-destructive/10 border-destructive/20" : "bg-success/10 border-success/20"}`}>
              <div className="text-xs text-muted-foreground">Total Over / Short</div>
              <p className={`mt-1 font-heading text-xl font-semibold ${shiftStats.totalOverShort < 0 ? "text-destructive" : "text-success"}`}>
                {shiftStats.totalOverShort >= 0 ? "+" : ""}৳{Math.round(shiftStats.totalOverShort).toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Closing balance vs expected, across all closed shifts</p>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">Recent Shifts</h3>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {shifts.slice(0, 6).map((s) => {
                const overShort = s.status === "closed" ? Number(s.closing_balance || 0) - Number(s.expected_balance || 0) : null;
                return (
                  <div key={s.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-1.5 w-1.5 rounded-full ${s.status === "open" ? "bg-success" : "bg-muted-foreground"}`} />
                      <span className="truncate text-foreground">{s.user_email || "—"}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground">৳{Number(s.total_sales).toLocaleString()}</span>
                      {overShort !== null && (
                        <span className={`font-medium ${overShort < 0 ? "text-destructive" : overShort > 0 ? "text-success" : "text-muted-foreground"}`}>
                          {overShort >= 0 ? "+" : ""}৳{Math.round(overShort).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {shifts.length === 0 && <div className="text-xs text-muted-foreground py-2">No shifts in this period</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Cashier leaderboard + Hour heatmap */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SalespersonLeaderboard data={salespersonRows} />
        <HourHeatmap data={heatmapData} />
      </div>

      {/* Returns breakdown */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4">
          <h2 className="font-heading text-sm font-medium text-card-foreground">Returns & Refunds</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Top reasons and refund methods</p>
        </div>
        {returnReasons.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">No returns in this period 🎉</div>
        ) : (
          <div className="space-y-2">
            {returnReasons.slice(0, 8).map((r, i) => {
              const max = Math.max(...returnReasons.map((x) => x.amount));
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground truncate">{r.reason}</span>
                    <div className="flex items-center gap-3 text-xs shrink-0">
                      <span className="text-muted-foreground">{r.count}x</span>
                      <span className="font-medium text-foreground">৳{r.amount.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-destructive/70 transition-all" style={{ width: `${(r.amount / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PosReports;
