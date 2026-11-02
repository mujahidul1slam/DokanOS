import { describe, expect, it } from "vitest";
import {
  PATHAO_ITEM_DESCRIPTION_MAX,
  buildCourierItemDescription,
  formatOrderItemProductName,
  isCourierDescriptionEnabled,
  mergeCourierDescriptionOption,
  parseCourierProductName,
  truncateCourierDescription,
} from "@/lib/courierDescription";

describe("formatOrderItemProductName / parseCourierProductName (order_items convention)", () => {
  it("formats 'Name - variationLabel' when a variation label exists", () => {
    expect(formatOrderItemProductName("Shirt", "XL")).toBe("Shirt - XL");
  });

  it("formats a bare name when there is no variation label", () => {
    expect(formatOrderItemProductName("Shirt")).toBe("Shirt");
    expect(formatOrderItemProductName("Shirt", null)).toBe("Shirt");
    expect(formatOrderItemProductName("Shirt", "   ")).toBe("Shirt");
  });

  it("parses the 'Name - variationLabel' convention back apart", () => {
    expect(parseCourierProductName("Shirt - XL")).toEqual({ name: "Shirt", variationLabel: "XL" });
  });

  it("parses a bare product name as having no variation label", () => {
    expect(parseCourierProductName("Pan")).toEqual({ name: "Pan", variationLabel: null });
  });

  it("round-trips name + variation label through the convention", () => {
    const productName = formatOrderItemProductName("Cotton Shirt", "Red / M");
    expect(parseCourierProductName(productName)).toEqual({
      name: "Cotton Shirt",
      variationLabel: "Red / M",
    });
  });
});

describe("buildCourierItemDescription", () => {
  it("includes product names, quantities and variation/size labels", () => {
    const description = buildCourierItemDescription([
      { product_name: "Shirt - XL", quantity: 2 },
      { product_name: "Pan - 32", quantity: 1 },
    ]);
    expect(description).toBe("2x Shirt (XL), 1x Pan (32)");
  });

  it("includes plain product names without parentheses when there is no label", () => {
    expect(buildCourierItemDescription([{ product_name: "Mug", quantity: 3 }])).toBe("3x Mug");
  });

  it("skips lines without a usable name or quantity", () => {
    expect(
      buildCourierItemDescription([
        { product_name: "  ", quantity: 1 },
        { product_name: "Shirt", quantity: 0 },
        { product_name: "Pan", quantity: -2 },
        { product_name: "Mug - Blue", quantity: 1 },
      ]),
    ).toBe("1x Mug (Blue)");
  });

  it("returns an empty string when no line is usable (caller omits the field)", () => {
    expect(buildCourierItemDescription([])).toBe("");
    expect(buildCourierItemDescription([{ product_name: "", quantity: 1 }])).toBe("");
  });

  it("never exceeds the API limit", () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({
      product_name: `Product Number ${i} - Size ${i}`,
      quantity: i + 1,
    }));
    const description = buildCourierItemDescription(lines);
    expect(description.length).toBeLessThanOrEqual(PATHAO_ITEM_DESCRIPTION_MAX);
    expect(description.endsWith("\u2026")).toBe(true);
  });

  it("passes the API limit through to truncation", () => {
    const description = buildCourierItemDescription(
      [{ product_name: "Shirt - XL", quantity: 1 }],
      5,
    );
    expect(description.length).toBeLessThanOrEqual(5);
  });
});

describe("truncateCourierDescription (safe truncation to the API limit)", () => {
  it("leaves text at or under the limit untouched", () => {
    expect(truncateCourierDescription("abc", 3)).toBe("abc");
    expect(truncateCourierDescription("ab", 3)).toBe("ab");
    expect(truncateCourierDescription("")).toBe("");
  });

  it("truncates over-limit text to at most maxLength, with an ellipsis", () => {
    const out = truncateCourierDescription("a".repeat(50), 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.endsWith("\u2026")).toBe(true);
  });

  it("never splits a surrogate pair at the cut point", () => {
    // 6 leading chars + an emoji (2 UTF-16 code units) at the boundary.
    const text = "abcdef\uD83D\uDE00xyz";
    const out = truncateCourierDescription(text, 8);
    expect(out.length).toBeLessThanOrEqual(8);
    // The lone low surrogate must not survive the cut.
    expect(out.includes("\uDE00")).toBe(false);
  });

  it("drops a trailing partial list separator before the ellipsis", () => {
    const out = truncateCourierDescription("2x Shirt (XL), 3x ", 12);
    expect(out.endsWith(", \u2026")).toBe(false);
    expect(out.endsWith("\u2026")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(12);
  });

  it("drops a dangling unclosed parenthesis before the ellipsis", () => {
    // Cut lands right after "(" — the dangling paren must not survive.
    expect(truncateCourierDescription("2x Shirt (abcdef", 11)).toBe("2x Shirt\u2026");
  });

  it("never exceeds the limit for any input length", () => {
    for (const size of [1, 2, 5, 255, 256, 1000]) {
      const out = truncateCourierDescription("x".repeat(size));
      expect(out.length).toBeLessThanOrEqual(PATHAO_ITEM_DESCRIPTION_MAX);
    }
  });
});

describe("per-account option map (app_settings KV, default OFF)", () => {
  it("treats absent keys as OFF", () => {
    expect(isCourierDescriptionEnabled({}, "int-1:11")).toBe(false);
    expect(isCourierDescriptionEnabled({}, null)).toBe(false);
    expect(isCourierDescriptionEnabled({}, undefined)).toBe(false);
  });

  it("stores only enabled accounts and removes the key on disable", () => {
    const enabled = mergeCourierDescriptionOption({}, "int-1:11", true);
    expect(enabled).toEqual({ "int-1:11": true });
    expect(isCourierDescriptionEnabled(enabled, "int-1:11")).toBe(true);

    const disabled = mergeCourierDescriptionOption(enabled, "int-1:11", false);
    expect(disabled).toEqual({});
    expect(isCourierDescriptionEnabled(disabled, "int-1:11")).toBe(false);
  });

  it("keeps other accounts' flags when merging one account", () => {
    const next = mergeCourierDescriptionOption({ "a:1": true }, "b:2", true);
    expect(next).toEqual({ "a:1": true, "b:2": true });
    const afterDisable = mergeCourierDescriptionOption(next, "a:1", false);
    expect(afterDisable).toEqual({ "b:2": true });
  });
});
