import { describe, expect, it } from "vitest";
import { isProfileSetupOwed, profileSetupOwed } from "@/lib/accounts/profileSetup";
import {
  INVALID_LINK_MESSAGE,
  UNVERIFIED_MESSAGE,
  resolveAuthConfirm,
  type AuthConfirmDeps,
  type AuthConfirmUrl,
  type AuthUserLike,
} from "@/lib/accounts/authConfirmFlow";

// Task 3 gate: the shared owed check and the post-confirmation decision order.
// These pin the live-diagnosed failure modes (2026-11-01): a token_hash link
// that was never explicitly exchanged, a cached session user that lags the
// server's email_confirmed_at, and a used link that dead-ended instead of
// falling back to an established session.

const confirmed: AuthUserLike = { id: "u-1", email_confirmed_at: "2026-11-01T00:00:00Z" };
const unverified: AuthUserLike = { id: "u-1", email_confirmed_at: null };

const url = (search = "", hash = "", initialType: string | null = null): AuthConfirmUrl => ({
  search: new URLSearchParams(search),
  hash: new URLSearchParams(hash),
  initialType,
});

interface FakeCalls {
  calls: string[];
}

const fakeDeps = (overrides: Partial<AuthConfirmDeps> = {}): { deps: AuthConfirmDeps } & FakeCalls => {
  const calls: string[] = [];
  const deps: AuthConfirmDeps = {
    verifyOtp: async ({ type, token_hash }) => {
      calls.push(`verifyOtp:${type}:${token_hash}`);
      return { user: confirmed, error: null };
    },
    getSession: async () => {
      calls.push("getSession");
      return { user: confirmed, error: null };
    },
    getUser: async () => {
      calls.push("getUser");
      return { user: confirmed, error: null };
    },
    isProfileSetupOwed: async (userId) => {
      calls.push(`owed:${userId}`);
      return true;
    },
    settle: async () => {
      calls.push("settle");
    },
    ...overrides,
  };
  return { deps, calls };
};

const profileClient = (result: { data: unknown; error: unknown } | (() => never)): unknown => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (typeof result === "function") return result();
          return result;
        },
      }),
    }),
  }),
});

describe("isProfileSetupOwed (shared gate check)", () => {
  it("owes the setup while profile_setup_completed_at is null", async () => {
    await expect(
      isProfileSetupOwed(profileClient({ data: { profile_setup_completed_at: null }, error: null }), "u-1"),
    ).resolves.toBe(true);
  });

  it("does not owe after completion or skip", async () => {
    await expect(
      isProfileSetupOwed(
        profileClient({ data: { profile_setup_completed_at: "2026-11-01T00:00:00Z" }, error: null }),
        "u-1",
      ),
    ).resolves.toBe(false);
  });

  it("owes the setup when the profile row is missing entirely", async () => {
    await expect(
      isProfileSetupOwed(profileClient({ data: null, error: null }), "u-1"),
    ).resolves.toBe(true);
  });

  it("is fail-soft on a read error: not owed, never traps", async () => {
    await expect(
      isProfileSetupOwed(profileClient({ data: null, error: new Error("boom") }), "u-1"),
    ).resolves.toBe(false);
  });

  it("is fail-soft on a thrown read: not owed", async () => {
    await expect(
      isProfileSetupOwed(profileClient(() => { throw new Error("boom"); }), "u-1"),
    ).resolves.toBe(false);
  });

  it("keeps the pure predicate's missing-row rule", () => {
    expect(profileSetupOwed(null)).toBe(true);
    expect(profileSetupOwed(undefined)).toBe(true);
    expect(profileSetupOwed({ profile_setup_completed_at: null })).toBe(true);
    expect(profileSetupOwed({ profile_setup_completed_at: "2026-11-01" })).toBe(false);
  });
});

