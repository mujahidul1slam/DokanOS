import { useEffect, useMemo, useState } from "react";
import {
  DollarSign, ShoppingCart, Truck, Wallet, Download, Receipt, Store, Package, Coins,
  CheckCircle2, Clock, RotateCcw, Banknote, CreditCard, AlertTriangle, TrendingUp, TrendingDown,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { format, subDays, differenceInDays } from "date-fns";
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
import PosOrdersLedger from "@/pages/posReports/PosOrdersLedger";
import ArOutstandingTable from "@/pages/posReports/ArOutstandingTable";
import SalesSection from "@/pages/posReports/SalesSection";
import CashSection from "@/pages/posReports/CashSection";
import FulfillmentSection from "@/pages/posReports/FulfillmentSection";
import { AgingCard } from "@/pages/posReports/cards";

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
  id: string;
  method: string;
  amount: number;
  order_id: string;
  created_at: string;
  notes: string | null;
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

interface ReturnRow {
  id: string;
  order_id: string | null;
  refund_amount: number;
  refund_method: string;
  created_at: string;
}

interface StoreRow { id: string; name: string; }

const COLORS = ["hsl(217,91%,60%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)", "hsl(291,64%,42%)", "hsl(0,84%,60%)", "hsl(180,60%,45%)"];

const METHOD_ICON: Record<string, any> = {
  cash: Banknote, bkash: Wallet, nagad: Wallet, rocket: Wallet,
  card: CreditCard, bank: Banknote, cod: Truck, other: Coins,
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const PosReports = () => {
  // ---- filters ----
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  // ---- data ----
  const [orders, setOrders] = useState<PosOrder[]>([]); // orders created in [from,to]
  const [prevOrders, setPrevOrders] = useState<PosOrder[]>([]); // prior comparison window
  const [items, setItems] = useState<ItemRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [paymentsInPeriod, setPaymentsInPeriod] = useState<PaymentRow[]>([]); // by payment date
  const [paymentsByOrderId, setPaymentsByOrderId] = useState<Map<string, PaymentRow[]>>(new Map()); // all pmts on the in-period orders (any date)
  const [parentOrderMap, setParentOrderMap] = useState<Map<string, { created_at: string; order_number: string }>>(new Map());
  const [orderAllocMap, setOrderAllocMap] = useState<Map<string, { shipping: number; total: number }>>(new Map());
  const [returnsInPeriod, setReturnsInPeriod] = useState<ReturnRow[]>([]);
  const [arOrders, setArOrders] = useState<PosOrder[]>([]); // outstanding-balance orders (last 12 mo)
  const [arPaidMap, setArPaidMap] = useState<Map<string, number>>(new Map());
  const [stores, setStores] = useState<StoreRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { from, to, days } = resolveRange(datePreset, customRange);
      const prevFrom = from && days ? subDays(from, days) : null;
      const arWindowStart = subDays(new Date(), 365).toISOString();

      const baseSelect = "id, order_number, total, subtotal, discount, shipping_cost, tax_amount, status, payment_status, payment_method, created_at, customer_name, customer_phone, customer_address, customer_city, customer_email, salesperson_name, store_id, fulfillment_type";

      // current orders (in period, by order date)
      let curQ = supabase.from("orders").select(baseSelect).eq("source", "pos").is("deleted_at", null).order("created_at", { ascending: false }).limit(10000);
      // previous period orders (for deltas)
      let prevQ = supabase.from("orders").select(baseSelect).eq("source", "pos").is("deleted_at", null).limit(10000);
      // AR orders: not fully paid, not cancelled, last 12 months
      let arQ = supabase.from("orders").select(baseSelect).eq("source", "pos").is("deleted_at", null)
        .neq("payment_status", "paid").neq("status", "cancelled")
        .gte("created_at", arWindowStart).order("created_at", { ascending: true }).limit(10000);
      // payments in period (by payment created_at) - filtered for POS and non-cancelled orders
      let payInPeriodQ = supabase.from("order_payments")
        .select("id, method, amount, order_id, created_at, notes, orders!inner(source, status, store_id)")
        .eq("orders.source", "pos")
        .neq("orders.status", "cancelled")
        .is("orders.deleted_at", null)
        .limit(20000);
      // returns in period (by return created_at)
      let retInPeriodQ = supabase.from("pos_returns").select("id, order_id, refund_amount, refund_method, created_at, store_id").limit(10000);

      if (storeFilter !== "all") {
        curQ = curQ.eq("store_id", storeFilter);
        prevQ = prevQ.eq("store_id", storeFilter);
        arQ = arQ.eq("store_id", storeFilter);
        retInPeriodQ = retInPeriodQ.eq("store_id", storeFilter);
      }
      if (from) {
        curQ = curQ.gte("created_at", from.toISOString());
        payInPeriodQ = payInPeriodQ.gte("created_at", from.toISOString());
        retInPeriodQ = retInPeriodQ.gte("created_at", from.toISOString());
      }
      if (to) {
        curQ = curQ.lte("created_at", to.toISOString());
        payInPeriodQ = payInPeriodQ.lte("created_at", to.toISOString());
        retInPeriodQ = retInPeriodQ.lte("created_at", to.toISOString());
      }
      if (storeFilter !== "all") {
        payInPeriodQ = payInPeriodQ.eq("orders.store_id", storeFilter);
      }
      if (prevFrom && from) {
        prevQ = prevQ.gte("created_at", prevFrom.toISOString()).lt("created_at", from.toISOString());
      } else {
        prevQ = prevQ.eq("id", "00000000-0000-0000-0000-000000000000");
      }

      const [curRes, prevRes, arRes, payRes, retRes, storesRes] = await Promise.all([
        curQ, prevQ, arQ, payInPeriodQ, retInPeriodQ,
        supabase.from("stores").select("id, name"),
      ]);

      const curData = (curRes.data || []) as PosOrder[];
      const arData = (arRes.data || []) as PosOrder[];
      setOrders(curData);
      setPrevOrders((prevRes.data || []) as PosOrder[]);
      setArOrders(arData);
      setStores((storesRes.data || []) as StoreRow[]);
      const payInPeriodRaw = (payRes.data || []) as any[];
      const payInPeriod: PaymentRow[] = payInPeriodRaw.map(p => ({
        id: p.id,
        method: p.method,
        amount: p.amount,
        order_id: p.order_id,
        created_at: p.created_at,
        notes: p.notes
      }));
      setPaymentsInPeriod(payInPeriod);
      setReturnsInPeriod((retRes.data || []) as ReturnRow[]);

      // Items + products for the in-period orders (sales analytics)
      const curIds = curData.map((o) => o.id);
      if (curIds.length > 0) {
        const { data: itemsData } = await supabase.from("order_items")
          .select("quantity, order_id, product_name, line_total, product_id").in("order_id", curIds).limit(50000);
        const itemRows = (itemsData || []) as ItemRow[];
        setItems(itemRows);

        const productIds = Array.from(new Set(itemRows.map((i) => i.product_id).filter(Boolean))) as string[];
        if (productIds.length > 0) {
          const { data: prodData } = await supabase.from("products")
            .select("id, store_id, woo_product_id").in("id", productIds);
          setProducts((prodData || []) as ProductRow[]);
        } else setProducts([]);
      } else {
        setItems([]);
        setProducts([]);
      }

      // All payments on the in-period orders (any date) — for due/paid per order in ledger
      const allPaymentsMap = new Map<string, PaymentRow[]>();
      if (curIds.length > 0) {
        const { data: allPays } = await supabase.from("order_payments")
          .select("id, method, amount, order_id, created_at, notes").in("order_id", curIds).limit(50000);
        for (const p of (allPays || []) as PaymentRow[]) {
          const arr = allPaymentsMap.get(p.order_id) || [];
          arr.push(p);
          allPaymentsMap.set(p.order_id, arr);
        }
      }
      setPaymentsByOrderId(allPaymentsMap);

      // Parent order info for payments-in-period (for "collections on prior orders")
      const payOrderIds = Array.from(new Set(payInPeriod.map((p) => p.order_id))).filter((id) => !curIds.includes(id));
      const parentMap = new Map<string, { created_at: string; order_number: string }>();
      const allocM = new Map<string, { shipping: number; total: number }>();
      if (payOrderIds.length > 0) {
        const { data: parents } = await supabase.from("orders")
          .select("id, created_at, order_number, shipping_cost, total, fulfillment_type").in("id", payOrderIds).limit(10000);
        for (const o of (parents || []) as any[]) {
          parentMap.set(o.id, { created_at: o.created_at, order_number: o.order_number });
          allocM.set(o.id, { shipping: Number(o.shipping_cost || 0), total: Number(o.total || 0) });
        }
      }
      // Also add in-period orders to parent map so cash section can reference them
      for (const o of curData) {
        parentMap.set(o.id, { created_at: o.created_at, order_number: o.order_number });
        allocM.set(o.id, { shipping: Number(o.shipping_cost || 0), total: Number(o.total || 0) });
      }
      for (const o of arData) {
        if (!allocM.has(o.id)) allocM.set(o.id, { shipping: Number(o.shipping_cost || 0), total: Number(o.total || 0) });
      }
      setParentOrderMap(parentMap);
      setOrderAllocMap(allocM);

      // AR paid totals (all payments against AR orders)
      const arPaidM = new Map<string, number>();
      const arIds = arData.map((o) => o.id);
      if (arIds.length > 0) {
        const { data: arPays } = await supabase.from("order_payments")
          .select("order_id, amount").in("order_id", arIds).limit(50000);
        for (const p of (arPays || []) as any[]) {
          arPaidM.set(p.order_id, (arPaidM.get(p.order_id) || 0) + Number(p.amount));
        }
      }
      setArPaidMap(arPaidM);

      setLoading(false);
    };
    load();
  }, [datePreset, customRange, storeFilter]);

  const resolved = resolveRange(datePreset, customRange);

  // ---- helpers ----
  const paidByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const [oid, arr] of paymentsByOrderId.entries()) {
      m.set(oid, arr.reduce((s, p) => s + Number(p.amount), 0));
    }
    return m;
  }, [paymentsByOrderId]);

  const methodsByOrder = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [oid, arr] of paymentsByOrderId.entries()) {
      const set = new Set<string>();
      for (const p of arr) if (p.method) set.add(p.method);
      m.set(oid, Array.from(set));
    }
    return m;
  }, [paymentsByOrderId]);

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.order_id, (m.get(i.order_id) || 0) + Number(i.quantity));
    return m;
  }, [items]);

  const activeOrders = useMemo(() => orders.filter((o) => o.status !== "cancelled"), [orders]);
  const activePrevOrders = useMemo(() => prevOrders.filter((o) => o.status !== "cancelled"), [prevOrders]);
  const activeOrderIds = useMemo(() => new Set(activeOrders.map((o) => o.id)), [activeOrders]);
  const activeItems = useMemo(() => items.filter((i) => activeOrderIds.has(i.order_id)), [items, activeOrderIds]);

  // ============ SALES (accrual, by order date) ============
  const salesStats = useMemo(() => {
    const gross = activeOrders.reduce((s, o) => s + Number(o.subtotal || 0), 0);
    const discounts = activeOrders.reduce((s, o) => s + Number(o.discount || 0), 0);
    const returnsTotal = returnsInPeriod.reduce((s, r) => s + Number(r.refund_amount || 0), 0);
    const net = gross - discounts - returnsTotal;
    const shipping = activeOrders.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
    const tax = activeOrders.reduce((s, o) => s + Number(o.tax_amount || 0), 0);
    const totalInvoiced = activeOrders.reduce((s, o) => s + Number(o.total || 0), 0) - returnsTotal;

    const prevGross = activePrevOrders.reduce((s, o) => s + Number(o.subtotal || 0), 0);
    const prevDiscounts = activePrevOrders.reduce((s, o) => s + Number(o.discount || 0), 0);
    const prevNet = prevGross - prevDiscounts;

    return {
      gross, discounts, returnsTotal, net,
      orderCount: activeOrders.length,
      prevNet, prevOrderCount: activePrevOrders.length,
      shipping, tax, totalInvoiced,
    };
  }, [activeOrders, activePrevOrders, returnsInPeriod]);

  // ============ CASH COLLECTED (by payment date) ============
  const cashStats = useMemo(() => {
    const inPeriodOrderIds = new Set(orders.map((o) => o.id));
    let collectedTotal = 0;
    let onPriorOrders = 0;
    let shippingCollected = 0;
    let productCollected = 0;
    let unallocated = 0;
    const byMethod: Record<string, number> = {};
    const byMethodProduct: Record<string, number> = {};
    const byMethodShipping: Record<string, number> = {};
    for (const p of paymentsInPeriod) {
      const amt = Number(p.amount);
      collectedTotal += amt;
      const m = (p.method || "other").toLowerCase();
      byMethod[m] = (byMethod[m] || 0) + amt;
      if (!inPeriodOrderIds.has(p.order_id)) onPriorOrders += amt;

      const alloc = orderAllocMap.get(p.order_id);
      if (alloc && alloc.total > 0) {
        const shipShare = (alloc.shipping || 0) / alloc.total;
        const shipPart = amt * shipShare;
        const prodPart = amt - shipPart;
        shippingCollected += shipPart;
        productCollected += prodPart;
        byMethodShipping[m] = (byMethodShipping[m] || 0) + shipPart;
        byMethodProduct[m] = (byMethodProduct[m] || 0) + prodPart;
      } else {
        unallocated += amt;
        productCollected += amt;
        byMethodProduct[m] = (byMethodProduct[m] || 0) + amt;
      }
    }
    const refundsTotal = returnsInPeriod.reduce((s, r) => s + Number(r.refund_amount || 0), 0);
    const netCash = collectedTotal - refundsTotal;
    return {
      collectedTotal, onPriorOrders, byMethod, refundsTotal, netCash,
      shippingCollected, productCollected, unallocated,
      byMethodProduct, byMethodShipping,
    };
  }, [paymentsInPeriod, orders, returnsInPeriod, orderAllocMap]);

  const cashByMethod = useMemo(() => {
    return Object.entries(cashStats.byMethod)
      .map(([name, value]) => ({ name: cap(name), key: name, value }))
      .sort((a, b) => b.value - a.value);
  }, [cashStats]);

  // ============ FULFILLMENT (counts, by order date) ============
  const fulfillStats = useMemo(() => {
    const buckets = {
      walkinDelivered: 0,
      pickupPending: 0,
      pickupCompleted: 0,
      deliveryPending: 0,
      deliveryCompleted: 0,
      cancelled: 0,
      returned: 0,
    };
    let deliveryShippingBilled = 0;
    let deliveryShippingOutstanding = 0;
    for (const o of orders) {
      const ft = (o.fulfillment_type || "walkin").toLowerCase();
      const st = (o.status || "").toLowerCase();
      if (st === "cancelled") { buckets.cancelled++; continue; }
      if (st === "returned") { buckets.returned++; continue; }
      const done = st === "delivered" || st === "completed";
      if (ft === "walkin") {
        buckets.walkinDelivered++;
      } else if (ft === "pickup") {
        if (done) buckets.pickupCompleted++;
        else buckets.pickupPending++;
      } else if (ft === "delivery") {
        if (done) buckets.deliveryCompleted++;
        else buckets.deliveryPending++;
        const ship = Number(o.shipping_cost || 0);
        deliveryShippingBilled += ship;
        const paid = paidByOrder.get(o.id) || 0;
        const outstanding = Math.max(0, Number(o.total) - paid);
        const total = Number(o.total) || 0;
        // shipping portion still outstanding (proportional)
        if (total > 0) deliveryShippingOutstanding += outstanding * (ship / total);
      } else {
        if (done) buckets.walkinDelivered++;
      }
    }
    return { ...buckets, deliveryShippingBilled, deliveryShippingOutstanding };
  }, [orders, paidByOrder]);

  // ============ ACCOUNTS RECEIVABLE ============
  const arStats = useMemo(() => {
    const { from, to } = resolved;
    const now = new Date();
    const rangeEnd = to || now;
    const rangeStart = from;

    // Outstanding per AR order (using ALL payments against it)
    type OutRow = { order: PosOrder; outstanding: number; paid: number };
    const out: OutRow[] = arOrders
      .map((o) => {
        const paid = arPaidMap.get(o.id) || 0;
        const outstanding = Math.max(0, Number(o.total) - paid);
        return { order: o, outstanding, paid };
      })
      .filter((r) => r.outstanding > 0.0001);

    // Closing AR = sum of outstanding right now (cap to last 12 mo)
    const closingAR = out.reduce((s, r) => s + r.outstanding, 0);

    // New credit issued in range = (total - sum payments made on/before rangeEnd) for orders created in range, only if originally not fully prepaid
    // Approximation: for in-period orders, new credit = sum(max(0, total - paid_within_range))
    let newCredit = 0;
    const inPeriodPaidWithin = new Map<string, number>();
    for (const p of paymentsInPeriod) {
      if (orders.find((o) => o.id === p.order_id)) {
        inPeriodPaidWithin.set(p.order_id, (inPeriodPaidWithin.get(p.order_id) || 0) + Number(p.amount));
      }
    }
    for (const o of activeOrders) {
      const paidWithin = inPeriodPaidWithin.get(o.id) || 0;
      newCredit += Math.max(0, Number(o.total) - paidWithin);
    }

    // Collections in range = sum of payments-in-period
    const collections = paymentsInPeriod.reduce((s, p) => s + Number(p.amount), 0);

    // Opening AR = closingAR - newCredit + collections (approx)
    const openingAR = Math.max(0, closingAR - newCredit + collections);

    // Aging buckets (relative to now)
    const aging = { d0_7: 0, d8_30: 0, d31_60: 0, d60p: 0 };
    const agingCount = { d0_7: 0, d8_30: 0, d31_60: 0, d60p: 0 };
    for (const r of out) {
      const days = differenceInDays(now, new Date(r.order.created_at));
      if (days <= 7) { aging.d0_7 += r.outstanding; agingCount.d0_7++; }
      else if (days <= 30) { aging.d8_30 += r.outstanding; agingCount.d8_30++; }
      else if (days <= 60) { aging.d31_60 += r.outstanding; agingCount.d31_60++; }
      else { aging.d60p += r.outstanding; agingCount.d60p++; }
    }

    const sortedOut = [...out].sort((a, b) => +new Date(a.order.created_at) - +new Date(b.order.created_at));

    return { closingAR, newCredit, collections, openingAR, aging, agingCount, out: sortedOut };
  }, [arOrders, arPaidMap, paymentsInPeriod, orders, activeOrders, resolved]);

  // ============ Charts/lists ============
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

  const salesByStore = useMemo(() => {
    const storeMap = new Map(stores.map((s) => [s.id, s.name]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const map = new Map<string, { name: string; sales: number; qty: number; orderIds: Set<string> }>();
    for (const it of activeItems) {
      const prod = it.product_id ? productMap.get(it.product_id) : null;
      let key: string, name: string;
      if (prod && prod.store_id && prod.woo_product_id) {
        key = prod.store_id;
        name = storeMap.get(prod.store_id) || "Unknown Store";
      } else { key = "__pos_only__"; name = "POS Only (no WooCommerce store)"; }
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

  const trendData = useMemo(() => {
    const grouped: Record<string, { date: string; sortKey: number; sales: number; orders: number }> = {};
    for (const o of activeOrders) {
      const d = new Date(o.created_at);
      const key = format(d, "yyyy-MM-dd");
      if (!grouped[key]) {
        grouped[key] = { date: format(d, "MMM d"), sortKey: +d, sales: 0, orders: 0 };
      }
      grouped[key].sales += Number(o.subtotal || 0) - Number(o.discount || 0);
      grouped[key].orders++;
    }
    return Object.values(grouped).sort((a, b) => a.sortKey - b.sortKey).map(({ date, sales, orders }) => ({ date, sales, orders }));
  }, [activeOrders]);

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
        o.order_number, format(new Date(o.created_at), "yyyy-MM-dd HH:mm"),
        o.customer_name || "Walk-in", o.customer_phone || "", fullAddr,
        o.salesperson_name || "—", String(itemsByOrder.get(o.id) || 0),
        String(o.subtotal || 0), String(o.discount || 0), String(o.shipping_cost || 0),
        String(o.total), String(paid), String(due),
        (methodsByOrder.get(o.id) || (o.payment_method ? [o.payment_method] : [])).join(", ") || "—",
        o.status,
      ];
    });
    downloadCsv(`pos-orders-${datePreset}.csv`, headers, rows);
  };

  const exportArCsv = () => {
    const headers = ["Order #", "Date", "Customer", "Phone", "Total", "Paid", "Outstanding", "Age (days)", "Status"];
    const now = new Date();
    const rows = arStats.out.map((r) => [
      r.order.order_number, format(new Date(r.order.created_at), "yyyy-MM-dd"),
      r.order.customer_name || "Walk-in", r.order.customer_phone || "",
      String(r.order.total), String(r.paid), String(r.outstanding),
      String(differenceInDays(now, new Date(r.order.created_at))), r.order.status,
    ]);
    downloadCsv(`pos-receivables-${datePreset}.csv`, headers, rows);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div><h1 className="font-heading text-2xl font-semibold">POS Reports</h1></div>
        <StatsSkeleton />
      </div>
    );
  }

  const rangeLabel = resolved.from
    ? `${format(resolved.from, "MMM d")} – ${format(resolved.to || new Date(), "MMM d, yyyy")}`
    : "All time";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">POS Reports</h1>
          <p className="text-sm text-muted-foreground">Sales, cash collection, fulfillment & receivables — {rangeLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stores.length > 0 && (
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Store" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
              </SelectContent>
            </Select>
          )}
          <DatePresetPicker preset={datePreset} customRange={customRange} onPresetChange={setDatePreset} onCustomRangeChange={setCustomRange} />
          <Button variant="outline" size="sm" onClick={exportOrdersCsv} className="gap-1.5">
            <Download className="h-4 w-4" /> Export Orders
          </Button>
        </div>
      </div>

      <SalesSection
        salesStats={salesStats}
        trendData={trendData}
        topProducts={topProducts}
        salesByStore={salesByStore}
      />

      <CashSection
        cashStats={cashStats}
        paymentsCount={paymentsInPeriod.length}
        cashByMethod={cashByMethod}
      />

      <FulfillmentSection
        fulfillStats={fulfillStats}
        shippingCollected={cashStats.shippingCollected}
      />

      {/* =================== ACCOUNTS RECEIVABLE =================== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" /> Accounts Receivable
            </h2>
            <p className="text-xs text-muted-foreground">Outstanding dues across the last 12 months · closing balance is always current</p>
          </div>
          <Button variant="outline" size="sm" onClick={exportArCsv} className="gap-1.5">
            <Download className="h-4 w-4" /> Export AR
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCardDelta icon={Wallet} title="Opening AR" value={`৳${arStats.openingAR.toLocaleString()}`} subtitle="At start of period (approx)" />
          <StatCardDelta icon={TrendingUp} title="New Credit Issued" value={`৳${arStats.newCredit.toLocaleString()}`} subtitle="Dues created in period" />
          <StatCardDelta icon={TrendingDown} title="Collections" value={`৳${arStats.collections.toLocaleString()}`} subtitle="Payments received in period" />
          <StatCardDelta icon={AlertTriangle} title="Closing AR" value={`৳${arStats.closingAR.toLocaleString()}`} subtitle={`${arStats.out.length} orders outstanding`} invertDelta />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <AgingCard label="0–7 days" amount={arStats.aging.d0_7} count={arStats.agingCount.d0_7} tone="success" />
          <AgingCard label="8–30 days" amount={arStats.aging.d8_30} count={arStats.agingCount.d8_30} tone="warning" />
          <AgingCard label="31–60 days" amount={arStats.aging.d31_60} count={arStats.agingCount.d31_60} tone="destructive" />
          <AgingCard label="60+ days" amount={arStats.aging.d60p} count={arStats.agingCount.d60p} tone="destructive" />
        </div>

        <ArOutstandingTable out={arStats.out} onOpen={setDetailOrderId} />
      </section>

      <PosOrdersLedger
        orders={filteredOrders}
        search={search}
        onSearchChange={setSearch}
        paidByOrder={paidByOrder}
        methodsByOrder={methodsByOrder}
        itemsByOrder={itemsByOrder}
        onOpen={setDetailOrderId}
      />

      <OrderDetailSheet
        orderId={detailOrderId}
        open={!!detailOrderId}
        onOpenChange={(open) => { if (!open) setDetailOrderId(null); }}
      />
    </div>
  );
};

// ----- Small presentational helpers -----
const toneClasses = {
  success: "border-success/30 bg-success/5 text-success",
  warning: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-500",
  destructive: "border-destructive/30 bg-destructive/5 text-destructive",
  default: "border-border bg-card text-foreground",
};

const FulfillCard = ({ icon: Icon, label, value, tone = "default" }: { icon: any; label: string; value: number; tone?: keyof typeof toneClasses }) => (
  <div className={`rounded-lg border p-4 ${toneClasses[tone]}`}>
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[11px] uppercase tracking-wide opacity-80">{label}</span>
      <Icon className="h-4 w-4 opacity-70" />
    </div>
    <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
  </div>
);

const AgingCard = ({ label, amount, count, tone = "default" }: { label: string; amount: number; count: number; tone?: keyof typeof toneClasses }) => (
  <div className={`rounded-lg border p-4 ${toneClasses[tone]}`}>
    <div className="text-[11px] uppercase tracking-wide opacity-80 mb-1.5">{label}</div>
    <div className="text-xl font-semibold tabular-nums">৳{amount.toLocaleString()}</div>
    <div className="text-xs opacity-70 mt-0.5">{count} order{count === 1 ? "" : "s"}</div>
  </div>
);

export default PosReports;
