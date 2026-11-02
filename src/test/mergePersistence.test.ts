import { describe, it, expect } from "vitest";
import {
  MERGED_STATUS,
  buildMergeAuditDetails,
  buildMergeTimelineEntries,
  buildMergedItemRows,
  buildMergedOrderRow,
  buildSourceOrderUpdate,
  describeChargeAllocation,
  describeMergeBlock,
  formatOrderNumberList,
  mergedPaymentIds,
} from "@/lib/mergePersistence";
import { mergeOrders, type MergeOrder, type MergedOrder } from "@/lib/orderMerge";
import { matchesTab, type TabKey } from "@/pages/orders/tabFilters";

/**
 * Merge persistence payloads + merged-status tab treatment (issue #30).
 *
 * Money contract (docs/adr/0002-order-merge-split-payment-semantics.md):
 *  - ONE new orders row; status = merged.state; money straight from totals.
 *  - Payment records are MOVED (UPDATE order_id) — never re-inserted.
 *  - Source orders: status "merged" + parent_order_id link, NO deleted_at.
 */

function makeOrder(over: Partial<MergeOrder> & { id: string }): MergeOrder {
  return {
    order_number: `ORD-${over.id.toUpperCase()}`,
    source: "woo",
    store_id: "store-1",
    order_source_id: "point-1",
    status: "processing",
    consignment_id: null,
    deleted_at: null,
    customer_name: "Customer",
    customer_phone: "01712345678",
    subtotal: 100,
    discount: 0,
    shipping_cost: 0,
    tax_amount: 0,
    total: 100,
    items: [],
    payments: [],
    ...over,
  };
}

function mergedFixture(): MergedOrder {
  const outcome = mergeOrders([
    makeOrder({
      id: "a1",
      order_number: "A-1",
      items: [
        { product_id: "p1", variation_id: null, product_name: "Shirt - L", quantity: 1, unit_price: 100, discount: 0, line_total: 100 },
      ],
      payments: [{ id: "pay-1", amount: 60, method: "bKash", trx_id: "TX1" }],
      total: 100,
    }),
    makeOrder({
      id: "b1",
      order_number: "B-1",
      items: [
        { product_id: "p1", variation_id: null, product_name: "Shirt - L", quantity: 2, unit_price: 100, discount: 0, line_total: 200 },
      ],
      payments: [{ id: "pay-2", amount: 40, method: "cash", trx_id: null }],
      subtotal: 200,
      total: 200,
    }),
  ]);
  if (!outcome.ok) throw new Error("fixture must merge");
  return outcome.merged;
}

describe("buildMergedOrderRow", () => {
  it("keeps the shared source state and takes money straight from merged.totals", () => {
    const merged = mergedFixture();
    const row = buildMergedOrderRow(merged, "NEW-1");
    expect(row.status).toBe(merged.state);
    expect(row.order_number).toBe("NEW-1");
    expect(row.subtotal).toBe(merged.totals.subtotal);
    expect(row.discount).toBe(merged.totals.discount);
    expect(row.shipping_cost).toBe(merged.totals.shipping_cost);
    expect(row.tax_amount).toBe(merged.totals.tax_amount);
    expect(row.total).toBe(merged.totals.total);
    expect(row.amount_to_collect).toBe(merged.totals.amount_to_collect);
    expect(row.payment_status).toBe(merged.totals.payment_status);
    expect(row.customer_name).toBe(merged.customer_name);
    expect(row.customer_phone).toBe(merged.customer_phone);
    expect(row.source).toBe("woo");
    expect(row.store_id).toBe("store-1");
    expect(row.order_source_id).toBe("point-1");
    // The merged total is the money-exact sum of the source totals (100 + 200).
    expect(row.total).toBe(300);
  });

  it("leaves parent_order_id off the merged order — the link lives on the sources", () => {
    const row = buildMergedOrderRow(mergedFixture(), "NEW-1");
    expect(row.parent_order_id).toBeUndefined();
    expect(row.deleted_at).toBeUndefined();
  });
});

describe("buildMergedItemRows", () => {
  it("emits one order_items row per merged line, linked to the new order", () => {
    const merged = mergedFixture();
    const rows = buildMergedItemRows("new-id", merged.items);
    expect(rows).toHaveLength(1); // identical "Shirt - L" @ 100 lines roll up
    expect(rows[0]).toMatchObject({
      order_id: "new-id",
      product_name: "Shirt - L",
      quantity: 3,
      unit_price: 100,
      line_total: 300,
    });
  });
});

describe("mergedPaymentIds", () => {
  it("lists the payment records to MOVE — never re-insert", () => {
    const merged = mergedFixture();
    expect(mergedPaymentIds(merged.payments)).toEqual(["pay-1", "pay-2"]);
  });
});

