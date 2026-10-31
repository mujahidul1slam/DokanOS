/**
 * Post-verification profile setup rules (domain revamp Task 3, spec §5/§6b).
 *
 * The setup step (photo, name, phone) appears once after email verification and
 * is skippable. These rules are pure: the page and the settings form call them,
 * and the database only stores what they accept.
 */

/** Largest avatar the setup and settings forms accept (2 MB). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Normalizes a Bangladeshi mobile number to the local `01XXXXXXXXX` form.
 * Same rule the order and POS forms already use (digits only, drop the 880
 * country prefix, add the leading zero to a bare 10-digit mobile), plus a check
 * that the result is a mobile number. Returns null for an empty value, since the
 * phone is optional. Throws for anything that is not a mobile number.
 */
export const normalizeProfilePhone = (raw?: string | null): string | null => {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  let digits = String(raw).replace(/\D/g, "");
  // Non-empty input with no digits (for example "abc") is an error, not "no phone".
  if (!digits) {
    throw new Error("Enter a valid Bangladeshi mobile number, for example 01711234567");
  }
  if (digits.startsWith("880") && digits.length >= 13) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;
  if (!/^01[3-9]\d{8}$/.test(digits)) {
    throw new Error("Enter a valid Bangladeshi mobile number, for example 01711234567");
  }
  return digits;
};

/**
 * Setup is owed while the person has never completed or skipped it. A missing
 * profile row also owes it, so the step is never skipped by a gap in the data.
 */
export const profileSetupOwed = (
  profile: { profile_setup_completed_at: string | null } | null | undefined,
): boolean => {
  if (!profile) return true;
  return profile.profile_setup_completed_at === null;
};

/** The first problem with an avatar file, or null when it is acceptable. */
export const validateAvatarFile = (file: { type: string; size: number }): string | null => {
  if (!file.type.startsWith("image/")) return "Please upload an image file";
  if (file.size > AVATAR_MAX_BYTES) return "Image must be under 2MB";
  return null;
};
