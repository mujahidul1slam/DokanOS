import { describe, expect, it } from "vitest";
import { mergeSettings } from "@/storefront/lib/settings";
import {
  DEFAULT_STOREFRONT_SETUP,
  buildStorefrontSettings,
  slugifyStorefrontName,
  validateStorefrontSetup,
  type StorefrontSetupValues,
} from "./storefrontSetup";

// Task 14 (spec §6a step 6): the shared storefront sub-onboarding's decisions —
// the same flow runs from onboarding and from "create storefront", so its
// rules live here once.

const values = (over: Partial<StorefrontSetupValues> = {}): StorefrontSetupValues => ({
  ...DEFAULT_STOREFRONT_SETUP,
  name: "My Brand",
  slug: "my-brand",
  ...over,
});

describe("slugifyStorefrontName", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyStorefrontName("My Brand Shop")).toBe("my-brand-shop");
    expect(slugifyStorefrontName("  Enveil   Vincent  ")).toBe("enveil-vincent");
  });

  it("strips unsafe characters and trims hyphens", () => {
    expect(slugifyStorefrontName("Fancy — Shoes!!")).toBe("fancy-shoes");
    expect(slugifyStorefrontName("--x--")).toBe("x");
    expect(slugifyStorefrontName("!!!")).toBe("");
  });
});

describe("validateStorefrontSetup", () => {
  it("accepts a complete setup", () => {
    expect(validateStorefrontSetup(values())).toBeNull();
  });

  it("requires a name and a slug", () => {
    expect(validateStorefrontSetup(values({ name: "  " }))).toBe("Give the storefront a name.");
    expect(validateStorefrontSetup(values({ slug: "" }))).toBe("Give the storefront a URL slug.");
  });

  it("keeps slugs URL-safe", () => {
    expect(validateStorefrontSetup(values({ slug: "My Slug" }))).toBe(
      "The URL slug may only contain lowercase letters, numbers and hyphens.",
    );
  });

  it("demands at least one payment method (checkout with none cannot take orders)", () => {
    expect(
      validateStorefrontSetup(values({ methods: { cod: false, bkash: false, nagad: false } })),
    ).toBe("Enable at least one payment method (Cash on delivery counts).");
  });
});

describe("buildStorefrontSettings (creation-time essentials over the merged defaults)", () => {
  it("enables exactly the chosen methods", () => {
    const settings = buildStorefrontSettings(
      values({ methods: { cod: true, bkash: false, nagad: true } }),
    );
    expect(settings.checkout.methods).toEqual({
      cod: true,
      bkash: false,
      nagad: true,
      rocket: false,
      upay: false,
      mcash: false,
    });
  });

  it("wires the entered wallet details and keeps unconfigured wallets at defaults", () => {
    const settings = buildStorefrontSettings(
      values({
        codInstructions: "Pay the delivery man",
        bkashNumber: "01711111111",
        bkashInstructions: "Send Money please",
        nagadNumber: "",
        nagadInstructions: "",
      }),
    );
    expect(settings.payments.cod).toEqual({ instructions: "Pay the delivery man" });
    expect(settings.payments.bkash).toMatchObject({
      account_number: "01711111111",
      instructions: "Send Money please",
    });
    expect(settings.payments.nagad.account_number).toBe("");
    expect(settings.payments.rocket).toMatchObject({ account_number: "" });
  });

  it("produces a settings object the runtime merge accepts unchanged", () => {
    const settings = buildStorefrontSettings(values());
    expect(mergeSettings(settings)).toEqual(settings);
  });
});
