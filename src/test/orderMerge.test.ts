import { describe, it, expect } from "vitest";
import {
  checkMergeEligibility,
  groupOrdersForMerge,
  mergeOrders,
  normalizePhone,
  isEntered,
  type MergeOrder,
  type MergedOrder,
} from "@/lib/orderMerge";

/**
 * Same-customer grouping + merge (issue #30) — pure domain semantics.
 *
 * Settled decisions (docs/adr/0002-order-merge-split-payment-semantics.md):
 *  - Merge is PRE-ENTRY only: only not-entered orders without an active
 *    consignment can merge.
 *  - The merged order takes all items and payments.
 *  - Existing money is NEVER duplicated.
 *  - Charges (shipping/discount) are allocated per resulting-order semantics:
 *    merge has one resulting order, so every source's charges land on it in
 *    full and the merged total must equal the sum of the source totals.
 */

/** Build an order with sensible money-consistent defaults:
 *  subtotal = Σ line_total, total = subtotal - discount + shipping + tax. */
function makeOrder(over: Partial<MergeOrder> & { id: string }): MergeOrder {
  const items = over.items ?? [
    {
      product_id: "p1",
      variation_id: "v1",
      product_name: "Cotton Shirt - L / Navy",
      quantity: 1,
      unit_price: 1000,
      discount: 0,
      line_total: 1000,
    },
  ];
  const subtotal = over.subtotal ?? items.reduce((s, i) => s + i.line_total, 0);
  const discount = over.discount ?? 0;
  const shipping = over.shipping_cost ?? 0;
  const tax = over.tax_amount ?? 0;
  return {
    order_number: over.order_number ?? `DHK-${over.id}`,
    status: over.status ?? "processing",
    consignment_id: over.consignment_id ?? null,
    deleted_at: over.deleted_at ?? null,
    customer_name: over.customer_name ?? "Rahim Uddin",
    customer_phone: over.customer_phone ?? "01712345678",
    subtotal,
    discount,
    shipping_cost: shipping,
    tax_amount: tax,
    total: over.total ?? subtotal - discount + shipping + tax,
    payments: over.payments ?? [],
    items,
    ...over,
    id: over.id,
  };
}

describe("orderMerge - eligibility (pre-entry only, same customer by normalized phone)", () => {
  it("allows merging two not-entered orders of the same customer", () => {
    const eligibility = checkMergeEligibility([
      makeOrder({ id: "a" }),
      makeOrder({ id: "b" }),
    ]);
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.blocks).toEqual([]);
  });

  it("blocks merge when any order is entered (holds an active consignment)", () => {
    const eligibility = checkMergeEligibility([
      makeOrder({ id: "a" }),
      makeOrder({ id: "b", consignment_id: "CONS123" }),
    ]);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blocks).toContainEqual(
      expect.objectContaining({ reason: "entered", order_id: "b" })
    );
  });

  it("treats a cancelled booking (no consignment) as not entered", () => {
    // GLOSSARY: a cancelled booking returns the order to not-entered.
    // In the data model the cancel clears orders.consignment_id.
    const order = makeOrder({ id: "a", consignment_id: null });
    expect(isEntered(order)).toBe(false);
  });

  it("treats the same customer written in different phone formats as one customer", () => {
    // The canonical form is the 01XXXXXXXXX style used by woo-mapping.
    expect(normalizePhone("+880 1712-345678")).toBe("01712345678");
    expect(normalizePhone("8801712345678")).toBe("01712345678");
    expect(normalizePhone("1712345678")).toBe("01712345678");
    expect(normalizePhone("01712345678")).toBe("01712345678");
    expect(normalizePhone("  ")).toBe(null);

    const eligibility = checkMergeEligibility([
      makeOrder({ id: "a", customer_phone: "+880 1712-345678" }),
      makeOrder({ id: "b", customer_phone: "1712345678" }),
    ]);
    expect(eligibility.eligible).toBe(true);
  });

  it("blocks merge across different customers", () => {
    const eligibility = checkMergeEligibility([
      makeOrder({ id: "a", customer_phone: "01712345678" }),
      makeOrder({ id: "b", customer_phone: "01812345678" }),
    ]);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blocks).toContainEqual(
      expect.objectContaining({ reason: "different_customer" })
    );
  });

  it("blocks merge when a customer phone is missing — identity cannot be verified", () => {
    const eligibility = checkMergeEligibility([
      makeOrder({ id: "a" }),
      makeOrder({ id: "b", customer_phone: null }),
    ]);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blocks).toContainEqual(
      expect.objectContaining({ reason: "missing_phone", order_id: "b" })
    );
  });

  it("blocks merging a single order — merge combines two or more orders", () => {
    const eligibility = checkMergeEligibility([makeOrder({ id: "a" })]);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blocks).toContainEqual(
      expect.objectContaining({ reason: "too_few_orders" })
    );
  });

  it("blocks merge across different states (merge happens inside a same-state group)", () => {
    const eligibility = checkMergeEligibility([
      makeOrder({ id: "a", status: "processing" }),
      makeOrder({ id: "b", status: "pre_order_making" }),
    ]);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blocks).toContainEqual(
      expect.objectContaining({ reason: "different_state" })
    );
  });

  it("blocks merge when the same order id is passed twice (money must not be double-counted)", () => {
    const order = makeOrder({ id: "a" });
    const eligibility = checkMergeEligibility([order, { ...order }]);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blocks).toContainEqual(
      expect.objectContaining({ reason: "duplicate_order", order_id: "a" })
    );
  });

  it("blocks merge of trashed orders", () => {
    const eligibility = checkMergeEligibility([
      makeOrder({ id: "a" }),
      makeOrder({ id: "b", deleted_at: "2026-10-26T00:00:00Z" }),
    ]);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blocks).toContainEqual(
      expect.objectContaining({ reason: "deleted", order_id: "b" })
    );
  });
});

