import { describe, it, expect } from "vitest";
import { decideRoute, deriveStartStep } from "@/components/onboarding/guards";

/**
 * D-17 wizard-guard seam tests (plan 01-04, R4-d2/R4-d3).
 * Pure-function tests on the extracted predicates — no React rendering.
 */
describe("decideRoute", () => {
  it("Test 1 (R4-d3 loading): returns 'wait' while loading regardless of every other field", () => {
    const cases = [
      { loading: true, memberships: 0, hasStore: false, hasSellingPoints: false, onboardingCompletedAt: null },
      { loading: true, memberships: 1, hasStore: false, hasSellingPoints: false, onboardingCompletedAt: null },
      { loading: true, memberships: 1, hasStore: true, hasSellingPoints: false, onboardingCompletedAt: null },
      { loading: true, memberships: 1, hasStore: true, hasSellingPoints: true, onboardingCompletedAt: "2026-10-01T00:00:00Z" },
    ];
    for (const ctx of cases) {
      expect(decideRoute(ctx)).toBe("wait");
    }
  });

  it("Test 2 (R4-d3 zero-membership): post-load with 0 memberships returns 'create-business'", () => {
    expect(
      decideRoute({ loading: false, memberships: 0, hasStore: false, hasSellingPoints: false, onboardingCompletedAt: null })
    ).toBe("create-business");
  });

  it("Test 3 (resume guard): membership, zero brands, marker null returns 'wizard'", () => {
    expect(
      decideRoute({ loading: false, memberships: 1, hasStore: false, hasSellingPoints: false, onboardingCompletedAt: null })
    ).toBe("wizard");
  });

  it("Test 4 (R4-d2 abandonment): store exists, no selling points, marker null returns 'wizard'", () => {
    expect(
      decideRoute({ loading: false, memberships: 1, hasStore: true, hasSellingPoints: false, onboardingCompletedAt: null })
    ).toBe("wizard");
  });

  it("Test 5 (D-09 never re-trap): marker set returns 'app' whatever the brand/selling-point state", () => {
    const marker = "2026-10-01T00:00:00Z";
    expect(
      decideRoute({ loading: false, memberships: 1, hasStore: false, hasSellingPoints: false, onboardingCompletedAt: marker })
    ).toBe("app");
    expect(
      decideRoute({ loading: false, memberships: 1, hasStore: true, hasSellingPoints: false, onboardingCompletedAt: marker })
    ).toBe("app");
    expect(
      decideRoute({ loading: false, memberships: 1, hasStore: true, hasSellingPoints: true, onboardingCompletedAt: marker })
    ).toBe("app");
  });

  it("store + selling points + marker null (finished steps but no explicit finish) returns 'app'", () => {
    expect(
      decideRoute({ loading: false, memberships: 1, hasStore: true, hasSellingPoints: true, onboardingCompletedAt: null })
    ).toBe("app");
  });
});

describe("deriveStartStep", () => {
  it("marker null + no store → step 1", () => {
    expect(deriveStartStep({ hasStore: false, hasSellingPoints: false, onboardingCompletedAt: null })).toBe(1);
  });

  it("marker null + store + no selling points → step 3 (abandonment resume)", () => {
    expect(deriveStartStep({ hasStore: true, hasSellingPoints: false, onboardingCompletedAt: null })).toBe(3);
  });

  it("otherwise → step 4 (locations are not a resume trigger)", () => {
    expect(deriveStartStep({ hasStore: true, hasSellingPoints: true, onboardingCompletedAt: null })).toBe(4);
    expect(
      deriveStartStep({ hasStore: false, hasSellingPoints: false, onboardingCompletedAt: "2026-10-01T00:00:00Z" })
    ).toBe(4);
  });
});