import { Link } from "react-router-dom";
import { ArrowRight, AlertCircle, Clock, Truck, CreditCard, RefreshCw } from "lucide-react";

interface QueueItem {
  label: string;
  count: number;
  href: string;
  icon: typeof AlertCircle;
  tone: "warning" | "danger" | "info" | "neutral";
}

const toneClasses: Record<QueueItem["tone"], { bg: string; border: string; iconBg: string; icon: string }> = {
  danger: { bg: "bg-destructive/5", border: "border-destructive/30", iconBg: "bg-destructive/10", icon: "text-destructive" },
  warning: { bg: "bg-amber-500/5", border: "border-amber-500/30", iconBg: "bg-amber-500/10", icon: "text-amber-400" },
  info: { bg: "bg-primary/5", border: "border-primary/30", iconBg: "bg-primary/10", icon: "text-primary" },
  neutral: { bg: "bg-card", border: "border-border", iconBg: "bg-secondary", icon: "text-muted-foreground" },
};

interface Props {
  pendingOrders: number;
  processingOrders: number;
  shippedOrders: number;
  unpaidOrders: number;
  failedDispatch: number;
}

const ActionQueue = ({ pendingOrders, processingOrders, shippedOrders, unpaidOrders, failedDispatch }: Props) => {
  const items: QueueItem[] = [
    { label: "Pending", count: pendingOrders, href: "/orders?status=pending", icon: Clock, tone: pendingOrders > 5 ? "warning" : "neutral" },
    { label: "Ready to Dispatch", count: processingOrders, href: "/dispatch", icon: Truck, tone: processingOrders > 0 ? "info" : "neutral" },
    { label: "In Transit", count: shippedOrders, href: "/orders?status=shipped", icon: RefreshCw, tone: "neutral" },
    { label: "Unpaid", count: unpaidOrders, href: "/orders?payment=unpaid", icon: CreditCard, tone: unpaidOrders > 0 ? "warning" : "neutral" },
    { label: "Dispatch Failed", count: failedDispatch, href: "/orders?status=failed", icon: AlertCircle, tone: failedDispatch > 0 ? "danger" : "neutral" },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="font-heading text-sm font-medium text-card-foreground mb-4">Action Queue</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {items.map((item) => {
          const tone = toneClasses[item.tone];
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.href}
              className={`group rounded-md border ${tone.border} ${tone.bg} p-3 transition hover:border-primary/50`}
            >
              <div className="flex items-center justify-between">
                <div className={`flex h-7 w-7 items-center justify-center rounded-md ${tone.iconBg}`}>
                  <Icon className={`h-3.5 w-3.5 ${tone.icon}`} />
                </div>
                <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
              </div>
              <p className="mt-2 font-heading text-xl font-semibold text-foreground tabular-nums">{item.count}</p>
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default ActionQueue;
