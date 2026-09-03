import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// How many queue rows one claim will take.
const BATCH_SIZE = 50;

// Full-queue drain: keep claiming batches until the queue is empty, the safety
// cap is hit, or the time budget runs out. The GitHub Actions scheduler is
// throttled to ~4.5h on this repo, so one invocation must do real work —
// 20 rows per 4.5 hours (~100/day) left a 900-row backlog and days of latency.
const MAX_BATCHES = 20;          // 20 x 50 = up to 1000 rows per invocation
const TIME_BUDGET_MS = 240_000;  // stay under the 300s curl --max-time

// Phase 3: how many orders we push to WooCommerce concurrently (worker pool).
// Bounded so 50 parallel dispatcher runs don't open unbounded HTTP sockets.
// NOTE: 10 concurrent woo-push invokes sustained over the full-drain loop
// tripped Supabase's own Edge Functions rate limit ("Rate limit exceeded for
// trace ...", ~46s retry-after). 3 keeps a full drain comfortably under the
// platform throttle while still ~3x serial.
const CONCURRENCY = 3;

// Inter-batch pause: gives the platform's invocation limiter breathing room
// between claims during a full-queue drain.
const INTER_BATCH_PAUSE_MS = 500;

// Rate-limit penalty: when the platform returns "Rate limit exceeded", pause
// the drain briefly instead of hammering through the next batch immediately.
const RATE_LIMIT_PAUSE_MS = 10_000;

// Give up retrying a row after this many attempts and dead-letter it.
const MAX_ATTEMPTS = 5;

// A row still in "processing" after this long belongs to a run that never
// finished. Must comfortably exceed a real batch: each push_order is an HTTP
// round-trip to the store's WooCommerce site, so a full batch can take minutes.
const STALE_PROCESSING_MS = 15 * 60 * 1000;

