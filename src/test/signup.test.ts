import { describe, it, expect } from "vitest";
import { slugify, generateStoreSlug } from "@/lib/slug";
import { canonicalEmail, isDisposableEmail } from "@/lib/disposableDomains";
import { mapAuthError } from "@/lib/authErrors";

describe("Signup Helper Utilities", () => {
  describe("slugify", () => {
    it("converts mixed case and spaces to hyphenated lowercase", () => {
      expect(slugify("My Awesome Store")).toBe("my-awesome-store");
    });

    it("strips special characters and leading/trailing dashes", () => {
      expect(slugify("---Shop & Co. #1!---")).toBe("shop-co-1");
    });

    it("truncates at 48 characters", () => {
      const longName = "a".repeat(60);
      const slug = slugify(longName);
      expect(slug.length).toBe(48);
      expect(slug).toBe("a".repeat(48));
    });

    it("returns empty string for pure symbols or spaces", () => {
      expect(slugify("   ")).toBe("");
      expect(slugify("!@#$%^&*()")).toBe("");
    });
  });

  describe("generateStoreSlug", () => {
    it("generates clean slug for regular business names", () => {
      expect(generateStoreSlug("Acme Supplies")).toBe("acme-supplies");
    });

    it("provides fallback with store- prefix for non-latin or symbol names", () => {
      const slug = generateStoreSlug("দোকান");
      expect(slug.startsWith("store-")).toBe(true);
      expect(slug.length).toBeGreaterThan(6);
    });

    it("provides fallback for empty input", () => {
      const slug = generateStoreSlug("");
      expect(slug.startsWith("store-")).toBe(true);
    });
  });

  describe("canonicalEmail", () => {
    it("lowercases and trims email addresses", () => {
      expect(canonicalEmail("  User@Example.Com  ")).toBe("user@example.com");
    });

    it("strips plus-addressing extensions across any domain", () => {
      expect(canonicalEmail("john+newsletter@domain.com")).toBe("john@domain.com");
    });

    it("removes dots and maps googlemail.com to gmail.com", () => {
      expect(canonicalEmail("j.o.h.n.doe@gmail.com")).toBe("johndoe@gmail.com");
      expect(canonicalEmail("j.o.h.n.doe@googlemail.com")).toBe("johndoe@gmail.com");
    });

    it("handles combination of dots and plus tag for gmail", () => {
      expect(canonicalEmail("J.Doe+promo@gmail.com")).toBe("jdoe@gmail.com");
    });
  });

  describe("isDisposableEmail", () => {
    it("detects known disposable email domains", () => {
      expect(isDisposableEmail("attacker@mailinator.com")).toBe(true);
      expect(isDisposableEmail("fake@tempmail.com")).toBe(true);
      expect(isDisposableEmail("user@yopmail.com")).toBe(true);
      expect(isDisposableEmail("test@sharklasers.com")).toBe(true);
    });

    it("detects disposable email with plus address", () => {
      expect(isDisposableEmail("attacker+bonus@mailinator.com")).toBe(true);
    });

    it("allows standard legitimate email providers and domains", () => {
      expect(isDisposableEmail("merchant@gmail.com")).toBe(false);
      expect(isDisposableEmail("support@shohozbiz.com")).toBe(false);
      expect(isDisposableEmail("buyer@yahoo.com")).toBe(false);
      expect(isDisposableEmail("admin@outlook.com")).toBe(false);
    });

    it("returns false for invalid or missing email input", () => {
      expect(isDisposableEmail("")).toBe(false);
      expect(isDisposableEmail("invalid-email")).toBe(false);
    });
  });

  describe("mapAuthError (enumeration hygiene)", () => {
    it("maps login credential errors and unconfirmed email errors to the same message", () => {
      const expected = "Invalid email or password.";
      expect(mapAuthError({ message: "Invalid login credentials" })).toBe(expected);
      expect(mapAuthError({ message: "Email not confirmed" })).toBe(expected);
      expect(mapAuthError({ message: "User not found" })).toBe(expected);
      expect(mapAuthError({ message: "wrong password" })).toBe(expected);
    });

    it("maps captcha verification failures to uniform message", () => {
      const expected = "Verification failed. Please refresh and try again.";
      expect(mapAuthError({ message: "Turnstile verification failed" })).toBe(expected);
      expect(mapAuthError({ message: "captcha token invalid" })).toBe(expected);
      expect(mapAuthError({ message: "bot detected" })).toBe(expected);
    });

    it("maps rate limiting gracefully", () => {
      expect(mapAuthError({ message: "rate limit exceeded" })).toBe(
        "Too many attempts. Please wait a while before trying again."
      );
    });

    it("returns original message for standard non-sensitive errors", () => {
      expect(mapAuthError({ message: "Network connection lost" })).toBe(
        "Network connection lost"
      );
    });
  });
});
