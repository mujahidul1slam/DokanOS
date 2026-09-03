import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(SUPABASE_URL, serviceKey);

    // Auth: service-role bearer, OR x-cron-secret matching a vault token.
    // Accepts both `woo_sync_cron_token` (legacy, used by the GitHub workflow
    // secret WOO_SYNC_CRON_TOKEN) and `sync_worker_cron_token` (revamp 1.3 —
    // lets schedulers like the Cloudflare Worker carry ONE secret for all
    // three scheduled functions).
    const auth = req.headers.get("authorization") || "";
    const provided = req.headers.get("x-cron-secret") || "";
    const isService = serviceKey && auth === `Bearer ${serviceKey}`;
    let allowed = isService;
    if (!allowed && provided) {
      const { data: legacyToken } = await supabase.rpc("get_woo_sync_cron_token");
      if (legacyToken && provided === legacyToken) allowed = true;
      if (!allowed) {
        const { data: newToken } = await supabase.rpc("get_sync_worker_cron_token");
        if (newToken && provided === newToken) allowed = true;
      }
    }
    if (!allowed) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: stores, error } = await supabase
      .from("stores")
      .select("id, name, status, last_synced_at")
      .eq("status", "connected");
    if (error) throw error;

    // Revamp 3.1: bounded fan-out. Firing every store at once (the old
    // unbounded Promise.all) trips Supabase's edge-invocation throttle at
    // ~30 sustained invokes per ~45s once there are dozens of stores, and the
    // throttled calls fail hard. Instead: worker pool with a cap, small
    // inter-chunk pause, per-call jitter, and retry on throttled invokes.
    //
    // Also skip stores synced very recently: the */15 cron + the frontend's
    // manual sync buttons can double-fire; a store synced <10 min ago is
    // already fresh (the 1.5 high-water-mark makes windows gapless).
    const SKIP_IF_SYNCED_WITHIN_MS = 10 * 60 * 1000;
    const FANOUT_CONCURRENCY = 50;
    const CHUNK_PAUSE_MS = 400;
    const JITTER_MS = 250;
    const THROTTLE_RETRIES = 2;

    const now = Date.now();
    const due = (stores || []).filter((s: { last_synced_at: string | null }) => {
      if (!s.last_synced_at) return true;
      return now - new Date(s.last_synced_at).getTime() > SKIP_IF_SYNCED_WITHIN_MS;
    });
    const skippedFresh = (stores || []).length - due.length;

    const results: Array<{ name: string; id: string; status: number; error?: string }> = [];

    async function triggerOne(s: { id: string; name: string }): Promise<void> {
      // Per-call jitter desynchronizes bursts so a chunk of N doesn't hit the
      // platform as one spike.
      if (JITTER_MS > 0) await new Promise((r) => setTimeout(r, Math.random() * JITTER_MS));

      for (let attempt = 0; attempt <= THROTTLE_RETRIES; attempt++) {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/woo-sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ store_id: s.id, sync_customers: false }),
          });
          if (res.status === 429 || res.status >= 500) {
            const retryAfter = Number(res.headers.get("retry-after"));
            const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 2000 * 2 ** attempt + Math.random() * 500;
            console.warn(`[woo-sync-all] ${s.name} -> ${res.status}; retry ${attempt + 1}/${THROTTLE_RETRIES} in ${Math.round(waitMs)}ms`);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          console.log(`[woo-sync-all] triggered ${s.name} (${s.id}) -> ${res.status}`);
          results.push({ name: s.name, id: s.id, status: res.status });
          return;
        } catch (e: unknown) {
          if (attempt === THROTTLE_RETRIES) {
            console.error(`[woo-sync-all] failed ${s.name}:`, (e as Error)?.message || e);
            results.push({ name: s.name, id: s.id, status: 0, error: (e as Error)?.message || String(e) });
            return;
          }
          await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        }
      }
      // Exhausted retries without a success entry above.
      results.push({ name: s.name, id: s.id, status: 0, error: "throttled after retries" });
    }

    // Worker pool: N in flight, shared cursor.
    let cursor = 0;
    const workers = Array.from({ length: Math.min(FANOUT_CONCURRENCY, due.length) }, async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const i = cursor++;
        if (i >= due.length) return;
        await triggerOne(due[i]);
      }
    });
    await Promise.all(workers);
    // Small pause between waves would apply for >FANOUT_CONCURRENCY stores;
    // with the pool above the pause is implicit via in-flight slots.

    const triggered = results.length;
    const failed = results.filter((r) => r.status < 200 || r.status >= 300);

    return new Response(
      JSON.stringify({
        success: true,
        triggered,
        skipped_fresh: skippedFresh,
        failed: failed.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("woo-sync-all error:", e?.message || e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
