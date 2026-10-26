import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Store as StoreIcon } from "lucide-react";
import ActionQueue from "@/components/dashboard/ActionQueue";
import FulfillmentFunnel from "@/components/dashboard/FulfillmentFunnel";
import OrderPipeline from "@/components/dashboard/OrderPipeline";
import StoreHealthGrid from "@/components/dashboard/StoreHealthGrid";
import SyncHealthCard from "@/components/dashboard/SyncHealthCard";
import CourierDispatchStation from "@/components/dashboard/CourierDispatchStation";
import TopProducts from "@/components/dashboard/TopProducts";
import SourceMix from "@/components/dashboard/SourceMix";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import KpiStats from "@/components/dashboard/KpiStats";
import RevenueTrendChart from "@/components/dashboard/RevenueTrendChart";
import RecentOrdersList from "@/components/dashboard/RecentOrdersList";
import LowStockAlert from "@/components/dashboard/LowStockAlert";
import { EmptyState, StatsSkeleton, TableSkeleton } from "@/components/ui/loading-states";
import { Button } from "@/components/ui/button";
import { type DatePreset } from "@/components/DatePresetPicker";
import type { DateRange } from "react-day-picker";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useStoresListState } from "@/hooks/useStoresList";
import { hasStoreScope, useActiveBusinessStoreIds } from "@/hooks/useActiveBusinessStoreIds";
import { exportOrdersToCSV } from "@/lib/exportOrdersCSV";
import { useCurrency } from "@/hooks/useCurrency";

const Dashboard = () => {
  const { symbol } = useCurrency();
  const navigate = useNavigate();
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [storeId, setStoreId] = useState<string>("all");
  const { stores, settled: storeScopeSettled } = useStoresListState();
  // Tenant scope: every KPI query below is bounded by the ACTIVE business's
  // stores (issue #16), so "All stores" means all stores of this business only.
  const businessStoreIds = useActiveBusinessStoreIds();
  const data = useDashboardData(datePreset, customRange, storeId, businessStoreIds);
  /**
   * Fail closed (issue #16): with no mapped stores the KPI hook issues no query
   * at all, so rendering the shell would present a dashboard of zeroes — "this
   * business is quiet" — for a business that can read nothing. Say so instead.
   * The gate waits for the scope to SETTLE first: an empty store list that is
   * merely still being read (no active business resolved yet, or its brands not
   * loaded) must never be reported as "this business has no stores".
   */
  const hasScope = hasStoreScope(businessStoreIds);

  if (data.loading || (!hasScope && !storeScopeSettled)) {
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

  if (!hasScope) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
        </div>
        <EmptyState
          icon={StoreIcon}
          title="No stores in this business"
          description="This business has no stores mapped yet, so there is no operational data to show. Add a store to this business to see its orders, revenue and store health here."
          action={
            <Button variant="outline" onClick={() => navigate("/stores")}>
              <StoreIcon className="mr-1 h-4 w-4" /> Add a store
            </Button>
          }
        />
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
        stores={stores}
        storeId={storeId}
        onStoreChange={setStoreId}
      />

      <KpiStats
        cur={data.cur}
        prev={data.prev}
        profit={data.profit}
        allOrdersCount={data.allOrdersCount}
        uniqueCustomers={data.uniqueCustomers}
        prevUniqueCustomers={data.prevUniqueCustomers}
        productsCount={data.productsCount}
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
      <SyncHealthCard />

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
          formatValue={(v) => `${symbol}${v.toLocaleString()}`}
        />
        <SourceMix
          title="Revenue by Payment Method"
          items={data.paymentMix}
          formatValue={(v) => `${symbol}${v.toLocaleString()}`}
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
