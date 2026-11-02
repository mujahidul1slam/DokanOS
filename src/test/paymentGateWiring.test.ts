import { describe, it, expect } from "vitest";
import {
  quickActionGateChannel,
  isOrderLockedFor,
  isQuickActionLocked,
  splitGatedOrders,
  gateLockedMessage,
  type GateWiringOrder,
} from "@/lib/paymentGateWiring";

// Issue #27 (row/bulk gate wiring). Seam under test: the pure skip-and-notify
// helpers in @/lib/paymentGateWiring — which quick-action keys map to a gate
// channel, which orders a bulk run must skip, and the "Order X is locked —
// Payment Needs Confirmation" toast wording.

const gatedOrder = (over: Partial<GateWiringOrder> = {}): GateWiringOrder => ({
  order_number: "1042",
  source: "online",
  payment_method: "bkash",
  payment_status: "online",
  ...over,
});

describe("paymentGateWiring - row/bulk gate skip rules", () => {
  it("maps courier/status quick-action keys to gate channels and nothing else", () => {
    expect(quickActionGateChannel("dispatch")).toBe("courier");
    expect(quickActionGateChannel("attach_parcel")).toBe("courier");
    expect(quickActionGateChannel("replace_parcel")).toBe("courier");
    expect(quickActionGateChannel("ready")).toBe("status");
    for (const key of ["edit", "print", "track", "trash", "restore", "view_merged", "unknown"]) {
      expect(quickActionGateChannel(key), `key "${key}" must not be gated`).toBeNull();
    }
  });

  it("locks only courier/status quick actions on a gated order", () => {
    const order = gatedOrder();
    for (const key of ["dispatch", "attach_parcel", "replace_parcel", "ready"]) {
      expect(isQuickActionLocked(key, order), `key "${key}" must be locked`).toBe(true);
    }
    for (const key of ["edit", "print", "track", "trash", "restore"]) {
      expect(isQuickActionLocked(key, order), `key "${key}" must stay unlocked`).toBe(false);
    }
  });

  it("never locks quick actions once the payment gate is released", () => {
    const released = [
      gatedOrder({ source: "pos" }),
      gatedOrder({ payment_method: "cod" }),
      gatedOrder({ payment_status: "paid" }),
      gatedOrder({ payment_status: "partial" }),
    ];
    for (const order of released) {
      for (const key of ["dispatch", "attach_parcel", "replace_parcel", "ready"]) {
        expect(isQuickActionLocked(key, order), `${JSON.stringify(order)} must be unlocked`).toBe(false);
      }
    }
  });

  it("respects the gate channel per action type", () => {
    const order = gatedOrder();
    expect(isOrderLockedFor(order, "courier")).toBe(true);
    expect(isOrderLockedFor(order, "status")).toBe(true);
    const free = gatedOrder({ source: "manual" });
    expect(isOrderLockedFor(free, "courier")).toBe(false);
    expect(isOrderLockedFor(free, "status")).toBe(false);
  });

  it("splits a bulk batch, skipping only gated orders", () => {
    const orders = [
      gatedOrder({ order_number: "1", source: "manual" }),
      gatedOrder({ order_number: "2" }),
      gatedOrder({ order_number: "3", payment_status: "paid" }),
      gatedOrder({ order_number: "4" }),
    ];
    const { allowed, skipped } = splitGatedOrders(orders, "status");
    expect(allowed.map((o) => o.order_number)).toEqual(["1", "3"]);
    expect(skipped.map((o) => o.order_number)).toEqual(["2", "4"]);
  });

  it("keeps orders without payment fields (unknown rows) runnable, never skipped", () => {
    const bare = { order_number: "9", source: null, payment_method: null, payment_status: null };
    const { allowed, skipped } = splitGatedOrders([bare], "courier");
    expect(allowed).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  it("phrases the lock toast naming the skipped order(s)", () => {
    expect(gateLockedMessage([gatedOrder({ order_number: "1042" })])).toBe(
      "Order 1042 is locked — Payment Needs Confirmation",
    );
    expect(
      gateLockedMessage([gatedOrder({ order_number: "1" }), gatedOrder({ order_number: "2" })]),
    ).toBe("Orders 1, 2 are locked — Payment Needs Confirmation");
    expect(gateLockedMessage([])).toBe("Locked — Payment Needs Confirmation");
  });

  it("keeps long skip lists brief (max 3 names, then a count)", () => {
    const many = ["1", "2", "3", "4", "5"].map((order_number) => gatedOrder({ order_number }));
    expect(gateLockedMessage(many)).toBe("Orders 1, 2, 3 +2 more are locked — Payment Needs Confirmation");
  });
});
