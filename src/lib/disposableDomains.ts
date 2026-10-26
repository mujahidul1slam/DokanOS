/**
 * Build-time bundled snapshot of disposable email domains (Task 6.5).
 * Authoritative gate is enforced in Postgres (public.disposable_email_domains).
 * This snapshot provides instant client-side feedback.
 */
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "tempmail.com",
  "guerrillamail.com",
  "10minutemail.com",
  "throwawaymail.com",
  "yopmail.com",
  "sharklasers.com",
  "dispostable.com",
  "trashmail.com",
  "fakeinbox.com",
  "getairmail.com",
  "maildrop.cc",
  "temp-mail.org",
  "tempail.com",
  "mohmal.com",
  "crazymailing.com",
  "nada.ltd",
  "getnada.com",
  "inboxkitten.com",
  "burnermail.io",
]);

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

export function isDisposableEmail(email: string): boolean {
  if (!email || !email.includes("@")) return false;
  const canonical = canonicalEmail(email);
  const domain = canonical.split("@").pop()?.toLowerCase();
  return domain ? DISPOSABLE_EMAIL_DOMAINS.has(domain) : false;
}
