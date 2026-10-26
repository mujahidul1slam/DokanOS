import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { format } from "date-fns";
import { X, Trash2, Plus, ExternalLink, CircleDot, Undo2, Ruler, Printer, CheckCircle2, RefreshCw, Link2, Truck, Copy, AlertTriangle, Loader2, Scissors } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAction } from "@/lib/auditLog";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { printMeasurementSlip } from "./MeasurementSlipPrint";
import { detectSizeFromItem, getGroupsForProduct, resolveSizePreset } from "@/lib/measurements";
import { postWooOrderNote } from "@/lib/wooNotes";
import { kickSyncWorker } from "@/lib/wooNotes";
import { SourceBadge } from "./OrderBadges";
import { evaluatePaymentGate, PAYMENT_NEEDS_CONFIRMATION_LABEL } from "@/lib/paymentGate";
import { usePermissions } from "@/hooks/usePermissions";
import { isOrderPreOrderByProducts } from "@/lib/preOrderSettings";
import { getGlobalStockEnabled } from "@/lib/stockSettings";
import ExchangeDialog from "./ExchangeDialog";
import SplitOrderDialog from "./SplitOrderDialog";
import AttachParcelDialog from "./AttachParcelDialog";
import ProductVariationPicker, { type PickableVariation, type VariationPick } from "./ProductVariationPicker";
import { getProductVariations } from "@/lib/variations";
import { fetchAllRows } from "@/lib/supabasePage";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { deriveBrandForStore } from "@/lib/brandIdentity";
import {
  consignmentAccountConflict,
  describeIdentityChange,
  identityChangeBlocked,
  identityChanged,
  legacyStoreIdFor,
  resolveSellingPoint,
  sellingPointsForBrand,
  SELLING_POINT_CONFIGURE_HINT,
  type IdentityBrand,
  type IdentitySnapshot,
  type IdentitySellingPoint,
} from "@/lib/orderIdentity";
import {
  pathaoAccountKey,
  resolveDefaultAccount,
  type PathaoAccountOption,
  type PathaoStoreLinkRow,
} from "@/lib/dispatchAccounts";
import { fetchPathaoAccountData } from "@/lib/dispatchAccountsData";

import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCurrency } from "@/hooks/useCurrency";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OrderDetail {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  source: string;
  subtotal: number;
  discount: number | null;
  shipping_cost: number | null;
  total: number;
  tax_amount: number | null;
  amount_to_collect: number | null;
  notes: string | null;
  consignment_id: string | null;
  tracking_status: string | null;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_email: string | null;
  customer_city: string | null;
  fulfillment_type: string;
  woo_order_id: number | null;
  store_id: string | null;
  selling_point_id: string | null;
  pathao_integration_id: string | null;
  pathao_store_id: number | null;
  selling_points: {
    id: string;
    name: string | null;
    brand_id: string | null;
    woo_store_id: string | null;
    is_default: boolean | null;
    brands: { id: string; name: string | null; woo_store_id: string | null } | null;
  } | null;
  storefront_id?: string | null;
  stock_restored_at?: string | null;
  stores: { url: string | null; name?: string | null } | null;
}

/** Stored identity of the order, snapshotted at load for change detection (issue #32). */
interface InitialIdentity {
  brandId: string | null;
  brandName: string | null;
  brandWooStoreId: string | null;
  sellingPointId: string | null;
  sellingPointName: string | null;
  sellingPointWooStoreId: string | null;
}

interface LineItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_id: string | null;
  base_product_name?: string | null;
  _isNew?: boolean;
}

interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
  price: number;
}

interface TimelineEntry {
  id: string;
  event: string;
  description: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface PaymentEntry {
  id: string;
  method: string;
  amount: number;
  trx_id: string | null;
  notes: string | null;
  created_at: string;
}

interface EditableMeas {
  id: string; // db id or temp id starting with "new-"
  order_item_id: string | null;
  group_name: string;
  display_format: "label_value" | "dash_separated";
  unit: string;
  values: { name: string; value: string }[];
  notes: string | null;
  source: string; // "pos" | "woo" | "preset"
  _isNew?: boolean;
  _dirty?: boolean;
  _sizeLabel?: string | null;
}

export interface CourierShipmentEntry {
  id: string;
  order_id: string;
  provider: string;
  consignment_id: string;
  raw_status: string | null;
  canonical_status: string | null;
  dispatched_at: string;
  last_tracked_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

interface Props {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OrderDetailSheet({ orderId, open, onOpenChange, onSaved }: Props) {
  const { symbol } = useCurrency();
  const { can } = usePermissions();
  const canEdit = can("orders.edit");
  const canChangeStatus = can("orders.change_status");
  const canRefund = can("orders.refund");
  const canLogPayment = can("orders.log_payment");
  const canAttachCourier = can("orders.attach_courier");
  const { active, brands } = useBusinessContext();
  // load() must not re-run when the brand list refreshes, but it needs the
  // current list to derive a legacy brand — keep a ref alongside state.
  const brandsRef = useRef(brands);
  useEffect(() => { brandsRef.current = brands; }, [brands]);
  const [order, setOrder] = useState<OrderDetail | null>(null);

  // Issue #27: WooCommerce online-payment gate (docs/adr/0001-woo-online-payment-gate.md).
  // While an order is gated it cannot be entered with a courier or moved between
  // statuses; the permission-controlled confirm-payment flow below is the only
  // sanctioned exit. Order creation and ordinary edits are never blocked.
  const gate = order ? evaluatePaymentGate(order) : null;
  const paymentGateLocked = !!gate?.gated;
  const canEnterCourierNow = canAttachCourier && !paymentGateLocked;
  const [items, setItems] = useState<LineItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [measurements, setMeasurements] = useState<EditableMeas[]>([]);
  const [deletedMeasIds, setDeletedMeasIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable state
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [editedItems, setEditedItems] = useState<LineItem[]>([]);
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([]);
  const [discount, setDiscount] = useState(0);
  const [shippingCost, setShippingCost] = useState(0);
  const [notes, setNotes] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<string>("delivery");
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [variationOptions, setVariationOptions] = useState<PickableVariation[]>([]);
  const [variationPickerProductId, setVariationPickerProductId] = useState<string | null>(null);
  const [addProductId, setAddProductId] = useState<string>("");
  // Multi-business Phase 3: fulfillment location (warehouse/showroom)
  const [locationId, setLocationId] = useState<string>("");
  const [locationOptions, setLocationOptions] = useState<Array<{ id: string; name: string; type: string }>>([]);

  // Order identity (issue #32): editable Brand + Selling Point on Order Info,
  // resolved with the same rules as Add Order (issue #21). The default Pathao
  // Account derives from the selection (issue #22) and is never written back
  // over an existing courier booking.
  const [identityPoints, setIdentityPoints] = useState<IdentitySellingPoint[]>([]);
  const [pathaoAccounts, setPathaoAccounts] = useState<PathaoAccountOption[]>([]);
  const [pathaoLinks, setPathaoLinks] = useState<PathaoStoreLinkRow[]>([]);
  const [brandId, setBrandId] = useState("");
  const [sellingPointId, setSellingPointId] = useState("");
  const [initialIdentity, setInitialIdentity] = useState<InitialIdentity | null>(null);

  // Exchange dialog
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeParent, setExchangeParent] = useState<any>(null);

  // Split dialog (issue #31 — order split with payment transfer). A split is
  // an ordinary edit: it moves items/money only and never touches the order's
  // status or courier, so the #27 gate does not block it (and stays intact).
  const [splitOpen, setSplitOpen] = useState(false);

  // Attach / Replace Parcel dialog
  const [attachParcelOpen, setAttachParcelOpen] = useState(false);

  // Courier shipments list & actions
  const [courierShipments, setCourierShipments] = useState<CourierShipmentEntry[]>([]);
  const [deletingShipment, setDeletingShipment] = useState<CourierShipmentEntry | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deletePathaoFail, setDeletePathaoFail] = useState<{
    open: boolean;
    reason: string;
    shipment: CourierShipmentEntry;
  } | null>(null);
  const [copiedCid, setCopiedCid] = useState<string | null>(null);

  const handleDeleteCourierEntry = async (shipment: CourierShipmentEntry, force = false) => {
    if (!orderId) return;
    setDeleteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pathao-courier", {
        body: {
          action: "delete_courier_entry",
          order_id: orderId,
          shipment_id: shipment.id.startsWith("legacy-") ? undefined : shipment.id,
          consignment_id: shipment.consignment_id,
          force,
        },
      });

      if (error) {
        try {
          const body = JSON.parse(error.message);
          if (body?.pathao_failed) {
            setDeleteConfirmOpen(false);
            setDeletePathaoFail({
              open: true,
              reason: body.reason || body.error || "Cancellation rejected by Pathao",
              shipment,
            });
            return;
          }
        } catch {}
        throw error;
      }

      // The edge function wraps its payload as { data: result }, so unwrap before
      // reading flags — reading them off the top level silently always yields
      // undefined (which is why the success toast never mentioned Pathao).
      const payload = (data?.data ?? data) as any;

      if (payload?.pathao_failed) {
        setDeleteConfirmOpen(false);
        setDeletePathaoFail({
          open: true,
          reason: payload.reason || payload.error || "Cancellation rejected by Pathao",
          shipment,
        });
        return;
      }

      if (payload?.error) throw new Error(payload.error);

      const noop = payload?.pathao_cancel_noop;
      const cancelledOnPathao = payload?.pathao_cancelled;
      toast.success(
        noop
          ? `Courier entry ${shipment.consignment_id} deleted — the parcel was already in a terminal state on Pathao (nothing left to cancel).`
          : `Courier entry ${shipment.consignment_id} deleted${cancelledOnPathao ? " and cancelled on Pathao" : " (cancelled locally only)"}.`,
      );

