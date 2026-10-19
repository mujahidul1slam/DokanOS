import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { supabase } from "@/integrations/supabase/client";
import { Step1Store } from "@/components/onboarding/Step1Store";
import { Step2Locations } from "@/components/onboarding/Step2Locations";
import { Step3SellingPoints } from "@/components/onboarding/Step3SellingPoints";
import { Step4Storefront } from "@/components/onboarding/Step4Storefront";
import type { CreateMyBrandStoreResult } from "@/lib/createMyBrandStore";
import { decideRoute, deriveStartStep } from "@/components/onboarding/guards";
import { CreateBusinessDialog } from "@/components/CreateBusinessDialog";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight, Check, CircleAlert, Loader2, Store } from "lucide-react";
import { toast } from "sonner";

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

const Shell = ({ children }: { children: ReactNode }) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-xl space-y-6">
        <header className="flex items-center gap-2 flex-wrap">
          <Store className="h-5 w-5 text-primary" />
          <span className="font-semibold">DokanOS</span>
          <span className="text-sm text-muted-foreground">· Setting up your business</span>
          {user && (
            <span className="ml-auto flex items-center gap-1.5 min-w-0">
              <span
                className="text-xs text-muted-foreground truncate max-w-[220px]"
                title={user.email ?? undefined}
              >
                {user.email}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs shrink-0"
                onClick={handleSignOut}
              >
                Sign out
              </Button>
            </span>
          )}
        </header>
        {children}
      </div>
    </div>
  );
};

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
  const { loading, active, businesses, brands, refresh, sellingPointsCount, onboardingCompletedAt } = useBusinessContext();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [step, setStep] = useState<number | null>(null);
  const [step1Result, setStep1Result] = useState<CreateMyBrandStoreResult | null>(null);
  const [createOpen, setCreateOpen] = useState(true);
  const [finishing, setFinishing] = useState(false);

  const paramError = searchParams.get("error");
  // ?slug=&business_id= is the AuthConfirm success contract (plan 01-05);
  // parsed now so the query-param shape is stable. Reserved slug is also
  // displayed by step 1 from the RPC return when the wizard is entered fresh.
  const paramSlug = searchParams.get("slug");
  const paramBusinessId = searchParams.get("business_id");

  // Derive the starting step from the server once loading finishes via
  // deriveStartStep (guards.ts): store/selling-point state gate the step —
  // locations are NOT a resume trigger (audit R4).
  useEffect(() => {
    if (loading || step !== null) return;
    setStep(
      deriveStartStep({
        // Only a brand linked to an existing store row counts as a store.
        hasStore: brands.some((brand) => brand.woo_store_id !== null),
        hasSellingPoints: sellingPointsCount > 0,
        onboardingCompletedAt,
      })
    );
  }, [loading, step, brands, sellingPointsCount, onboardingCompletedAt]);

  // Re-derive the step-1 resolution when the shell mounts fresh mid-wizard
  // (abandonment resume): resolve ids from the loaded brand (woo_store_id)
  // and the R4a-reserved storefront (query storefronts for the store).
  const rederiveBrand = step1Result ? null : (brands.find((b) => b.woo_store_id) ?? null);
  const [rederived, setRederived] = useState<CreateMyBrandStoreResult | null>(null);
  useEffect(() => {
    if (step1Result || !rederiveBrand?.woo_store_id) return;
    let cancelled = false;
    const storeId = rederiveBrand.woo_store_id;
    supabase
      .from("storefronts")
      .select("id")
      .eq("store_id", storeId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.id) return;
        setRederived({
          store_id: storeId,
          brand_id: rederiveBrand.id,
          storefront_id: data.id as string,
          slug: rederiveBrand.slug,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [step1Result, rederiveBrand]);
  const resolved = step1Result ?? rederived;

  const handleStep1Complete = async (result: CreateMyBrandStoreResult) => {
    await refresh();
    setStep1Result(result);
    setStep(2);
  };

  const handleStep2Advance = () => setStep(3);

  const handleStep3Advance = async () => {
    await refresh();
    setStep(4);
  };

  // Finish flow (D-09/D-12): writes the server-side done marker under the
  // existing owner UPDATE policy — no new RPC. The marker is what stops the
  // resume predicate, so skipped items are explicitly NOT re-trapped.
  const handleFinish = async () => {
    if (!active || finishing) return;
    setFinishing(true);
    try {
      const { error } = await supabase
        .from("businesses")
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq("id", active.id);
      if (error) throw error;
      await refresh();
      toast.success("You're all set", {
        description: "Your business setup is complete.",
      });
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not finish setup.");
    } finally {
      setFinishing(false);
    }
  };

  // Render nothing while loading (PermissionGuard contract).
  if (loading || step === null) return null;

  // Zero-membership create-business mode (D-04/D-12): when decideRoute yields
  // "create-business" post-load, the shell presents CreateBusinessDialog
  // full-page instead of the wizard steps. On success (refresh() +
  // setActive(business_id) inside the dialog) the shell transitions into the
  // wizard at step 1; a close without creation falls back to the re-anchor panel.
  const decision = decideRoute({
    loading,
    memberships: businesses.length,
    hasStore: brands.length > 0,
    hasSellingPoints: sellingPointsCount > 0,
    onboardingCompletedAt,
  });

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

  // Zero memberships (D-04/D-12): the create-business surface replaces the
  // wizard steps. create_additional_business serves first businesses for
  // zero-membership confirmed accounts (migration 20261014120000); on the
  // dialog's success (refresh() + setActive inside it) the shell transitions
  // into the wizard at step 1. A close without creation falls back to a
  // re-anchor panel — no navigation race with the dialog's close-then-refresh.
  if (decision === "create-business") {
    return (
      <Shell>
        {createOpen ? (
          <CreateBusinessDialog open={createOpen} onOpenChange={setCreateOpen} />
        ) : (
          <div className="space-y-4 rounded-md border border-border p-6">
            <p className="flex items-start gap-2 text-sm">
              <CircleAlert className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <span>
                Your account isn't linked to a business yet. Create your first
                business account to continue. A brand and stores are added
                explicitly afterwards.
              </span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                Create my business
              </Button>
            </div>
          </div>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <StepIndicator current={step} />
      {step === 1 ? (
        <Step1Store onComplete={handleStep1Complete} />
      ) : step === 2 ? (
        <Step2Locations brandId={resolved?.brand_id ?? null} onAdvance={handleStep2Advance} />
      ) : step === 3 ? (
        <Step3SellingPoints brandId={resolved?.brand_id ?? null} onAdvance={handleStep3Advance} />
      ) : (
        <>
          {resolved && (
            <Step4Storefront
              brandId={resolved.brand_id}
              storeId={resolved.store_id}
              storefrontId={resolved.storefront_id}
              slug={resolved.slug}
              onPublished={() => refresh()}
            />
          )}
          <Button
            onClick={handleFinish}
            disabled={finishing || !active || !brands.some((brand) => brand.woo_store_id !== null)}
            className="gap-1.5"
          >
            {finishing && <Loader2 className="h-4 w-4 animate-spin" />}
            Finish setup <ArrowRight className="h-4 w-4" />
          </Button>
        </>
      )}
      {step === 1 && paramBusinessId && paramSlug && (
        <p className="text-xs text-muted-foreground text-center">
          Resuming setup for <strong>{paramSlug}</strong>.
        </p>
      )}
    </Shell>
  );
}
