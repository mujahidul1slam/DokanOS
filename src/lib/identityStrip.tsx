/**
 * Shared branded identity selector surfaces (issue #22).
 *
 * The large strip sits directly above the dialog action buttons and shows the
 * Brand (logo or monogram + name), the Selling Point, and the Pathao Account
 * (mark + account name + pickup store), each clickable to change. Mixed-brand
 * orders show per-brand item chips and the dismissible warning inside the strip.
 *
 * Glossary terms (GLOSSARY.md): Brand, Selling Point, Pathao Account.
 */

import { forwardRef, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { brandAccent, brandMonogram } from "@/lib/brandIdentity";
import { cn } from "@/lib/utils";

export interface IdentityAccountView {
  key: string;
  accountName: string;
  pickupStoreName: string;
}

/** Pathao brand mark tile (the glossary's "Pathao Account" surface). */
export function PathaoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white",
        className,
      )}
      style={{ backgroundColor: "#F5533D" }}
      aria-hidden="true"
    >
      P
    </span>
  );
}

/** Brand avatar: logo image when present, deterministic monogram otherwise. */
export function BrandAvatar({
  brandId,
  brandName,
  logoUrl,
  className,
}: {
  brandId: string | null;
  brandName: string | null;
  logoUrl: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white",
        className,
      )}
      style={{ backgroundColor: brandId ? brandAccent(brandId) : "hsl(var(--primary))" }}
      aria-hidden="true"
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-full w-full rounded-md object-cover" />
      ) : (
        brandMonogram(brandName)
      )}
    </span>
  );
}

export function IdentityStripCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface IdentitySegmentProps {
  label: string;
  value: ReactNode;
  subValue?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

/** One clickable identity column (Brand / Selling Point / Pathao Account). */
export const IdentitySegment = forwardRef<HTMLButtonElement, IdentitySegmentProps>(
  function IdentitySegment(
    { label, value, subValue, icon, onClick, disabled, className },
    ref,
  ) {
    const content = (
      <>
        {icon}
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="block truncate text-sm font-semibold text-foreground">{value}</span>
          {subValue != null && (
            <span className="block truncate text-[11px] text-muted-foreground">{subValue}</span>
          )}
        </span>
        {onClick && !disabled && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </>
    );

    if (disabled || !onClick) {
      return (
        <div
          className={cn(
            "flex min-w-[150px] flex-1 items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5",
            className,
          )}
        >
          {content}
        </div>
      );
    }

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-w-[150px] flex-1 items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-left transition-colors hover:border-primary/50 hover:bg-background",
          className,
        )}
      >
        {content}
      </button>
    );
  },
);

export interface MixedBrandChip {
  brandId: string | null;
  brandName: string;
  /** Item chips for this Brand (e.g. product names with quantities). */
  itemLabels: string[];
}

/**
 * Per-brand item chips for mixed-brand orders: one row per Brand with its
 * Brand tile and the item chips belonging to it.
 */
export function MixedBrandItemChips({ chips }: { chips: MixedBrandChip[] }) {
  return (
    <div className="space-y-1.5">
      {chips.map((chip) => (
        <div key={chip.brandId ?? "__no-brand__"} className="flex flex-wrap items-center gap-1.5">
          <span
            className="flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-semibold text-white"
            style={{ backgroundColor: chip.brandId ? brandAccent(chip.brandId) : "hsl(var(--muted-foreground))" }}
          >
            {chip.brandName}
          </span>
          {chip.itemLabels.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Dismissible warning shown inside the identity strip. */
export function StripWarning({
  message,
  onDismiss,
}: {
  message: ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
      <span>{message}</span>
      <button type="button" className="shrink-0 underline" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/** Per-order chip with a batch-only remove (X) button. */
export function BatchOrderChip({
  label,
  onRemove,
  removeTitle,
}: {
  label: string;
  onRemove?: () => void;
  removeTitle?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 py-0.5 pl-2 pr-1 text-[10px] text-muted-foreground">
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={removeTitle}
          aria-label={removeTitle ?? `Remove ${label} from batch`}
          className="rounded-full p-0.5 hover:bg-muted"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
