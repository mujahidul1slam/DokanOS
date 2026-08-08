import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Fetch up to 20 pending/failed tasks that are ready for retry
    const { data: queueItems, error: fetchErr } = await sb
      .from("sync_queue")
      .select("*")
      .in("status", ["pending", "failed"])
      .lte("next_retry_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(20);

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
        // Mark as processing
        await sb.from("sync_queue").update({ status: "processing" }).eq("id", item.id);

        if (item.action === "push_order") {
          // Invoke woo-push function
          const res = await fetch(`${supabaseUrl}/functions/v1/woo-push`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify(item.payload),
          });
          
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`woo-push responded ${res.status}: ${text}`);
          }
        }

        // On success, mark completed
        await sb.from("sync_queue").update({ status: "completed", error_log: null }).eq("id", item.id);
        processed.push(item.id);

      } catch (err: any) {
        // Handle failure
        const attempts = item.attempts + 1;
        let nextStatus = "failed";
        let nextRetry: Date | null = null;
        
        // Exponential backoff up to 5 attempts (5m, 15m, 1h, 6h)
        if (attempts < 5) {
          nextRetry = new Date();
          const backoffMinutes = Math.pow(3, attempts) * 5; // 15m, 45m, 135m...
          nextRetry.setMinutes(nextRetry.getMinutes() + backoffMinutes);
        } else {
          // Dead letter, do not retry further
          // Optionally post a note to timeline
          await sb.from("order_timeline").insert({
            order_id: item.order_id,
            event: "sync_failed",
            description: `Permanent failure syncing to WooCommerce after 5 attempts.`,
            metadata: { error: err.message }
          });
        }

        await sb.from("sync_queue").update({ 
          status: nextStatus, 
          attempts: attempts,
          next_retry_at: nextRetry ? nextRetry.toISOString() : null,
          error_log: err.message
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
