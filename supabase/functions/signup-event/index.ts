import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  corsHeaders,
  getClientIp,
  getUserAgent,
  canonicalEmail,
  isSignupOpen,
  checkRateLimit,
  verifyTurnstile,
} from "../_shared/signup-utils.ts";

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

    // Runtime kill-switch check
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

    // IP rate limit: <= 10/h/IP
    const ipLimit = await checkRateLimit(sb, `signup_event_ip:${clientIp}`, 10, "hour");
    if (!ipLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: "RATE_LIMITED",
          message: "Too many attempts from this IP. Please try again later.",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { event, email, meta, captchaToken } = body;

    if (event !== "signup_started" && event !== "email_confirmed") {
      return new Response(
        JSON.stringify({ error: "INVALID_EVENT", message: "Event must be signup_started or email_confirmed." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (event === "signup_started") {
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return new Response(
          JSON.stringify({ error: "INVALID_EMAIL", message: "Valid email is required." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const businessName = meta?.business_name?.trim();
      if (!businessName || businessName.length > 100) {
        return new Response(
          JSON.stringify({ error: "INVALID_NAME", message: "Business name must be 1 to 100 characters." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const nonce = meta?.nonce ? String(meta.nonce) : "";
      if (!nonce) {
        return new Response(
          JSON.stringify({ error: "INVALID_NONCE", message: "Nonce is required." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const canonical = canonicalEmail(email);

      // Email rate limit: <= 3/day/email
      const emailLimit = await checkRateLimit(sb, `signup_event_email:${canonical}`, 3, "day");
      if (!emailLimit.allowed) {
        return new Response(
          JSON.stringify({
            error: "RATE_LIMITED",
            message: "Too many signup attempts today. Please try again tomorrow.",
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify Turnstile t_event
      const captchaResult = await verifyTurnstile(captchaToken, clientIp);
      if (!captchaResult.success) {
        return new Response(
          JSON.stringify({
            error: "CAPTCHA_FAILED",
            message: "Captcha verification failed. Please refresh and try again.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Server-stamped versions from app_config
      const { data: configs } = await sb
        .from("app_config")
        .select("key, value")
        .in("key", ["tos_version", "privacy_version"]);

      let tosVersion = "v1.0";
      let privacyVersion = "v1.0";
      configs?.forEach((c: { key: string; value: any }) => {
        if (c.key === "tos_version") tosVersion = typeof c.value === "string" ? c.value : String(c.value).replace(/"/g, "");
        if (c.key === "privacy_version") privacyVersion = typeof c.value === "string" ? c.value : String(c.value).replace(/"/g, "");
      });

      const { error: insErr } = await sb.from("signup_events").insert({
        email: canonical,
        event: "signup_started",
        ip: clientIp,
        ua: userAgent,
        meta: {
          business_name: businessName,
          nonce,
          tos_version: tosVersion,
          privacy_version: privacyVersion,
          consumed: false,
        },
      });

      if (insErr) {
        console.error("signup_started insert error:", insErr);
        return new Response(
          JSON.stringify({ error: "INTERNAL_ERROR", message: "Failed to record signup start." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event === "email_confirmed") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "UNAUTHORIZED", message: "Session required." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: { user }, error: userErr } = await sb.auth.getUser(token);

      if (userErr || !user) {
        return new Response(
          JSON.stringify({ error: "UNAUTHORIZED", message: "Invalid session." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!user.email_confirmed_at) {
        return new Response(
          JSON.stringify({ error: "EMAIL_NOT_CONFIRMED", message: "Email is not confirmed yet." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: insErr } = await sb.from("signup_events").insert({
        user_id: user.id,
        email: canonicalEmail(user.email || ""),
        event: "email_confirmed",
        ip: clientIp,
        ua: userAgent,
        meta: {},
      });

      if (insErr) {
        console.error("email_confirmed insert error:", insErr);
      }

      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "BAD_REQUEST" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("signup-event error:", err);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: err?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
