import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface StepFooterProps {
  /** Previous step; omitted on the first step (Back hidden). */
  onBack?: () => void;
  /** One-click skip for this step (skippable at any step, spec §6a). */
  onSkip: () => void;
  busy: boolean;
  /** Optional secondary actions, placed before Skip. */
  extra?: ReactNode;
  /** The step's primary submit button. */
  children: ReactNode;
}

/**
 * The consistent action row every step renders inside its form: Back (left),
 * secondary actions, "Skip for now", and the step's primary submit button.
 */
export function StepFooter({ onBack, onSkip, busy, extra, children }: StepFooterProps) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            Back
          </Button>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {extra}
        <Button type="button" variant="outline" onClick={onSkip} disabled={busy}>
          Skip for now
        </Button>
        {children}
      </div>
    </div>
  );
}
