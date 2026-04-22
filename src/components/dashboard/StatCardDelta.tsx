import { LucideIcon, ArrowDown, ArrowUp, Minus } from "lucide-react";

interface StatCardDeltaProps {
  title: string;
  value: string;
  prevValue?: number;
  currentValue?: number;
  icon: LucideIcon;
  subtitle?: string;
  invertDelta?: boolean; // for metrics where lower is better
}

const StatCardDelta = ({
  title,
  value,
  prevValue,
  currentValue,
  icon: Icon,
  subtitle,
  invertDelta = false,
}: StatCardDeltaProps) => {
  let deltaPct: number | null = null;
  if (prevValue !== undefined && currentValue !== undefined) {
    if (prevValue === 0) {
      deltaPct = currentValue > 0 ? 100 : 0;
    } else {
      deltaPct = ((currentValue - prevValue) / Math.abs(prevValue)) * 100;
    }
  }

  const isUp = deltaPct !== null && deltaPct > 0;
  const isDown = deltaPct !== null && deltaPct < 0;
  const isFlat = deltaPct !== null && Math.abs(deltaPct) < 0.1;

  const positive = invertDelta ? isDown : isUp;
  const negative = invertDelta ? isUp : isDown;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 font-heading text-2xl font-semibold text-card-foreground">{value}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        {deltaPct !== null && !isFlat && (
          <span
            className={`inline-flex items-center gap-0.5 font-medium ${
              positive ? "text-success" : negative ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {isUp ? <ArrowUp className="h-3 w-3" /> : isDown ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        )}
        {subtitle && <span className="text-muted-foreground">{subtitle}</span>}
      </div>
    </div>
  );
};

export default StatCardDelta;
