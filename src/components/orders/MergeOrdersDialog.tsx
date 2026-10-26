/**
 * Merge confirmation dialog (issue #30): same-customer, same-state,
 * PRE-ENTRY merge.
 *
 * Shows the merged preview computed by mergeOrders (items rollup, payment
 * union, totals, charge allocation) and performs the persistence on confirm:
 *  - insert ONE new orders row (status = merged.state; customer + money
 *    fields straight from merged.totals),
 *  - insert merged.items as order_items,
 *  - UPDATE order_payments.order_id to the new order for merged.payments[].id
 *    (NEVER re-insert payment rows — money duplication hazard),
 *  - mark the source orders "merged" + link them via parent_order_id (no
 *    deleted_at; they leave the active list through their status),
 *  - timeline entries on sources + merged order, audit via logAction.
 *
 * Eligibility (checkMergeEligibility) gates the confirm action; block reasons
 * are rendered instead of a partial merge. In particular "entered" keeps
 * consignmented orders out of merges — pre-entry only (ADR-0002).
 */

import { useMemo, useState, type ReactNode } from "react";
import { Loader2, AlertTriangle, Combine } from "lucide-react";
import {
  mergeOrders,
  type MergeBlock,
  type MergeOrder,
  type MergeOutcome,
  type MergedOrder,
} from "@/lib/orderMerge";
import {
  buildMergeAuditDetails,
  buildMergeTimelineEntries,
  buildMergedItemRows,
  buildMergedOrderRow,
  buildSourceOrderUpdate,
  describeChargeAllocation,
  describeMergeBlock,
  formatOrderNumberList,
  mergedPaymentIds,
} from "@/lib/mergePersistence";
import { supabase } from "@/integrations/supabase/client";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { logAction } from "@/lib/auditLog";
import { getActiveCurrency, symbolFor } from "@/lib/currency";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

/* ────────────────────────── data loading ────────────────────────── */

/**
 * Load the full MergeOrder shape (money fields, items, payments) for the given
 * order ids. The Orders page groups with a minimal shape; this fetch is what
 * the preview and the persistence need.
 */
export async function fetchMergeOrderDetails(orderIds: string[]): Promise<MergeOrder[]> {
  const [ordersRes, itemsRes, paymentsRes] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_number, status, consignment_id, deleted_at, customer_name, customer_phone, subtotal, discount, shipping_cost, tax_amount, total"
      )
      .in("id", orderIds),
    supabase
      .from("order_items")
      .select("order_id, product_id, variation_id, product_name, quantity, unit_price, discount, line_total")
      .in("order_id", orderIds),
    supabase
      .from("order_payments")
      .select("id, order_id, amount, method, trx_id, notes, created_at")
      .in("order_id", orderIds),
  ]);
  if (ordersRes.error) throw ordersRes.error;
  if (itemsRes.error) throw itemsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const itemsByOrder = new Map<string, MergeOrder["items"]>();
  for (const it of itemsRes.data || []) {
    const bucket = itemsByOrder.get(it.order_id) ?? [];
    bucket.push({
      product_id: it.product_id ?? null,
      variation_id: it.variation_id ?? null,
      product_name: it.product_name,
      quantity: Number(it.quantity) || 0,
      unit_price: Number(it.unit_price) || 0,
      discount: Number(it.discount) || 0,
      line_total: Number(it.line_total) || 0,
    });
    itemsByOrder.set(it.order_id, bucket);
  }
  const paymentsByOrder = new Map<string, MergeOrder["payments"]>();
  for (const p of paymentsRes.data || []) {
    const bucket = paymentsByOrder.get(p.order_id) ?? [];
    bucket.push({
      id: p.id,
      amount: Number(p.amount) || 0,
      method: p.method,
      trx_id: p.trx_id ?? null,
      notes: p.notes ?? null,
      created_at: p.created_at ?? null,
    });
    paymentsByOrder.set(p.order_id, bucket);
  }

  return (ordersRes.data || []).map((o) => ({
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    consignment_id: o.consignment_id ?? null,
    deleted_at: o.deleted_at ?? null,
    customer_name: o.customer_name ?? null,
    customer_phone: o.customer_phone ?? null,
    subtotal: Number(o.subtotal) || 0,
    discount: Number(o.discount) || 0,
    shipping_cost: Number(o.shipping_cost) || 0,
    tax_amount: Number(o.tax_amount) || 0,
    total: Number(o.total) || 0,
    items: itemsByOrder.get(o.id) ?? [],
    payments: paymentsByOrder.get(o.id) ?? [],
  }));
}

