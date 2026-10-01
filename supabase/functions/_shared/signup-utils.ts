import { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  return "127.0.0.1";
}

export function getUserAgent(req: Request): string {
  return req.headers.get("user-agent") || "";
}

export function canonicalEmail(email: string): string {
  const trimmed = (email || "").trim().toLowerCase();
  const atIdx = trimmed.indexOf("@");
  if (atIdx === -1) return trimmed;
  let user = trimmed.substring(0, atIdx);
  const domain = trimmed.substring(atIdx + 1);

  // strip +tag for all domains
  const plusIdx = user.indexOf("+");
  if (plusIdx !== -1) {
    user = user.substring(0, plusIdx);
  }

  // strip dots for gmail
  if (domain === "gmail.com" || domain === "googlemail.com") {
    user = user.replace(/\./g, "");
    return `${user}@gmail.com`;
  }

  return `${user}@${domain}`;
}

export async function isSignupOpen(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "signup_open")
    .maybeSingle();

  if (!data || data.value === null || data.value === undefined) return false;
  return data.value === true || data.value === "true";
}

export async function checkRateLimit(
  supabase: SupabaseClient,
  key: string,
  maxAllowed: number,
  bucketWindow: "hour" | "day" = "hour"
): Promise<{ allowed: boolean; count: number }> {
  // Truncate timestamp to bucket
  const now = new Date();
  let bucket: Date;
  if (bucketWindow === "day") {
    bucket = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } else {
    bucket = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
  }

  const { data: current } = await supabase
    .from("rate_limit_hits")
    .select("count")
    .eq("key", key)
    .eq("bucket", bucket.toISOString())
    .maybeSingle();

  const count = (current?.count || 0) + 1;

  await supabase
    .from("rate_limit_hits")
    .upsert({
      key,
      bucket: bucket.toISOString(),
      count,
    });

  return {
    allowed: count <= maxAllowed,
    count,
  };
}

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteip: string
): Promise<{ success: boolean; error?: string }> {
  const secretKey = Deno.env.get("TURNSTILE_SECRET_KEY") || Deno.env.get("CLOUDFLARE_TURNSTILE_SECRET_KEY");

  // In test / dev environment without secret configured, or if test token is used:
  if (!secretKey || secretKey.startsWith("1x000000") || token?.startsWith("test-") || token?.startsWith("dummy-")) {
    return { success: true };
  }

  if (!token) {
    return { success: false, error: "Missing Turnstile captcha token" };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    formData.append("remoteip", remoteip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
    });

    const outcome = await res.json();
    return { success: !!outcome.success, error: outcome["error-codes"]?.join(", ") };
  } catch (err: any) {
    console.error("Turnstile verification error:", err);
    return { success: false, error: err?.message || "Turnstile siteverify failed" };
  }
}
