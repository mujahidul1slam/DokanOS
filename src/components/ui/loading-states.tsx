import { Skeleton } from "@/components/ui/skeleton";

export const TableSkeleton = ({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) => (
  <div className="rounded-lg border border-border overflow-hidden">
    <div className="bg-secondary p-3">
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-24" />
        ))}
      </div>
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex gap-4 border-t border-border p-3">
        {Array.from({ length: cols }).map((_, j) => (
          <Skeleton key={j} className="h-4 w-24" />
        ))}
      </div>
    ))}
  </div>
);

export const StatsSkeleton = ({ count = 4 }: { count?: number }) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-4" />
        </div>
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
    ))}
  </div>
);

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 px-6">
    <Icon className="h-12 w-12 text-muted-foreground/50" />
    <h3 className="mt-4 text-lg font-medium text-foreground">{title}</h3>
    <p className="mt-1 text-sm text-muted-foreground text-center max-w-sm">{description}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);
