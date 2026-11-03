import { describe, expect, it } from "vitest";
import { NON_REVENUE_STATUSES, isRevenueOrder, revenueOrders } from "@/lib/orderRevenue";

// Task 13 regression: a merge keeps the absorbed orders with status "merged",
// so any aggregate that only skipped "cancelled" counted the same money twice.
describe("orderRevenue", () => {
  it("excludes merged source orders so a merge cannot inflate the total bill", () => {
    const merged = { status: "merged" };
    const parent = { status: "delivered" };
    expect(isRevenueOrder(merged)).toBe(false);
    expect(isRevenueOrder(parent)).toBe(true);
    expect(revenueOrders([merged, parent])).toEqual([parent]);
  });

  it("excludes cancelled, failed, refunded and returned orders", () => {
    for (const status of ["cancelled", "failed", "refunded", "returned"]) {
      expect(isRevenueOrder({ status })).toBe(false);
    }
    expect(NON_REVENUE_STATUSES.has("merged")).toBe(true);
  });

  it("treats working states as revenue and is case-insensitive", () => {
    for (const status of ["pending", "processing", "ready_to_ship", "Pickup Pending", "delivered", "completed"]) {
      expect(isRevenueOrder({ status })).toBe(true);
    }
    expect(isRevenueOrder({ status: "CANCELLED" })).toBe(false);
    expect(isRevenueOrder({ status: null })).toBe(true);
  });
});