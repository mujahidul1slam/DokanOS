import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import {
  Search, ExternalLink, MoreHorizontal, Send, CalendarIcon,
  RefreshCw, Loader2, MapPin, Package, Truck, ShoppingCart, CheckSquare,
  PackageCheck, Clock, AlertTriangle, CheckCircle2, Undo2, XCircle, CreditCard, BadgeCheck, Printer, Plus,
  Trash2, RotateCcw, Hourglass, Tags, Ruler, Sparkles, Wrench, SlidersHorizontal, ChevronDown, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logAction } from "@/lib/auditLog";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { postWooOrderNote } from "@/lib/wooNotes";
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
import PickupSlipPrint from "@/components/orders/PickupSlipPrint";
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

interface OrderRow {
  id: string;
  order_number: string;
  total: number;
  status: string;
  source: string;
  payment_method: string | null;
  payment_status: string;
  consignment_id: string | null;
  tracking_status: string | null;
  fulfillment_type: string;
  created_at: string;
  deleted_at: string | null;
  amount_to_collect: number | null;
  pathao_recipient_city: number | null;
  pathao_recipient_zone: number | null;
  pathao_recipient_area: number | null;
  pathao_store_id: number | null;
  item_weight: number | null;
  special_instruction: string | null;
  store_id: string | null;
  woo_order_id: number | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_email: string | null;
  stores: { name: string } | null;
  itemCount: number;
  productItems: { name: string; qty: number }[];
  isPreOrder: boolean;
}

interface StoreOption { id: string; name: string }

const PAGE_SIZE = 200;

type TabKey = "all" | "new" | "ready" | "pre_order" | "pickup_pending" | "in_transit" | "delivered" | "on_hold" | "returned" | "trash";

interface OrdersProps { preOrderMode?: boolean }

