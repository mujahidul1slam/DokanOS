import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Loader2, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StorefrontSubOnboarding } from "@/components/storefront/StorefrontSubOnboarding";
import type { CreatedStorefront } from "@/components/storefront/storefrontCreate";
import type { OnboardingStepProps } from "../stepProps";
import { StepFooter } from "./StepFooter";

interface ExistingStorefront {
  id: string;
  name: string;
  slug: string;
}

/**
 * Wizard step 6 (spec §6a: "Storefront creation — only if the customer chose
 * Storefront as an order source. Launches the storefront sub-onboarding
 * (name/slug, theme, payments, publish)"). The sub-onboarding itself is shared
 * with the Storefronts area's "create storefront" (never duplicated). When no
 * Storefront channel was chosen in step 3 the step offers the same flow
 * explicitly instead of running it — and stays skippable either way.
 */
export function StorefrontStep({ brands, onFinished, onBack }: OnboardingStepProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"intro" | "create" | "created">("intro");
  const [chosenChannel, setChosenChannel] = useState<boolean | null>(null);
  const [existing, setExisting] = useState<ExistingStorefront[]>([]);
  const [created, setCreated] = useState<CreatedStorefront | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const brandIds = brands.map((b) => b.id);
      if (brandIds.length === 0) {
        if (!cancelled) {
          setChosenChannel(false);
          setExisting([]);
          setLoading(false);
        }
        return;
      }
      const [sourcesResult, storefrontsResult] = await Promise.all([
        supabase
          .from("order_sources")
          .select("id")
          .in("brand_id", brandIds)
          .eq("type", "storefront")
          .limit(1),
        supabase
          .from("storefronts")
          .select("id, name, slug")
          .in("brand_id", brandIds)
          .order("name"),
      ]);
      if (cancelled) return;
      setChosenChannel((sourcesResult.data ?? []).length > 0);
      setExisting((storefrontsResult.data ?? []) as ExistingStorefront[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [brands]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (mode === "create") {
    return (
      <div className="space-y-4">
        <StorefrontSubOnboarding
          onCreated={(sf) => {
            setCreated(sf);
            setMode("created");
          }}
          extraActions={
            <>
              {onBack && (
                <Button type="button" variant="ghost" onClick={onBack}>
                  Back
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => void onFinished("skipped")}>
                Skip for now
              </Button>
            </>
          }
        />
      </div>
    );
  }

  if (mode === "created" && created) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
          <p className="text-sm text-foreground">
            <span className="font-medium">{created.name}</span> is set up. You can refine theme,
            payments and pages anytime in the storefront admin.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate(`/storefronts/${created.slug}/admin/dashboard`)}
          >
            <ExternalLink className="h-4 w-4" /> Open storefront admin
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate(`/storefront/${created.slug}`)}
          >
            <Store className="h-4 w-4" /> View storefront
          </Button>
        </div>
        <StepFooter onBack={() => setMode("intro")} onSkip={() => void onFinished("skipped")} busy={false}>
          <Button type="button" onClick={() => void onFinished("completed")}>
            Continue
          </Button>
        </StepFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
        <p className="text-sm text-foreground">
          {chosenChannel
            ? "You picked the Storefront channel — launch your storefront now (name, theme, payments, publish), or come back to it later."
            : "You didn’t pick a Storefront channel in the order-sources step. You can still create one now, or skip this step."}
        </p>
      </div>

      {existing.length > 0 && (
        <div className="rounded-md border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Already set up:{" "}
            {existing.map((s, i) => (
              <Badge key={s.id} variant="secondary" className={i > 0 ? "ml-1" : ""}>
                {s.name}
              </Badge>
            ))}
            <button
              type="button"
              className="ml-2 font-medium text-primary underline underline-offset-2"
              onClick={() => navigate("/storefronts")}
            >
              Manage storefronts
            </button>
          </p>
        </div>
      )}

      <StepFooter onBack={onBack} onSkip={() => void onFinished("skipped")} busy={false}>
        <Button type="button" onClick={() => setMode("create")}>
          {chosenChannel ? "Create your storefront" : "Create a storefront anyway"}
        </Button>
      </StepFooter>
    </div>
  );
}