/* ────────────────────────── persistence ────────────────────────── */

async function rollbackNewOrder(newOrderId: string) {
  // Best-effort cleanup of a half-created merged order. Only used BEFORE any
  // payment rows were moved, so deleting the order cannot orphan money.
  await supabase.from("order_items").delete().eq("order_id", newOrderId);
  await supabase.from("orders").delete().eq("id", newOrderId);
}

/**
 * Persist a confirmed merge. Money safety (ADR-0002): payment records are
 * MOVED with an UPDATE — never re-inserted — so existing money can never be
 * duplicated.
 */
async function persistMerge(merged: MergedOrder): Promise<{ orderId: string; orderNumber: string }> {
  // Order number for the merged order, same generator as AddOrderDialog.
  const { data: sourceRow } = await supabase
    .from("orders")
    .select("store_id")
    .eq("id", merged.source_order_ids[0])
    .single();
  const { data: genNum, error: numErr } = await supabase.rpc(
    "generate_pos_order_number" as any,
    { p_store_id: (sourceRow as any)?.store_id ?? null, p_source: "manual" }
  );
  if (numErr) throw numErr;
  const orderNumber = (genNum as string) || `ORD-${Date.now().toString(36).toUpperCase()}`;

  // 1. ONE new orders row (status = merged.state; money straight from totals).
  const { data: newOrder, error: insErr } = await supabase
    .from("orders")
    .insert(buildMergedOrderRow(merged, orderNumber) as any)
    .select("id")
    .single();
  if (insErr || !newOrder) throw insErr || new Error("Failed to create merged order");

  // 2. merged.items as order_items.
  const itemRows = buildMergedItemRows(newOrder.id, merged.items);
  if (itemRows.length > 0) {
    const { error } = await supabase.from("order_items").insert(itemRows as any);
    if (error) {
      await rollbackNewOrder(newOrder.id);
      throw error;
    }
  }

  // 3. MOVE payment records to the merged order (UPDATE — never INSERT).
  const paymentIds = mergedPaymentIds(merged.payments);
  if (paymentIds.length > 0) {
    const { error } = await supabase
      .from("order_payments")
      .update({ order_id: newOrder.id })
      .in("id", paymentIds);
    if (error) throw error; // single statement — nothing moved on failure
  }

  // 4. Source orders: status "merged" + parent_order_id → merged order.
  //    NO deleted_at (trash auto-purges after 15 days).
  const { error: srcErr } = await supabase
    .from("orders")
    .update(buildSourceOrderUpdate(newOrder.id))
    .in("id", merged.source_order_ids);
  if (srcErr) throw srcErr;

  // 5. Timeline on the merged order + every source (source numbers + allocation).
  await addOrderTimeline(buildMergeTimelineEntries(merged, newOrder.id, orderNumber));

  // 6. Audit trail for the whole merge.
  await logAction("merge", "order", newOrder.id, buildMergeAuditDetails(merged, newOrder.id, orderNumber));

  return { orderId: newOrder.id, orderNumber };
}

/* ────────────────────────── block-reason UI ────────────────────────── */

/** Renders eligibility block reasons in plain language (Merge gate copy). */
export function MergeBlockList({
  blocks,
  orderNumberById,
}: {
  blocks: MergeBlock[];
  orderNumberById: Map<string, string>;
}) {
  return (
    <div className="space-y-1">
      {blocks.map((b, i) => (
        <p key={`${b.reason}-${b.order_id ?? i}`} className="text-xs text-destructive flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{describeMergeBlock(b, orderNumberById)}</span>
        </p>
      ))}
    </div>
  );
}

/* ────────────────────────── dialog ────────────────────────── */

interface MergeOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full source orders (fetched with fetchMergeOrderDetails). */
  orders: MergeOrder[];
  /** Called after a successful merge — reload the order list. */
  onMerged: () => void;
}

