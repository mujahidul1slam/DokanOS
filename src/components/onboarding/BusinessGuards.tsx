import { Navigate, Outlet } from "react-router-dom";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { decideRoute } from "./guards";

/**
 * Route guard wrapping DashboardLayout (plan 01-04, D-17).
 * Reads the extended business-context fields and delegates all branching
 * to the pure decideRoute predicate — no logic lives here.
 *
 * Decisions:
 *   wait             → render nothing (Pitfall 5: guards tolerate loading)
 *   create-business  → redirect to /onboarding?error=no-business
 *                      (the onboarding shell's !active panel handles it)
 *   wizard           → redirect to /onboarding
 *   app              → <Outlet />
 */
export function BusinessGuards() {
  const {
    loading,
    businesses,
    brands,
    sellingPointsCount,
    onboardingCompletedAt,
  } = useBusinessContext();

  const decision = decideRoute({
    loading,
    memberships: businesses.length,
    hasStore: brands.length > 0,
    hasSellingPoints: (sellingPointsCount ?? 0) > 0,
    onboardingCompletedAt: onboardingCompletedAt ?? null,
  });

  switch (decision) {
    case "wait":
      return null;
    case "create-business":
      return <Navigate to="/onboarding?error=no-business" replace />;
    case "wizard":
      return <Navigate to="/onboarding" replace />;
    case "app":
      return <Outlet />;
  }
}