import { describe, expect, it } from "vitest";
import {
  buildReconciliationWindow,
  classifyReconciliationFailure,
  nextWooPageUrl,
  reconciliationRequestUrl,
  retryDelayMs,
} from "@/lib/woocommerceReconciliation";

describe("WooCommerce reconciliation windows", () => {
  it("overlaps the prior watermark and does not move the watermark before success", () => {
    const window = buildReconciliationWindow(
      "2026-11-10T00:00:00.000Z",
      "2026-11-10T01:00:00.000Z",
      10,
    );
    expect(window).toEqual({
      start: "2026-11-09T23:50:00.000Z",
      end: "2026-11-10T01:00:00.000Z",
      watermarkBefore: "2026-11-10T00:00:00.000Z",
    });
    expect(window.end).toBe("2026-11-10T01:00:00.000Z");
  });

  it("uses stable modified ordering and deterministic boundary parameters", () => {
    expect(reconciliationRequestUrl("https://shop.test", {
      start: "2026-11-09T23:50:00.000Z",
      end: "2026-11-10T01:00:00.000Z",
      watermarkBefore: "2026-11-10T00:00:00.000Z",
    })).toBe(
      "https://shop.test/wp-json/wc/v3/orders?after=2026-11-09T23%3A50%3A00.000Z&before=2026-11-10T01%3A00%3A00.000Z&orderby=modified&order=asc&per_page=100&page=1",
    );
  });

  it("does not mistake a changing page's duplicate order for new work", () => {
    const seen = new Set<number>();
    const first = [1, 2, 2].filter((id) => !seen.has(id) && (seen.add(id), true));
    const second = [2, 3].filter((id) => !seen.has(id) && (seen.add(id), true));
    expect(first).toEqual([1, 2]);
    expect(second).toEqual([3]);
  });

  it("uses a stable unknown identity for orders without timestamps", () => {
    const windowEnd = "2026-11-10T01:00:00.000Z";
    const order: Record<string, unknown> = { id: 42 };
    const modified = order.date_modified_gmt ?? order.date_modified ?? "unknown";

    expect(modified).not.toBe(windowEnd);
    expect({ identityKey: `reconcile:${order.id}:${modified}`, modifiedAt: null }).toEqual({
      identityKey: "reconcile:42:unknown",
      modifiedAt: null,
    });
    expect(`reconcile:${order.id}:${modified}`).toBe(`reconcile:${order.id}:${modified}`);
  });
});

describe("WooCommerce RFC Link pagination", () => {
  it("parses rel=next with parameters and quoted multi-rel values", () => {
    const response = "https://shop.test/wp-json/wc/v3/orders?page=1";
    expect(nextWooPageUrl(response, '<orders?page=2>; type="application/json"; rel="prev next"; title="page, two", <orders?page=9>; rel="last"')).toBe(
      "https://shop.test/wp-json/wc/v3/orders?page=2",
    );
  });

  it("returns null when only last or unrelated links exist", () => {
    expect(nextWooPageUrl("https://shop.test/orders", '<orders?page=9>; rel="last", <orders?page=1>; rel="canonical"')).toBeNull();
  });

  it.each([
    ["https://other.test/orders?page=2", "woocommerce_pagination_origin_invalid"],
    ["http://shop.test/orders?page=2", "woocommerce_pagination_https_required"],
    ["https://shop.test:443/orders?page=2", null],
  ] as const)("validates next URL %s", (next, expected) => {
    const result = () => nextWooPageUrl("https://shop.test/orders", `<${next}>; rel="next"`, "https://shop.test/");
    if (expected) expect(result).toThrow(expected);
    else expect(result()).toBe("https://shop.test/orders?page=2");
  });

  it("preserves relative same-origin pagination", () => {
    expect(nextWooPageUrl("https://shop.test/wp-json/wc/v3/orders?page=1", '<orders?page=2>; rel="next"', "https://shop.test/"))
      .toBe("https://shop.test/wp-json/wc/v3/orders?page=2");
  });
});

describe("WooCommerce reconciliation failure handling", () => {
  it.each([
    [401, "auth"], [403, "auth"], [429, "rate_limit"], [500, "server"], [503, "server"], [null, "transport"],
  ] as const)("classifies %s as %s and keeps the prior watermark", (status, kind) => {
    expect(classifyReconciliationFailure(status)).toBe(kind);
  });

  it("uses bounded jittered exponential retry delay", () => {
    expect(retryDelayMs(1, 0)).toBe(750);
    expect(retryDelayMs(2, 1)).toBe(2500);
    expect(retryDelayMs(99, 0.5)).toBeLessThanOrEqual(900000);
  });
});