describe("orderMerge - same-customer grouping", () => {
  it("groups 2+ orders of the same customer in the same state and annotates eligibility", () => {
    const orders = [
      makeOrder({ id: "a", customer_phone: "+8801712345678" }),
      makeOrder({ id: "b", customer_phone: "01712345678" }), // same customer, other format
      makeOrder({ id: "c", customer_phone: "01812345678" }), // other customer
      makeOrder({ id: "d", customer_phone: "01712345678", status: "ready_to_ship" }), // other state
    ];
    const groups = groupOrdersForMerge(orders);
    expect(groups).toHaveLength(1);
    expect(groups[0].customer_key).toBe("01712345678");
    expect(groups[0].state).toBe("processing");
    expect(groups[0].orders.map((o) => o.id)).toEqual(["a", "b"]);
    expect(groups[0].eligibility.eligible).toBe(true);
  });

  it("shows a same-customer group but blocks its Merge when one order is entered", () => {
    const groups = groupOrdersForMerge([
      makeOrder({ id: "a" }),
      makeOrder({ id: "b", consignment_id: "CONS123" }),
    ]);
    // Both are entered/not-entered mixed: a is not entered, b is entered.
    // Grouping is display-level (same customer + same state), Merge is gated.
    expect(groups).toHaveLength(1);
    expect(groups[0].eligibility.eligible).toBe(false);
    expect(groups[0].eligibility.blocks).toContainEqual(
      expect.objectContaining({ reason: "entered", order_id: "b" })
    );
  });

  it("skips lone orders, missing-phone orders and trashed orders", () => {
    const groups = groupOrdersForMerge([
      makeOrder({ id: "lonely", customer_phone: "01912345678" }),
      makeOrder({ id: "nophone", customer_phone: null }),
      makeOrder({ id: "trash1", deleted_at: "2026-10-26T00:00:00Z" }),
      makeOrder({ id: "trash2", deleted_at: "2026-10-26T00:00:00Z" }),
    ]);
    expect(groups).toEqual([]);
  });
});

/** Merge, failing the test loudly when the outcome is a refusal. */
function mergedOf(orders: MergeOrder[]): MergedOrder {
  const outcome = mergeOrders(orders);
  if (outcome.ok === true) return outcome.merged;
  throw new Error(`expected eligible merge, got blocks: ${JSON.stringify(outcome.eligibility.blocks)}`);
}

