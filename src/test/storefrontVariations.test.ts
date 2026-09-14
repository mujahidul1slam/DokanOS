import { describe, it, expect } from "vitest";
import {
  parseVariationAttributes,
  formatVariationLabel,
  joinVariationOptions,
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
});
