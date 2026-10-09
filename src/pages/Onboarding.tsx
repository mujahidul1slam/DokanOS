import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Step1Store } from "@/components/onboarding/Step1Store";
import type { CreateMyBrandStoreResult } from "@/lib/createMyBrandStore";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight, Check, CircleAlert, Store } from "lucide-react";

/** Fixed wizard order (D-10). Step 1 = store, 2 = locations, 3 = selling points, 4 = finish. */
const STEP_LABELS = ["Store", "Locations", "Selling points", "Finish"] as const;
const LAST_STEP = STEP_LABELS.length;

const StepIndicator = ({ current }: { current: number }) => (
  <ol className="flex items-center w-full" aria-label="Onboarding steps">
    {STEP_LABELS.map((label, i) => {
      const n = i + 1;
      const done = n < current;
      const active = n === current;
      return (
        <li key={label} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <span
              aria-current={active ? "step" : undefined}
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-medium ${
                done
                  ? "bg-primary text-primary-foreground border-primary"
                  : active
                    ? "border-primary text-primary bg-background"
                    : "border-border text-muted-foreground bg-background"
              }`}
            >
              {done ? <Check className="h-4 w-4" /> : n}
            </span>
            <span className={`text-xs ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {label}
            </span>
          </div>
          {n < LAST_STEP && <div className={`h-px flex-1 mx-2 ${done ? "bg-primary" : "bg-border"}`} />}
        </li>
      );
    })}
  </ol>
);

/**
 * Steps 2–4 are explicit mount points for plan 01-04 — the shell's step
 * registry below is the seam that fills them. No business logic here.
 */
const StepPlaceholder = ({ step }: { step: number }) => (
  <div className="space-y-2 rounded-md border border-dashed border-border p-6 text-center">
    <p className="text-sm font-medium">{STEP_LABELS[step - 1]}</p>
    <p className="text-sm text-muted-foreground">
      This step is coming in the next update. Your store and storefront are already
      reserved — you can finish setup later from the dashboard.
    </p>
    <Button variant="outline" onClick={() => window.location.assign("/")}>
      Go to dashboard <ArrowRight className="h-4 w-4" />
    </Button>
  </div>
);

const Shell = ({ children }: { children: ReactNode }) => (
  <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
    <div className="w-full max-w-xl space-y-6">
      <header className="flex items-center gap-2">
        <Store className="h-5 w-5 text-primary" />
        <span className="font-semibold">DokanOS</span>
        <span className="text-sm text-muted-foreground">· Setting up your business</span>
      </header>
      {children}
    </div>
  </div>
);

/**
 * Full-page onboarding wizard at /onboarding (D-10): lives outside
 * DashboardLayout, renders nothing while the business context loads
 * (RESEARCH Pitfall 5 — guards must tolerate loading by rendering nothing),
 * keeps step state locally with a derive-from-server fallback
 * (brands already exist → step 1 is done), and honors the future
 * AuthConfirm success contract via ?slug=&business_id= plus ?error= for
 * the failure path (RESEARCH Open Question 1).
 */
export default function Onboarding() {
  const { loading, active, brands, refresh } = useBusinessContext();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<number | null>(null);

  const paramError = searchParams.get("error");
  // ?slug=&business_id= is the AuthConfirm success contract (plan 01-05);
  // parsed now so the query-param shape is stable. Reserved slug is also
  // displayed by step 1 from the RPC return when the wizard is entered fresh.
  const paramSlug = searchParams.get("slug");
  const paramBusinessId = searchParams.get("business_id");

  // Derive the starting step from the server once loading finishes:
  // brands already exist → step 1 (store creation) is done.
  useEffect(() => {
    if (loading || step !== null) return;
    setStep(brands.length > 0 ? 2 : 1);
  }, [loading, step, brands.length]);

  const handleStep1Complete = async (_result: CreateMyBrandStoreResult) => {
    await refresh();
    setStep(2);
  };

  // Render nothing while loading (PermissionGuard contract).
  if (loading || step === null) return null;

  // ?error= — the AuthConfirm failure contract: show a retry/re-anchor panel.
  if (paramError) {
    return (
      <Shell>
        <div className="space-y-4 rounded-md border border-destructive/30 bg-destructive/5 p-6">
          <p className="flex items-start gap-2 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <span>
              We couldn't finish setting up your account
              {paramSlug ? ` for “${paramSlug}”` : ""}: {paramError}
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/onboarding", { replace: true })}
            >
              Try again
            </Button>
            <Button variant="ghost" onClick={() => navigate("/", { replace: true })}>
              Go to dashboard
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  // No business membership at all: the wizard can't run without a business.
  if (!active) {
    return (
      <Shell>
        <div className="space-y-4 rounded-md border border-border p-6">
          <p className="flex items-start gap-2 text-sm">
            <CircleAlert className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <span>
              No business is linked to your account yet. Create your business
              from the dashboard first, then return here to set up your store.
            </span>
          </p>
          <Button variant="outline" onClick={() => navigate("/", { replace: true })}>
            Go to dashboard
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <StepIndicator current={step} />
      {step === 1 ? (
        <Step1Store onComplete={handleStep1Complete} />
      ) : (
        <StepPlaceholder step={step} />
      )}
      {step === 1 && paramBusinessId && paramSlug && (
        <p className="text-xs text-muted-foreground text-center">
          Resuming setup for <strong>{paramSlug}</strong>.
        </p>
      )}
    </Shell>
  );
}
