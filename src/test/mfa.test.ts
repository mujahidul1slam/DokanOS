import { describe, expect, it } from "vitest";
import { parseMfaError } from "@/lib/mfa";

describe("parseMfaError", () => {
  it("detects mfa_required via error.code and extracts the factor id (factors)", () => {
    const err = {
      code: "mfa_required",
      message: "MFA is required",
      factors: [{ id: "factor-123", factor_type: "totp" }],
    };
    const r = parseMfaError(err);
    expect(r.isMfa).toBe(true);
    expect(r.factorId).toBe("factor-123");
  });

  it("detects mfa_required via mfa_factors (GoTrue legacy shape)", () => {
    const err = {
      code: "mfa_required",
      mfa_factors: [{ id: "factor-legacy" }],
    };
    const r = parseMfaError(err);
    expect(r.isMfa).toBe(true);
    expect(r.factorId).toBe("factor-legacy");
  });

  it("detects mfa_required via message when code is absent", () => {
    const err = { message: "sign-in failed: mfa_required to continue", factors: [{ id: "f9" }] };
    const r = parseMfaError(err);
    expect(r.isMfa).toBe(true);
    expect(r.factorId).toBe("f9");
  });

  it("detects mfa_required via error_description", () => {
    const r = parseMfaError({ error_description: "mfa_required" });
    expect(r.isMfa).toBe(true);
    expect(r.factorId).toBeNull();
  });

  it("passes through non-MFA errors", () => {
    expect(parseMfaError({ code: "invalid_credentials", message: "Invalid credentials" }).isMfa).toBe(false);
    expect(parseMfaError(new Error("network down")).isMfa).toBe(false);
    expect(parseMfaError(null).isMfa).toBe(false);
    expect(parseMfaError(undefined).isMfa).toBe(false);
    expect(parseMfaError("string error").isMfa).toBe(false);
  });

  it("mfa_required with no factor list yields null factorId", () => {
    const r = parseMfaError({ code: "mfa_required" });
    expect(r.isMfa).toBe(true);
    expect(r.factorId).toBeNull();
  });
});