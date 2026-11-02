import { describe, it, expect } from "vitest";
import { decideRoute } from "@/components/onboarding/guards";

/**
 * D-17 route-guard seam tests (plan 01-04, R4-d2/R4-d3).
 * Pure-function tests on the extracted predicate — no React rendering.
 * The legacy step-gated resume derivation (deriveStartStep) was removed with
 * the legacy contract tables (Task 16); the onboarding wizard owns its own
 * resume logic in src/features/onboarding/progress.ts.
 */
describe("decideRoute", () => {
  it("Test 1 (R4-d3 loading): returns 'wait' while loading regardless of memberships", () => {
    expect(decideRoute({ loading: true, memberships: 0 })).toBe("wait");
    expect(decideRoute({ loading: true, memberships: 1 })).toBe("wait");
  });

  it("Test 2 (R4-d3 zero-membership): post-load with 0 memberships returns 'create-business'", () => {
    expect(decideRoute({ loading: false, memberships: 0 })).toBe("create-business");
  });

  it("keeps an empty business account navigable without mandatory onboarding", () => {
    expect(decideRoute({ loading: false, memberships: 1 })).toBe("app");
  });
});
