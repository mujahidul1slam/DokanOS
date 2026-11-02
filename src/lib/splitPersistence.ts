/**
 * Order split — persistence wiring for issue #31
 * ("Order split with payment transfer + charge allocation").
 *
 * The money semantics live in @/lib/orderSplit and are authoritative: this
 * module only maps an already-computed {@link SplitPlan} onto database rows.
 * Field conventions follow the app's money model (see src/lib/orderMerge.ts):
 *   - order_items.line_total = quantity * unit_price - discount (money-exact
 *     net of the line discount) — exactly the plan line's `lineNet`;
 *   - orders.subtotal = sum of line totals (the plan's `itemSubtotal`);
 *   - orders.total = subtotal - discount + shipping + tax (the plan's `total`,
 *     where the order's `tax_amount` is the single "other charge" of a split).
 *
 * Payment persistence follows the plan EXACTLY — existing money is never
 * duplicated:
 *   - "kept"        → the source payment row is left alone, or its amount is
 *                     UPDATEd down to the kept amount (deleted when 0);
 *   - "transferred" → the source row is UPDATEd (deleted when 0) and a NEW row
 *                     is inserted on the child order — money is MOVED;
 *   - "new"         → a new row on the child order only.
 *
 * Issue #27 gate wiring (docs/adr/0001-woo-online-payment-gate.md): a split
 * must never launder the WooCommerce online-payment gate. Concretely:
 *   - the parent's `status`, `payment_method` and courier fields are NEVER
 *     written (gated orders cannot change status/courier);
 *   - the parent's `payment_status` is only recomputed with the sanctioned
 *     semantics, which preserve the unconfirmed "online" marker (and "cod") —
 *     so a gated parent stays gated after any split;
 *   - the child order is evaluated with `evaluatePaymentGate` on ITS OWN
 *     payment fields; if that says gated, the child is created in
 *     "payment_pending" (locked) instead of a working status.
 *
 * The pure helpers at the top are unit-tested in src/test/splitPersistence.test.ts.
 */

import { supabase } from "@/integrations/supabase/client";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { logAction } from "@/lib/auditLog";
import { evaluatePaymentGate } from "@/lib/paymentGate";
import { kickSyncWorker } from "@/lib/wooNotes";
import {
  type SplitPaymentAssignment,
  type SplitPlan,
  type SplitPlanLine,
  type SplitPlanOrder,
  type SplitPlanPayment,
} from "@/lib/orderSplit";

/** Floating point tolerance for money comparisons at the row boundary. */
const EPS = 0.0001;

/** The single "other charge" of an order in this app's money model. */
export const SPLIT_TAX_CHARGE_ID = "tax";
const SPLIT_TAX_LABEL = "Tax / VAT";

/** Child-order source value: a manually created split order (cf. "exchange"). */
export const SPLIT_ORDER_SOURCE = "split";

/* ------------------------------------------------------------------ */
/*  Row shapes (minimal DB rows this module reads or writes)           */
/* ------------------------------------------------------------------ */

export interface SplitSourceItemRow {
  id: string;
  product_id: string | null;
  variation_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  /** order_items.discount — the line discount already applied. */
  discount: number | null;
}

export interface SplitSourcePaymentRow {
  id: string;
  method: string;
  amount: number;
  trx_id: string | null;
}

