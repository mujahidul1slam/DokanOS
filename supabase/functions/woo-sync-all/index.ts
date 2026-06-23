import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth: require CRON_SECRET unless called with the service role key.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-cron-secret");
    const auth = req.headers.get("authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isService = serviceKey && auth === `Bearer ${serviceKey}`;
    if (!isService && (!cronSecret || provided !== cronSecret)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(SUPABASE_URL, serviceKey);

    const { data: stores, error } = await supabase
      .from("stores")
      .select("id, name, status")
      .eq("status", "connected");

    if (error) throw error;

    const results: { store_id: string; name: string; ok: boolean; error?: string }[] = [];

    for (const s of stores || []) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/woo-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ store_id: s.id, sync_customers: false }),
        });
        const ok = res.ok;
        const text = ok ? "" : await res.text();
        results.push({ store_id: s.id, name: s.name, ok, error: ok ? undefined : text.slice(0, 200) });
        console.log(`[woo-sync-all] triggered ${s.name} (${s.id}) -> ${res.status}`);
      } catch (e: any) {
        results.push({ store_id: s.id, name: s.name, ok: false, error: e?.message || String(e) });
        console.error(`[woo-sync-all] failed ${s.name}:`, e?.message || e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, triggered: results.length, results }),
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