describe("resolveAuthConfirm decision order", () => {
  it("shows the invalid-link message on an error param without any auth call", async () => {
    const { deps, calls } = fakeDeps();
    await expect(resolveAuthConfirm(deps, url("error=access_denied"))).resolves.toEqual({
      kind: "message",
      message: INVALID_LINK_MESSAGE,
    });
    expect(calls).toEqual([]);
  });

  it("also catches error params carried in the hash", async () => {
    const { deps, calls } = fakeDeps();
    await expect(resolveAuthConfirm(deps, url("", "error=otp_expired"))).resolves.toEqual({
      kind: "message",
      message: INVALID_LINK_MESSAGE,
    });
    expect(calls).toEqual([]);
  });

  it("exchanges a token_hash signup link explicitly and runs the gate", async () => {
    const { deps, calls } = fakeDeps();
    await expect(
      resolveAuthConfirm(deps, url("token_hash=h1&type=signup")),
    ).resolves.toEqual({ kind: "profile-setup" });
    expect(calls).toContain("verifyOtp:signup:h1");
    expect(calls).toContain("owed:u-1");
    expect(calls.filter((c) => c === "getSession")).toHaveLength(0);
  });

  it("sends a verified, set-up person to /accounts from the token_hash path", async () => {
    const { deps } = fakeDeps({ isProfileSetupOwed: async () => false });
    await expect(
      resolveAuthConfirm(deps, url("token_hash=h1&type=signup")),
    ).resolves.toEqual({ kind: "accounts" });
  });

  it("falls back to an established session when the link token was used already", async () => {
    const { deps, calls } = fakeDeps({
      verifyOtp: async () => {
        calls.push("verifyOtp:used");
        return { user: null, error: new Error("Token already used") };
      },
      isProfileSetupOwed: async () => false,
    });
    await expect(
      resolveAuthConfirm(deps, url("token_hash=used&type=signup")),
    ).resolves.toEqual({ kind: "accounts" });
    expect(calls).toContain("getSession");
  });

  it("reports the invalid link only when a used token has no session to rescue it", async () => {
    const { deps } = fakeDeps({
      verifyOtp: async () => ({ user: null, error: new Error("expired") }),
      getSession: async () => ({ user: null, error: null }),
      getUser: async () => ({ user: null, error: null }),
    });
    await expect(
      resolveAuthConfirm(deps, url("token_hash=used&type=signup")),
    ).resolves.toEqual({ kind: "message", message: INVALID_LINK_MESSAGE });
  });

  it("uses the session path for hash access-token links (no verifyOtp)", async () => {
    const { deps, calls } = fakeDeps();
    await expect(
      resolveAuthConfirm(deps, url("", "access_token=t&type=signup")),
    ).resolves.toEqual({ kind: "profile-setup" });
    expect(calls.filter((c) => c.startsWith("verifyOtp"))).toHaveLength(0);
  });

  it("uses the session path for PKCE code links (no verifyOtp)", async () => {
    const { deps, calls } = fakeDeps();
    await expect(
      resolveAuthConfirm(deps, url("code=abc")),
    ).resolves.toEqual({ kind: "profile-setup" });
    expect(calls.filter((c) => c.startsWith("verifyOtp"))).toHaveLength(0);
  });

  it("prefers the server-fresh user over the lagging cached session user", async () => {
    // The live bug: getSession().user lacked email_confirmed_at after a real
    // confirmation. The authoritative getUser() says confirmed → gate runs.
    const { deps } = fakeDeps({
      getSession: async () => ({ user: unverified, error: null }),
      getUser: async () => ({ user: confirmed, error: null }),
    });
    await expect(resolveAuthConfirm(deps, url("code=abc"))).resolves.toEqual({
      kind: "profile-setup",
    });
  });

  it("shows the unverified message when no source establishes a verified user", async () => {
    const { deps } = fakeDeps({
      getSession: async () => ({ user: unverified, error: null }),
      getUser: async () => ({ user: unverified, error: null }),
    });
    await expect(resolveAuthConfirm(deps, url("code=abc"))).resolves.toEqual({
      kind: "message",
      message: UNVERIFIED_MESSAGE,
    });
  });

  it("waits for the client's own URL exchange and retries the session once", async () => {
    let reads = 0;
    const { deps, calls } = fakeDeps({
      getSession: async () => {
        calls.push("getSession");
        reads += 1;
        return { user: reads >= 2 ? confirmed : null, error: null };
      },
    });
    await expect(resolveAuthConfirm(deps, url("code=abc"))).resolves.toEqual({
      kind: "profile-setup",
    });
    expect(calls.filter((c) => c === "getSession")).toHaveLength(2);
    expect(calls).toContain("settle");
  });

  it("routes recovery links to reset-password after establishment", async () => {
    const { deps } = fakeDeps();
    await expect(
      resolveAuthConfirm(deps, url("token_hash=h2&type=recovery")),
    ).resolves.toEqual({ kind: "reset-password" });
    await expect(
      resolveAuthConfirm(deps, url("type=recovery")),
    ).resolves.toEqual({ kind: "reset-password" });
    await expect(
      resolveAuthConfirm(deps, url("", "", "recovery")),
    ).resolves.toEqual({ kind: "reset-password" });
  });
});
