import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How many queue rows one invocation will attempt.
const BATCH_SIZE = 20;

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

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
    const { data: orphans, error: orphanErr } = await sb
      .from("sync_queue")
      .select("id, attempts")
      .eq("status", "processing")
      .lt("updated_at", staleCutoff);

    if (orphanErr) {
      // A failed sweep must not stop the batch below from running.
      console.warn(`[sync-worker] orphan sweep failed: ${orphanErr.message}`);
    } else if (orphans?.length) {
      console.warn(`[sync-worker] recovering ${orphans.length} orphaned row(s)`);
      for (const o of orphans) {
        await sb.from("sync_queue").update({
          status: "failed",
          attempts: o.attempts + 1,
          next_retry_at: new Date().toISOString(),
          error_log: "orphaned in 'processing' by a worker run that never finished",
          updated_at: new Date().toISOString(),
        }).eq("id", o.id);
      }
    }

    // Fetch up to BATCH_SIZE pending/failed tasks that are ready for retry
    const { data: queueItems, error: fetchErr } = await sb
      .from("sync_queue")
      .select("*")
      .in("status", ["pending", "failed"])
      .lte("next_retry_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) throw fetchErr;

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ message: "No items to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const processed = [];
    const failed = [];

    for (const item of queueItems) {
      try {
        // Mark as processing. updated_at is set explicitly because the orphan
        // sweep above uses it to tell a stuck row from an in-flight one.
        await sb.from("sync_queue")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", item.id);

        if (item.action === "push_order") {
          // Invoke woo-push function
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

      } catch (err: any) {
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
          await sb.from("order_timeline").insert({
            order_id: item.order_id,
            event: "sync_failed",
            description: `Permanent failure syncing to WooCommerce after ${MAX_ATTEMPTS} attempts.`,
            metadata: { error: err.message }
          });
        }

        await sb.from("sync_queue").update({ 
          status: nextStatus, 
          attempts: attempts,
          next_retry_at: nextRetry ? nextRetry.toISOString() : null,
          error_log: err.message,
          updated_at: new Date().toISOString()
        }).eq("id", item.id);
        
        failed.push({ id: item.id, error: err.message });
      }
    }

    return new Response(JSON.stringify({ processed, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
