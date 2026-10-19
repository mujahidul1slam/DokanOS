import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { decideRoute } from "./guards";

/**
 * Route guard wrapping DashboardLayout (plan 01-04/01-05, D-17).
 * Reads the extended business-context fields and delegates all branching
 * to the pure decideRoute predicate — no logic lives here.
 *
 * Decisions:
 *   wait             → render nothing (Pitfall 5: guards tolerate loading)
 *   create-business  → redirect to /accounts (valid no-membership state;
 *                      business creation is an explicit choice)
 *   app              → {children}
 *
 * Onboarding is opt-in. Empty accounts and brands without stores stay usable.
 */
export function BusinessGuards({ children }: { children: ReactNode }) {
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
    // A brand is not a store: only a brand linked to a legacy store row counts.
    hasStore: brands.some((brand) => brand.woo_store_id !== null),
    hasSellingPoints: (sellingPointsCount ?? 0) > 0,
    onboardingCompletedAt: onboardingCompletedAt ?? null,
  });

  switch (decision) {
    case "wait":
      return null;
    case "create-business":
      return <Navigate to="/accounts" replace />;
    case "app":
      return <>{children}</>;
  }
}
