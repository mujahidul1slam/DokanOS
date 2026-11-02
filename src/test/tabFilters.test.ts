import { describe, it, expect } from "vitest";
import {
  matchesTab,
  ALL_TAB_KEYS,
  showDuplicateWarningOn,
  showMergePanelOn,
  type TabKey,
  type TabOrder,
} from "@/pages/orders/tabFilters";
import { mapWooStatus, derivePaymentStatus } from "../../supabase/functions/_shared/woo-mapping";

describe("tabFilters - Delivered and other tabs", () => {
  const preOrderOrderIds = new Set<string>();

  it("should match delivered status in delivered tab", () => {
    const order: TabOrder = {
      id: "ord-1",
      status: "delivered",
      consignment_id: null,
      tracking_status: null,
    };
    expect(matchesTab(order, "delivered", preOrderOrderIds)).toBe(true);
    expect(matchesTab(order, "all", preOrderOrderIds)).toBe(true);
    expect(matchesTab(order, "new", preOrderOrderIds)).toBe(false);
  });

  it("should match courier tracking delivered state in delivered tab", () => {
    const order: TabOrder = {
      id: "ord-2",
      status: "shipped",
      consignment_id: "CONS123",
      tracking_status: "Delivered",
    };
    expect(matchesTab(order, "delivered", preOrderOrderIds)).toBe(true);
  });

  it("should match ready_to_ship in ready tab", () => {
    const order: TabOrder = {
      id: "ord-3",
      status: "ready_to_ship",
      consignment_id: null,
      tracking_status: null,
    };
    expect(matchesTab(order, "ready", preOrderOrderIds)).toBe(true);
    expect(matchesTab(order, "delivered", preOrderOrderIds)).toBe(false);
  });

  it("should match processing in new tab", () => {
    const order: TabOrder = {
      id: "ord-4",
      status: "processing",
      consignment_id: null,
      tracking_status: null,
    };
    expect(matchesTab(order, "new", preOrderOrderIds)).toBe(true);
  });

  it("treats fresh unpaid (pending) orders as New-tab work (issue #9 follow-up)", () => {
    // A fresh unpaid Woo order lands in "pending" (mapWooStatus maps it 1:1
    // and falls back to "pending" for unknowns). It must be New-tab work —
    // before this it matched NO active tab ("all" only), so new orders
    // "didn't load" in New.
    for (const status of ["pending", "processing", "payment_pending"]) {
      const order: TabOrder = { id: "ord-4p", status, consignment_id: null, tracking_status: null };
      expect(matchesTab(order, "new", preOrderOrderIds), `status "${status}"`).toBe(true);
    }
    // …and only New (plus "all"): not the pre-dispatch tabs it hasn't reached.
    const pending: TabOrder = { id: "ord-4p", status: "pending", consignment_id: null, tracking_status: null };
    expect(matchesTab(pending, "all", preOrderOrderIds)).toBe(true);
    expect(matchesTab(pending, "ready", preOrderOrderIds)).toBe(false);
    expect(matchesTab(pending, "pre_order", preOrderOrderIds)).toBe(false);
    expect(matchesTab(pending, "pickup_pending", preOrderOrderIds)).toBe(false);
  });

  it("keeps pre-order pending orders out of New and caught by Pre-Order", () => {
    // Interplay pin: the "new" rule excludes pre-order orders and the
    // "pre_order" catch includes any still-pre-dispatch status — so a
    // category-detected "pending" pre-order shows in Pre-Order, never New.
    const preOrderIds = new Set(["ord-4pre"]);
    const order: TabOrder = { id: "ord-4pre", status: "pending", consignment_id: null, tracking_status: null };
    expect(matchesTab(order, "new", preOrderIds)).toBe(false);
    expect(matchesTab(order, "pre_order", preOrderIds)).toBe(true);
  });

  it("should match pre_order in pre_order tab", () => {
    const order: TabOrder = {
      id: "ord-5",
      status: "pre_order_pending",
      consignment_id: null,
      tracking_status: null,
    };
    expect(matchesTab(order, "pre_order", preOrderOrderIds)).toBe(true);
    expect(matchesTab(order, "pre_order_pending", preOrderOrderIds)).toBe(true);
  });
});

describe("woo-mapping - WooCommerce status mapping", () => {
  it("should map WooCommerce completed status to DokanOS delivered status", () => {
    expect(mapWooStatus("completed")).toBe("delivered");
  });

  it("should map processing, pending, cancelled, refunded accurately", () => {
    expect(mapWooStatus("processing")).toBe("processing");
    expect(mapWooStatus("pending")).toBe("pending");
    expect(mapWooStatus("cancelled")).toBe("cancelled");
    expect(mapWooStatus("refunded")).toBe("returned");
    expect(mapWooStatus("failed")).toBe("cancelled");
  });

  it("should derive payment status correctly for delivered orders", () => {
    expect(derivePaymentStatus({ payment_method: "bKash", status: "delivered" })).toBe("paid");
    expect(derivePaymentStatus({ payment_method: "card", status: "completed" })).toBe("paid");
    expect(derivePaymentStatus({ payment_method: "cod", status: "processing" })).toBe("cod");
  });
});

describe("banner tab visibility (issue #7)", () => {
  // The user's decision: duplicate warning on new/pre-order/ready/pickup/transit
  // ONLY; merge panel on new/pre-order/ready/pickup ONLY. Everything else
  // (all, delivered, on_hold, returned, cancelled, trash, deep-linked
  // pre-order sub-keys) must not show them.
  const duplicateTabs: TabKey[] = ["new", "pre_order", "ready", "pickup_pending", "in_transit"];
  const mergeTabs: TabKey[] = ["new", "pre_order", "ready", "pickup_pending"];

  it("shows the duplicate warning exactly on new/pre-order/ready/pickup/transit", () => {
    for (const key of ALL_TAB_KEYS) {
      expect(showDuplicateWarningOn(key), `duplicate warning on "${key}"`).toBe(
        duplicateTabs.includes(key)
      );
    }
  });

  it("shows the merge panel exactly on new/pre-order/ready/pickup (not transit)", () => {
    for (const key of ALL_TAB_KEYS) {
      expect(showMergePanelOn(key), `merge panel on "${key}"`).toBe(mergeTabs.includes(key));
    }
    // Explicitly pin the duplicate/merge asymmetry the user asked for.
    expect(showDuplicateWarningOn("in_transit")).toBe(true);
    expect(showMergePanelOn("in_transit")).toBe(false);
  });

  it("keeps both banners off the archive tabs", () => {
    for (const key of ["all", "delivered", "on_hold", "returned", "cancelled", "trash"] as TabKey[]) {
      expect(showDuplicateWarningOn(key)).toBe(false);
      expect(showMergePanelOn(key)).toBe(false);
    }
  });
});
