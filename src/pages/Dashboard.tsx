import { useState } from "react";
import ActionQueue from "@/components/dashboard/ActionQueue";
import FulfillmentFunnel from "@/components/dashboard/FulfillmentFunnel";
import OrderPipeline from "@/components/dashboard/OrderPipeline";
import StoreHealthGrid from "@/components/dashboard/StoreHealthGrid";
import CourierDispatchStation from "@/components/dashboard/CourierDispatchStation";
import TopProducts from "@/components/dashboard/TopProducts";
import SourceMix from "@/components/dashboard/SourceMix";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import KpiStats from "@/components/dashboard/KpiStats";
import RevenueTrendChart from "@/components/dashboard/RevenueTrendChart";
import RecentOrdersList from "@/components/dashboard/RecentOrdersList";
import LowStockAlert from "@/components/dashboard/LowStockAlert";
import { StatsSkeleton, TableSkeleton } from "@/components/ui/loading-states";
import { type DatePreset } from "@/components/DatePresetPicker";
import type { DateRange } from "react-day-picker";
import { useDashboardData } from "@/hooks/useDashboardData";
import { exportOrdersToCSV } from "@/lib/exportOrdersCSV";

const Dashboard = () => {
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const data = useDashboardData(datePreset, customRange);

  if (data.loading) {
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

  return (
    <div className="space-y-6">
      <DashboardHeader
        datePreset={datePreset}
        customRange={customRange}
        onPresetChange={setDatePreset}
        onCustomRangeChange={setCustomRange}
        onExport={() => exportOrdersToCSV(data.orders, datePreset)}
      />

      <KpiStats
        cur={data.cur}
        prev={data.prev}
        profit={data.profit}
        allOrdersCount={data.allOrdersCount}
        uniqueCustomers={data.uniqueCustomers}
        prevUniqueCustomers={data.prevUniqueCustomers}
        productsCount={data.products.length}
        lowStockCount={data.lowStockCount}
        outOfStockCount={data.outOfStockCount}
      />

      <ActionQueue
        pendingOrders={data.statusCounts.pending}
        processingOrders={data.statusCounts.processing}
        shippedOrders={data.statusCounts.shipped}
        unpaidOrders={data.unpaidOrdersCount}
        failedDispatch={data.statusCounts.failed}
      />

      <OrderPipeline orders={data.orders} />
      <CourierDispatchStation orders={data.orders} />
      <StoreHealthGrid orders={data.orders} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <RevenueTrendChart data={data.trendData} />
        <RecentOrdersList orders={data.orders} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FulfillmentFunnel
          pending={data.statusCounts.pending}
          processing={data.statusCounts.processing}
          shipped={data.statusCounts.shipped}
          delivered={data.statusCounts.delivered}
          cancelled={data.statusCounts.cancelled}
        />
        <TopProducts items={data.topProducts} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SourceMix
          title="Revenue by Source"
          items={data.sourceMix}
          formatValue={(v) => `৳${v.toLocaleString()}`}
        />
        <SourceMix
          title="Revenue by Payment Method"
          items={data.paymentMix}
          formatValue={(v) => `৳${v.toLocaleString()}`}
        />
      </div>

      <LowStockAlert
        products={data.lowStockProducts}
        lowStockCount={data.lowStockCount}
        globalStockEnabled={data.globalStockEnabled}
      />
    </div>
  );
};

export default Dashboard;
