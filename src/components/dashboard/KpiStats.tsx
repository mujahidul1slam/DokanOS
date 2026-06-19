import {
  DollarSign,
  ShoppingCart,
  Receipt,
  Users,
  TrendingUp,
  PercentCircle,
  Truck,
  Package,
} from "lucide-react";
import StatCardDelta from "@/components/dashboard/StatCardDelta";

interface KpiStatsProps {
  cur: { revenue: number; orderCount: number; aov: number; discount: number; shipping: number };
  prev: { revenue: number; orderCount: number; aov: number; discount: number; shipping: number };
  profit: { gross: number; margin: number };
  allOrdersCount: number;
  uniqueCustomers: number;
  prevUniqueCustomers: number;
  productsCount: number;
  lowStockCount: number;
  outOfStockCount: number;
}

const KpiStats = ({
  cur,
  prev,
  profit,
  allOrdersCount,
  uniqueCustomers,
  prevUniqueCustomers,
  productsCount,
  lowStockCount,
  outOfStockCount,
}: KpiStatsProps) => (
  <>
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
        value={String(productsCount)}
        subtitle={
          lowStockCount > 0 || outOfStockCount > 0
            ? `${outOfStockCount} out · ${lowStockCount} low`
            : "All stocked"
        }
      />
    </div>
  </>
);

export default KpiStats;
