/**
 * Enumeration hygiene mapper per SIGNUP-PLAN §6.4.
 * Merges login credentials and unconfirmed email errors to prevent user discovery.
 * Maps captcha-rejection errors uniformly to "Refresh and try again".
 */
export function mapAuthError(error: any): string {
  if (!error) return "";
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
