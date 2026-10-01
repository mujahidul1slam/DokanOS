import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  corsHeaders,
  getClientIp,
  getUserAgent,
  canonicalEmail,
  isSignupOpen,
  checkRateLimit,
} from "../_shared/signup-utils.ts";

const GENERIC_RESPONSE = {
  message: "If an unconfirmed account exists, a confirmation email has been sent.",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const clientIp = getClientIp(req);
    const userAgent = getUserAgent(req);

    // Runtime kill switch
    const open = await isSignupOpen(sb);
    if (!open) {
      return new Response(
        JSON.stringify({
          error: "SIGNUP_CLOSED",
          message: "Sign up is currently closed.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawEmail = body?.email ? String(body.email).trim() : "";
    const captchaToken = body?.captchaToken ? String(body.captchaToken) : undefined;

    if (!rawEmail || !rawEmail.includes("@")) {
      return new Response(JSON.stringify(GENERIC_RESPONSE), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const canonical = canonicalEmail(rawEmail);

    // Throttles: <= 20/h/IP + <= 3/h/email
    const ipLimit = await checkRateLimit(sb, `resend_ip:${clientIp}`, 20, "hour");
    const emailLimit = await checkRateLimit(sb, `resend_email:${canonical}`, 3, "hour");

    if (!ipLimit.allowed || !emailLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: "RATE_LIMITED",
          message: "Too many resend attempts. Please wait a while before trying again.",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Lookup via get_auth_signup_state RPC
    const { data: users, error: lookupErr } = await sb.rpc("get_auth_signup_state", {
      p_email: rawEmail,
    });

    if (lookupErr || !users) {
      console.error("get_auth_signup_state error:", lookupErr);
      return new Response(JSON.stringify(GENERIC_RESPONSE), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ambiguity rule: multiple canonical matches with no exact match -> generic reject + blocked audit
    if (users.length > 1) {
      await sb.from("signup_events").insert({
        event: "blocked",
        email: canonical,
        ip: clientIp,
        ua: userAgent,
        meta: { reason: "ambiguous_canonical_matches", count: users.length },
      });
      return new Response(JSON.stringify(GENERIC_RESPONSE), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (users.length === 1) {
      const u = users[0];
      // Only proceed if unconfirmed and NOT invited
      if (!u.email_confirmed_at && !u.invited_at) {
        // Dispatch to stored email (never alias)
        const { error: resendErr } = await sb.auth.resend({
          type: "signup",
          email: u.email,
          options: { captchaToken },
        });

        // TOCTOU check: re-verify email is still unconfirmed before auditing
        const { data: recheck } = await sb.rpc("get_auth_signup_state", { p_email: rawEmail });
        if (recheck && recheck[0] && !recheck[0].email_confirmed_at && !resendErr) {
          await sb.from("signup_events").insert({
            event: "resend",
            email: canonical,
            user_id: u.id,
            ip: clientIp,
            ua: userAgent,
            meta: {},
          });
        }
      }
    }

    return new Response(JSON.stringify(GENERIC_RESPONSE), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("auth-resend error:", err);
    return new Response(JSON.stringify(GENERIC_RESPONSE), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
