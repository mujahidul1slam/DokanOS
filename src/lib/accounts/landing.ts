/**
 * Post-login landing decision (domain revamp Task 2, spec §5).
 *
 * The personal default business account controls post-login landing only.
 * This module is pure: the login and confirmation hops hand it the loaded
 * memberships and the saved default, and act on the result.
 */

export interface LandingMembership {
  id: string;
}

export type LandingDecision = { kind: "land"; businessId: string } | { kind: "stay" };

/** Router state marking a hop as the post-login arrival (not an ordinary visit). */
export const POST_LOGIN_STATE = { postLogin: true } as const;

export const isPostLoginState = (state: unknown): boolean =>
  typeof state === "object" && state !== null && (state as { postLogin?: unknown }).postLogin === true;

/** The saved default, only while the user still holds that membership. */
export const validDefaultBusinessId = (
  businesses: readonly LandingMembership[],
  defaultBusinessId: string | null | undefined,
): string | null => {
  if (!defaultBusinessId) return null;
  return businesses.some((business) => business.id === defaultBusinessId) ? defaultBusinessId : null;
};

/**
 * The business a saved default resolves to. A live default is itself. A default
 * that was set but is no longer available (the business was deleted, or the
 * membership was lost) falls back silently to the first remaining business
 * (spec §5). No default at all resolves to null, so the picker decides. Settings
 * and landing both read this, so the business shown is the one the next sign-in opens.
 */
export const shownDefaultBusinessId = (
  businesses: readonly LandingMembership[],
  defaultBusinessId: string | null | undefined,
): string | null => {
  const live = validDefaultBusinessId(businesses, defaultBusinessId);
  if (live) return live;
  if (defaultBusinessId && businesses.length > 0) return businesses[0].id;
  return null;
};

/**
 * Which default a profile save writes. An untouched default is left exactly as
 * stored (even when it is now dead), so an unrelated save never rewrites it.
 * Returns `undefined` to mean "do not include the column in the update".
 */
export const defaultToPersist = (input: {
  current: string;
  original: string | null | undefined;
}): string | null | undefined => {
  const changed = input.current !== (input.original ?? "");
  if (!changed) return undefined;
  return input.current || null;
};

/**
 * Decision table:
 * - an invitation in flight never auto-lands (the user must choose to accept);
 * - no memberships → stay (create or join screen);
 * - a live default, or a removed default with businesses left → land on the
 *   shown default (the first remaining business when the saved one is gone);
 * - exactly one membership and no default → land on it;
 * - several memberships and no default → stay (the user chooses).
 */
export function resolveLanding(input: {
  businesses: readonly LandingMembership[];
  defaultBusinessId: string | null | undefined;
  hasInvitation: boolean;
}): LandingDecision {
  const { businesses, defaultBusinessId, hasInvitation } = input;
  if (hasInvitation || businesses.length === 0) return { kind: "stay" };

  const target =
    shownDefaultBusinessId(businesses, defaultBusinessId) ??
    (businesses.length === 1 ? businesses[0].id : null);
  return target ? { kind: "land", businessId: target } : { kind: "stay" };
}
