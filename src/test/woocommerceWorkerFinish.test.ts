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

  it("bounds and sanitizes finish RPC errors", () => {
    expect(() => validateFinishResult({ data: null, error: { message: "Authorization: Bearer secret" } })).toThrow("[redacted]");
    expect(() => validateFinishResult({ data: null, error: { message: "x".repeat(2000) } })).toThrow(/woocommerce_finish_failed/);
  });
});
