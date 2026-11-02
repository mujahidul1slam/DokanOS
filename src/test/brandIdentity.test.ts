import { describe, expect, it } from "vitest";
import {
  brandAccent,
  brandMonogram,
  deriveBrandForProduct,
  deriveBrandForStore,
} from "@/lib/brandIdentity";

const brands = [
  { id: "brand-a", name: "Acme Fashion", woo_store_id: "store-a" },
  { id: "brand-b", name: "Bluebird", woo_store_id: "store-b" },
];

describe("brand identity helpers", () => {
  describe("store and product resolution", () => {
    it("resolves a brand only for a unique store binding", () => {
      expect(deriveBrandForStore(brands, "store-a")).toEqual(brands[0]);
      expect(deriveBrandForStore(brands, "missing")).toBeUndefined();
      expect(deriveBrandForStore(brands, null)).toBeUndefined();
    });

    it("rejects an ambiguous store binding instead of guessing", () => {
      const ambiguous = [
        ...brands,
        { id: "brand-c", name: "Another Acme", woo_store_id: "store-a" },
      ];
      expect(deriveBrandForStore(ambiguous, "store-a")).toBeUndefined();
    });

    it("derives a product brand from product.store_id", () => {
      expect(deriveBrandForProduct(brands, { store_id: "store-b" })).toEqual(brands[1]);
      expect(deriveBrandForProduct(brands, { store_id: null })).toBeUndefined();
      expect(deriveBrandForProduct(brands, undefined)).toBeUndefined();
    });
  });

  describe("presentation helpers", () => {
    it("creates readable monograms with an empty fallback", () => {
      expect(brandMonogram("Acme Fashion")).toBe("AF");
      expect(brandMonogram("Bluebird")).toBe("BL");
      expect(brandMonogram({ name: "Dokan OS" })).toBe("DO");
      expect(brandMonogram("  ")).toBe("?");
    });

    it("returns a deterministic accent keyed by brand id", () => {
      expect(brandAccent("brand-a")).toBe(brandAccent("brand-a"));
      expect(brandAccent("brand-a")).not.toBe(brandAccent("brand-b"));
      expect(brandAccent("brand-a")).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});
