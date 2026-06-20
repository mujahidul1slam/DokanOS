import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { DateRange } from "react-day-picker";
import { type DatePreset, resolveRange } from "@/components/DatePresetPicker";
import { getEffectiveStock, useGlobalStockEnabled } from "@/lib/stockSettings";

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

const calcStats = (rows: OrderRow[]) => {
  const revenue = rows.reduce((s, o) => s + Number(o.total), 0);
  const subtotal = rows.reduce((s, o) => s + Number(o.subtotal || 0), 0);
  const discount = rows.reduce((s, o) => s + Number(o.discount || 0), 0);
  const shipping = rows.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);
  return {
    revenue,
    subtotal,
    discount,
    shipping,
    orderCount: rows.length,
    aov: rows.length > 0 ? revenue / rows.length : 0,
  };
};

const uniqueCustomersOf = (rows: OrderRow[]) => {
  const set = new Set<string>();
  rows.forEach((o) => {
    if (o.customer_id) set.add(o.customer_id);
    else if (o.customer_name) set.add(`name:${o.customer_name}`);
  });
  return set.size;
};

export const useDashboardData = (
  datePreset: DatePreset,
  customRange: DateRange | undefined,
  storeId: string = "all",
) => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [prevOrders, setPrevOrders] = useState<OrderRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemLite[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [allOrdersCount, setAllOrdersCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const globalStockEnabled = useGlobalStockEnabled();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { from, to, days } = resolveRange(datePreset, customRange);
      const prevFrom = from && days ? subDays(from, days) : null;

      let curQ = supabase
        .from("orders")
        .select(BASE_SEL)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (from) curQ = curQ.gte("created_at", from.toISOString());
      if (to && datePreset === "custom") curQ = curQ.lte("created_at", to.toISOString());
      if (storeId !== "all") curQ = curQ.eq("store_id", storeId);

      let prevQ = supabase.from("orders").select(BASE_SEL).is("deleted_at", null);
      if (prevFrom && from) {
        prevQ = prevQ.gte("created_at", prevFrom.toISOString()).lt("created_at", from.toISOString());
      } else {
        prevQ = prevQ.eq("id", "00000000-0000-0000-0000-000000000000");
      }
      if (storeId !== "all") prevQ = prevQ.eq("store_id", storeId);

      let allCountQ = supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null);
      if (storeId !== "all") allCountQ = allCountQ.eq("store_id", storeId);

      const [curRes, prevRes, productsRes, allCountRes] = await Promise.all([
        curQ,
        prevQ,
        supabase
          .from("products")
          .select("id, name, sku, stock_quantity, stock_status, manage_stock, price, cost_price"),
        allCountQ,
      ]);

      const curOrders = ((curRes.data || []) as unknown) as OrderRow[];
      const prevOrdersData = ((prevRes.data || []) as unknown) as OrderRow[];
      const allProducts = (productsRes.data || []) as ProductLite[];

      let items: OrderItemLite[] = [];
      if (curOrders.length > 0) {
        const ids = curOrders.map((o) => o.id);
        const { data: itemsData } = await supabase
          .from("order_items")
          .select("product_id, product_name, quantity, line_total, order_id")
          .in("order_id", ids);
        items = (itemsData || []) as OrderItemLite[];
      }

      setOrders(curOrders);
      setPrevOrders(prevOrdersData);
      setOrderItems(items);
      setProducts(allProducts);
      setAllOrdersCount(allCountRes.count || 0);
      setLoading(false);
    };
    load();
  }, [datePreset, customRange, globalStockEnabled]);

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
    let cogs = 0;
    orderItems.forEach((it) => {
      const cost = it.product_id ? productCostMap.get(it.product_id) || 0 : 0;
      cogs += cost * it.quantity;
    });
    return {
      cogs,
      gross: cur.revenue - cogs - cur.shipping,
      margin: cur.revenue > 0 ? ((cur.revenue - cogs - cur.shipping) / cur.revenue) * 100 : 0,
    };
  }, [orderItems, productCostMap, cur]);

  const statusCounts = useMemo(() => {
    const c = { pending: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0, failed: 0 };
    orders.forEach((o) => {
      if (o.status in c) (c as Record<string, number>)[o.status] += 1;
    });
    return c;
  }, [orders]);

  const unpaidOrdersCount = useMemo(
    () => orders.filter((o) => o.payment_status === "unpaid" && o.status !== "cancelled").length,
    [orders],
  );

  const uniqueCustomers = useMemo(() => uniqueCustomersOf(orders), [orders]);
  const prevUniqueCustomers = useMemo(() => uniqueCustomersOf(prevOrders), [prevOrders]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    orderItems.forEach((it) => {
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
  }, [orderItems]);

  const sourceMix = useMemo(() => {
    const groups: Record<string, number> = {};
    orders.forEach((o) => {
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
    orders.forEach((o) => {
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
    const grouped = orders.reduce<Record<string, { revenue: number; orders: number }>>((acc, o) => {
      const day = format(new Date(o.created_at), "MMM d");
      if (!acc[day]) acc[day] = { revenue: 0, orders: 0 };
      acc[day].revenue += Number(o.total);
      acc[day].orders += 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .reverse()
      .map(([date, v]) => ({ date, ...v }));
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

  const lowStockCount = useMemo(
    () =>
      products.filter((p) => {
        const stock = getEffectiveStock(p, globalStockEnabled);
        return stock.tracked && stock.quantity > 0 && stock.quantity <= 10;
      }).length,
    [products, globalStockEnabled],
  );

  const outOfStockCount = useMemo(
    () => products.filter((p) => getEffectiveStock(p, globalStockEnabled).outOfStock).length,
    [products, globalStockEnabled],
  );

  return {
    loading,
    orders,
    products,
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
