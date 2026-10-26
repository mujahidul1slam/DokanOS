/**
 * Merge persistence payloads + timeline/audit text (issue #30) — pure
 * builders, no React and no Supabase, like src/lib/orderMerge.ts.
 *
 * The actual database calls live in
 * src/components/orders/MergeOrdersDialog.tsx (fetch + persist on confirm).
 * Keeping every written row/text here makes the money contract unit-testable:
 *
 * Persistence contract (issue #30, docs/adr/0002-order-merge-split-payment-semantics.md):
 *  - Insert ONE new orders row: status = merged.state, customer + money
 *    fields straight from merged.totals.
 *  - Insert merged.items as order_items of the new order.
 *  - MOVE the existing order_payments rows (UPDATE order_id to the new order
 *    for merged.payments[].id) — NEVER re-insert payment rows, that would
 *    duplicate money.
 *  - Mark source orders merged and out of the active list WITHOUT deleted_at
 *    (trash auto-purges after 15 days): status = "merged" and
 *    parent_order_id = the new order.
 *  - Timeline entries on every source and on the merged order, plus one audit
 *    entry.
 */

import type {
  ChargeAllocation,
  MergeBlock,
  MergedItem,
  MergedOrder,
  MergedPayment,
} from "@/lib/orderMerge";

/**
 * The status that marks a source order as absorbed by a merge (issue #30).
 * Merged sources are historical records: tabFilters shows them ONLY under the
 * "all" tab and never in an active tab.
 */
export const MERGED_STATUS = "merged";

/** #A, #B, #C — the source-order list used in timeline/audit text. */
export function formatOrderNumberList(orderNumbers: string[]): string {
  return orderNumbers.map((n) => `#${n}`).join(", ");
}

/** Human-readable money amount for timeline text (no currency symbol; the
 *  currency is applied at render time, this is only row text). */
function fmtAmount(n: number): string {
  return Number(n).toLocaleString();
}

/**
 * ONE new orders row for the merged order. Status keeps the shared source
 * state (merged.state); all money fields come straight from merged.totals.
 * parent_order_id stays NULL on the merged order — the linkage lives on the
 * SOURCE rows (they point at the merged order).
 */
export function buildMergedOrderRow(
  merged: MergedOrder,
  orderNumber: string
): Record<string, unknown> {
  return {
    order_number: orderNumber,
    status: merged.state,
    payment_status: merged.totals.payment_status,
    customer_name: merged.customer_name,
    customer_phone: merged.customer_phone,
    subtotal: merged.totals.subtotal,
    discount: merged.totals.discount,
    shipping_cost: merged.totals.shipping_cost,
    tax_amount: merged.totals.tax_amount,
    total: merged.totals.total,
    amount_to_collect: merged.totals.amount_to_collect,
    item_qty: merged.items.reduce((s, i) => s + i.quantity, 0),
    notes: `Merged from ${formatOrderNumberList(merged.source_order_numbers)}`,
  };
}

/** merged.items as order_items rows of the new order. */
export function buildMergedItemRows(
  mergedOrderId: string,
  items: MergedItem[]
): Record<string, unknown>[] {
  return items.map((i) => ({
    order_id: mergedOrderId,
    product_id: i.product_id,
    variation_id: i.variation_id,
    product_name: i.product_name,
    quantity: i.quantity,
    unit_price: i.unit_price,
    discount: i.discount,
    line_total: i.line_total,
  }));
}

/**
 * Ids of the payment records to MOVE to the merged order. The persistence
 * layer must UPDATE order_payments.order_id for exactly these ids — never
 * insert new payment rows (money duplication hazard, ADR-0002).
 */
export function mergedPaymentIds(payments: MergedPayment[]): string[] {
  return payments.map((p) => p.id);
}

/**
 * Source-order update payload: marked merged and linked to the merged order
 * via parent_order_id. NOTE: deliberately NO deleted_at — merged sources stay
 * out of the active list through their status, not through trash (trash rows
 * auto-purge after 15 days).
 */
export function buildSourceOrderUpdate(mergedOrderId: string): {
  status: string;
  parent_order_id: string;
} {
  return {
    status: MERGED_STATUS,
    parent_order_id: mergedOrderId,
  };
}

/** "…allocated to the merged order in full (#A: total 1,000; #B: total 2,000)" */
export function describeChargeAllocation(allocations: ChargeAllocation[]): string {
  return allocations
    .map((a) => `#${a.order_number}: total ${fmtAmount(a.total)}`)
    .join("; ");
}

