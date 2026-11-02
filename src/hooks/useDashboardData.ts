import { useEffect, useMemo, useRef, useState } from "react";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";
import { type DatePreset, resolveRange } from "@/components/DatePresetPicker";
import { getEffectiveStock, useGlobalStockEnabled } from "@/lib/stockSettings";
import { NO_STORE_IDS, scopeStoreIds, selectedStoreScope } from "@/hooks/useActiveBusinessStoreIds";

export interface OrderRow {
  id: string;
  order_number: string;
  total: number;
  subtotal: number;
  discount: number | null;
  shipping_cost: number | null;
  status: string;
  source: string;
  payment_status: string;
  payment_method: string | null;
  created_at: string;
  customer_name: string | null;
  customer_id: string | null;
  consignment_id: string | null;
  store_id: string | null;
}

export interface OrderItemLite {
  product_id: string | null;
  product_name: string;
  quantity: number;
  line_total: number;
  unit_price?: number | null;
  order_id: string;
}

export interface ProductLite {
  id: string;
  name: string;
  sku: string | null;
  stock_quantity: number;
  price: number;
  cost_price: number | null;
  manage_stock?: boolean | null;
  stock_status?: string | null;
}

const BASE_SEL =
  "id, order_number, total, subtotal, discount, shipping_cost, status, source, payment_status, payment_method, created_at, customer_name, customer_id, consignment_id, store_id";

/** Statuses that should NOT contribute to revenue / AOV / mix / trend. */
const NON_REVENUE_STATUSES = new Set(["cancelled", "failed", "refunded", "returned"]);

const isRevenueOrder = (o: OrderRow) => !NON_REVENUE_STATUSES.has((o.status || "").toLowerCase());

const calcStats = (rows: OrderRow[]) => {
  const revenueRows = rows.filter(isRevenueOrder);
  const revenue = revenueRows.reduce((s, o) => s + Number(o.total), 0);
  const subtotal = revenueRows.reduce((s, o) => s + Number(o.subtotal || 0), 0);
  const discount = revenueRows.reduce((s, o) => s + Number(o.discount || 0), 0);
  const shipping = revenueRows.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
  return {
    revenue,
    subtotal,
    discount,
    shipping,
    orderCount: revenueRows.length,
    aov: revenueRows.length > 0 ? revenue / revenueRows.length : 0,
  };
};

const uniqueCustomersOf = (rows: OrderRow[]) => {
  const set = new Set<string>();
  rows.filter(isRevenueOrder).forEach((o) => {
    if (o.customer_id) set.add(`id:${o.customer_id}`);
    // Anonymous walk-ins: count each order as its own customer (no false dedupe by name)
    else set.add(`order:${o.id}`);
  });
  return set.size;
};

/**
 * Hybrid tenancy (issue #16): every read below is scoped to
 * `businessStoreIds` — the store ids of the ACTIVE business, supplied by
 * `useActiveBusinessStoreIds()`. An empty scope FAILS CLOSED: no query is issued
 * and no rows are returned, rather than reading the whole table (the old
 * cross-business leak). "all" therefore means all stores of the active business.
 */
