import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import {
  Search, ExternalLink, MoreHorizontal, Send, CalendarIcon,
  RefreshCw, Loader2, MapPin, Package, Truck, ShoppingCart, CheckSquare,
  PackageCheck, Clock, AlertTriangle, CheckCircle2, Undo2, XCircle, CreditCard, BadgeCheck, Printer, Plus,
  Trash2, RotateCcw, Hourglass, Tags, Ruler, Sparkles, Wrench, SlidersHorizontal, ChevronDown, X, Pencil,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import ExchangeDialog from "@/components/orders/ExchangeDialog";
import PickupSlipPrint from "@/components/orders/PickupSlipPrint";
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
import { matchesTab as matchesTabExt, ALL_TAB_KEYS, type TabKey } from "./orders/tabFilters";
import { useOrderBulkActions } from "./orders/useOrderBulkActions";

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
  pickup_slip_printed_at: string | null;
  measurement_slip_printed_at: string | null;
  stores: { name: string } | null;
  itemCount: number;
  productItems: { name: string; qty: number }[];
  isPreOrder: boolean;
}

interface StoreOption { id: string; name: string }

const PAGE_SIZE = 200;

// TabKey moved to ./orders/tabFilters

interface OrdersProps { preOrderMode?: boolean }

const Orders = ({ preOrderMode = false }: OrdersProps) => {
  const { role } = useAuth();
  const { settings: invoiceSettings } = useInvoiceSettings();
  const canWrite = role === "admin" || role === "staff";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderCategoryMap, setOrderCategoryMap] = useState<Map<string, Set<string>>>(new Map());
  const [allCategories, setAllCategories] = useState<{ id: string; name: string; parent_id: string | null; store_id: string | null }[]>([]);
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
  // Exchange parcel
  const [exchangeOpen, setExchangeOpen] = useState(false);

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

  const loadOrders = useCallback(async () => {
    const { data } = await supabase
        .from("orders")
        .select("id, order_number, total, status, source, payment_method, payment_status, consignment_id, tracking_status, fulfillment_type, created_at, deleted_at, store_id, woo_order_id, customer_id, amount_to_collect, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, pathao_store_id, item_weight, special_instruction, customer_name, customer_phone, customer_address, customer_city, customer_email, pickup_slip_printed_at, measurement_slip_printed_at, stores(name), order_items(id, product_id, product_name, quantity, products(stock_status))")
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
      supabase.from("categories").select("id, name, parent_id, store_id").order("name"),
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
        .in("id", ids);
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

  const dispatchOrders = useMemo(() =>
    orders.filter((o) => dispatchOrderIds.includes(o.id)),
    [orders, dispatchOrderIds]
  );

  /* ─── Mark Ready to Ship ─── */
  const {
    handleMarkReadyToShip,
    handleBulkMarkCompleted,
    handleBulkMarkPaid,
    handleConfirmBulkDuePayment,
    handleBulkCancel,
    handleBulkStatusChange,
    handleTrashOrders,
    handleRestoreOrders,
    handleBulkPrintMeasurementSlips,
    handleBulkTrackSelected,
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
    if ((tab === "new" || tab === "all") && order.status === "processing" && !order.consignment_id && canWrite) {
      actions.push({
        key: "ready", label: "Mark Ready to Ship", icon: PackageCheck,
        onClick: () => {
          supabase.from("orders").update({ status: "ready_to_ship" }).eq("id", order.id).then(() => {
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
    <OrderRowActions actions={getQuickActions(order)} max={max} />
  );

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
      <OrderBulkActionsBar
        selectedCount={selected.size}
        selectedOrders={selectedOrders}
        selectedIds={Array.from(selected)}
        bulkUpdating={bulkUpdating}
        canWrite={canWrite}
        tab={tab}
        onBulkStatusChange={handleBulkStatusChange}
        onBulkPrintMeasurementSlips={handleBulkPrintMeasurementSlips}
        onDispatch={() => openDispatch(Array.from(selected))}
        onBulkTrack={handleBulkTrackSelected}
        onBulkMarkPaid={handleBulkMarkPaid}
        onRestore={() => handleRestoreOrders(Array.from(selected))}
        onTrash={() => { setPendingTrashIds(Array.from(selected)); setTrashConfirmOpen(true); }}
        onClear={() => setSelected(new Set())}
      />

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <OrderTabs tab={tab} onChange={setTab} counts={counts} preOrderMode={preOrderMode} />

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


        {/* ── Shared Table ── */}
        {paginated.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <>
          {/* Mobile & Tablet cards */}
          <div className="xl:hidden mt-4 space-y-2">
            {paginated.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                selected={selected.has(order.id)}
                onSelect={() => toggleSelect(order.id)}
                onOpen={() => setDetailOrderId(order.id)}
                actions={renderActionButtons(order, 2)}
              />
            ))}
          </div>

          <OrderTable
            orders={paginated}
            selected={selected}
            tab={tab}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
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
        description={`${pendingTrashIds.length} order(s) will be moved to trash and automatically deleted after 15 days.${orders.some((o) => pendingTrashIds.includes(o.id) && o.woo_order_id) ? " WooCommerce orders will also be trashed on the store." : ""}`}
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
    pre_order_pending: { icon: Clock, text: "No pending pre-orders" },
    pre_order_making: { icon: Wrench, text: "No pre-orders currently being made" },
    pre_order_ready: { icon: Sparkles, text: "No pre-orders ready for delivery" },
    pickup_pending: { icon: Clock, text: "No orders waiting for pickup" },
    in_transit: { icon: Truck, text: "No orders in transit" },
    delivered: { icon: CheckCircle2, text: "No delivered orders" },
    on_hold: { icon: AlertTriangle, text: "No orders on hold" },
    returned: { icon: Undo2, text: "No returned orders" },
    cancelled: { icon: XCircle, text: "No cancelled orders — WooCommerce cancellations and Pathao pickup-cancel parcels appear here" },
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
