/**
 * Enumeration hygiene mapper per SIGNUP-PLAN §6.4.
 * Merges login credentials and unconfirmed email errors to prevent user discovery.
 * Maps captcha-rejection errors uniformly to "Refresh and try again".
 */
export function mapAuthError(error: any): string {
  if (!error) return "An unexpected error occurred. Please try again.";
  const msg = (error.message || error.error_description || String(error)).toLowerCase();

  // Captcha rejection errors across all endpoints
  if (
    msg.includes("captcha") ||
    msg.includes("turnstile") ||
    msg.includes("challenge") ||
    msg.includes("bot")
  ) {
    return "Verification failed. Please refresh and try again.";
  }

  // Login enumeration hygiene: invalid credentials vs email not confirmed
  if (
    msg.includes("invalid login credentials") ||
    msg.includes("email not confirmed") ||
    msg.includes("invalid_credentials") ||
    msg.includes("email_not_confirmed") ||
    msg.includes("wrong password") ||
    msg.includes("user not found")
  ) {
    return "Invalid email or password.";
  }

  // Rate limit
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "Too many attempts. Please wait a while before trying again.";
  }

  // Default fallback: return clean generic or sanitized original
  return error.message || "An unexpected error occurred. Please try again.";
}

/**
 * Enumeration hygiene (SIGNUP-PLAN §6.4): does this signUp failure mean
 * "the account already exists"? Signup must treat that case exactly like a
 * fresh signup (same confirmation-waiting screen) so nobody can probe which
 * emails have accounts — see Signup.tsx.
 *
 * Shapes covered (probe of the local gotrue, 2026-11-01): the raw body
 * `{"code":422,"error_code":"user_already_exists","msg":"User already registered"}`
 * surfaces in supabase-js as `AuthApiError { code: "user_already_exists",
 * status: 422, message: "User already registered" }`. Other gotrue builds use
 * `email_exists` or message-only errors, so all three shapes are accepted.
 */
export function isExistingAccountError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; error_code?: unknown; message?: unknown };
  const code =
    typeof e.code === "string" ? e.code : typeof e.error_code === "string" ? e.error_code : "";
  if (code === "user_already_exists" || code === "email_exists") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return /already registered|already exists/i.test(msg);
}