export default function MergeOrdersDialog({
  open,
  onOpenChange,
  orders,
  onMerged,
}: MergeOrdersDialogProps) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const outcome: MergeOutcome = useMemo(() => mergeOrders(orders), [orders]);
  const orderNumberById = useMemo(
    () => new Map(orders.map((o) => [o.id, o.order_number])),
    [orders]
  );
  const sym = symbolFor(getActiveCurrency());
  const money = (n: number) => `${sym}${Number(n).toLocaleString()}`;

  // Narrow the MergeOutcome once here — the JSX below reads plain values.
  // (Explicit Extract cast on the false branch: tsc mis-narrows `!outcome.ok`.)
  let mergedPreview: MergedOrder | null = null;
  let mergeBlocks: MergeBlock[] = [];
  if (!outcome.ok) {
    mergeBlocks = (outcome as Extract<MergeOutcome, { ok: false }>).eligibility.blocks;
  } else {
    mergedPreview = outcome.merged;
  }

  const handleConfirm = async () => {
    if (!outcome.ok || submitting) return;
    setSubmitting(true);
    try {
      const { orderNumber } = await persistMerge(outcome.merged);
      toast({
        title: "Orders merged",
        description: `#${orderNumber} created from ${formatOrderNumberList(outcome.merged.source_order_numbers)}.`,
      });
      onMerged();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Merge failed",
        description: e?.message ? String(e.message) : String(e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Combine className="h-4 w-4" /> Merge {orders.length} orders
          </DialogTitle>
          <DialogDescription>
            Combine {formatOrderNumberList(orders.map((o) => o.order_number))} into one order
            that takes ALL items and payment records (GLOSSARY &ldquo;Merge&rdquo;). Existing
            money is never duplicated or re-created. Source orders become read-only history
            (&ldquo;merged&rdquo;) and leave the active list.
          </DialogDescription>
        </DialogHeader>

        {mergedPreview ? (
          <MergedPreview merged={mergedPreview} money={money} />
        ) : (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-medium mb-1.5">This group cannot be merged:</p>
            <MergeBlockList blocks={mergeBlocks} orderNumberById={orderNumberById} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!outcome.ok || submitting}
          >
            {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Merge {orders.length} orders
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────── merged preview ────────────────────────── */

function MergedPreview({ merged, money }: { merged: MergedOrder; money: (n: number) => string }) {
  const numberById = new Map(merged.source_order_ids.map((id, i) => [id, merged.source_order_numbers[i]]));
  return (
    <div className="space-y-4">
      {/* Sources */}
      <section>
        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">Source orders</h4>
        <div className="flex flex-wrap gap-1.5">
          {merged.source_order_numbers.map((n) => (
            <Badge key={n} variant="secondary">#{n}</Badge>
          ))}
        </div>
      </section>

      {/* Items rollup */}
      <section>
        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">
          Items rollup ({merged.items.length})
        </h4>
        <div className="rounded-md border divide-y">
          {merged.items.map((it, i) => (
            <div key={`${it.product_name}-${it.unit_price}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <span className="truncate">{it.product_name}</span>
              <span className="text-muted-foreground whitespace-nowrap">
                {it.quantity} × {money(it.unit_price)}
              </span>
              <span className="font-medium whitespace-nowrap">{money(it.line_total)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Payment union */}
      <section>
        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">
          Payment records ({merged.payments.length} — moved, never re-created)
        </h4>
        {merged.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payment records on the source orders.</p>
        ) : (
          <div className="rounded-md border divide-y">
            {merged.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <span>
                  {p.method}
                  {p.trx_id ? <span className="text-muted-foreground"> · trx {p.trx_id}</span> : null}
                  <span className="text-muted-foreground"> · from #{numberById.get(p.source_order_id) ?? p.source_order_id}</span>
                </span>
                <span className="font-medium whitespace-nowrap">{money(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Totals */}
      <section>
        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">Totals</h4>
        <div className="rounded-md border px-3 py-2 text-sm space-y-1">
          <Row label="Subtotal" value={money(merged.totals.subtotal)} />
          <Row label="Discount" value={`-${money(merged.totals.discount)}`} />
          <Row label="Shipping" value={money(merged.totals.shipping_cost)} />
          <Row label="Tax" value={money(merged.totals.tax_amount)} />
          <div className="flex justify-between border-t pt-1 font-semibold">
            <span>Total (sum of source totals)</span>
            <span>{money(merged.totals.total)}</span>
          </div>
          <Row label="Paid (payment union)" value={money(merged.totals.total_paid)} />
          <Row label="To collect" value={money(merged.totals.amount_to_collect)} />
          <Row
            label="Payment status"
            value={<Badge variant="outline" className="capitalize">{merged.totals.payment_status}</Badge>}
          />
        </div>
      </section>

      {/* Charge allocation (ADR-0002) */}
      <section>
        <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">
          Charge allocation (each source in full)
        </h4>
        <p className="text-xs text-muted-foreground">
          {describeChargeAllocation(merged.charge_allocation)} — every source&apos;s charges are
          allocated to the single merged order; none dropped, none duplicated.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
