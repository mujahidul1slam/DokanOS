import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ListChecks, MinusCircle, PlayCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ONBOARDING_STEPS,
  isSetupComplete,
  progressFromRows,
  type OnboardingProgress,
} from "./steps";
import { shouldOfferBusinessOnboarding } from "./eligibility";
import { loadMembershipJoinVia, loadOnboardingProgress } from "./progress";

/**
 * Task 13 (spec §6a "re-runnable from settings"): the business setup
 * checklist as a settings surface. Shows each step's persisted mark and reopens
 * the wizard (resuming at the first unfinished step). Only offered to the
 * member who created the business — invited members never see the wizard, so
 * they never see its entry point either (spec §6b).
 */
export function OnboardingChecklistCard() {
  const { user } = useAuth();
  const { active, loading } = useBusinessContext();
  const navigate = useNavigate();
  const businessId = active?.id ?? null;
  const userId = user?.id ?? null;

  const [state, setState] = useState<{
    businessId: string;
    eligible: boolean;
    progress: OnboardingProgress;
  } | null>(null);

  useEffect(() => {
    if (loading || !businessId || !userId) return;
    let cancelled = false;
    (async () => {
      const joinedVia = await loadMembershipJoinVia(businessId, userId);
      if (cancelled) return;
      if (!shouldOfferBusinessOnboarding(joinedVia)) {
        setState({ businessId, eligible: false, progress: {} });
        return;
      }
      const rows = await loadOnboardingProgress(businessId);
      if (cancelled) return;
      setState({ businessId, eligible: true, progress: progressFromRows(rows) });
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, businessId, userId]);

  if (!active || !businessId || !state || state.businessId !== businessId) return null;
  if (!state.eligible) return null;

  const complete = isSetupComplete(state.progress);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Business setup checklist</h3>
        <Badge variant={complete ? "secondary" : "outline"} className="ml-auto">
          {complete ? "Complete" : "In progress"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        The skippable setup wizard for this business — resume where you left off
        or run any step again.
      </p>
      <ul className="space-y-1.5">
        {ONBOARDING_STEPS.map((step) => {
          const mark = state.progress[step.key];
          return (
            <li key={step.key} className="flex items-center gap-2 text-sm">
              {mark === "completed" ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : mark === "skipped" ? (
                <MinusCircle className="h-4 w-4 text-muted-foreground" />
              ) : (
                <PlayCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <span className={mark ? "text-muted-foreground" : "text-foreground"}>
                {step.label}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {mark === "completed" ? "Done" : mark === "skipped" ? "Skipped" : "Not done"}
              </span>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        size="sm"
        className="w-full sm:w-auto"
        onClick={() => navigate("/onboarding")}
      >
        {complete ? "Run setup again" : "Resume setup"}
      </Button>
    </div>
  );
}