describe("buildSourceOrderUpdate", () => {
  it("marks sources merged and links parent_order_id, with NO deleted_at", () => {
    const update = buildSourceOrderUpdate("new-id");
    expect(update.status).toBe(MERGED_STATUS);
    expect(update.status).toBe("merged");
    expect(update.parent_order_id).toBe("new-id");
    expect(Object.keys(update)).not.toContain("deleted_at");
  });
});

describe("buildMergeTimelineEntries", () => {
  it("covers the merged order and every source with source numbers + charge allocation in the text", () => {
    const merged = mergedFixture();
    const entries = buildMergeTimelineEntries(merged, "new-id", "NEW-1");
    expect(entries).toHaveLength(3); // merged + 2 sources

    const onMerged = entries.find((e) => e.order_id === "new-id")!;
    expect(onMerged.description).toContain("#A-1");
    expect(onMerged.description).toContain("#B-1");
    expect(onMerged.description).toContain("#A-1: total 100");
    expect(onMerged.description).toContain("#B-1: total 200");

    for (const sourceId of ["a1", "b1"]) {
      const e = entries.find((x) => x.order_id === sourceId)!;
      expect(e.description).toContain("#NEW-1");
      // charge allocation for THAT source is spelled out
      expect(e.description).toMatch(/subtotal 100|subtotal 200/);
      expect(e.description).toContain("merged order in full");
    }

    // Every entry carries the charge allocation metadata for auditability.
    for (const e of entries) {
      expect(e.metadata.charge_allocation).toHaveLength(2);
      expect(e.metadata.source_order_numbers).toEqual(["A-1", "B-1"]);
    }
  });
});

describe("buildMergeAuditDetails", () => {
  it("records sources, allocation, totals and the MOVED payment ids", () => {
    const merged = mergedFixture();
    const details = buildMergeAuditDetails(merged, "new-id", "NEW-1");
    expect(details.merged_order_id).toBe("new-id");
    expect(details.source_order_numbers).toEqual(["A-1", "B-1"]);
    expect(details.payment_ids_moved).toEqual(["pay-1", "pay-2"]);
    expect(details.totals).toEqual(merged.totals);
  });
});

describe("formatOrderNumberList / describeChargeAllocation", () => {
  it("formats source numbers and allocation for text", () => {
    expect(formatOrderNumberList(["A-1", "B-1"])).toBe("#A-1, #B-1");
    expect(
      describeChargeAllocation([
        { order_id: "a1", order_number: "A-1", subtotal: 100, discount: 0, shipping_cost: 0, tax_amount: 0, total: 100 },
      ])
    ).toBe("#A-1: total 100");
  });
});

describe("describeMergeBlock", () => {
  const numbers = new Map([["a1", "A-1"]]);
  it("explains the pre-entry gate in plain words", () => {
    expect(describeMergeBlock({ reason: "entered", order_id: "a1" }, numbers)).toContain("#A-1");
    expect(describeMergeBlock({ reason: "entered", order_id: "a1" }, numbers)).toContain("pre-entry only");
    expect(describeMergeBlock({ reason: "too_few_orders" }, numbers)).toContain("at least two");
    expect(describeMergeBlock({ reason: "different_state" }, numbers)).toContain("different states");
    expect(describeMergeBlock({ reason: "different_customer" }, numbers)).toContain("different customers");
    expect(describeMergeBlock({ reason: "missing_phone", order_id: "zz" }, numbers)).toContain("#zz");
    expect(describeMergeBlock({ reason: "deleted", order_id: "a1" }, numbers)).toContain("trash");
    expect(describeMergeBlock({ reason: "duplicate_order", order_id: "a1" }, numbers)).toContain("more than once");
  });
});

describe('merged-source tab treatment ("merged" status, issue #30)', () => {
  const mergedSource = {
    id: "m1",
    status: "merged",
    consignment_id: null,
    tracking_status: null,
    deleted_at: null,
  };
  const noPre = new Set<string>();

  it("shows ONLY under the all tab", () => {
    expect(matchesTab(mergedSource, "all", noPre)).toBe(true);
  });

  it("is excluded from every active tab", () => {
    const activeTabs: TabKey[] = [
      "new", "ready", "pre_order", "pre_order_pending", "pre_order_making",
      "pre_order_ready", "pickup_pending", "in_transit", "delivered", "on_hold",
      "returned", "cancelled",
    ];
    for (const tab of activeTabs) {
      expect(matchesTab(mergedSource, tab, noPre), tab).toBe(false);
    }
  });

  it("is excluded even when it would otherwise match pre-order rules", () => {
    expect(matchesTab(mergedSource, "pre_order", new Set(["m1"]))).toBe(false);
  });

  it("never lands in trash without deleted_at", () => {
    expect(matchesTab(mergedSource, "trash", noPre)).toBe(false);
  });
});
