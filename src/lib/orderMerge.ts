/**
 * Same-customer order grouping + merge — pure domain logic (issue #30).
 *
 * Settled semantics (docs/adr/0002-order-merge-split-payment-semantics.md):
 *  - Merge is PRE-ENTRY only: only not-entered orders (no active consignment)
 *    can merge. Post-entry merge is blocked by design.
 *  - The merged order takes ALL items and ALL payment records of the sources.
 *  - Existing money is NEVER duplicated: payment records are carried over as a
 *    union, never multiplied or re-created.
 *  - Charges (shipping/discount/tax) are allocated per resulting-order
 *    semantics: merge yields exactly one order, so every source's charges are
 *    allocated to it in full and the merged total equals the sum of the source
 *    totals.
 *
 * Keep this file dependency-free (no React, no Supabase) like
 * src/pages/orders/tabFilters.ts, so the money rules are trivial to unit-test.
 */

/** Minimal order_payments row shape. */
export interface MergePayment {
  id: string;
  amount: number;
  method: string;
  trx_id?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

/**
 * Minimal order_items row shape. `product_name` follows the WooCommerce
 * convention "Name - variationLabel" (e.g. "Cotton Shirt - L / Navy"; the
 * variation block may itself contain " - " and " / "), so the full string is
 * the item's identity — it is never parsed or split when aggregating.
 */
export interface MergeItem {
  product_id?: string | null;
  variation_id?: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount?: number | null;
  line_total: number;
}

/** Minimal orders row shape needed for grouping, eligibility and merge. */
export interface MergeOrder {
  id: string;
  order_number: string;
  status: string;
  /** Non-null/empty = Entered (holds an active consignment). */
  consignment_id?: string | null;
  deleted_at?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  subtotal: number;
  discount: number;
  shipping_cost: number;
  tax_amount?: number | null;
  total: number;
  items: MergeItem[];
  payments: MergePayment[];
}

/**
 * Canonical customer phone form: digits only, the leading "880" country code
 * stripped, and bare "1XXXXXXXXX" numbers restored to the "01XXXXXXXXX" form.
 * Mirrors supabase/functions/_shared/woo-mapping.ts `normalizePhone` so every
 * customer-matching surface agrees on identity.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/[^0-9]/g, "");
  if (!p) return null;
  if (p.startsWith("880") && p.length >= 13) p = p.slice(3);
  if (p.length === 10 && p.startsWith("1")) p = "0" + p;
  return p;
}

/**
 * GLOSSARY "Entered": an order booked with a courier, holding an active
 * consignment. A cancelled booking clears the consignment and returns the
 * order to not-entered (past consignments stay in its history), so the active
 * consignment is exactly orders.consignment_id being set.
 */
export function isEntered(order: MergeOrder): boolean {
  return !!order.consignment_id;
}

/** The customer-identity key merge groups by (normalized phone). */
export function customerKeyOf(order: MergeOrder): string | null {
  return normalizePhone(order.customer_phone);
}

export type MergeBlockReason =
  | "too_few_orders"
  | "missing_phone"
  | "different_customer"
  | "different_state"
  | "entered"
  | "duplicate_order"
  | "deleted";

export interface MergeBlock {
  reason: MergeBlockReason;
  /** The offending order, when the reason belongs to one specific order. */
  order_id?: string;
}

export interface MergeEligibility {
  eligible: boolean;
  /** Empty iff eligible. Deterministic order. */
  blocks: MergeBlock[];
}

/**
 * Pre-entry merge eligibility: combining two or more not-entered orders of the
 * same customer (verified by normalized phone) into one order. Orders in a
 * merge all come from one same-state group, so differing states are a block.
 */
export function checkMergeEligibility(orders: MergeOrder[]): MergeEligibility {
  const blocks: MergeBlock[] = [];

  if (orders.length < 2) blocks.push({ reason: "too_few_orders" });

  const seen = new Set<string>();
  for (const o of orders) {
    if (seen.has(o.id)) blocks.push({ reason: "duplicate_order", order_id: o.id });
    seen.add(o.id);
    if (o.deleted_at) blocks.push({ reason: "deleted", order_id: o.id });
    if (isEntered(o)) blocks.push({ reason: "entered", order_id: o.id });
    if (customerKeyOf(o) === null) blocks.push({ reason: "missing_phone", order_id: o.id });
  }

  const customerKeys = new Set(orders.map(customerKeyOf).filter((k): k is string => k !== null));
  if (customerKeys.size > 1) blocks.push({ reason: "different_customer" });

  const states = new Set(orders.map((o) => o.status));
  if (states.size > 1) blocks.push({ reason: "different_state" });

  return { eligible: blocks.length === 0, blocks };
}

export interface MergeGroup {
  customer_key: string;
  /** The shared order state (status) of every order in the group. */
  state: string;
  orders: MergeOrder[];
  /** Merge gate for this group: blocks say why Merge stays disabled. */
  eligibility: MergeEligibility;
}

/**
 * Same-customer grouping for the Orders page: 2+ orders of the same customer
 * (normalized phone) in the same state form one collapsible group; the Merge
 * action lives inside the group and is enabled per `eligibility`.
 *
 * Trashed orders and orders without a verifiable customer phone are never
 * grouped. Group and member order follow first appearance in `orders`.
 */
export function groupOrdersForMerge(orders: MergeOrder[]): MergeGroup[] {
  const byKey = new Map<string, MergeOrder[]>();
  for (const o of orders) {
    if (o.deleted_at) continue;
    const customerKey = customerKeyOf(o);
    if (customerKey === null) continue;
    const key = `${customerKey}\u0000${o.status}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(o);
    else byKey.set(key, [o]);
  }

  const groups: MergeGroup[] = [];
  for (const bucket of byKey.values()) {
    if (bucket.length < 2) continue;
    groups.push({
      customer_key: customerKeyOf(bucket[0])!,
      state: bucket[0].status,
      orders: bucket,
      eligibility: checkMergeEligibility(bucket),
    });
  }
  return groups;
}

/** One line of the merged order — always a sum of whole source lines. */
export interface MergedItem {
  product_id: string | null;
  variation_id: string | null;
  /** Full "Name - variationLabel" string, preserved verbatim. */
  product_name: string;
  quantity: number;
  unit_price: number;
  /** Sum of the aggregated source lines' discounts. */
  discount: number;
  /** Sum of the aggregated source lines' line totals — money-exact. */
  line_total: number;
}

/** A source payment record carried into the merged order unchanged. */
export interface MergedPayment {
  id: string;
  /** The source order this money originally belonged to. */
  source_order_id: string;
  amount: number;
  method: string;
  trx_id: string | null;
  notes: string | null;
  created_at: string | null;
}

/**
 * ADR-0002 charge allocation: merge has exactly one resulting order, so every
 * source order's charges are allocated to it in full (100%) — no charge is
 * dropped, none is duplicated. Σ charge_allocation === merged totals.
 */
export interface ChargeAllocation {
  order_id: string;
  order_number: string;
  subtotal: number;
  discount: number;
  shipping_cost: number;
  tax_amount: number;
  total: number;
}

export interface MergedOrderTotals {
  subtotal: number;
  discount: number;
  shipping_cost: number;
  tax_amount: number;
  /** Money-exact: always equals the sum of the source orders' totals. */
  total: number;
  /** Sum of the merged payment union — never duplicated money. */
  total_paid: number;
  /** max(total - total_paid, 0) — what is left to collect. */
  amount_to_collect: number;
  payment_status: "paid" | "partial" | "unpaid";
}

export interface MergedOrder {
  source_order_ids: string[];
  source_order_numbers: string[];
  customer_key: string;
  customer_name: string | null;
  customer_phone: string | null;
  /** The shared source state (status) the merged order keeps. */
  state: string;
  items: MergedItem[];
  payments: MergedPayment[];
  charge_allocation: ChargeAllocation[];
  totals: MergedOrderTotals;
}

export type MergeOutcome =
  | { ok: true; merged: MergedOrder }
  | { ok: false; eligibility: MergeEligibility };

const PAYMENT_EPSILON = 0.0001;

/**
 * Aggregate source lines into merged lines. Identity is the full
 * "Name - variationLabel" product_name at one unit price: identical lines
 * sum quantity, discount and line_total; anything else stays its own line so
 * every line_total remains exact. product_id/variation_id survive when all
 * linked source lines agree on them (nulls don't break the link).
 */
function aggregateItems(orders: MergeOrder[]): MergedItem[] {
  const groups = new Map<string, MergeItem[]>();
  for (const order of orders) {
    for (const it of order.items) {
      const key = `${it.product_name}\u0000${it.unit_price}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push({ ...it, product_id: it.product_id ?? null, variation_id: it.variation_id ?? null, discount: it.discount ?? 0 });
      else groups.set(key, [{ ...it, product_id: it.product_id ?? null, variation_id: it.variation_id ?? null, discount: it.discount ?? 0 }]);
    }
  }

