import { describe, expect, it } from "vitest";
import {
  buildDispatchOrderPayload,
  mapDispatchEntryResult,
  newCreateIdempotencyKey,
  type DispatchOrderInput,
} from "@/lib/createDispatch";
import type { PathaoAccountOption } from "@/lib/dispatchAccounts";

const account: PathaoAccountOption = {
  key: "int-1:11",
  integrationId: "int-1",
  accountName: "Pathao Main",
  pathaoStoreId: 11,
  pickupStoreName: "Mirpur Hub",
};

const baseInput = (over: Partial<DispatchOrderInput> = {}): DispatchOrderInput => ({
  orderId: "order-1",
  orderNumber: "ORD-1001",
  recipientName: "Customer",
  recipientPhone: "01712345678",
  recipientAddress: "House 12, Road 4, Dhaka",
  recipientCity: 1,
  recipientZone: 298,
  recipientArea: 37,
  itemQuantity: 3,
  itemWeight: null,
  amountToCollect: 900,
  itemLines: [
    { product_name: "Shirt - XL", quantity: 2 },
    { product_name: "Pan", quantity: 1 },
  ],
  includeItemDescription: false,
  ...over,
});

describe("buildDispatchOrderPayload", () => {
  it("mirrors the DispatchDialog doDispatch order_payload shape", () => {
    const entry = buildDispatchOrderPayload(baseInput(), account);
    expect(entry.order_id).toBe("order-1");
    expect(entry.order_payload).toEqual({
      store_id: 11,
      merchant_order_id: "ORD-1001",
      recipient_name: "Customer",
      recipient_phone: "01712345678",
      recipient_address: "House 12, Road 4, Dhaka",
      recipient_city: 1,
      recipient_zone: 298,
      recipient_area: 37,
      delivery_type: 48,
      item_type: 2,
      item_quantity: 3,
      item_weight: 0.5,
      amount_to_collect: 900,
    });
  });

  it("uses the Pathao Account's pickup store and falls back to 0.5kg weight", () => {
    const entry = buildDispatchOrderPayload(
      baseInput({ itemWeight: 0.5 }),
      { ...account, pathaoStoreId: 42 },
    );
    expect(entry.order_payload.store_id).toBe(42);
    expect(entry.order_payload.item_weight).toBe(0.5);
  });

  it("omits recipient_area when no area is selected", () => {
    const entry = buildDispatchOrderPayload(baseInput({ recipientArea: null }), account);
    expect("recipient_area" in entry.order_payload).toBe(false);
  });

  it("never sets special_instruction (the API does not require it for item info)", () => {
    const entry = buildDispatchOrderPayload(baseInput({ includeItemDescription: true }), account);
    expect("special_instruction" in entry.order_payload).toBe(false);
  });

  it("puts product names + quantities + variation labels in item_description when the account option is ON", () => {
    const entry = buildDispatchOrderPayload(baseInput({ includeItemDescription: true }), account);
    expect(entry.order_payload.item_description).toBe("2x Shirt (XL), 1x Pan");
  });

  it("omits item_description when the account option is OFF (the default)", () => {
    const entry = buildDispatchOrderPayload(baseInput({ includeItemDescription: false }), account);
    expect("item_description" in entry.order_payload).toBe(false);
  });

  it("omits item_description when the option is ON but no lines produce text", () => {
    const entry = buildDispatchOrderPayload(
      baseInput({ includeItemDescription: true, itemLines: [] }),
      account,
    );
    expect("item_description" in entry.order_payload).toBe(false);
  });

  it("keeps item_description within the API limit", () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({
      product_name: `Product ${i} - Size ${i}`,
      quantity: i + 1,
    }));
    const entry = buildDispatchOrderPayload(
      baseInput({ includeItemDescription: true, itemLines: lines }),
      account,
    );
    expect(String(entry.order_payload.item_description).length).toBeLessThanOrEqual(255);
  });

  it("coerces amount_to_collect to a number, defaulting to 0", () => {
    const entry = buildDispatchOrderPayload(baseInput({ amountToCollect: NaN }), account);
    expect(entry.order_payload.amount_to_collect).toBe(0);
  });
});

describe("mapDispatchEntryResult", () => {
  it("maps a successful create_bulk entry to dispatched", () => {
    expect(
      mapDispatchEntryResult({ order_id: "order-1", success: true, consignment_id: "DL123" }),
    ).toEqual({ status: "dispatched", consignmentId: "DL123" });
  });

  it("maps the edge function's 'already has a courier entry' guard to already_dispatched", () => {
    expect(
      mapDispatchEntryResult({
        order_id: "order-1",
        success: false,
        skipped: true,
        has_existing: true,
        existing_consignment_id: "DL999",
        consignment_id: "DL999",
        error: "Order ORD-1001 already has a courier entry (DL999).",
      }),
    ).toEqual({ status: "already_dispatched", consignmentId: "DL999" });
  });

  it("treats a lost-response retry with a bare existing consignment as already_dispatched", () => {
    expect(
      mapDispatchEntryResult({
        order_id: "order-1",
        success: false,
        skipped: true,
        consignment_id: "DL777",
      }),
    ).toEqual({ status: "already_dispatched", consignmentId: "DL777" });
  });

  it("maps an errored entry to failed with the error text", () => {
    expect(
      mapDispatchEntryResult({ order_id: "order-1", success: false, error: "Pathao refused" }),
    ).toEqual({ status: "failed", error: "Pathao refused" });
  });

  it("maps a missing result to failed", () => {
    expect(mapDispatchEntryResult(undefined)).toEqual({
      status: "failed",
      error: "Pathao dispatch failed",
    });
    expect(mapDispatchEntryResult(null)).toEqual({
      status: "failed",
      error: "Pathao dispatch failed",
    });
  });

  it("maps a success without a consignment id to failed (nothing to show)", () => {
    expect(mapDispatchEntryResult({ order_id: "order-1", success: true })).toEqual({
      status: "failed",
      error: "Pathao dispatch failed",
    });
  });
});

describe("newCreateIdempotencyKey (create_order guard)", () => {
  it("produces unique, prefixed keys", () => {
    const a = newCreateIdempotencyKey();
    const b = newCreateIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a.startsWith("add-order-")).toBe(true);
    expect(b.startsWith("add-order-")).toBe(true);
  });
});
