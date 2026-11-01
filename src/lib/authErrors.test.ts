import { describe, expect, it } from "vitest";
import { isExistingAccountError, mapAuthError } from "./authErrors";

describe("isExistingAccountError", () => {
  it("recognizes the probed gotrue REST body shape (error_code)", () => {
    expect(
      isExistingAccountError({ code: 422, error_code: "user_already_exists", msg: "User already registered" }),
    ).toBe(true);
  });

  it("recognizes the supabase-js AuthApiError shape (code)", () => {
    const authApiError = Object.assign(new Error("User already registered"), {
      name: "AuthApiError",
      status: 422,
      code: "user_already_exists",
    });
    expect(isExistingAccountError(authApiError)).toBe(true);
  });

  it("recognizes the email_exists code variant", () => {
    expect(isExistingAccountError({ code: "email_exists", message: "Email exists" })).toBe(true);
  });

  it("recognizes message-only variants", () => {
    expect(isExistingAccountError(new Error("User already registered"))).toBe(true);
    expect(isExistingAccountError(new Error("That email address already exists"))).toBe(true);
  });

  it("rejects rate-limit errors", () => {
    expect(isExistingAccountError({ status: 429, message: "Request rate limit reached" })).toBe(false);
    expect(isExistingAccountError(new Error("Too many requests, slow down"))).toBe(false);
  });

  it("rejects captcha errors", () => {
    expect(isExistingAccountError(new Error("captcha verification failed"))).toBe(false);
    expect(isExistingAccountError({ code: "captcha_failed", message: "Turnstile challenge failed" })).toBe(false);
  });

  it("rejects generic auth and unexpected errors", () => {
    expect(isExistingAccountError(new Error("Invalid login credentials"))).toBe(false);
    expect(isExistingAccountError(new Error("Password should be at least 10 characters"))).toBe(false);
    expect(isExistingAccountError(new Error("boom"))).toBe(false);
  });

  it("rejects non-object inputs", () => {
    expect(isExistingAccountError(null)).toBe(false);
    expect(isExistingAccountError(undefined)).toBe(false);
    expect(isExistingAccountError("User already registered")).toBe(false);
  });
});

describe("mapAuthError (login behavior unchanged)", () => {
  it("still merges credential and unconfirmed-email errors into one message", () => {
    expect(mapAuthError(new Error("Invalid login credentials"))).toBe("Invalid email or password.");
    expect(mapAuthError(new Error("Email not confirmed"))).toBe("Invalid email or password.");
  });

  it("still maps captcha rejections uniformly", () => {
    expect(mapAuthError(new Error("captcha rejected"))).toBe("Verification failed. Please refresh and try again.");
  });
});
