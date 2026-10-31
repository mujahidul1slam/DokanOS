/**
 * Task 13 (spec §6a): persistence for the per-business onboarding checklist
 * (`business_onboarding_steps`, migration 20261102090000) plus the membership
 * provenance read behind the wizard offer.
 *
 * Save semantics: a mark must persist before the wizard advances — a failed
 * save throws so the UI can stay on the step and retry. Loads degrade to "no
 * progress yet" instead of blocking the wizard.
 */

import { supabase } from "@/integrations/supabase/client";
import type { OnboardingStepKey, OnboardingStepRow, StepMark } from "./steps";

/**
 * The caller's membership provenance for the business (an ordinary own-row
 * read). Null when there is no readable row or the read fails — the caller
 * treats unknown as "not offered" (fail closed).
 */
export async function loadMembershipJoinVia(
  businessId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("user_business_access")
    .select("joined_via")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return data?.joined_via ?? null;
}

/** Saved checklist rows for the business; empty on read failure. */
export async function loadOnboardingProgress(businessId: string): Promise<OnboardingStepRow[]> {
  const { data, error } = await supabase
    .from("business_onboarding_steps")
    .select("step_key, status")
    .eq("business_id", businessId);
  if (error) return [];
  return (data ?? []) as OnboardingStepRow[];
}

/**
 * Persist one step's mark (upsert: re-running a step overwrites its mark).
 * Throws on failure so the wizard never advances past an unsaved mark.
 */
export async function saveStepMark(
  businessId: string,
  stepKey: OnboardingStepKey,
  mark: StepMark,
): Promise<void> {
  const { error } = await supabase
    .from("business_onboarding_steps")
    .upsert(
      { business_id: businessId, step_key: stepKey, status: mark },
      { onConflict: "business_id,step_key" },
    );
  if (error) throw new Error(error.message);
}

/**
 * Stamp the legacy `businesses.onboarding_completed_at` marker once the
 * checklist is fully finished (it feeds useBusinessContext and the legacy
 * guards). Failure is non-fatal: the checklist itself is the source of truth.
 */
export async function stampOnboardingCompleted(businessId: string): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", businessId)
    .select("id");
  if (error) throw new Error(error.message);
}
