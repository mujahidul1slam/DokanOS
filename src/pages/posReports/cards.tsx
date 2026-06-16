export const toneClasses = {
  success: "border-success/30 bg-success/5 text-success",
  warning: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-500",
  destructive: "border-destructive/30 bg-destructive/5 text-destructive",
  default: "border-border bg-card text-foreground",
} as const;

export type Tone = keyof typeof toneClasses;

export const FulfillCard = ({
  icon: Icon, label, value, tone = "default",
}: { icon: any; label: string; value: number; tone?: Tone }) => (
  <div className={`rounded-lg border p-4 ${toneClasses[tone]}`}>
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[11px] uppercase tracking-wide opacity-80">{label}</span>
      <Icon className="h-4 w-4 opacity-70" />
    </div>
    <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
  </div>
);

export const AgingCard = ({
  label, amount, count, tone = "default",
}: { label: string; amount: number; count: number; tone?: Tone }) => (
  <div className={`rounded-lg border p-4 ${toneClasses[tone]}`}>
    <div className="text-[11px] uppercase tracking-wide opacity-80 mb-1.5">{label}</div>
    <div className="text-xl font-semibold tabular-nums">৳{amount.toLocaleString()}</div>
    <div className="text-xs opacity-70 mt-0.5">{count} order{count === 1 ? "" : "s"}</div>
  </div>
);
