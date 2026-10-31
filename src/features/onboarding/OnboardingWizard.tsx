import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2, LogOut, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ONBOARDING_STEPS,
  isSetupComplete,
  markStep,
  progressFromRows,
  resumeIndex,
  stepIndexOf,
  type OnboardingProgress,
  type OnboardingStepKey,
  type StepMark,
} from "./steps";
import { shouldOfferBusinessOnboarding } from "./eligibility";
import {
  loadMembershipJoinVia,
  loadOnboardingProgress,
  saveStepMark,
  stampOnboardingCompleted,
} from "./progress";
import type { OnboardingStepProps } from "./stepProps";
import { BusinessProfileStep } from "./steps/BusinessProfileStep";
import { FirstBrandStep } from "./steps/FirstBrandStep";
import { OrderSourcesStep } from "./steps/OrderSourcesStep";

/**
 * Task 13 (spec §6a): the business-creation onboarding wizard.
 *
 * Route component for /onboarding. Runs for the member who CREATED the active
 * business (eligibility.ts — invited members are redirected away and never see
 * it, spec §6b). Every step is skippable with one click ("Skip for now" marks
 * the step skipped and advances; "Exit setup" leaves at any point), and all
 * marks persist per business in `business_onboarding_steps`, so the wizard
 * resumes at the first unfinished step after sign-out/in and is re-runnable
 * from settings (OnboardingChecklistCard).
 */
export default function OnboardingWizard() {
  const { user } = useAuth();
  const { active, brands, loading, refresh } = useBusinessContext();
  const navigate = useNavigate();

  const businessId = active?.id ?? null;
  const userId = user?.id ?? null;

  const [ready, setReady] = useState(false);
  /** The business the loaded state belongs to — stale loads never render. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [eligible, setEligible] = useState(false);
  const [progress, setProgress] = useState<OnboardingProgress>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const stampedRef = useRef(false);

  // Load the wizard offer + persisted checklist for the active business.
  useEffect(() => {
    if (loading || !businessId || !userId) return;
    let cancelled = false;
    // A business switch starts a fresh checklist view.
    setReady(false);
    stampedRef.current = false;
    (async () => {
      const joinedVia = await loadMembershipJoinVia(businessId, userId);
      if (cancelled) return;
      if (!shouldOfferBusinessOnboarding(joinedVia)) {
        setEligible(false);
        setReady(true);
        setLoadedFor(businessId);
        return;
      }
      const rows = await loadOnboardingProgress(businessId);
      if (cancelled) return;
      const next = progressFromRows(rows);
      setProgress(next);
      setStepIndex(resumeIndex(next));
      setEligible(true);
      setReady(true);
      setLoadedFor(businessId);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, businessId, userId]);

  /**
   * Persist the current step's mark and advance to the first unfinished step
   * (the completion panel when nothing is left). False = the mark did not
   * persist; the step stays put.
   */
  const finishStep = useCallback(
    async (mark: StepMark): Promise<boolean> => {
      const step = ONBOARDING_STEPS[stepIndex];
      if (!step || !businessId || busy) return false;
      setBusy(true);
      try {
        await saveStepMark(businessId, step.key, mark);
      } catch {
        setBusy(false);
        toast.error("Could not save your progress. Please try again.");
        return false;
      }
      const next = markStep(progress, step.key, mark);
      setProgress(next);
      setBusy(false);
      setStepIndex(resumeIndex(next));
      return true;
    },
    [businessId, busy, progress, stepIndex],
  );

  // Completion marker for the legacy businesses.onboarding_completed_at
  // readers; the checklist rows are the wizard's source of truth.
  useEffect(() => {
    if (!ready || !eligible || !businessId || stampedRef.current) return;
    if (!isSetupComplete(progress)) return;
    stampedRef.current = true;
    void stampOnboardingCompleted(businessId).catch(() => {
      // Marker only — never blocks or re-prompts the finished wizard.
    });
  }, [ready, eligible, businessId, progress]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }

  // No business to set up → the create-or-join surface.
  if (!businessId || !active) {
    return <Navigate to="/accounts" replace />;
  }

  if (!ready || loadedFor !== businessId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }

  // Spec §6b: invited (and any non-creating) members never see the wizard.
  if (!eligible) {
    return <Navigate to="/" replace />;
  }

  const currentStep = ONBOARDING_STEPS[stepIndex];
  const complete = isSetupComplete(progress);

  const stepProps: OnboardingStepProps = {
    business: active,
    businessId,
    brands,
    onFinished: finishStep,
    onBack: stepIndex > 0 ? () => setStepIndex(stepIndex - 1) : undefined,
    onGoToStep: (key: OnboardingStepKey) => setStepIndex(stepIndexOf(key)),
    onContextRefresh: () => void refresh(),
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Set up your business</h1>
            <p className="text-sm text-muted-foreground">
              {active.name} — every step is optional and saved as you go. You can
              finish the rest later from settings.
            </p>
          </div>
          <Button type="button" variant="ghost" className="gap-1.5 shrink-0" onClick={() => navigate("/")}>
            <LogOut className="h-4 w-4" />
            Exit setup
          </Button>
        </div>

        <nav aria-label="Setup steps" className="flex flex-wrap items-center gap-2">
          {ONBOARDING_STEPS.map((step, index) => {
            const mark = progress[step.key];
            const isCurrent = index === stepIndex;
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => setStepIndex(index)}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                  isCurrent
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {mark === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                ) : mark === "skipped" ? (
                  <MinusCircle className="h-3.5 w-3.5" />
                ) : (
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px]">
                    {index + 1}
                  </span>
                )}
                {step.label}
              </button>
            );
          })}
        </nav>

        {complete && stepIndex >= ONBOARDING_STEPS.length ? (
          <Card>
            <CardHeader>
              <CardTitle>You're all set</CardTitle>
              <CardDescription>
                Your business setup checklist is complete. Run any step again
                whenever you like from Settings → Business Account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2">
                {ONBOARDING_STEPS.map((step, index) => (
                  <li key={step.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">{step.label}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setStepIndex(index)}
                    >
                      {progress[step.key] === "completed" ? "Review" : "Do it now"}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <Button type="button" onClick={() => navigate("/")}>
                  Go to dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{currentStep.title}</CardTitle>
              <CardDescription>
                Step {stepIndex + 1} of {ONBOARDING_STEPS.length} · {currentStep.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {currentStep.key === "business_profile" && <BusinessProfileStep {...stepProps} />}
              {currentStep.key === "first_brand" && <FirstBrandStep {...stepProps} />}
              {currentStep.key === "order_sources" && <OrderSourcesStep {...stepProps} />}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
