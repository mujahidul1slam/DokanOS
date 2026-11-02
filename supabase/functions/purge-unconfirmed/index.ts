import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/signup-utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    // Auth: accept valid CRON_SECRET or Service Role Bearer token
    const incomingSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization");

    const authorized =
      (cronSecret && incomingSecret === cronSecret) ||
      (authHeader && authHeader.replace(/^Bearer\s+/i, "") === serviceKey);

    if (!authorized) {
      return new Response(
        JSON.stringify({ error: "UNAUTHORIZED", message: "Invalid cron authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sb = createClient(supabaseUrl, serviceKey);

    // 1. Get candidates for purge: 26h unconfirmed self-signups + 30d expired invitees
    const { data: candidates, error: candErr } = await sb.rpc("get_purge_candidates");
    if (candErr) {
      console.error("get_purge_candidates error:", candErr);
      return new Response(
        JSON.stringify({ error: "PURGE_ERROR", message: candErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let purgedUnconfirmed = 0;
    let inviteesExpired = 0;

    for (const cand of (candidates || []) as { id: string; reason: string }[]) {
      try {
        const { error: delErr } = await sb.auth.admin.deleteUser(cand.id);
        if (!delErr) {
          const eventType =
            cand.reason === "unconfirmed_26h" ? "purged_unconfirmed" : "invitee_expired";

          // Audit record: email is NULL immediately at insert per §9 retention table
          await sb.from("signup_events").insert({
            event: eventType,
            user_id: null,
            email: null,
            meta: { original_reason: cand.reason },
          });

          if (cand.reason === "unconfirmed_26h") {
            purgedUnconfirmed++;
          } else {
            inviteesExpired++;
          }
        } else {
          console.error(`Failed to delete user ${cand.id}:`, delErr);
        }
      } catch (userErr) {
        console.error(`Error deleting user ${cand.id}:`, userErr);
      }
    }

    // 2. Data retention cleanup
    const { data: retentionStats, error: retErr } = await sb.rpc("run_data_retention_cleanup");
    if (retErr) {
      console.error("run_data_retention_cleanup error:", retErr);
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        purged_unconfirmed: purgedUnconfirmed,
        invitees_expired: inviteesExpired,
        retention_cleanup: retentionStats,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("purge-unconfirmed fatal error:", err);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: err?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
