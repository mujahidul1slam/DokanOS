import { describe, it, expect } from "vitest";
import { productUrl, collectionUrl, pageUrl, shopUrl, homeUrl, brandBase } from "@/storefront/lib/routes";

describe("Phase 2: Route Helpers & Fixtures (§5.1 / §5.5)", () => {
  const brand = "minimal-studio";

  it("builds consistent brand base path", () => {
    expect(brandBase(brand)).toBe("/storefront/minimal-studio");
  });

  it("builds product URL with singular /product/:slug (StorefrontApp route match)", () => {
    expect(productUrl(brand, "linen-shirt-abc123")).toBe("/storefront/minimal-studio/product/linen-shirt-abc123");
    expect(productUrl(brand, "silk-dress")).not.toContain("/products/");
  });

  it("builds collection URL with /collections/:slug", () => {
    expect(collectionUrl(brand, "summer-capsule")).toBe("/storefront/minimal-studio/collections/summer-capsule");
  });

  it("builds custom page URL with /pages/:slug", () => {
    expect(pageUrl(brand, "our-story")).toBe("/storefront/minimal-studio/pages/our-story");
  });

  it("builds shop URL with /shop", () => {
    expect(shopUrl(brand)).toBe("/storefront/minimal-studio/shop");
  });

  it("builds home URL", () => {
    expect(homeUrl(brand)).toBe("/storefront/minimal-studio");
  });

  it("handles slug URI encoding safely", () => {
    expect(productUrl(brand, "t-shirt & jeans")).toBe("/storefront/minimal-studio/product/t-shirt%20%26%20jeans");
    expect(collectionUrl(brand, "men's wear")).toBe("/storefront/minimal-studio/collections/men's%20wear");
  });
});
