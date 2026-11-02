import { describe, it, expect } from "vitest";
import {
  computeSplitPlan,
  type SplitPaymentAssignment,
  type SplitSourceOrder,
} from "@/lib/orderSplit";
import {
  deriveSplitPaymentState,
  splitChildItemRows,
  splitChildOrderFields,
  splitChildPaymentFields,
  splitChildPaymentRows,
  splitChildStatus,
  splitParentItemDeletes,
  splitParentItemUpdates,
  splitParentOrderPatch,
  splitSourcePaymentOps,
  splitTaxOf,
  SPLIT_ORDER_SOURCE,
  type SplitParentOrder,
  type SplitSourceItemRow,
  type SplitSourcePaymentRow,
} from "@/lib/splitPersistence";

// Worked example (same money as src/test/orderSplit.test.ts, with the app's
// single "other charge" — tax — in place of the two sample charges):
//   items:   "a" Cotton Shirt x3 @1000 (line discount 150), "b" Wool Blazer x1 @2500
//   charges: shipping 110, order discount 330, tax 77
//   payments recorded on the original: cash 2000 + bkash 1500 = 3500
const source: SplitSourceOrder = {
  items: [
    { id: "a", productName: "Cotton Shirt", quantity: 3, unitPrice: 1000, lineDiscount: 150 },
    { id: "b", productName: "Wool Blazer", quantity: 1, unitPrice: 2500 },
  ],
  payments: [
    { id: "p1", method: "cash", amount: 2000 },
    { id: "p2", method: "bkash", amount: 1500 },
  ],
  shipping: 110,
  discount: 330,
  otherCharges: [{ id: "tax", label: "Tax / VAT", amount: 77 }],
};

const sourceItems: SplitSourceItemRow[] = [
  { id: "a", product_id: "prod-a", variation_id: "var-a", product_name: "Cotton Shirt", quantity: 3, unit_price: 1000, discount: 150 },
  { id: "b", product_id: "prod-b", variation_id: null, product_name: "Wool Blazer", quantity: 1, unit_price: 2500, discount: 0 },
];

const sourcePayments: SplitSourcePaymentRow[] = [
  { id: "p1", method: "cash", amount: 2000, trx_id: "TRX-1" },
  { id: "p2", method: "bkash", amount: 1500, trx_id: null },
];

const parent: SplitParentOrder = {
  id: "order-1",
  order_number: "DHK-1001",
  status: "processing",
  payment_status: "partial",
  payment_method: "bkash",
  store_id: "store-1",
  order_source_id: "sp-1",
  customer_id: "cust-1",
  customer_name: "Rahim",
  customer_phone: "01711111111",
  customer_address: "Dhaka",
  customer_email: null,
  customer_city: "Dhaka",
  fulfillment_type: "delivery",
  subtotal: 5350,
  discount: 330,
  shipping_cost: 110,
  tax_amount: 77,
  total: 5207,
};

const moves = [
  { itemId: "a", quantity: 2 },
  { itemId: "b", quantity: 1 },
];

describe("deriveSplitPaymentState — recomputation must not clobber money markers", () => {
  it("preserves the unconfirmed online marker — a split never releases the gate (issue #27)", () => {
    expect(deriveSplitPaymentState("online", 5000, 0)).toBe("online");
    // Even when stray payment rows exist, only the sanctioned confirm-payment
    // flow may release the gate — never a split's recomputation side effect.
    expect(deriveSplitPaymentState("online", 5000, 3500)).toBe("online");
    expect(deriveSplitPaymentState("online", 5000, 6000)).toBe("online");
  });

  it("preserves cod — a cash-on-delivery arrangement is not an unpaid state", () => {
    expect(deriveSplitPaymentState("cod", 5000, 0)).toBe("cod");
  });

  it("preserves the terminal refunded state", () => {
    expect(deriveSplitPaymentState("refunded", 5000, 0)).toBe("refunded");
    expect(deriveSplitPaymentState("refunded", 5000, 1200)).toBe("refunded");
  });

  it("reads unpaid / paid / partial from the money itself otherwise", () => {
    expect(deriveSplitPaymentState("paid", 100, 0)).toBe("unpaid");
    expect(deriveSplitPaymentState("unpaid", 100, 100)).toBe("paid");
    expect(deriveSplitPaymentState("unpaid", 100, 105)).toBe("paid"); // overpaid still reads paid
    expect(deriveSplitPaymentState("paid", 100, 40)).toBe("partial");
  });
});

