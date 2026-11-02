import { describe, it, expect } from "vitest";
import {
  buildOrderCategoryMap,
  chunkArray,
  collectProductIds,
  PRODUCT_CATEGORY_QUERY_CHUNK,
} from "@/pages/orders/orderCategoryMap";

/**
 * Issue #9 regression tests: the order → category-id map feeds the "new" and
 * "pre_order" tab rules, so a partial map silently moves orders between
 * exactly those two tabs. These pin that the map is complete whenever its
 * inputs are, and that request-shaping helpers stay bounded.
 */
describe("orderCategoryMap (issue #9)", () => {
  describe("buildOrderCategoryMap", () => {
    it("maps each order to the categories of its items' products", () => {
      const map = buildOrderCategoryMap(
        [
          { id: "o1", order_items: [{ product_id: "p1" }, { product_id: "p2" }] },
          { id: "o2", order_items: [{ product_id: "p2" }] },
        ],
        [
          { product_id: "p1", category_id: "c1" },
          { product_id: "p1", category_id: "c2" },
          { product_id: "p2", category_id: "c3" },
        ],
      );
      expect(map.get("o1")).toEqual(new Set(["c1", "c2", "c3"]));
      expect(map.get("o2")).toEqual(new Set(["c3"]));
    });

    it("gives every order an entry — empty set, not missing — so 'no' is distinguishable from 'not loaded'", () => {
      const map = buildOrderCategoryMap(
        [
          { id: "o1", order_items: [] },
          { id: "o2", order_items: [{ product_id: "unknown-product" }] },
          { id: "o3" },
        ],
        [],
      );
      expect(map.size).toBe(3);
      expect(map.get("o1")).toEqual(new Set());
      expect(map.get("o2")).toEqual(new Set());
      expect(map.get("o3")).toEqual(new Set());
    });

    it("handles product_ids shared across orders and duplicate category rows", () => {
      const map = buildOrderCategoryMap(
        [
          { id: "o1", order_items: [{ product_id: "p1" }, { product_id: "p1" }] },
          { id: "o2", order_items: [{ product_id: "p1" }] },
        ],
        [
          { product_id: "p1", category_id: "c1" },
          { product_id: "p1", category_id: "c1" },
        ],
      );
      expect(map.get("o1")).toEqual(new Set(["c1"]));
      expect(map.get("o2")).toEqual(new Set(["c1"]));
    });
  });

  describe("collectProductIds", () => {
    it("collects distinct non-empty product ids in first-seen order", () => {
      expect(
        collectProductIds([
          { id: "o1", order_items: [{ product_id: "p2" }, { product_id: "p1" }] },
          { id: "o2", order_items: [{ product_id: "p1" }, { product_id: null }, {}] },
          { id: "o3" },
        ]),
      ).toEqual(["p2", "p1"]);
    });
  });

  describe("chunkArray", () => {
    it("splits into bounded chunks with a shorter remainder", () => {
      expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(chunkArray([], 2)).toEqual([]);
      expect(chunkArray([1], 2)).toEqual([[1]]);
    });

    it("rejects a non-positive chunk size instead of looping forever", () => {
      expect(() => chunkArray([1], 0)).toThrow();
      expect(() => chunkArray([1], -1)).toThrow();
    });

    it("keeps the shipped chunk size small enough to bound request URLs", () => {
      // 150 UUIDs ≈ 5.6KB of query string — under common 8KB proxy limits.
      expect(PRODUCT_CATEGORY_QUERY_CHUNK).toBeLessThanOrEqual(150);
    });
  });
});
