import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Store as StoreIcon, CheckCircle2, AlertCircle, ExternalLink, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface StoreRow {
  id: string;
  name: string;
  url: string | null;
  status: string | null;
  last_synced_at: string | null;
}

interface OrderLite {
  store_id: string | null;
  total: number;
  created_at: string;
}

interface Props {
  orders: { store_id?: string | null; total: number; created_at: string }[];
}

export default function StoreHealthGrid({ orders }: Props) {
  const navigate = useNavigate();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("stores")
        .select("id, name, url, status, last_synced_at")
        .order("name");
      setStores((data || []) as StoreRow[]);
      setLoading(false);
    })();
  }, []);

  const perStore = useMemo(() => {
    const map = new Map<string, { orders: number; revenue: number; series: number[] }>();
    // bucket by day for last 7 days
    const days = 7;
    const now = new Date();
    const dayKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    stores.forEach((s) => map.set(s.id, { orders: 0, revenue: 0, series: Array(days).fill(0) }));
    orders.forEach((o) => {
      if (!o.store_id) return;
      const e = map.get(o.store_id);
      if (!e) return;
      e.orders += 1;
      e.revenue += Number(o.total || 0);
      const key = new Date(o.created_at).toISOString().slice(0, 10);
      const idx = dayKeys.indexOf(key);
      if (idx >= 0) e.series[idx] += Number(o.total || 0);
    });
    return map;
  }, [stores, orders]);

  const healthOf = (s: StoreRow): { tone: string; label: string; dot: string } => {
    const status = (s.status || "").toLowerCase();
    if (status === "error" || status === "disconnected") {
      return { tone: "border-rose-500/40 bg-rose-500/5", label: "Error", dot: "bg-rose-500" };
    }
    if (!s.last_synced_at) {
      return { tone: "border-amber-500/40 bg-amber-500/5", label: "Never synced", dot: "bg-amber-500" };
    }
    const ageHrs = (Date.now() - new Date(s.last_synced_at).getTime()) / 3_600_000;
    if (ageHrs > 24) {
      return { tone: "border-amber-500/40 bg-amber-500/5", label: "Stale", dot: "bg-amber-500" };
    }
    return { tone: "border-emerald-500/40 bg-emerald-500/5", label: "Healthy", dot: "bg-emerald-500" };
  };

  if (loading) return null;
  if (stores.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-sm font-medium text-card-foreground">Store Health</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{stores.length} connected storefronts</p>
        </div>
        <button
          onClick={() => navigate("/stores")}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Manage stores
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {stores.map((s) => {
          const h = healthOf(s);
          const m = perStore.get(s.id) || { orders: 0, revenue: 0, series: [] as number[] };
          const max = Math.max(1, ...m.series);
          return (
            <div key={s.id} className={`rounded-lg border ${h.tone} p-3`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex items-center gap-2">
                  <div className="rounded-md bg-background/40 p-1.5">
                    <StoreIcon className="h-3.5 w-3.5 text-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{s.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {s.url?.replace(/^https?:\/\//, "") || "—"}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
                  <span className={`h-1.5 w-1.5 rounded-full ${h.dot} ${h.label === "Healthy" ? "animate-pulse" : ""}`} />
                  {h.label}
                </span>
              </div>

              {/* Sparkline */}
              <div className="mt-3 flex items-end gap-0.5 h-8">
                {m.series.map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm bg-primary/60"
                    style={{ height: `${(v / max) * 100}%`, minHeight: 2 }}
                  />
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px]">
                <div>
                  <span className="text-foreground font-medium">{m.orders}</span>
                  <span className="text-muted-foreground"> orders</span>
                </div>
                <div className="text-foreground font-medium">৳{m.revenue.toLocaleString()}</div>
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-border/50 pt-2">
                <span className="text-[10px] text-muted-foreground">
                  {s.last_synced_at
                    ? `Synced ${formatDistanceToNow(new Date(s.last_synced_at), { addSuffix: true })}`
                    : "No sync yet"}
                </span>
                <button
                  onClick={() => navigate(`/orders?store=${s.id}`)}
                  className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  Orders <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
