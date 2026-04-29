import { ReactNode } from "react";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Card wrapper for a settings tab. Standardizes padding, header treatment,
 * and an optional sticky-footer Save button so every tab feels the same.
 */
export const SettingsSection = ({
  title,
  description,
  icon: Icon,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  icon?: typeof Info;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      <div className="p-4 sm:p-6 space-y-5">
        <div>
          <h2 className="font-heading text-base sm:text-lg font-semibold flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            {title}
          </h2>
          {description && (
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        {children}
      </div>
      {footer && (
        <div className="flex justify-end gap-2 px-4 sm:px-6 py-3 border-t border-border bg-muted/20 rounded-b-lg">
          {footer}
        </div>
      )}
    </div>
  );
};

/**
 * Label with a small (?) icon that reveals the longer description in a tooltip.
 * Keeps row heights tight while preserving the explanation.
 */
export const LabelWithHint = ({
  children,
  hint,
  className,
}: {
  children: ReactNode;
  hint?: string;
  className?: string;
}) => {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Label className="text-sm">{children}</Label>
      {hint && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="More info"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{hint}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};

/**
 * Standard save button used inside SettingsSection footer. Matches phrasing
 * and disabled/saving state across every tab.
 */
export const SaveButton = ({
  saving,
  disabled,
  onClick,
  label = "Save Changes",
}: {
  saving?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
}) => (
  <Button onClick={onClick} disabled={saving || disabled} size="sm" className="min-w-[120px]">
    {saving ? "Saving…" : label}
  </Button>
);
