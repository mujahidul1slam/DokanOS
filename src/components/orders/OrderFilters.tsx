import { memo } from "react";
import { format } from "date-fns";
import { Search, CalendarIcon, SlidersHorizontal, ChevronDown, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import CategoryFilter from "@/components/CategoryFilter";
import { cn } from "@/lib/utils";

export interface StoreOption {
  id: string;
  name: string;
}

interface CategoryNode {
  id: string;
  name: string;
  parent_id: string | null;
  store_id: string | null;
}

interface OrderFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (v: boolean) => void;
  activeFilterCount: number;
  onClearAll: () => void;

  preOrderMode: boolean;
  dateRange: DateRange | undefined;
  onDateRangeChange: (r: DateRange | undefined) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  preOrderStatusFilter: "all" | "pre_order_pending" | "pre_order_making" | "pre_order_ready";
  onPreOrderStatusFilterChange: (v: "all" | "pre_order_pending" | "pre_order_making" | "pre_order_ready") => void;
  paymentFilter: string;
  onPaymentFilterChange: (v: string) => void;
  sourceFilter: string;
  onSourceFilterChange: (v: string) => void;
  deliveryFilter: string;
  onDeliveryFilterChange: (v: string) => void;
  courierFilter: string;
  onCourierFilterChange: (v: string) => void;
  storeFilter: string;
  onStoreFilterChange: (v: string) => void;
  stores: StoreOption[];
  allCategories: CategoryNode[];
  categoryFilter: Set<string>;
  onCategoryFilterChange: (s: Set<string>) => void;
}

function OrderFiltersImpl(props: OrderFiltersProps) {
  const {
    search, onSearchChange, filtersOpen, onFiltersOpenChange, activeFilterCount, onClearAll,
    preOrderMode, dateRange, onDateRangeChange,
    statusFilter, onStatusFilterChange,
    preOrderStatusFilter, onPreOrderStatusFilterChange,
    paymentFilter, onPaymentFilterChange,
    sourceFilter, onSourceFilterChange,
    deliveryFilter, onDeliveryFilterChange,
    courierFilter, onCourierFilterChange,
    storeFilter, onStoreFilterChange, stores,
    allCategories, categoryFilter, onCategoryFilterChange,
  } = props;

  return (
    <>
      {/* Search bar + filter toggle (always visible) */}
      <div className="flex items-center gap-2 mt-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search order #, name, phone..." className="pl-9" />
        </div>
        <Button
          variant="outline"
          size="default"
          onClick={() => onFiltersOpenChange(!filtersOpen)}
          className="gap-1.5 shrink-0"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>
          )}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", filtersOpen && "rotate-180")} />
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearAll} className="shrink-0 text-muted-foreground hover:text-foreground gap-1">
            <X className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        )}
      </div>

      <Collapsible open={filtersOpen} onOpenChange={onFiltersOpenChange}>
        <CollapsibleContent>
          <div className="flex flex-wrap items-center gap-2 mt-3 p-3 rounded-lg border bg-muted/30">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-2 font-normal", !dateRange?.from && "text-muted-foreground")}>
                  <CalendarIcon className="h-4 w-4" />
                  {dateRange?.from ? (dateRange.to ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}` : format(dateRange.from, "MMM d, yyyy")) : "Date Range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="range" selected={dateRange} onSelect={onDateRangeChange} numberOfMonths={2} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            {!preOrderMode && (
              <Select value={statusFilter} onValueChange={onStatusFilterChange}>
                <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="processing">New Order</SelectItem>
                  <SelectItem value="payment_pending">Payment Pending</SelectItem>
                  <SelectItem value="pre_order_pending">Pre-Order</SelectItem>
                  <SelectItem value="pre_order_making">Making</SelectItem>
                  <SelectItem value="pre_order_ready">Pre-Order Ready</SelectItem>
                  <SelectItem value="ready_to_ship">Ready to Ship</SelectItem>
                  <SelectItem value="shipped">Shipped</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="returned">Returned</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={preOrderStatusFilter} onValueChange={(v) => onPreOrderStatusFilterChange(v as any)}>
              <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Pre-Order Stage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Pre-Order Stages</SelectItem>
                <SelectItem value="pre_order_pending">Pre-Order (New)</SelectItem>
                <SelectItem value="pre_order_making">Making</SelectItem>
                <SelectItem value="pre_order_ready">Pre-Order Ready</SelectItem>
              </SelectContent>
            </Select>
            <Select value={paymentFilter} onValueChange={onPaymentFilterChange}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Payment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payment</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="cod">COD</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={onSourceFilterChange}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="pos">POS</SelectItem>
              </SelectContent>
            </Select>
            <Select value={deliveryFilter} onValueChange={onDeliveryFilterChange}>
              <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Delivery" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Delivery</SelectItem>
                <SelectItem value="walkin">Walk-in</SelectItem>
                <SelectItem value="pickup">Pickup</SelectItem>
                <SelectItem value="delivery">Delivery</SelectItem>
              </SelectContent>
            </Select>
            <Select value={courierFilter} onValueChange={onCourierFilterChange}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Courier Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Courier</SelectItem>
                <SelectItem value="has">Has Courier Entry</SelectItem>
                <SelectItem value="none">No Courier Entry</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Pickup Pending">Pickup Pending</SelectItem>
                <SelectItem value="Assigned for Pickup">Assigned for Pickup</SelectItem>
                <SelectItem value="Picked Up">Picked Up</SelectItem>
                <SelectItem value="Pickup Failed">Pickup Failed</SelectItem>
                <SelectItem value="Pickup Cancel">Pickup Cancel</SelectItem>
                <SelectItem value="At Sorting Hub">At Sorting Hub</SelectItem>
                <SelectItem value="In Transit">In Transit</SelectItem>
                <SelectItem value="Out for Delivery">Out for Delivery</SelectItem>
                <SelectItem value="Delivered">Delivered</SelectItem>
                <SelectItem value="Partial Delivered">Partial Delivered</SelectItem>
                <SelectItem value="Payment Invoice">Payment Invoice</SelectItem>
                <SelectItem value="On Hold">On Hold</SelectItem>
                <SelectItem value="Exchange">Exchange</SelectItem>
                <SelectItem value="Return">Return</SelectItem>
                <SelectItem value="Returned">Returned</SelectItem>
                <SelectItem value="Paid Return">Paid Return</SelectItem>
                <SelectItem value="Return Requested">Return Requested</SelectItem>
                <SelectItem value="Return In Transit">Return In Transit</SelectItem>
                <SelectItem value="Returned to Merchant">Returned to Merchant</SelectItem>
                <SelectItem value="Return Delivered">Return Delivered</SelectItem>
                <SelectItem value="Delivery Failed">Delivery Failed</SelectItem>
                <SelectItem value="Customer Refused">Customer Refused</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={storeFilter} onValueChange={onStoreFilterChange}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Store" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stores</SelectItem>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <CategoryFilter
              mode="multi"
              categories={allCategories}
              stores={stores}
              storeFilter={storeFilter}
              value={categoryFilter}
              onChange={onCategoryFilterChange}
              size="sm"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

export default memo(OrderFiltersImpl);