describe("orderMerge - item aggregation ('Name - variationLabel' product_name convention)", () => {
  it("aggregates identical items across source orders into one line", () => {
    // product_name is "Name - variationLabel"; the full string is the identity.
    const merged = mergedOf([
      makeOrder({
        id: "a",
        items: [
          { product_id: "p1", variation_id: "v1", product_name: "Cotton Shirt - L / Navy", quantity: 2, unit_price: 1000, discount: 0, line_total: 2000 },
          { product_id: "p1", variation_id: "v2", product_name: "Cotton Shirt - M / Navy", quantity: 1, unit_price: 900, discount: 0, line_total: 900 },
        ],
      }),
      makeOrder({
        id: "b",
        items: [
          { product_id: "p1", variation_id: "v1", product_name: "Cotton Shirt - L / Navy", quantity: 1, unit_price: 1000, discount: 0, line_total: 1000 },
        ],
      }),
    ]);

    expect(merged.items).toEqual([
      { product_id: "p1", variation_id: "v1", product_name: "Cotton Shirt - L / Navy", quantity: 3, unit_price: 1000, discount: 0, line_total: 3000 },
      { product_id: "p1", variation_id: "v2", product_name: "Cotton Shirt - M / Navy", quantity: 1, unit_price: 900, discount: 0, line_total: 900 },
    ]);
  });

  it("never merges different variation labels — the variation lives in product_name", () => {
    const merged = mergedOf([
      makeOrder({ id: "a", items: [{ product_name: "Panjabi - XL / Green", quantity: 1, unit_price: 2500, discount: 0, line_total: 2500 }] }),
      makeOrder({ id: "b", items: [{ product_name: "Panjabi - L / Green", quantity: 1, unit_price: 2500, discount: 0, line_total: 2500 }] }),
    ]);

    expect(merged.items.map((i) => i.product_name)).toEqual([
      "Panjabi - XL / Green",
      "Panjabi - L / Green",
    ]);
  });

  it("treats the full product_name as identity — names containing ' - ' are never parsed", () => {
    // A base name can itself contain " - "; only the whole string matches.
    const merged = mergedOf([
      makeOrder({ id: "a", items: [{ product_name: "T-Shirt - Oversized - Red", quantity: 1, unit_price: 800, discount: 0, line_total: 800 }] }),
      makeOrder({ id: "b", items: [{ product_name: "T-Shirt - Oversized - Blue", quantity: 1, unit_price: 800, discount: 0, line_total: 800 }] }),
    ]);

    expect(merged.items.map((i) => i.product_name)).toEqual([
      "T-Shirt - Oversized - Red",
      "T-Shirt - Oversized - Blue",
    ]);
  });

  it("keeps same-named lines with different unit prices separate so line totals stay exact", () => {
    const merged = mergedOf([
      makeOrder({ id: "a", items: [{ product_name: "Cotton Shirt - L / Navy", quantity: 1, unit_price: 1000, discount: 0, line_total: 1000 }] }),
      makeOrder({ id: "b", items: [{ product_name: "Cotton Shirt - L / Navy", quantity: 1, unit_price: 900, discount: 0, line_total: 900 }] }),
    ]);

    expect(merged.items).toEqual([
      { product_id: null, variation_id: null, product_name: "Cotton Shirt - L / Navy", quantity: 1, unit_price: 1000, discount: 0, line_total: 1000 },
      { product_id: null, variation_id: null, product_name: "Cotton Shirt - L / Navy", quantity: 1, unit_price: 900, discount: 0, line_total: 900 },
    ]);
  });

  it("sums per-line discounts into the aggregated line and keeps money exact", () => {
    const merged = mergedOf([
      makeOrder({ id: "a", items: [{ product_name: "Shawl - Wool", quantity: 1, unit_price: 1200, discount: 100, line_total: 1100 }] }),
      makeOrder({ id: "b", items: [{ product_name: "Shawl - Wool", quantity: 2, unit_price: 1200, discount: 50, line_total: 2350 }] }),
    ]);

    expect(merged.items).toEqual([
      { product_id: null, variation_id: null, product_name: "Shawl - Wool", quantity: 3, unit_price: 1200, discount: 150, line_total: 3450 },
    ]);
    const lineTotalSum = merged.items.reduce((s, i) => s + i.line_total, 0);
    expect(lineTotalSum).toBe(1100 + 2350);
  });

  it("keeps the product link when only some sources carry product ids", () => {
    const merged = mergedOf([
      makeOrder({ id: "a", items: [{ product_id: null, variation_id: null, product_name: "Cotton Shirt - L / Navy", quantity: 1, unit_price: 1000, discount: 0, line_total: 1000 }] }),
      makeOrder({ id: "b", items: [{ product_id: "p1", variation_id: "v1", product_name: "Cotton Shirt - L / Navy", quantity: 1, unit_price: 1000, discount: 0, line_total: 1000 }] }),
    ]);

    expect(merged.items).toEqual([
      { product_id: "p1", variation_id: "v1", product_name: "Cotton Shirt - L / Navy", quantity: 2, unit_price: 1000, discount: 0, line_total: 2000 },
    ]);
  });
});

