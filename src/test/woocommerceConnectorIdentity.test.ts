import { describe, expect, it } from "vitest";
import {
  connectorActionAllowed,
  connectorBindingError,
  fingerprintManagedSecret,
  normalizeExternalStoreIdentity,
  secretReferenceError,
  transitionConnectorLifecycle,
} from "@/lib/woocommerceConnectorIdentity";

describe("WooCommerce connector external identity", () => {
  it("canonicalizes equivalent HTTPS store URLs", () => {
    expect(normalizeExternalStoreIdentity(" HTTPS://Shop.Example.test/ ")).toEqual({
      url: "https://shop.example.test",
      key: "https://shop.example.test",
    });
    expect(normalizeExternalStoreIdentity("https://shop.example.test/store/")).toEqual({
      url: "https://shop.example.test/store",
      key: "https://shop.example.test/store",
    });
  });

  it.each([
    "http://shop.example.test",
    "https://shop.example.test/?consumer_key=secret",
    "https://shop.example.test/#fragment",
    "https://user:pass@shop.example.test",
    "not a url",
  ])("rejects unsafe external identity %s", (value) => {
    expect(() => normalizeExternalStoreIdentity(value)).toThrow();
  });

  it("accepts local HTTP only for local development", () => {
    expect(normalizeExternalStoreIdentity("http://localhost:8080/").key).toBe("http://localhost:8080");
  });

  it("validates managed secret references without accepting secret values", () => {
    expect(secretReferenceError("WOO_SHOP_1")).toBeNull();
    expect(secretReferenceError("woo-shop-1")).toBe("invalid_secret_reference");
    expect(secretReferenceError("super-secret-value")).toBe("invalid_secret_reference");
    expect(secretReferenceError("" )).toBe("invalid_secret_reference");
    expect(secretReferenceError("1ABC")).toBe("invalid_secret_reference");
    expect(secretReferenceError("AB")).toBe("invalid_secret_reference");
    expect(secretReferenceError(`A${"_".repeat(128)}`)).toBe("invalid_secret_reference");
    expect(secretReferenceError("ABCD")).toBeNull();
    expect(secretReferenceError(`A${"_".repeat(127)}`)).toBeNull();
    expect(secretReferenceError("_FOO")).toBe("invalid_secret_reference");
  });

  it("fingerprints secrets without returning the secret", async () => {
    const fingerprint = await fingerprintManagedSecret("webhook-secret");
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("webhook-secret");
    expect(await fingerprintManagedSecret("webhook-secret")).toBe(fingerprint);
    expect(await fingerprintManagedSecret("other-secret")).not.toBe(fingerprint);
  });
});

describe("WooCommerce connector authorization and lifecycle", () => {
  it.each(["owner", "admin"] as const)("allows %s all connector operations", (role) => {
    for (const action of ["create", "view", "update", "disable", "pause", "quarantine", "rollback", "rotate_secret"] as const) {
      expect(connectorActionAllowed(role, action)).toBe(true);
    }
  });

  it.each(["manager", "staff", null] as const)("denies %s connector mutation", (role) => {
    expect(connectorActionAllowed(role, "create")).toBe(false);
    expect(connectorActionAllowed(role, "update")).toBe(false);
    expect(connectorActionAllowed(role, "disable")).toBe(false);
    expect(connectorActionAllowed(role, "rollback")).toBe(false);
  });

  it.each([
    ["disabled", "create", "healthy"],
    ["healthy", "disable", "disabled"],
    ["healthy", "pause", "paused"],
    ["healthy", "quarantine", "quarantined"],
    ["quarantined", "rollback", "rolled_back"],
    ["paused", "resume", "healthy"],
  ] as const)("transitions %s via %s to %s", (current, action, status) => {
    expect(transitionConnectorLifecycle(current, action)).toBe(status);
  });

  it("rejects unsafe lifecycle transitions", () => {
    expect(() => transitionConnectorLifecycle("healthy", "create")).toThrow();
    expect(() => transitionConnectorLifecycle("rolled_back", "resume")).toThrow();
  });

  it("requires one brand, business, brand-bound store, and canonical order source", () => {
    expect(connectorBindingError({
      businessId: "biz-1",
      brandBusinessId: "biz-1",
      brandId: "brand-1",
      storeId: "store-1",
      brandBoundStoreId: "store-1",
      orderSourceBrandId: "brand-1",
      orderSourceType: "woocommerce",
    })).toBeNull();
    expect(connectorBindingError({
      businessId: "biz-2",
      brandBusinessId: "biz-1",
      brandId: "brand-1",
      storeId: "store-1",
      brandBoundStoreId: "store-1",
      orderSourceBrandId: "brand-1",
      orderSourceType: "woocommerce",
    })).toBe("business_brand_mismatch");
    expect(connectorBindingError({
      businessId: "biz-1",
      brandBusinessId: "biz-1",
      brandId: "brand-1",
      storeId: "store-2",
      brandBoundStoreId: "store-1",
      orderSourceBrandId: "brand-1",
      orderSourceType: "woocommerce",
    })).toBe("store_brand_mismatch");
    expect(connectorBindingError({
      businessId: "biz-1",
      brandBusinessId: "biz-1",
      brandId: "brand-1",
      storeId: "store-1",
      brandBoundStoreId: "store-1",
      orderSourceBrandId: "brand-2",
      orderSourceType: "woocommerce",
    })).toBe("order_source_brand_mismatch");
    expect(connectorBindingError({
      businessId: "biz-1",
      brandBusinessId: "biz-1",
      brandId: "brand-1",
      storeId: "store-1",
      brandBoundStoreId: "store-1",
      orderSourceBrandId: "brand-1",
      orderSourceType: "manual",
    })).toBe("order_source_not_woocommerce");
  });
});
