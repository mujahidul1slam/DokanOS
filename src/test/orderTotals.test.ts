import { describe, expect, it } from "vitest";
import { computeOrderTotals } from "@/lib/orderTotals";

// Regression for the money-losing defect found on 2026-11-24: a WooCommerce
// order whose value comes from a fee (no line items) imported as total 1.00,
// then dropped to 0.00 the moment it was opened and saved, because the sheet
// rebuilt the total from an empty item list. The stored money must survive a
// save that never touched the items.
describe("computeOrderTotals", () => {
  it("keeps the stored money of an order whose value is not in its line items", () => {
    const totals = computeOrderTotals({
      items: [],
      discount: 0,
      shippingCost: 0,
      taxAmount: 0,
      storedSubtotal: 1,
      storedTotal: 1,
      itemsTouched: false,
    });

    expect(totals.subtotal).toBe(1);
    expect(totals.total).toBe(1);
  });

  it("still recomputes from the items when the items explain the money", () => {
    const totals = computeOrderTotals({
      items: [
        { quantity: 2, unit_price: 500 },
        { quantity: 1, unit_price: 250 },
      ],
      discount: 100,
      shippingCost: 60,
      taxAmount: 0,
      storedSubtotal: 1250,
      storedTotal: 1210,
      itemsTouched: false,
    });

    expect(totals.subtotal).toBe(1250);
    expect(totals.total).toBe(1210);
  });

  it("applies tax and shipping on top of a carried amount", () => {
    const totals = computeOrderTotals({
      items: [],
      discount: 0,
      shippingCost: 60,
      taxAmount: 5,
      storedSubtotal: 100,
      storedTotal: 165,
      itemsTouched: false,
    });

    expect(totals.subtotal).toBe(100);
    expect(totals.total).toBe(165);
  });

  it("lets a deliberate item edit win, so removing every line can still zero the order", () => {
    const totals = computeOrderTotals({
      items: [],
      discount: 0,
      shippingCost: 0,
      taxAmount: 0,
      storedSubtotal: 1,
      storedTotal: 1,
      itemsTouched: true,
    });

    expect(totals.subtotal).toBe(0);
    expect(totals.total).toBe(0);
  });

  it("treats a missing stored total as zero rather than inventing money", () => {
    const totals = computeOrderTotals({
      items: [],
      discount: 0,
      shippingCost: 0,
      taxAmount: 0,
      storedSubtotal: null,
      storedTotal: null,
      itemsTouched: false,
    });

    expect(totals.subtotal).toBe(0);
    expect(totals.total).toBe(0);
  });
});
