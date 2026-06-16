import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  Wallet, Clock, RotateCcw, Coins, Package, Truck, AlertTriangle,
  Banknote, CreditCard,
} from "lucide-react";
import StatCardDelta from "@/components/dashboard/StatCardDelta";

const COLORS = ["hsl(217,91%,60%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)", "hsl(291,64%,42%)", "hsl(0,84%,60%)", "hsl(180,60%,45%)"];
const METHOD_ICON: Record<string, any> = {
  cash: Banknote, bkash: Wallet, nagad: Wallet, rocket: Wallet,
  card: CreditCard, bank: Banknote, cod: Truck, other: Coins,
};

interface CashStats {
  collectedTotal: number;
  onPriorOrders: number;
  refundsTotal: number;
  netCash: number;
  shippingCollected: number;
  productCollected: number;
  unallocated: number;
  byMethodProduct: Record<string, number>;
  byMethodShipping: Record<string, number>;
}

interface Props {
  cashStats: CashStats;
  paymentsCount: number;
  cashByMethod: { name: string; key: string; value: number }[];
}

const CashSection = ({ cashStats, paymentsCount, cashByMethod }: Props) => (
  <section className="space-y-3">
    <div>
      <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
        <Wallet className="h-5 w-5 text-primary" /> Cash Collected
      </h2>
      <p className="text-xs text-muted-foreground">By payment date · every actual payment received in the period (any order)</p>
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCardDelta icon={Wallet} title="Total Collected" value={`৳${cashStats.collectedTotal.toLocaleString()}`} subtitle={`${paymentsCount} payment${paymentsCount === 1 ? "" : "s"}`} />
      <StatCardDelta icon={Clock} title="On Prior Orders" value={`৳${cashStats.onPriorOrders.toLocaleString()}`} subtitle="Dues paid for orders from before this period" />
      <StatCardDelta icon={RotateCcw} title="Refunds Paid Out" value={`-৳${cashStats.refundsTotal.toLocaleString()}`} subtitle="Returned to customers" />
      <StatCardDelta icon={Coins} title="Net Cash In" value={`৳${cashStats.netCash.toLocaleString()}`} subtitle="Collections − Refunds" />
    </div>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCardDelta icon={Package} title="Product Revenue Collected" value={`৳${cashStats.productCollected.toLocaleString()}`} subtitle="Allocated share of collections" />
      <StatCardDelta icon={Truck} title="Shipping Collected" value={`৳${cashStats.shippingCollected.toLocaleString()}`} subtitle="Delivery fees received (incl. COD remittance)" />
      <StatCardDelta icon={AlertTriangle} title="Unallocated" value={`৳${cashStats.unallocated.toLocaleString()}`} subtitle="Payments on orders outside the 12-mo window" />
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="font-heading text-sm font-medium text-card-foreground mb-3">Method Mix</h3>
        <div className="h-48">
          {cashByMethod.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No payments</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={cashByMethod} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {cashByMethod.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={(v: number) => `৳${v.toLocaleString()}`} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
        <h3 className="font-heading text-sm font-medium text-card-foreground mb-3">By Method</h3>
        {cashByMethod.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No payments collected</p>
        ) : (
          <div className="space-y-2">
            {cashByMethod.map((p, i) => {
              const Icon = METHOD_ICON[p.key] || Coins;
              const total = cashStats.collectedTotal || 1;
              const pct = (p.value / total) * 100;
              const prod = cashStats.byMethodProduct[p.key] || 0;
              const ship = cashStats.byMethodShipping[p.key] || 0;
              return (
                <div key={p.key} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] + "22" }}>
                    <Icon className="h-4 w-4" style={{ color: COLORS[i % COLORS.length] }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-foreground">{p.name}</span>
                      <span className="tabular-nums font-semibold">৳{p.value.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                      Product ৳{Math.round(prod).toLocaleString()} · Shipping ৳{Math.round(ship).toLocaleString()}
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  </section>
);

export default CashSection;
