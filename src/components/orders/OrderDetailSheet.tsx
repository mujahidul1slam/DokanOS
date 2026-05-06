import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { X, Trash2, Plus, ExternalLink, CircleDot, Undo2, Ruler, Printer, CheckCircle2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAction } from "@/lib/auditLog";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { printMeasurementSlip } from "./MeasurementSlipPrint";
import { postWooOrderNote } from "@/lib/wooNotes";
import { SourceBadge } from "./OrderBadges";
import { usePermissions } from "@/hooks/usePermissions";
import { isOrderPreOrderByProducts } from "@/lib/preOrderSettings";
import ExchangeDialog from "./ExchangeDialog";

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
  stores: { url: string | null; name?: string | null } | null;
}

interface LineItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_id: string | null;
  base_product_name?: string | null;
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
  const { can } = usePermissions();
  const canEdit = can("orders.edit");
  const canChangeStatus = can("orders.change_status");
  const canRefund = can("orders.refund");
  const canLogPayment = can("orders.log_payment");
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [measurements, setMeasurements] = useState<any[]>([]);
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

  // Exchange dialog
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeParent, setExchangeParent] = useState<any>(null);

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
    const [orderRes, itemsRes, timelineRes, paymentsRes, measRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number, status, payment_status, payment_method, source, subtotal, discount, shipping_cost, total, tax_amount, amount_to_collect, notes, consignment_id, tracking_status, created_at, customer_name, customer_phone, customer_address, customer_email, customer_city, fulfillment_type, woo_order_id, store_id, stores(url, name)")
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
    setMeasurements(((measRes as any).data || []) as any[]);
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    if (open && orderId) load();
  }, [open, orderId, load]);

  /* ---------- helpers ---------- */

  const activeItems = editedItems.filter((i) => !deletedItemIds.includes(i.id));
  const computedSubtotal = activeItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const computedTotal = computedSubtotal - discount + shippingCost;

  const updateItemQty = (id: string, qty: number) => {
    setEditedItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, qty), line_total: Math.max(1, qty) * i.unit_price } : i))
    );
  };

  const removeItem = (id: string) => {
    setDeletedItemIds((prev) => [...prev, id]);
  };

  /* ---------- Save ---------- */

  const handleSave = async () => {
    if (!order) return;
    setSaving(true);
    try {
      await supabase
        .from("orders")
        .update({
          status,
          payment_status: paymentStatus,
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
        })
        .eq("id", order.id);

      // Delete removed items
      if (deletedItemIds.length > 0) {
        await supabase.from("order_items").delete().in("id", deletedItemIds);
      }

      // Update quantities
      for (const item of activeItems) {
        const orig = items.find((i) => i.id === item.id);
        if (orig && (orig.quantity !== item.quantity)) {
          await supabase
            .from("order_items")
            .update({ quantity: item.quantity, line_total: item.quantity * item.unit_price })
            .eq("id", item.id);
        }
      }

      // Add timeline entry for status change
      if (status !== order.status) {
        await addOrderTimeline({
          order_id: order.id,
          event: "status_changed",
          description: `Status changed from "${order.status}" to "${status}"`,
          metadata: { from: order.status, to: status },
        });
        await logAction("update", "order_status", order.id, { order_number: order.order_number, changes: { status: { from: order.status, to: status } }, before: { status: order.status }, after: { status } });
      }

      if (paymentStatus !== order.payment_status) {
        await addOrderTimeline({
          order_id: order.id,
          event: "payment_status_changed",
          description: `Payment status changed from "${order.payment_status}" to "${paymentStatus}"`,
          metadata: { from: order.payment_status, to: paymentStatus },
        });
        await logAction("update", "order_payment_status", order.id, { order_number: order.order_number, changes: { payment_status: { from: order.payment_status, to: paymentStatus } }, before: { payment_status: order.payment_status }, after: { payment_status: paymentStatus } });
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
      if (deletedItemIds.length > 0) {
        const removed = items.filter((i) => deletedItemIds.includes(i.id)).map((i) => `${i.product_name} ×${i.quantity}`);
        itemChangeNotes.push(`removed: ${removed.join(", ")}`);
      }
      for (const item of activeItems) {
        const orig = items.find((i) => i.id === item.id);
        if (orig && orig.quantity !== item.quantity) {
          itemChangeNotes.push(`${item.product_name}: qty ${orig.quantity} → ${item.quantity}`);
        }
      }
      if (itemChangeNotes.length > 0) {
        await addOrderTimeline({
          order_id: order.id,
          event: "items_updated",
          description: `Items updated — ${itemChangeNotes.join("; ")}`,
          metadata: { changes: itemChangeNotes },
        });
      }

      // Totals / fulfillment changes
      const totalsChanges: string[] = [];
      if ((order.discount || 0) !== discount) totalsChanges.push(`discount ৳${order.discount || 0} → ৳${discount}`);
      if ((order.shipping_cost || 0) !== shippingCost) totalsChanges.push(`shipping ৳${order.shipping_cost || 0} → ৳${shippingCost}`);
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

      // Push status/notes change to WooCommerce if linked
      if (order.id) {
        try {
          await supabase.functions.invoke("woo-push", {
            body: { action: "push_order", order_id: order.id },
          });
        } catch (e) {
          console.warn("WooCommerce order push failed:", e);
        }

        // Status/payment/customer/item/total changes are already mirrored to Woo notes
        // automatically via addOrderTimeline above.
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
        ? "unpaid"
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
      description: `Payment of ৳${amt.toLocaleString()} via ${payMethod}${payTrxId ? ` (TrxID: ${payTrxId})` : ""}${recomputed ? ` — ${recomputed.newStatus}, ৳${recomputed.remaining.toLocaleString()} due` : ""}`,
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
    if (before.amount !== after.amount) changes.push(`amount ৳${before.amount.toLocaleString()} → ৳${after.amount.toLocaleString()}`);
    if ((before.trx_id || "") !== (after.trx_id || "")) changes.push(`trx ${before.trx_id || "—"} → ${after.trx_id || "—"}`);
    if ((before.notes || "") !== (after.notes || "")) changes.push(`notes updated`);
    await addOrderTimeline({
      order_id: order.id,
      event: "payment_updated",
      description: `Payment edited — ${changes.join(", ") || "no changes"}${recomputed ? ` (${recomputed.newStatus}, ৳${recomputed.remaining.toLocaleString()} due)` : ""}`,
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
    if (!confirm(`Delete this ৳${Number(p.amount).toLocaleString()} ${p.method} payment?`)) return;
    await supabase.from("order_payments").delete().eq("id", p.id);
    const recomputed = await recomputePaymentStatus(order);
    await addOrderTimeline({
      order_id: order.id,
      event: "payment_deleted",
      description: `Payment of ৳${Number(p.amount).toLocaleString()} via ${p.method} removed${recomputed ? ` — ${recomputed.newStatus}, ৳${recomputed.remaining.toLocaleString()} due` : ""}`,
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
        description: `Payment of ৳${amt.toLocaleString()} via ${confirmPayMethod} confirmed${confirmPayTrxId ? ` (TrxID: ${confirmPayTrxId})` : ""}. ${remaining <= 0.0001 ? "Order fully paid." : `৳${remaining.toLocaleString()} due — to be collected on delivery.`}`,
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

      // Push to WooCommerce
      supabase.functions.invoke("woo-push", {
        body: { action: "push_order", order_id: order.id },
      }).catch((e) => console.warn("Woo push failed:", e));

      setConfirmPayAmount("");
      setConfirmPayTrxId("");
      toast.success(remaining <= 0.0001 ? "Payment confirmed — order marked Paid" : `Payment confirmed — ৳${remaining.toLocaleString()} due`);
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

      // Restock inventory
      for (const item of items) {
        if (!item.product_id) continue;
        const { data: prod } = await supabase
          .from("products")
          .select("stock_quantity, woo_product_id")
          .eq("id", item.product_id)
          .single();
        if (prod) {
          await supabase.from("products").update({
            stock_quantity: prod.stock_quantity + item.quantity,
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
              {order.consignment_id && (
                <a
                  href={`https://merchant.pathao.com/tracking?consignment_id=${order.consignment_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Pathao: {order.consignment_id}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
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
                {order?.status === "payment_pending" && order?.payment_status !== "paid" && canLogPayment && (
                  <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <CircleDot className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold text-amber-400">Payment Awaiting Confirmation</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          This order is on hold pending payment via {order.payment_method || "non-COD method"}. Confirm the amount received — any remaining balance will be set as the COD amount for Pathao dispatch.
                        </p>
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
                        <Label className="text-xs">Amount Received (৳)</Label>
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
                            : <>৳{remaining.toLocaleString()} will remain due (collected on delivery).</>;
                        })()}
                      </div>
                    )}
                    <Button
                      size="sm"
                      onClick={confirmPendingPayment}
                      disabled={confirmingPayment || !confirmPayAmount}
                      className="gap-1.5 bg-amber-500 hover:bg-amber-500/90 text-amber-950"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {confirmingPayment ? "Confirming…" : "Confirm Payment Received"}
                    </Button>
                  </section>
                )}

                {/* Payment & Source Info */}
                <section>
                  <h3 className="text-sm font-semibold text-foreground mb-3">Payment & Source</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Payment Method</Label>
                      <Select value={paymentMethod || "none"} onValueChange={(v) => setPaymentMethod(v === "none" ? "" : v)}>
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
                      <Select value={paymentStatus} onValueChange={setPaymentStatus}>
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
                  </div>
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
                  <h3 className="text-sm font-semibold text-foreground mb-3">Line Items</h3>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-secondary hover:bg-secondary">
                          <TableHead className="text-xs">Product</TableHead>
                          <TableHead className="text-xs text-right w-20">Price</TableHead>
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
                                <div>{baseName}</div>
                                {variation && (
                                  <div className="text-xs font-normal text-muted-foreground mt-0.5">{variation}</div>
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-right">৳{Number(item.unit_price).toLocaleString()}</TableCell>
                              <TableCell className="text-center">
                                <Input
                                  type="number"
                                  min={1}
                                  value={item.quantity}
                                  onChange={(e) => updateItemQty(item.id, parseInt(e.target.value) || 1)}
                                  className="w-16 h-8 text-center mx-auto text-sm"
                                />
                              </TableCell>
                              <TableCell className="text-sm text-right font-medium">
                                ৳{(item.quantity * item.unit_price).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeItem(item.id)}>
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

                  {/* Summary */}
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-medium">৳{computedSubtotal.toLocaleString()}</span>
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
                      <span>৳{computedTotal.toLocaleString()}</span>
                    </div>
                    {order && (order.amount_to_collect ?? 0) > 0 && (
                      <div className="flex justify-between text-sm text-amber-400 font-medium">
                        <span>Due Amount</span>
                        <span>৳{Number(order.amount_to_collect).toLocaleString()}</span>
                      </div>
                    )}
                    {payments.length > 0 && (
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Total Paid</span>
                        <span>৳{payments.reduce((s, p) => s + Number(p.amount), 0).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Measurements */}
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
                    <div className="space-y-3">
                      {activeItems.map((item) => {
                        const itemMeas = measurements.filter((m) => m.order_item_id === item.id);
                        if (itemMeas.length === 0) return null;
                        return (
                          <div key={`m-${item.id}`} className="rounded-lg border border-border p-3 bg-secondary/30">
                            <div className="text-xs font-semibold text-foreground mb-2">{item.product_name}</div>
                            {itemMeas.map((m) => {
                              const vals = Array.isArray(m.values)
                                ? m.values
                                : Object.entries(m.values || {}).map(([name, value]) => ({ name, value: String(value) }));
                              const filled = vals.filter((v: any) => v.value && String(v.value).trim() !== "");
                              return (
                                <div key={m.id} className="mb-2 last:mb-0">
                                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-2">
                                    {m.group_name}
                                    {m.source === "woo" && (
                                      <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] px-1.5 py-0">Woo</Badge>
                                    )}
                                  </div>
                                  {m.display_format === "dash_separated" ? (
                                    <div className="text-sm font-semibold tracking-wider mt-1">
                                      {filled.map((v: any) => v.value).join(" - ")} {m.unit}
                                    </div>
                                  ) : (
                                    <div className="grid grid-cols-2 gap-x-4 mt-1">
                                      {filled.map((v: any, idx: number) => (
                                        <div key={idx} className="flex justify-between text-xs border-b border-dashed border-border py-0.5">
                                          <span className="text-muted-foreground">{v.name}</span>
                                          <span className="font-medium">{v.value} {m.unit}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {m.notes && (
                                    <div className="text-[11px] italic text-muted-foreground mt-1">{m.notes}</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      {/* Orphan measurements (no order_item_id) */}
                      {measurements.filter((m) => !m.order_item_id).length > 0 && (
                        <div className="rounded-lg border border-border p-3 bg-secondary/30">
                          <div className="text-xs font-semibold text-foreground mb-2">General</div>
                          {measurements.filter((m) => !m.order_item_id).map((m) => {
                            const vals = Array.isArray(m.values)
                              ? m.values
                              : Object.entries(m.values || {}).map(([name, value]) => ({ name, value: String(value) }));
                            const filled = vals.filter((v: any) => v.value && String(v.value).trim() !== "");
                            return (
                              <div key={m.id} className="mb-2 last:mb-0">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-2">
                                  {m.group_name}
                                  {m.source === "woo" && (
                                    <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] px-1.5 py-0">Woo</Badge>
                                  )}
                                </div>
                                {m.display_format === "dash_separated" ? (
                                  <div className="text-sm font-semibold tracking-wider mt-1">
                                    {filled.map((v: any) => v.value).join(" - ")} {m.unit}
                                  </div>
                                ) : (
                                  <div className="grid grid-cols-2 gap-x-4 mt-1">
                                    {filled.map((v: any, idx: number) => (
                                      <div key={idx} className="flex justify-between text-xs border-b border-dashed border-border py-0.5">
                                        <span className="text-muted-foreground">{v.name}</span>
                                        <span className="font-medium">{v.value} {m.unit}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
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
                                  <Label className="text-xs">Amount (৳)</Label>
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
                              <div className="text-sm font-medium">৳{Number(p.amount).toLocaleString()} via {p.method}</div>
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
                      <Label className="text-xs">Amount (৳)</Label>
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
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
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
          </div>
          <div className="flex items-center gap-2">
            {order && (order.status === "delivered" || order.status === "completed") && canEdit && (
              <Button variant="outline" onClick={openExchange} disabled={saving} className="gap-1.5">
                <RefreshCw className="h-4 w-4" /> Create Exchange
              </Button>
            )}
            {order && (order.status === "delivered" || order.status === "completed") && canRefund && (
              <Button variant="outline" onClick={handleReturn} disabled={saving} className="gap-1.5 text-amber-400 border-amber-500/30 hover:bg-amber-500/10">
                <Undo2 className="h-4 w-4" /> Return
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving || (!canEdit && !canChangeStatus)}>
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
    case "completed":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Delivered</Badge>;
    case "returned":
      return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20">Returned</Badge>;
    case "cancelled":
      return <Badge className="bg-red-500/15 text-red-400 border-red-500/20">Cancelled</Badge>;
    default:
      return <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20">{status}</Badge>;
  }
}