  const merged: MergedItem[] = [];
  for (const bucket of groups.values()) {
    const first = bucket[0];
    const resolveId = (field: "product_id" | "variation_id"): string | null => {
      const values = new Set(bucket.map((i) => i[field]).filter((v): v is string => v != null));
      return values.size === 1 ? [...values][0] : null;
    };
    merged.push({
      product_id: resolveId("product_id"),
      variation_id: resolveId("variation_id"),
      product_name: first.product_name,
      quantity: bucket.reduce((s, i) => s + i.quantity, 0),
      unit_price: first.unit_price,
      discount: bucket.reduce((s, i) => s + (i.discount ?? 0), 0),
      line_total: bucket.reduce((s, i) => s + i.line_total, 0),
    });
  }
  return merged;
}

/**
 * Union of every source payment record — each record exactly once. Identity is
 * the payment record id: a record that reached two source lists is the same
 * money and must never be counted twice (ADR-0002: existing money is never
 * duplicated). First occurrence wins and keeps its origin.
 */
function unionPayments(orders: MergeOrder[]): MergedPayment[] {
  const payments: MergedPayment[] = [];
  const seen = new Set<string>();
  for (const order of orders) {
    for (const p of order.payments) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      payments.push({
        id: p.id,
        source_order_id: order.id,
        amount: p.amount,
        method: p.method,
        trx_id: p.trx_id ?? null,
        notes: p.notes ?? null,
        created_at: p.created_at ?? null,
      });
    }
  }
  return payments;
}