describe("orderMerge - payment union without duplication (existing money is never duplicated)", () => {
  it("rolls up every source payment into one union, keeping its origin", () => {
    const merged = mergedOf([
      makeOrder({
        id: "a",
        payments: [{ id: "pay-a1", method: "cash", amount: 1500 }],
      }),
      makeOrder({
        id: "b",
        payments: [
          { id: "pay-b1", method: "bkash", amount: 1120, trx_id: "TRX9", notes: "advance", created_at: "2026-10-25T10:00:00Z" },
          { id: "pay-b2", method: "bkash", amount: 380, trx_id: "TRX9" },
        ],
      }),
    ]);

    expect(merged.payments).toEqual([
      { id: "pay-a1", source_order_id: "a", method: "cash", amount: 1500, trx_id: null, notes: null, created_at: null },
      { id: "pay-b1", source_order_id: "b", method: "bkash", amount: 1120, trx_id: "TRX9", notes: "advance", created_at: "2026-10-25T10:00:00Z" },
      { id: "pay-b2", source_order_id: "b", method: "bkash", amount: 380, trx_id: "TRX9", notes: null, created_at: null },
    ]);
  });

  it("counts a payment record that reached two source lists exactly once", () => {
    // Same record id in both lists: it is the same money, so the union keeps it
    // once and total_paid must not double it.
    const shared = { id: "pay-x", method: "cash", amount: 500 };
    const merged = mergedOf([
      makeOrder({ id: "a", payments: [shared] }),
      makeOrder({ id: "b", payments: [{ ...shared }] }),
    ]);

    expect(merged.payments).toEqual([
      { id: "pay-x", source_order_id: "a", method: "cash", amount: 500, trx_id: null, notes: null, created_at: null },
    ]);
    expect(merged.totals.total_paid).toBe(500);
  });

  it("sums the union, not the raw rows — total paid equals unique money", () => {
    const merged = mergedOf([
      makeOrder({ id: "a", payments: [{ id: "pay-1", method: "cash", amount: 100 }] }),
      makeOrder({ id: "b", payments: [{ id: "pay-2", method: "cash", amount: 250 }] }),
      makeOrder({ id: "c", payments: [] }),
    ]);
    expect(merged.totals.total_paid).toBe(350);
    expect(merged.payments).toHaveLength(2);
  });
});

