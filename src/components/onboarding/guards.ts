/**
 * Pure wizard-guard predicates for /onboarding (plan 01-04, R4-d2/R4-d3/D-09).
 * No React imports — all branching lives here; components only translate to Navigate.
 */

export type RouteDecision = "wait" | "create-business" | "app";

export interface GuardContext {
  loading: boolean;
  memberships: number;
  /**
   * Retained so the wizard's resume derivation shares one context shape.
   * Routing deliberately does not gate on brand/store/selling-point state:
   * an account with memberships is usable while empty, and a brand is not
   * proof that a store exists.
   */
  hasStore: boolean;
  hasSellingPoints: boolean;
  onboardingCompletedAt: string | null;
}

/**
 * Evaluate in exactly this order:
 * 1. loading → "wait"              (never redirect mid-load — Pitfall 5)
 * 2. memberships === 0 → "create-business"  (D-04/D-12)
 * 3. otherwise → "app"            (onboarding is explicit, never mandatory)
 *
 * Empty business accounts and brands without stores are valid destinations.
 * Operators open /onboarding explicitly when they want the guided setup.
 */
export function decideRoute(ctx: GuardContext): RouteDecision {
  if (ctx.loading) return "wait";
  if (ctx.memberships === 0) return "create-business";
  return "app";
}

/**
 * Resume-step derivation. Locations are NOT a resume trigger (audit R4);
 * only store and selling-point states gate the step.
 * - marker null + no store → 1
 * - marker null + store + no selling points → 3 (abandonment)
 * - otherwise → 4
 */
export function deriveStartStep(
  ctx: Pick<GuardContext, "hasStore" | "hasSellingPoints" | "onboardingCompletedAt">
): 1 | 2 | 3 | 4 {
  if (ctx.onboardingCompletedAt !== null) return 4;
  if (!ctx.hasStore) return 1;
  if (!ctx.hasSellingPoints) return 3;
  return 4;
}