/** One source's charge allocation in words (subtotal/discount/shipping/tax/total). */
export function describeChargeAllocationEntry(a: ChargeAllocation): string {
  return (
    `subtotal ${fmtAmount(a.subtotal)}, discount ${fmtAmount(a.discount)}, ` +
    `shipping ${fmtAmount(a.shipping_cost)}, tax ${fmtAmount(a.tax_amount)}, ` +
    `total ${fmtAmount(a.total)}`
  );
}

export interface MergeTimelineEntry {
  order_id: string;
  event: string;
  description: string;
  metadata: Record<string, unknown>;
}

/**
 * Timeline entries on every source order and on the merged order. The text is
 * built from merged.source_order_numbers + charge_allocation so both sides of
 * the merge record what happened to the money (ADR-0002: each source's charges
 * are allocated to the single resulting order in full).
 */
export function buildMergeTimelineEntries(
  merged: MergedOrder,
  mergedOrderId: string,
  mergedOrderNumber: string
): MergeTimelineEntry[] {
  const allNumbers = formatOrderNumberList(merged.source_order_numbers);
  const sharedMeta: Record<string, unknown> = {
    merged_order_id: mergedOrderId,
    merged_order_number: mergedOrderNumber,
    source_order_ids: merged.source_order_ids,
    source_order_numbers: merged.source_order_numbers,
    charge_allocation: merged.charge_allocation,
    totals: merged.totals,
    payment_ids: mergedPaymentIds(merged.payments),
    new_total: merged.totals.total,
  };

  const entries: MergeTimelineEntry[] = [
    {
      order_id: mergedOrderId,
      event: "merged",
      description:
        `Created by merging ${allNumbers} — all items and payment records carried over; ` +
        `each source's charges allocated to this order in full ` +
        `(${describeChargeAllocation(merged.charge_allocation)}); ` +
        `total ${fmtAmount(merged.totals.total)}`,
      metadata: sharedMeta,
    },
  ];

  for (const sourceId of merged.source_order_ids) {
    const sourceNumber =
      merged.source_order_numbers[merged.source_order_ids.indexOf(sourceId)] ?? sourceId;
    const others = merged.source_order_numbers.filter((n) => n !== sourceNumber);
    const allocation = merged.charge_allocation.find((a) => a.order_id === sourceId);
    entries.push({
      order_id: sourceId,
      event: "merged",
      description:
        `Merged into #${mergedOrderNumber}${others.length ? ` (with ${formatOrderNumberList(others)})` : ""} — ` +
        `this order's charges (${allocation ? describeChargeAllocationEntry(allocation) : "n/a"}) ` +
        `allocated to the merged order in full; this source is now history (status "merged")`,
      metadata: { ...sharedMeta, source_order_number: sourceNumber },
    });
  }

  return entries;
}

/** One audit entry for the whole merge (logAction "merge" on the new order). */
export function buildMergeAuditDetails(
  merged: MergedOrder,
  mergedOrderId: string,
  mergedOrderNumber: string
): Record<string, unknown> {
  return {
    merged_order_id: mergedOrderId,
    merged_order_number: mergedOrderNumber,
    source_order_ids: merged.source_order_ids,
    source_order_numbers: merged.source_order_numbers,
    charge_allocation: merged.charge_allocation,
    totals: merged.totals,
    item_count: merged.items.length,
    payment_ids_moved: mergedPaymentIds(merged.payments),
  };
}

/** Human-readable copy for an eligibility block, for the Merge gate UI. */
export function describeMergeBlock(
  block: MergeBlock,
  orderNumberById: Map<string, string>
): string {
  const num = (id?: string) =>
    id ? `#${orderNumberById.get(id) ?? id}` : "Order";
  switch (block.reason) {
    case "too_few_orders":
      return "Select at least two orders to merge.";
    case "missing_phone":
      return `${num(block.order_id)} has no verifiable customer phone — merge groups orders by customer phone.`;
    case "different_customer":
      return "These orders belong to different customers (matched by normalized phone).";
    case "different_state":
      return "These orders are in different states — only same-state orders can merge.";
    case "entered":
      return `${num(block.order_id)} is entered (holds an active consignment). Merges are pre-entry only (ADR-0002).`;
    case "duplicate_order":
      return `${num(block.order_id)} appears more than once.`;
    case "deleted":
      return `${num(block.order_id)} is in the trash.`;
    default:
      return "This group cannot be merged.";
  }
}
