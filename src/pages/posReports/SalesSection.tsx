import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  DollarSign, Truck, RotateCcw, TrendingUp, TrendingDown, Receipt, Package, Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import StatCardDelta from "@/components/dashboard/StatCardDelta";

interface SalesStats {
  gross: number;
  discounts: number;
  returnsTotal: number;
  net: number;
  orderCount: number;
  prevNet: number;
  shipping: number;
  tax: number;
  totalInvoiced: number;
}

interface Props {
  salesStats: SalesStats;
  trendData: { date: string; sales: number; orders: number }[];
  topProducts: { name: string; revenue: number; qty: number }[];
  salesByStore: { name: string; sales: number; qty: number; orders: number }[];
}

const SalesSection = ({ salesStats, trendData, topProducts, salesByStore }: Props) => (
  <section className="space-y-3">
    <div className="flex items-baseline justify-between">
      <div>
        <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
          <Receipt className="h-5 w-5 text-primary" /> Sales
        </h2>
        <p className="text-xs text-muted-foreground">Accrual basis · by order date · excludes cancelled orders</p>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCardDelta icon={DollarSign} title="Gross Sales" value={`৳${salesStats.gross.toLocaleString()}`} subtitle={`${salesStats.orderCount} orders · before discounts`} />
      <StatCardDelta icon={TrendingDown} title="Discounts" value={`-৳${salesStats.discounts.toLocaleString()}`} subtitle="Order & line discounts" />
      <StatCardDelta icon={RotateCcw} title="Returns" value={`-৳${salesStats.returnsTotal.toLocaleString()}`} subtitle="Refunded in period (by return date)" />
      <StatCardDelta icon={TrendingUp} title="Net Sales" value={`৳${salesStats.net.toLocaleString()}`} currentValue={salesStats.net} prevValue={salesStats.prevNet} subtitle="Gross − Discounts − Returns (products only)" />
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCardDelta icon={Truck} title="Shipping Charged" value={`৳${salesStats.shipping.toLocaleString()}`} subtitle="Delivery fees billed to customers" />
      <StatCardDelta icon={Receipt} title="Tax" value={`৳${salesStats.tax.toLocaleString()}`} subtitle="Tax applied on orders" />
      <StatCardDelta icon={DollarSign} title="Total Invoiced" value={`৳${salesStats.totalInvoiced.toLocaleString()}`} subtitle="Net Sales + Shipping + Tax (− Returns)" />
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
        <h3 className="font-heading text-sm font-medium text-card-foreground mb-4">Net Sales Trend</h3>
        <div className="h-64">
          {trendData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No sales in this period</div>
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
                <Area type="monotone" dataKey="sales" name="Net Sales" stroke="hsl(142,71%,45%)" fill="url(#posRev)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading text-sm font-medium text-card-foreground flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" /> Top Products
          </h3>
          <span className="text-xs text-muted-foreground">By revenue</span>
        </div>
        {topProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No sales</p>
        ) : (
          <div className="space-y-2.5">
            {topProducts.slice(0, 8).map((p, idx) => {
              const max = topProducts[0].revenue || 1;
              return (
                <div key={p.name + idx}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-card-foreground truncate pr-2">
                      <span className="text-muted-foreground tabular-nums mr-1.5">#{idx + 1}</span>
                      {p.name}
                    </span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">৳{p.revenue.toLocaleString()}</span>
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
    </div>

    {salesByStore.length > 0 && (
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading text-sm font-medium text-card-foreground flex items-center gap-2">
            <Store className="h-4 w-4 text-muted-foreground" /> Sales by Store
          </h3>
          <span className="text-xs text-muted-foreground">{salesByStore.length} stores</span>
        </div>
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
  </section>
);

export default SalesSection;
