import { describe, it, expect } from "vitest";
import { computeSplitPlan, SplitPlanError, type SplitSourceOrder } from "@/lib/orderSplit";

// Worked example used across these specs (money in BDT):
//   items:   "a" Cotton Shirt x3 @1000 (line discount 150), "b" Wool Blazer x1 @2500
//   charges: shipping 110, order discount 330, gift wrap 55, handling 22
//   payments recorded on the original: cash 2000 + bkash 1500 = 3500
// Gross item value splits 4500 (moved) : 1000 (kept) = 9 : 2, so every charge
// below divides exactly in that ratio.
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
  otherCharges: [
    { id: "o1", label: "Gift wrap", amount: 55 },
    { id: "o2", label: "Handling", amount: 22 },
  ],
};

describe("computeSplitPlan — item movement", () => {
  it("moves the chosen quantities to the new order and keeps the rest on the original", () => {
    const plan = computeSplitPlan(source, {
      movedItems: [
        { itemId: "a", quantity: 2 },
        { itemId: "b", quantity: 1 },
      ],
      newOrderPayment: { kind: "cod" },
    });

    expect(plan.newOrder.items).toEqual([
      { itemId: "a", productName: "Cotton Shirt", quantity: 2, unitPrice: 1000, lineDiscount: 100, lineNet: 1900 },
      { itemId: "b", productName: "Wool Blazer", quantity: 1, unitPrice: 2500, lineDiscount: 0, lineNet: 2500 },
    ]);
    expect(plan.original.items).toEqual([
      { itemId: "a", productName: "Cotton Shirt", quantity: 1, unitPrice: 1000, lineDiscount: 50, lineNet: 950 },
    ]);
    expect(plan.newOrder.itemSubtotal).toBe(4400);
    expect(plan.original.itemSubtotal).toBe(950);
  });
});

describe("computeSplitPlan — charge allocation", () => {
  it("allocates shipping, discount and other charges per resulting order, conserving the source amounts", () => {
    const plan = computeSplitPlan(source, {
      movedItems: [
        { itemId: "a", quantity: 2 },
        { itemId: "b", quantity: 1 },
      ],
      newOrderPayment: { kind: "cod" },
    });

    // Gross item value: 4500 moved : 1000 kept = 9 : 2 of every charge.
    expect(plan.newOrder.shipping).toBe(90);
    expect(plan.original.shipping).toBe(20);
    expect(plan.newOrder.discount).toBe(270);
    expect(plan.original.discount).toBe(60);
    expect(plan.newOrder.otherCharges).toEqual([
      { id: "o1", label: "Gift wrap", amount: 45 },
      { id: "o2", label: "Handling", amount: 18 },
    ]);
    expect(plan.original.otherCharges).toEqual([
      { id: "o1", label: "Gift wrap", amount: 10 },
      { id: "o2", label: "Handling", amount: 4 },
    ]);

    // new: 4400 - 270 + 90 + 63 = 4283 ; original: 950 - 60 + 20 + 14 = 924
    expect(plan.newOrder.total).toBe(4283);
    expect(plan.original.total).toBe(924);
    // Charges are split, never duplicated: totals add up to the source total.
    expect(plan.newOrder.total + plan.original.total).toBe(5207);
  });

  it("honours explicit per-result-order charge shares, keeping the remainder on the original", () => {
    const plan = computeSplitPlan(source, {
      movedItems: [
        { itemId: "a", quantity: 2 },
        { itemId: "b", quantity: 1 },
      ],
      newOrderPayment: { kind: "cod" },
      chargeShares: { shipping: 110, discount: 0, otherCharges: { o1: 55, o2: 0 } },
    });

    expect(plan.newOrder.shipping).toBe(110);
    expect(plan.original.shipping).toBe(0);
    expect(plan.newOrder.discount).toBe(0);
    expect(plan.original.discount).toBe(330);
    expect(plan.newOrder.otherCharges).toEqual([
      { id: "o1", label: "Gift wrap", amount: 55 },
      { id: "o2", label: "Handling", amount: 0 },
    ]);
    expect(plan.original.otherCharges).toEqual([
      { id: "o1", label: "Gift wrap", amount: 0 },
      { id: "o2", label: "Handling", amount: 22 },
    ]);

    // new: 4400 - 0 + 110 + 55 + 0 = 4565 ; original: 950 - 330 + 0 + 0 + 22 = 642
    expect(plan.newOrder.total).toBe(4565);
    expect(plan.original.total).toBe(642);
    expect(plan.newOrder.total + plan.original.total).toBe(5207);
  });
});