const Orders = ({ preOrderMode = false }: OrdersProps) => {
  const { role } = useAuth();
  const { settings: invoiceSettings } = useInvoiceSettings();
  const canWrite = role === "admin" || role === "staff";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderCategoryMap, setOrderCategoryMap] = useState<Map<string, Set<string>>>(new Map());
  const [allCategories, setAllCategories] = useState<{ id: string; name: string; store_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [deliveryFilter, setDeliveryFilter] = useState("all");
  const [courierFilter, setCourierFilter] = useState("all");
  const [preOrderStatusFilter, setPreOrderStatusFilter] = useState<"all" | "pre_order_pending" | "pre_order_making" | "pre_order_ready">("all");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>(preOrderMode ? "pre_order" : "new");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const preOrderCategoryIds = usePreOrderCategoryIds();
  const [preOrderSettingsOpen, setPreOrderSettingsOpen] = useState(false);

  // Dispatch
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [dispatchOrderIds, setDispatchOrderIds] = useState<string[]>([]);
  // Add Order
  const [addOrderOpen, setAddOrderOpen] = useState(false);

  // Tracking
  const [trackingLoading, setTrackingLoading] = useState(false);

  // Bulk actions
  const [bulkUpdating, setBulkUpdating] = useState(false);
  // Trash confirm
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);
  const [pendingTrashIds, setPendingTrashIds] = useState<string[]>([]);

  const { toast } = useToast();

  // Open detail sheet from ?order=ID URL param (e.g., from Customer profile)
  useEffect(() => {
    const orderParam = searchParams.get("order");
    const tabParam = searchParams.get("tab") as TabKey | null;
    const newParam = searchParams.get("new");
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
    if (changed) setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const loadOrders = useCallback(async () => {
    const { data } = await supabase
        .from("orders")
        .select("id, order_number, total, status, source, payment_method, payment_status, consignment_id, tracking_status, fulfillment_type, created_at, deleted_at, store_id, woo_order_id, customer_id, amount_to_collect, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, pathao_store_id, item_weight, special_instruction, customer_name, customer_phone, customer_address, customer_city, customer_email, stores(name), order_items(id, product_id, product_name, quantity, products(stock_status))")
        .order("created_at", { ascending: false });

    const mapped = (data || []).map((o: any) => ({
      ...o,
      itemCount: o.order_items?.length || 0,
      productItems: (o.order_items || [])
        .filter((i: any) => i.product_name)
        .map((i: any) => ({ name: i.product_name, qty: i.quantity || 1 })),
      isPreOrder: false, // recomputed reactively from category settings
    }));
    setOrders(mapped as OrderRow[]);

    // Build order -> category-id set map for filtering
    const productIds = Array.from(new Set(
      (data || []).flatMap((o: any) => (o.order_items || []).map((i: any) => i.product_id).filter(Boolean))
    ));
    if (productIds.length > 0) {
      const { data: pcData } = await supabase
        .from("product_categories")
        .select("product_id, category_id")
        .in("product_id", productIds);
      const productCatMap = new Map<string, Set<string>>();
      (pcData || []).forEach((pc: any) => {
        if (!productCatMap.has(pc.product_id)) productCatMap.set(pc.product_id, new Set());
        productCatMap.get(pc.product_id)!.add(pc.category_id);
      });
      const orderCatMap = new Map<string, Set<string>>();
      (data || []).forEach((o: any) => {
        const set = new Set<string>();
        (o.order_items || []).forEach((i: any) => {
          const cats = productCatMap.get(i.product_id);
          if (cats) cats.forEach((c) => set.add(c));
        });
        orderCatMap.set(o.id, set);
      });
      setOrderCategoryMap(orderCatMap);
    } else {
      setOrderCategoryMap(new Map());
    }

    setLoading(false);
  }, []);

  const loadStores = useCallback(async () => {
    const [{ data: storeData }, { data: catData }] = await Promise.all([
      supabase.from("stores").select("id, name").order("name"),
      supabase.from("categories").select("id, name, store_id").order("name"),
    ]);
    setStores(storeData || []);
    setAllCategories((catData || []) as any);
  }, []);

  useEffect(() => { loadOrders(); loadStores(); }, [loadOrders, loadStores]);

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

  /* ─── Tab-based filtering ─── */
  const getTabOrders = useCallback((tabKey: TabKey) => {
    if (tabKey === "trash") {
      return orders.filter((o) => !!o.deleted_at);
    }
    // All non-trash tabs exclude trashed orders
    const active = orders.filter((o) => !o.deleted_at);
    return active.filter((o) => {
      switch (tabKey) {
        case "new":
          return o.status === "processing" && !o.consignment_id && !preOrderOrderIds.has(o.id);
        case "ready":
          return o.status === "ready_to_ship" && !o.consignment_id && !preOrderOrderIds.has(o.id);
        case "pre_order":
          // A pre-order is anything sitting in one of the dedicated pre-order
          // statuses, OR an order containing a product from a configured
          // Pre-Order category that hasn't been dispatched yet. Once
          // dispatched (consignment exists) it leaves the pre-order tab and
          // rejoins the courier flow.
          return (
            ["pre_order_pending","pre_order_making","pre_order_ready"].includes(o.status) ||
            (preOrderOrderIds.has(o.id) && !o.consignment_id && !["completed","cancelled","returned"].includes(o.status))
          );
        case "pickup_pending":
          return !!o.consignment_id && ["Pending","Pickup Pending","Pickup Requested","Assigned for Pickup","Picked","Picked Up","Pickup Cancel","Pickup Cancelled","Pickup Failed"].includes(o.tracking_status || "");
        case "in_transit":
          return !!o.consignment_id && ["At Sorting Hub","In Transit","On the Way To Delivery Hub","At Delivery Hub","Out for Delivery"].includes(o.tracking_status || "");
        case "delivered":
          // Delivered: any order whose internal status is delivered/completed,
          // OR a dispatched parcel whose Pathao tracking reports a delivered state.
          return (
            ["delivered","completed"].includes(o.status) ||
            (!!o.consignment_id && ["Delivered","Partial Delivered","Payment Invoice"].includes(o.tracking_status || ""))
          );
        case "on_hold":
          return !!o.consignment_id && ["On Hold","Hold","Exchange"].includes(o.tracking_status || "");
        case "returned":
          return o.status === "returned" || (!!o.consignment_id && ["Return","Returned","Paid Return","Return Requested","Return In Transit","Returned to Merchant","Merchant Return","Return Delivered","Delivery Failed","Customer Refused"].includes(o.tracking_status || ""));
        default:
          return true;
      }
    });
  }, [orders, preOrderOrderIds]);

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
      else if (courierFilter !== "all" && courierFilter !== "has" && courierFilter !== "none" && (o.tracking_status || "") !== courierFilter) return false;
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, paymentFilter, sourceFilter, storeFilter, deliveryFilter, courierFilter, preOrderStatusFilter, categoryFilter, dateRange, tab]);

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

  const toggleSelect = (id: string) => {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };
  const toggleAll = () => {
    if (selected.size === paginated.length) setSelected(new Set());
    else setSelected(new Set(paginated.map((o) => o.id)));
  };

  /* ─── Tab counts ─── */
  const counts = useMemo(() => ({
    all: orders.filter((o) => !o.deleted_at).length,
    new: getTabOrders("new").length,
    ready: getTabOrders("ready").length,
    pre_order: getTabOrders("pre_order").length,
    pickup_pending: getTabOrders("pickup_pending").length,
    in_transit: getTabOrders("in_transit").length,
    delivered: getTabOrders("delivered").length,
    on_hold: getTabOrders("on_hold").length,
    returned: getTabOrders("returned").length,
    trash: getTabOrders("trash").length,
  }), [orders, getTabOrders]);

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

  const dispatchOrders = useMemo(() =>
    orders.filter((o) => dispatchOrderIds.includes(o.id)),
    [orders, dispatchOrderIds]
  );

  /* ─── Mark Ready to Ship ─── */
  const handleMarkReadyToShip = async () => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const ids = Array.from(selected);
      await supabase.from("orders").update({ status: "ready_to_ship" }).in("id", ids);
      const timelineEntries = ids.map((id) => ({
        order_id: id, event: "status_changed", description: "Marked as Ready to Ship",
      }));
      await addOrderTimeline(timelineEntries);
      await logAction("update", "order_status_bulk", undefined, { ids, to: "ready_to_ship" });
      toast({ title: `${ids.length} order(s) marked Ready to Ship` });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally { setBulkUpdating(false); }
  };

  /* ─── Bulk Mark Completed ─── */
  const handleBulkMarkCompleted = async () => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const ids = Array.from(selected);
      await supabase.from("orders").update({ status: "completed" }).in("id", ids);
      const timelineEntries = ids.map((id) => ({
        order_id: id, event: "status_changed", description: "Marked as Completed",
      }));
      await addOrderTimeline(timelineEntries);
      await logAction("update", "order_status_bulk", undefined, { ids, to: "completed" });
      // Woo notes auto-posted via addOrderTimeline above
      toast({ title: `${ids.length} order(s) marked Completed` });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally { setBulkUpdating(false); }
  };

  /* ─── Bulk Mark Paid ─── */
  const handleBulkMarkPaid = async () => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const ids = Array.from(selected);
      await supabase.from("orders").update({ payment_status: "paid" }).in("id", ids);
      const timelineEntries = ids.map((id) => ({
        order_id: id, event: "payment_updated", description: "Marked as Paid",
      }));
      await addOrderTimeline(timelineEntries);
      await logAction("update", "order_payment_bulk", undefined, { ids, to: "paid" });
      // Woo notes auto-posted via addOrderTimeline above
      toast({ title: `${ids.length} order(s) marked Paid` });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally { setBulkUpdating(false); }
  };

  /* ─── Bulk Cancel ─── */
  const handleBulkCancel = async () => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const ids = Array.from(selected);
      await supabase.from("orders").update({ status: "cancelled" }).in("id", ids);
      const timelineEntries = ids.map((id) => ({
        order_id: id, event: "status_changed", description: "Cancelled",
      }));
      await addOrderTimeline(timelineEntries);
      await logAction("update", "order_status_bulk", undefined, { ids, to: "cancelled" });
      // Woo notes auto-posted via addOrderTimeline above
      toast({ title: `${ids.length} order(s) cancelled` });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally { setBulkUpdating(false); }
  };

  /* ─── Move to Trash ─── */
  const handleTrashOrders = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBulkUpdating(true);
    try {
      const now = new Date().toISOString();
      await supabase.from("orders").update({ deleted_at: now } as any).in("id", ids);
      const timelineEntries = ids.map((id) => ({
        order_id: id, event: "trashed", description: "Order moved to trash",
        // Posted explicitly BEFORE the WC trash call below so it's still attached.
        metadata: { skip_woo_note: true },
      }));
      await addOrderTimeline(timelineEntries);
      const wooOrders = orders.filter((o) => ids.includes(o.id) && o.woo_order_id && o.store_id);
      for (const o of wooOrders) {
        try {
          // Note posted before trash so it's visible in WC even if trashed
          await postWooOrderNote(o.id, "[DokanOS] Order moved to trash");
          await supabase.functions.invoke("woo-push", { body: { action: "trash_order", order_id: o.id } });
        } catch {}
      }
      await logAction("delete", "order_trash_bulk", undefined, { ids });
      toast({ title: `${ids.length} order(s) moved to trash` });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Failed to trash orders", variant: "destructive" });
    } finally { setBulkUpdating(false); }
  };

  /* ─── Restore from Trash ─── */
  const handleRestoreOrders = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBulkUpdating(true);
    try {
      await supabase.from("orders").update({ deleted_at: null } as any).in("id", ids);
      const timelineEntries = ids.map((id) => ({
        order_id: id, event: "restored", description: "Order restored from trash",
      }));
      await addOrderTimeline(timelineEntries);
      await logAction("update", "order_restore_bulk", undefined, { ids });
      toast({ title: `${ids.length} order(s) restored` });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Failed to restore orders", variant: "destructive" });
    } finally { setBulkUpdating(false); }
  };

  /* ─── Bulk Status Change ─── */
  const handleBulkStatusChange = async (newStatus: string) => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const ids = Array.from(selected);
      await supabase.from("orders").update({ status: newStatus }).in("id", ids);
      const label = newStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const timelineEntries = ids.map((id) => ({
        order_id: id, event: "status_changed", description: `Status changed to ${label}`,
      }));
      await addOrderTimeline(timelineEntries);
      await logAction("update", "order_status_bulk", undefined, { ids, to: newStatus });
      toast({ title: `${ids.length} order(s) → ${label}` });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally { setBulkUpdating(false); }
  };

  /* ─── Bulk Print Measurement Slips ─── */
  const handleBulkPrintMeasurementSlips = async () => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const ids = Array.from(selected);
      const { printed, skipped } = await printMeasurementSlipsBulk(ids);
      toast({
        title: `Printed ${printed} measurement slip(s)`,
        description: skipped > 0 ? `${skipped} order(s) skipped — no measurements recorded.` : undefined,
      });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Print failed", variant: "destructive" });
    } finally { setBulkUpdating(false); }
  };

  /* ─── Bulk Track Selected ─── */
  const handleBulkTrackSelected = async () => {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const selectedWithConsignment = orders.filter((o) => selected.has(o.id) && o.consignment_id);
      let updated = 0;
      for (const o of selectedWithConsignment) {
        try {
          const { data } = await supabase.functions.invoke("pathao-courier", { body: { action: "track_order", consignment_id: o.consignment_id } });
          if (data?.data?.order_status) updated++;
        } catch {}
      }
      toast({ title: `Tracking updated for ${updated} of ${selectedWithConsignment.length} order(s)` });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Tracking failed", variant: "destructive" });
    } finally { setBulkUpdating(false); }
  };

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
      const { data, error } = await supabase.functions.invoke("pathao-track");
      if (error) throw error;
      toast({ title: "Tracking updated", description: `Checked ${data?.data?.total || 0}, updated ${data?.data?.updated || 0}` });
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
    const [orderRes, itemsRes, paymentsRes] = await Promise.all([
      supabase.from("orders").select("id, order_number, total, subtotal, discount, shipping_cost, notes, customer_name, customer_phone, customer_address, customer_city").eq("id", orderId).single(),
      supabase.from("order_items").select("*").eq("order_id", orderId),
      supabase.from("order_payments").select("*").eq("order_id", orderId),
    ]);
    const o = orderRes.data as any;
    if (!o) return;
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{preOrderMode ? "Pre-Orders" : "Orders"}</h1>
          <p className="text-sm text-muted-foreground">
            {preOrderMode
              ? "Orders containing products from configured Pre-Order categories"
              : "Manage your order pipeline — from new orders to delivery"}
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
          {!preOrderMode && ["pickup_pending", "in_transit", "on_hold", "returned"].includes(tab) && (
            <Button variant="outline" size="sm" onClick={handleTrackAll} disabled={trackingLoading}>
              {trackingLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Update Tracking
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

      {/* Action Bar — shown when any orders are selected */}
      {hasSelection && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <CheckSquare className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium">{selected.size} order{selected.size > 1 ? "s" : ""} selected</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {canWrite && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={bulkUpdating} className="gap-1.5">
                    <Package className="h-4 w-4" /> Change Status
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("processing")}><Package className="h-4 w-4 mr-2" /> Processing</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("pre_order_pending")}><Hourglass className="h-4 w-4 mr-2" /> Pre-Order</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("pre_order_making")}><Wrench className="h-4 w-4 mr-2" /> Making</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("pre_order_ready")}><Sparkles className="h-4 w-4 mr-2" /> Pre-Order Ready</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("ready_to_ship")}><PackageCheck className="h-4 w-4 mr-2" /> Ready to Ship</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("shipped")}><Truck className="h-4 w-4 mr-2" /> Shipped</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("delivered")}><CheckCircle2 className="h-4 w-4 mr-2" /> Delivered</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("completed")}><BadgeCheck className="h-4 w-4 mr-2" /> Completed</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("returned")}><Undo2 className="h-4 w-4 mr-2" /> Returned</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatusChange("cancelled")} className="text-destructive"><XCircle className="h-4 w-4 mr-2" /> Cancelled</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <PickupSlipPrint orders={selectedOrders} />
            {canWrite && (
              <Button size="sm" variant="outline" onClick={handleBulkPrintMeasurementSlips} disabled={bulkUpdating} className="gap-1.5">
                {bulkUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ruler className="h-4 w-4" />}
                Print Measurement Slips
              </Button>
            )}
            {canWrite && (
              <Button size="sm" onClick={() => openDispatch(Array.from(selected))} className="gap-1.5">
                <Send className="h-4 w-4" /> Dispatch
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleBulkTrackSelected} disabled={bulkUpdating} className="gap-1.5">
              {bulkUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Track
            </Button>
            {canWrite && (
              <Button size="sm" variant="outline" onClick={handleBulkMarkPaid} disabled={bulkUpdating} className="gap-1.5">
                {bulkUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                Mark Paid
              </Button>
            )}
            {canWrite && tab === "trash" && (
              <Button size="sm" variant="outline" onClick={() => handleRestoreOrders(Array.from(selected))} disabled={bulkUpdating} className="gap-1.5">
                <RotateCcw className="h-4 w-4" /> Restore
              </Button>
            )}
            {canWrite && tab !== "trash" && (
              <Button size="sm" variant="outline" onClick={() => { setPendingTrashIds(Array.from(selected)); setTrashConfirmOpen(true); }} disabled={bulkUpdating} className="gap-1.5 text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" /> Trash
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        {!preOrderMode && (() => {
          const tabItems: { key: TabKey; label: string; icon: any; count: number }[] = [
            { key: "all", label: "All", icon: ShoppingCart, count: counts.all },
            { key: "new", label: "New", icon: Package, count: counts.new },
            { key: "ready", label: "Ready", icon: PackageCheck, count: counts.ready },
            { key: "pre_order", label: "Pre-Order", icon: Hourglass, count: counts.pre_order },
            { key: "pickup_pending", label: "Pickup", icon: Clock, count: counts.pickup_pending },
            { key: "in_transit", label: "Transit", icon: Truck, count: counts.in_transit },
            { key: "delivered", label: "Delivered", icon: CheckCircle2, count: counts.delivered },
            { key: "on_hold", label: "On Hold", icon: AlertTriangle, count: counts.on_hold },
            { key: "returned", label: "Returned", icon: Undo2, count: counts.returned },
            ...(counts.trash > 0 ? [{ key: "trash" as TabKey, label: "Trash", icon: Trash2, count: counts.trash }] : []),
          ];
          return (
            <>
              {/* Desktop: standard tabs */}
              <div className="hidden md:block overflow-x-auto">
                <TabsList className="inline-flex w-auto min-w-full">
                  {tabItems.map((t) => (
                    <TabsTrigger key={t.key} value={t.key} className="gap-1.5 text-xs">
                      <t.icon className="h-3.5 w-3.5" />{t.label} ({t.count})
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              {/* Mobile: scrollable pill bar */}
              <div className="md:hidden -mx-4 px-4 overflow-x-auto scrollbar-none">
                <div className="flex gap-2 w-max pb-1">
                  {tabItems.map((t) => {
                    const active = tab === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={cn(
                          "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-border hover:bg-accent"
                        )}
                      >
                        <t.icon className="h-3.5 w-3.5" />
                        {t.label}
                        <span className={cn(
                          "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                          active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
                        )}>{t.count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          );
        })()}
        {/* Search bar + filter toggle (always visible) */}
        <div className="flex items-center gap-2 mt-4">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order #, name, phone..." className="pl-9" />
          </div>
          <Button
            variant="outline"
            size="default"
            onClick={() => setFiltersOpen((o) => !o)}
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
            <Button variant="ghost" size="sm" onClick={clearAllFilters} className="shrink-0 text-muted-foreground hover:text-foreground gap-1">
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          )}
        </div>

        {/* Collapsible filters */}
        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
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
                  <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              {!preOrderMode && (
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="processing">New Order</SelectItem>
                    <SelectItem value="pre_order_pending">Pre-Order</SelectItem>
                    <SelectItem value="pre_order_making">Making</SelectItem>
                    <SelectItem value="pre_order_ready">Pre-Order Ready</SelectItem>
                    <SelectItem value="ready_to_ship">Ready to Ship</SelectItem>
                    <SelectItem value="shipped">Shipped</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="returned">Returned</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Select value={preOrderStatusFilter} onValueChange={(v) => setPreOrderStatusFilter(v as any)}>
                <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Pre-Order Stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Pre-Order Stages</SelectItem>
                  <SelectItem value="pre_order_pending">Pre-Order (New)</SelectItem>
                  <SelectItem value="pre_order_making">Making</SelectItem>
                  <SelectItem value="pre_order_ready">Pre-Order Ready</SelectItem>
                </SelectContent>
              </Select>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Payment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Payment</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="cod">COD</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="pos">POS</SelectItem>
                </SelectContent>
              </Select>
              <Select value={deliveryFilter} onValueChange={setDeliveryFilter}>
                <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Delivery" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Delivery</SelectItem>
                  <SelectItem value="walkin">Walk-in</SelectItem>
                  <SelectItem value="pickup">Pickup</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                </SelectContent>
              </Select>
              <Select value={courierFilter} onValueChange={setCourierFilter}>
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
              <Select value={storeFilter} onValueChange={setStoreFilter}>
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
                onChange={setCategoryFilter}
                size="sm"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* ── Shared Table ── */}
        {paginated.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <>
          {/* Mobile cards */}
          <div className="md:hidden mt-4 space-y-2">
            {paginated.map((order) => {
              const menu = (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9"><MoreHorizontal className="h-5 w-5" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setDetailOrderId(order.id)}>View Details</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleReprintOrder(order.id)}>
                      <Printer className="h-4 w-4 mr-2" /> Print Invoice
                    </DropdownMenuItem>
                    {order.status === "processing" && !order.consignment_id && canWrite && (
                      <DropdownMenuItem onClick={() => {
                        supabase.from("orders").update({ status: "ready_to_ship" }).eq("id", order.id).then(() => {
                          addOrderTimeline({ order_id: order.id, event: "status_changed", description: "Marked as Ready to Ship" });
                          toast({ title: "Marked Ready to Ship" });
                          loadOrders();
                        });
                      }}>
                        <PackageCheck className="h-4 w-4 mr-2" /> Mark Ready to Ship
                      </DropdownMenuItem>
                    )}
                    {order.status === "ready_to_ship" && !order.consignment_id && canWrite && (
                      <DropdownMenuItem onClick={() => openDispatch([order.id])}>
                        <Send className="h-4 w-4 mr-2" /> Dispatch to Pathao
                      </DropdownMenuItem>
                    )}
                    {order.consignment_id && (
                      <DropdownMenuItem onClick={() => handleTrackOne(order.consignment_id!)}>
                        <RefreshCw className="h-4 w-4 mr-2" /> Refresh Tracking
                      </DropdownMenuItem>
                    )}
                    {canWrite && tab === "trash" && (
                      <DropdownMenuItem onClick={() => handleRestoreOrders([order.id])}>
                        <RotateCcw className="h-4 w-4 mr-2" /> Restore
                      </DropdownMenuItem>
                    )}
                    {canWrite && tab !== "trash" && (
                      <DropdownMenuItem onClick={() => { setPendingTrashIds([order.id]); setTrashConfirmOpen(true); }} className="text-destructive focus:text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" /> Move to Trash
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
              return (
                <OrderCard
                  key={order.id}
                  order={order}
                  selected={selected.has(order.id)}
                  onSelect={() => toggleSelect(order.id)}
                  onOpen={() => setDetailOrderId(order.id)}
                  actions={menu}
                />
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block rounded-lg border border-border overflow-hidden mt-4">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary hover:bg-secondary">
                  <TableHead className="w-10"><Checkbox checked={paginated.length > 0 && selected.size === paginated.length} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead>Order Info</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead className="w-[240px]">Products</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((order) => (
                  <TableRow key={order.id} className={cn("virtual-row-tall group", selected.has(order.id) && "bg-primary/5")}>
                    <TableCell><Checkbox checked={selected.has(order.id)} onCheckedChange={() => toggleSelect(order.id)} /></TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">#{order.order_number}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(order.created_at), "MMM d, yyyy · h:mm a")}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{order.customer_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{order.customer_phone || "—"}</div>
                      {(tab === "ready" || tab === "new") && order.customer_address && (
                        <div className="text-xs text-muted-foreground max-w-[180px] truncate mt-0.5">{order.customer_address}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-foreground">{order.stores?.name || (order.source === "pos" ? "POS" : "—")}</span>
                    </TableCell>
                    <TableCell>
                      <ProductsList items={order.productItems} />
                    </TableCell>
                    <TableCell><SourceBadge source={order.source} storeName={order.stores?.name} /></TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium text-foreground">৳{Number(order.total).toLocaleString()}</div>
                      {order.payment_status !== "paid" && (order.amount_to_collect ?? 0) > 0 && (
                        <div className="text-xs text-amber-400">Due: ৳{Number(order.amount_to_collect).toLocaleString()}</div>
                      )}
                      <div className="mt-0.5"><PaymentBadge status={order.payment_status} /></div>
                    </TableCell>
                    <TableCell>
                      <DeliveryBadge type={order.fulfillment_type} />
                    </TableCell>
                    <TableCell>
                      <FulfillmentBadge status={order.status} />
                    </TableCell>
                    <TableCell>
                      {order.consignment_id ? (
                        <div className="space-y-1">
                          <a href={`https://merchant.pathao.com/tracking?consignment_id=${order.consignment_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            {order.consignment_id}<ExternalLink className="h-3 w-3" />
                          </a>
                          <div><TrackingBadge status={order.tracking_status} /></div>
                        </div>
                      ) : <span className="text-xs text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDetailOrderId(order.id)}>View Details</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleReprintOrder(order.id)}>
                            <Printer className="h-4 w-4 mr-2" /> Print Invoice
                          </DropdownMenuItem>
                          {order.status === "processing" && !order.consignment_id && canWrite && (
                            <DropdownMenuItem onClick={() => {
                              supabase.from("orders").update({ status: "ready_to_ship" }).eq("id", order.id).then(() => {
                                addOrderTimeline({ order_id: order.id, event: "status_changed", description: "Marked as Ready to Ship" });
                                toast({ title: "Marked Ready to Ship" });
                                loadOrders();
                              });
                            }}>
                              <PackageCheck className="h-4 w-4 mr-2" /> Mark Ready to Ship
                            </DropdownMenuItem>
                          )}
                          {order.status === "ready_to_ship" && !order.consignment_id && canWrite && (
                            <DropdownMenuItem onClick={() => openDispatch([order.id])}>
                              <Send className="h-4 w-4 mr-2" /> Dispatch to Pathao
                            </DropdownMenuItem>
                          )}
                          {order.consignment_id && (
                            <DropdownMenuItem onClick={() => handleTrackOne(order.consignment_id!)}>
                              <RefreshCw className="h-4 w-4 mr-2" /> Refresh Tracking
                            </DropdownMenuItem>
                          )}
                          {canWrite && tab === "trash" && (
                            <DropdownMenuItem onClick={() => handleRestoreOrders([order.id])}>
                              <RotateCcw className="h-4 w-4 mr-2" /> Restore
                            </DropdownMenuItem>
                          )}
                          {canWrite && tab !== "trash" && (
                            <DropdownMenuItem onClick={() => { setPendingTrashIds([order.id]); setTrashConfirmOpen(true); }} className="text-destructive focus:text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" /> Move to Trash
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
      />

      <AddOrderDialog
        open={addOrderOpen}
        onOpenChange={setAddOrderOpen}
        onCreated={loadOrders}
      />

      <ConfirmDialog
        open={trashConfirmOpen}
        onOpenChange={setTrashConfirmOpen}
        title="Move to Trash?"
        description={`${pendingTrashIds.length} order(s) will be moved to trash and automatically deleted after 15 days.${orders.some((o) => pendingTrashIds.includes(o.id) && o.woo_order_id) ? " WooCommerce orders will also be trashed on the store." : ""}`}
        confirmLabel="Move to Trash"
        variant="destructive"
        onConfirm={() => { handleTrashOrders(pendingTrashIds); setTrashConfirmOpen(false); }}
      />
    </div>
  );
};

/* ─── Empty State ─── */
function EmptyState({ tab }: { tab: TabKey }) {
  const configs: Record<TabKey, { icon: any; text: string }> = {
    all: { icon: ShoppingCart, text: "No orders found" },
    new: { icon: Package, text: "No new orders to process" },
    ready: { icon: PackageCheck, text: "No orders ready to ship — mark orders as Ready from the New Orders tab" },
    pre_order: { icon: Hourglass, text: "No pre-orders — orders containing products from configured Pre-Order categories will appear here" },
    pickup_pending: { icon: Clock, text: "No orders waiting for pickup" },
    in_transit: { icon: Truck, text: "No orders in transit" },
    delivered: { icon: CheckCircle2, text: "No delivered orders" },
    on_hold: { icon: AlertTriangle, text: "No orders on hold" },
    returned: { icon: Undo2, text: "No returned orders" },
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

/* ─── Products List ─── */
function ProductsList({ items }: { items: { name: string; qty: number }[] }) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground italic">—</span>;
  return (
    <div className="max-w-[240px]">
      <div className="space-y-0.5">
        {items.slice(0, 3).map((p, i) => (
          <div key={i} className="text-xs leading-4 break-words whitespace-normal">
            <span className="text-muted-foreground">×{p.qty}</span>{" "}<span>{p.name}</span>
          </div>
        ))}
        {items.length > 3 && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-[11px] text-primary hover:underline cursor-pointer">+{items.length - 3} more</button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" align="start">
              <p className="text-xs font-medium text-muted-foreground mb-2">All items ({items.length})</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {items.map((p, i) => (
                  <div key={i} className="text-xs leading-4"><span className="text-muted-foreground">×{p.qty}</span>{" "}<span>{p.name}</span></div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
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
