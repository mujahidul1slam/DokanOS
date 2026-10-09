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
 *   create-business  → redirect to /onboarding (the shell's create-business
 *                      mode renders CreateBusinessDialog)
 *   wizard           → redirect to /onboarding
 *   app              → {children}
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
    hasStore: brands.length > 0,
    hasSellingPoints: (sellingPointsCount ?? 0) > 0,
    onboardingCompletedAt: onboardingCompletedAt ?? null,
  });

  switch (decision) {
    case "wait":
      return null;
    case "create-business":
      return <Navigate to="/onboarding" replace />;
    case "wizard":
      return <Navigate to="/onboarding" replace />;
    case "app":
      return <>{children}</>;
  }
}