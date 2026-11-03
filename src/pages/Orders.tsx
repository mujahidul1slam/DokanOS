import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import {
  Search, ExternalLink, MoreHorizontal, Send, CalendarIcon,
  RefreshCw, Loader2, MapPin, Package, Truck, ShoppingCart, CheckSquare,
  PackageCheck, Clock, AlertTriangle, CheckCircle2, Undo2, XCircle, CreditCard, BadgeCheck, Printer, Plus,
  Trash2, RotateCcw, Hourglass, Tags, Ruler, Sparkles, Wrench, SlidersHorizontal, ChevronDown, X, Pencil, Link2,
  Combine,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { logAction } from "@/lib/auditLog";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { DateRange } from "react-day-picker";
import OrderDetailSheet from "@/components/orders/OrderDetailSheet";
import AddOrderDialog from "@/components/orders/AddOrderDialog";
import OrderCard from "@/components/orders/OrderCard";
import DispatchDialog from "@/components/orders/DispatchDialog";
import ExchangeDialog from "@/components/orders/ExchangeDialog";
import AttachParcelDialog from "@/components/orders/AttachParcelDialog";
import PickupSlipPrint from "@/components/orders/PickupSlipPrint";
import { usePermissions } from "@/hooks/usePermissions";
import OrderRowActions from "@/components/orders/OrderRowActions";
import OrderTabs from "@/components/orders/OrderTabs";
import OrderFilters from "@/components/orders/OrderFilters";
import OrderBulkActionsBar from "@/components/orders/OrderBulkActionsBar";
import OrderTable from "@/components/orders/OrderTable";
import {
  SourceBadge, PaymentBadge, FulfillmentBadge, TrackingBadge, DeliveryBadge,
} from "@/components/orders/OrderBadges";
import { TableSkeleton } from "@/components/ui/loading-states";
import ConfirmDialog from "@/components/ConfirmDialog";
import { printInvoice } from "@/components/pos/InvoicePrint";
import { printMeasurementSlipsBulk } from "@/components/orders/MeasurementSlipPrint";
import { useInvoiceSettings } from "@/hooks/useInvoiceSettings";
import CategoryFilter from "@/components/CategoryFilter";
import { useDebounce } from "@/hooks/useDebounce";
import {
  usePreOrderCategoryIds,
  expandWithDescendants,
} from "@/lib/preOrderSettings";
import { Settings as SettingsIcon } from "lucide-react";
import PreOrderCategoriesDialog from "@/components/settings/PreOrderCategoriesDialog";
import DuePaymentDialog, { type DuePaymentResult } from "@/components/orders/DuePaymentDialog";
import { recordDuePayment } from "@/lib/dueCollection";
import MergeOrdersDialog, { fetchMergeOrderDetails, MergeBlockList } from "@/components/orders/MergeOrdersDialog";
import { groupOrdersForMerge, type MergeGroup, type MergeOrder } from "@/lib/orderMerge";
import { getActiveCurrency, symbolFor } from "@/lib/currency";
import {
  matchesTab as matchesTabExt, ALL_TAB_KEYS,
  normalizeTrackingStatus,
  showDuplicateWarningOn, showMergePanelOn,
  type TabKey,
} from "./orders/tabFilters";
import { useOrderBulkActions } from "./orders/useOrderBulkActions";
// Issue #9: loading (business scoping, fetch race, pagination, error
// handling) lives in the hook; the page renders its state.
import { useOrdersData, type OrderRow } from "./orders/useOrdersData";
import { findDuplicateOrderPairs } from "@/lib/duplicateOrder";
import { useStoresList } from "@/hooks/useStoresList";
import {
  hasStoreScope,
  scopeStoreIds,
  selectedStoreScope,
  useActiveBusinessStoreIds,
} from "@/hooks/useActiveBusinessStoreIds";

interface StoreOption { id: string; name: string }

/** Extra display fields the merge group panel wants alongside MergeOrder. */
type GroupableOrder = MergeOrder & { created_at: string };

/**
 * Minimal MergeOrder view of a list row (issue #30): groupOrdersForMerge and
 * checkMergeEligibility only touch id/status/customer-phone/consignment
 * fields. Money, items and payments are fetched when the merge dialog opens
 * (fetchMergeOrderDetails) — the grouping UI never needs them.
 */
const toMergeGroupOrder = (o: OrderRow): GroupableOrder => ({
  id: o.id,
  order_number: o.order_number,
  status: o.status,
  consignment_id: o.consignment_id,
  deleted_at: o.deleted_at,
  customer_name: o.customer_name,
  customer_phone: o.customer_phone,
  subtotal: 0,
  discount: 0,
  shipping_cost: 0,
  tax_amount: 0,
  total: o.total,
  items: [],
  payments: [],
  created_at: o.created_at,
});

const PAGE_SIZE = 200;
// TabKey moved to ./orders/tabFilters

const Orders = () => {
  // Declared before useOrdersData: the hook needs to know whether the store
  // filter points at one of THIS business's stores (a foreign one fails closed
  // instead of reading every store and filtering down to nothing).
  const [storeFilter, setStoreFilter] = useState("all");
  // Issue #9: all order loading (business scoping, overlapping-fetch race
  // guard, pagination, error surfacing) lives in useOrdersData — the page
  // renders its state and the error/retry banner.
  const {
    orders, setOrders, orderCategoryMap, loading, loadError, orderSourceError,
    loadOrders, retryLoad,
  } = useOrdersData({ storeFilter });
  const { can } = usePermissions();
  const canAttachCourier = can("orders.attach_courier");
  const { settings: invoiceSettings } = useInvoiceSettings();
  // Hybrid tenancy (issue #16): the store ids of the ACTIVE business. Every
  // operational read below is bounded by them, and an empty scope fails closed.
  // The store selector's options come from the same seam (useStoresList), so
  // "All stores" can only ever mean this business's stores.
  const businessStoreIds = useActiveBusinessStoreIds();
  const stores = useStoresList();
  // Operational write affordances follow the resolved permission baseline, so
  // a first-release account member (no legacy user_roles row) can create/edit
  // orders like staff while a viewer stays read-only.
  const canWrite = can("orders.create") || can("orders.edit");
  const [allCategories, setAllCategories] = useState<{ id: string; name: string; parent_id: string | null; store_id: string | null }[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [deliveryFilter, setDeliveryFilter] = useState("all");
  const [courierFilter, setCourierFilter] = useState("all");
  const [preOrderStatusFilter, setPreOrderStatusFilter] = useState<"all" | "pre_order_pending" | "pre_order_making" | "pre_order_ready">("all");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("new");
  const preOrderMode = tab === "pre_order";
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [duplicateFilterActive, setDuplicateFilterActive] = useState(false);
  const preOrderCategoryIds = usePreOrderCategoryIds();
  const [preOrderSettingsOpen, setPreOrderSettingsOpen] = useState(false);

  // Dispatch
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [dispatchOrderIds, setDispatchOrderIds] = useState<string[]>([]);
  // Add Order
  const [addOrderOpen, setAddOrderOpen] = useState(false);
  // Exchange parcel
  const [exchangeOpen, setExchangeOpen] = useState(false);
  // Attach / replace parcel
  const [attachParcelOrder, setAttachParcelOrder] = useState<OrderRow | null>(null);
  // Merge dialog (issue #30) — full source orders, fetched when a group opens it
  const [mergeDialogOrders, setMergeDialogOrders] = useState<MergeOrder[] | null>(null);

  // Tracking
  const [trackingLoading, setTrackingLoading] = useState(false);

  // Bulk actions
  const [bulkUpdating, setBulkUpdating] = useState(false);
  // Trash confirm
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);
  const [pendingTrashIds, setPendingTrashIds] = useState<string[]>([]);
  // Due payment dialog (bulk Mark Paid)
  const [duePayOpen, setDuePayOpen] = useState(false);
  const [duePayContext, setDuePayContext] = useState<{ ids: string[]; totalDue: number }>({ ids: [], totalDue: 0 });


  const { toast } = useToast();

  // Open detail sheet from ?order=ID URL param (e.g., from Customer profile)
  useEffect(() => {
    const orderParam = searchParams.get("order");
    const tabParam = searchParams.get("tab") as TabKey | null;
    const newParam = searchParams.get("new");
    const statusParam = searchParams.get("status");
    let changed = false;
    if (orderParam) {
      setDetailOrderId(orderParam);
      searchParams.delete("order");
      changed = true;
    }
    if (tabParam) {
      setTab(tabParam);
      searchParams.delete("tab");
      changed = true;
    }
    if (newParam) {
      setAddOrderOpen(true);
      searchParams.delete("new");
      changed = true;
    }
    if (statusParam) {
      setStatusFilter(statusParam);
      searchParams.delete("status");
      changed = true;
    }
    const storeParam = searchParams.get("store");
    if (storeParam) {
      setStoreFilter(storeParam);
      searchParams.delete("store");
      changed = true;
    }
    if (changed) setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);


  const loadStores = useCallback(async () => {
    // The store selector's options come from useStoresList(), which is already
    // scoped to the active business and fails closed on its own. The category
    // selector is read with the same tenant predicate.
    if (!hasStoreScope(businessStoreIds)) {
      setAllCategories([]);
      return;
    }
    const { data: catData } = await scopeStoreIds(
      supabase.from("categories").select("id, name, parent_id, store_id").order("name"),
      businessStoreIds,
    );
    setAllCategories((catData || []) as any);
  }, [businessStoreIds]);

  // Dropdown reference data only — order loading is triggered inside
  // useOrdersData (its own effect tracks the scoping inputs).
  useEffect(() => { loadStores(); }, [loadStores]);

  /* ─── Pre-order detection: order has at least one item whose category is configured as Pre-Order ─── */
  const preOrderOrderIds = useMemo(() => {
    if (preOrderCategoryIds.size === 0) return new Set<string>();
    const expanded = expandWithDescendants(preOrderCategoryIds, allCategories);
    const out = new Set<string>();
    orderCategoryMap.forEach((cats, orderId) => {
      for (const c of cats) {
        if (expanded.has(c)) { out.add(orderId); break; }
      }
    });
    return out;
  }, [preOrderCategoryIds, allCategories, orderCategoryMap]);

  /* ─── Auto-promote COD pre-order items to "Pre-Order" status ───
     For COD orders containing pre-order items, status should be `pre_order_pending`
     regardless of incoming Woo status. Non-COD pre-orders only become pre_order_pending
     after their payment is confirmed (handled in OrderDetailSheet). */
  useEffect(() => {
    if (preOrderOrderIds.size === 0 || orders.length === 0) return;
    const isCod = (m?: string | null) =>
      !!m && (m.toLowerCase().includes("cod") || m.toLowerCase().includes("cash on delivery"));
    const toPromote = orders.filter((o) =>
      preOrderOrderIds.has(o.id) &&
      !o.consignment_id &&
      !o.deleted_at &&
      isCod(o.payment_method) &&
      ["pending", "processing"].includes(o.status)
    );
    if (toPromote.length === 0) return;
    (async () => {
      const ids = toPromote.map((o) => o.id);
      const { error } = await supabase
        .from("orders")
        .update({ status: "pre_order_pending" })
        .in("id", ids)
        .in("store_id", businessStoreIds);
      if (error) {
        console.warn("Pre-order auto-promotion failed:", error.message);
        return;
      }
      // Timeline entries
      await supabase.from("order_timeline").insert(
        toPromote.map((o) => ({
          order_id: o.id,
          event: "status_changed",
          description: `Status changed from "${o.status}" to "pre_order_pending" (auto: COD pre-order)`,
          metadata: { from: o.status, to: "pre_order_pending", auto: true, reason: "cod_pre_order" },
        }))
      );
      // Reflect locally without full refetch
      setOrders((prev) =>
        prev.map((o) => (ids.includes(o.id) ? { ...o, status: "pre_order_pending" } : o))
      );
    })();
  }, [preOrderOrderIds, orders]);


  /* ─── Tab-based filtering ───
     Predicate lives in ./orders/tabFilters so the page, the counts loop, and
     future unit tests share one source of truth for the rules. */
  const matchesTab = useCallback(
    (o: OrderRow, tabKey: TabKey) => matchesTabExt(o, tabKey, preOrderOrderIds),
    [preOrderOrderIds]
  );

  const getTabOrders = useCallback(
    (tabKey: TabKey) => orders.filter((o) => matchesTab(o, tabKey)),
    [orders, matchesTab]
  );


  // Categories scoped to currently selected store filter
  const scopedCategories = useMemo(() => {
    if (storeFilter === "all") return allCategories;
    return allCategories.filter((c) => c.store_id === storeFilter);
  }, [allCategories, storeFilter]);

  // Categories grouped by store name (used when "All Stores" is selected)
  const groupedCategories = useMemo(() => {
    const storeNameMap = new Map(stores.map((s) => [s.id, s.name]));
    const groups = new Map<string, { storeId: string | null; storeName: string; cats: { id: string; name: string; store_id: string | null }[] }>();
    scopedCategories.forEach((c) => {
      const key = c.store_id ?? "__none__";
      const storeName = c.store_id ? (storeNameMap.get(c.store_id) || "Unknown Store") : "Uncategorized";
      if (!groups.has(key)) groups.set(key, { storeId: c.store_id, storeName, cats: [] });
      groups.get(key)!.cats.push(c);
    });
    return Array.from(groups.values()).sort((a, b) => a.storeName.localeCompare(b.storeName));
  }, [scopedCategories, stores]);

  const debouncedSearch = useDebounce(search, 200);

  const duplicateGroups = useMemo(() => {
    if (!showDuplicateWarningOn(tab)) return [];
    // Trashed orders are gone — never actionable — so they must not pair up as
    // duplicates (deleted rows were inflating the count and the cards).
    // Issue: scope duplicates to the CURRENT tab so each tab only shows pairs
    // relevant to that stage (user request: New shows New duplicates only, etc.)
    const tabOrders = getTabOrders(tab);
    const liveOrders = tabOrders.filter((order) => !order.deleted_at);
    const byNumber = new Map(liveOrders.map((order) => [order.order_number, order]));
    const candidates = liveOrders.map((order) => ({
      orderNumber: order.order_number,
      createdAt: order.created_at,
      customerPhone: order.customer_phone,
      brandId: order.brand?.id,
      items: order.productItems.map((item) => ({ productName: item.name })),
    }));
    const groups = new Map<string, { orders: [OrderRow, OrderRow]; reasons: string[] }>();
    for (const match of findDuplicateOrderPairs(candidates)) {
      const pair = [match.first.orderNumber, match.second.orderNumber].sort();
      const key = `${pair[0]}\u0000${pair[1]}`;
      if (groups.has(key)) continue;
      const first = byNumber.get(pair[0]);
      const second = byNumber.get(pair[1]);
      if (!first || !second) continue;
      groups.set(key, {
        orders: [first, second],
        reasons: match.sharedProducts.map((product) => `Same product: ${product.name}`),
      });
    }
    return Array.from(groups.values());
  }, [orders, tab, getTabOrders]);
  const duplicateOrderNumbers = useMemo(
    () => new Set(duplicateGroups.flatMap((group) => group.orders.map((order) => order.order_number))),
    [duplicateGroups],
  );
  const duplicateOrderIds = useMemo(
    () => new Set(duplicateGroups.flatMap((group) => group.orders.map((order) => order.id))),
    [duplicateGroups],
  );

  const filtered = useMemo(() => {
    const tabOrders = getTabOrders(tab);
    const q = debouncedSearch.trim().toLowerCase();
    const catArr = categoryFilter.size > 0 ? Array.from(categoryFilter) : null;
    const fromMs = dateRange?.from ? dateRange.from.getTime() : null;
    let toMs: number | null = null;
    if (dateRange?.to) {
      const end = new Date(dateRange.to);
      end.setHours(23, 59, 59, 999);
      toMs = end.getTime();
    }
    return tabOrders.filter((o) => {
      if (q) {
        const hit =
          o.order_number.toLowerCase().includes(q) ||
          (o.customer_name || "").toLowerCase().includes(q) ||
          (o.customer_phone || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (tab === "all" && statusFilter !== "all" && o.status !== statusFilter) return false;
      if (paymentFilter !== "all" && o.payment_status !== paymentFilter) return false;
      if (sourceFilter !== "all" && o.source !== sourceFilter) return false;
      if (storeFilter !== "all" && o.store_id !== storeFilter) return false;
      if (deliveryFilter !== "all" && o.fulfillment_type !== deliveryFilter) return false;
      if (courierFilter === "has" && !o.consignment_id) return false;
      else if (courierFilter === "none" && o.consignment_id) return false;
      else if (courierFilter !== "all" && courierFilter !== "has" && courierFilter !== "none" && normalizeTrackingStatus(o.tracking_status || "") !== normalizeTrackingStatus(courierFilter)) return false;
      if (catArr) {
        const orderCats = orderCategoryMap.get(o.id);
        if (!orderCats) return false;
        let any = false;
        for (const c of catArr) { if (orderCats.has(c)) { any = true; break; } }
        if (!any) return false;
      }
      if (preOrderStatusFilter !== "all" && o.status !== preOrderStatusFilter) return false;
      if (fromMs !== null) {
        const t = new Date(o.created_at).getTime();
        if (t < fromMs) return false;
        if (toMs !== null && t > toMs) return false;
      }
      return true;
    });
  }, [debouncedSearch, statusFilter, paymentFilter, sourceFilter, storeFilter, deliveryFilter, courierFilter, preOrderStatusFilter, categoryFilter, orderCategoryMap, dateRange, tab, getTabOrders]);

  const duplicateFiltered = duplicateFilterActive
    ? filtered.filter((o) => duplicateOrderNumbers.has(o.order_number))
    : filtered;
  const totalPages = Math.max(1, Math.ceil(duplicateFiltered.length / PAGE_SIZE));
  const paginated = duplicateFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* ─── Same-customer merge groups (issue #30) ───
     2+ orders of one customer (normalized phone) in one state form a
     collapsible group whose Merge action is gated by checkMergeEligibility.
     Already-"merged" source rows are history, not merge candidates, so they
     are excluded here. Trashed and missing-phone orders are skipped inside
     groupOrdersForMerge. The groups use the complete filtered result rather
     than only the current 200-row page, so pagination cannot hide a merge
     candidate. */
  const mergeGroups = useMemo(() => {
    if (!showMergePanelOn(tab)) return [];
    const groupable = filtered
      .filter((o) => o.status !== "merged")
      .map(toMergeGroupOrder);
    return groupOrdersForMerge(groupable);
  }, [filtered, tab]);

  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, paymentFilter, sourceFilter, storeFilter, deliveryFilter, courierFilter, preOrderStatusFilter, categoryFilter, dateRange, tab, duplicateFilterActive]);

  // When store filter changes, drop category selections that no longer belong
  useEffect(() => {
    if (storeFilter === "all") return;
    setCategoryFilter((prev) => {
      const allowed = new Set(scopedCategories.map((c) => c.id));
      const next = new Set(Array.from(prev).filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [storeFilter, scopedCategories]);
  useEffect(() => { setSelected(new Set()); }, [tab]);
  useEffect(() => {
    if (preOrderMode && ["pre_order_pending", "pre_order_making", "pre_order_ready"].includes(tab)) {
      setPreOrderStatusFilter("all");
    }
  }, [tab, preOrderMode]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const toggleAll = () => {
    if (selected.size === paginated.length) setSelected(new Set());
    else setSelected(new Set(paginated.map((o) => o.id)));
  };

  /* ─── Tab counts ───
     Single pass over orders, asking each tab's predicate per order. Previously
     this called getTabOrders 13 times (each a full scan), giving O(13n). */
  const counts = useMemo(() => {
    const out = Object.fromEntries(ALL_TAB_KEYS.map((k) => [k, 0])) as Record<TabKey, number>;
    for (const o of orders) {
      for (const k of ALL_TAB_KEYS) {
        if (matchesTab(o, k)) out[k]++;
      }
    }
    return out;
  }, [orders, matchesTab]);


  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (statusFilter !== "all") n++;
    if (paymentFilter !== "all") n++;
    if (sourceFilter !== "all") n++;
    if (storeFilter !== "all") n++;
    if (deliveryFilter !== "all") n++;
    if (courierFilter !== "all") n++;
    if (preOrderStatusFilter !== "all") n++;
    if (categoryFilter.size > 0) n++;
    if (dateRange?.from) n++;
    return n;
  }, [statusFilter, paymentFilter, sourceFilter, storeFilter, deliveryFilter, courierFilter, preOrderStatusFilter, categoryFilter, dateRange]);

  const clearAllFilters = () => {
    setStatusFilter("all");
    setPaymentFilter("all");
    setSourceFilter("all");
    setStoreFilter("all");
    setDeliveryFilter("all");
    setCourierFilter("all");
    setPreOrderStatusFilter("all");
    setCategoryFilter(new Set());
    setDateRange(undefined);
  };

  /* ─── Dispatch helpers ─── */
  const openDispatch = (ids: string[]) => {
    setDispatchOrderIds(ids);
    setDispatchDialogOpen(true);
  };

  /* ─── Merge dialog (issue #30) ───
     Load the full money/items/payments picture for the group's orders, then
     open the confirmation dialog with its merged preview. */
  const openMergeDialogForIds = async (orderIds: string[]) => {
    if (orderIds.length < 2) return;
    try {
      const full = await fetchMergeOrderDetails(orderIds);
      if (full.length < 2) {
        toast({ title: "Merge unavailable", description: "Could not load these orders.", variant: "destructive" });
        return;
      }
      setMergeDialogOrders(full);
    } catch (e: any) {
      toast({ title: "Merge failed", description: e?.message ? String(e.message) : String(e), variant: "destructive" });
    }
  };

  const openMergeDialog = async (groupOrders: MergeOrder[]) => {
    await openMergeDialogForIds(groupOrders.map((order) => order.id));
  };

  const dispatchOrders = useMemo(() =>
    orders.filter((o) => dispatchOrderIds.includes(o.id)),
    [orders, dispatchOrderIds]
  );

  /* ─── Mark Ready to Ship ─── */
  const {
    handleMarkReadyToShip,
    handleBulkMarkPaid,
    handleConfirmBulkDuePayment,
    handleBulkCancel,
    handleBulkStatusChange,
    handleTrashOrders,
    handleRestoreOrders,
    handleBulkPrintMeasurementSlips,
    handleBulkTrackSelected,
    filterGatedForCourier,
  } = useOrderBulkActions({
    orders,
    selected,
    setSelected,
    setBulkUpdating,
    loadOrders,
    toast,
    duePayContext,
    setDuePayContext,
    setDuePayOpen,
    businessStoreIds,
  });

  /* ─── Pathao sync ─── */
  const syncPathaoStores = async () => {
    try {
      await supabase.functions.invoke("pathao-courier", { body: { action: "get_stores" } });
      toast({ title: "Pathao stores synced" });
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const syncCities = async () => {
    try {
      const { data } = await supabase.functions.invoke("pathao-courier", { body: { action: "get_cities" } });
      toast({ title: `${(data?.data || []).length} cities synced` });
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  const handleTrackAll = async () => {
    setTrackingLoading(true);
    try {
      const orderIds = filtered.map(o => o.id);
      if (orderIds.length === 0) {
        toast({ title: "No orders to track in this view." });
        return;
      }
      const { data, error } = await supabase.functions.invoke("pathao-courier", {
        body: { action: "track_all", order_ids: orderIds },
      });
      if (error) throw error;
      toast({ title: "Tracking updated", description: `Checked ${data?.data?.total || 0}, updated ${data?.data?.updated || 0}. If you have more than 50 orders in this view, click again to track the rest.` });
      loadOrders();
    } catch (err: any) { toast({ title: "Tracking failed", description: err.message, variant: "destructive" }); }
    finally { setTrackingLoading(false); }
  };

  const handleTrackOne = async (consignmentId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("pathao-courier", { body: { action: "track_order", consignment_id: consignmentId } });
      if (error) throw error;
      toast({ title: `Status: ${data?.data?.order_status || "Unknown"}` });
      loadOrders();
    } catch (err: any) { toast({ title: "Track failed", description: err.message, variant: "destructive" }); }
  };

  /* ─── Reprint invoice for any order ─── */
  const handleReprintOrder = async (orderId: string) => {
    // Fail closed: without a store scope there is no order this business may read.
    if (!hasStoreScope(businessStoreIds)) return;
    // The order is read THROUGH the tenant predicate first; its child rows are
    // only fetched once it is known to belong to the active business, so a
    // foreign order id can never pull in that business's items or payments.
    const orderRes = await scopeStoreIds(
      supabase.from("orders").select("id, order_number, total, subtotal, discount, shipping_cost, notes, customer_name, customer_phone, customer_address, customer_city").eq("id", orderId),
      businessStoreIds,
    ).single();
    const o = orderRes.data as any;
    if (!o) return; // outside the active business's stores: nothing to print
    const [itemsRes, paymentsRes] = await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", orderId),
      supabase.from("order_payments").select("*").eq("order_id", orderId),
    ]);
    const customer = {
      name: o.customer_name || "",
      phone: o.customer_phone || "",
      address: o.customer_address || "",
      city: o.customer_city || "",
      zone: "",
    };
    const items = (itemsRes.data || []).map((i: any) => ({
      uid: i.id, productId: i.product_id || "", name: i.product_name, price: Number(i.unit_price), qty: i.quantity, customTailoring: false,
    }));
    const payments = (paymentsRes.data || []).map((p: any) => ({ id: p.id, method: p.method, amount: Number(p.amount) }));
    const cart = {
      id: o.id, label: o.order_number, items, customer, fulfillment: (Number(o.shipping_cost) > 0 ? "delivery" : "walkin") as "delivery" | "walkin",
      shippingAddress: "", pathaoZone: "", discount: Number(o.discount) || 0, discountType: "flat" as const,
      shippingFee: Number(o.shipping_cost) || 0, payments, notes: o.notes || "", taxRate: 0,
    };
    const fmt = invoiceSettings?.default_print_format || "thermal";
    printInvoice({ orderNumber: o.order_number, cart, subtotal: Number(o.subtotal), total: Number(o.total), invoiceSettings }, fmt);
  };

  if (loading) return (
    <div className="space-y-4">
      <div><h1 className="font-heading text-2xl font-semibold">Orders</h1></div>
      <TableSkeleton rows={10} cols={7} />
    </div>
  );

  /* ─── Selected order data for slip printing ─── */
  const selectedOrders = orders.filter((o) => selected.has(o.id));

  /* ─── Determine which action buttons to show ─── */
  const hasSelection = selected.size > 0;

  /* ─── Per-row quick actions (tab-aware) ─── */
  type QuickAction = { key: string; label: string; icon: any; onClick: () => void; destructive?: boolean };
  const getQuickActions = (order: OrderRow): QuickAction[] => {
    const actions: QuickAction[] = [
      { key: "edit", label: "Edit", icon: Pencil, onClick: () => setDetailOrderId(order.id) },
    ];
    if (tab === "trash") {
      if (canWrite) actions.push({ key: "restore", label: "Restore", icon: RotateCcw, onClick: () => handleRestoreOrders([order.id]) });
      return actions;
    }
    // Merged source orders (issue #30) are read-only history: jump to the
    // merged order instead of offering active-list actions.
    if (order.status === "merged") {
      if (order.parent_order_id) {
        actions.push({
          key: "view_merged", label: "View merged order", icon: Combine,
          onClick: () => setDetailOrderId(order.parent_order_id!),
        });
      }
      return actions;
    }
    if ((tab === "new" || tab === "all") && order.status === "processing" && !order.consignment_id && canWrite) {
      actions.push({
        key: "ready", label: "Mark Ready to Ship", icon: PackageCheck,
        onClick: () => {
          scopeStoreIds(
            supabase.from("orders").update({ status: "ready_to_ship" }).eq("id", order.id),
            businessStoreIds,
          ).then(() => {
            addOrderTimeline({ order_id: order.id, event: "status_changed", description: "Marked as Ready to Ship" });
            toast({ title: "Marked Ready to Ship" });
            loadOrders();
          });
        },
      });
    }
    if ((tab === "ready" || tab === "all" || tab === "pre_order") && order.status === "ready_to_ship" && !order.consignment_id && canWrite) {
      actions.push({ key: "dispatch", label: "Dispatch to Pathao", icon: Send, onClick: () => openDispatch([order.id]) });
    }
    if (["pickup_pending", "in_transit", "on_hold", "returned", "delivered", "cancelled"].includes(tab) && order.consignment_id) {
      actions.push({ key: "track", label: "Refresh Tracking", icon: RefreshCw, onClick: () => handleTrackOne(order.consignment_id!) });
    }
    if (canAttachCourier && !["trash", "cancelled"].includes(tab)) {
      if (!order.consignment_id) {
        actions.push({ key: "attach_parcel", label: "Attach Pathao Consignment", icon: Link2, onClick: () => setAttachParcelOrder(order) });
      } else {
        actions.push({ key: "replace_parcel", label: "Replace Pathao Consignment", icon: Link2, onClick: () => setAttachParcelOrder(order) });
      }
    }
    if (["delivered", "in_transit", "pickup_pending", "ready", "all"].includes(tab)) {
      actions.push({ key: "print", label: "Print Invoice", icon: Printer, onClick: () => handleReprintOrder(order.id) });
    }
    if (canWrite) {
      actions.push({
        key: "trash", label: "Move to Trash", icon: Trash2, destructive: true,
        onClick: () => { setPendingTrashIds([order.id]); setTrashConfirmOpen(true); },
      });
    }
    return actions;
  };

  const renderActionButtons = (order: OrderRow, max: number) => (
    <OrderRowActions actions={getQuickActions(order)} max={max} order={order} />
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Manage your order pipeline — from new orders to delivery
          </p>
        </div>
        <div className="flex items-center gap-2">
          {preOrderMode && canWrite && (
            <Button variant="outline" size="sm" onClick={() => setPreOrderSettingsOpen(true)} className="gap-1.5">
              <SettingsIcon className="h-4 w-4" /> Pre-Order Categories
              {preOrderCategoryIds.size > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[10px]">{preOrderCategoryIds.size}</Badge>
              )}
            </Button>
          )}
          {canWrite && !preOrderMode && (
            <Button size="sm" onClick={() => setAddOrderOpen(true)} className="hidden sm:inline-flex">
              <Plus className="h-4 w-4 mr-1" /> Add Order
            </Button>
          )}
          {canWrite && !preOrderMode && (
            <Button size="sm" variant="outline" onClick={() => setExchangeOpen(true)} className="hidden sm:inline-flex gap-1.5">
              <RefreshCw className="h-4 w-4" /> New Exchange
            </Button>
          )}
          {!preOrderMode && ["pickup_pending", "in_transit", "on_hold", "returned"].includes(tab) && (
            <Button variant="outline" size="sm" onClick={handleTrackAll} disabled={trackingLoading}>
              {trackingLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Update Tracking
            </Button>
          )}
          {showDuplicateWarningOn(tab) && duplicateGroups.length > 0 && (
            <Button
              size="sm"
              variant={duplicateFilterActive ? "destructive" : "outline"}
              className="border-red-400 text-red-700 hover:bg-red-50"
              onClick={() => setDuplicateFilterActive((active) => !active)}
            >
              <AlertTriangle className="mr-1 h-4 w-4" />
              {duplicateOrderNumbers.size} duplicate orders
            </Button>
          )}
          {!preOrderMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm"><MapPin className="h-4 w-4 mr-1" /> Pathao</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={syncPathaoStores}><RefreshCw className="h-4 w-4 mr-2" /> Sync Stores</DropdownMenuItem>
                <DropdownMenuItem onClick={syncCities}><MapPin className="h-4 w-4 mr-2" /> Sync Locations</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Issue #9: load failures used to be silent (empty/stale list, no
          feedback). Surface them with a Retry action — retry also re-runs
          the order-source scope fetch, since a failed scope fetch leaves
          the query under-scoped rather than merely un-executed. */}
      {(loadError || orderSourceError) && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950">
          <div>
            <strong>Couldn&rsquo;t load all orders.</strong>{" "}
            {loadError || orderSourceError}
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={retryLoad}>
            <RotateCcw className="h-4 w-4 mr-1" /> Retry
          </Button>
        </div>
      )}

      {/* Issue #7: warn only on the pre-dispatch tabs where acting on a
          duplicate is still possible (see DUPLICATE_WARNING_TABS). */}
      {showDuplicateWarningOn(tab) && duplicateFilterActive && (
        <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          <span>Showing duplicates only</span>
          <button type="button" className="font-medium underline" onClick={() => setDuplicateFilterActive(false)}>Clear</button>
        </div>
      )}
      {/* Action Bar — shown when any orders are selected */}
      <OrderBulkActionsBar
        selectedCount={selected.size}
        selectedOrders={selectedOrders}
        selectedIds={Array.from(selected)}
        bulkUpdating={bulkUpdating}
        canWrite={canWrite}
        tab={tab}
        onBulkStatusChange={handleBulkStatusChange}
        onBulkPrintMeasurementSlips={handleBulkPrintMeasurementSlips}
        onDispatch={() => { const ids = filterGatedForCourier(Array.from(selected)); if (ids.length) openDispatch(ids); }}
        onBulkTrack={handleBulkTrackSelected}
        onBulkMarkPaid={handleBulkMarkPaid}
        onMergeSelected={() => openMergeDialogForIds(Array.from(selected))}
        onRestore={() => handleRestoreOrders(Array.from(selected))}
        onTrash={() => { setPendingTrashIds(Array.from(selected)); setTrashConfirmOpen(true); }}
        onClear={() => setSelected(new Set())}
         onDeselect={(id) => setSelected((current) => { const next = new Set(current); next.delete(id); return next; })}
      />
      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <OrderTabs tab={tab} onChange={setTab} counts={counts} />

        {preOrderMode && (
          <div className="flex flex-wrap gap-2 pt-2 pb-2 pl-1">
            {[
              { key: "all", label: "All Pre-Orders", icon: Hourglass, count: counts.pre_order },
              { key: "pre_order_pending", label: "Pending", icon: Clock, count: counts.pre_order_pending },
              { key: "pre_order_making", label: "Making", icon: Wrench, count: counts.pre_order_making },
              { key: "pre_order_ready", label: "Ready", icon: Sparkles, count: counts.pre_order_ready },
            ].map((t) => {
              const active = preOrderStatusFilter === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setPreOrderStatusFilter(t.key as any)}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-secondary text-secondary-foreground border-secondary"
                      : "bg-background text-foreground border-border hover:bg-accent"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  <span className={cn(
                    "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                    active ? "bg-background/20" : "bg-muted text-muted-foreground"
                  )}>{t.count}</span>
                </button>
              );
            })}
          </div>
        )}

        <OrderFilters
          search={search}
          onSearchChange={setSearch}
          filtersOpen={filtersOpen}
          onFiltersOpenChange={setFiltersOpen}
          activeFilterCount={activeFilterCount}
          onClearAll={clearAllFilters}
          preOrderMode={preOrderMode}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          preOrderStatusFilter={preOrderStatusFilter}
          onPreOrderStatusFilterChange={setPreOrderStatusFilter}
          paymentFilter={paymentFilter}
          onPaymentFilterChange={setPaymentFilter}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          deliveryFilter={deliveryFilter}
          onDeliveryFilterChange={setDeliveryFilter}
          courierFilter={courierFilter}
          onCourierFilterChange={setCourierFilter}
          storeFilter={storeFilter}
          onStoreFilterChange={setStoreFilter}
          stores={stores}
          allCategories={allCategories}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
        />

        {/* ── Possible duplicates ──
            Same layout as the merge groups below: collapsible, one compact row
            per pair, expanded to the two orders. Shown only on the tabs where a
            duplicate can still be acted on (see DUPLICATE_WARNING_TABS). */}
        {showDuplicateWarningOn(tab) && duplicateGroups.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <h2 className="text-sm font-semibold">Possible duplicates</h2>
              <span className="text-xs text-muted-foreground">
                Same customer, same product, placed within 48h — review each pair
              </span>
            </div>
            {duplicateGroups.map((group) => (
              <DuplicateGroupPanel
                key={group.orders.map((order) => order.id).join("-")}
                group={group}
                onOpenOrder={setDetailOrderId}
              />
            ))}
          </div>
        )}

        {/* ── Same-customer merge groups (issue #30) ──
            Collapsible; the Merge action lives inside each group and is gated
            by checkMergeEligibility (block reasons render when ineligible).
            Issue #7: shown only on the pre-dispatch tabs where a merge is
            still possible (see MERGE_PANEL_TABS) — the detection above is
            unchanged, this gates visibility only. */}
        {showMergePanelOn(tab) && mergeGroups.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
              <Combine className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Same-customer groups</h2>
              <span className="text-xs text-muted-foreground">
                2+ orders of one customer in one state — merge each group into a single order (pre-entry only)
              </span>
            </div>
            {mergeGroups.map((g) => (
              <MergeGroupPanel
                key={`${g.customer_key}\u0000${g.state}`}
                group={g}
                canWrite={canWrite}
                onMerge={openMergeDialog}
                onOpenOrder={setDetailOrderId}
              />
            ))}
          </div>
        )}

        {/* ── Shared Table ── */}
        {paginated.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <>
          {/* Mobile & Tablet cards */}
          <div className="xl:hidden mt-4 space-y-2">
            {paginated.map((order) => (
              <div key={`${order.id}-prototype`} className={duplicateFilterActive && duplicateOrderNumbers.has(order.order_number) ? "border-l-4 border-red-500" : ""}>
              <OrderCard
                key={order.id}
                order={order}
                duplicate={duplicateOrderIds.has(order.id)}
                selected={selected.has(order.id)}
                onSelect={() => toggleSelect(order.id)}
                onOpen={() => setDetailOrderId(order.id)}
                actions={renderActionButtons(order, 2)}
              />
              </div>
            ))}
          </div>

          <OrderTable
            orders={paginated}
            selected={selected}
            tab={tab}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            duplicateOrderIds={duplicateOrderIds}
            renderActions={(order) => renderActionButtons(order, 3)}
          />
          </>
        )}

        <Pagination page={page} totalPages={totalPages} filtered={filtered} setPage={setPage} />
      </Tabs>

      {/* Mobile FAB — Add Order */}
      {canWrite && !preOrderMode && (
        <button
          onClick={() => setAddOrderOpen(true)}
          aria-label="Add order"
          className="sm:hidden fixed right-4 bottom-20 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform"
          style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      <PreOrderCategoriesDialog open={preOrderSettingsOpen} onOpenChange={setPreOrderSettingsOpen} />

      <OrderDetailSheet
        orderId={detailOrderId}
        open={!!detailOrderId}
        onOpenChange={(open) => { if (!open) setDetailOrderId(null); }}
        onSaved={loadOrders}
      />

      <DispatchDialog
        open={dispatchDialogOpen}
        onOpenChange={setDispatchDialogOpen}
        orders={dispatchOrders}
        onDispatched={() => { setSelected(new Set()); loadOrders(); }}
        onRemoveOrder={(id) => {
          setDispatchOrderIds((current) => current.filter((orderId) => orderId !== id));
          setSelected((current) => { const next = new Set(current); next.delete(id); return next; });
        }}
      />

      <AddOrderDialog
        open={addOrderOpen}
        onOpenChange={setAddOrderOpen}
        onCreated={loadOrders}
      />

      <ExchangeDialog
        open={exchangeOpen}
        onOpenChange={setExchangeOpen}
        pickerMode
        onCreated={() => loadOrders()}
      />

      <ConfirmDialog
        open={trashConfirmOpen}
        onOpenChange={setTrashConfirmOpen}
        title="Move to Trash?"
        description={`${pendingTrashIds.length} order(s) will be moved to trash and automatically deleted after 15 days.`}
        confirmLabel="Move to Trash"
        variant="destructive"
        onConfirm={() => { handleTrashOrders(pendingTrashIds); setTrashConfirmOpen(false); }}
      />

      <DuePaymentDialog
        open={duePayOpen}
        onOpenChange={setDuePayOpen}
        defaultAmount={duePayContext.totalDue}
        bulkMode={duePayContext.ids.length > 1}
        bulkCount={duePayContext.ids.length}
        title={duePayContext.ids.length > 1 ? "Collect Dues — Bulk Mark Paid" : "Collect Due"}
        onConfirm={handleConfirmBulkDuePayment}
      />

      {attachParcelOrder && (
        <AttachParcelDialog
          open={!!attachParcelOrder}
          onOpenChange={(v) => !v && setAttachParcelOrder(null)}
          orderId={attachParcelOrder.id}
          orderNumber={attachParcelOrder.order_number}
          existingConsignmentId={attachParcelOrder.consignment_id}
          onAttached={() => { setAttachParcelOrder(null); loadOrders(); }}
        />
      )}

      {mergeDialogOrders && (
        <MergeOrdersDialog
          open
          onOpenChange={(v) => { if (!v) setMergeDialogOrders(null); }}
          orders={mergeDialogOrders}
          onMerged={() => { setMergeDialogOrders(null); loadOrders(); }}
        />
      )}
    </div>
  );
};

/* ─── Same-customer merge group (issue #30) ───
   One collapsible panel per customer+state group. The Merge action lives
   inside the group and is enabled only when checkMergeEligibility passes;
   otherwise the block reasons (e.g. "entered" — pre-entry only, ADR-0002)
   are rendered in its place. */
function MergeGroupPanel({
  group,
  canWrite,
  onMerge,
  onOpenOrder,
}: {
  group: MergeGroup;
  canWrite: boolean;
  onMerge: (orders: MergeOrder[]) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const orders = group.orders as GroupableOrder[];
  const sym = symbolFor(getActiveCurrency());
  const money = (n: number) => `${sym}${Number(n).toLocaleString()}`;
  const combinedTotal = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const orderNumberById = new Map(orders.map((o) => [o.id, o.order_number]));
  const eligible = group.eligibility.eligible;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-accent/50 rounded-lg">
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          <Combine className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              {group.orders[0].customer_name || group.customer_key}
              {group.orders[0].customer_name && (
                <span className="ml-1.5 text-xs text-muted-foreground">{group.orders[0].customer_phone}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {orders.length} orders in &ldquo;{group.state}&rdquo; · combined {money(combinedTotal)}
            </div>
          </div>
        </div>
        <Badge variant={eligible ? "secondary" : "outline"} className="shrink-0">
          {eligible ? "Merge possible" : "Merge blocked"}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 space-y-3">
        <div className="rounded-md border divide-y">
          {orders.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onOpenOrder(o.id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-accent/50"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-medium">#{o.order_number}</span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(o.created_at), "MMM d, yyyy")}
                </span>
                {o.consignment_id && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">Entered</Badge>
                )}
              </span>
              <span className="font-medium whitespace-nowrap">{money(o.total)}</span>
            </button>
          ))}
        </div>

        {eligible ? (
          canWrite && (
            <Button size="sm" onClick={() => onMerge(orders)} className="gap-1.5">
              <Combine className="h-4 w-4" /> Merge {orders.length} orders
            </Button>
          )
        ) : (
          <div className="space-y-2">
            <MergeBlockList blocks={group.eligibility.blocks} orderNumberById={orderNumberById} />
            <Button size="sm" disabled className="gap-1.5">
              <Combine className="h-4 w-4" /> Merge {orders.length} orders
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ─── Possible duplicate pair ───
   Mirrors MergeGroupPanel: a collapsible card with one compact header row
   (customer + pair summary), expanded to a dense two-line order list and the
   "Matched because" reasons. Clicking an order opens its detail sheet. */
function DuplicateGroupPanel({ group, onOpenOrder }: { group: { orders: [OrderRow, OrderRow]; reasons: string[] }; onOpenOrder: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [first, second] = group.orders;
  const money = (value: number) => `৳${Number(value || 0).toLocaleString()}`;
  const combined = Number(first.total || 0) + Number(second.total || 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-accent/50 rounded-lg">
        <div className="flex items-center gap-2 min-w-0">
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              {first.customer_name || "Unknown customer"}
            </div>
            <div className="text-xs text-muted-foreground">
              #{first.order_number} &amp; #{second.order_number} · combined {money(combined)}
            </div>
          </div>
        </div>
        <Badge variant="destructive" className="shrink-0">Possible duplicate</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 space-y-3">
        <div className="rounded-md border divide-y">
          {[first, second].map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => onOpenOrder(order.id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-accent/50"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-medium">#{order.order_number}</span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(order.created_at), "MMM d, yyyy")}
                </span>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">{order.status}</Badge>
              </span>
              <span className="font-medium whitespace-nowrap">{money(order.total)}</span>
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Matched because:</span> {group.reasons.join("; ")}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ─── Empty State ─── */
function EmptyState({ tab }: { tab: TabKey }) {
  const configs: Record<TabKey, { icon: any; text: string }> = {
    all: { icon: ShoppingCart, text: "No orders found" },
    new: { icon: Package, text: "No new orders to process" },
    ready: { icon: PackageCheck, text: "No orders ready to ship — mark orders as Ready from the New Orders tab" },
    pre_order: { icon: Hourglass, text: "No pre-orders — orders containing products from configured Pre-Order categories will appear here" },
    pre_order_pending: { icon: Clock, text: "No pending pre-orders" },
    pre_order_making: { icon: Wrench, text: "No pre-orders currently being made" },
    pre_order_ready: { icon: Sparkles, text: "No pre-orders ready for delivery" },
    pickup_pending: { icon: Clock, text: "No orders waiting for pickup" },
    in_transit: { icon: Truck, text: "No orders in transit" },
    delivered: { icon: CheckCircle2, text: "No delivered orders" },
    on_hold: { icon: AlertTriangle, text: "No orders on hold" },
    returned: { icon: Undo2, text: "No returned orders" },
    cancelled: { icon: XCircle, text: "No cancelled orders — cancelled orders and Pathao pickup-cancel parcels appear here" },
    trash: { icon: Trash2, text: "Trash is empty — deleted orders appear here for 15 days" },
  };
  const config = configs[tab];
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 mt-4">
      <config.icon className="h-10 w-10 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">{config.text}</p>
    </div>
  );
}


/* ─── Pagination ─── */
function Pagination({ page, totalPages, filtered, setPage }: { page: number; totalPages: number; filtered: any[]; setPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground mt-4">
      <span>Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let pageNum: number;
          if (totalPages <= 5) pageNum = i + 1;
          else if (page <= 3) pageNum = i + 1;
          else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
          else pageNum = page - 2 + i;
          return (
            <Button key={pageNum} variant={page === pageNum ? "default" : "outline"} size="sm" className="w-9" onClick={() => setPage(pageNum)}>{pageNum}</Button>
          );
        })}
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export default Orders;
