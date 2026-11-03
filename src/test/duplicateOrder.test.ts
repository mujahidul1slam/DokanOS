import { describe, expect, it } from "vitest";
import {
  DUPLICATE_ORDER_WINDOW_HOURS,
  DUPLICATE_ORDER_WINDOW_MS,
  findDuplicateOrderPairs,
  findDuplicateOrders,
  normalizeCustomerPhone,
  parseOrderItemName,
} from "@/lib/duplicateOrder";
import type { DuplicateOrderCandidate } from "@/lib/duplicateOrder";

/** A fixed "now" so every test is deterministic. */
const TAKEN_AT = "2026-10-26T12:00:00+06:00";

/** Build a candidate order with sane defaults; override only what the test cares about. */
function order(overrides: Partial<DuplicateOrderCandidate> = {}): DuplicateOrderCandidate {
  return {
    orderNumber: "#2000",
    createdAt: TAKEN_AT,
    customerPhone: "01711-123456",
    brandId: "brand-a",
    items: [{ productName: "Cotton Shirt" }],
    ...overrides,
  };
}

describe("duplicate order detection (issue #29)", () => {
  describe("the settled rule", () => {
    it("warns when the same customer reorders the same product of the same brand within 48h", () => {
      const newOrder = order({
        orderNumber: "#2000",
        items: [{ productName: "Cotton Shirt - L / Navy" }],
      });
      const recentOrder = order({
        orderNumber: "#1001",
        createdAt: "2026-10-25T12:00:00+06:00",
        customerPhone: "+880 1711-123456", // same customer, different formatting
        items: [{ productName: "Cotton Shirt" }],
      });

      const warning = findDuplicateOrders(newOrder, [recentOrder]);

      expect(warning.isDuplicateCandidate).toBe(true);
      expect(warning.matches).toHaveLength(1);
      // Enough detail for a UI warning: matched order number, when, shared products.
      expect(warning.matches[0].orderNumber).toBe("#1001");
      expect(warning.matches[0].createdAt).toBe("2026-10-25T12:00:00+06:00");
      expect(warning.matches[0].sharedProducts).toEqual([
        {
          name: "Cotton Shirt",
          newVariationLabel: "L / Navy",
          previousVariationLabel: null,
          newOrderLine: "Cotton Shirt - L / Navy",
          previousOrderLine: "Cotton Shirt",
        },
      ]);
    });
  });

  describe("customer matching (normalized phone)", () => {
    it("treats phone formatting variants of one number as the same customer", () => {
      const variants = ["+880 1711-123456", "8801711123456", "01711 123456", "1711123456"];
      for (const customerPhone of variants) {
        const warning = findDuplicateOrders(order(), [
          order({
            orderNumber: "#1001",
            createdAt: "2026-10-25T12:00:00+06:00",
            customerPhone,
          }),
        ]);
        expect(warning.isDuplicateCandidate, `phone variant ${customerPhone}`).toBe(true);
      }
    });

    it("does not treat different phone numbers as the same customer", () => {
      const warning = findDuplicateOrders(order(), [
        order({
          orderNumber: "#1001",
          createdAt: "2026-10-25T12:00:00+06:00",
          customerPhone: "01911-654321",
        }),
      ]);
      expect(warning.isDuplicateCandidate).toBe(false);
    });

    it("never matches orders without a phone (anonymous walk-ins)", () => {
      const warning = findDuplicateOrders(order({ customerPhone: null }), [
        order({
          orderNumber: "#1001",
          createdAt: "2026-10-25T12:00:00+06:00",
          customerPhone: "   ",
        }),
      ]);
      expect(warning.isDuplicateCandidate).toBe(false);
    });

    it("normalizes the existing phone dedup key", () => {
      expect(normalizeCustomerPhone("01711-123456")).toBe("01711123456");
      expect(normalizeCustomerPhone("+8801711123456")).toBe("01711123456");
      expect(normalizeCustomerPhone("1711123456")).toBe("01711123456");
      expect(normalizeCustomerPhone(null)).toBeNull();
      expect(normalizeCustomerPhone("")).toBeNull();
      expect(normalizeCustomerPhone("n/a")).toBeNull();
    });
  });

  describe("brand matching", () => {
    it("never warns across different brands", () => {
      const warning = findDuplicateOrders(order({ brandId: "brand-a" }), [
        order({
          orderNumber: "#1001",
          createdAt: "2026-10-25T12:00:00+06:00",
          brandId: "brand-b",
        }),
      ]);
      expect(warning.isDuplicateCandidate).toBe(false);
    });

    it("never warns when the brand is unknown on either side", () => {
      const recent = order({
        orderNumber: "#1001",
        createdAt: "2026-10-25T12:00:00+06:00",
        brandId: null,
      });
      expect(findDuplicateOrders(order(), [recent]).isDuplicateCandidate).toBe(false);
      expect(
        findDuplicateOrders(order({ brandId: undefined }), [
          order({ orderNumber: "#1001", createdAt: "2026-10-25T12:00:00+06:00" }),
        ]).isDuplicateCandidate,
      ).toBe(false);
    });
  });

  describe("48h window", () => {
    it("does not warn when the previous order is older than 48h", () => {
      const warning = findDuplicateOrders(order(), [
        order({
          orderNumber: "#1001",
          createdAt: "2026-10-24T11:00:00+06:00", // 49h earlier
        }),
      ]);
      expect(warning.isDuplicateCandidate).toBe(false);
    });

    it("honours the 48h boundary (exactly 48h counts, more does not)", () => {
      const taken = Date.parse(TAKEN_AT);
      const atBoundary = findDuplicateOrders(order(), [
        order({
          orderNumber: "#1001",
          createdAt: new Date(taken - DUPLICATE_ORDER_WINDOW_MS),
        }),
      ]);
      const pastBoundary = findDuplicateOrders(order(), [
        order({
          orderNumber: "#1002",
          createdAt: new Date(taken - DUPLICATE_ORDER_WINDOW_MS - 1),
        }),
      ]);
      expect(atBoundary.isDuplicateCandidate).toBe(true);
      expect(pastBoundary.isDuplicateCandidate).toBe(false);
    });

    it("uses a named 48h constant (tunable later)", () => {
      expect(DUPLICATE_ORDER_WINDOW_HOURS).toBe(48);
      expect(DUPLICATE_ORDER_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
    });

    it("matches orders within 48h of each other even when backdated", () => {
      // The new order is entered with an earlier taken-at than an existing
      // order; the pair is still within one window of each other.
      const warning = findDuplicateOrders(
        order({ createdAt: "2026-10-26T10:00:00+06:00" }),
        [order({ orderNumber: "#1001", createdAt: "2026-10-26T12:00:00+06:00" })],
      );
      expect(warning.isDuplicateCandidate).toBe(true);
    });
  });

  describe("product matching", () => {
    it("parses product names with the Name - variationLabel convention", () => {
      expect(parseOrderItemName("Cotton Shirt - L / Navy")).toEqual({
        name: "Cotton Shirt",
        variationLabel: "L / Navy",
      });
      expect(parseOrderItemName("Cotton Shirt")).toEqual({
        name: "Cotton Shirt",
        variationLabel: null,
      });
      // The variation block starts after the LAST " - ".
      expect(parseOrderItemName("Shirt - Cotton - L")).toEqual({
        name: "Shirt - Cotton",
        variationLabel: "L",
      });
    });

    it("shares a product across variation lines (different variation still matches)", () => {
      // Per the spec's product matching: variations are lines of one product,
      // so a shared product with a different variation is still a shared product.
      const warning = findDuplicateOrders(
        order({ items: [{ productName: "Cotton Shirt - XL / Red" }] }),
        [
          order({
            orderNumber: "#1001",
            createdAt: "2026-10-25T12:00:00+06:00",
            items: [{ productName: "Cotton Shirt - L / Navy" }],
          }),
        ],
      );
      expect(warning.isDuplicateCandidate).toBe(true);
      expect(warning.matches[0].sharedProducts).toEqual([
        {
          name: "Cotton Shirt",
          newVariationLabel: "XL / Red",
          previousVariationLabel: "L / Navy",
          newOrderLine: "Cotton Shirt - XL / Red",
          previousOrderLine: "Cotton Shirt - L / Navy",
        },
      ]);
    });

    it("does not warn without at least one shared product", () => {
      const warning = findDuplicateOrders(
        order({ items: [{ productName: "Cotton Shirt" }] }),
        [
          order({
            orderNumber: "#1001",
            createdAt: "2026-10-25T12:00:00+06:00",
            items: [{ productName: "Denim Jeans" }],
          }),
        ],
      );
      expect(warning.isDuplicateCandidate).toBe(false);
    });

    it("does not warn when either order has no items", () => {
      const empty = order({ orderNumber: "#1001", createdAt: "2026-10-25T12:00:00+06:00", items: [] });
      expect(findDuplicateOrders(order(), [empty]).isDuplicateCandidate).toBe(false);
      expect(findDuplicateOrders(order({ items: [] }), [order({ orderNumber: "#1001" })]).isDuplicateCandidate).toBe(false);
    });

    it("matches product names case- and spacing-insensitively", () => {
      const warning = findDuplicateOrders(
        order({ items: [{ productName: "COTTON  shirt - L" }] }),
        [
          order({
            orderNumber: "#1001",
            createdAt: "2026-10-25T12:00:00+06:00",
            items: [{ productName: "Cotton Shirt" }],
          }),
        ],
      );
      expect(warning.isDuplicateCandidate).toBe(true);
    });

    it("uses product identity when both lines know their product id", () => {
      // Same id, even with different display names, is the same product.
      const sameId = findDuplicateOrders(
        order({ items: [{ productId: "p1", productName: "Shirt (New Label)" }] }),
        [
          order({
            orderNumber: "#1001",
            createdAt: "2026-10-25T12:00:00+06:00",
            items: [{ productId: "p1", productName: "Cotton Shirt" }],
          }),
        ],
      );
      expect(sameId.isDuplicateCandidate).toBe(true);
      // Different ids, even with the same name, are different products.
      const differentId = findDuplicateOrders(
        order({ items: [{ productId: "p1", productName: "Cotton Shirt" }] }),
        [
          order({
            orderNumber: "#1002",
            createdAt: "2026-10-25T12:00:00+06:00",
            items: [{ productId: "p9", productName: "Cotton Shirt" }],
          }),
        ],
      );
      expect(differentId.isDuplicateCandidate).toBe(false);
    });
  });

  describe("warn-only result shape and determinism", () => {
    it("returns an empty warn-only result when nothing matches", () => {
      const warning = findDuplicateOrders(order(), []);
      expect(warning).toEqual({ isDuplicateCandidate: false, matches: [] });
      expect(Object.keys(warning).sort()).toEqual(["isDuplicateCandidate", "matches"]);
    });

    it("reports every matching recent order with its shared products", () => {
      const newOrder = order({
        items: [
          { productName: "Cotton Shirt - L / Navy" },
          { productName: "Denim Jeans" },
        ],
      });
      const warning = findDuplicateOrders(newOrder, [
        order({
          orderNumber: "#1001",
          createdAt: "2026-10-26T08:00:00+06:00",
          items: [{ productName: "Denim Jeans" }, { productName: "Cotton Shirt" }],
        }),
        order({
          orderNumber: "#1002",
          createdAt: "2026-10-25T12:00:00+06:00",
          items: [{ productName: "Cotton Shirt - XL" }],
        }),
      ]);
      expect(warning.isDuplicateCandidate).toBe(true);
      expect(warning.matches.map((m) => m.orderNumber)).toEqual(["#1001", "#1002"]);
      expect(warning.matches[0].sharedProducts.map((p) => p.name)).toEqual([
        "Cotton Shirt",
        "Denim Jeans",
      ]);
      expect(warning.matches[1].sharedProducts.map((p) => p.name)).toEqual(["Cotton Shirt"]);
    });

    it("is deterministic regardless of the order of recent orders", () => {
      const newOrder = order();
      const first = order({ orderNumber: "#1001", createdAt: "2026-10-25T12:00:00+06:00" });
      const second = order({ orderNumber: "#1002", createdAt: "2026-10-26T06:00:00+06:00" });
      const oneWay = findDuplicateOrders(newOrder, [first, second]);
      const otherWay = findDuplicateOrders(newOrder, [second, first]);
      expect(oneWay).toEqual(otherWay);
      // Most recent first.
      expect(oneWay.matches.map((m) => m.orderNumber)).toEqual(["#1002", "#1001"]);
    });

    it("never matches an order against itself", () => {
      const newOrder = order({ orderNumber: "#2000" });
      const itself = order({
        orderNumber: "#2000",
        items: [{ productName: "Cotton Shirt - L / Navy" }],
      });
      const warning = findDuplicateOrders(newOrder, [itself]);
      expect(warning.isDuplicateCandidate).toBe(false);
    });

    it("ignores store and selling point differences (they may differ)", () => {
      const warning = findDuplicateOrders(
        order({ storeId: "store-a", sellingPointId: "sp-1" }),
        [
          order({
            orderNumber: "#1001",
            createdAt: "2026-10-25T12:00:00+06:00",
            storeId: "store-b",
            sellingPointId: "sp-2",
          }),
        ],
      );
      expect(warning.isDuplicateCandidate).toBe(true);
    });

    it("carries the matched order's taken-at time through unchanged", () => {
      const warning = findDuplicateOrders(order(), [
        order({ orderNumber: "#1001", createdAt: "2026-10-25T12:00:00+06:00" }),
      ]);
      expect(warning.matches[0].createdAt).toBe("2026-10-25T12:00:00+06:00");
    });

    it("ignores orders with unparseable timestamps", () => {
      const warning = findDuplicateOrders(order(), [
        order({ orderNumber: "#1001", createdAt: "not-a-date" }),
      ]);
      expect(warning.isDuplicateCandidate).toBe(false);
    });
  });

  describe("batch detection", () => {
    it("only compares orders that can share a customer and brand", () => {
      const matches = findDuplicateOrderPairs([
        order({ orderNumber: "#1001" }),
        order({ orderNumber: "#1002", customerPhone: "01911-654321" }),
        order({ orderNumber: "#1003", brandId: "brand-b" }),
        order({ orderNumber: "#1004", createdAt: "2026-10-29T12:00:00+06:00" }),
        order({ orderNumber: "#1005", createdAt: "2026-10-25T12:00:00+06:00" }),
      ]);

      expect(matches.map((match) => [match.first.orderNumber, match.second.orderNumber])).toEqual([
        ["#1001", "#1005"],
      ]);
      expect(matches[0].sharedProducts.map((product) => product.name)).toEqual(["Cotton Shirt"]);
    });

    it("does not turn unrelated New-tab orders into an all-pairs scan", () => {
      const candidates = Array.from({ length: 5000 }, (_, index) =>
        order({
          orderNumber: `#${index}`,
          customerPhone: `017000${String(index).padStart(5, "0")}`,
          items: [{ productName: `Product ${index}` }],
        }),
      );
      const started = performance.now();
      const matches = findDuplicateOrderPairs(candidates);

      expect(matches).toEqual([]);
      expect(performance.now() - started).toBeLessThan(1000);
    });
  });
});
