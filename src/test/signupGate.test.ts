import { describe, expect, it } from "vitest";
import { signupGateResponse } from "../../supabase/functions/_shared/signup-gate";

describe("public signup handler gate", () => {
  it("returns the established closed response when the public setting is false", async () => {
    const response = await signupGateResponse(async () => false);
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({
      error: "SIGNUP_CLOSED",
      message: "Sign up is currently closed.",
    });
  });

  it("returns an internal error rather than presenting a lookup failure as closure", async () => {
    const response = await signupGateResponse(async () => { throw new Error("configuration unavailable"); });
    expect(response?.status).toBe(500);
    expect(await response?.json()).toEqual({ error: "INTERNAL_ERROR", message: "Signup configuration unavailable." });
  });

  it("allows the actual handler to continue when the setting is true", async () => {
    expect(await signupGateResponse(async () => true)).toBeNull();
  });
});