describe("splitSourcePaymentOps — transferred money MOVES, never duplicates", () => {
  it("shrinks the transferred source row and leaves untouched rows alone", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p1", amount: 500 },
    });
    const ops = splitSourcePaymentOps(sourcePayments, plan);
    expect(ops).toEqual([{ kind: "update", id: "p1", amount: 1500 }]);
  });

  it("deletes the source row when a whole payment moves (kept amount 0)", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p1", amount: 2000 },
    });
    const ops = splitSourcePaymentOps(sourcePayments, plan);
    expect(ops).toEqual([{ kind: "delete", id: "p1" }]);
  });

  it("touches nothing for COD and new-payment — existing money is untouched", () => {
    for (const assignment of [
      { kind: "cod" },
      { kind: "new-payment", method: "bkash", amount: 1000 },
    ] as SplitPaymentAssignment[]) {
      const plan = computeSplitPlan(source, { movedItems: moves, newOrderPayment: assignment });
      expect(splitSourcePaymentOps(sourcePayments, plan)).toEqual([]);
    }
  });

  it("keeps recorded money conserved across the update and the child insert", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p1", amount: 500 },
    });
    const ops = splitSourcePaymentOps(sourcePayments, plan);
    const childRows = splitChildPaymentRows("child-1", parent.order_number, plan.newOrder.payments, sourcePayments);
    const remaining = sourcePayments.reduce((sum, row) => {
      const op = ops.find((o) => o.id === row.id);
      if (op?.kind === "delete") return sum;
      return sum + (op?.kind === "update" ? op.amount : row.amount);
    }, 0);
    const moved = childRows.reduce((s, r) => s + r.amount, 0);
    // 3500 recorded before and after: money moved, never duplicated.
    expect(remaining + moved).toBe(3500);
  });
});

describe("splitChildPaymentRows — plan.newOrder.payments as child order_payments rows", () => {
  it("carries the source row's trx_id along with transferred money", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p1", amount: 500 },
    });
    const rows = splitChildPaymentRows("child-1", "DHK-1001", plan.newOrder.payments, sourcePayments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ order_id: "child-1", method: "cash", amount: 500, trx_id: "TRX-1" });
  });

  it("attaches the entered TrxID to a genuinely new payment", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "new-payment", method: "bkash", amount: 1000 },
    });
    const rows = splitChildPaymentRows("child-1", "DHK-1001", plan.newOrder.payments, sourcePayments, "NEW-TRX");
    expect(rows).toEqual([
      expect.objectContaining({ order_id: "child-1", method: "bkash", amount: 1000, trx_id: "NEW-TRX" }),
    ]);
  });
});

describe("split item rows — plan lines map onto the app's money model", () => {
  it("splits lines money-exactly: line_total = quantity * unit_price - discount", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "cod" },
    });

    const childRows = splitChildItemRows("child-1", plan.newOrder.items, sourceItems);
    expect(childRows).toEqual([
      // "a" partial move: 2 of 3, its discount follows the quantity (100 of 150)
      { order_id: "child-1", product_id: "prod-a", variation_id: "var-a", product_name: "Cotton Shirt", quantity: 2, unit_price: 1000, discount: 100, line_total: 1900 },
      // "b" whole line moves with its full discount
      { order_id: "child-1", product_id: "prod-b", variation_id: null, product_name: "Wool Blazer", quantity: 1, unit_price: 2500, discount: 0, line_total: 2500 },
    ]);

    // The original keeps the remainder of "a"; "b" leaves entirely.
    expect(splitParentItemUpdates(plan.original.items)).toEqual([
      { id: "a", quantity: 1, discount: 50, line_total: 950 },
    ]);
    expect(splitParentItemDeletes(sourceItems, plan)).toEqual(["b"]);

    // Money-exact: kept + moved line totals equal the source line totals.
    const sourceNet = sourceItems.reduce((s, i) => s + i.quantity * i.unit_price - Number(i.discount || 0), 0);
    const keptNet = plan.original.items.reduce((s, i) => s + i.lineNet, 0);
    const movedNet = plan.newOrder.items.reduce((s, i) => s + i.lineNet, 0);
    expect(keptNet + movedNet).toBe(sourceNet);
  });
});

describe("splitParentOrderPatch — money fields from the plan, never status/courier", () => {
  const plan = computeSplitPlan(source, {
    movedItems: moves,
    newOrderPayment: { kind: "transfer", sourcePaymentId: "p1", amount: 500 },
  });

  it("writes totals/shipping/discount/subtotal/tax straight from plan.original", () => {
    const patch = splitParentOrderPatch(plan, parent);
    expect(patch.subtotal).toBe(plan.original.itemSubtotal);
    expect(patch.discount).toBe(plan.original.discount);
    expect(patch.shipping_cost).toBe(plan.original.shipping);
    expect(patch.tax_amount).toBe(splitTaxOf(plan.original));
    expect(patch.total).toBe(plan.original.total);
    expect(patch.amount_to_collect).toBe(Math.max(plan.original.total - plan.original.paid, 0));
  });

  it("never includes status or courier fields (issue #27 gate is never laundered)", () => {
    const patch = splitParentOrderPatch(plan, parent) as Record<string, unknown>;
    expect("status" in patch).toBe(false);
    expect("consignment_id" in patch).toBe(false);
    expect("payment_method" in patch).toBe(false);
  });

  it("keeps a gated parent gated: the online marker survives money recomputation", () => {
    const gatedParent = { payment_status: "online" };
    const codPlan = computeSplitPlan(source, { movedItems: moves, newOrderPayment: { kind: "cod" } });
    const patch = splitParentOrderPatch(codPlan, gatedParent);
    expect(patch.payment_status).toBe("online");

    // Even a transfer that moves recorded money off the parent never releases
    // the gate — that is the confirm-payment flow's job, not a split's.
    const transferPlan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p1", amount: 2000 },
    });
    expect(splitParentOrderPatch(transferPlan, gatedParent).payment_status).toBe("online");
  });
});

