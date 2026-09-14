import { supabase } from "@/integrations/supabase/client";

/**
 * W9: thin MFA wrappers + error parsing. No DB, no flags — enrollment is
 * client-side; enforcement (RLS/JWT amr) is a documented non-goal (§11.6).
 */

export interface ParsedMfaError {
  isMfa: boolean;
  factorId: string | null;
}

/**
 * Detect an mfa_required sign-in failure and extract the factor id.
 *
 * The GoTrue /token endpoint returns 400 with an mfa_required error for
 * MFA-enabled users; the factor list rides on the error body. supabase-js
 * surfaces `code: 'mfa_required'` on the AuthApiError — the exact placement
 * of the factor list varies by GoTrue version, so every plausible shape is
 * checked here and pinned by src/test/mfa.test.ts.
 */
export function parseMfaError(err: unknown): ParsedMfaError {
  if (!err || typeof err !== "object") return { isMfa: false, factorId: null };
  const e = err as {
    code?: string;
    message?: string;
    error_description?: string;
    factors?: { id?: string }[];
    mfa_factors?: { id?: string }[];
  };
  const isMfa =
    e.code === "mfa_required" ||
    e.message?.includes("mfa_required") ||
    e.error_description?.includes("mfa_required");
  if (!isMfa) return { isMfa: false, factorId: null };
  const factorId = e.factors?.[0]?.id ?? e.mfa_factors?.[0]?.id ?? null;
  return { isMfa: true, factorId };
}

/** The caller's current/next assurance level (null when not signed in). */
export async function getAal(): Promise<{ current: string | null; next: string | null }> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { current: data?.currentLevel ?? null, next: data?.nextLevel ?? null };
}

/** Verified TOTP factors for the signed-in user. */
export async function listVerifiedTotpFactors() {
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? []).filter((f) => f.status === "verified");
}

/** Enroll a TOTP factor; returns { factorId, secret } for QR/manual entry. */
export async function enrollTotp(friendlyName?: string) {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName,
  });
  if (error) throw error;
  if (!data) throw new Error("Enrollment returned no factor");
  return {
    factorId: data.id,
    secret: data.totp?.secret ?? "",
    uri: data.totp?.uri ?? "",
  };
}

/** Challenge + verify a code in one step (sign-in and re-auth flows). */
export async function challengeAndVerify(factorId: string, code: string) {
  const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
  if (error2(challengeErr)) throw challengeErr;
  if (!challenge) throw new Error("Challenge returned no id");
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (error) throw error;
}

function error2(e: unknown): boolean {
  return e != null;
}

/** Unenroll a factor (caller must have re-authenticated first). */
export async function unenrollFactor(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}