/** Everything the split needs to know about the order being split. */
export interface SplitParentOrder {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  store_id: string | null;
  order_source_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_email: string | null;
  customer_city: string | null;
  fulfillment_type: string;
  subtotal: number;
  discount: number | null;
  shipping_cost: number | null;
  tax_amount: number | null;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                      */
/* ------------------------------------------------------------------ */

/** Tax share of one resulting order (0 when the split carries no tax charge). */
export function splitTaxOf(order: SplitPlanOrder): number {
  return order.otherCharges.find((c) => c.id === SPLIT_TAX_CHARGE_ID)?.amount ?? 0;
}

/**
 * Payment-state derivation for money-carrying orders, mirroring the sheet's
 * recomputePaymentStatus with the markers it must not clobber:
 *   - "online" (issue #27: unconfirmed Woo payment) is preserved unconditionally:
 *     the gate is released only by RECORDING a payment through the sanctioned
 *     confirm-payment flow — never by a split's recomputation side effect;
 *   - "cod" is a cash-on-delivery arrangement, not an unpaid state;
 *   - "refunded" is a terminal money state and survives corrections.
 */
export function deriveSplitPaymentState(
  currentStatus: string,
  total: number,
  totalPaid: number,
): string {
  if (currentStatus === "refunded") return "refunded";
  if (currentStatus === "online") return "online";
  if (totalPaid <= EPS) {
    return currentStatus === "cod" ? currentStatus : "unpaid";
  }
  return totalPaid >= total - EPS ? "paid" : "partial";
}

/**
 * The source payment row ops that realise plan.original.payments: the
 * transferred rows shrink (UPDATE amount) and disappear when emptied
 * (DELETE). Rows that keep their amount are untouched — existing money is
 * never re-inserted or duplicated.
 */
export function splitSourcePaymentOps(
  sourcePayments: SplitSourcePaymentRow[],
  plan: SplitPlan,
): Array<{ kind: "update"; id: string; amount: number } | { kind: "delete"; id: string }> {
  const ops: Array<{ kind: "update"; id: string; amount: number } | { kind: "delete"; id: string }> = [];
  for (const row of sourcePayments) {
    const kept = plan.original.payments.find((p) => p.sourcePaymentId === row.id);
    const keptAmount = kept ? kept.amount : row.amount;
    if (keptAmount <= EPS) {
      ops.push({ kind: "delete", id: row.id });
    } else if (Math.abs(keptAmount - Number(row.amount)) > EPS) {
      ops.push({ kind: "update", id: row.id, amount: keptAmount });
    }
  }
  return ops;
}

/** order_payments rows to insert on the child order (from plan.newOrder.payments). */
export function splitChildPaymentRows(
  childOrderId: string,
  parentOrderNumber: string,
  planNewPayments: SplitPlanPayment[],
  sourcePayments: SplitSourcePaymentRow[],
  newPaymentTrxId?: string | null,
): Array<{ order_id: string; method: string; amount: number; trx_id: string | null; notes: string }> {
  return planNewPayments.map((p) => {
    const src = p.sourcePaymentId
      ? sourcePayments.find((r) => r.id === p.sourcePaymentId)
      : undefined;
    return {
      order_id: childOrderId,
      method: p.method,
      amount: p.amount,
      // The money's transaction identity follows it; a genuinely new payment
      // carries the TrxID entered at split time (if any).
      trx_id: src?.trx_id ?? newPaymentTrxId ?? null,
      notes:
        p.kind === "transferred"
          ? `Transferred from order #${parentOrderNumber} (order split)`
          : `Collected for order #${parentOrderNumber} (order split)`,
    };
  });
}

/** order_items rows to insert on the child order (from plan.newOrder.items). */
export function splitChildItemRows(
  childOrderId: string,
  planNewItems: SplitPlanLine[],
  sourceItems: SplitSourceItemRow[],
): Array<{
  order_id: string;
  product_id: string | null;
  variation_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
}> {
  return planNewItems.map((line) => {
    const src = sourceItems.find((r) => r.id === line.itemId);
    return {
      order_id: childOrderId,
      product_id: src?.product_id ?? null,
      variation_id: src?.variation_id ?? null,
      product_name: line.productName,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      discount: line.lineDiscount,
      line_total: line.lineNet,
    };
  });
}

/**
 * order_items updates for the rows the original keeps: quantities and
 * discounts follow plan.original.items; line_total stays money-exact
 * (quantity * unit_price - discount).
 */
export function splitParentItemUpdates(
  planOriginalItems: SplitPlanLine[],
): Array<{ id: string; quantity: number; discount: number; line_total: number }> {
  return planOriginalItems.map((line) => ({
    id: line.itemId,
    quantity: line.quantity,
    discount: line.lineDiscount,
    line_total: line.lineNet,
  }));
}

/** Source item rows that moved away entirely and must leave the original. */
export function splitParentItemDeletes(sourceItems: SplitSourceItemRow[], plan: SplitPlan): string[] {
  const keptIds = new Set(plan.original.items.map((i) => i.itemId));
  return sourceItems.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
}

/**
 * The orders.update patch for the ORIGINAL order. Money fields come straight
 * from plan.original. `status`, `payment_method` and courier fields are NEVER
 * part of the patch: the #27 gate locks those, and a split must not launder it.
 */
export function splitParentOrderPatch(
  plan: SplitPlan,
  parent: Pick<SplitParentOrder, "payment_status">,
): {
  subtotal: number;
  discount: number;
  shipping_cost: number;
  tax_amount: number;
  total: number;
  payment_status: string;
  amount_to_collect: number;
} {
  const totalPaid = plan.original.paid;
  return {
    subtotal: plan.original.itemSubtotal,
    discount: plan.original.discount,
    shipping_cost: plan.original.shipping,
    tax_amount: splitTaxOf(plan.original),
    total: plan.original.total,
    payment_status: deriveSplitPaymentState(parent.payment_status, plan.original.total, totalPaid),
    amount_to_collect: Math.max(plan.original.total - totalPaid, 0),
  };
}

/** The payment fields of the child order, straight from the plan's payment case. */
export function splitChildPaymentFields(
  plan: SplitPlan,
  assignment: SplitPaymentAssignment,
  sourcePayments: SplitSourcePaymentRow[],
): { payment_status: string; payment_method: string | null } {
  const totalPaid = plan.newOrder.paid;
  if (assignment.kind === "cod") {
    return { payment_status: "cod", payment_method: "Cash on Delivery" };
  }
  if (assignment.kind === "new-payment") {
    return {
      payment_status: deriveSplitPaymentState("unpaid", plan.newOrder.total, totalPaid),
      payment_method: assignment.method,
    };
  }
  const sourceMethod =
    sourcePayments.find((r) => r.id === assignment.sourcePaymentId)?.method ??
    plan.newOrder.payments[0]?.method ??
    null;
  return {
    payment_status: deriveSplitPaymentState("unpaid", plan.newOrder.total, totalPaid),
    payment_method: sourceMethod,
  };
}

/**
 * The workflow status of the child order. A split child is a NEW independent
 * order (GLOSSARY "Split"), so it enters the New Order flow ("processing") —
 * unless the #27 gate rules say the child's own payment fields are gated, in
 * which case it is created in "payment_pending" (locked), never laundered
 * into a working order.
 */
export function splitChildStatus(childFields: {
  source: string;
  payment_method: string | null;
  payment_status: string;
}): string {
  return evaluatePaymentGate(childFields).gated ? "payment_pending" : "processing";
}

/** The orders.insert row for the new order, linked via parent_order_id. */
export function splitChildOrderFields(
  parent: SplitParentOrder,
  plan: SplitPlan,
  assignment: SplitPaymentAssignment,
  childOrderNumber: string,
  sourcePayments: SplitSourcePaymentRow[],
): Record<string, unknown> {
  const { payment_status, payment_method } = splitChildPaymentFields(plan, assignment, sourcePayments);
  const childFields = { source: SPLIT_ORDER_SOURCE, payment_method, payment_status };
  return {
    store_id: parent.store_id,
    order_source_id: parent.order_source_id,
    customer_id: parent.customer_id,
    customer_name: parent.customer_name,
    customer_phone: parent.customer_phone,
    customer_address: parent.customer_address,
    customer_email: parent.customer_email,
    customer_city: parent.customer_city,
    order_number: childOrderNumber,
    source: SPLIT_ORDER_SOURCE,
    is_exchange: false,
    parent_order_id: parent.id,
    status: splitChildStatus(childFields),
    fulfillment_type: parent.fulfillment_type || "delivery",
    payment_status,
    payment_method,
    subtotal: plan.newOrder.itemSubtotal,
    discount: plan.newOrder.discount,
    shipping_cost: plan.newOrder.shipping,
    tax_amount: splitTaxOf(plan.newOrder),
    total: plan.newOrder.total,
    amount_to_collect: Math.max(plan.newOrder.total - plan.newOrder.paid, 0),
    item_qty: plan.newOrder.items.reduce((s, i) => s + i.quantity, 0),
    notes: `Split from order #${parent.order_number}`,
    // The child is created manually and must never look like a WooCommerce
    // order (woo_order_id stays NULL) — no Woo sync can pick it up.
  };
}

/* ------------------------------------------------------------------ */
/*  Orchestration                                                     */
/* ------------------------------------------------------------------ */

export interface PersistSplitArgs {
  parent: SplitParentOrder;
  sourceItems: SplitSourceItemRow[];
  sourcePayments: SplitSourcePaymentRow[];
  plan: SplitPlan;
  assignment: SplitPaymentAssignment;
  /** Optional TrxID for the "new-payment" case's payment row. */
  newPaymentTrxId?: string | null;
}

export interface PersistSplitResult {
  newOrderId: string;
  newOrderNumber: string;
}

/**
 * Persist one split exactly as the plan says:
 *   1. insert ONE new orders row (parent_order_id = original, source "split");
 *   2. insert the moved order_items on the new order;
 *   3. update the original's item quantities/discounts (delete fully moved rows);
 *   4. payments per plan: transferred money MOVES (source row UPDATEd, deleted
 *      when 0, one new row on the child) — existing money is never duplicated;
 *   5. totals/shipping/discount/subtotal for BOTH orders from the plan;
 *   6. timeline + audit entries on BOTH orders.
 */
export async function persistOrderSplit(args: PersistSplitArgs): Promise<PersistSplitResult> {
  const { parent, sourceItems, sourcePayments, plan, assignment } = args;
  const newPaymentTrxId = args.newPaymentTrxId ?? null;

  // 1. New order number — same generator as Add Order / Exchange, with the
  //    split marker the "EXCH-" prefix gives exchange orders.
  const { data: numData, error: numErr } = await supabase.rpc("generate_pos_order_number", {
    p_store_id: parent.store_id,
    p_source: "manual",
  });
  if (numErr) throw numErr;
  const childOrderNumber = `SPLIT-${parent.order_number}-${String(numData || "").slice(-4) || Date.now().toString().slice(-4)}`;

  // 2. The child order row.
  const childFields = splitChildOrderFields(parent, plan, assignment, childOrderNumber, sourcePayments);
  const { data: child, error: insErr } = await supabase
    .from("orders")
    .insert(childFields as any)
    .select("id")
    .single();
  if (insErr || !child) throw insErr || new Error("Failed to create the split order");
  const childId = (child as { id: string }).id;

  // 3. Moved items onto the child.
  const childItemRows = splitChildItemRows(childId, plan.newOrder.items, sourceItems);
  if (childItemRows.length > 0) {
    const { error } = await supabase.from("order_items").insert(childItemRows as any);
    if (error) throw error;
  }

  // 4. The original's kept items: quantities/discounts per plan.original.items.
  for (const u of splitParentItemUpdates(plan.original.items)) {
    const { error } = await supabase
      .from("order_items")
      .update({ quantity: u.quantity, discount: u.discount, line_total: u.line_total })
      .eq("id", u.id);
    if (error) throw error;
  }
  const movedAwayIds = splitParentItemDeletes(sourceItems, plan);
  if (movedAwayIds.length > 0) {
    const { error } = await supabase.from("order_items").delete().in("id", movedAwayIds);
    if (error) throw error;
  }

  // 5. Payments — EXACTLY per the plan; existing money is never duplicated.
  for (const op of splitSourcePaymentOps(sourcePayments, plan)) {
    const { error } =
      op.kind === "delete"
        ? await supabase.from("order_payments").delete().eq("id", op.id)
        : await supabase.from("order_payments").update({ amount: op.amount }).eq("id", op.id);
    if (error) throw error;
  }
  const childPaymentRows = splitChildPaymentRows(childId, parent.order_number, plan.newOrder.payments, sourcePayments, newPaymentTrxId);
  if (childPaymentRows.length > 0) {
    const { error } = await supabase.from("order_payments").insert(childPaymentRows as any);
    if (error) throw error;
  }

  // 6. Totals for the original — money fields only, never status/courier.
  const parentPatch = splitParentOrderPatch(plan, parent);
  const { error: updErr } = await supabase.from("orders").update(parentPatch as any).eq("id", parent.id);
  if (updErr) throw updErr;

  // 7. Timeline + audit on BOTH orders (precedent: ExchangeDialog).
  const movedDesc = plan.newOrder.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ");
  const payDesc =
    assignment.kind === "cod"
      ? "new order is cash-on-delivery (no money moved)"
      : assignment.kind === "new-payment"
        ? `new payment of ${assignment.amount} via ${assignment.method} on the new order`
        : `${assignment.amount} transferred to the new order from this order's ${sourcePayments.find((p) => p.id === assignment.sourcePaymentId)?.method ?? "payment"}`;
  await addOrderTimeline([
    {
      order_id: parent.id,
      event: "order_split",
      description: `Order split — ${movedDesc} moved to new order #${childOrderNumber}; ${payDesc}`,
      metadata: {
        new_order_id: childId,
        new_order_number: childOrderNumber,
        moved_items: plan.newOrder.items.map((i) => ({ item_id: i.itemId, product_name: i.productName, quantity: i.quantity })),
        payment_case: assignment.kind,
        original_total: plan.original.total,
        new_order_total: plan.newOrder.total,
        warnings: plan.warnings,
      },
    },
    {
      order_id: childId,
      event: "created_by_split",
      description: `Created by splitting order #${parent.order_number} — ${movedDesc}`,
      metadata: {
        parent_order_id: parent.id,
        parent_order_number: parent.order_number,
        payment_case: assignment.kind,
        moved_items: plan.newOrder.items.map((i) => ({ item_id: i.itemId, product_name: i.productName, quantity: i.quantity })),
        warnings: plan.warnings,
      },
    },
  ]);
  await logAction("split", "order", parent.id, {
    order_number: parent.order_number,
    new_order_id: childId,
    new_order_number: childOrderNumber,
    moved_items: plan.newOrder.items.map((i) => ({ item_id: i.itemId, product_name: i.productName, quantity: i.quantity })),
    payment_case: assignment.kind,
    before: {
      subtotal: parent.subtotal,
      discount: parent.discount,
      shipping_cost: parent.shipping_cost,
      tax_amount: parent.tax_amount,
      total: parent.total,
      payment_status: parent.payment_status,
    },
    after: parentPatch,
    warnings: plan.warnings,
  });
  await logAction("create", "order", childId, {
    order_number: childOrderNumber,
    parent_order_id: parent.id,
    parent_order_number: parent.order_number,
    payment_case: assignment.kind,
    payments: plan.newOrder.payments.map((p) => ({ kind: p.kind, method: p.method, amount: p.amount, source_payment_id: p.sourcePaymentId ?? null })),
    totals: {
      subtotal: plan.newOrder.itemSubtotal,
      discount: plan.newOrder.discount,
      shipping_cost: plan.newOrder.shipping,
      tax_amount: splitTaxOf(plan.newOrder),
      total: plan.newOrder.total,
    },
    warnings: plan.warnings,
  });

  // 8. The original's line items changed — same Woo push convention as the
  //    item edits in OrderDetailSheet.handleSave (silent no-op for non-Woo).
  try {
    await supabase.rpc("enqueue_order_push", {
      p_order_id: parent.id,
      p_reason: "items_updated",
    });
    void kickSyncWorker();
  } catch (e) {
    console.warn("Woo push enqueue after split failed:", e);
  }

  return { newOrderId: childId, newOrderNumber: childOrderNumber };
}