describe("computeSplitPlan — payment case: COD", () => {
  it("assigns no payment to the new order and keeps every payment record on the original", () => {
    const plan = computeSplitPlan(source, {
      movedItems: [
        { itemId: "a", quantity: 2 },
        { itemId: "b", quantity: 1 },
      ],
      newOrderPayment: { kind: "cod" },
    });

    expect(plan.newOrder.payments).toEqual([]);
    expect(plan.original.payments).toEqual([
      { kind: "kept", method: "cash", amount: 2000, sourcePaymentId: "p1" },
      { kind: "kept", method: "bkash", amount: 1500, sourcePaymentId: "p2" },
    ]);

    // Money invariant: no money moves on a COD split.
    expect(plan.original.paid + plan.newOrder.paid).toBe(3500);
    // totals: original 924, new order 4283 (see charge allocation spec above)
    expect(plan.original.due).toBe(924 - 3500);
    expect(plan.newOrder.due).toBe(4283);
    expect(plan.warnings).toEqual([]);
  });
});

describe("computeSplitPlan — payment case: new payment", () => {
  it("records a genuinely new payment on the new order and leaves the original untouched", () => {
    const plan = computeSplitPlan(source, {
      movedItems: [
        { itemId: "a", quantity: 2 },
        { itemId: "b", quantity: 1 },
      ],
      newOrderPayment: { kind: "new-payment", method: "bkash", amount: 1000 },
    });

    expect(plan.newOrder.payments).toEqual([{ kind: "new", method: "bkash", amount: 1000 }]);
    expect(plan.original.payments).toEqual([
      { kind: "kept", method: "cash", amount: 2000, sourcePaymentId: "p1" },
      { kind: "kept", method: "bkash", amount: 1500, sourcePaymentId: "p2" },
    ]);

    // Money invariant: exactly the explicitly new amount is added on top of the
    // source money — existing money is never duplicated.
    expect(plan.original.paid + plan.newOrder.paid).toBe(3500 + 1000);
    expect(plan.newOrder.due).toBe(4283 - 1000);
    expect(plan.original.due).toBe(924 - 3500);
    expect(plan.warnings).toEqual([]);
  });
});

describe("computeSplitPlan — payment case: transferred payment", () => {
  it("moves existing money to the new order, decreasing the original by exactly the transferred amount", () => {
    const plan = computeSplitPlan(source, {
      movedItems: [
        { itemId: "a", quantity: 2 },
        { itemId: "b", quantity: 1 },
      ],
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p1", amount: 500 },
    });

    expect(plan.newOrder.payments).toEqual([
      { kind: "transferred", method: "cash", amount: 500, sourcePaymentId: "p1" },
    ]);
    // The original keeps its payment records; the transferred one decreases.
    expect(plan.original.payments).toEqual([
      { kind: "kept", method: "cash", amount: 1500, sourcePaymentId: "p1" },
      { kind: "kept", method: "bkash", amount: 1500, sourcePaymentId: "p2" },
    ]);

    // Money invariant: money is moved, never duplicated.
    expect(plan.original.paid + plan.newOrder.paid).toBe(3500);
    expect(plan.newOrder.due).toBe(4283 - 500);
    expect(plan.original.due).toBe(924 - 3000);
    expect(plan.warnings).toEqual([]);
  });

  it("empties the source record when a whole payment is transferred (boundary)", () => {
    const plan = computeSplitPlan(source, {
      movedItems: [
        { itemId: "a", quantity: 2 },
        { itemId: "b", quantity: 1 },
      ],
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p2", amount: 1500 },
    });

    expect(plan.newOrder.payments).toEqual([
      { kind: "transferred", method: "bkash", amount: 1500, sourcePaymentId: "p2" },
    ]);
    expect(plan.original.payments).toEqual([
      { kind: "kept", method: "cash", amount: 2000, sourcePaymentId: "p1" },
      { kind: "kept", method: "bkash", amount: 0, sourcePaymentId: "p2" },
    ]);
    expect(plan.original.paid + plan.newOrder.paid).toBe(3500);
    expect(plan.warnings).toEqual([]);
  });
});

describe("computeSplitPlan — over-assignment warnings (warn, never hard-block)", () => {
  const moves = [
    { itemId: "a", quantity: 2 },
    { itemId: "b", quantity: 1 },
  ];

  it("warns when the assigned amount exceeds the original's recorded payments but still produces the plan", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "new-payment", method: "cash", amount: 6000 },
    });

    expect(plan.warnings.map((w) => w.code)).toEqual(["assigned-exceeds-recorded"]);
    // Not hard-blocked: staff may be correcting reality. The new money is
    // recorded in full and existing money is untouched.
    expect(plan.newOrder.payments).toEqual([{ kind: "new", method: "cash", amount: 6000 }]);
    expect(plan.original.paid + plan.newOrder.paid).toBe(3500 + 6000);
  });

  it("clamps a transfer beyond its payment record and warns, keeping money un-duplicated", () => {
    const plan = computeSplitPlan(source, {
      movedItems: moves,
      newOrderPayment: { kind: "transfer", sourcePaymentId: "p1", amount: 5000 },
    });

    expect(plan.warnings.map((w) => w.code)).toEqual(["transfer-exceeds-payment", "assigned-exceeds-recorded"]);
    expect(plan.newOrder.payments).toEqual([
      { kind: "transferred", method: "cash", amount: 2000, sourcePaymentId: "p1" },
    ]);
    expect(plan.original.payments).toEqual([
      { kind: "kept", method: "cash", amount: 0, sourcePaymentId: "p1" },
      { kind: "kept", method: "bkash", amount: 1500, sourcePaymentId: "p2" },
    ]);
    // The money invariant holds even for over-assignment: never duplicated.
    expect(plan.original.paid + plan.newOrder.paid).toBe(3500);
  });
});

