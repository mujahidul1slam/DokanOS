import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, Send, Zap, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface OrderLite {
  id: string;
  order_number: string;
  total: number;
  status: string;
  consignment_id: string | null;
  customer_name: string | null;
  created_at: string;
}

interface Props {
  orders: OrderLite[];
}

export default function CourierDispatchStation({ orders }: Props) {
  const navigate = useNavigate();

  const { ready, inTransit, todayDispatched } = useMemo(() => {
    const ready = orders.filter((o) => o.status === "processing" && !o.consignment_id);
    const inTransit = orders.filter((o) => o.status === "shipped" && !!o.consignment_id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDispatched = orders.filter(
      (o) => !!o.consignment_id && new Date(o.created_at) >= today,
    );
    return { ready, inTransit, todayDispatched };
  }, [orders]);

  return (
    <div className="rounded-lg border border-border bg-gradient-to-br from-violet-500/5 to-blue-500/5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-violet-500/15 p-1.5">
            <Truck className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <h2 className="font-heading text-sm font-medium text-card-foreground">Courier Dispatch Station</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Pathao bulk dispatch & live tracking</p>
          </div>
        </div>
        <button
          onClick={() => navigate("/dispatch")}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-500 hover:bg-violet-600 text-white text-xs font-medium px-3 py-1.5 transition-colors"
        >
          <Zap className="h-3.5 w-3.5" />
          Open Dispatch
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Ready to ship</div>
          <div className="mt-1 text-2xl font-semibold text-amber-400">{ready.length}</div>
          <div className="text-[10px] text-muted-foreground">
            ৳{ready.reduce((s, o) => s + Number(o.total || 0), 0).toLocaleString()}
          </div>
        </div>
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">In transit</div>
          <div className="mt-1 text-2xl font-semibold text-blue-400">{inTransit.length}</div>
          <div className="text-[10px] text-muted-foreground">Live tracking</div>
        </div>
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Dispatched today</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-400">{todayDispatched.length}</div>
          <div className="text-[10px] text-muted-foreground">Since midnight</div>
        </div>
      </div>

      {/* Ready queue preview */}
      {ready.length > 0 ? (
        <div className="rounded-md border border-border bg-background/40 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background/60">
            <span className="text-xs font-medium text-foreground">
              Next up to dispatch ({ready.length})
            </span>
            <button
              onClick={() => navigate("/dispatch")}
              className="text-[11px] text-violet-400 hover:text-violet-300 inline-flex items-center gap-1"
            >
              Dispatch all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <ul className="divide-y divide-border">
            {ready.slice(0, 5).map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between px-3 py-2 hover:bg-background/40 cursor-pointer"
                onClick={() => navigate(`/orders?order=${o.id}`)}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <Send className="h-3 w-3 text-violet-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-foreground truncate">{o.order_number}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {o.customer_name || "Walk-in"} · {formatDistanceToNow(new Date(o.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-medium text-foreground">
                  ৳{Number(o.total).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-background/20 px-3 py-6 text-center">
          <p className="text-xs text-muted-foreground">No orders queued for dispatch</p>
        </div>
      )}
    </div>
  );
}
