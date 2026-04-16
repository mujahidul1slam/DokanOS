import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import {
  Search, ExternalLink, MoreHorizontal, Send, CalendarIcon,
  RefreshCw, Loader2, MapPin, Package, Truck, ShoppingCart, CheckSquare,
  PackageCheck, Clock, AlertTriangle, CheckCircle2, Undo2, XCircle, CreditCard, BadgeCheck, Printer, Plus,
  Trash2, RotateCcw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { DateRange } from "react-day-picker";
import OrderDetailSheet from "@/components/orders/OrderDetailSheet";
import AddOrderDialog from "@/components/orders/AddOrderDialog";
import DispatchDialog from "@/components/orders/DispatchDialog";
import PickupSlipPrint from "@/components/orders/PickupSlipPrint";
import {
  SourceBadge, PaymentBadge, FulfillmentBadge, TrackingBadge, DeliveryBadge,
} from "@/components/orders/OrderBadges";
import { TableSkeleton } from "@/components/ui/loading-states";
import ConfirmDialog from "@/components/ConfirmDialog";
import { printInvoice } from "@/components/pos/InvoicePrint";
import { useInvoiceSettings } from "@/hooks/useInvoiceSettings";

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
  customers: { name: string; phone: string | null; address: string | null; city: string | null; zone: string | null; area: string | null } | null;
  stores: { name: string } | null;
  itemCount: number;
  productItems: { name: string; qty: number }[];
}

interface StoreOption { id: string; name: string }

const PAGE_SIZE = 20;

type TabKey = "all" | "new" | "ready" | "pickup_pending" | "in_transit" | "delivered" | "on_hold" | "trash";

