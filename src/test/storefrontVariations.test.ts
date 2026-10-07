import { describe, it, expect } from "vitest";
import {
  parseVariationAttributes,
  formatVariationLabel,
  joinVariationOptions,
  getProductVariations,
} from "@/lib/variations";
import type { CartItem } from "@/storefront/lib/cart";

describe("Phase 3: Product Variations Helper & Cart Merging (§6.2 / §6.6)", () => {
  describe("parseVariationAttributes", () => {
    it("parses canonical name/option array-of-objects", () => {
      const input = [
        { name: "Size", option: "XL" },
        { name: "Color", option: "Navy" },
      ];
      expect(parseVariationAttributes(input)).toEqual([
        { name: "Size", option: "XL" },
        { name: "Color", option: "Navy" },
      ]);
    });

    it("parses key/value array-of-objects (AddOrderDialog/POS legacy format)", () => {
      const input = [
        { key: "Size", value: "M" },
        { key: "Fabric", value: "Linen" },
      ];
      expect(parseVariationAttributes(input)).toEqual([
        { name: "Size", option: "M" },
        { name: "Fabric", option: "Linen" },
      ]);
    });

    it("parses single-key object arrays (MeasurementSlipPrint / Woo format)", () => {
      const input = [{ Size: "38" }, { Fit: "Regular" }];
      expect(parseVariationAttributes(input)).toEqual([
        { name: "Size", option: "38" },
        { name: "Fit", option: "Regular" },
      ]);
    });

    it("handles null, string, and malformed inputs gracefully", () => {
      expect(parseVariationAttributes(null)).toEqual([]);
      expect(parseVariationAttributes(undefined)).toEqual([]);
      expect(parseVariationAttributes("Size: XL")).toEqual([]);
      expect(parseVariationAttributes(123)).toEqual([]);
      expect(parseVariationAttributes([null, undefined, 42, {}])).toEqual([]);
    });

    it("formats labels correctly", () => {
      const attrs = [
        { name: "Size", option: "L" },
        { name: "Color", option: "Black" },
      ];
      expect(formatVariationLabel(attrs)).toBe("Size: L · Color: Black");
      expect(joinVariationOptions(attrs)).toBe("L / Black");
    });
  });

  describe("Cart item merging by (product_id, variation_id)", () => {
    function simulateAddToCart(existing: CartItem[], item: CartItem): CartItem[] {
      const current = [...existing];
      const idx = current.findIndex(
        (i) => i.product_id === item.product_id && i.variation_id === item.variation_id
      );
      if (idx >= 0) {
        current[idx] = { ...current[idx], quantity: current[idx].quantity + item.quantity };
      } else {
        current.push(item);
      }
      return current;
    }

    it("merges quantities when product_id and variation_id match", () => {
      const item1: CartItem = {
        product_id: "prod-1",
        variation_id: "var-1",
        variation_label: "Size: M",
        name: "Linen Shirt",
        price: 1500,
        quantity: 1,
      };
      const item2: CartItem = {
        product_id: "prod-1",
        variation_id: "var-1",
        variation_label: "Size: M",
        name: "Linen Shirt",
        price: 1500,
        quantity: 2,
      };

      const result = simulateAddToCart([item1], item2);
      expect(result.length).toBe(1);
      expect(result[0].quantity).toBe(3);
    });

    it("keeps distinct line items when same product has different variations", () => {
      const itemM: CartItem = {
        product_id: "prod-1",
        variation_id: "var-m",
        variation_label: "Size: M",
        name: "Linen Shirt",
        price: 1500,
        quantity: 1,
      };
      const itemL: CartItem = {
        product_id: "prod-1",
        variation_id: "var-l",
        variation_label: "Size: L",
        name: "Linen Shirt",
        price: 1500,
        quantity: 1,
      };

      const result = simulateAddToCart([itemM], itemL);
      expect(result.length).toBe(2);
      expect(result[0].variation_id).toBe("var-m");
      expect(result[1].variation_id).toBe("var-l");
    });

    it("keeps non-variation item separate from variation item of same product", () => {
      const itemNoVar: CartItem = {
        product_id: "prod-1",
        name: "Linen Shirt",
        price: 1500,
        quantity: 1,
      };
      const itemWithVar: CartItem = {
        product_id: "prod-1",
        variation_id: "var-s",
        variation_label: "Size: S",
        name: "Linen Shirt",
        price: 1500,
        quantity: 1,
      };

      const result = simulateAddToCart([itemNoVar], itemWithVar);
      expect(result.length).toBe(2);
      expect(result[0].variation_id).toBeUndefined();
      expect(result[1].variation_id).toBe("var-s");
    });
  });

  describe("getProductVariations (Add Order link resolution)", () => {
    // Shape mirrors the `VariationRow` fetched by AddOrderDialog:
    // { id, product_id, name, sku, price, stock_quantity, attributes }
    interface VarLike { id: string; product_id: string; name: string; }

    const variations: VarLike[] = [
      { id: "v1", product_id: "be6adf6e-1234-4e9a-9c88-000000000001", name: "Size: M" },
      { id: "v2", product_id: "be6adf6e-1234-4e9a-9c88-000000000001", name: "Size: L" },
      // Belongs to a *different* product — must never be returned.
      { id: "v3", product_id: "be6adf6e-9999-4e9a-9c88-000000000099", name: "Size: XL" },
    ];

    it("returns all matching variations for a product with an identical case product_id", () => {
      const matched = getProductVariations(
        "be6adf6e-1234-4e9a-9c88-000000000001",
        variations,
      );
      expect(matched.map((v) => v.id)).toEqual(["v1", "v2"]);
    });

    // Regression: Bug 1 + Bug 2. PostgreSQL compares UUIDs case-insensitively,
    // so a variation whose product_id differs only in case links to the product
    // in SQL (the POS screen, which filters server-side, shows it). The Add
    // Order screen compares client-side with strict '===', which FAILS on the
    // casing drift and (a) skips the variation modal, adding the product with
    // no size, and (b) hides the in-stock variation as unselectable.
    it("links variations whose product_id differs only in case (Bug 1 + Bug 2)", () => {
      const matched = getProductVariations(
        "BE6ADF6E-1234-4E9A-9C88-000000000001",
        variations,
      );
      expect(matched.map((v) => v.id)).toEqual(["v1", "v2"]);
    });

    it("never leaks a different product's variations into the modal list", () => {
      const matched = getProductVariations(
        "be6adf6e-1234-4e9a-9c88-000000000001",
        variations,
      );
      expect(matched.map((v) => v.id)).not.toContain("v3");
    });

    it("returns an empty array when the product has no variations", () => {
      expect(
        getProductVariations("be6adf6e-aaaa-4e9a-9c88-000000000099", variations),
      ).toEqual([]);
    });

    it("returns an empty array for a null/undefined product id without throwing", () => {
      expect(getProductVariations(null, variations)).toEqual([]);
      expect(getProductVariations(undefined, variations)).toEqual([]);
    });

    it("handles a product_id of a different type without throwing", () => {
      expect(getProductVariations("BE6ADF6E-1234-4E9A-9C88-000000000001", []))
        .toEqual([]);
      // A numeric-id shaped variation must not crash the comparison.
      const weird = [{ id: "v9", product_id: 123 as unknown as string, name: "X" }];
      expect(getProductVariations("123", weird)).toEqual([]);
    });
  });
});