describe("computeSplitPlan — structural invalidity is a hard error", () => {
  const moves = [
    { itemId: "a", quantity: 2 },
    { itemId: "b", quantity: 1 },
  ];

  function expectSplitError(fn: () => unknown, code: string, message: string) {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(SplitPlanError);
      expect((err as SplitPlanError).code).toBe(code);
      expect((err as SplitPlanError).message).toBe(message);
      return;
    }
    expect.unreachable("expected a SplitPlanError");
  }

  it("rejects a split that moves nothing", () => {
    expectSplitError(
      () => computeSplitPlan(source, { movedItems: [], newOrderPayment: { kind: "cod" } }),
      "no-items-moved",
      "a split must move at least one item",
    );
  });

  it("rejects a split that would leave the original empty", () => {
    expectSplitError(
      () =>
        computeSplitPlan(source, {
          movedItems: [
            { itemId: "a", quantity: 3 },
            { itemId: "b", quantity: 1 },
          ],
          newOrderPayment: { kind: "cod" },
        }),
      "all-items-moved",
      "a split must leave at least one item on the original",
    );
  });

  it("rejects unknown items, duplicate moves and quantities beyond the source", () => {
    expectSplitError(
      () => computeSplitPlan(source, { movedItems: [{ itemId: "zzz", quantity: 1 }], newOrderPayment: { kind: "cod" } }),
      "unknown-item",
      'no source item "zzz"',
    );
    expectSplitError(
      () =>
        computeSplitPlan(source, {
          movedItems: [
            { itemId: "a", quantity: 1 },
            { itemId: "a", quantity: 1 },
          ],
          newOrderPayment: { kind: "cod" },
        }),
      "duplicate-item",
      'item "a" is listed twice in movedItems',
    );
    expectSplitError(
      () => computeSplitPlan(source, { movedItems: [{ itemId: "a", quantity: 4 }], newOrderPayment: { kind: "cod" } }),
      "invalid-quantity",
      'move quantity 4 exceeds source quantity 3 for "a"',
    );
  });

  it("rejects a transfer from a payment the original never recorded", () => {
    expectSplitError(
      () =>
        computeSplitPlan(source, {
          movedItems: moves,
          newOrderPayment: { kind: "transfer", sourcePaymentId: "nope", amount: 100 },
        }),
      "unknown-payment",
      'no source payment "nope"',
    );
  });

  it("rejects non-positive payment amounts and out-of-range charge shares", () => {
    expectSplitError(
      () =>
        computeSplitPlan(source, {
          movedItems: moves,
          newOrderPayment: { kind: "new-payment", method: "cash", amount: 0 },
        }),
      "invalid-amount",
      "new payment amount must be greater than zero",
    );
    expectSplitError(
      () =>
        computeSplitPlan(source, {
          movedItems: moves,
          newOrderPayment: { kind: "cod" },
          chargeShares: { shipping: 200 },
        }),
      "invalid-charge-share",
      "shipping share must be between 0 and 110",
    );
    expectSplitError(
      () =>
        computeSplitPlan(source, {
          movedItems: moves,
          newOrderPayment: { kind: "cod" },
          chargeShares: { otherCharges: { o9: 1 } },
        }),
      "invalid-charge-share",
      'no source charge "o9" to allocate',
    );
  });

  it("rejects a malformed source order (duplicate ids, negative money)", () => {
    expectSplitError(
      () =>
        computeSplitPlan(
          {
            ...source,
            items: [
              { id: "a", productName: "X", quantity: 1, unitPrice: 10 },
              { id: "a", productName: "Y", quantity: 1, unitPrice: 10 },
            ],
          },
          { movedItems: [{ itemId: "a", quantity: 1 }], newOrderPayment: { kind: "cod" } },
        ),
      "invalid-source",
      'duplicate source item id "a"',
    );
    expectSplitError(
      () =>
        computeSplitPlan(
          {
            ...source,
            payments: [
              { id: "p1", method: "cash", amount: 100 },
              { id: "p1", method: "bkash", amount: 50 },
            ],
          },
          { movedItems: moves, newOrderPayment: { kind: "cod" } },
        ),
      "invalid-source",
      'duplicate source payment id "p1"',
    );
    expectSplitError(
      () =>
        computeSplitPlan(
          { ...source, payments: [{ id: "p1", method: "cash", amount: -5 }] },
          { movedItems: moves, newOrderPayment: { kind: "cod" } },
        ),
      "invalid-source",
      'payment "p1" amount must be a non-negative finite number',
    );
  });
});
