import { useEffect, useState, useMemo } from "react";
import {
  ShoppingCart,
  DollarSign,
  Package,
  Truck,
  Download,
  AlertTriangle,
  TrendingUp,
  Users,
  Receipt,
  PercentCircle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import StatusBadge from "@/components/StatusBadge";
import StatCardDelta from "@/components/dashboard/StatCardDelta";
import ActionQueue from "@/components/dashboard/ActionQueue";
import FulfillmentFunnel from "@/components/dashboard/FulfillmentFunnel";
import OrderPipeline from "@/components/dashboard/OrderPipeline";
import TopProducts from "@/components/dashboard/TopProducts";
import SourceMix from "@/components/dashboard/SourceMix";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatsSkeleton, TableSkeleton } from "@/components/ui/loading-states";
import { format, subDays } from "date-fns";
import DatePresetPicker, { DatePreset, presetLabel, resolveRange } from "@/components/DatePresetPicker";
import type { DateRange } from "react-day-picker";
import { getEffectiveStock, useGlobalStockEnabled } from "@/lib/stockSettings";

interface OrderRow {
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
}

interface OrderItemLite {
  product_id: string | null;
  product_name: string;
  quantity: number;
  line_total: number;
  order_id: string;
}

interface ProductLite {
  id: string;
  name: string;
  sku: string | null;
  stock_quantity: number;
  price: number;
  cost_price: number | null;
  manage_stock?: boolean | null;
  stock_status?: string | null;
}


