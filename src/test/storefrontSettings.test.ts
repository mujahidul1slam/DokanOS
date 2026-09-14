import { describe, it, expect } from "vitest";
import {
  mergeSettings,
  validateSettings,
  DEFAULT_STOREFRONT_SETTINGS,
} from "@/storefront/lib/settings";

describe("Phase 5: Storefront Settings Object (§8 / §8.5)", () => {
  it("merges empty settings with defaults reproducing today's behavior", () => {
    const merged = mergeSettings({});
    expect(merged.checkout.methods.cod).toBe(true);
    expect(merged.checkout.methods.bkash).toBe(true);
    expect(merged.checkout.methods.nagad).toBe(true);
    expect(merged.checkout.min_order_amount).toBe(0);
    expect(merged.shipping.free_threshold).toBe(0);
    expect(merged.announcement.enabled).toBe(false);
  });

  it("preserves partial settings overrides", () => {
    const input = {
      checkout: {
        methods: { cod: true, bkash: false, nagad: false },
        min_order_amount: 500,
        order_instructions: "Call before delivery",
        terms_checkbox_text: "I agree to the return terms",
      },
      shipping: { free_threshold: 1500 },
      announcement: { enabled: true, text: "Eid Sale 20% Off", href: "/shop" },
    };

    const merged = mergeSettings(input);
    expect(merged.checkout.methods.cod).toBe(true);
    expect(merged.checkout.methods.bkash).toBe(false);
    expect(merged.checkout.methods.nagad).toBe(false);
    expect(merged.checkout.min_order_amount).toBe(500);
    expect(merged.checkout.order_instructions).toBe("Call before delivery");
    expect(merged.checkout.terms_checkbox_text).toBe("I agree to the return terms");
    expect(merged.shipping.free_threshold).toBe(1500);
    expect(merged.announcement.enabled).toBe(true);
    expect(merged.announcement.text).toBe("Eid Sale 20% Off");
    expect(merged.announcement.href).toBe("/shop");
  });

  describe("validateSettings", () => {
    it("approves valid settings", () => {
      const valid = DEFAULT_STOREFRONT_SETTINGS;
      expect(validateSettings(valid)).toEqual([]);
    });

    it("rejects when all payment methods are disabled", () => {
      const invalid = {
        ...DEFAULT_STOREFRONT_SETTINGS,
        checkout: {
          ...DEFAULT_STOREFRONT_SETTINGS.checkout,
          methods: { cod: false, bkash: false, nagad: false },
        },
      };
      expect(validateSettings(invalid)).toContain("At least one payment method must stay enabled");
    });

    it("rejects negative numbers", () => {
      const invalid = {
        ...DEFAULT_STOREFRONT_SETTINGS,
        checkout: {
          ...DEFAULT_STOREFRONT_SETTINGS.checkout,
          min_order_amount: -50,
        },
        shipping: { free_threshold: -100 },
      };
      const errors = validateSettings(invalid);
      expect(errors).toContain("Minimum order amount must be ≥ 0");
      expect(errors).toContain("Free shipping threshold must be ≥ 0");
    });
  });
});