      setDeleteConfirmOpen(false);
      setDeletingShipment(null);
      setDeletePathaoFail(null);
      load();
      onSaved?.();
    } catch (err: any) {
      toast.error(`Failed to delete courier entry: ${err.message}`);
    } finally {
      setDeleteLoading(false);
    }
  };

  const openExchange = useCallback(async () => {
    if (!order) return;
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, store_id, customer_id, customer_name, customer_phone, customer_address, customer_city, customer_email, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, pathao_store_id, pathao_integration_id, status")
      .eq("id", order.id)
      .maybeSingle();
    if (!data) {
      toast.error("Could not load order details for exchange");
      return;
    }
    setExchangeParent(data);
    setExchangeOpen(true);
  }, [order]);

  // Payment form
  const [payMethod, setPayMethod] = useState("bkash");
  const [payAmount, setPayAmount] = useState("");
  const [payTrxId, setPayTrxId] = useState("");
  const [payNotes, setPayNotes] = useState("");

  // Inline-edit payment row state
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editPayMethod, setEditPayMethod] = useState("bkash");
  const [editPayAmount, setEditPayAmount] = useState("");
  const [editPayTrxId, setEditPayTrxId] = useState("");
  const [editPayNotes, setEditPayNotes] = useState("");

  // Confirm pending payment
  const [confirmPayMethod, setConfirmPayMethod] = useState("bkash");
  const [confirmPayAmount, setConfirmPayAmount] = useState("");
  const [confirmPayTrxId, setConfirmPayTrxId] = useState("");
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    const [orderRes, itemsRes, timelineRes, paymentsRes, measRes, shipmentsRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number, status, payment_status, payment_method, source, subtotal, discount, shipping_cost, total, tax_amount, amount_to_collect, notes, consignment_id, tracking_status, created_at, customer_name, customer_phone, customer_address, customer_email, customer_city, fulfillment_type, woo_order_id, store_id, storefront_id, stock_restored_at, location_id, selling_point_id, pathao_integration_id, pathao_store_id, selling_points(id, name, brand_id, woo_store_id, is_default, brands(id, name, woo_store_id)), stores(url, name)")
        .eq("id", orderId)
        .single(),
      supabase
        .from("order_items")
        .select("id, product_name, quantity, unit_price, line_total, product_id, products(name)")
        .eq("order_id", orderId),
      supabase
        .from("order_timeline")
        .select("id, event, description, created_at, metadata")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false }),
      supabase
        .from("order_payments")
        .select("id, method, amount, trx_id, notes, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false }),
      supabase
        .from("order_item_measurements" as any)
        .select("id, order_item_id, group_name, display_format, unit, values, notes, source")
        .eq("order_id", orderId),
      supabase
        .from("courier_shipments")
        .select("id, order_id, provider, consignment_id, raw_status, canonical_status, dispatched_at, last_tracked_at, cancelled_at, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false }),
    ]);

    const o = orderRes.data as unknown as OrderDetail | null;
    if (o) {
      setOrder(o);
      setStatus(o.status);
      setPaymentStatus(o.payment_status);
      setCustomerName(o.customer_name || "");
      setCustomerPhone(o.customer_phone || "");
      setCustomerAddress(o.customer_address || "");
      setCustomerEmail(o.customer_email || "");
      setDiscount(o.discount || 0);
      setShippingCost(o.shipping_cost || 0);
      setNotes(o.notes || "");
      setFulfillmentType(o.fulfillment_type || "delivery");
      setPaymentMethod(o.payment_method || "");
      setLocationId((o as { location_id?: string | null }).location_id || "");

      // Identity snapshot (issue #32): same derivation as the Orders page brand
      // column — selling_points->brands first, legacy store binding as fallback.
      const currentSp = o.selling_points ?? null;
      const derivedBrand: IdentityBrand | null =
        (currentSp?.brands as IdentityBrand | null) ??
        (deriveBrandForStore(brandsRef.current, o.store_id) as IdentityBrand | undefined) ??
        null;
      const initial: InitialIdentity = {
        brandId: derivedBrand?.id ?? null,
        brandName: derivedBrand?.name ?? null,
        brandWooStoreId: derivedBrand?.woo_store_id ?? null,
        sellingPointId: currentSp?.id ?? null,
        sellingPointName: currentSp?.name ?? null,
        sellingPointWooStoreId: currentSp?.woo_store_id ?? null,
      };
      setInitialIdentity(initial);
      setBrandId(initial.brandId ?? "");
      setSellingPointId(initial.sellingPointId ?? "");

      const shipments = (shipmentsRes.data as CourierShipmentEntry[]) || [];
      if (o.consignment_id && !shipments.some(s => s.consignment_id === o.consignment_id)) {
        shipments.unshift({
          id: `legacy-${o.consignment_id}`,
          order_id: orderId,
          provider: "pathao",
          consignment_id: o.consignment_id,
          raw_status: o.tracking_status,
          canonical_status: null,
          dispatched_at: o.created_at,
          last_tracked_at: null,
          cancelled_at: null,
          created_at: o.created_at,
        });
      }
      setCourierShipments(shipments);
    }

    // Phase 3: locations for the order's brand (via store linkage) for the
    // fulfillment-location picker. Best-effort: empty list hides the picker.
    try {
      const { data: oRow } = await supabase
        .from("orders")
        .select("store_id")
        .eq("id", orderId)
        .single();
      if (oRow?.store_id) {
        const { data: locs } = await supabase
          .from("locations")
          .select("id, name, type, brand_id, brands!inner(woo_store_id)")
          .eq("brands.woo_store_id", oRow.store_id)
          .order("name");
        setLocationOptions((locs as Array<{ id: string; name: string; type: string }>) || []);
      } else {
        setLocationOptions([]);
      }
    } catch {
      setLocationOptions([]);
    }
    const liRaw = (itemsRes.data || []) as any[];
    const li: LineItem[] = liRaw.map((r) => ({
      id: r.id,
      product_name: r.product_name,
      quantity: r.quantity,
      unit_price: r.unit_price,
      line_total: r.line_total,
      product_id: r.product_id,
      base_product_name: r.products?.name || null,
    }));
    setItems(li);
    setEditedItems(li.map((i) => ({ ...i })));
    setDeletedItemIds([]);
    setTimeline((timelineRes.data || []) as unknown as TimelineEntry[]);
    setPayments((paymentsRes.data || []) as unknown as PaymentEntry[]);
    const measRows = ((measRes as any).data || []) as any[];
    setMeasurements(
      measRows.map((m): EditableMeas => ({
        id: m.id,
        order_item_id: m.order_item_id ?? null,
        group_name: m.group_name,
        display_format: (m.display_format === "dash_separated" ? "dash_separated" : "label_value") as any,
        unit: m.unit || "",
        values: Array.isArray(m.values)
          ? m.values
          : Object.entries(m.values || {}).map(([name, value]) => ({ name, value: String(value) })),
        notes: m.notes ?? null,
        source: m.source || "pos",
      }))
    );
    setDeletedMeasIds([]);
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    if (open && orderId) load();
  }, [open, orderId, load]);

  // Fetch products + variations for adding new items. Both are paged because
  // the hosted REST cap silently truncates at 1000 rows (variation tables in
  // particular exceed it) — which used to hide variation selectors.
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [products, variations] = await Promise.all([
          fetchAllRows<ProductOption>(({ from, to }) =>
            supabase
              .from("products")
              .select("id, name, sku, price")
              .eq("is_active", true)
              .order("name")
              .range(from, to),
          ),
          fetchAllRows<PickableVariation>(({ from, to }) =>
            supabase
              .from("product_variations")
              .select("id, product_id, name, sku, price, stock_quantity, manage_stock, attributes")
              .range(from, to),
          ),
        ]);
        setProductOptions(products);
        setVariationOptions(variations);
      } catch (e) {
        console.warn("Failed to load product catalog for order edits:", e);
      }
    })();
  }, [open]);

  // Identity options (issue #32): active Selling Points of the active business
  // plus the selectable Pathao Accounts and per-brand default links (issue #22).
  // Errors degrade to empty lists so the sheet still renders.
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    (async () => {
      const [pointsRes, accountData] = await Promise.all([
        active?.id
          ? supabase
              .from("selling_points")
              .select("id, name, brand_id, woo_store_id, is_default, is_active")
              .eq("business_id", active.id)
              .eq("is_active", true)
              .order("name")
          : Promise.resolve({ data: [] as IdentitySellingPoint[] }),
        fetchPathaoAccountData(),
      ]);
      if (!mounted) return;
      setIdentityPoints(((pointsRes.data || []) as IdentitySellingPoint[]) || []);
      setPathaoAccounts(accountData.accounts);
      setPathaoLinks(accountData.links);
    })();
    return () => { mounted = false; };
  }, [open, active?.id]);

  // Resolve preset measurements (e.g. S/M/L size charts) for items that have no
  // measurement rows yet, so they show up — and stay editable — in the sheet.
  useEffect(() => {
    if (!open || !orderId || items.length === 0) return;
    let cancelled = false;
    (async () => {
      const additions: EditableMeas[] = [];
      for (const item of items) {
        if (!item.product_id) continue;
        // Skip items that already have any measurement entries
        const has = measurements.some((m) => m.order_item_id === item.id);
        if (has) continue;
        const sizeLabel = detectSizeFromItem({ product_name: item.product_name });
        if (!sizeLabel) continue;
        try {
          const groups = await getGroupsForProduct(item.product_id);
          for (const g of groups) {
            const preset = await resolveSizePreset(g.id, item.product_id, sizeLabel);
            if (!preset || preset.values.length === 0) continue;
            additions.push({
              id: `new-${item.id}-${g.id}`,
              order_item_id: item.id,
              group_name: `${g.name} (Size ${sizeLabel})`,
              display_format: g.display_format,
              unit: g.unit,
              values: preset.values.map((v) => ({ name: v.name, value: v.value })),
              notes: null,
              source: "preset",
              _isNew: true,
              _sizeLabel: sizeLabel,
            });
          }
        } catch { /* ignore */ }
      }
      if (cancelled || additions.length === 0) return;
      setMeasurements((prev) => {
        // Avoid duplicates if the effect reruns
        const existingIds = new Set(prev.map((m) => m.id));
        const fresh = additions.filter((a) => !existingIds.has(a.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    })();
    return () => { cancelled = true; };
    // We intentionally depend on items only; re-run when items reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId, items]);

  // ---------- measurement editors ----------
  const updateMeasValue = (measId: string, fieldIdx: number, value: string) => {
    setMeasurements((prev) =>
      prev.map((m) =>
        m.id === measId
          ? {
              ...m,
              values: m.values.map((v, idx) => (idx === fieldIdx ? { ...v, value } : v)),
              _dirty: true,
            }
          : m
      )
    );
  };
  const updateMeasNotes = (measId: string, notes: string) => {
    setMeasurements((prev) =>
      prev.map((m) => (m.id === measId ? { ...m, notes, _dirty: true } : m))
    );
  };
  const removeMeas = (measId: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== measId));
    if (!measId.startsWith("new-")) {
      setDeletedMeasIds((prev) => [...prev, measId]);
    }
  };

  /* ---------- helpers ---------- */

  const activeItems = editedItems.filter((i) => !deletedItemIds.includes(i.id));
  const computedSubtotal = activeItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const computedTotal = computedSubtotal - discount + shippingCost;

  const updateItemQty = (id: string, qty: number) => {
    setEditedItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, qty), line_total: Math.max(1, qty) * i.unit_price } : i))
    );
  };

  const updateItemPrice = (id: string, price: number) => {
    const p = Math.max(0, price);
    setEditedItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, unit_price: p, line_total: i.quantity * p } : i))
    );
  };
  const removeItem = (id: string) => {
    setDeletedItemIds((prev) => [...prev, id]);
  };

  const addOrderLine = (pick: VariationPick) => {
    const existing = editedItems.find(
      (i) =>
        !i._isNew &&
        i.product_id === pick.product.id &&
        i.product_name === pick.lineName &&
        !deletedItemIds.includes(i.id),
    );
    if (existing) {
      updateItemQty(existing.id, existing.quantity + 1);
      return;
    }
    const tempId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setEditedItems((prev) => [
      ...prev,
      {
        id: tempId,
        product_name: pick.lineName,
        quantity: 1,
        unit_price: pick.price,
        line_total: pick.price,
        product_id: pick.product.id,
        base_product_name: pick.product.name,
        _isNew: true,
      },
    ]);
  };

  const addProductToOrder = (productId: string) => {
    const p = productOptions.find((o) => o.id === productId);
    if (!p) return;
    setAddProductId("");
    // Variable products go through the shared size picker instead of being
    // added as a base product with no size (issue #20).
    const hasVariations = getProductVariations(productId, variationOptions).length > 0;
    if (hasVariations) {
      setVariationPickerProductId(productId);
      return;
    }
    addOrderLine({
      product: p,
      variation: null,
      lineName: p.name,
      attributes: [],
      price: Number(p.price) || 0,
    });
  };

  /* ---------- Order identity (issue #32) ---------- */

  // The order's current Selling Point stays selectable even when it is no
  // longer in the active list, so opening the sheet never silently swaps it.
  const mergedPoints = useMemo<IdentitySellingPoint[]>(() => {
    const current = order?.selling_points;
    if (!current) return identityPoints;
    if (identityPoints.some((point) => point.id === current.id)) return identityPoints;
    return [
      ...identityPoints,
      {
        id: current.id,
        name: current.name ?? "",
        brand_id: current.brand_id,
        woo_store_id: current.woo_store_id,
        is_default: current.is_default,
        is_active: true,
      },
    ];
  }, [identityPoints, order?.selling_points]);

  // Brand choices: active brands plus the order's current brand (possibly
  // inactive or absent from context) so it displays instead of vanishing.
  const brandChoices = useMemo<IdentityBrand[]>(() => {
    const list: IdentityBrand[] = brands
      .filter((brand) => brand.is_active)
      .map((brand) => ({ id: brand.id, name: brand.name, woo_store_id: brand.woo_store_id }));
    const currentId = initialIdentity?.brandId;
    if (currentId && !list.some((brand) => brand.id === currentId)) {
      const known = brands.find((brand) => brand.id === currentId);
      list.push(
        known
          ? { id: known.id, name: known.name, woo_store_id: known.woo_store_id }
          : {
              id: currentId,
              name: initialIdentity?.brandName || "Unknown brand",
              woo_store_id: initialIdentity?.brandWooStoreId ?? null,
            },
      );
    }
    return list;
  }, [brands, initialIdentity]);

  const brandSellingPoints = useMemo(
    () => sellingPointsForBrand(mergedPoints, brandId),
    [mergedPoints, brandId],
  );

  // Issue #21 resolution rules: the brand default is preselected-but-editable,
  // a single option is auto-selected, and a brand change re-resolves from its
  // own options (the previous Selling Point belongs to the old brand).
  useEffect(() => {
    if (!brandId) {
      setSellingPointId("");
      return;
    }
    setSellingPointId((previous) => resolveSellingPoint(brandSellingPoints, previous).sellingPointId ?? "");
  }, [brandId, brandSellingPoints]);

  const selectedBrand = brandChoices.find((brand) => brand.id === brandId) || null;
  const selectedSellingPoint = brandSellingPoints.find((point) => point.id === sellingPointId) || null;

  // Brand default Pathao Account (brand -> woo_store_id -> pathao_store_links),
  // resolved through the Selling Point binding first when it has one (issue
  // #22) — re-derived whenever the Brand or Selling Point changes.
  const defaultAccount = useMemo(
    () =>
      resolveDefaultAccount(pathaoAccounts, pathaoLinks, [
        selectedSellingPoint?.woo_store_id,
        selectedBrand?.woo_store_id,
      ]),
    [pathaoAccounts, pathaoLinks, selectedSellingPoint, selectedBrand],
  );

  const identityDirty =
    !!initialIdentity &&
    identityChanged(initialIdentity, { brandId: brandId || null, sellingPointId: sellingPointId || null });
  // Zero Selling Points (or multiple with no default and no pick) block the
  // identity change with a configure hint — same rules as Add Order.
  const identityResolution = resolveSellingPoint(brandSellingPoints, sellingPointId);
  const identityBlocked =
    identityDirty &&
    brands.some((brand) => brand.is_active) &&
    (!brandId || identityChangeBlocked(brandId, identityResolution));

  // Warn before changing identity while an active consignment is booked
  // through another Pathao Account — the courier record is never rewritten.
  const bookedAccountKey =
    order && order.pathao_store_id != null
      ? pathaoAccountKey(order.pathao_integration_id ?? null, order.pathao_store_id)
      : null;
  const bookedAccount = bookedAccountKey
    ? pathaoAccounts.find((account) => account.key === bookedAccountKey)
    : undefined;
  const consignmentConflict = consignmentAccountConflict(
    courierShipments,
    order?.consignment_id ?? null,
    bookedAccountKey,
    defaultAccount?.key ?? null,
  );

  /* ---------- Save ---------- */

  const handleSave = async () => {
    if (!order) return;
    setSaving(true);
    try {
      // Issue #27: while the gate is on, ordinary saves must not move the order
      // out of Payment Needs Confirmation. Status and payment status stay at
      // their stored values; only recording a payment releases the gate.
      const gateLockedNow = evaluatePaymentGate(order).gated;
      const saveStatus = gateLockedNow ? order.status : status;
      const savePaymentStatus = gateLockedNow ? order.payment_status : paymentStatus;

      // Identity change (issue #32): written only when the operator actually
      // changed Brand/Selling Point. store_id stays a legacy Woo store binding
      // (the Selling Point's, else the Brand's) — NEVER a Selling Point UUID.
      const identityIsChanging = identityChanged(
        initialIdentity ?? { brandId: null, sellingPointId: null },
        { brandId: brandId || null, sellingPointId: sellingPointId || null },
      );
      const identityPatch: Record<string, unknown> = {};
      if (identityIsChanging) {
        identityPatch.selling_point_id = selectedSellingPoint?.id || null;
        identityPatch.store_id = legacyStoreIdFor(selectedSellingPoint, selectedBrand, {
          previousStoreId: order.store_id,
          brandChanged: (initialIdentity?.brandId ?? null) !== (brandId || null),
        });
      }

      await supabase
        .from("orders")
        .update({
          status: saveStatus,
          payment_status: savePaymentStatus,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          customer_address: customerAddress || null,
          customer_email: customerEmail || null,
          discount,
          shipping_cost: shippingCost,
          subtotal: computedSubtotal,
          total: computedTotal,
          notes,
          fulfillment_type: fulfillmentType,
          payment_method: paymentMethod || null,
          location_id: locationId || null,
          ...identityPatch,
        })
        .eq("id", order.id);

      // Delete removed items (only existing DB rows)
      const dbDeletedIds = deletedItemIds.filter((id) => !id.startsWith("new-"));
      if (dbDeletedIds.length > 0) {
        await supabase.from("order_items").delete().in("id", dbDeletedIds);
      }

      // Update existing items (qty or price)
      for (const item of activeItems) {
        if (item._isNew) continue;
        const orig = items.find((i) => i.id === item.id);
        if (orig && (orig.quantity !== item.quantity || Number(orig.unit_price) !== Number(item.unit_price))) {
          await supabase
            .from("order_items")
            .update({
              quantity: item.quantity,
              unit_price: item.unit_price,
              line_total: item.quantity * item.unit_price,
            })
            .eq("id", item.id);
        }
      }

      // Insert new items
      const newItems = activeItems.filter((i) => i._isNew);
      if (newItems.length > 0) {
        await supabase.from("order_items").insert(
          newItems.map((i) => ({
            order_id: order.id,
            product_id: i.product_id,
            product_name: i.product_name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            line_total: i.quantity * i.unit_price,
          }))
        );
      }

      // Add timeline entry for status change
      if (saveStatus !== order.status) {
        await addOrderTimeline({
          order_id: order.id,
          event: "status_changed",
          description: `Status changed from "${order.status}" to "${saveStatus}"`,
          metadata: { from: order.status, to: saveStatus },
        });
        await logAction("update", "order_status", order.id, { order_number: order.order_number, changes: { status: { from: order.status, to: saveStatus } }, before: { status: order.status }, after: { status: saveStatus } });

        // Phase 6 (§9.3): Cancel storefront order -> invoke storefront-restore-stock edge function
        if (saveStatus === "cancelled" && (order as any).storefront_id && !(order as any).stock_restored_at) {
          try {
            const { error: restErr } = await supabase.functions.invoke("storefront-restore-stock", {
              body: { order_id: order.id },
            });
            if (restErr) {
              toast.error(`Inventory restore failed: ${restErr.message}`);
            } else {
              toast.success("Inventory restored");
            }
          } catch (e: any) {
            toast.error(`Inventory restore error: ${e.message}`);
          }
        }
      }

      if (savePaymentStatus !== order.payment_status) {
        await addOrderTimeline({
          order_id: order.id,
          event: "payment_status_changed",
          description: `Payment status changed from "${order.payment_status}" to "${savePaymentStatus}"`,
          metadata: { from: order.payment_status, to: savePaymentStatus },
        });
        await logAction("update", "order_payment_status", order.id, { order_number: order.order_number, changes: { payment_status: { from: order.payment_status, to: savePaymentStatus } }, before: { payment_status: order.payment_status }, after: { payment_status: savePaymentStatus } });
      }

      // Customer info changes
      const custChanges: string[] = [];
      if ((order.customer_name || "") !== customerName) custChanges.push(`name: "${order.customer_name || "—"}" → "${customerName || "—"}"`);
      if ((order.customer_phone || "") !== customerPhone) custChanges.push(`phone: "${order.customer_phone || "—"}" → "${customerPhone || "—"}"`);
      if ((order.customer_address || "") !== customerAddress) custChanges.push(`address updated`);
      if ((order.customer_email || "") !== customerEmail) custChanges.push(`email: "${order.customer_email || "—"}" → "${customerEmail || "—"}"`);
      if (custChanges.length > 0) {
        await addOrderTimeline({
          order_id: order.id,
          event: "customer_updated",
          description: `Customer info updated — ${custChanges.join(", ")}`,
          metadata: { changes: custChanges },
        });
      }

      // Item changes
      const itemChangeNotes: string[] = [];
      if (dbDeletedIds.length > 0) {
        const removed = items.filter((i) => dbDeletedIds.includes(i.id)).map((i) => `${i.product_name} ×${i.quantity}`);
        itemChangeNotes.push(`removed: ${removed.join(", ")}`);
      }
      for (const item of activeItems) {
        if (item._isNew) continue;
        const orig = items.find((i) => i.id === item.id);
        if (orig && orig.quantity !== item.quantity) {
          itemChangeNotes.push(`${item.product_name}: qty ${orig.quantity} → ${item.quantity}`);
        }
        if (orig && Number(orig.unit_price) !== Number(item.unit_price)) {
          itemChangeNotes.push(`${item.product_name}: price ${symbol}${orig.unit_price} → ${symbol}${item.unit_price}`);
        }
      }
      if (newItems.length > 0) {
        itemChangeNotes.push(`added: ${newItems.map((i) => `${i.product_name} ×${i.quantity} @ ${symbol}${i.unit_price}`).join(", ")}`);
      }
      if (itemChangeNotes.length > 0) {
        await addOrderTimeline({
          order_id: order.id,
          event: "items_updated",
          description: `Items updated — ${itemChangeNotes.join("; ")}`,
          metadata: { changes: itemChangeNotes, new_total: computedTotal },
        });

        // Item edits must reach Woo as a full line_items overwrite
        // (approved decision). enqueue_order_push(reason='items_updated')
        // sets include_items=true on the queue row; the worker drains it and
        // woo-push rebuilds Woo's line items from DokanOS order_items.
        // Silent no-op for non-Woo orders (RPC checks woo_order_id).
        await supabase.rpc("enqueue_order_push", {
          p_order_id: order.id,
          p_reason: "items_updated",
        });
        // Drain immediately: the user just edited this order; don't let the
        // push sit behind the throttled cron.
        void kickSyncWorker();
      }

      // Recompute payment_status & amount_to_collect against the new total
      await recomputePaymentStatus({ ...order, total: computedTotal });

      // Totals / fulfillment changes
      const totalsChanges: string[] = [];
      if ((order.discount || 0) !== discount) totalsChanges.push(`discount ${symbol}${order.discount || 0} → ${symbol}${discount}`);
      if ((order.shipping_cost || 0) !== shippingCost) totalsChanges.push(`shipping ${symbol}${order.shipping_cost || 0} → ${symbol}${shippingCost}`);
      if ((order.fulfillment_type || "delivery") !== fulfillmentType) totalsChanges.push(`delivery type: ${order.fulfillment_type} → ${fulfillmentType}`);
      if ((order.notes || "") !== notes) totalsChanges.push(`notes updated`);
      if (totalsChanges.length > 0) {
        await addOrderTimeline({
          order_id: order.id,
          event: "order_updated",
          description: `Order updated — ${totalsChanges.join(", ")}`,
          metadata: { changes: totalsChanges, new_total: computedTotal },
        });
      }

      // Identity change (issue #32): timeline + audit entry covering Brand,
      // Selling Point, and the re-resolved default Pathao Account — including
      // whether an active consignment stays booked on another account.
      if (identityIsChanging) {
        const beforeAccount = resolveDefaultAccount(pathaoAccounts, pathaoLinks, [
          initialIdentity?.sellingPointWooStoreId,
          initialIdentity?.brandWooStoreId,
        ]);
        const accountLabel = (account: PathaoAccountOption | undefined) =>
          account ? `${account.accountName} · ${account.pickupStoreName}` : null;
        const beforeSnap: IdentitySnapshot = {
          brandId: initialIdentity?.brandId ?? null,
          brandName: initialIdentity?.brandName ?? null,
          sellingPointId: initialIdentity?.sellingPointId ?? null,
          sellingPointName: initialIdentity?.sellingPointName ?? null,
          accountKey: beforeAccount?.key ?? null,
          accountLabel: accountLabel(beforeAccount),
        };
        const afterSnap: IdentitySnapshot = {
          brandId: brandId || null,
          brandName: selectedBrand?.name ?? null,
          sellingPointId: selectedSellingPoint?.id ?? null,
          sellingPointName: selectedSellingPoint?.name ?? null,
          accountKey: defaultAccount?.key ?? null,
          accountLabel: accountLabel(defaultAccount),
        };
        const { description, metadata } = describeIdentityChange(beforeSnap, afterSnap);
        const conflictNote = consignmentConflict.conflicted
          ? {
              consignment_conflict: true,
              consignment_ids: consignmentConflict.consignmentIds,
              booked_account_key: consignmentConflict.bookedAccountKey,
            }
          : {};
        await addOrderTimeline({
          order_id: order.id,
          event: "identity_changed",
          description: consignmentConflict.conflicted
            ? `${description} — active consignment ${consignmentConflict.consignmentIds.join(", ")} stays booked on its Pathao Account (courier record unchanged)`
            : description,
          metadata: { ...metadata, ...conflictNote },
        });
        await logAction("update", "order_identity", order.id, {
          order_number: order.order_number,
          before: beforeSnap,
          after: afterSnap,
          ...conflictNote,
        });
      }

      // Status / customer / totals / identity edits all enqueue via the DB
      // trigger on orders.update; kick the worker so the push lands within
      // seconds instead of waiting for the throttled scheduler.
      if (
        saveStatus !== order.status ||
        savePaymentStatus !== order.payment_status ||
        custChanges.length > 0 ||
        totalsChanges.length > 0 ||
        identityIsChanging
      ) {
        void kickSyncWorker();
      }

      {
        const beforeOrder = {
          customer_name: order.customer_name || "",
          customer_phone: order.customer_phone || "",
          customer_email: order.customer_email || "",
          customer_address: order.customer_address || "",
          discount: Number(order.discount || 0),
          shipping_cost: Number(order.shipping_cost || 0),
          fulfillment_type: order.fulfillment_type || "delivery",
          payment_method: order.payment_method || "",
          notes: order.notes || "",
          total: Number(order.total || 0),
        };
        const afterOrder = {
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          customer_address: customerAddress,
          discount,
          shipping_cost: shippingCost,
          fulfillment_type: fulfillmentType,
          payment_method: paymentMethod,
          notes,
          total: computedTotal,
        };
        const { logChange } = await import("@/lib/auditLog");
        await logChange("order", order.id, beforeOrder, afterOrder, { order_number: order.order_number });
      }

      // Persist measurement edits
      try {
        if (deletedMeasIds.length > 0) {
          await supabase.from("order_item_measurements" as any).delete().in("id", deletedMeasIds);
        }
        // Inserts (new resolved presets or new entries with any value filled)
        const newMeas = measurements.filter(
          (m) => m._isNew && m.values.some((v) => v.value && String(v.value).trim() !== "")
        );
        if (newMeas.length > 0) {
          await supabase.from("order_item_measurements" as any).insert(
            newMeas.map((m) => ({
              order_id: order.id,
              order_item_id: m.order_item_id,
              group_name: m.group_name,
              display_format: m.display_format,
              unit: m.unit,
              values: m.values,
              source: m.source || "pos",
              notes: m.notes || null,
            })) as any
          );
        }
        // Updates (dirty existing rows)
        const dirtyMeas = measurements.filter((m) => !m._isNew && m._dirty);
        for (const m of dirtyMeas) {
          await supabase
            .from("order_item_measurements" as any)
            .update({
              values: m.values,
              notes: m.notes || null,
            } as any)
            .eq("id", m.id);
        }
        if (newMeas.length > 0 || dirtyMeas.length > 0 || deletedMeasIds.length > 0) {
          await addOrderTimeline({
            order_id: order.id,
            event: "measurements_updated",
            description: `Measurements updated — ${newMeas.length} added, ${dirtyMeas.length} edited, ${deletedMeasIds.length} removed`,
            metadata: { added: newMeas.length, edited: dirtyMeas.length, removed: deletedMeasIds.length },
          });
        }
      } catch (e) {
        console.warn("Measurement save failed:", e);
      }



      toast.success("Order updated & synced");
      onSaved?.();
      load();
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- Payment recompute helper ---------- */

  const recomputePaymentStatus = async (orderRow: OrderDetail | null) => {
    if (!orderRow) return;
    const { data: rows } = await supabase
      .from("order_payments")
      .select("amount")
      .eq("order_id", orderRow.id);
    const totalPaid = (rows || []).reduce((s, r: any) => s + Number(r.amount || 0), 0);
    const orderTotal = Number(orderRow.total || 0);
    const remaining = Math.max(orderTotal - totalPaid, 0);
    const newStatus =
      totalPaid <= 0.0001
        ? // Issue #27: keep the unconfirmed Woo online-payment marker — the gate
          // is released by recording a payment, not by recomputation side effects.
          orderRow.payment_status === "online"
          ? "online"
          : "unpaid"
        : remaining <= 0.0001
        ? "paid"
        : "partial";
    await supabase
      .from("orders")
      .update({
        payment_status: newStatus,
        amount_to_collect: remaining,
      })
      .eq("id", orderRow.id);
    return { totalPaid, remaining, newStatus };
  };

  /* ---------- Add payment ---------- */

  const addPayment = async () => {
    if (!order || !payAmount) return;
    const amt = parseFloat(payAmount);
    await supabase.from("order_payments").insert({
      order_id: order.id,
      method: payMethod,
      amount: amt,
      trx_id: payTrxId || null,
      notes: payNotes || null,
    });
    const recomputed = await recomputePaymentStatus(order);
    await addOrderTimeline({
      order_id: order.id,
      event: "payment_logged",
      description: `Payment of ${symbol}${amt.toLocaleString()} via ${payMethod}${payTrxId ? ` (TrxID: ${payTrxId})` : ""}${recomputed ? ` — ${recomputed.newStatus}, ${symbol}${recomputed.remaining.toLocaleString()} due` : ""}`,
      metadata: { method: payMethod, amount: amt, trx_id: payTrxId || null, ...(recomputed || {}) },
    });
    await logAction("create", "order_payment", order.id, {
      order_number: order.order_number, method: payMethod, amount: amt, trx_id: payTrxId || null,
    });
    setPayAmount("");
    setPayTrxId("");
    setPayNotes("");
    toast.success("Payment logged");
    onSaved?.();
    load();
  };

  /* ---------- Edit / delete existing payment ---------- */

  const startEditPayment = (p: PaymentEntry) => {
    setEditingPaymentId(p.id);
    setEditPayMethod(p.method);
    setEditPayAmount(String(p.amount));
    setEditPayTrxId(p.trx_id || "");
    setEditPayNotes(p.notes || "");
  };

  const cancelEditPayment = () => {
    setEditingPaymentId(null);
    setEditPayAmount("");
    setEditPayTrxId("");
    setEditPayNotes("");
  };

  const saveEditedPayment = async (p: PaymentEntry) => {
    if (!order) return;
    const amt = parseFloat(editPayAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    const before = { method: p.method, amount: Number(p.amount), trx_id: p.trx_id, notes: p.notes };
    const after = { method: editPayMethod, amount: amt, trx_id: editPayTrxId || null, notes: editPayNotes || null };
    await supabase
      .from("order_payments")
      .update(after)
      .eq("id", p.id);
    const recomputed = await recomputePaymentStatus(order);
    const changes: string[] = [];
    if (before.method !== after.method) changes.push(`method ${before.method} → ${after.method}`);
    if (before.amount !== after.amount) changes.push(`amount ${symbol}${before.amount.toLocaleString()} → ${symbol}${after.amount.toLocaleString()}`);
    if ((before.trx_id || "") !== (after.trx_id || "")) changes.push(`trx ${before.trx_id || "—"} → ${after.trx_id || "—"}`);
    if ((before.notes || "") !== (after.notes || "")) changes.push(`notes updated`);
    await addOrderTimeline({
      order_id: order.id,
      event: "payment_updated",
      description: `Payment edited — ${changes.join(", ") || "no changes"}${recomputed ? ` (${recomputed.newStatus}, ${symbol}${recomputed.remaining.toLocaleString()} due)` : ""}`,
      metadata: { before, after, ...(recomputed || {}) },
    });
    await logAction("update", "order_payment", order.id, {
      order_number: order.order_number, payment_id: p.id, before, after,
    });
    cancelEditPayment();
    toast.success("Payment updated");
    onSaved?.();
    load();
  };

  const deletePayment = async (p: PaymentEntry) => {
    if (!order) return;
    if (!confirm(`Delete this ${symbol}${Number(p.amount).toLocaleString()} ${p.method} payment?`)) return;
    await supabase.from("order_payments").delete().eq("id", p.id);
    const recomputed = await recomputePaymentStatus(order);
    await addOrderTimeline({
      order_id: order.id,
      event: "payment_deleted",
      description: `Payment of ${symbol}${Number(p.amount).toLocaleString()} via ${p.method} removed${recomputed ? ` — ${recomputed.newStatus}, ${symbol}${recomputed.remaining.toLocaleString()} due` : ""}`,
      metadata: { method: p.method, amount: Number(p.amount), trx_id: p.trx_id, ...(recomputed || {}) },
    });
    await logAction("delete", "order_payment", order.id, {
      order_number: order.order_number, payment_id: p.id, method: p.method, amount: Number(p.amount),
    });
    toast.success("Payment removed");
    onSaved?.();
    load();
  };


  /* ---------- Confirm pending payment ---------- */

  const confirmPendingPayment = async () => {
    if (!order) return;
    const amt = parseFloat(confirmPayAmount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setConfirmingPayment(true);
    try {
      // Insert payment record
      await supabase.from("order_payments").insert({
        order_id: order.id,
        method: confirmPayMethod,
        amount: amt,
        trx_id: confirmPayTrxId || null,
        notes: "Pending payment confirmed",
      });

      // Compute new totals
      const previouslyPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
      const totalPaid = previouslyPaid + amt;
      const orderTotal = Number(order.total) || 0;
      const remaining = Math.max(orderTotal - totalPaid, 0);
      const newPaymentStatus = remaining <= 0.0001 ? "paid" : "partial";

      // Detect pre-order: if any line item belongs to a configured Pre-Order category,
      // the order goes into the Pre-Order flow instead of the standard New Order flow.
      const productIds = (items || []).map((i: any) => i.product_id).filter(Boolean);
      const isPreOrder = await isOrderPreOrderByProducts(productIds);
      const nextStatus = isPreOrder ? "pre_order_pending" : "processing";

      // Update order: status moves to pre_order_pending (pre-order flow) or processing
      // (new order flow); payment status reflects paid/partial; amount_to_collect carries
      // any remaining due to Pathao dispatch.
      await supabase.from("orders").update({
        status: nextStatus,
        payment_status: newPaymentStatus,
        amount_to_collect: remaining,
      }).eq("id", order.id);

      // Timeline (auto-syncs to Woo notes via addOrderTimeline)
      await addOrderTimeline({
        order_id: order.id,
        event: "payment_confirmed",
        description: `Payment of ${symbol}${amt.toLocaleString()} via ${confirmPayMethod} confirmed${confirmPayTrxId ? ` (TrxID: ${confirmPayTrxId})` : ""}. ${remaining <= 0.0001 ? "Order fully paid." : `${symbol}${remaining.toLocaleString()} due — to be collected on delivery.`}`,
        metadata: { method: confirmPayMethod, amount: amt, trx_id: confirmPayTrxId || null, total_paid: totalPaid, remaining },
      });
      await addOrderTimeline({
        order_id: order.id,
        event: "status_changed",
        description: `Status changed from "payment_pending" to "${nextStatus}" (payment confirmed${isPreOrder ? "; pre-order item detected" : ""})`,
        metadata: { from: "payment_pending", to: nextStatus, pre_order: isPreOrder },
      });
      await addOrderTimeline({
        order_id: order.id,
        event: "payment_status_changed",
        description: `Payment status changed to ${newPaymentStatus}`,
        metadata: { from: order.payment_status, to: newPaymentStatus },
      });

      // Audit log
      await logAction("update", "order_payment_confirmed", order.id, {
        order_number: order.order_number,
        method: confirmPayMethod,
        amount: amt,
        trx_id: confirmPayTrxId || null,
        new_payment_status: newPaymentStatus,
        amount_to_collect: remaining,
      });


      setConfirmPayAmount("");
      setConfirmPayTrxId("");
      toast.success(remaining <= 0.0001 ? "Payment confirmed — order marked Paid" : `Payment confirmed — ${symbol}${remaining.toLocaleString()} due`);
      onSaved?.();
      load();
    } catch (e) {
      console.error(e);
      toast.error("Failed to confirm payment");
    } finally {
      setConfirmingPayment(false);
    }
  };

  const handleReturn = async () => {
    if (!order) return;
    setSaving(true);
    try {
      // Update order status
      await supabase.from("orders").update({
        status: "returned",
        payment_status: "refunded",
      }).eq("id", order.id);

      // Restock inventory — respect manage_stock + global stock toggle
      const globalStockEnabled = getGlobalStockEnabled();
      for (const item of items) {
        if (!item.product_id) continue;
        const { data: prod } = await supabase
          .from("products")
          .select("stock_quantity, woo_product_id, manage_stock")
          .eq("id", item.product_id)
          .single();
        if (prod && (globalStockEnabled || prod.manage_stock === true)) {
          await supabase.from("products").update({
            stock_quantity: (prod.stock_quantity || 0) + item.quantity,
          }).eq("id", item.product_id);

          // Push stock to WooCommerce if linked
          if (prod.woo_product_id) {
            supabase.functions.invoke("woo-push", {
              body: { action: "push_stock", product_id: item.product_id },
            }).catch(() => {});
          }
        }
      }

      // Timeline entries
      await addOrderTimeline({
        order_id: order.id,
        event: "returned",
        description: "Order returned — inventory restocked",
      });
      await logAction("update", "order_returned", order.id, { order_number: order.order_number });

      toast.success("Order returned & inventory restocked");
      onSaved?.();
      load();
    } catch {
      toast.error("Return processing failed");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- Render ---------- */

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col p-0 gap-0">
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <SheetTitle className="text-lg font-semibold">
                #{order?.order_number || "..."}
              </SheetTitle>
              {order && <FulfillmentBadge status={order.status} />}
              {order && <SourceBadge source={order.source} storeName={order.stores?.name} />}
            </div>
            {order?.woo_order_id && order.stores?.url && (
              <Button
                variant="outline"
                size="sm"
                asChild
                className="gap-1.5 mr-8"
              >
                <a
                  href={`${order.stores.url.replace(/\/+$/, "")}/wp-admin/post.php?post=${order.woo_order_id}&action=edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View on WooCommerce
                </a>
              </Button>
            )}
          </div>
          {order && (
            <p className="text-xs text-muted-foreground mt-1">
              {format(new Date(order.created_at), "MMM d, yyyy · h:mm a")} · {order.source === "pos" ? "POS" : "WooCommerce"}
              {order.consignment_id ? (
                <>
                  <a
                    href={`https://merchant.pathao.com/tracking?consignment_id=${order.consignment_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Pathao: {order.consignment_id}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {courierShipments.length > 1 && (
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      ({courierShipments.filter(s => !s.cancelled_at).length} active, {courierShipments.length} total)
                    </span>
                  )}
                  {canEnterCourierNow && (
                    <button
                      onClick={() => setAttachParcelOpen(true)}
                      className="ml-2 text-xs text-muted-foreground hover:text-primary underline"
                    >
                      Add / Replace
                    </button>
                  )}
                </>
              ) : canEnterCourierNow ? (
                <button
                  onClick={() => setAttachParcelOpen(true)}
                  className="ml-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Link2 className="h-3 w-3" />
                  Attach Pathao Parcel
                </button>
              ) : paymentGateLocked && canAttachCourier ? (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-400">
                  <Link2 className="h-3 w-3" />
                  Courier entry locked — {PAYMENT_NEEDS_CONFIRMATION_LABEL}
                </span>
              ) : null}
            </p>
          )}
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">Loading…</div>
          ) : (
            <Tabs defaultValue="info" className="h-full">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-6 pt-2">
                <TabsTrigger value="info" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">Order Info</TabsTrigger>
                <TabsTrigger value="payments" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">Payments</TabsTrigger>
                <TabsTrigger value="timeline" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">Timeline</TabsTrigger>
              </TabsList>

              {/* ====== Order Info ====== */}
              <TabsContent value="info" className="px-6 py-4 space-y-6 mt-0">
                {/* Pending payment confirmation panel */}
                {order?.status === "payment_pending" && order?.payment_status !== "paid" && order?.payment_status !== "refunded" && canLogPayment && (() => {
                  const ps = order.payment_status;
                  const totalPaidSoFar = payments.reduce((s, p) => s + Number(p.amount), 0);
                  const orderTotal = Number(order.total) || 0;
                  const dueSoFar = Math.max(orderTotal - totalPaidSoFar, 0);
                  const isPartial = ps === "partial" || (totalPaidSoFar > 0 && totalPaidSoFar < orderTotal);
                  const isFailed = ps === "failed" || ps === "cancelled";
                  const tone = isFailed
                    ? { border: "border-red-500/30", bg: "bg-red-500/5", text: "text-red-400", btn: "bg-red-500 hover:bg-red-500/90 text-red-50" }
                    : isPartial
                      ? { border: "border-orange-500/30", bg: "bg-orange-500/5", text: "text-orange-400", btn: "bg-orange-500 hover:bg-orange-500/90 text-orange-950" }
                      : { border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-400", btn: "bg-amber-500 hover:bg-amber-500/90 text-amber-950" };
                  const heading = isFailed
                    ? "Online Payment Failed"
                    : isPartial
                      ? "Partial Payment Received"
                      : PAYMENT_NEEDS_CONFIRMATION_LABEL;
                  const subtext = isFailed
                    ? `The online payment via ${order.payment_method || "the gateway"} did not complete. Log a new payment attempt or collect the full ${symbol}${orderTotal.toLocaleString()} on delivery.`
                    : isPartial
                      ? `${symbol}${totalPaidSoFar.toLocaleString()} received so far. Log any additional payment — the remaining ${symbol}${dueSoFar.toLocaleString()} will be set as the COD amount for dispatch.`
                      : `This order is on hold pending payment via ${order.payment_method || "non-COD method"}. Confirm the amount received — any remaining balance will be set as the COD amount for Pathao dispatch.`;
                  return (
                  <section className={`rounded-lg border ${tone.border} ${tone.bg} p-4 space-y-3`}>
                    <div className="flex items-start gap-2">
                      <CircleDot className={`h-4 w-4 ${tone.text} mt-0.5 shrink-0`} />
                      <div className="flex-1">
                        <h3 className={`text-sm font-semibold ${tone.text}`}>{heading}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>
                        {isPartial && (
                          <div className="mt-2 flex flex-wrap gap-3 text-xs">
                            <span className="text-muted-foreground">Paid: <strong className="text-foreground">{symbol}{totalPaidSoFar.toLocaleString()}</strong></span>
                            <span className="text-muted-foreground">Due: <strong className="text-foreground">{symbol}{dueSoFar.toLocaleString()}</strong></span>
                            <span className="text-muted-foreground">Total: <strong className="text-foreground">{symbol}{orderTotal.toLocaleString()}</strong></span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Method</Label>
                        <Select value={confirmPayMethod} onValueChange={setConfirmPayMethod}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bkash">bKash</SelectItem>
                            <SelectItem value="nagad">Nagad</SelectItem>
                            <SelectItem value="rocket">Rocket</SelectItem>
                            <SelectItem value="bank">Bank</SelectItem>
                            <SelectItem value="card">Card</SelectItem>
                            <SelectItem value="cash">Cash</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Amount Received ({symbol})</Label>
                        <Input
                          type="number"
                          min={0}
                          inputMode="decimal"
                          placeholder={String(order.total)}
                          value={confirmPayAmount}
                          onChange={(e) => setConfirmPayAmount(e.target.value)}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Trx ID (optional)</Label>
                        <Input
                          value={confirmPayTrxId}
                          onChange={(e) => setConfirmPayTrxId(e.target.value)}
                          className="h-9"
                        />
                      </div>
                    </div>
                    {confirmPayAmount && parseFloat(confirmPayAmount) > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {(() => {
                          const amt = parseFloat(confirmPayAmount);
                          const prev = payments.reduce((s, p) => s + Number(p.amount), 0);
                          const remaining = Math.max(Number(order.total) - prev - amt, 0);
                          return remaining <= 0.0001
                            ? <span className="text-emerald-400">Order will be marked <strong>Paid</strong>.</span>
                            : <>{symbol}{remaining.toLocaleString()} will remain due (collected on delivery).</>;
                        })()}
                      </div>
                    )}
                    <Button
                      size="sm"
                      onClick={confirmPendingPayment}
                      disabled={confirmingPayment || !confirmPayAmount}
                      className={`gap-1.5 ${tone.btn}`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {confirmingPayment ? "Confirming…" : isPartial ? "Log Additional Payment" : isFailed ? "Log New Payment Attempt" : "Confirm Payment Received"}
                    </Button>
                  </section>
                  );
                })()}

                {/* Order Identity (issue #32) */}
                <section>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Order Identity</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Brand</Label>
                      <Select
                        value={brandId || "none"}
                        onValueChange={(value) => setBrandId(value === "none" ? "" : value)}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="No Brand" />
                        </SelectTrigger>
                        <SelectContent>
                          {!initialIdentity?.brandId && <SelectItem value="none">No Brand</SelectItem>}
                          {brandChoices.map((brand) => (
                            <SelectItem key={brand.id} value={brand.id}>
                              {brand.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Selling Point</Label>
                      <Select
                        value={sellingPointId}
                        onValueChange={setSellingPointId}
                        disabled={!canEdit || !brandId || brandSellingPoints.length === 0}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder={brandId ? "Choose Selling Point" : "—"} />
                        </SelectTrigger>
                        <SelectContent>
                          {brandSellingPoints.map((point) => (
                            <SelectItem key={point.id} value={point.id}>
                              {point.name}{point.is_default ? " · Default" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Pathao Account (default)</Label>
                      <div className="h-9 flex items-center rounded-md border border-border bg-muted/30 px-3 text-sm text-foreground">
                        {defaultAccount
                          ? `${defaultAccount.accountName} · ${defaultAccount.pickupStoreName}`
                          : "Not configured"}
                      </div>
                    </div>
                  </div>
                  {brandId && brandSellingPoints.length === 0 && (
                    <p className="text-[11px] text-destructive mt-2">{SELLING_POINT_CONFIGURE_HINT}</p>
                  )}
                  {identityDirty && brandId && !identityResolution.sellingPointId && brandSellingPoints.length > 0 && (
                    <p className="text-[11px] text-destructive mt-2">Choose a Selling Point to save this identity change.</p>
                  )}
                  {identityDirty && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Saved with <span className="font-medium">Save Changes</span>. Changing the Brand re-resolves
                      the Selling Point and the default Pathao Account above.
                    </p>
                  )}
                  {identityDirty && consignmentConflict.conflicted && (
                    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-500 space-y-1">
                      <div className="flex items-center gap-1.5 font-medium">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Active consignment on another Pathao Account
                      </div>
                      <p>
                        Consignment <strong className="font-mono">{consignmentConflict.consignmentIds.join(", ")}</strong>{" "}
                        was booked through{" "}
                        <strong>
                          {bookedAccount
                            ? `${bookedAccount.accountName} · ${bookedAccount.pickupStoreName}`
                            : "another Pathao Account"}
                        </strong>
                        {defaultAccount ? (
                          <>
                            {" "}while this identity defaults to{" "}
                            <strong>{defaultAccount.accountName} · {defaultAccount.pickupStoreName}</strong>
                          </>
                        ) : null}
                        . Saving will <strong>not</strong> rebook or rewrite the courier record — cancel the booking
                        and attach the parcel again to dispatch through the new account.
                      </p>
                    </div>
                  )}
                  {identityDirty && !consignmentConflict.conflicted && consignmentConflict.consignmentIds.length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      This order has an active consignment ({consignmentConflict.consignmentIds.join(", ")}); its
                      courier record keeps the booked Pathao Account.
                    </p>
                  )}
                </section>

                <Separator />

                {/* Payment & Source Info */}
                <section>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Payment & Source</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Payment Method</Label>
                      <Select value={paymentMethod || "none"} onValueChange={(v) => setPaymentMethod(v === "none" ? "" : v)} disabled={paymentGateLocked}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="N/A" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">N/A</SelectItem>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="bkash">bKash</SelectItem>
                          <SelectItem value="nagad">Nagad</SelectItem>
                          <SelectItem value="rocket">Rocket</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="bank">Bank Transfer</SelectItem>
                          <SelectItem value="cod">COD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Payment Status</Label>
                      {/* Issue #27: while gated, only recording a payment (confirm
                          flow / payment log) may change the payment state. */}
                      <Select value={paymentStatus} onValueChange={setPaymentStatus} disabled={paymentGateLocked}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unpaid">Unpaid</SelectItem>
                          <SelectItem value="online">Online</SelectItem>
                          <SelectItem value="cod">COD</SelectItem>
                          <SelectItem value="partial">Partial</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                          <SelectItem value="refunded">Refunded</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Delivery Method</Label>
                      <Select value={fulfillmentType} onValueChange={setFulfillmentType}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="delivery">Delivery</SelectItem>
                          <SelectItem value="pickup">Pickup</SelectItem>
                          <SelectItem value="walkin">Walk-in</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {locationOptions.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Fulfill From</Label>
                        <Select value={locationId || "none"} onValueChange={(v) => setLocationId(v === "none" ? "" : v)}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Default location" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Default location</SelectItem>
                            {locationOptions.map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                {l.name} ({l.type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </section>

                <Separator />

                {/* Courier Entries Section */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold text-foreground">Courier Entries</h3>
                      <Badge variant="outline" className="text-xs">
                        {courierShipments.filter((s) => !s.cancelled_at).length} active
                        {courierShipments.some((s) => s.cancelled_at) && ` · ${courierShipments.length} total`}
                      </Badge>
                    </div>
                    {canEnterCourierNow ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAttachParcelOpen(true)}
                        className="h-8 gap-1.5 text-xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {courierShipments.length > 0 ? "Add Courier Entry" : "Attach Parcel"}
                      </Button>
                    ) : paymentGateLocked && canAttachCourier ? (
                      <span className="text-xs text-amber-400">
                        Locked — confirm the payment to enter with a courier
                      </span>
                    ) : null}
                  </div>

                  {courierShipments.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-center space-y-2">
                      <p className="text-xs text-muted-foreground">
                        No courier entries attached to this order yet.
                      </p>
                      {paymentGateLocked && canAttachCourier ? (
                        <p className="text-xs text-amber-400">
                          {PAYMENT_NEEDS_CONFIRMATION_LABEL} — courier entry stays locked until the payment is confirmed.
                        </p>
                      ) : canEnterCourierNow ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setAttachParcelOpen(true)}
                          className="h-7 text-xs gap-1.5"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Attach Pathao Parcel
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {courierShipments.map((shipment) => {
                        const isCancelled = !!shipment.cancelled_at;
                        const isPrimary = order?.consignment_id === shipment.consignment_id && !isCancelled;
                        const trackingUrl = `https://merchant.pathao.com/tracking?consignment_id=${shipment.consignment_id}`;

                        return (
                          <div
                            key={shipment.id}
                            className={`rounded-lg border p-3 transition-colors ${
                              isCancelled
                                ? "border-dashed border-border/70 bg-muted/20 opacity-75"
                                : isPrimary
                                ? "border-primary/40 bg-primary/[0.03] shadow-sm"
                                : "border-border bg-card"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1.5 flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="secondary" className="capitalize text-[10px] font-medium h-5">
                                    {shipment.provider || "Pathao"}
                                  </Badge>

                                  <div className="flex items-center gap-1.5 font-mono text-sm font-semibold">
                                    <a
                                      href={trackingUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-primary hover:underline"
                                      title="Open Pathao Tracking"
                                    >
                                      {shipment.consignment_id}
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(shipment.consignment_id);
                                        setCopiedCid(shipment.consignment_id);
                                        toast.success("Consignment ID copied");
                                        setTimeout(() => setCopiedCid(null), 2000);
                                      }}
                                      className="text-muted-foreground hover:text-foreground p-0.5"
                                      title="Copy Consignment ID"
                                    >
                                      {copiedCid === shipment.consignment_id ? (
                                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                      ) : (
                                        <Copy className="h-3 w-3" />
                                      )}
                                    </button>
                                  </div>

                                  {isPrimary && (
                                    <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px] h-5">
                                      Active / Primary
                                    </Badge>
                                  )}

                                  {isCancelled ? (
                                    <Badge variant="destructive" className="text-[10px] h-5">
                                      Cancelled
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] h-5 ${
                                        shipment.canonical_status === "delivered"
                                          ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10"
                                          : shipment.canonical_status === "in_transit" || shipment.canonical_status === "out_for_delivery"
                                          ? "border-sky-500/30 text-sky-500 bg-sky-500/10"
                                          : shipment.canonical_status === "returned" || shipment.canonical_status === "lost"
                                          ? "border-rose-500/30 text-rose-500 bg-rose-500/10"
                                          : "border-amber-500/30 text-amber-500 bg-amber-500/10"
                                      }`}
                                    >
                                      {shipment.raw_status || shipment.canonical_status || "Pending"}
                                    </Badge>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                  <span>
                                    Dispatched:{" "}
                                    <strong className="text-foreground font-normal">
                                      {format(new Date(shipment.dispatched_at || shipment.created_at), "MMM d, yyyy · h:mm a")}
                                    </strong>
                                  </span>
                                  {shipment.last_tracked_at && (
                                    <span>
                                      Last tracked:{" "}
                                      <strong className="text-foreground font-normal">
                                        {format(new Date(shipment.last_tracked_at), "MMM d, h:mm a")}
                                      </strong>
                                    </span>
                                  )}
                                  {isCancelled && shipment.cancelled_at && (
                                    <span className="text-destructive">
                                      Cancelled: {format(new Date(shipment.cancelled_at), "MMM d, yyyy · h:mm a")}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {!isCancelled && canAttachCourier && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setDeletingShipment(shipment);
                                    setDeleteConfirmOpen(true);
                                  }}
                                  className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                                  title="Delete or cancel this courier entry"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                                  <span className="text-xs">Delete</span>
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <Separator />

                {/* Customer */}
                <section>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Customer Details</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Name</Label>
                      <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Phone</Label>
                      <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Email</Label>
                      <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs">Address</Label>
                      <Textarea value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} rows={2} />
                    </div>
                  </div>
                </section>

                <Separator />

                {/* Line Items */}
                <section>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-foreground">Line Items</h3>
                    {/* Issue #31: split moves chosen items/money into a new order —
                        an ordinary edit, never a status/courier change, so the #27
                        payment gate intentionally does not disable it. */}
                    {order && canEdit && order.status !== "cancelled" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setSplitOpen(true)}
                        disabled={saving}
                      >
                        <Scissors className="h-3.5 w-3.5" /> Split Order
                      </Button>
                    )}
                  </div>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-secondary hover:bg-secondary">
                          <TableHead className="text-xs">Product</TableHead>
                          <TableHead className="text-xs text-right w-28">Price</TableHead>
                          <TableHead className="text-xs text-center w-24">Qty</TableHead>
                          <TableHead className="text-xs text-right w-24">Total</TableHead>
                          <TableHead className="w-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeItems.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground py-6">No items</TableCell>
                          </TableRow>
                        ) : (
                          activeItems.map((item) => {
                            let baseName = item.product_name;
                            let variation: string | null = null;
                            if (item.base_product_name && item.product_name.startsWith(item.base_product_name)) {
                              const rest = item.product_name.slice(item.base_product_name.length);
                              const m = rest.match(/^\s*-\s*(.+)$/);
                              if (m) {
                                baseName = item.base_product_name;
                                variation = m[1];
                              }
                            } else {
                              const dashIdx = item.product_name.lastIndexOf(" - ");
                              if (dashIdx > -1) {
                                baseName = item.product_name.slice(0, dashIdx);
                                variation = item.product_name.slice(dashIdx + 3);
                              }
                            }
                            return (
                            <TableRow key={item.id}>
                              <TableCell className="text-sm font-medium">
                                <div className="flex items-center gap-2">
                                  <span>{baseName}</span>
                                  {item._isNew && <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0">New</Badge>}
                                </div>
                                {variation && (
                                  <div className="text-xs font-normal text-muted-foreground mt-0.5">{variation}</div>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={item.unit_price}
                                  onChange={(e) => updateItemPrice(item.id, parseFloat(e.target.value) || 0)}
                                  className="w-24 h-8 text-right ml-auto text-sm"
                                  disabled={!canEdit}
                                />
                              </TableCell>
                              <TableCell className="text-center">
                                <Input
                                  type="number"
                                  min={1}
                                  value={item.quantity}
                                  onChange={(e) => updateItemQty(item.id, parseInt(e.target.value) || 1)}
                                  className="w-16 h-8 text-center mx-auto text-sm"
                                  disabled={!canEdit}
                                />
                              </TableCell>
                              <TableCell className="text-sm text-right font-medium">
                                {symbol}{(item.quantity * item.unit_price).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeItem(item.id)} disabled={!canEdit} aria-label="Remove item">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Add product picker */}
                  {canEdit && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <SearchableSelect
                          options={productOptions.map((p) => ({
                            value: p.id,
                            label: `${p.name}${p.sku ? ` (${p.sku})` : ""} — ${symbol}${Number(p.price).toLocaleString()}`,
                          }))}
                          value={addProductId}
                          onChange={(v) => addProductToOrder(v)}
                          placeholder="+ Add product to order…"
                          searchPlaceholder="Search products by name or SKU…"
                          emptyText="No products found."
                        />
                      </div>
                    </div>
                  )}

                  <ProductVariationPicker
                    open={!!variationPickerProductId}
                    onOpenChange={(next) => { if (!next) setVariationPickerProductId(null); }}
                    products={productOptions}
                    variations={variationOptions}
                    lockProductId={variationPickerProductId}
                    onPick={addOrderLine}
                    title="Add product & size"
                    description="Pick the variation for this order line — the size label is kept in the item name."
                  />

                  {/* Summary */}
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-medium">{symbol}{computedSubtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Discount</span>
                      <Input
                        type="number"
                        min={0}
                        value={discount}
                        onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                        className="w-28 h-8 text-right text-sm"
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Shipping</span>
                      <Input
                        type="number"
                        min={0}
                        value={shippingCost}
                        onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
                        className="w-28 h-8 text-right text-sm"
                      />
                    </div>
                    <Separator />
                    <div className="flex justify-between text-base font-semibold">
                      <span>Total</span>
                      <span>{symbol}{computedTotal.toLocaleString()}</span>
                    </div>
                    {order && (order.amount_to_collect ?? 0) > 0 && (
                      <div className="flex justify-between text-sm text-amber-400 font-medium">
                        <span>Due Amount</span>
                        <span>{symbol}{Number(order.amount_to_collect).toLocaleString()}</span>
                      </div>
                    )}
                    {payments.length > 0 && (
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Total Paid</span>
                        <span>{symbol}{payments.reduce((s, p) => s + Number(p.amount), 0).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Measurements (editable) */}
                {measurements.length > 0 && (
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Ruler className="h-4 w-4" /> Measurements
                      </h3>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => order && printMeasurementSlip(order.id)}
                      >
                        <Printer className="h-3.5 w-3.5" /> Print Slip
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-2">
                      Edits here are saved when you press <span className="font-medium">Save Changes</span>. Preset values from S/M/L size charts are pre-filled and editable.
                    </p>
                    <div className="space-y-3">
                      {[
                        ...activeItems.map((it) => ({ key: it.id, label: it.product_name, items: measurements.filter((m) => m.order_item_id === it.id) })),
                        { key: "__general__", label: "General", items: measurements.filter((m) => !m.order_item_id || !activeItems.some((it) => it.id === m.order_item_id)) },
                      ]
                        .filter((b) => b.items.length > 0)
                        .map((bucket) => (
                          <div key={`m-${bucket.key}`} className="rounded-lg border border-border p-3 bg-secondary/30">
                            <div className="text-xs font-semibold text-foreground mb-2">{bucket.label}</div>
                            {bucket.items.map((m) => (
                              <div key={m.id} className="mb-3 last:mb-0">
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-2">
                                    {m.group_name}
                                    {m.source === "woo" && (
                                      <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] px-1.5 py-0">Woo</Badge>
                                    )}
                                    {m.source === "preset" && (
                                      <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[9px] px-1.5 py-0">
                                        Preset{m._sizeLabel ? ` ${m._sizeLabel}` : ""}
                                      </Badge>
                                    )}
                                    {m.unit && <span className="normal-case text-[9px] text-muted-foreground">({m.unit})</span>}
                                  </div>
                                  {canEdit && (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                      onClick={() => removeMeas(m.id)}
                                      title="Remove this measurement set"
                                      aria-label="Remove measurement set"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  {m.values.map((v, idx) => (
                                    <div key={`${m.id}-${idx}`} className="flex items-center gap-2">
                                      <Label className="text-xs text-muted-foreground flex-1 truncate" title={v.name}>{v.name}</Label>
                                      <Input
                                        value={v.value}
                                        disabled={!canEdit}
                                        onChange={(e) => updateMeasValue(m.id, idx, e.target.value)}
                                        className="h-8 w-24 text-sm"
                                        placeholder="—"
                                      />
                                    </div>
                                  ))}
                                </div>
                                <Textarea
                                  value={m.notes || ""}
                                  disabled={!canEdit}
                                  onChange={(e) => updateMeasNotes(m.id, e.target.value)}
                                  rows={1}
                                  placeholder="Notes…"
                                  className="mt-2 text-xs min-h-[32px]"
                                />
                              </div>
                            ))}
                          </div>
                        ))}
                    </div>
                  </section>
                )}

                {measurements.length > 0 && <Separator />}

                {/* Notes */}
                <section>
                  <h3 className="text-sm font-semibold text-foreground mb-2">Order Notes</h3>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Internal notes…" />
                </section>
              </TabsContent>

              {/* ====== Payments ====== */}
              <TabsContent value="payments" className="px-6 py-4 space-y-6 mt-0">
                {/* Existing payments */}
                <section>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Payment History</h3>
                  {payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {payments.map((p) => {
                        const isEditing = editingPaymentId === p.id;
                        if (isEditing) {
                          return (
                            <div key={p.id} className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Method</Label>
                                  <Select value={editPayMethod} onValueChange={setEditPayMethod}>
                                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="bkash">bKash</SelectItem>
                                      <SelectItem value="nagad">Nagad</SelectItem>
                                      <SelectItem value="rocket">Rocket</SelectItem>
                                      <SelectItem value="cash">Cash</SelectItem>
                                      <SelectItem value="card">Card</SelectItem>
                                      <SelectItem value="bank">Bank Transfer</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Amount ({symbol})</Label>
                                  <Input type="number" min={0} value={editPayAmount} onChange={(e) => setEditPayAmount(e.target.value)} className="h-9" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">TrxID</Label>
                                  <Input value={editPayTrxId} onChange={(e) => setEditPayTrxId(e.target.value)} className="h-9" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Notes</Label>
                                  <Input value={editPayNotes} onChange={(e) => setEditPayNotes(e.target.value)} className="h-9" />
                                </div>
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                <Button size="sm" variant="ghost" onClick={cancelEditPayment}>Cancel</Button>
                                <Button size="sm" onClick={() => saveEditedPayment(p)} disabled={!canLogPayment}>Save</Button>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{symbol}{Number(p.amount).toLocaleString()} via {p.method}</div>
                              {p.trx_id && <div className="text-xs text-muted-foreground">TrxID: {p.trx_id}</div>}
                              {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-muted-foreground">{format(new Date(p.created_at), "MMM d, h:mm a")}</span>
                              {canLogPayment && (
                                <>
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => startEditPayment(p)}>Edit</Button>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deletePayment(p)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <Separator />

                {/* Log new payment */}
                <section>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Log Payment</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Method</Label>
                      <Select value={payMethod} onValueChange={setPayMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bkash">bKash</SelectItem>
                          <SelectItem value="nagad">Nagad</SelectItem>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="bank">Bank Transfer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Amount ({symbol})</Label>
                      <Input type="number" min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">TrxID</Label>
                      <Input value={payTrxId} onChange={(e) => setPayTrxId(e.target.value)} placeholder="Optional" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notes</Label>
                      <Input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Optional" />
                    </div>
                  </div>
                  <Button className="mt-3 gap-2" onClick={addPayment} disabled={!payAmount}>
                    <Plus className="h-4 w-4" /> Add Payment
                  </Button>
                </section>
              </TabsContent>

              {/* ====== Timeline ====== */}
              <TabsContent value="timeline" className="px-6 py-4 mt-0">
                <h3 className="text-sm font-semibold text-foreground mb-4">Activity Log</h3>
                {timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  <div className="relative pl-6 space-y-0">
                    {/* Vertical line */}
                    <div className="absolute left-[9px] top-1 bottom-1 w-px bg-border" />
                    {timeline.map((entry) => {
                      const meta = (entry.metadata || {}) as Record<string, unknown>;
                      const userLabel = (meta.user_name as string) || (meta.user_email as string) || "System";
                      return (
                        <div key={entry.id} className="relative pb-6 last:pb-0">
                          <div className="absolute -left-6 top-0.5 flex items-center justify-center">
                            <CircleDot className="h-[18px] w-[18px] text-primary bg-background rounded-full" />
                          </div>
                          <div>
                            <p className="text-sm text-foreground">{entry.description}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(entry.created_at), "MMM d, yyyy · h:mm a")}
                              <span className="mx-1.5">·</span>
                              <span className="font-medium">by {userLabel}</span>
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>

        {/* Footer */}
        <SheetFooter className="px-6 py-4 border-t border-border shrink-0 flex-row items-center justify-between gap-3 sm:justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Status:</Label>
            {/* Issue #27: gated orders may not be moved to another status —
                the confirm-payment flow is the only sanctioned exit. */}
            <Select value={status} onValueChange={setStatus} disabled={paymentGateLocked}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="payment_pending">{PAYMENT_NEEDS_CONFIRMATION_LABEL}</SelectItem>
                <SelectItem value="processing">New Order</SelectItem>
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
            {paymentGateLocked && (
              <span className="text-xs text-amber-400 whitespace-nowrap">
                Locked — {PAYMENT_NEEDS_CONFIRMATION_LABEL}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {order && order.status === "delivered" && canEdit && (
              <Button variant="outline" onClick={openExchange} disabled={saving} className="gap-1.5">
                <RefreshCw className="h-4 w-4" /> Create Exchange
              </Button>
            )}
            {order && order.status === "delivered" && canRefund && (
              <Button variant="outline" onClick={handleReturn} disabled={saving} className="gap-1.5 text-amber-400 border-amber-500/30 hover:bg-amber-500/10">
                <Undo2 className="h-4 w-4" /> Return
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving || (!canEdit && !canChangeStatus) || identityBlocked}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>

      <ExchangeDialog
        open={exchangeOpen}
        onOpenChange={setExchangeOpen}
        parentOrder={exchangeParent}
        onCreated={() => { setExchangeOpen(false); onSaved?.(); }}
      />

      {order && (
        <SplitOrderDialog
          open={splitOpen}
          onOpenChange={setSplitOpen}
          orderId={order.id}
          onSplitDone={() => { load(); onSaved?.(); }}
        />
      )}

      {order && (
        <AttachParcelDialog
          open={attachParcelOpen}
          onOpenChange={setAttachParcelOpen}
          orderId={order.id}
          orderNumber={order.order_number}
          existingConsignmentId={order.consignment_id}
          existingEntryCount={courierShipments.filter((s) => !s.cancelled_at).length}
          onAttached={() => { load(); onSaved?.(); }}
        />
      )}

      {/* Delete Courier Entry Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              <AlertDialogTitle>Delete Courier Entry</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-2 pt-2">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to delete courier entry{" "}
                <strong className="font-mono text-foreground">{deletingShipment?.consignment_id}</strong>?
              </p>
              <p className="text-xs text-muted-foreground">
                This will call the Pathao API to cancel the parcel and mark it as cancelled in DokanOS.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLoading}
              onClick={() => deletingShipment && handleDeleteCourierEntry(deletingShipment, false)}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Cancel on Pathao & Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pathao Cancellation Failed Dialog (with Force Cancel option) */}
      <AlertDialog
        open={!!deletePathaoFail?.open}
        onOpenChange={(open) => !open && setDeletePathaoFail(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <AlertDialogTitle>Pathao Cancellation Failed</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-2 pt-2">
              <p className="text-sm text-muted-foreground">
                Pathao refused to cancel parcel{" "}
                <strong className="font-mono text-foreground">{deletePathaoFail?.shipment.consignment_id}</strong>:
              </p>
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive font-mono">
                {deletePathaoFail?.reason}
              </div>
              <p className="text-xs text-muted-foreground">
                Do you want to mark this entry cancelled and detach it locally in DokanOS anyway?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Abort</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLoading}
              onClick={() => deletePathaoFail?.shipment && handleDeleteCourierEntry(deletePathaoFail.shipment, true)}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Force Delete Locally
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Badge helper                                                       */
/* ------------------------------------------------------------------ */

function FulfillmentBadge({ status }: { status: string }) {
  switch (status) {
    case "processing":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">New Order</Badge>;
    case "payment_pending":
      // Display-only rename (issue #27): stored value stays "payment_pending".
      return <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/20">{PAYMENT_NEEDS_CONFIRMATION_LABEL}</Badge>;
    case "ready_to_ship":
      return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/20">Ready to Ship</Badge>;
    case "pre_order_pending":
      return <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/20">Pre-Order</Badge>;
    case "pre_order_making":
      return <Badge className="bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/20">Making</Badge>;
    case "pre_order_ready":
      return <Badge className="bg-teal-500/15 text-teal-400 border-teal-500/20">Pre-Order Ready</Badge>;
    case "shipped":
      return <Badge className="bg-primary/15 text-primary border-primary/20">Shipped</Badge>;
    case "delivered":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Delivered</Badge>;
    case "returned":
      return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20">Returned</Badge>;
    case "cancelled":
      return <Badge className="bg-red-500/15 text-red-400 border-red-500/20">Cancelled</Badge>;
    default:
      return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20">{status}</Badge>;
  }
}
