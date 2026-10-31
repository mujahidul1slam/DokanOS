import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_BYTES,
  normalizeProfilePhone,
  profileSetupOwed,
  validateAvatarFile,
} from "./profileSetup";

// Task 3 (spec §5/§6b): after email verification, a skippable "Set up your
// profile" step (photo, name, phone). These rules are pure; the page only acts on them.

describe("normalizeProfilePhone", () => {
  it("accepts a Bangladeshi mobile number in the local format", () => {
    expect(normalizeProfilePhone("01711234567")).toBe("01711234567");
  });

  it("strips spaces, dashes, and the +880 country prefix to the local format", () => {
    expect(normalizeProfilePhone("+880 1711-234567")).toBe("01711234567");
    expect(normalizeProfilePhone("8801711234567")).toBe("01711234567");
  });

  it("adds the leading zero when a 10-digit mobile number is typed without it", () => {
    expect(normalizeProfilePhone("1711234567")).toBe("01711234567");
  });

  it("treats an empty value as no phone, so the field stays optional", () => {
    expect(normalizeProfilePhone("")).toBeNull();
    expect(normalizeProfilePhone("   ")).toBeNull();
    expect(normalizeProfilePhone(undefined)).toBeNull();
  });

  it("rejects numbers that are not Bangladeshi mobile numbers", () => {
    expect(() => normalizeProfilePhone("12345")).toThrow();
    expect(() => normalizeProfilePhone("0271234567")).toThrow();
    expect(() => normalizeProfilePhone("017112345678")).toThrow();
    expect(() => normalizeProfilePhone("abc")).toThrow();
  });
});

describe("profileSetupOwed", () => {
  it("is owed right after verification while the setup has never been completed or skipped", () => {
    expect(profileSetupOwed({ profile_setup_completed_at: null })).toBe(true);
  });

  it("is not owed once it was completed or skipped", () => {
    expect(profileSetupOwed({ profile_setup_completed_at: "2026-10-30T14:00:00Z" })).toBe(false);
  });

  it("is owed when no profile row exists yet, so a new account still gets the step", () => {
    expect(profileSetupOwed(null)).toBe(true);
    expect(profileSetupOwed(undefined)).toBe(true);
  });
});

describe("validateAvatarFile", () => {
  it("accepts an image up to the 2 MB limit", () => {
    expect(validateAvatarFile({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateAvatarFile({ type: "image/jpeg", size: AVATAR_MAX_BYTES })).toBeNull();
  });

  it("rejects a non-image file", () => {
    expect(validateAvatarFile({ type: "application/pdf", size: 1024 })).toMatch(/image/i);
  });

  it("rejects an image over 2 MB", () => {
    expect(validateAvatarFile({ type: "image/png", size: AVATAR_MAX_BYTES + 1 })).toMatch(/2MB/);
  });
});
