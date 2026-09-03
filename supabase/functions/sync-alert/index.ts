// Revamp Phase 3.3: sync health alerting.
//
// Evaluates the sync_health view against thresholds and, when anything is
// wrong, POSTs a summary to the alert webhook URL stored in the Supabase
// vault as `sync_alert_webhook_url` (Slack-compatible payload shape).
// Called by the daily dead-man's-switch GitHub workflow (and manually).
//
// Rules (all must hold for "healthy"):
//   - oldest pending queue row < 30 minutes
//   - queue pending < 500
//   - no dead_letter rows
//   - no failed rows
//   - no stores with breaker currently tripped
//   - every connected store synced within 6 hours
//   - stalest active courier shipment tracked within 90 minutes
//   - webhook delivery failure rate < 50% in the last hour (with >=5 events)
//
// Vault setup (one-time):
//   SELECT vault.create_secret('https://hooks.slack.com/services/xxx',
//                             'sync_alert_webhook_url');

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface HealthRow {
  queue_pending: number;
  queue_failed: number;
  queue_dead_letter: number;
  oldest_pending_seconds: number | null;
  stores_breaker_tripped: number;
  breaker_detail: Array<{ name: string; until: string }> | null;
  stores_sync: Array<{ name: string; status: string; sync_age_minutes: number | null }> | null;
  courier_tracking: Record<string, { active: number; stalest_tracked_minutes: number | null }> | null;
  webhooks_last_hour: number;
  webhooks_failed_last_hour: number;
}

function fmtM(min: number | null | undefined): string {
  if (min == null) return "n/a";
  if (min < 1) return "<1m";
  if (min < 120) return `${Math.round(min)}m`;
  return `${(min / 60).toFixed(1)}h`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Auth: service-role bearer OR x-cron-secret (same token as sync-worker).
    {
      const auth = req.headers.get("authorization") || "";
      const provided = req.headers.get("x-cron-secret") || "";
      const isService = serviceKey && auth === `Bearer ${serviceKey}`;
      let allowed = isService;
      if (!allowed && provided) {
        const { data: token } = await sb.rpc("get_sync_worker_cron_token");
        if (token && provided === token) allowed = true;
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: healthRows, error: viewErr } = await sb
      .from("sync_health")
      .select("*")
      .limit(1);
    if (viewErr) throw viewErr;
    const health = (healthRows?.[0] || null) as HealthRow | null;
    if (!health) {
      return new Response(JSON.stringify({ error: "sync_health view returned no rows" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Evaluate rules -------------------------------------------------
    const problems: string[] = [];

    if ((health.oldest_pending_seconds ?? 0) > 30 * 60) {
      problems.push(
        `queue: oldest pending row is ${Math.round((health.oldest_pending_seconds ?? 0) / 60)}m old`,
      );
    }
    if (health.queue_pending > 500) {
      problems.push(`queue: ${health.queue_pending} rows pending (backlog)`);
    }
    if (health.queue_dead_letter > 0) {
      problems.push(`queue: ${health.queue_dead_letter} dead-letter rows`);
    }
    if (health.queue_failed > 0) {
      problems.push(`queue: ${health.queue_failed} failed rows awaiting retry`);
    }
    if (health.stores_breaker_tripped > 0) {
      const names = (health.breaker_detail || []).map((b) => b.name).join(", ");
      problems.push(`breaker: ${health.stores_breaker_tripped} tripped (${names})`);
    }
    const staleStores = (health.stores_sync || []).filter(
      (s) => s.status === "connected" && (s.sync_age_minutes ?? 0) > 6 * 60,
    );
    for (const s of staleStores) {
      problems.push(`store ${s.name}: last sync ${fmtM(s.sync_age_minutes)} ago`);
    }
    for (const [provider, t] of Object.entries(health.courier_tracking || {})) {
      if ((t.stalest_tracked_minutes ?? 0) > 90) {
        problems.push(
          `courier ${provider}: stalest active shipment tracked ${fmtM(t.stalest_tracked_minutes)} ago`,
        );
      }
    }
    if (health.webhooks_last_hour >= 5) {
      const rate = health.webhooks_failed_last_hour / health.webhooks_last_hour;
      if (rate >= 0.5) {
        problems.push(
          `webhooks: ${health.webhooks_failed_last_hour}/${health.webhooks_last_hour} deliveries failed in the last hour`,
        );
      }
    }

    const healthy = problems.length === 0;

    // ---- Deliver (only when unhealthy, or ?force=1) ----------------------
    const force = new URL(req.url).searchParams.get("force") === "1";
    let delivered: string | null = null;

    if (!healthy || force) {
      const { data: hookUrl } = await sb.rpc("get_sync_alert_webhook_url");
      if (hookUrl) {
        const payload = {
          text: healthy
            ? "✅ DokanOS sync health: OK (forced check)"
            : `🚨 DokanOS sync problems (${problems.length}):`,
          problems: problems.length > 0 ? problems : undefined,
          health: {
            queue_pending: health.queue_pending,
            queue_failed: health.queue_failed,
            queue_dead_letter: health.queue_dead_letter,
            oldest_pending: fmtM((health.oldest_pending_seconds ?? 0) / 60),
            stores: (health.stores_sync || []).map(
              (s) => `${s.name}=${s.status}/${fmtM(s.sync_age_minutes)}`,
            ),
            courier_tracking: health.courier_tracking,
          },
        };
        const res = await fetch(hookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        delivered = res.ok ? "ok" : `http ${res.status}`;
      }
    }

    return new Response(
      JSON.stringify({ healthy, problems, alerted: delivered }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error)?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
