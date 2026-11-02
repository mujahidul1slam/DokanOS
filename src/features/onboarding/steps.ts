/**
 * Task 13 (domain revamp, spec §6a): the business-creation onboarding wizard's
 * step vocabulary and persistent checklist state — pure logic, no I/O.
 *
 * The wizard runs the spec §6a order (business profile → first brand → order
 * sources → warehouses → product import → storefront; Task 14 appended the
 * last three). Progress is persisted per
 * business in `business_onboarding_steps` (one row per business + step; a step
 * with no row is still open), which makes the wizard skippable at any step and
 * resumable after sign-out/in. Rows whose step_key this build does not know
 * are ignored — an older client never blocks on newer steps.
 */

export type OnboardingStepKey =
  | "business_profile"
  | "first_brand"
  | "order_sources"
  | "warehouses"
  | "product_import"
  | "storefront";

export interface OnboardingStepDef {
  key: OnboardingStepKey;
  /** Wizard heading for the step. */
  title: string;
  /** Compact checklist label (settings card, stepper). */
  label: string;
  description: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  {
    key: "business_profile",
    title: "Business profile",
    label: "Business profile",
    description: "Confirm the business name, currency and contact basics.",
  },
  {
    key: "first_brand",
    title: "First brand",
    label: "First brand",
    description: "Name your first brand explicitly. A logo is optional.",
  },
  {
    key: "order_sources",
    title: "Order sources",
    label: "Order sources",
    description: "Choose where orders come from: channels and showrooms.",
  },
  {
    key: "warehouses",
    title: "Warehouses",
    label: "Warehouses",
    description: "Add the stock-only warehouses your brands ship from.",
  },
  {
    key: "product_import",
    title: "Product import",
    label: "Product import",
    description: "Bring products in from WooCommerce, a CSV file, or add them manually.",
  },
  {
    key: "storefront",
    title: "Storefront",
    label: "Storefront",
    description: "Launch a storefront — name, theme, payments, publish.",
  },
];

export type StepMark = "completed" | "skipped";

/** step_key → mark. A missing key means the step is still open. */
export type OnboardingProgress = Partial<Record<OnboardingStepKey, StepMark>>;

/** A row of `business_onboarding_steps` as the client reads it. */
export interface OnboardingStepRow {
  step_key: string;
  status: string;
}

const STEP_KEYS = new Set<string>(ONBOARDING_STEPS.map((s) => s.key));

/**
 * Map persisted rows to progress. Unknown step keys (from a newer wizard
 * build, e.g. Task 14's steps) and unknown statuses are ignored — the client
 * only ever acts on the vocabulary it ships.
 */
export function progressFromRows(rows: readonly OnboardingStepRow[]): OnboardingProgress {
  const progress: OnboardingProgress = {};
  for (const row of rows) {
    if (!STEP_KEYS.has(row.step_key)) continue;
    if (row.status !== "completed" && row.status !== "skipped") continue;
    progress[row.step_key as OnboardingStepKey] = row.status;
  }
  return progress;
}

/** Immutable mark: saving a step again (re-run) overwrites its previous mark. */
export function markStep(
  progress: OnboardingProgress,
  key: OnboardingStepKey,
  mark: StepMark,
): OnboardingProgress {
  return { ...progress, [key]: mark };
}

export function stepMark(progress: OnboardingProgress, key: OnboardingStepKey): StepMark | undefined {
  return progress[key];
}

/** Finished = completed or deliberately skipped; anything else is still open. */
export function isStepFinished(progress: OnboardingProgress, key: OnboardingStepKey): boolean {
  return progress[key] === "completed" || progress[key] === "skipped";
}

/** The first step without a mark — where resume lands. Null when all finished. */
export function nextUnfinishedKey(progress: OnboardingProgress): OnboardingStepKey | null {
  for (const step of ONBOARDING_STEPS) {
    if (!isStepFinished(progress, step.key)) return step.key;
  }
  return null;
}

/** Every step finished (completed or skipped) — the wizard is done. */
export function isSetupComplete(progress: OnboardingProgress): boolean {
  return nextUnfinishedKey(progress) === null;
}

export function stepIndexOf(key: OnboardingStepKey): number {
  return ONBOARDING_STEPS.findIndex((s) => s.key === key);
}

/**
 * Where resume opens the wizard: the first unfinished step's index, or
 * ONBOARDING_STEPS.length (the completion panel) when everything is finished.
 */
export function resumeIndex(progress: OnboardingProgress): number {
  const key = nextUnfinishedKey(progress);
  return key === null ? ONBOARDING_STEPS.length : stepIndexOf(key);
}