describe("splitChildOrderFields — the new order row, linked via parent_order_id", () => {
  it("creates an independent order with the plan's totals and copied identity", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p2", amount: 1500 },
    });
    const fields = splitChildOrderFields(parent, plan, { kind: "transfer", sourcePaymentId: "p2", amount: 1500 }, "SPLIT-DHK-1001-0001", sourcePayments);

    expect(fields).toMatchObject({
      order_number: "SPLIT-DHK-1001-0001",
      source: SPLIT_ORDER_SOURCE,
      is_exchange: false,
      parent_order_id: parent.id,
      store_id: parent.store_id,
      order_source_id: parent.order_source_id,
      subtotal: plan.newOrder.itemSubtotal,
      discount: plan.newOrder.discount,
      shipping_cost: plan.newOrder.shipping,
      tax_amount: splitTaxOf(plan.newOrder),
      total: plan.newOrder.total,
    });
    // Whole payment transferred: its method travels with the money; the rest
    // of the new order's total is still due.
    expect(fields.payment_status).toBe("partial");
    expect(fields.payment_method).toBe("bkash");
    expect(fields.amount_to_collect).toBe(plan.newOrder.total - 1500);
    expect(fields.status).toBe("processing"); // a new independent order
  });

  it("cod case: payment_status cod, nothing collected yet", () => {
    const plan = computeSplitPlan(source, { movedItems: moves, newOrderPayment: { kind: "cod" } });
    const fields = splitChildOrderFields(parent, plan, { kind: "cod" }, "SPLIT-DHK-1001-0001", sourcePayments);
    expect(fields.payment_status).toBe("cod");
    expect(fields.payment_method).toBe("Cash on Delivery");
    expect(fields.amount_to_collect).toBe(plan.newOrder.total);
    expect(fields.status).toBe("processing");
  });

  it("new-payment case: partial collection reads partial, the rest is due", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "new-payment", method: "nagad", amount: 1000 },
    });
    const fields = splitChildOrderFields(parent, plan, { kind: "new-payment", method: "nagad", amount: 1000 }, "SPLIT-DHK-1001-0001", sourcePayments);
    expect(fields.payment_status).toBe("partial");
    expect(fields.payment_method).toBe("nagad");
    expect(fields.amount_to_collect).toBe(plan.newOrder.total - 1000);
  });

  it("applies the #27 gate to the child's own payment fields (defensive)", () => {
    // A child whose own fields say "unconfirmed online payment" is created
    // locked in payment_pending — never laundered into a working order.
    expect(
      splitChildStatus({ source: "woo", payment_method: "bkash", payment_status: "online" }),
    ).toBe("payment_pending");
    // Resolved payment fields are not gated.
    expect(splitChildStatus({ source: SPLIT_ORDER_SOURCE, payment_method: "Cash on Delivery", payment_status: "cod" })).toBe("processing");
    expect(splitChildStatus({ source: SPLIT_ORDER_SOURCE, payment_method: "bkash", payment_status: "paid" })).toBe("processing");
    expect(splitChildStatus({ source: SPLIT_ORDER_SOURCE, payment_method: "bkash", payment_status: "partial" })).toBe("processing");
  });
});

describe("splitChildPaymentFields — the three DISTINCT payment cases", () => {
  it("maps each case onto its own payment fields", () => {
    const codPlan = computeSplitPlan(source, { movedItems: moves, newOrderPayment: { kind: "cod" } });
    expect(splitChildPaymentFields(codPlan, { kind: "cod" }, sourcePayments)).toEqual({
      payment_status: "cod",
      payment_method: "Cash on Delivery",
    });

    const newPlan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "new-payment", method: "cash", amount: 6000 },
    });
    expect(splitChildPaymentFields(newPlan, { kind: "new-payment", method: "cash", amount: 6000 }, sourcePayments)).toEqual({
      payment_status: "paid",
      payment_method: "cash",
    });

    const transferPlan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p2", amount: 1500 },
    });
    expect(splitChildPaymentFields(transferPlan, { kind: "transfer", sourcePaymentId: "p2", amount: 1500 }, sourcePayments)).toEqual({
      payment_status: "partial", // 1500 transferred against a 4283 total
      payment_method: "bkash", // the source payment's method travels with the money
    });
  });
});