export const useDashboardData = (
  datePreset: DatePreset,
  customRange: DateRange | undefined,
  storeId: string = "all",
  businessStoreIds: string[] = NO_STORE_IDS,
) => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [prevOrders, setPrevOrders] = useState<OrderRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemLite[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [allOrdersCount, setAllOrdersCount] = useState(0);
  const [productsCount, setProductsCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [outOfStockCount, setOutOfStockCount] = useState(0);
  const [loading, setLoading] = useState(true);
  /**
   * Loads started minus loads finished. `loading` only flips after the last
   * query of a scope sweep, so a caller that must observe a COMPLETE sweep (a
   * switch, or a test asserting that no further query follows) waits for
   * `pendingLoads === 0` instead of racing the multi-round-trip load.
   *
   * The accounting is symmetric by construction: a sweep takes exactly one count
   * at the point its queries start, every exit path that follows takes releases
   * that one count, and the fail-closed path (no store scope) starts no load and
   * therefore touches no count. Zero means every sweep that ever started has
   * stopped — including the ones whose responses were discarded after a switch.
   */
  const [pendingLoads, setPendingLoads] = useState(0);
  const globalStockEnabled = useGlobalStockEnabled();
  /** Latest-request token: stale responses from a previous scope never commit. */
  const loadToken = useRef(0);

  useEffect(() => {
    // A business/store switch re-runs this effect while the previous load may
    // still be in flight. Token-gate every commit so a late response from the
    // PREVIOUS business can never repaint the new business's KPIs.
    const token = ++loadToken.current;
    const load = async () => {
      const scope = selectedStoreScope(storeId, businessStoreIds);
      const source = scope.source;
      if (token !== loadToken.current) return; // superseded by a newer scope/switch

      // Fail closed BEFORE any query: with no store scope there is nothing this
      // business may read, so clear the KPI state instead of fetching everything.
      // This path starts no load, so it takes no count and releases none: a
      // decrement here would hand back a count that belongs to an earlier,
      // still-in-flight sweep and make `pendingLoads` read zero while that sweep
      // is running.
      if (scope.storeIds.length === 0) {
        if (token !== loadToken.current) return;
        setOrders([]);
        setPrevOrders([]);
        setOrderItems([]);
        setProducts([]);
        setAllOrdersCount(0);
        setProductsCount(0);
        setLowStockCount(0);
        setOutOfStockCount(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      setPendingLoads((n) => n + 1);
      const { from, to, days } = resolveRange(datePreset, customRange);

      // Fair prior-period window:
      // - "today": same elapsed window yesterday (e.g., 00:00→now today vs 00:00→now yesterday)
      // - Other presets: equal-length window immediately prior
      let prevFrom: Date | null = null;
      let prevTo: Date | null = null;
      if (from && days) {
        if (datePreset === "today") {
          const elapsedMs = Date.now() - from.getTime();
          prevFrom = subDays(from, 1);
          prevTo = new Date(prevFrom.getTime() + elapsedMs);
        } else {
          prevFrom = subDays(from, days);
          prevTo = from;
        }
      }

      let curQ = supabase
        .from("orders")
        .select(BASE_SEL)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (from) curQ = curQ.gte("created_at", from.toISOString());
      if (to && (datePreset === "custom" || datePreset === "today" || datePreset === "yesterday"))
        curQ = curQ.lte("created_at", to.toISOString());
      if (source) curQ = curQ.eq("source", source);
      curQ = scopeStoreIds(curQ, scope.storeIds);

      let prevQ = supabase.from("orders").select(BASE_SEL).is("deleted_at", null);
      if (prevFrom && prevTo) {
        prevQ = prevQ.gte("created_at", prevFrom.toISOString()).lt("created_at", prevTo.toISOString());
      } else {
        prevQ = prevQ.eq("id", "00000000-0000-0000-0000-000000000000");
      }
      if (source) prevQ = prevQ.eq("source", source);
      prevQ = scopeStoreIds(prevQ, scope.storeIds);

      let allCountQ = supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null);
      if (source) allCountQ = allCountQ.eq("source", source);
      allCountQ = scopeStoreIds(allCountQ, scope.storeIds);

      // Accurate product totals (head-only counts so the 1000-row default never truncates)
      const productsCountQ = scopeStoreIds(
        supabase.from("products").select("id", { count: "exact", head: true }),
        scope.storeIds,
      );

      const [curRes, prevRes, productsRes, allCountRes, productsCountRes] = await Promise.all([
        curQ,
        prevQ,
        scopeStoreIds(
          supabase
            .from("products")
            .select("id, name, sku, stock_quantity, stock_status, manage_stock, price, cost_price"),
          scope.storeIds,
        ),
        allCountQ,
        productsCountQ,
      ]);

      const curOrders = ((curRes.data || []) as unknown) as OrderRow[];
      const prevOrdersData = ((prevRes.data || []) as unknown) as OrderRow[];
      const allProducts = (productsRes.data || []) as ProductLite[];

      let items: OrderItemLite[] = [];
      if (curOrders.length > 0) {
        const ids = curOrders.map((o) => o.id);
        // order_items has no store_id in the legacy schema; it is already
        // bounded by the tenant-scoped order ids above.
        const { data: itemsData } = await supabase
          .from("order_items")
          .select("product_id, product_name, quantity, line_total, unit_price, order_id")
          .in("order_id", ids);
        items = (itemsData || []) as OrderItemLite[];
      }

      // Accurate stock counts via head queries (avoid 1000-row truncation).
      // Stock visibility depends on the business's products only. The tenant
      // predicate goes immediately after the filter builder exists, before the
      // remaining `eq` predicate, so no `_and` forwarding is needed.
      const [lowRes, oosRes] = await Promise.all([
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .gt("stock_quantity", 0)
          .lte("stock_quantity", 10)
          .in("store_id", scope.storeIds)
          .eq("manage_stock", true),
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .or("stock_status.eq.outofstock,and(manage_stock.eq.true,stock_quantity.lte.0)")
          .in("store_id", scope.storeIds),
      ]);
      // A superseded sweep STILL stops running here, so it must not return before
      // the single release below: the count it took is a count it owes back.
      // Otherwise a switch leaves `pendingLoads` stuck above zero forever and a
      // caller waiting for a settled scope waits indefinitely.
      const superseded = token !== loadToken.current;
      if (!superseded) {
        setOrders(curOrders);
        setPrevOrders(prevOrdersData);
        setOrderItems(items);
        setProducts(allProducts);
        setAllOrdersCount(allCountRes.count || 0);
        setProductsCount(productsCountRes.count || 0);
        setLowStockCount(globalStockEnabled ? lowRes.count || 0 : 0);
        setOutOfStockCount(globalStockEnabled ? oosRes.count || 0 : 0);
        setLoading(false);
      }
      // The one and only release for the one and only count taken above, reached
      // by every path that took it (commit or superseded).
      setPendingLoads((n) => (n > 0 ? n - 1 : n));
    };
    load();
  }, [datePreset, customRange, globalStockEnabled, storeId, businessStoreIds]);
  const productCostMap = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => {
      if (p.id) m.set(p.id, Number(p.cost_price) || 0);
    });
    return m;
  }, [products]);

  const cur = useMemo(() => calcStats(orders), [orders]);
  const prev = useMemo(() => calcStats(prevOrders), [prevOrders]);

  const profit = useMemo(() => {
    // Only revenue-counting orders contribute to COGS
    const revenueOrderIds = new Set(orders.filter(isRevenueOrder).map((o) => o.id));
    let cogs = 0;
    orderItems.forEach((it) => {
      if (!revenueOrderIds.has(it.order_id)) return;
      let unitCost = it.product_id ? productCostMap.get(it.product_id) ?? null : null;
      // Fallback for custom / POS items without a product_id:
      // assume 60% of unit price as cost so margin isn't fabricated as 100%.
      if (unitCost == null) {
        const unitPrice =
          Number(it.unit_price) ||
          (it.quantity > 0 ? Number(it.line_total) / it.quantity : 0);
        unitCost = unitPrice * 0.6;
      }
      cogs += unitCost * it.quantity;
    });
    // Gross profit = revenue − COGS. Customer-paid shipping is NOT a cost.
    const gross = cur.revenue - cogs;
    return {
      cogs,
      gross,
      margin: cur.revenue > 0 ? (gross / cur.revenue) * 100 : 0,
    };
  }, [orders, orderItems, productCostMap, cur]);

  const statusCounts = useMemo(() => {
    const c = {
      pending: 0,
      processing: 0,
      "on-hold": 0,
      shipped: 0,
      delivered: 0,
      completed: 0,
      cancelled: 0,
      failed: 0,
      refunded: 0,
      returned: 0,
    };
    orders.forEach((o) => {
      const k = (o.status || "").toLowerCase();
      if (k in c) (c as Record<string, number>)[k] += 1;
    });
    return c;
  }, [orders]);

  const unpaidOrdersCount = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.payment_status === "unpaid" &&
          !NON_REVENUE_STATUSES.has((o.status || "").toLowerCase()),
      ).length,
    [orders],
  );

  const uniqueCustomers = useMemo(() => uniqueCustomersOf(orders), [orders]);
  const prevUniqueCustomers = useMemo(() => uniqueCustomersOf(prevOrders), [prevOrders]);

  const topProducts = useMemo(() => {
    const revenueOrderIds = new Set(orders.filter(isRevenueOrder).map((o) => o.id));
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    orderItems.forEach((it) => {
      if (!revenueOrderIds.has(it.order_id)) return;
      const key = it.product_id || `name:${it.product_name}`;
      const existing = map.get(key);
      if (existing) {
        existing.qty += it.quantity;
        existing.revenue += Number(it.line_total);
      } else {
        map.set(key, { name: it.product_name, qty: it.quantity, revenue: Number(it.line_total) });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [orders, orderItems]);

  const sourceMix = useMemo(() => {
    const groups: Record<string, number> = {};
    orders.filter(isRevenueOrder).forEach((o) => {
      const k = o.source || "online";
      groups[k] = (groups[k] || 0) + Number(o.total);
    });
    const palette: Record<string, string> = {
      pos: "hsl(142,71%,45%)",
      online: "hsl(217,91%,60%)",
      manual: "hsl(38,92%,50%)",
    };
    return Object.entries(groups).map(([name, value]) => ({
      name: name.toUpperCase(),
      value,
      color: palette[name] || "hsl(291,64%,42%)",
    }));
  }, [orders]);

  const paymentMix = useMemo(() => {
    const groups: Record<string, number> = {};
    orders.filter(isRevenueOrder).forEach((o) => {
      const k = o.payment_method || "unspecified";
      groups[k] = (groups[k] || 0) + Number(o.total);
    });
    const palette: Record<string, string> = {
      cash: "hsl(142,71%,45%)",
      bkash: "hsl(330,81%,60%)",
      card: "hsl(217,91%,60%)",
      bank: "hsl(199,89%,48%)",
      cod: "hsl(38,92%,50%)",
    };
    return Object.entries(groups).map(([name, value]) => ({
      name: name.toUpperCase(),
      value,
      color: palette[name.toLowerCase()] || "hsl(220,8%,52%)",
    }));
  }, [orders]);

  const trendData = useMemo(() => {
    // Group by ISO date so sorting works across month boundaries / gap days.
    const grouped = orders.filter(isRevenueOrder).reduce<
      Record<string, { revenue: number; orders: number }>
    >((acc, o) => {
      const d = new Date(o.created_at);
      const iso = format(d, "yyyy-MM-dd");
      if (!acc[iso]) acc[iso] = { revenue: 0, orders: 0 };
      acc[iso].revenue += Number(o.total);
      acc[iso].orders += 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([iso, v]) => ({ date: format(new Date(iso), "MMM d"), ...v }));
  }, [orders]);

  const lowStockProducts = useMemo(() => {
    return products
      .filter((p) => {
        const stock = getEffectiveStock(p, globalStockEnabled);
        return stock.tracked && stock.quantity > 0 && stock.quantity <= 10;
      })
      .sort(
        (a, b) =>
          getEffectiveStock(a, globalStockEnabled).quantity -
          getEffectiveStock(b, globalStockEnabled).quantity,
      )
      .slice(0, 12);
  }, [products, globalStockEnabled]);

  return {
    loading,
    /**
     * Number of scope sweeps still in flight. Zero means every query for the
     * current scope has settled, so `orders`/`products` are final for that scope.
     */
    pendingLoads,
    orders,
    products,
    productsCount,
    allOrdersCount,
    cur,
    prev,
    profit,
    statusCounts,
    unpaidOrdersCount,
    uniqueCustomers,
    prevUniqueCustomers,
    topProducts,
    sourceMix,
    paymentMix,
    trendData,
    lowStockProducts,
    lowStockCount,
    outOfStockCount,
    globalStockEnabled,
  };
};
