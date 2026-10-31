import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCEPTED_METHODS,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  normalizeAcceptedMethods,
  paymentAccountState,
  paymentMethodLabel,
  paymentProviderInfo,
  paymentProviderLabel,
  staffPaymentOptions,
  type PaymentAccountRow,
} from "@/lib/paymentAccounts";

const account = (over: Partial<PaymentAccountRow> = {}): PaymentAccountRow => ({
  id: "a1",
  business_id: "b1",
  provider: "bkash",
  name: "Main bKash",
  credentials: {},
  is_active: true,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("payment accounts (spec §4)", () => {
  it("covers the spec's named providers with credential fields", () => {
    expect(PAYMENT_PROVIDERS.map((p) => p.code).sort()).toEqual([
      "bkash",
      "card",
      "nagad",
      "stripe",
    ]);
    for (const provider of PAYMENT_PROVIDERS) {
      expect(provider.fields.length).toBeGreaterThan(0);
    }
    expect(paymentProviderLabel("nagad")).toBe("Nagad");
    expect(paymentProviderLabel("unknown")).toBe("unknown");
    expect(paymentProviderInfo("nope")).toBeUndefined();
  });

  it("derives display state without ever exposing credentials", () => {
    expect(paymentAccountState({ provider: "bkash", credentials: null, is_active: false })).toBe("inactive");
    expect(paymentAccountState({ provider: "bkash", credentials: {}, is_active: true })).toBe("needs_setup");
    expect(
      paymentAccountState({
        provider: "bkash",
        credentials: { app_key: "a", app_secret: "b", username: "u", password: "p" },
        is_active: true,
      }),
    ).toBe("configured");
    expect(
      paymentAccountState({ provider: "stripe", credentials: { publishable_key: "pk", secret_key: "sk" }, is_active: true }),
    ).toBe("configured");
  });
});

describe("accepted payment methods (order_sources)", () => {
  it("keeps known codes in registry order and drops junk", () => {
    expect(normalizeAcceptedMethods(["card", "cod", "bitcoin", 42, null])).toEqual(["cod", "card"]);
    expect(normalizeAcceptedMethods(["bkash", "nagad", "stripe", "card", "cod", "cash"])).toEqual(
      PAYMENT_METHODS.map((m) => m.code),
    );
  });

  it("falls back to the default for non-arrays and empty results", () => {
    expect(normalizeAcceptedMethods("cod")).toEqual([...DEFAULT_ACCEPTED_METHODS]);
    expect(normalizeAcceptedMethods(null)).toEqual([...DEFAULT_ACCEPTED_METHODS]);
    expect(normalizeAcceptedMethods(["bitcoin", 7])).toEqual([...DEFAULT_ACCEPTED_METHODS]);
    expect(DEFAULT_ACCEPTED_METHODS).toEqual(["cod", "cash"]);
  });

  it("always offers cash / manual to staff-entered orders", () => {
    const options = staffPaymentOptions(["cod", "bkash"]);
    expect(options.map((m) => m.code)).toEqual(["cod", "cash", "bkash"]);
    // Even a source that accepts nothing gateway-y still gets cash.
    expect(staffPaymentOptions([]).map((m) => m.code)).toEqual(["cod", "cash"]);
    // Unknown stored junk degrades to default + cash, never to an empty picker.
    expect(staffPaymentOptions("garbage").map((m) => m.code)).toEqual(["cod", "cash"]);
    expect(paymentMethodLabel("bkash")).toBe("bKash");
    expect(paymentMethodLabel("weird")).toBe("weird");
  });
});
