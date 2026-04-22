interface Stage {
  label: string;
  count: number;
  color: string;
}

interface Props {
  pending: number;
  processing: number;
  shipped: number;
  delivered: number;
  cancelled: number;
}

const FulfillmentFunnel = ({ pending, processing, shipped, delivered, cancelled }: Props) => {
  const total = pending + processing + shipped + delivered + cancelled;

  const stages: Stage[] = [
    { label: "Pending", count: pending, color: "bg-amber-500/70" },
    { label: "Processing", count: processing, color: "bg-primary/70" },
    { label: "Shipped", count: shipped, color: "bg-violet-500/70" },
    { label: "Delivered", count: delivered, color: "bg-success/70" },
    { label: "Cancelled", count: cancelled, color: "bg-destructive/70" },
  ];

  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-sm font-medium text-card-foreground">Fulfillment Funnel</h2>
        <span className="text-xs text-muted-foreground">{total} orders</span>
      </div>
      <div className="space-y-2.5">
        {stages.map((s) => {
          const pct = total === 0 ? 0 : (s.count / total) * 100;
          const widthPct = (s.count / max) * 100;
          return (
            <div key={s.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="text-card-foreground tabular-nums">
                  {s.count} <span className="text-muted-foreground">({pct.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                <div className={`h-full ${s.color} rounded-full transition-all`} style={{ width: `${widthPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FulfillmentFunnel;
