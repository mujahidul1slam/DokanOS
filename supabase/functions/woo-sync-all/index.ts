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
      .select("id, name, status")
      .eq("status", "connected");
    if (error) throw error;

    // Phase 5: distributed fan-out. With hundreds of stores, sequentially awaiting
    // each woo-sync call would blow the Deno execution limit. Instead we fire every
    // call without blocking on the HTTP round-trip and let EdgeRuntime.waitUntil keep
    // the function alive until they all settle. Each store's sync runs independently.
    const triggers: Promise<{ name: string; id: string; status: number; error?: string }>[] = [];

    for (const s of stores || []) {
      triggers.push(
        fetch(`${SUPABASE_URL}/functions/v1/woo-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ store_id: s.id, sync_customers: false }),
        })
          .then((res) => {
            console.log(`[woo-sync-all] triggered ${s.name} (${s.id}) -> ${res.status}`);
            return { name: s.name, id: s.id, status: res.status };
          })
          .catch((e: any) => {
            console.error(`[woo-sync-all] failed ${s.name}:`, e?.message || e);
            return { name: s.name, id: s.id, status: 0, error: e?.message || String(e) };
          })
      );
    }

    // Keep the function alive until all fan-out calls resolve (Deno / Supabase
    // Edge Runtime supports waitUntil). If the runtime lacks it, fall back to await.
    const settled = (
      typeof (globalThis as any).EdgeRuntime?.waitUntil === "function"
        ? (globalThis as any).EdgeRuntime.waitUntil(Promise.allSettled(triggers))
        : await Promise.allSettled(triggers)
    );
    const triggered = triggers.length;
    const resultRows = settled instanceof Array
      ? settled.map((r: any) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) }))
      : [];

    return new Response(
      JSON.stringify({ success: true, triggered, results: resultRows }),
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
