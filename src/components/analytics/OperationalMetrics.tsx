import { Clock, Truck, RotateCcw, XCircle } from "lucide-react";

interface Props {
  avgDispatchHours: number;
  refundRate: number;
  refundAmount: number;
  cancellationRate: number;
  totalRefunds: number;
}

const OperationalMetrics = ({ avgDispatchHours, refundRate, refundAmount, cancellationRate, totalRefunds }: Props) => (
  <div className="rounded-lg border border-border bg-card p-5">
    <div className="mb-4">
      <h2 className="font-heading text-sm font-medium text-card-foreground">Operations</h2>
      <p className="text-xs text-muted-foreground mt-0.5">Speed, refunds, and cancellations</p>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Avg Dispatch</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">
          {avgDispatchHours > 0 ? `${avgDispatchHours.toFixed(1)}h` : "—"}
        </p>
        <p className="text-[10px] text-muted-foreground">Order → Pathao booking</p>
      </div>
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" /> Refund Rate</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">{refundRate.toFixed(1)}%</p>
        <p className="text-[10px] text-muted-foreground">{totalRefunds} returns · ৳{Math.round(refundAmount).toLocaleString()}</p>
      </div>
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> Cancel Rate</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">{cancellationRate.toFixed(1)}%</p>
      </div>
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Truck className="h-3.5 w-3.5" /> Net Sales</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">{(100 - refundRate - cancellationRate).toFixed(1)}%</p>
        <p className="text-[10px] text-muted-foreground">Successful order ratio</p>
      </div>
    </div>
  </div>
);

export default OperationalMetrics;
