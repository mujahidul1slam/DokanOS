import { useEffect, useMemo, useState } from "react";
import {
  DollarSign, ShoppingCart, Truck, Wallet, Download, Receipt, Store, Package, Coins,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { format, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatsSkeleton } from "@/components/ui/loading-states";
import StatCardDelta from "@/components/dashboard/StatCardDelta";
import DatePresetPicker, { DatePreset, resolveRange } from "@/components/DatePresetPicker";
import { downloadCsv } from "@/lib/exportCsv";
import StatusBadge from "@/components/StatusBadge";
import OrderDetailSheet from "@/components/orders/OrderDetailSheet";

interface PosOrder {
  id: string;
  order_number: string;
  total: number;
  subtotal: number;
  discount: number | null;
  shipping_cost: number | null;
  tax_amount: number | null;
  status: string;
  payment_status: string;
  payment_method: string | null;
  created_at: string;
  customer_name: string | null;
  salesperson_name: string | null;
  store_id: string | null;
  fulfillment_type: string | null;
}

interface PaymentRow {
  method: string;
  amount: number;
  order_id: string;
}

interface ItemRow {
  quantity: number;
  order_id: string;
  product_name: string;
  line_total: number;
  product_id: string | null;
}

interface ProductRow {
  id: string;
  store_id: string | null;
  woo_product_id: number | null;
}

interface StoreRow { id: string; name: string; }

const COLORS = ["hsl(217,91%,60%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)", "hsl(291,64%,42%)", "hsl(0,84%,60%)"];

const PosReports = () => {
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [prevOrders, setPrevOrders] = useState<PosOrder[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { from, to, days } = resolveRange(datePreset, customRange);
      const prevFrom = from && days ? subDays(from, days) : null;

      const baseSelect = "id, order_number, total, subtotal, discount, shipping_cost, tax_amount, status, payment_status, payment_method, created_at, customer_name, salesperson_name, store_id, fulfillment_type";

      let curQ = supabase.from("orders").select(baseSelect).eq("source", "pos").is("deleted_at", null).order("created_at", { ascending: false });
      let prevQ = supabase.from("orders").select(baseSelect).eq("source", "pos").is("deleted_at", null);

      if (storeFilter !== "all") {
        curQ = curQ.eq("store_id", storeFilter);
        prevQ = prevQ.eq("store_id", storeFilter);
      }

      if (from) curQ = curQ.gte("created_at", from.toISOString());
      if (to && datePreset === "custom") curQ = curQ.lte("created_at", to.toISOString());

      if (prevFrom && from) {
        prevQ = prevQ.gte("created_at", prevFrom.toISOString()).lt("created_at", from.toISOString());
      } else {
        prevQ = prevQ.eq("id", "00000000-0000-0000-0000-000000000000");
      }

      const [curRes, prevRes, storesRes] = await Promise.all([
        curQ, prevQ,
        supabase.from("stores").select("id, name"),
      ]);

      const curData = (curRes.data || []) as PosOrder[];
      setOrders(curData);
      setPrevOrders((prevRes.data || []) as PosOrder[]);
      setStores((storesRes.data || []) as StoreRow[]);

      const ids = curData.map((o) => o.id);
      if (ids.length > 0) {
        const [paymentsRes, itemsRes] = await Promise.all([
          supabase.from("order_payments").select("method, amount, order_id").in("order_id", ids),
          supabase.from("order_items").select("quantity, order_id, product_name, line_total, product_id").in("order_id", ids),
        ]);
        setPayments((paymentsRes.data || []) as PaymentRow[]);
        const itemRows = (itemsRes.data || []) as ItemRow[];
        setItems(itemRows);

        const productIds = Array.from(new Set(itemRows.map((i) => i.product_id).filter(Boolean))) as string[];
        if (productIds.length > 0) {
          const { data: prodData } = await supabase
            .from("products")
            .select("id, store_id, woo_product_id")
            .in("id", productIds);
          setProducts((prodData || []) as ProductRow[]);
        } else {
          setProducts([]);
        }
      } else {
        setPayments([]);
        setItems([]);
        setProducts([]);
      }

      setLoading(false);
    };
    load();
  }, [datePreset, customRange, storeFilter]);

  // Per-order paid map
  const paidByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      m.set(p.order_id, (m.get(p.order_id) || 0) + Number(p.amount));
    }
    return m;
  }, [payments]);

  // Per-order payment methods (from order_payments)
  const methodsByOrder = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of payments) {
      if (!p.method) continue;
      const arr = m.get(p.order_id) || [];
      if (!arr.includes(p.method)) arr.push(p.method);
      m.set(p.order_id, arr);
    }
    return m;
  }, [payments]);

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      m.set(i.order_id, (m.get(i.order_id) || 0) + Number(i.quantity));
    }
    return m;
  }, [items]);

  const stats = useMemo(() => {
    const totalSales = orders.reduce((s, o) => s + Number(o.total), 0);
    const deliveryCharge = orders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
    const totalTax = orders.reduce((s, o) => s + Number(o.tax_amount || 0), 0);
    // Net sales = sales without delivery, tax, or other charges (use subtotal - discount as the "pure" merchandise revenue)
    const netSales = orders.reduce((s, o) => {
      const sub = Number(o.subtotal || 0);
      const disc = Number(o.discount || 0);
      return s + (sub - disc);
    }, 0);

    let dues = 0;
    let changeGiven = 0;
    for (const o of orders) {
      if (o.status === "cancelled") continue;
      const paid = paidByOrder.get(o.id) || 0;
      const diff = paid - Number(o.total);
      if (diff > 0) changeGiven += diff;
      else if (diff < 0) dues += -diff;
    }

    const prevTotal = prevOrders.reduce((s, o) => s + Number(o.total), 0);
    const prevNet = prevOrders.reduce((s, o) => s + (Number(o.subtotal || 0) - Number(o.discount || 0)), 0);
    const prevDelivery = prevOrders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
    const prevOrderCount = prevOrders.length;

    return {
      totalSales, netSales, deliveryCharge, totalTax, dues, changeGiven,
      orderCount: orders.length,
      prevTotal, prevNet, prevDelivery, prevOrderCount,
    };
  }, [orders, prevOrders, paidByOrder]);

  // Top POS products by quantity & revenue
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const it of items) {
      const key = it.product_name || "Unknown";
      const cur = map.get(key) || { name: key, qty: 0, revenue: 0 };
      cur.qty += Number(it.quantity || 0);
      cur.revenue += Number(it.line_total || 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [items]);

  // Sales by store — attributed by each line item's product origin (which WooCommerce store it belongs to).
  // Items whose product has no woo_product_id (or no store link) are bucketed as "POS Only".
  const salesByStore = useMemo(() => {
    const storeMap = new Map(stores.map((s) => [s.id, s.name]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const map = new Map<string, { name: string; sales: number; qty: number; orderIds: Set<string> }>();

    for (const it of items) {
      const prod = it.product_id ? productMap.get(it.product_id) : null;
      let key: string;
      let name: string;
      if (prod && prod.store_id && prod.woo_product_id) {
        key = prod.store_id;
        name = storeMap.get(prod.store_id) || "Unknown Store";
      } else {
        key = "__pos_only__";
        name = "POS Only (no WooCommerce store)";
      }
      const cur = map.get(key) || { name, sales: 0, qty: 0, orderIds: new Set<string>() };
      cur.sales += Number(it.line_total || 0);
      cur.qty += Number(it.quantity || 0);
      cur.orderIds.add(it.order_id);
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((v) => ({ name: v.name, sales: v.sales, qty: v.qty, orders: v.orderIds.size }))
      .sort((a, b) => b.sales - a.sales);
  }, [items, products, stores]);

  // Trend
  const trendData = useMemo(() => {
    const grouped: Record<string, { date: string; sales: number; orders: number }> = {};
    for (const o of orders) {
      const day = format(new Date(o.created_at), "MMM d");
      if (!grouped[day]) grouped[day] = { date: day, sales: 0, orders: 0 };
      grouped[day].sales += Number(o.total);
      grouped[day].orders++;
    }
    return Object.values(grouped).reverse();
  }, [orders]);

  const paymentBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of payments) {
      const m = (p.method || "other").toLowerCase();
      map[m] = (map[m] || 0) + Number(p.amount);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
      .sort((a, b) => b.value - a.value);
  }, [payments]);

  const filteredOrders = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter((o) =>
      o.order_number.toLowerCase().includes(q) ||
      (o.customer_name || "").toLowerCase().includes(q) ||
      (o.salesperson_name || "").toLowerCase().includes(q),
    );
  }, [orders, search]);

  const exportOrdersCsv = () => {
    const headers = ["Order #", "Date", "Customer", "Cashier", "Items", "Subtotal", "Discount", "Delivery", "Total", "Paid", "Due", "Payment", "Status"];
    const rows = filteredOrders.map((o) => {
      const paid = paidByOrder.get(o.id) || 0;
      const due = Math.max(0, Number(o.total) - paid);
      return [
        o.order_number,
        format(new Date(o.created_at), "yyyy-MM-dd HH:mm"),
        o.customer_name || "Walk-in",
        o.salesperson_name || "—",
        String(itemsByOrder.get(o.id) || 0),
        String(o.subtotal || 0),
        String(o.discount || 0),
        String(o.shipping_cost || 0),
        String(o.total),
        String(paid),
        String(due),
        (methodsByOrder.get(o.id) || (o.payment_method ? [o.payment_method] : [])).join(", ") || "—",
        o.status,
      ];
    });
    downloadCsv(`pos-orders-${datePreset}.csv`, headers, rows);
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
          <p className="text-sm text-muted-foreground">In-store sales, dues, delivery charges, and full POS order ledger</p>
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
          <DatePresetPicker
            preset={datePreset}
            customRange={customRange}
            onPresetChange={setDatePreset}
            onCustomRangeChange={setCustomRange}
          />
          <Button variant="outline" size="sm" onClick={exportOrdersCsv} className="gap-1.5">
            <Download className="h-4 w-4" /> Export Orders
          </Button>
        </div>
      </div>

      {/* Primary KPIs requested */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCardDelta
          icon={DollarSign}
          title="Total Sales"
          value={`৳${stats.totalSales.toLocaleString()}`}
          currentValue={stats.totalSales}
          prevValue={stats.prevTotal}
          subtitle={`${stats.orderCount} orders`}
        />
        <StatCardDelta
          icon={Receipt}
          title="Net Sales"
          value={`৳${stats.netSales.toLocaleString()}`}
          currentValue={stats.netSales}
          prevValue={stats.prevNet}
          subtitle="Excludes delivery, tax, fees"
        />
        <StatCardDelta
          icon={Truck}
          title="Delivery Collected"
          value={`৳${stats.deliveryCharge.toLocaleString()}`}
          currentValue={stats.deliveryCharge}
          prevValue={stats.prevDelivery}
          subtitle="Shipping charges in period"
        />
        <StatCardDelta
          icon={Wallet}
          title="Order Dues"
          value={`৳${stats.dues.toLocaleString()}`}
          subtitle="Outstanding from non-cancelled orders"
          invertDelta
        />
        <StatCardDelta
          icon={ShoppingCart}
          title="Total Orders"
          value={stats.orderCount.toLocaleString()}
          currentValue={stats.orderCount}
          prevValue={stats.prevOrderCount}
          subtitle="POS orders in period"
        />
        <StatCardDelta
          icon={Coins}
          title="Change Given"
          value={`৳${stats.changeGiven.toLocaleString()}`}
          subtitle="Cash returned to customers"
        />
      </div>

      {/* Trend + payment mix */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">POS Sales Trend</h2>
          <div className="h-64">
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
                  <Area type="monotone" dataKey="sales" name="Sales" stroke="hsl(142,71%,45%)" fill="url(#posRev)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground mb-3">Payment Methods</h2>
          <div className="h-48">
            {paymentBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No payments</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={paymentBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
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

      {/* Top POS Products + Sales by Store */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-sm font-medium text-card-foreground flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" /> Top POS Products
            </h2>
            <span className="text-xs text-muted-foreground">By revenue</span>
          </div>
          {topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No POS sales in this period</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, idx) => {
                const max = topProducts[0].revenue || 1;
                return (
                  <div key={p.name + idx}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-card-foreground truncate pr-2">
                        <span className="text-muted-foreground tabular-nums mr-2">#{idx + 1}</span>
                        {p.name}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {p.qty} sold · ৳{p.revenue.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className="h-full bg-primary/70 rounded-full" style={{ width: `${(p.revenue / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-sm font-medium text-card-foreground flex items-center gap-2">
              <Store className="h-4 w-4 text-muted-foreground" /> Sales by Store
            </h2>
            <span className="text-xs text-muted-foreground">{salesByStore.length} stores</span>
          </div>
          {salesByStore.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No sales in this period</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Store</TableHead>
                    <TableHead className="text-xs text-right">Orders</TableHead>
                    <TableHead className="text-xs text-right">Items</TableHead>
                    <TableHead className="text-xs text-right">Sales</TableHead>
                    <TableHead className="text-xs text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const totalItemSales = salesByStore.reduce((s, x) => s + x.sales, 0) || 1;
                    return salesByStore.map((s, i) => {
                      const share = (s.sales / totalItemSales) * 100;
                      const isPosOnly = s.name.startsWith("POS Only");
                      return (
                        <TableRow key={s.name + i} className="text-xs">
                          <TableCell className="font-medium text-foreground">
                            {isPosOnly ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Badge variant="secondary" className="text-[10px]">POS Only</Badge>
                                <span className="text-muted-foreground">no WooCommerce store</span>
                              </span>
                            ) : s.name}
                          </TableCell>
                          <TableCell className="text-right">{s.orders}</TableCell>
                          <TableCell className="text-right">{s.qty}</TableCell>
                          <TableCell className="text-right font-semibold">৳{s.sales.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{share.toFixed(1)}%</TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* Orders ledger */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-border">
          <div>
            <h2 className="font-heading text-sm font-medium text-card-foreground">POS Orders</h2>
            <p className="text-xs text-muted-foreground mt-0.5">All POS orders in selected period</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search order #, customer, cashier"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-64 text-xs"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Order #</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Customer</TableHead>
                <TableHead className="text-xs">Cashier</TableHead>
                <TableHead className="text-xs text-right">Items</TableHead>
                <TableHead className="text-xs text-right">Subtotal</TableHead>
                <TableHead className="text-xs text-right">Discount</TableHead>
                <TableHead className="text-xs text-right">Delivery</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
                <TableHead className="text-xs text-right">Paid</TableHead>
                <TableHead className="text-xs text-right">Due</TableHead>
                <TableHead className="text-xs">Payment</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center text-sm text-muted-foreground py-10">
                    No POS orders in this period
                  </TableCell>
                </TableRow>
              ) : filteredOrders.map((o) => {
                const paid = paidByOrder.get(o.id) || 0;
                const due = Math.max(0, Number(o.total) - paid);
                return (
                  <TableRow
                    key={o.id}
                    className="text-xs cursor-pointer"
                    onClick={() => setDetailOrderId(o.id)}
                  >
                    <TableCell className="font-medium text-foreground">{o.order_number}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{format(new Date(o.created_at), "MMM d, HH:mm")}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{o.customer_name || "Walk-in"}</TableCell>
                    <TableCell className="max-w-[140px] truncate text-muted-foreground">{o.salesperson_name || "—"}</TableCell>
                    <TableCell className="text-right">{itemsByOrder.get(o.id) || 0}</TableCell>
                    <TableCell className="text-right">৳{Number(o.subtotal || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{o.discount ? `-৳${Number(o.discount).toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{o.shipping_cost ? `৳${Number(o.shipping_cost).toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="text-right font-semibold text-foreground">৳{Number(o.total).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-success">৳{paid.toLocaleString()}</TableCell>
                    <TableCell className={`text-right font-medium ${due > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {due > 0 ? `৳${due.toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const ms = methodsByOrder.get(o.id) || (o.payment_method ? [o.payment_method] : []);
                        if (ms.length === 0) return <Badge variant="outline" className="text-[10px]">—</Badge>;
                        return (
                          <div className="flex flex-wrap gap-1">
                            {ms.map((m) => (
                              <Badge key={m} variant="outline" className="text-[10px] capitalize">{m}</Badge>
                            ))}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default PosReports;
