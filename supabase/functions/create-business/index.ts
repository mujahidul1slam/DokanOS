import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  corsHeaders,
  getClientIp,
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

    // Runtime kill switch
    const open = await isSignupOpen(sb);
    if (!open) {
      return new Response(
        JSON.stringify({
          error: "SIGNUP_CLOSED",
          message: "Sign up and business creation are currently closed.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limits: <= 3/day/user + <= 10/day/IP
    const userLimit = await checkRateLimit(sb, `create_biz_user:${user.id}`, 3, "day");
    const ipLimit = await checkRateLimit(sb, `create_biz_ip:${clientIp}`, 10, "day");

    if (!userLimit.allowed || !ipLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: "RATE_LIMITED",
          message: "Daily business creation limit reached. Please try again tomorrow.",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const businessName = body?.business_name ? String(body.business_name).trim() : "";
    const captchaToken = body?.captchaToken ? String(body.captchaToken) : undefined;

    if (!businessName || businessName.length > 100) {
      return new Response(
        JSON.stringify({
          error: "INVALID_NAME",
          message: "Business name must be 1 to 100 characters.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Turnstile verify if token provided
    if (captchaToken) {
      const captchaRes = await verifyTurnstile(captchaToken, clientIp);
      if (!captchaRes.success) {
        return new Response(
          JSON.stringify({
            error: "CAPTCHA_FAILED",
            message: "Captcha verification failed. Please refresh and try again.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Call create_additional_business RPC via service role
    const { data, error } = await sb.rpc("create_additional_business", {
      p_user_id: user.id,
      p_business_name: businessName,
    });

    if (error) {
      const msg = error.message || "";
      console.error("create_additional_business error:", error);

      let status = 400;
      let errCode = "PROVISION_FAILED";

      if (msg.includes("PROVISION_NO_USER")) {
        status = 404;
        errCode = "PROVISION_NO_USER";
      } else if (msg.includes("PROVISION_UNCONFIRMED")) {
        status = 400;
        errCode = "PROVISION_UNCONFIRMED";
      } else if (msg.includes("PROVISION_NOT_MEMBER")) {
        status = 403;
        errCode = "PROVISION_NOT_MEMBER";
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
    console.error("create-business error:", err);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: err?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
