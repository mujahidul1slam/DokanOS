import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, PackageCheck, Truck, Send, CheckCircle2, ArrowRight } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";

interface OrderLite {
  id: string;
  order_number: string;
  total: number;
  status: string;
  customer_name: string | null;
  consignment_id: string | null;
  created_at: string;
}

interface Stage {
  key: string;
  label: string;
  match: (o: OrderLite) => boolean;
  icon: typeof Clock;
  accent: string; // tailwind text color
  ring: string; // tailwind ring/border color
  glow: string; // tailwind bg tint
  routeStatus: string;
}

const STAGES: Stage[] = [
  {
    key: "new",
    label: "New",
    match: (o) => o.status === "pending",
    icon: Clock,
    accent: "text-sky-400",
    ring: "border-sky-500/40",
    glow: "bg-sky-500/5",
    routeStatus: "pending",
  },
  {
    key: "processing",
    label: "Processing",
    match: (o) => o.status === "processing" && !o.consignment_id,
    icon: PackageCheck,
    accent: "text-amber-400",
    ring: "border-amber-500/40",
    glow: "bg-amber-500/5",
    routeStatus: "processing",
  },
  {
    key: "ready",
    label: "Ready to Dispatch",
    match: (o) => o.status === "processing" && !!o.consignment_id,
    icon: Send,
    accent: "text-violet-400",
    ring: "border-violet-500/40",
    glow: "bg-violet-500/5",
    routeStatus: "processing",
  },
  {
    key: "transit",
    label: "In Transit",
    match: (o) => o.status === "shipped",
    icon: Truck,
    accent: "text-blue-400",
    ring: "border-blue-500/40",
    glow: "bg-blue-500/5",
    routeStatus: "shipped",
  },
  {
    key: "delivered",
    label: "Delivered",
    match: (o) => o.status === "delivered",
    icon: CheckCircle2,
    accent: "text-emerald-400",
    ring: "border-emerald-500/40",
    glow: "bg-emerald-500/5",
    routeStatus: "delivered",
  },
];

interface Props {
  orders: OrderLite[];
}

export default function OrderPipeline({ orders }: Props) {
  const navigate = useNavigate();

  const buckets = useMemo(() => {
    return STAGES.map((s) => {
      const matched = orders.filter(s.match);
      const value = matched.reduce((sum, o) => sum + Number(o.total || 0), 0);
      // Pulse the freshest order in "new" column
      const recent = [...matched]
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        .slice(0, 4);
      return { stage: s, count: matched.length, value, recent };
    });
  }, [orders]);

  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-sm font-medium text-card-foreground">Live Order Pipeline</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Click any stage to filter orders</p>
        </div>
        <button
          onClick={() => navigate("/orders")}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          View all <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {buckets.map((b, i) => {
          const Icon = b.stage.icon;
          const heightPct = (b.count / max) * 100;
          const isNew = b.stage.key === "new";
          return (
            <div key={b.stage.key} className="relative">
              {/* Connector arrow between columns (desktop only) */}
              {i < buckets.length - 1 && (
                <div className="hidden lg:block absolute top-7 -right-2 z-10 text-muted-foreground/40">
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              )}
              <button
                onClick={() => navigate(`/orders?status=${b.stage.routeStatus}`)}
                className={`group w-full text-left rounded-lg border ${b.stage.ring} ${b.stage.glow} p-3 transition-all hover:scale-[1.02] hover:shadow-lg`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`rounded-md p-1.5 bg-background/40 ${b.stage.accent}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-medium text-foreground">{b.stage.label}</span>
                  </div>
                  {isNew && b.count > 0 && (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className={`text-2xl font-semibold ${b.stage.accent}`}>{b.count}</span>
                  <span className="text-[10px] text-muted-foreground">orders</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  ৳{b.value.toLocaleString()}
                </div>

                {/* Mini bar */}
                <div className="mt-2 h-1 w-full rounded-full bg-background/40 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${b.stage.accent.replace("text-", "bg-")}`}
                    style={{ width: `${heightPct}%` }}
                  />
                </div>

                {/* Mini order chips */}
                <div className="mt-3 space-y-1">
                  {b.recent.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/60 italic">Empty</p>
                  ) : (
                    b.recent.slice(0, 3).map((o) => (
                      <div
                        key={o.id}
                        className="flex items-center justify-between text-[10px] rounded bg-background/40 px-1.5 py-1"
                      >
                        <span className="truncate text-foreground/80 max-w-[80px]">
                          {o.order_number}
                        </span>
                        <span className="text-muted-foreground">
                          ৳{Number(o.total).toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                  {b.count > 3 && (
                    <p className="text-[10px] text-muted-foreground/70 text-center">
                      +{b.count - 3} more
                    </p>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Legend / summary */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground border-t border-border pt-3">
        <span>Total in flight: <span className="text-foreground font-medium">
          {buckets.slice(0, 4).reduce((s, b) => s + b.count, 0)}
        </span></span>
        <span>·</span>
        <span>Value in flight: <span className="text-foreground font-medium">
          ৳{buckets.slice(0, 4).reduce((s, b) => s + b.value, 0).toLocaleString()}
        </span></span>
        <span>·</span>
        <span>Delivered: <span className="text-emerald-400 font-medium">{buckets[4].count}</span></span>
      </div>
    </div>
  );
}
