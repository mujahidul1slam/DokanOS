import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { hasStoreScope, useActiveBusinessStoreIds } from "@/hooks/useActiveBusinessStoreIds";
import { useStoresList } from "@/hooks/useStoresList";

interface SyncHealthRow {
  queue_pending: number;
  queue_processing: number;
  queue_failed: number;
  queue_dead_letter: number;
  oldest_pending_seconds: number | null;
  pending_waiting_retry: number;
  stores_breaker_tripped: number;
  breaker_detail: Array<{ name: string; until: string }> | null;
  stores_sync: Array<{
    name: string;
    status: string;
    last_synced_at: string | null;
    sync_age_minutes: number | null;
  }> | null;
  courier_tracking: Record<
    string,
    { active: number; stalest_tracked_minutes: number | null }
  > | null;
  webhooks_last_hour: number;
  webhooks_failed_last_hour: number;
}

function fmtAge(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 129600) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * `sync_health` is a GLOBAL, deployment-wide table — verified, not assumed:
 * supabase/migrations/20260903000300_sync_health_view.sql defines it as ONE row
 * of aggregates over sync_queue, courier_shipments, webhook_events and stores,
 * and it exposes no store_id / business_id column (see the generated Row type in
 * src/integrations/supabase/types.ts). There is therefore no tenant predicate to
 * put on this read and no per-business variant of it to read instead: the sync
 * pipeline it reports on is shared by the whole deployment.
 *
 * What that means for tenancy, handled here rather than in the query:
 *   1. `stores_sync` and `breaker_detail` DO carry per-store identity, because
 *      the view aggregates over every store in the deployment. Both are
 *      intersected with the ACTIVE business's own stores below, so another
 *      business's storefront name never reaches this card (and a deployment-wide
 *      breaker trip is not reported as this business's store).
 *   2. The card still FAILS CLOSED: an active business with no mapped stores gets
 *      no read and no card at all, instead of the deployment's sync state.
 *
 * Making the view itself tenant-scoped is a database change (a new migration
 * over that SQL), not a UI change; until then this redaction is the boundary.
 */
export default function SyncHealthCard() {
  const [health, setHealth] = useState<SyncHealthRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const businessStoreIds = useActiveBusinessStoreIds();
  const scoped = hasStoreScope(businessStoreIds);
  /** The active business's own stores: the redaction allow-list for (1) above. */
  const stores = useStoresList();
  const scopedStoreNames = useMemo(() => new Set(stores.map((s) => s.name)), [stores]);

  useEffect(() => {
    if (!scoped) {
      // Fail closed: no read, and nothing from the previous business left behind.
      setHealth(null);
      return;
    }
    let alive = true;
    const load = async () => {
      const { data, error: err } = await supabase
        .from("sync_health")
        .select("*")
        .maybeSingle();
      if (!alive) return;
      if (err) setError(err.message);
      else {
        setError(null);
        setHealth((data || null) as SyncHealthRow | null);
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [scoped]);

  if (error) return null;
  if (!health) return null;

  // Redaction of the two per-store fields, and the breaker count recomputed from
  // the redacted list so this business is never credited with another's outage.
  const storesSync = (health.stores_sync || []).filter((s) => scopedStoreNames.has(s.name));
  const breakerDetail = (health.breaker_detail || []).filter((b) => scopedStoreNames.has(b.name));
  const breakerCount =
    health.breaker_detail === null ? health.stores_breaker_tripped : breakerDetail.length;

  const staleQueue = (health.oldest_pending_seconds ?? 0) > 30 * 60;
  const backlogged = health.queue_pending > 500;
  const breaker = breakerCount > 0;
  const dlq = health.queue_dead_letter > 0;
  const anyWarning = staleQueue || backlogged || breaker || dlq || health.queue_failed > 0;
  const stalestCourier = Math.max(
    ...Object.values(health.courier_tracking || {}).map((c) => c.stalest_tracked_minutes ?? 0),
    0,
  );
  const courierStale = stalestCourier > 60;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-sm font-medium text-card-foreground">
            Sync System Health
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Queue, couriers, and webhook pipelines
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            anyWarning
              ? "bg-amber-500/10 text-amber-600"
              : "bg-emerald-500/10 text-emerald-600"
          }`}
        >
          {anyWarning ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            <CheckCircle2 className="h-3 w-3" />
          )}
          {anyWarning ? "Attention" : "Healthy"}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" /> Queue pending
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {health.queue_pending}
            {health.pending_waiting_retry > 0 && (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                ({health.pending_waiting_retry} retry-wait)
              </span>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground">
            oldest {fmtAge(health.oldest_pending_seconds)}
          </p>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Activity className="h-3 w-3" /> Failures / DLQ
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {health.queue_failed}
            <span className="text-muted-foreground"> / </span>
            {health.queue_dead_letter}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {health.queue_processing} processing now
          </p>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" /> Store freshness
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {storesSync.length}
          </p>
          <p className="text-[10px] text-muted-foreground truncate">
            {breaker
              ? `${breakerCount} breaker(s) tripped`
              : "all breakers clear"}
          </p>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3" /> Courier tracking
          </div>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {Object.values(health.courier_tracking || {}).reduce((a, c) => a + c.active, 0)}
          </p>
          <p
            className={`text-[10px] ${courierStale ? "text-amber-600" : "text-muted-foreground"}`}
          >
            {stalestCourier > 0
              ? `stalest ${Math.round(stalestCourier)}m ago`
              : "no active shipments"}
          </p>
        </div>
      </div>

      {storesSync.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border/50 pt-3">
          {storesSync.map((s) => (
            <span
              key={s.name}
              className="inline-flex items-center gap-1 rounded-md bg-background/60 px-2 py-1 text-[10px] text-muted-foreground"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  s.status === "connected" ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              {s.name}
              {s.last_synced_at && (
                <>
                  {" · "}
                  {formatDistanceToNow(new Date(s.last_synced_at), { addSuffix: true })}
                </>
              )}
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground/70">
        Webhook deliveries (last hour): {health.webhooks_last_hour}
        {health.webhooks_failed_last_hour > 0 && (
          <span className="text-amber-600">
            {" "}
            · {health.webhooks_failed_last_hour} failed
          </span>
        )}
      </p>
    </div>
  );
}
