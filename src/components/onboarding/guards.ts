/**
 * Pure wizard-guard predicates for /onboarding (plan 01-04, R4-d2/R4-d3/D-09).
 * No React imports — all branching lives here; components only translate to Navigate.
 */

export type RouteDecision = "wait" | "create-business" | "wizard" | "app";

export interface GuardContext {
  loading: boolean;
  memberships: number;
  hasStore: boolean;
  hasSellingPoints: boolean;
  onboardingCompletedAt: string | null;
}

/**
 * Evaluate in exactly this order:
 * 1. loading → "wait"              (never redirect mid-load — Pitfall 5)
 * 2. memberships === 0 → "create-business"  (D-04/D-12)
 * 3. marker set → "app"            (D-09 never re-trap)
 * 4. !hasStore → "wizard"          (fresh start or step-1 resume)
 * 5. hasStore + !hasSellingPoints → "wizard"  (R4-d2 abandonment → step 3)
 * 6. otherwise → "app"
 */
export function decideRoute(ctx: GuardContext): RouteDecision {
  if (ctx.loading) return "wait";
  if (ctx.memberships === 0) return "create-business";
  if (ctx.onboardingCompletedAt !== null) return "app";
  if (!ctx.hasStore) return "wizard";
  if (!ctx.hasSellingPoints) return "wizard";
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