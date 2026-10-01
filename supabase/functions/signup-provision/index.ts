import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  corsHeaders,
  getClientIp,
  isSignupOpen,
  checkRateLimit,
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

    // Verify caller session JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "UNAUTHORIZED", message: "Authorization header required." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userErr } = await sb.auth.getUser(token);

    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "UNAUTHORIZED", message: "Invalid or expired session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // IP rate limit: <= 5/h/IP
    const limit = await checkRateLimit(sb, `signup_provision_ip:${clientIp}`, 5, "hour");
    if (!limit.allowed) {
      return new Response(
        JSON.stringify({
          error: "RATE_LIMITED",
          message: "Too many provisioning attempts. Please try again later.",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const nonce = body?.nonce ? String(body.nonce) : "";

    // Call provision_owner_business RPC via service role
    const { data, error } = await sb.rpc("provision_owner_business", {
      p_user_id: user.id,
      p_nonce: nonce,
    });

    if (error) {
      const msg = error.message || "";
      console.error("provision_owner_business RPC error:", error);

      let status = 400;
      let errCode = "PROVISION_FAILED";

      if (msg.includes("PROVISION_NO_USER")) {
        status = 404;
        errCode = "PROVISION_NO_USER";
      } else if (msg.includes("PROVISION_UNCONFIRMED")) {
        status = 400;
        errCode = "PROVISION_UNCONFIRMED";
      } else if (msg.includes("PROVISION_EXPIRED")) {
        status = 410;
        errCode = "PROVISION_EXPIRED";
      } else if (msg.includes("PROVISION_BLOCKED_DOMAIN")) {
        status = 400;
        errCode = "PROVISION_BLOCKED_DOMAIN";
      } else if (msg.includes("PROVISION_NO_ANCHOR")) {
        status = 400;
        errCode = "PROVISION_NO_ANCHOR";
      } else if (msg.includes("PROVISION_CHANNEL")) {
        status = 400;
        errCode = "PROVISION_CHANNEL";
      } else if (msg.includes("PROVISION_INVALID_NAME")) {
        status = 400;
        errCode = "PROVISION_INVALID_NAME";
      } else if (msg.includes("PROVISION_RETRYABLE")) {
        status = 503;
        errCode = "PROVISION_RETRYABLE";
      } else {
        status = 500;
        errCode = "SERVER_ERROR";
      }

      return new Response(
        JSON.stringify({ error: errCode, message: msg }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("signup-provision error:", err);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: err?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
