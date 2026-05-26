import { useEffect, useMemo, useState } from "react";
import {
  DollarSign, ShoppingCart, Truck, Wallet, Download, Receipt, Store, Package, Coins, CheckCircle2, Clock,
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
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_email: string | null;
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

      const baseSelect = "id, order_number, total, subtotal, discount, shipping_cost, tax_amount, status, payment_status, payment_method, created_at, customer_name, customer_phone, customer_address, customer_city, customer_email, salesperson_name, store_id, fulfillment_type";

      let curQ = supabase.from("orders").select(baseSelect).eq("source", "pos").is("deleted_at", null).order("created_at", { ascending: false }).limit(10000);
      let prevQ = supabase.from("orders").select(baseSelect).eq("source", "pos").is("deleted_at", null).limit(10000);

      if (storeFilter !== "all") {
        curQ = curQ.eq("store_id", storeFilter);
        prevQ = prevQ.eq("store_id", storeFilter);
      }

      if (from) curQ = curQ.gte("created_at", from.toISOString());
      if (to) curQ = curQ.lte("created_at", to.toISOString());

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
          supabase.from("order_payments").select("method, amount, order_id").in("order_id", ids).limit(50000),
          supabase.from("order_items").select("quantity, order_id, product_name, line_total, product_id").in("order_id", ids).limit(50000),
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

  // Exclude cancelled orders from all sales/revenue rollups so KPIs, trend,
  // payment mix, top products and store mix stay consistent with each other.
  const activeOrders = useMemo(() => orders.filter((o) => o.status !== "cancelled"), [orders]);
  const activePrevOrders = useMemo(() => prevOrders.filter((o) => o.status !== "cancelled"), [prevOrders]);
  const activeOrderIds = useMemo(() => new Set(activeOrders.map((o) => o.id)), [activeOrders]);
  const activeItems = useMemo(() => items.filter((i) => activeOrderIds.has(i.order_id)), [items, activeOrderIds]);
  const activePayments = useMemo(() => payments.filter((p) => activeOrderIds.has(p.order_id)), [payments, activeOrderIds]);

  const stats = useMemo(() => {
    const totalSales = activeOrders.reduce((s, o) => s + Number(o.total), 0);
    const deliveryCharge = activeOrders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
    const totalTax = activeOrders.reduce((s, o) => s + Number(o.tax_amount || 0), 0);
    const netSales = activeOrders.reduce((s, o) => {
      const sub = Number(o.subtotal || 0);
      const disc = Number(o.discount || 0);
      return s + (sub - disc);
    }, 0);

    let dues = 0;
    let changeGiven = 0;
    for (const o of activeOrders) {
      const paid = paidByOrder.get(o.id) || 0;
      const diff = paid - Number(o.total);
      if (diff > 0) changeGiven += diff;
      else if (diff < 0) dues += -diff;
    }

    const prevTotal = activePrevOrders.reduce((s, o) => s + Number(o.total), 0);
    const prevNet = activePrevOrders.reduce((s, o) => s + (Number(o.subtotal || 0) - Number(o.discount || 0)), 0);
    const prevDelivery = activePrevOrders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
    const prevOrderCount = activePrevOrders.length;

    const deliveredOrders = activeOrders.filter(o => o.status === "delivered" || o.status === "completed");
    const deliveredCount = deliveredOrders.length;
    const deliveredSales = deliveredOrders.reduce((s, o) => s + Number(o.total), 0);

    const pendingOrders = activeOrders.filter(o => {
      const isPreOrder = o.status.startsWith("pre_order");
      const isDeliveryOrPickup = o.fulfillment_type === "delivery" || o.fulfillment_type === "pickup";
      const isNotFinal = o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled" && o.status !== "returned";
      return (isPreOrder || isDeliveryOrPickup) && isNotFinal;
    });
    const pendingCount = pendingOrders.length;
    const pendingSales = pendingOrders.reduce((s, o) => s + Number(o.total), 0);

    const prevDeliveredOrders = activePrevOrders.filter(o => o.status === "delivered" || o.status === "completed");
    const prevDeliveredCount = prevDeliveredOrders.length;
    const prevDeliveredSales = prevDeliveredOrders.reduce((s, o) => s + Number(o.total), 0);

    const prevPendingOrders = activePrevOrders.filter(o => {
      const isPreOrder = o.status.startsWith("pre_order");
      const isDeliveryOrPickup = o.fulfillment_type === "delivery" || o.fulfillment_type === "pickup";
      const isNotFinal = o.status !== "delivered" && o.status !== "completed" && o.status !== "cancelled" && o.status !== "returned";
      return (isPreOrder || isDeliveryOrPickup) && isNotFinal;
    });
    const prevPendingCount = prevPendingOrders.length;
    const prevPendingSales = prevPendingOrders.reduce((s, o) => s + Number(o.total), 0);

    return {
      totalSales, netSales, deliveryCharge, totalTax, dues, changeGiven,
      orderCount: activeOrders.length,
      prevTotal, prevNet, prevDelivery, prevOrderCount,
      deliveredCount, deliveredSales, pendingCount, pendingSales,
      prevDeliveredCount, prevDeliveredSales, prevPendingCount, prevPendingSales,
    };
  }, [activeOrders, activePrevOrders, paidByOrder]);

  // Top POS products by quantity & revenue
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const it of activeItems) {
      const key = it.product_name || "Unknown";
      const cur = map.get(key) || { name: key, qty: 0, revenue: 0 };
      cur.qty += Number(it.quantity || 0);
      cur.revenue += Number(it.line_total || 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [activeItems]);

  // Sales by store — attributed by each line item's product origin (which WooCommerce store it belongs to).
  // Items whose product has no woo_product_id (or no store link) are bucketed as "POS Only".
  const salesByStore = useMemo(() => {
    const storeMap = new Map(stores.map((s) => [s.id, s.name]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const map = new Map<string, { name: string; sales: number; qty: number; orderIds: Set<string> }>();

    for (const it of activeItems) {
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
  }, [activeItems, products, stores]);

  // Trend — sort by real date, not by insertion order (orders arrive desc).
  const trendData = useMemo(() => {
    const grouped: Record<string, { date: string; sortKey: number; sales: number; orders: number }> = {};
    for (const o of activeOrders) {
      const d = new Date(o.created_at);
      const key = format(d, "yyyy-MM-dd");
      if (!grouped[key]) {
        grouped[key] = { date: format(d, "MMM d"), sortKey: d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(), sales: 0, orders: 0 };
      }
      grouped[key].sales += Number(o.total);
      grouped[key].orders++;
    }
    return Object.values(grouped)
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ date, sales, orders }) => ({ date, sales, orders }));
  }, [activeOrders]);

  const paymentBreakdown = useMemo(() => {
    // Actual collected per method (sum of order_payments only — excludes dues).
    const collected: Record<string, number> = {};
    for (const p of activePayments) {
      const m = (p.method || "other").toLowerCase();
      collected[m] = (collected[m] || 0) + Number(p.amount);
    }
    // Outstanding due per method — attributed to each order's primary method
    // (first recorded payment method, falling back to order.payment_method).
    const due: Record<string, number> = {};
    for (const o of activeOrders) {
      const paid = paidByOrder.get(o.id) || 0;
      const orderDue = Number(o.total) - paid;
      if (orderDue <= 0) continue;
      const methods = methodsByOrder.get(o.id) || [];
      const primary = (methods[0] || o.payment_method || "other").toLowerCase();
      due[primary] = (due[primary] || 0) + orderDue;
    }
    const names = new Set<string>([...Object.keys(collected), ...Object.keys(due)]);
    return Array.from(names)
      .map((name) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value: collected[name] || 0,
        due: due[name] || 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [activePayments, activeOrders, paidByOrder, methodsByOrder]);


  const filteredOrders = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter((o) =>
      o.order_number.toLowerCase().includes(q) ||
      (o.customer_name || "").toLowerCase().includes(q) ||
      (o.customer_phone || "").toLowerCase().includes(q) ||
      (o.customer_address || "").toLowerCase().includes(q) ||
      (o.customer_city || "").toLowerCase().includes(q) ||
      (o.salesperson_name || "").toLowerCase().includes(q),
    );
  }, [orders, search]);

  const exportOrdersCsv = () => {
    const headers = ["Order #", "Date", "Customer", "Phone", "Address", "Cashier", "Items", "Subtotal", "Discount", "Delivery", "Total", "Paid", "Due", "Payment", "Status"];
    const rows = filteredOrders.map((o) => {
      const paid = paidByOrder.get(o.id) || 0;
      const due = Math.max(0, Number(o.total) - paid);
      const fullAddr = [o.customer_address, o.customer_city].filter(Boolean).join(", ");
      return [
        o.order_number,
        format(new Date(o.created_at), "yyyy-MM-dd HH:mm"),
        o.customer_name || "Walk-in",
        o.customer_phone || "",
        fullAddr,
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
          icon={Wallet}
          title="Sales Collected"
          value={`৳${Math.max(0, stats.totalSales - stats.dues).toLocaleString()}`}
          subtitle="Total sales minus outstanding dues"
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
        <StatCardDelta
          icon={CheckCircle2}
          title="Delivered Orders"
          value={`৳${stats.deliveredSales.toLocaleString()}`}
          currentValue={stats.deliveredSales}
          prevValue={stats.prevDeliveredSales}
          subtitle={`${stats.deliveredCount} orders delivered`}
        />
        <StatCardDelta
          icon={Clock}
          title="Pending Delivery/Pickup"
          value={`৳${stats.pendingSales.toLocaleString()}`}
          currentValue={stats.pendingSales}
          prevValue={stats.prevPendingSales}
          subtitle={`${stats.pendingCount} orders in progress`}
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
              <div key={i} className="flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-foreground truncate">{p.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 tabular-nums">
                  <span className="font-medium text-foreground">৳{p.value.toLocaleString()}</span>
                  {p.due > 0 && (
                    <span className="text-amber-600 dark:text-amber-500" title="Outstanding due">
                      (Due ৳{p.due.toLocaleString()})
                    </span>
                  )}
                </div>
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
              className="h-8 w-full sm:w-64 text-xs"
            />
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden p-3 space-y-2">
          {filteredOrders.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-10">No POS orders in this period</div>
          ) : filteredOrders.map((o) => {
            const paid = paidByOrder.get(o.id) || 0;
            const due = Math.max(0, Number(o.total) - paid);
            const ms = methodsByOrder.get(o.id) || (o.payment_method ? [o.payment_method] : []);
            const addr = [o.customer_address, o.customer_city].filter(Boolean).join(", ");
            return (
              <div
                key={o.id}
                role="button"
                onClick={() => setDetailOrderId(o.id)}
                className="rounded-lg border border-border bg-card p-3 active:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-foreground truncate">#{o.order_number}</div>
                  <div className="font-semibold text-foreground whitespace-nowrap">৳{Number(o.total).toLocaleString()}</div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {format(new Date(o.created_at), "MMM d, h:mm a")}
                  {o.salesperson_name ? ` · ${o.salesperson_name}` : ""}
                </div>
                <div className="mt-2 text-sm text-foreground truncate">{o.customer_name || "Walk-in"}</div>
                {o.customer_phone && (
                  <div className="text-xs text-muted-foreground truncate">{o.customer_phone}</div>
                )}
                {addr && (
                  <div className="text-xs text-muted-foreground truncate">{addr}</div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={o.status} />
                  {ms.map((m) => (
                    <Badge key={m} variant="outline" className="text-[10px] capitalize">{m}</Badge>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Items</div>
                    <div className="font-medium text-foreground">{itemsByOrder.get(o.id) || 0}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Paid</div>
                    <div className="font-medium text-success">৳{paid.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Due</div>
                    <div className={`font-medium ${due > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {due > 0 ? `৳${due.toLocaleString()}` : "—"}
                    </div>
                  </div>
                </div>
                {(o.discount || o.shipping_cost) ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {o.discount ? `Discount -৳${Number(o.discount).toLocaleString()}` : ""}
                    {o.discount && o.shipping_cost ? " · " : ""}
                    {o.shipping_cost ? `Delivery ৳${Number(o.shipping_cost).toLocaleString()}` : ""}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
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
                    <TableCell className="max-w-[200px] align-top">
                      <div className="font-medium text-foreground truncate">{o.customer_name || "Walk-in"}</div>
                      {o.customer_phone && (
                        <div className="text-[11px] text-muted-foreground truncate">{o.customer_phone}</div>
                      )}
                      {(o.customer_address || o.customer_city) && (
                        <div className="text-[11px] text-muted-foreground truncate" title={[o.customer_address, o.customer_city].filter(Boolean).join(", ")}>
                          {[o.customer_address, o.customer_city].filter(Boolean).join(", ")}
                        </div>
                      )}
                      {o.customer_email && (
                        <div className="text-[11px] text-muted-foreground truncate">{o.customer_email}</div>
                      )}
                    </TableCell>
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

      <OrderDetailSheet
        orderId={detailOrderId}
        open={!!detailOrderId}
        onOpenChange={(open) => { if (!open) setDetailOrderId(null); }}
      />
    </div>
  );
};

export default PosReports;

