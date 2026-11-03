import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ConnectorSectionProps {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  count: number;
  /** Buttons rendered at the end of the section header (e.g. "New source"). */
  actions?: ReactNode;
  /**
   * "grid" lays children out as connector cards; "stack" renders them full
   * width (management tables live in the panels and handle their own layout
   * and empty states).
   */
  layout?: "grid" | "stack";
  children: ReactNode;
}

/**
 * One integrations section: header, one-line description, count, optional
 * header actions, then the section body. The Integrations page is the single
 * management surface for order sources and courier services, so each panel
 * owns its loading/error/empty states inside `children`.
 */
export function ConnectorSection({
  id,
  title,
  description,
  icon,
  count,
  actions,
  layout = "grid",
  children,
}: ConnectorSectionProps) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 id={id} className="font-heading text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {actions && <div className="ml-auto shrink-0">{actions}</div>}
        <Badge variant="secondary" className={cn("shrink-0", actions && "ml-3")}>
          {count}
        </Badge>
      </div>
      {layout === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