// Terminal state for rows that exhausted MAX_ATTEMPTS. Kept distinct from
// "failed" (which is retryable) so a permanently broken push is visible at a
// glance in the table rather than hiding among rows still awaiting a retry.
const DEAD_LETTER_STATUS = "dead_letter";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Auth (revamp 1.3): the drain loop is a system maintenance action that can
    // flip queue rows to dead_letter — it must not be anon-triggerable (the anon
    // key is public in the frontend bundle). Accept any of:
    //   - service-role bearer (used by other edge functions),
    //   - x-cron-secret matching vault token `sync_worker_cron_token`
    //     (GitHub Actions / Cloudflare Worker cron),
    //   - a valid authenticated user JWT (frontend kickSyncWorker — the
    //     instant-drain path from A.6; claim SKIP LOCKED makes concurrent
    //     drains safe, so a user kick is harmless).
    {
      const auth = req.headers.get("authorization") || "";
      const provided = req.headers.get("x-cron-secret") || "";
      const isService = serviceKey && auth === `Bearer ${serviceKey}`;
      let allowed = isService;
      if (!allowed && provided) {
        const { data: token } = await sb.rpc("get_sync_worker_cron_token");
        if (token && provided === token) allowed = true;
      }
      if (!allowed && auth.startsWith("Bearer ")) {
        const { data: { user } } = await sb.auth.getUser(auth.replace("Bearer ", ""));
        allowed = !!user;
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Recover rows orphaned by an earlier run that died mid-flight.
    //
    // A row is flipped to "processing" *before* its push is attempted, so if this
    // function times out or crashes part-way through a batch, that row is
    // stranded: the fetch below only selects pending/failed, and nothing else
    // ever resets it. Anything that has sat in "processing" for longer than a
    // plausible run is therefore stuck, not active.
    //
    // Orphans go back to "failed" with attempts incremented rather than straight
    // to "pending", so a row that reliably kills the worker still dead-letters
    // after MAX_ATTEMPTS instead of looping forever.
    const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
    // Atomic per-row recovery RPC (attempts incremented per row — a bulk
    // client-side update would apply one row's count to the whole set).
    const { data: recoveredCount, error: orphanErr } = await sb.rpc(
      "recover_orphaned_sync_rows",
      { p_stale_before: staleCutoff },
    );

    if (orphanErr) {
      // A failed sweep must not stop the batch below from running.
      console.warn(`[sync-worker] orphan sweep failed: ${orphanErr.message}`);
    } else if (recoveredCount && recoveredCount > 0) {
      console.warn(`[sync-worker] recovering ${recoveredCount} orphaned row(s)`);
    }

    // Retention sweep (audit + performance): completed rows older than 7
    // days and dead_letter older than 30 days are purged. Without this the
    // claim query scans an ever-growing dead mass — and the old per-status
    // idempotency keys were exactly what silently blocked legitimate
    // re-pushes (Issue 2). Best-effort: a failure here never stops the drain.
    try {
      const completedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const deadCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error: purgeCompletedErr } = await sb
        .from("sync_queue")
        .delete()
        .eq("status", "completed")
        .lt("updated_at", completedCutoff);
      const { error: purgeDeadErr } = await sb
        .from("sync_queue")
        .delete()
        .eq("status", "dead_letter")
        .lt("updated_at", deadCutoff);
      if (purgeCompletedErr) console.warn(`[sync-worker] completed purge failed: ${purgeCompletedErr.message}`);
      if (purgeDeadErr) console.warn(`[sync-worker] dead_letter purge failed: ${purgeDeadErr.message}`);
      // 1.6: webhook delivery audit grows forever otherwise; delivery dedup
      // only cares about recent events (Woo retries within minutes).
      const { error: purgeWebhookErr } = await sb
        .from("webhook_events")
        .delete()
        .lt("created_at", deadCutoff);
      if (purgeWebhookErr) console.warn(`[sync-worker] webhook_events purge failed: ${purgeWebhookErr.message}`);
    } catch (e: any) {
      console.warn(`[sync-worker] retention sweep error: ${e?.message || e}`);
    }

    const processed: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    const startedAt = Date.now();
    let batchesDone = 0;
    let claimedTotal = 0;
    let rateLimited = 0;

    // Bounded-concurrency map: drive up to CONCURRENCY pushes to WooCommerce in
    // parallel instead of one-at-a-time (Phase 3 worker pool). Promise.allSettled
    // means one row's failure never aborts the others.
    async function pMap<T, R>(
      items: T[],
      limit: number,
      fn: (item: T) => Promise<R>
    ): Promise<R[]> {
      const results: R[] = new Array(items.length);
      let next = 0;
      async function worker() {
        while (next < items.length) {
          const idx = next++;
          results[idx] = await fn(items[idx]);
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
      return results;
    }

    // Full-queue drain loop: claim -> process -> claim again, until empty or
    // the safety cap / time budget hits. The orphan-recovery cutoff (15 min)
    // can't accidentally reap the current run's "processing" rows because each
    // claim refreshes updated_at, and the whole loop stays well under 4 min.
    while (batchesDone < MAX_BATCHES && Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data: queueItems, error: fetchErr } = await sb.rpc(
        "claim_sync_queue_batch",
        { p_limit: BATCH_SIZE },
      );
      if (fetchErr) throw fetchErr;
      if (!queueItems || queueItems.length === 0) break;
      claimedTotal += queueItems.length;
      batchesDone++;

      await pMap(queueItems, CONCURRENCY, async (item: any) => {
        try {
          // Rows are already "processing" (set atomically by the claim RPC). The
          // orphan sweep relies on updated_at to tell a stuck row from an in-flight
          // one, so the claim's updated_at write is what marks in-flight work.

          if (item.action === "push_order" || item.action === "push_stock") {
            // Invoke woo-push function. push_stock rows carry product_id in
            // payload (they may have no order); push_order rows pass the queue's
            // order_id plus payload (which may carry include_items for item edits).
            const res = await fetch(`${supabaseUrl}/functions/v1/woo-push`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ action: item.action, order_id: item.order_id, ...item.payload }),
            });

            if (!res.ok) {
              const text = await res.text();
              throw new Error(`woo-push responded ${res.status}: ${text}`);
            }
          } else {
            // Never report work done that was never attempted. An unrecognised
            // action used to fall straight through to the "completed" update
            // below, silently discarding the task. Routing it through the failure
            // path instead means it retries, then dead-letters with a timeline note.
            throw new Error(`unsupported queue action: ${item.action}`);
          }

          // On success, mark completed
          await sb.from("sync_queue")
            .update({ status: "completed", error_log: null, updated_at: new Date().toISOString() })
            .eq("id", item.id);
          processed.push(item.id);
          return { ok: true, id: item.id };

        } catch (err: any) {
          const errMsg = String(err?.message || err);
          const isRateLimit = errMsg.includes("Rate limit exceeded") || errMsg.includes("rate limit");

          if (isRateLimit) {
            // Platform throttle (Supabase Edge Functions), not a data failure:
            // return the row to pending WITHOUT burning an attempt — otherwise
            // a single throttled drain dead-letters 700+ healthy rows.
            await sb.from("sync_queue").update({
              status: "pending",
              next_retry_at: new Date(Date.now() + RATE_LIMIT_PAUSE_MS).toISOString(),
              error_log: "edge function rate limit — requeued without attempt",
              updated_at: new Date().toISOString(),
            }).eq("id", item.id);
            rateLimited++;
            return { ok: false, id: item.id, error: "rate limited (requeued)" };
          }

          // Handle failure
          const attempts = item.attempts + 1;
          let nextStatus = "failed";
          let nextRetry: Date | null = null;

          // Exponential backoff while attempts remain: 15m, 45m, 135m, 405m.
          if (attempts < MAX_ATTEMPTS) {
            nextRetry = new Date();
            const backoffMinutes = Math.pow(3, attempts) * 5;
            nextRetry.setMinutes(nextRetry.getMinutes() + backoffMinutes);
          } else {
            // Dead letter, do not retry further
            nextStatus = DEAD_LETTER_STATUS;
            if (item.order_id) {
              await sb.from("order_timeline").insert({
                order_id: item.order_id,
                event: "sync_failed",
                description: `Permanent failure syncing to WooCommerce after ${MAX_ATTEMPTS} attempts.`,
                metadata: { error: err.message }
              });
            }
          }

          await sb.from("sync_queue").update({
            status: nextStatus,
            attempts: attempts,
            next_retry_at: nextRetry ? nextRetry.toISOString() : null,
            error_log: err.message,
            updated_at: new Date().toISOString()
          }).eq("id", item.id);

          failed.push({ id: item.id, error: err.message });
          return { ok: false, id: item.id, error: err.message };
        }
      });
      // Inter-batch pause: keeps the drain under the platform invocation
      // limiter (see CONCURRENCY note).
      await new Promise(r => setTimeout(r, INTER_BATCH_PAUSE_MS));

      // If most of this batch was platform-throttled, stop hammering: back off
      // for this invocation and let the retry (with its 10s next_retry_at) or
      // the cron pick the rest up. Continuing while throttled wastes the batch.
      const batchFailed = queueItems.length;
      if (rateLimited > 0 && rateLimited >= batchFailed * 0.5) {
        console.warn(`[sync-worker] throttled by platform (${rateLimited} requeued) — ending this drain`);
        break;
      }
    }

    if (claimedTotal === 0) {
      return new Response(JSON.stringify({ message: "No items to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      processed,
      failed,
      claimed: claimedTotal,
      batches: batchesDone,
      rate_limited_requeued: rateLimited,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
