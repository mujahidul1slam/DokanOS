/**
 * Pure route-guard predicates for the app shell (plan 01-04, R4-d2/R4-d3).
 * No React imports — all branching lives here; components only translate to Navigate.
 */

export type RouteDecision = "wait" | "create-business" | "app";

export interface GuardContext {
  loading: boolean;
  memberships: number;
}

/**
 * Evaluate in exactly this order:
 * 1. loading → "wait"              (never redirect mid-load — Pitfall 5)
 * 2. memberships === 0 → "create-business"  (D-04/D-12)
 * 3. otherwise → "app"            (onboarding is explicit, never mandatory)
 *
 * Empty business accounts are valid destinations. Onboarding is opt-in and
 * lives in the wizard (src/features/onboarding), which owns its own resume
 * derivation — the legacy step-gated guard logic was removed with the
 * legacy contract tables (Task 16).
 */
export function decideRoute(ctx: GuardContext): RouteDecision {
  if (ctx.loading) return "wait";
  if (ctx.memberships === 0) return "create-business";
  return "app";
}
