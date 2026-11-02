import { describe, expect, it } from "vitest";
import { shouldOfferBusinessOnboarding } from "./eligibility";

// Task 13 (spec §6a/§6b): the invited-member bypass. Business-creation
// onboarding runs only for the member who created the business; invited
// members (Task 3's personal profile setup covers them) — and anyone whose
// provenance is not explicitly "created" — never see the wizard.

describe("shouldOfferBusinessOnboarding", () => {
  it("offers the wizard to the member who created the business", () => {
    expect(shouldOfferBusinessOnboarding("created")).toBe(true);
  });

  it("never offers it to invited members (spec §6b bypass)", () => {
    expect(shouldOfferBusinessOnboarding("invited")).toBe(false);
  });

  it("never offers it to directly-granted members — joining is not creating", () => {
    expect(shouldOfferBusinessOnboarding("granted")).toBe(false);
  });

  it("fails closed on unknown or missing provenance", () => {
    expect(shouldOfferBusinessOnboarding(null)).toBe(false);
    expect(shouldOfferBusinessOnboarding(undefined)).toBe(false);
    expect(shouldOfferBusinessOnboarding("")).toBe(false);
    expect(shouldOfferBusinessOnboarding("Created")).toBe(false);
    expect(shouldOfferBusinessOnboarding("founder")).toBe(false);
  });
});
