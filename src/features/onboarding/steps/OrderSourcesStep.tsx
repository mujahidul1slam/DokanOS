import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { orderSourceLabel, type OrderSourceType } from "@/lib/orderSources";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { OnboardingStepProps } from "../stepProps";
import { StepFooter } from "./StepFooter";

interface OfferedSource {
  type: OrderSourceType;
  label: string;
  blurb: string;
  /** Manual channels are user-named. */
  manual?: boolean;
}

/**
 * The channels the order-source step offers (Task 13 acceptance): Storefront /
 * Facebook / WhatsApp / Showroom / Manual. Legacy WooCommerce is retired and
 * cannot be created from onboarding.
 */
const OFFERED: readonly OfferedSource[] = [
  {
    type: "storefront",
    label: "Storefront",
    blurb: "A Dokan OS storefront — checkout orders land here.",
  },
  {
    type: "facebook",
    label: "Facebook",
    blurb: "Orders taken via a Facebook page.",
  },
  {
    type: "whatsapp",
    label: "WhatsApp",
    blurb: "Orders taken via a WhatsApp business number.",
  },
  {
    type: "showroom",
    label: "Showroom",
    blurb: "A physical showroom — walk-in and POS sales attach here; holds stock.",
  },
  {
    type: "manual",
    label: "Manual",
    blurb: "A channel you name yourself — Phone, Wholesale, Referral…",
    manual: true,
  },
];

interface SourceSummary {
  id: string;
  name: string;
  type: string;
}

/**
 * Wizard step 3 (spec §6a: "connect order sources"). Selecting channels
 * creates real `order_sources` rows on the first brand — connection
 * credentials (page handles, etc.) are filled in later on the Order Sources
 * page; product import is a separate step.
 */
export function OrderSourcesStep({
  brands,
  onFinished,
  onBack,
  onGoToStep,
  onContextRefresh,
}: OnboardingStepProps) {
  const [targetBrandId, setTargetBrandId] = useState<string>(brands[0]?.id ?? "");
  const [existing, setExisting] = useState<SourceSummary[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [manualName, setManualName] = useState("");
  const [saving, setSaving] = useState(false);

  // Default to the first brand; follow a refresh that replaces the list.
  useEffect(() => {
    setTargetBrandId((current) =>
      brands.some((b) => b.id === current) ? current : (brands[0]?.id ?? ""),
    );
  }, [brands]);

  useEffect(() => {
    if (!targetBrandId) return;
    let cancelled = false;
    setLoadingSources(true);
    (async () => {
      const { data } = await supabase
        .from("order_sources")
        .select("id, name, type")
        .eq("brand_id", targetBrandId)
        .order("name");
      if (cancelled) return;
      setExisting((data ?? []) as SourceSummary[]);
      setLoadingSources(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [targetBrandId]);

  // Non-manual types already present on the brand cannot be added twice.
  const existingTypes = useMemo(
    () => new Set(existing.filter((s) => s.type !== "manual").map((s) => s.type)),
    [existing],
  );
  const existingManual = useMemo(
    () => existing.filter((s) => s.type === "manual").map((s) => s.name),
    [existing],
  );

  const toggle = (type: string) =>
    setSelected((prev) => ({ ...prev, [type]: !prev[type] }));

  const chosen = OFFERED.filter((o) => selected[o.type] && !existingTypes.has(o.type));
  const manualChosen = chosen.some((o) => o.manual);
  const manualMissing = manualChosen && manualName.trim().length === 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !targetBrandId) return;
    if (manualMissing) {
      toast.error("Name your manual channel to add it.");
      return;
    }
    setSaving(true);
    const failed: string[] = [];
    let added = 0;
    for (const offered of chosen) {
      const name = offered.manual ? manualName.trim() : offered.label;
      const { error } = await supabase
        .from("order_sources")
        .insert({ brand_id: targetBrandId, name, type: offered.type });
      if (error) failed.push(name);
      else added += 1;
    }
    setSaving(false);
    if (failed.length > 0) {
      toast.error(
        failed.length === chosen.length
          ? `Could not add ${failed.join(", ")}. Please try again.`
          : `Added ${added}, but could not add ${failed.join(", ")}.`,
      );
      if (added === 0) return;
    }
    onContextRefresh();
    await onFinished("completed");
  };

  if (brands.length === 0) {
    // Sources attach to a brand — nothing implicit is created here.
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
          <p className="text-sm text-foreground">
            Order sources live under a brand. Add your first brand, then connect
            your channels here.
          </p>
        </div>
        <StepFooter onBack={onBack} onSkip={() => void onFinished("skipped")} busy={saving}>
          <Button type="button" onClick={() => onGoToStep("first_brand")}>
            Add your first brand
          </Button>
        </StepFooter>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {brands.length > 1 && (
        <div className="space-y-1.5">
          <Label>Brand to connect</Label>
          <Select value={targetBrandId} onValueChange={setTargetBrandId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a brand" />
            </SelectTrigger>
            <SelectContent>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">
          Where do orders come from?
        </legend>
        <p className="text-xs text-muted-foreground">
          Pick every channel you sell through. Connection details are added later
          on the Order Sources page.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {OFFERED.map((offered) => {
            const already = existingTypes.has(offered.type);
            return (
              <label
                key={offered.type}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                  selected[offered.type] ? "border-primary bg-secondary/50" : "border-border",
                  already && "cursor-default opacity-80",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={already || !!selected[offered.type]}
                  disabled={already || loadingSources}
                  onChange={() => toggle(offered.type)}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {offered.label}
                    {already && <Badge variant="outline">Added</Badge>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {offered.blurb}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {manualChosen && (
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-manual-name">Manual channel name</Label>
          <Input
            id="onboarding-manual-name"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="e.g. Phone, Wholesale, Referral"
            maxLength={100}
          />
        </div>
      )}

      {(existing.length > 0 || loadingSources) && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {loadingSources ? (
              "Checking connected sources…"
            ) : (
              <>
                Already on this brand:{" "}
                {existing.map((s, i) => (
                  <Badge key={s.id} variant="secondary" className={i > 0 ? "ml-1" : ""}>
                    {s.name}
                  </Badge>
                ))}
                {existingManual.length > 0 && (
                  <span className="ml-1">
                    (add more manual channels anytime from Order Sources)
                  </span>
                )}
              </>
            )}
          </p>
        </div>
      )}

      <StepFooter onBack={onBack} onSkip={() => void onFinished("skipped")} busy={saving}>
        <Button type="submit" disabled={saving || manualMissing}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {chosen.length > 0 ? `Add ${chosen.length === 1 ? "channel" : "channels"} & continue` : "Continue"}
        </Button>
      </StepFooter>
    </form>
  );
}
