/**
 * Task 13: shared contract between the onboarding wizard shell and its step
 * components. Steps own their forms and primary action; the shell owns
 * persistence of the checklist marks and navigation between steps.
 */

import type { Brand, Business } from "@/hooks/useBusinessContext";
import type { OnboardingStepKey, StepMark } from "./steps";

export interface OnboardingStepProps {
  /** The wizard's business (the active business, just created on first run). */
  business: Business;
  businessId: string;
  /** Brands under the business; re-read via onContextRefresh after creation. */
  brands: Brand[];
  /**
   * Persist this step's mark and advance to the next unfinished step.
   * Resolves false when the mark did not persist — stay on the step.
   */
  onFinished: (mark: StepMark) => Promise<boolean>;
  /** Previous step; undefined on the first step (Back is hidden). */
  onBack?: () => void;
  /** Jump to another step (e.g. order sources → first brand). */
  onGoToStep: (key: OnboardingStepKey) => void;
  /** Re-read the business context after business/brand data changes. */
  onContextRefresh: () => void;
}