const Dashboard = () => {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [prevOrders, setPrevOrders] = useState<OrderRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemLite[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [allOrdersCount, setAllOrdersCount] = useState(0);
  const [lowStockProducts, setLowStockProducts] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const globalStockEnabled = useGlobalStockEnabled();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { from, to, days } = resolveRange(datePreset, customRange);
      const prevFrom = from && days ? subDays(from, days) : null;

      const baseSel =
        "id, order_number, total, subtotal, discount, shipping_cost, status, source, payment_status, payment_method, created_at, customer_name, customer_id, consignment_id";

      let curQ = supabase
        .from("orders")
        .select(baseSel)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (from) curQ = curQ.gte("created_at", from.toISOString());
      if (to && datePreset === "custom") curQ = curQ.lte("created_at", to.toISOString());

      let prevQ = supabase
        .from("orders")
        .select(baseSel)
        .is("deleted_at", null);
      if (prevFrom && from) {
        prevQ = prevQ.gte("created_at", prevFrom.toISOString()).lt("created_at", from.toISOString());
      } else {
        // No previous period for "all"
        prevQ = prevQ.eq("id", "00000000-0000-0000-0000-000000000000");
      }

      const [curRes, prevRes, productsRes, allCountRes] = await Promise.all([
        curQ,
        prevQ,
        supabase.from("products").select("id, name, sku, stock_quantity, stock_status, manage_stock, price, cost_price"),
        supabase.from("orders").select("id", { count: "exact", head: true }).is("deleted_at", null),
      ]);

      const curOrders = ((curRes.data || []) as unknown) as OrderRow[];
      const prevOrdersData = ((prevRes.data || []) as unknown) as OrderRow[];
      const allProducts = (productsRes.data || []) as ProductLite[];

      // Fetch line items for current orders (for top-products)
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

      const lowStockList = allProducts
        .filter((p) => {
          const stock = getEffectiveStock(p, globalStockEnabled);
          return stock.tracked && stock.quantity > 0 && stock.quantity <= 10;
        })
        .sort((a, b) => getEffectiveStock(a, globalStockEnabled).quantity - getEffectiveStock(b, globalStockEnabled).quantity)
        .slice(0, 12);
      setLowStockProducts(lowStockList);

      setLoading(false);
    };
    load();
  }, [datePreset, customRange, globalStockEnabled]);

  // ============ Aggregations ============
  const productCostMap = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p) => {
      if (p.id) m.set(p.id, Number(p.cost_price) || 0);
    });
    return m;
  }, [products]);

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

  const cur = useMemo(() => calcStats(orders), [orders]);
  const prev = useMemo(() => calcStats(prevOrders), [prevOrders]);

  // Profit estimation from current order items
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
      if (o.status in c) (c as any)[o.status] += 1;
    });
    return c;
  }, [orders]);

  const unpaidOrdersCount = useMemo(
    () => orders.filter((o) => o.payment_status === "unpaid" && o.status !== "cancelled").length,
    [orders],
  );

  const uniqueCustomers = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      if (o.customer_id) set.add(o.customer_id);
      else if (o.customer_name) set.add(`name:${o.customer_name}`);
    });
    return set.size;
  }, [orders]);

  const prevUniqueCustomers = useMemo(() => {
    const set = new Set<string>();
    prevOrders.forEach((o) => {
      if (o.customer_id) set.add(o.customer_id);
      else if (o.customer_name) set.add(`name:${o.customer_name}`);
    });
    return set.size;
  }, [prevOrders]);

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

  const handleExportCSV = () => {
    const headers = "Order Number,Customer,Total,Status,Payment,Source,Date\n";
    const csv = orders
      .map(
        (o) =>
          `${o.order_number},"${o.customer_name || ""}",${o.total},${o.status},${o.payment_status},${o.source},${new Date(o.created_at).toLocaleDateString()}`,
      )
      .join("\n");
    const blob = new Blob([headers + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-${datePreset}.csv`;
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

  const lowStockCount = products.filter((p) => {
    const stock = getEffectiveStock(p, globalStockEnabled);
    return stock.tracked && stock.quantity > 0 && stock.quantity <= 10;
  }).length;
  const outOfStockCount = products.filter((p) => getEffectiveStock(p, globalStockEnabled).outOfStock).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {presetLabel[datePreset]}
            {datePreset !== "all" && " · vs prior period"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DatePresetPicker
            preset={datePreset}
            customRange={customRange}
            onPresetChange={setDatePreset}
            onCustomRangeChange={setCustomRange}
          />
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1.5">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardDelta
          icon={DollarSign}
          title="Revenue"
          value={`৳${cur.revenue.toLocaleString()}`}
          prevValue={prev.revenue}
          currentValue={cur.revenue}
          subtitle="vs prior"
        />
        <StatCardDelta
          icon={ShoppingCart}
          title="Orders"
          value={String(cur.orderCount)}
          prevValue={prev.orderCount}
          currentValue={cur.orderCount}
          subtitle={`${allOrdersCount} all time`}
        />
        <StatCardDelta
          icon={Receipt}
          title="Avg Order Value"
          value={`৳${cur.aov.toFixed(0)}`}
          prevValue={prev.aov}
          currentValue={cur.aov}
          subtitle="vs prior"
        />
        <StatCardDelta
          icon={Users}
          title="Unique Customers"
          value={String(uniqueCustomers)}
          prevValue={prevUniqueCustomers}
          currentValue={uniqueCustomers}
          subtitle="vs prior"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardDelta
          icon={TrendingUp}
          title="Gross Profit"
          value={`৳${profit.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          subtitle={`${profit.margin.toFixed(1)}% margin`}
        />
        <StatCardDelta
          icon={PercentCircle}
          title="Discounts Given"
          value={`৳${cur.discount.toLocaleString()}`}
          prevValue={prev.discount}
          currentValue={cur.discount}
          subtitle="vs prior"
          invertDelta
        />
        <StatCardDelta
          icon={Truck}
          title="Shipping Collected"
          value={`৳${cur.shipping.toLocaleString()}`}
          prevValue={prev.shipping}
          currentValue={cur.shipping}
          subtitle="vs prior"
        />
        <StatCardDelta
          icon={Package}
          title="Products"
          value={String(products.length)}
          subtitle={
            lowStockCount > 0 || outOfStockCount > 0
              ? `${outOfStockCount} out · ${lowStockCount} low`
              : "All stocked"
          }
        />
      </div>

      {/* Action Queue */}
      <ActionQueue
        pendingOrders={statusCounts.pending}
        processingOrders={statusCounts.processing}
        shippedOrders={statusCounts.shipped}
        unpaidOrders={unpaidOrdersCount}
        failedDispatch={statusCounts.failed}
      />

      {/* Trend chart + Recent orders */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="col-span-1 lg:col-span-3 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground">Revenue & Orders Trend</h2>
          <div className="mt-4 h-64">
            {trendData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No data for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(217,91%,60%)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(217,91%,60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(225,12%,16%)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fill: "hsl(220,8%,52%)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(225,14%,10%)",
                      border: "1px solid hsl(225,12%,16%)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "hsl(220,10%,92%)" }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(217,91%,60%)"
                    fill="url(#rev)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="col-span-1 lg:col-span-2 rounded-lg border border-border bg-card p-5">
          <h2 className="font-heading text-sm font-medium text-card-foreground">Recent Orders</h2>
          <div className="mt-4 space-y-3">
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No orders in this period</p>
            ) : (
              orders.slice(0, 7).map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-card-foreground">{order.order_number}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {order.customer_name || "Walk-in"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-card-foreground">
                      ৳{Number(order.total).toLocaleString()}
                    </span>
                    <StatusBadge status={order.status} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Funnel + Top products */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FulfillmentFunnel
          pending={statusCounts.pending}
          processing={statusCounts.processing}
          shipped={statusCounts.shipped}
          delivered={statusCounts.delivered}
          cancelled={statusCounts.cancelled}
        />
        <TopProducts items={topProducts} />
      </div>

      {/* Source + Payment mix */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SourceMix
          title="Revenue by Source"
          items={sourceMix}
          formatValue={(v) => `৳${v.toLocaleString()}`}
        />
        <SourceMix
          title="Revenue by Payment Method"
          items={paymentMix}
          formatValue={(v) => `৳${v.toLocaleString()}`}
        />
      </div>

      {/* Low Stock */}
      {lowStockProducts.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h2 className="font-heading text-sm font-medium text-foreground">
              Low Stock Alert ({lowStockCount} products)
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {lowStockProducts.map((p) => (
              (() => {
                const stock = getEffectiveStock(p, globalStockEnabled);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.sku || "No SKU"}</p>
                    </div>
                    <span className={`text-sm font-semibold ${stock.quantity <= 3 ? "text-destructive" : "text-amber-400"}`}>
                      {stock.quantity} left
                    </span>
                  </div>
                );
              })()
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
