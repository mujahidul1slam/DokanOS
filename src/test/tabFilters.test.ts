import { describe, it, expect } from "vitest";
import { matchesTab, type TabOrder } from "@/pages/orders/tabFilters";
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
