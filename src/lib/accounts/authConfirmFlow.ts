/**
 * Post-confirmation routing (Task 3's gate), extracted from AuthConfirm so the
 * decision order is unit-testable and the login landing can share the owed
 * rule. AuthConfirm feeds these deps from the supabase client; tests feed fakes.
 *
 * Why this exists (live diagnosis 2026-11-01): the old gate trusted
 * `getSession().user.email_confirmed_at` after an emailed link, but the link's
 * `token_hash` was never explicitly exchanged and the cached session user can
 * lag behind the server — so verified people were dropped at "Sign in with your
 * verified email…" and, after signing in, nothing re-checked the setup gate.
 * The flow now establishes an AUTHORITATIVE verified user (explicit verifyOtp
 * for token-hash links, server-fresh getUser for client-exchanged URLs), and a
 * used/expired link falls back to an established session instead of dead-ending.
 */

/** The emailed link was rejected and nothing else establishes a user. */
export const INVALID_LINK_MESSAGE =
  "This confirmation link is invalid or expired. Sign in or request a new link.";
/** No verified user could be established at all. */
export const UNVERIFIED_MESSAGE =
  "Sign in with your verified email to continue. No business setup is required.";

export interface AuthUserLike {
  id: string;
  email_confirmed_at?: string | null;
}

export interface AuthConfirmDeps {
  /** Explicit exchange of an emailed link (`token_hash` + `type`). */
  verifyOtp(params: {
    type: string;
    token_hash: string;
  }): Promise<{ user: AuthUserLike | null; error: unknown }>;
  /** The auth client's current session (may lag behind a just-clicked link). */
  getSession(): Promise<{ user: AuthUserLike | null; error: unknown }>;
  /** Server-fresh user — the authoritative `email_confirmed_at`. */
  getUser(): Promise<{ user: AuthUserLike | null; error: unknown }>;
  /** Task 3 owed check (shared with the login gate; fail-soft = not owed). */
  isProfileSetupOwed(userId: string): Promise<boolean>;
  /** Lets the auth client finish its own URL exchange before re-reading. */
  settle(): Promise<void>;
}

export type AuthConfirmOutcome =
  | { kind: "reset-password" }
  | { kind: "profile-setup" }
  | { kind: "accounts" }
  | { kind: "message"; message: string };

export interface AuthConfirmUrl {
  search: URLSearchParams;
  hash: URLSearchParams;
  initialType: string | null;
}

const verified = (user: AuthUserLike | null | undefined): AuthUserLike | null =>
  user && user.email_confirmed_at ? user : null;

/**
 * Establishes the verified user for this callback. `linkRejected` reports that
 * the link's own exchange failed (used/expired token) so the caller can pick
 * the right message when no session rescues it.
 */
async function establishVerifiedUser(
  deps: AuthConfirmDeps,
  url: AuthConfirmUrl,
): Promise<{ user: AuthUserLike | null; linkRejected: boolean }> {
  const type = url.search.get("type") ?? url.hash.get("type");
  const tokenHash = url.search.get("token_hash") ?? url.hash.get("token_hash");
  let linkRejected = false;
  if (tokenHash && type) {
    const res = await deps.verifyOtp({ type, token_hash: tokenHash });
    const user = verified(res.user);
    if (user) return { user, linkRejected: false };
    // A used or expired token must not dead-end someone who already has a
    // confirmed session (a second click, or confirming on another device).
    linkRejected = true;
  }
  // No explicit exchange: the auth client consumes `code`/hash-token URLs
  // itself. Give it a beat, then prefer the server-fresh user over the cached
  // session user — that is the authoritative `email_confirmed_at`.
  let sessionUser: AuthUserLike | null = null;
  try {
    sessionUser = (await deps.getSession()).user ?? null;
  } catch {
    // fall through — getSession errors must not trap the person here
  }
  if (!sessionUser) {
    await deps.settle();
    try {
      sessionUser = (await deps.getSession()).user ?? null;
    } catch {
      // fall through
    }
  }
  let fresh: AuthUserLike | null = null;
  try {
    fresh = (await deps.getUser()).user ?? null;
  } catch {
    // fall through
  }
  const user = verified(fresh) ?? verified(sessionUser);
  return { user, linkRejected: user ? false : linkRejected };
}

/**
 * Decision order (preserving AuthConfirm's semantics):
 * 1. error params in the URL → invalid/expired message (no auth calls);
 * 2. establish the authoritative verified user (verifyOtp for token-hash
 *    links, session + getUser otherwise) — nothing established → message;
 * 3. recovery links → reset-password;
 * 4. Task 3 gate: owed → profile-setup, else → accounts.
 */
export async function resolveAuthConfirm(
  deps: AuthConfirmDeps,
  url: AuthConfirmUrl,
): Promise<AuthConfirmOutcome> {
  if (url.search.has("error") || url.hash.has("error")) {
    return { kind: "message", message: INVALID_LINK_MESSAGE };
  }
  const { user, linkRejected } = await establishVerifiedUser(deps, url);
  if (!user) {
    return { kind: "message", message: linkRejected ? INVALID_LINK_MESSAGE : UNVERIFIED_MESSAGE };
  }
  const recovery =
    url.search.get("type") === "recovery" ||
    url.hash.get("type") === "recovery" ||
    url.initialType === "recovery";
  if (recovery) return { kind: "reset-password" };
  const owed = await deps.isProfileSetupOwed(user.id);
  return owed ? { kind: "profile-setup" } : { kind: "accounts" };
}