/**
 * Merge not-entered orders of one customer into a single order that takes all
 * items and payments (GLOSSARY "Merge"). Refuses ineligible input with the
 * blocking reasons instead of producing a partial merge.
 */
export function mergeOrders(orders: MergeOrder[]): MergeOutcome {
  const eligibility = checkMergeEligibility(orders);
  if (!eligibility.eligible) return { ok: false, eligibility };

  const items = aggregateItems(orders);
  const payments = unionPayments(orders);

  const subtotal = orders.reduce((s, o) => s + o.subtotal, 0);
  const discount = orders.reduce((s, o) => s + o.discount, 0);
  const shipping_cost = orders.reduce((s, o) => s + o.shipping_cost, 0);
  const tax_amount = orders.reduce((s, o) => s + (o.tax_amount ?? 0), 0);
  // Money-exact: the merged total is the sum of the source totals.
  const total = orders.reduce((s, o) => s + o.total, 0);
  const total_paid = payments.reduce((s, p) => s + p.amount, 0);
  const amount_to_collect = Math.max(total - total_paid, 0);
  const payment_status: MergedOrderTotals["payment_status"] =
    total_paid <= PAYMENT_EPSILON
      ? "unpaid"
      : amount_to_collect <= PAYMENT_EPSILON
        ? "paid"
        : "partial";

  return {
    ok: true,
    merged: {
      source_order_ids: orders.map((o) => o.id),
      source_order_numbers: orders.map((o) => o.order_number),
      customer_key: customerKeyOf(orders[0])!,
      customer_name: orders[0].customer_name ?? null,
      customer_phone: orders[0].customer_phone ?? null,
      state: orders[0].status,
      items,
      payments,
      charge_allocation: orders.map((o) => ({
        order_id: o.id,
        order_number: o.order_number,
        subtotal: o.subtotal,
        discount: o.discount,
        shipping_cost: o.shipping_cost,
        tax_amount: o.tax_amount ?? 0,
        total: o.total,
      })),
      totals: {
        subtotal,
        discount,
        shipping_cost,
        tax_amount,
        total,
        total_paid,
        amount_to_collect,
        payment_status,
      },
    },
  };
}