describe("orderMerge - charge allocation and deterministic totals (ADR-0002)", () => {
  // Worked example: two pre-entry orders of one customer, merged into one.
  //   A: items 2000 + 900; subtotal 2900, discount 100, shipping 120, tax 0 → total 2920; paid 1500
  //   B: items 1000;      subtotal 1000, discount 0,   shipping 120, tax 0 → total 1120; paid 1500
  const orderA = makeOrder({
    id: "a",
    order_number: "DHK-1001",
    items: [
      { product_name: "Cotton Shirt - L / Navy", quantity: 2, unit_price: 1000, discount: 0, line_total: 2000 },
      { product_name: "Cotton Shirt - M / Navy", quantity: 1, unit_price: 900, discount: 0, line_total: 900 },
    ],
    subtotal: 2900,
    discount: 100,
    shipping_cost: 120,
    tax_amount: 0,
    total: 2920,
    payments: [{ id: "pay-a1", method: "cash", amount: 1500 }],
  });
  const orderB = makeOrder({
    id: "b",
    order_number: "DHK-1002",
    items: [
      { product_name: "Cotton Shirt - L / Navy", quantity: 1, unit_price: 1000, discount: 0, line_total: 1000 },
    ],
    subtotal: 1000,
    discount: 0,
    shipping_cost: 120,
    tax_amount: 0,
    total: 1120,
    payments: [
      { id: "pay-b1", method: "bkash", amount: 1120 },
      { id: "pay-b2", method: "bkash", amount: 380 },
    ],
  });

  it("allocates every source's charges to the single merged order in full", () => {
    const merged = mergedOf([orderA, orderB]);
    expect(merged.charge_allocation).toEqual([
      { order_id: "a", order_number: "DHK-1001", subtotal: 2900, discount: 100, shipping_cost: 120, tax_amount: 0, total: 2920 },
      { order_id: "b", order_number: "DHK-1002", subtotal: 1000, discount: 0, shipping_cost: 120, tax_amount: 0, total: 1120 },
    ]);
  });

  it("produces deterministic totals that equal the sum of the source totals", () => {
    const merged = mergedOf([orderA, orderB]);
    expect(merged.totals).toEqual({
      subtotal: 3900,
      discount: 100,
      shipping_cost: 240,
      tax_amount: 0,
      total: 4040, // 2920 + 1120
      total_paid: 3000, // 1500 + 1120 + 380
      amount_to_collect: 1040,
      payment_status: "partial",
    });
    // The merged total is exactly the source totals added up — no money
    // invented, none lost — and the charges reconcile with the components.
    expect(merged.totals.total).toBe(orderA.total + orderB.total);
    expect(merged.totals.total).toBe(
      merged.totals.subtotal - merged.totals.discount + merged.totals.shipping_cost + merged.totals.tax_amount
    );
  });

  it("keeps source provenance and the shared state on the merged order", () => {
    const merged = mergedOf([orderA, orderB]);
    expect(merged.source_order_ids).toEqual(["a", "b"]);
    expect(merged.source_order_numbers).toEqual(["DHK-1001", "DHK-1002"]);
    expect(merged.state).toBe("processing");
    expect(merged.customer_key).toBe("01712345678");
  });

  it("rolls payment state up across the union (paid / partial / unpaid)", () => {
    const noPay = makeOrder({ id: "a", total: 2000, payments: [] });
    const fullyPay = makeOrder({ id: "b", total: 1000, payments: [{ id: "p1", method: "cash", amount: 1000 }] });
    const overPay = makeOrder({ id: "c", total: 800, payments: [{ id: "p2", method: "cash", amount: 900 }] });

    const unpaid = mergedOf([noPay, makeOrder({ id: "z", total: 500, payments: [] })]);
    expect(unpaid.totals.payment_status).toBe("unpaid");
    expect(unpaid.totals.amount_to_collect).toBe(2500);

    const paid = mergedOf([fullyPay, overPay]);
    // 1900 collected against 1800 total: nothing left to collect (dueCollection convention).
    expect(paid.totals.payment_status).toBe("paid");
    expect(paid.totals.amount_to_collect).toBe(0);
    expect(paid.totals.total_paid).toBe(1900);
    expect(paid.totals.total).toBe(1800);
  });

  it("refuses to merge ineligible orders instead of producing a partial merge", () => {
    const outcome = mergeOrders([
      makeOrder({ id: "a" }),
      makeOrder({ id: "b", consignment_id: "CONS123" }), // entered — post-entry merge is blocked by design
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok === true) return;
    expect(outcome.eligibility.blocks).toContainEqual(
      expect.objectContaining({ reason: "entered", order_id: "b" })
    );
    expect(outcome).not.toHaveProperty("merged");
  });
});
