import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { X, Trash2, Plus, ExternalLink, CircleDot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  notes: string | null;
  consignment_id: string | null;
  tracking_status: string | null;
  created_at: string;
  customers: { id: string; name: string; phone: string | null; address: string | null; email: string | null; city: string | null } | null;
}

interface LineItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_id: string | null;
}

interface TimelineEntry {
  id: string;
  event: string;
  description: string;
  created_at: string;
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
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable state
  const [status, setStatus] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [editedItems, setEditedItems] = useState<LineItem[]>([]);
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([]);
  const [discount, setDiscount] = useState(0);
  const [shippingCost, setShippingCost] = useState(0);
  const [notes, setNotes] = useState("");

  // Payment form
  const [payMethod, setPayMethod] = useState("bkash");
  const [payAmount, setPayAmount] = useState("");
  const [payTrxId, setPayTrxId] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    const [orderRes, itemsRes, timelineRes, paymentsRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number, status, payment_status, payment_method, source, subtotal, discount, shipping_cost, total, notes, consignment_id, tracking_status, created_at, customers(id, name, phone, address, email, city)")
        .eq("id", orderId)
        .single(),
      supabase
        .from("order_items")
        .select("id, product_name, quantity, unit_price, line_total, product_id")
        .eq("order_id", orderId),
      supabase
        .from("order_timeline")
        .select("id, event, description, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false }),
      supabase
        .from("order_payments")
        .select("id, method, amount, trx_id, notes, created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false }),
    ]);

    const o = orderRes.data as unknown as OrderDetail | null;
    if (o) {
      setOrder(o);
      setStatus(o.status);
      setCustomerName(o.customers?.name || "");
      setCustomerPhone(o.customers?.phone || "");
      setCustomerAddress(o.customers?.address || "");
      setCustomerEmail(o.customers?.email || "");
      setDiscount(o.discount || 0);
      setShippingCost(o.shipping_cost || 0);
      setNotes(o.notes || "");
    }
    const li = (itemsRes.data || []) as unknown as LineItem[];
    setItems(li);
    setEditedItems(li.map((i) => ({ ...i })));
    setDeletedItemIds([]);
    setTimeline((timelineRes.data || []) as unknown as TimelineEntry[]);
    setPayments((paymentsRes.data || []) as unknown as PaymentEntry[]);
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
      // Update order
      await supabase
        .from("orders")
        .update({
          status,
          discount,
          shipping_cost: shippingCost,
          subtotal: computedSubtotal,
          total: computedTotal,
          notes,
        })
        .eq("id", order.id);

      // Update customer
      if (order.customers?.id) {
        await supabase
          .from("customers")
          .update({ name: customerName, phone: customerPhone, address: customerAddress, email: customerEmail })
          .eq("id", order.customers.id);
      }

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
        await supabase.from("order_timeline").insert({
          order_id: order.id,
          event: "status_changed",
          description: `Status changed from "${order.status}" to "${status}"`,
        });
      }

      toast.success("Order updated successfully");
      onSaved?.();
      load();
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- Add payment ---------- */

  const addPayment = async () => {
    if (!order || !payAmount) return;
    await supabase.from("order_payments").insert({
      order_id: order.id,
      method: payMethod,
      amount: parseFloat(payAmount),
      trx_id: payTrxId || null,
      notes: payNotes || null,
    });
    await supabase.from("order_timeline").insert({
      order_id: order.id,
      event: "payment_logged",
      description: `Payment of ৳${parseFloat(payAmount).toLocaleString()} via ${payMethod}${payTrxId ? ` (TrxID: ${payTrxId})` : ""}`,
    });
    setPayAmount("");
    setPayTrxId("");
    setPayNotes("");
    toast.success("Payment logged");
    load();
  };

  /* ---------- Render ---------- */

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col p-0 gap-0">
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SheetTitle className="text-lg font-semibold">
                #{order?.order_number || "..."}
              </SheetTitle>
              {order && <FulfillmentBadge status={order.status} />}
            </div>
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
                          activeItems.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-sm font-medium">{item.product_name}</TableCell>
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
                          ))
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
                  </div>
                </section>

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
                      {payments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                          <div>
                            <div className="text-sm font-medium">৳{Number(p.amount).toLocaleString()} via {p.method}</div>
                            {p.trx_id && <div className="text-xs text-muted-foreground">TrxID: {p.trx_id}</div>}
                            {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
                          </div>
                          <span className="text-xs text-muted-foreground">{format(new Date(p.created_at), "MMM d, h:mm a")}</span>
                        </div>
                      ))}
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
                    {timeline.map((entry, idx) => (
                      <div key={entry.id} className="relative pb-6 last:pb-0">
                        <div className="absolute -left-6 top-0.5 flex items-center justify-center">
                          <CircleDot className="h-[18px] w-[18px] text-primary bg-background rounded-full" />
                        </div>
                        <div>
                          <p className="text-sm text-foreground">{entry.description}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {format(new Date(entry.created_at), "MMM d, yyyy · h:mm a")}
                          </p>
                        </div>
                      </div>
                    ))}
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
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="returned">Returned</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Badge helper                                                       */
/* ------------------------------------------------------------------ */

function FulfillmentBadge({ status }: { status: string }) {
  switch (status) {
    case "processing":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">Processing</Badge>;
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
