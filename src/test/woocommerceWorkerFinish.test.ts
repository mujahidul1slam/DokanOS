import { describe, expect, it } from "vitest";
import { serializeWorkerFailure, validateFinishResult } from "../lib/woocommerceWorkerValidation";

describe("WooCommerce worker finish RPC", () => {
  it("rejects RPC errors and malformed success results", () => {
    expect(() => validateFinishResult({ data: true, error: { message: "lease lost" } })).toThrow("woocommerce_finish_failed: lease lost");
    expect(() => validateFinishResult({ data: false, error: null })).toThrow("woocommerce_finish_failed");
    expect(() => validateFinishResult({ data: null, error: null })).toThrow("woocommerce_finish_failed");
  });

  it("accepts only the SQL function's true completion result", () => {
    expect(() => validateFinishResult({ data: true, error: null })).not.toThrow();
  });

  it("serializes and redacts structured failures", () => {
    expect(serializeWorkerFailure({ code: "duplicate_lease", url: "https://woo.test/?consumer_secret=hide", nested: "Authorization: Bearer abc" })).not.toContain("hide");
    expect(serializeWorkerFailure(new Error("transport_failed"))).toContain("transport_failed");
    expect(serializeWorkerFailure("https://woo.test/?token=secret" )).not.toContain("secret");
    expect(serializeWorkerFailure("x".repeat(2000))).toHaveLength(1000);
  });

  it("redacts the credential, not just the scheme in front of it", () => {
    // Regression: the scheme was optional in the header alternation, so a Basic
    // credential survived as "[redacted] dXNlcjpwYXNzd29yZA==".
    expect(serializeWorkerFailure("Authorization: Basic dXNlcjpwYXNzd29yZA==")).not.toContain("dXNlcjpwYXNzd29yZA==");
    expect(serializeWorkerFailure("Proxy-Authorization: Basic Zm9vOmJhcg==")).not.toContain("Zm9vOmJhcg==");
    expect(serializeWorkerFailure("x-api-key: sk_live_zzz")).not.toContain("sk_live_zzz");
    // This is the header the worker actually sends.
    expect(serializeWorkerFailure({ nested: "Authorization: Basic dXNlcjpwYXNzd29yZA==" })).not.toContain("dXNlcjpwYXNzd29yZA==");
  });

  it("redacts every credential query parameter, not only the first", () => {
    // Regression: the query group had no repetition, so consumer_secret leaked
    // whenever consumer_key came first on the URL.
    const serialized = serializeWorkerFailure(
      "https://shop.test/wp-json/wc/v3/orders/1?consumer_key=ck_live_abc&consumer_secret=cs_live_xyz",
    );
    expect(serialized).not.toContain("ck_live_abc");
    expect(serialized).not.toContain("cs_live_xyz");
  });

  it("leaves credential-free text readable", () => {
    expect(serializeWorkerFailure("https://shop.test/wp-json/wc/v3/orders/1")).toContain("https://shop.test");
    expect(serializeWorkerFailure("no secrets here at all")).toBe("no secrets here at all");
  });

  it("bounds and sanitizes finish RPC errors", () => {
    expect(() => validateFinishResult({ data: null, error: { message: "Authorization: Bearer secret" } })).toThrow("[redacted]");
    expect(() => validateFinishResult({ data: null, error: { message: "x".repeat(2000) } })).toThrow(/woocommerce_finish_failed/);
  });
});