const Orders = () => {
  const { role } = useAuth();
  const { settings: invoiceSettings } = useInvoiceSettings();
  const canWrite = role === "admin" || role === "staff";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [deliveryFilter, setDeliveryFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("new");
  const [stores, setStores] = useState<StoreOption[]>([]);

  // Dispatch
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [dispatchOrderIds, setDispatchOrderIds] = useState<string[]>([]);
  // Add Order
  const [addOrderOpen, setAddOrderOpen] = useState(false);

  // Tracking
  const [trackingLoading, setTrackingLoading] = useState(false);

  // Bulk actions
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const { toast } = useToast();

  const loadOrders = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, total, status, source, payment_method, payment_status, consignment_id, tracking_status, fulfillment_type, created_at, deleted_at, store_id, woo_order_id, amount_to_collect, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, pathao_store_id, item_weight, special_instruction, customers(name, phone, address, city, zone, area), stores(name), order_items(id, product_name, quantity)")
      .order("created_at", { ascending: false });

    const mapped = (data || []).map((o: any) => ({
      ...o,
      itemCount: o.order_items?.length || 0,
      productItems: (o.order_items || [])
        .filter((i: any) => i.product_name)
        .map((i: any) => ({ name: i.product_name, qty: i.quantity || 1 })),
    }));
    setOrders(mapped as OrderRow[]);
    setLoading(false);
  }, []);

  const loadStores = useCallback(async () => {
    const { data } = await supabase.from("stores").select("id, name").order("name");
    setStores(data || []);
  }, []);

  useEffect(() => { loadOrders(); loadStores(); }, [loadOrders, loadStores]);

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
          return o.status === "processing" && !o.consignment_id;
        case "ready":
          return o.status === "ready_to_ship" && !o.consignment_id;
        case "pickup_pending":
          return !!o.consignment_id && ["Pending", "Pickup Pending"].includes(o.tracking_status || "");
        case "in_transit":
          return !!o.consignment_id && ["Picked", "Assigned for Pickup", "Picked Up", "At Sorting Hub", "In Transit", "Out for Delivery"].includes(o.tracking_status || "");
        case "delivered":
          return !!o.consignment_id && ["Delivered", "Partial Delivered"].includes(o.tracking_status || "");
        case "on_hold":
          return !!o.consignment_id && ["On Hold", "Return", "Returned", "Exchange", "Cancelled", "Pickup Cancel", "Payment Invoice"].includes(o.tracking_status || "");
        default:
          return true;
      }
    });
  }, [orders]);

  const filtered = useMemo(() => {
    const tabOrders = getTabOrders(tab);
    return tabOrders.filter((o) => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        o.order_number.toLowerCase().includes(q) ||
        (o.customers?.name || "").toLowerCase().includes(q) ||
        (o.customers?.phone || "").toLowerCase().includes(q);
      const matchStatus = tab !== "all" || statusFilter === "all" || o.status === statusFilter;
      const matchPayment = paymentFilter === "all" || o.payment_status === paymentFilter;
      const matchSource = sourceFilter === "all" || o.source === sourceFilter;
      const matchStore = storeFilter === "all" || o.store_id === storeFilter;
      const matchDelivery = deliveryFilter === "all" || o.fulfillment_type === deliveryFilter;
      let matchDate = true;
      if (dateRange?.from) {
        const d = new Date(o.created_at);
        matchDate = d >= dateRange.from;
        if (dateRange.to) {
          const end = new Date(dateRange.to);
          end.setHours(23, 59, 59, 999);
          matchDate = matchDate && d <= end;
        }
      }
      return matchSearch && matchStatus && matchPayment && matchSource && matchStore && matchDate && matchDelivery;
    });
  }, [orders, search, statusFilter, paymentFilter, sourceFilter, storeFilter, deliveryFilter, dateRange, tab, getTabOrders]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, statusFilter, paymentFilter, sourceFilter, storeFilter, deliveryFilter, dateRange, tab]);
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
    pickup_pending: getTabOrders("pickup_pending").length,
    in_transit: getTabOrders("in_transit").length,
    delivered: getTabOrders("delivered").length,
    on_hold: getTabOrders("on_hold").length,
    trash: getTabOrders("trash").length,
  }), [orders, getTabOrders]);

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
      await supabase.from("order_timeline").insert(timelineEntries);
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
      await supabase.from("order_timeline").insert(timelineEntries);
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
      await supabase.from("order_timeline").insert(timelineEntries);
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
      await supabase.from("order_timeline").insert(timelineEntries);
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
      }));
      await supabase.from("order_timeline").insert(timelineEntries);
      const wooOrders = orders.filter((o) => ids.includes(o.id) && o.woo_order_id && o.store_id);
      for (const o of wooOrders) {
        try {
          await supabase.functions.invoke("woo-push", { body: { action: "trash_order", order_id: o.id } });
        } catch {}
      }
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
      await supabase.from("order_timeline").insert(timelineEntries);
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
      await supabase.from("order_timeline").insert(timelineEntries);
      toast({ title: `${ids.length} order(s) → ${label}` });
      setSelected(new Set());
      loadOrders();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
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
      supabase.from("orders").select("id, order_number, total, subtotal, discount, shipping_cost, notes, customer_id").eq("id", orderId).single(),
      supabase.from("order_items").select("*").eq("order_id", orderId),
      supabase.from("order_payments").select("*").eq("order_id", orderId),
    ]);
    const o = orderRes.data as any;
    if (!o) return;
    let customer = null;
    if (o.customer_id) {
      const { data: c } = await supabase.from("customers").select("name, phone, address, city, zone").eq("id", o.customer_id).single();
      if (c) customer = { name: c.name, phone: c.phone || "", address: c.address || "", city: c.city || "", zone: c.zone || "" };
    }
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
          <h1 className="font-heading text-2xl font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">Manage your order pipeline — from new orders to delivery</p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <Button size="sm" onClick={() => setAddOrderOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Order
            </Button>
          )}
          {["pickup_pending", "in_transit", "on_hold"].includes(tab) && (
            <Button variant="outline" size="sm" onClick={handleTrackAll} disabled={trackingLoading}>
              {trackingLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Update Tracking
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><MapPin className="h-4 w-4 mr-1" /> Pathao</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={syncPathaoStores}><RefreshCw className="h-4 w-4 mr-2" /> Sync Stores</DropdownMenuItem>
              <DropdownMenuItem onClick={syncCities}><MapPin className="h-4 w-4 mr-2" /> Sync Locations</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
              <Button size="sm" variant="outline" onClick={() => handleTrashOrders(Array.from(selected))} disabled={bulkUpdating} className="gap-1.5 text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" /> Trash
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-auto min-w-full">
            <TabsTrigger value="all" className="gap-1.5 text-xs"><ShoppingCart className="h-3.5 w-3.5" />All ({counts.all})</TabsTrigger>
            <TabsTrigger value="new" className="gap-1.5 text-xs"><Package className="h-3.5 w-3.5" />New Orders ({counts.new})</TabsTrigger>
            <TabsTrigger value="ready" className="gap-1.5 text-xs"><PackageCheck className="h-3.5 w-3.5" />Ready to Ship ({counts.ready})</TabsTrigger>
            <TabsTrigger value="pickup_pending" className="gap-1.5 text-xs"><Clock className="h-3.5 w-3.5" />Pickup Pending ({counts.pickup_pending})</TabsTrigger>
            <TabsTrigger value="in_transit" className="gap-1.5 text-xs"><Truck className="h-3.5 w-3.5" />In Transit ({counts.in_transit})</TabsTrigger>
            <TabsTrigger value="delivered" className="gap-1.5 text-xs"><CheckCircle2 className="h-3.5 w-3.5" />Delivered ({counts.delivered})</TabsTrigger>
            <TabsTrigger value="on_hold" className="gap-1.5 text-xs"><AlertTriangle className="h-3.5 w-3.5" />On Hold / Return ({counts.on_hold})</TabsTrigger>
            {counts.trash > 0 && <TabsTrigger value="trash" className="gap-1.5 text-xs"><Trash2 className="h-3.5 w-3.5" />Trash ({counts.trash})</TabsTrigger>}
          </TabsList>
        </div>

        {/* Search & Filters — shared across all tabs */}
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order #, name, or phone..." className="pl-9" />
          </div>
          {tab === "all" && (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("gap-2 text-sm font-normal", !dateRange?.from && "text-muted-foreground")}>
                    <CalendarIcon className="h-4 w-4" />
                    {dateRange?.from ? (dateRange.to ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}` : format(dateRange.from, "MMM d, yyyy")) : "Date Range"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="processing">New Order</SelectItem>
                  <SelectItem value="ready_to_ship">Ready to Ship</SelectItem>
                  <SelectItem value="shipped">Shipped</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="returned">Returned</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="Payment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Payment</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="cod">COD</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-[130px]"><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="pos">POS</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          <Select value={deliveryFilter} onValueChange={setDeliveryFilter}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Delivery" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Delivery</SelectItem>
              <SelectItem value="walkin">Walk-in</SelectItem>
              <SelectItem value="pickup">Pickup</SelectItem>
              <SelectItem value="delivery">Delivery</SelectItem>
            </SelectContent>
          </Select>
          <Select value={storeFilter} onValueChange={setStoreFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Store" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* ── Shared Table ── */}
        {paginated.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="rounded-lg border border-border overflow-hidden mt-4">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary hover:bg-secondary">
                  <TableHead className="w-10"><Checkbox checked={paginated.length > 0 && selected.size === paginated.length} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead>Order Info</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="w-[240px]">Products</TableHead>
                  {tab === "all" && <TableHead>Source</TableHead>}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Status</TableHead>
                  {["pickup_pending", "in_transit", "on_hold", "all"].includes(tab) && (
                    <TableHead>Courier</TableHead>
                  )}
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((order) => (
                  <TableRow key={order.id} className={cn("group", selected.has(order.id) && "bg-primary/5")}>
                    <TableCell><Checkbox checked={selected.has(order.id)} onCheckedChange={() => toggleSelect(order.id)} /></TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">#{order.order_number}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(order.created_at), "MMM d, yyyy · h:mm a")}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{order.customers?.name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{order.customers?.phone || "—"}</div>
                      {(tab === "ready" || tab === "new") && order.customers?.address && (
                        <div className="text-xs text-muted-foreground max-w-[180px] truncate mt-0.5">{order.customers.address}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <ProductsList items={order.productItems} />
                    </TableCell>
                    {tab === "all" && <TableCell><SourceBadge source={order.source} /></TableCell>}
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
                    {["pickup_pending", "in_transit", "on_hold", "all"].includes(tab) && (
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
                    )}
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
                                supabase.from("order_timeline").insert({ order_id: order.id, event: "status_changed", description: "Marked as Ready to Ship" });
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
                            <DropdownMenuItem onClick={() => handleTrashOrders([order.id])} className="text-destructive focus:text-destructive">
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
        )}

        <Pagination page={page} totalPages={totalPages} filtered={filtered} setPage={setPage} />
      </Tabs>

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
    </div>
  );
};

/* ─── Empty State ─── */
function EmptyState({ tab }: { tab: TabKey }) {
  const configs: Record<TabKey, { icon: any; text: string }> = {
    all: { icon: ShoppingCart, text: "No orders found" },
    new: { icon: Package, text: "No new orders to process" },
    ready: { icon: PackageCheck, text: "No orders ready to ship — mark orders as Ready from the New Orders tab" },
    pickup_pending: { icon: Clock, text: "No orders waiting for pickup" },
    in_transit: { icon: Truck, text: "No orders in transit" },
    delivered: { icon: CheckCircle2, text: "No delivered orders" },
    on_hold: { icon: AlertTriangle, text: "No orders on hold or returned" },
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
