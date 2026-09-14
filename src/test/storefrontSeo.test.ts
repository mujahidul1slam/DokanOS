import { describe, it, expect } from "vitest";
import { productUrl, collectionUrl, pageUrl } from "@/storefront/lib/routes";

function sqlSlugFormula(name: string | null | undefined, id: string): string {
  let base = (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length > 60) {
    base = base.slice(0, 60).replace(/-+$/g, "");
  }
  if (base.length > 0) {
    return `${base}-${id.slice(0, 6)}`;
  }
  return id.slice(0, 8);
}

function tsSlugify(s: string, id: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return base ? `${base}-${id.slice(0, 6)}` : id.slice(0, 8);
}

describe("Phase 4: Storefront SEO Foundation (§7 / §7.5)", () => {
  describe("Slug formula parity (SQL vs TypeScript)", () => {
    it("produces identical slugs for standard product names", () => {
      const id = "e3b0c442-98fc-1c14-9afbf4c8996fb924";
      const name = "Linen Summer Shirt";
      expect(tsSlugify(name, id)).toBe(sqlSlugFormula(name, id));
      expect(tsSlugify(name, id)).toBe("linen-summer-shirt-e3b0c4");
    });

    it("handles punctuation, spaces, and special characters", () => {
      const id = "12345678-abcd-ef01-2345-6789abcdef01";
      const name = "  Classic & Modern T-Shirt (100% Cotton!)  ";
      expect(tsSlugify(name, id)).toBe(sqlSlugFormula(name, id));
    });

    it("handles long names exceeding 60 chars with trailing hyphen trimming", () => {
      const id = "abcdef01-2345-6789-abcd-ef0123456789";
      const name = "A very long product name that should definitely exceed the sixty character limit for testing truncation";
      const tsResult = tsSlugify(name, id);
      const sqlResult = sqlSlugFormula(name, id);
      expect(tsResult).toBe(sqlResult);
      expect(tsResult.endsWith(`-${id.slice(0, 6)}`)).toBe(true);
    });

    it("falls back to id slice when name is empty or pure punctuation", () => {
      const id = "98765432-10fe-dcba-9876-543210fedcba";
      expect(tsSlugify("", id)).toBe(id.slice(0, 8));
      expect(tsSlugify("!@#$%^&*()", id)).toBe(id.slice(0, 8));
      expect(sqlSlugFormula("", id)).toBe(id.slice(0, 8));
      expect(sqlSlugFormula("!@#$%^&*()", id)).toBe(id.slice(0, 8));
    });
  });

  describe("Route URL contracts (§7.1 / L2)", () => {
    it("generates singular /product/:slug path", () => {
      expect(productUrl("silk-panjabi-a1b2c3")).toBe("/product/silk-panjabi-a1b2c3");
    });

    it("generates /collections/:slug path", () => {
      expect(collectionUrl("summer-collection")).toBe("/collections/summer-collection");
    });

    it("generates /pages/:slug path", () => {
      expect(pageUrl("our-story")).toBe("/pages/our-story");
    });
  });

  describe("Availability gating for JSON-LD (§7.3 / M2)", () => {
    function getAvailability(manage_stock: boolean, stock_quantity: number): string {
      // Deliberately ignores stock_status per Fact 13 / M2
      const isOutOfStock = manage_stock && stock_quantity <= 0;
      return isOutOfStock
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock";
    }

    it("returns InStock when manage_stock is false regardless of stock_quantity", () => {
      expect(getAvailability(false, 0)).toBe("https://schema.org/InStock");
      expect(getAvailability(false, -5)).toBe("https://schema.org/InStock");
      expect(getAvailability(false, 10)).toBe("https://schema.org/InStock");
    });

    it("returns OutOfStock only when manage_stock is true and stock_quantity <= 0", () => {
      expect(getAvailability(true, 0)).toBe("https://schema.org/OutOfStock");
      expect(getAvailability(true, -1)).toBe("https://schema.org/OutOfStock");
      expect(getAvailability(true, 5)).toBe("https://schema.org/InStock");
    });
  });
});
