import { describe, expect, it } from "vitest";
import {
  acceptanceMessage,
  acceptanceOutcomeFromError,
  describeInvitation,
  isValidInviteEmail,
  normalizeInvitationRows,
  normalizeInviteEmail,
  normalizeMemberRows,
  parseAcceptanceResult,
} from "./businessInvitations";

describe("invitation description", () => {
  it("offers acceptance only for a usable invitation addressed to this identity", () => {
    const described = describeInvitation({
      status: "pending",
      business_name: "Biz A Fixture",
      email_matches: true,
    });

    expect(described.status).toBe("pending");
    expect(described.businessName).toBe("Biz A Fixture");
    expect(described.emailMatches).toBe(true);
    expect(described.canAccept).toBe(true);
    expect(described.message).toContain("Biz A Fixture");
  });

  it("never offers acceptance to a different identity, even though the link works", () => {
    const described = describeInvitation({
      status: "pending",
      business_name: "Biz A Fixture",
      email_matches: false,
    });

    expect(described.status).toBe("pending");
    expect(described.emailMatches).toBe(false);
    expect(described.canAccept).toBe(false);
    expect(described.message).toMatch(/different email address/i);
  });

  it.each([
    ["accepted", /already joined/i],
    ["revoked", /withdrawn/i],
    ["expired", /expired/i],
    ["invalid", /not valid/i],
  ] as const)("explains the %s state without offering acceptance", (status, message) => {
    const described = describeInvitation({ status, business_name: "Biz A Fixture", email_matches: true });

    expect(described.status).toBe(status);
    expect(described.canAccept).toBe(false);
    expect(described.message).toMatch(message);
  });

  it("reports an unavailable or unreadable response as no-information, never as a match", () => {
    for (const raw of [null, undefined, [], "pending", 42, { status: "something-else" }]) {
      const described = describeInvitation(raw);
      expect(described.status).toBe("unavailable");
      expect(described.canAccept).toBe(false);
      expect(described.emailMatches).toBe(false);
      expect(described.businessName).toBeNull();
    }
  });
});

describe("acceptance results", () => {
  it("reports joining and repeating distinctly, carrying the account name", () => {
    expect(parseAcceptanceResult({ outcome: "joined", business_name: "Biz A Fixture", role: "member" }))
      .toEqual({ outcome: "joined", businessName: "Biz A Fixture", role: "member" });
    expect(parseAcceptanceResult({ outcome: "already_member", business_name: "Biz A Fixture", role: "member" }))
      .toEqual({ outcome: "already_member", businessName: "Biz A Fixture", role: "member" });
  });

  it("treats an unrecognized result as a failure rather than a grant", () => {
    expect(parseAcceptanceResult(null).outcome).toBe("failed");
    expect(parseAcceptanceResult([]).outcome).toBe("failed");
    expect(parseAcceptanceResult({ outcome: "maybe" }).outcome).toBe("failed");
  });
});

describe("acceptance errors", () => {
  it.each([
    [{ code: "42501", message: "INVITATION_EMAIL_MISMATCH: this invitation was issued for a different email address" }, "wrong_email"],
    [{ code: "42501", message: "VERIFICATION_REQUIRED: confirm your email address before accepting an invitation" }, "not_verified"],
    [{ code: "42501", message: "AUTH_REQUIRED: authentication required" }, "forbidden"],
    [{ code: "23514", message: "INVITATION_INVALID: this invitation is not valid" }, "invalid"],
    [{ code: "23514", message: "INVITATION_EXPIRED: this invitation has expired" }, "expired"],
    [{ code: "23514", message: "INVITATION_REVOKED: this invitation was revoked" }, "revoked"],
    [{ code: "23514", message: "INVITATION_USED: this invitation was already accepted" }, "used"],
  ] as const)("maps %o to %s", (error, outcome) => {
    expect(acceptanceOutcomeFromError(error)).toBe(outcome);
  });

  it("does not claim a specific invitation problem it cannot identify", () => {
    expect(acceptanceOutcomeFromError(null)).toBe("failed");
    expect(acceptanceOutcomeFromError(undefined)).toBe("failed");
    expect(acceptanceOutcomeFromError(new Error("network down"))).toBe("failed");
    expect(acceptanceOutcomeFromError({ code: "PGRST301", message: "JWT expired" })).toBe("failed");
  });

  it("uses the SQLSTATE when the message alone is ambiguous", () => {
    expect(acceptanceOutcomeFromError({ code: "23514", message: "something else entirely" })).toBe("invalid");
    expect(acceptanceOutcomeFromError({ code: "42501", message: "permission denied for function" })).toBe("forbidden");
  });

  it("gives every outcome a distinct, actionable message", () => {
    const outcomes = ["joined", "already_member", "wrong_email", "not_verified", "invalid", "expired", "revoked", "used", "forbidden", "failed"] as const;
    const messages = outcomes.map((outcome) => acceptanceMessage(outcome));

    expect(new Set(messages).size).toBe(outcomes.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(10);
  });
});

describe("invite form input", () => {
  it("normalizes the intended email the same way the server does", () => {
    expect(normalizeInviteEmail("  New.Person@Dokanos.TEST  ")).toBe("new.person@dokanos.test");
  });

  it("rejects unusable addresses before a request is attempted", () => {
    expect(isValidInviteEmail("new.person@dokanos.test")).toBe(true);
    expect(isValidInviteEmail("  New.Person@Dokanos.TEST ")).toBe(true);
    for (const invalid of ["", "   ", "not-an-email", "a@b", "@dokanos.test", "person@", "two words@dokanos.test"]) {
      expect(isValidInviteEmail(invalid)).toBe(false);
    }
  });
});

describe("owner directory rows", () => {
  it("normalizes invitation rows and ignores malformed output", () => {
    const rows = normalizeInvitationRows([
      { id: "inv-1", email: "New.Person@Dokanos.test", role: "member", status: "pending", token: "tok-1", expires_at: "2026-11-02T00:00:00Z" },
      { id: "inv-2", email: "used@dokanos.test", role: "member", status: "accepted", token: "tok-2" },
      { id: "inv-3", email: "odd@dokanos.test", role: "member", status: "who-knows", token: "tok-3" },
      null,
      "nonsense",
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      id: "inv-1", email: "new.person@dokanos.test", role: "member",
      status: "pending", token: "tok-1", expiresAt: "2026-11-02T00:00:00Z",
    });
    expect(rows[1].status).toBe("accepted");
    expect(rows[2].status).toBe("invalid");
    expect(normalizeInvitationRows(null)).toEqual([]);
  });

  it("normalizes member rows and identifies owners", () => {
    const rows = normalizeMemberRows([
      { user_id: "person-1", email: "Owner@Dokanos.test", full_name: " Owner  ", role: "owner", joined_at: "2026-10-19T00:00:00Z" },
      { user_id: "person-2", email: "member@dokanos.test", full_name: null, role: "member" },
      { user_id: null, role: "member" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      userId: "person-1", email: "owner@dokanos.test", fullName: "Owner",
      role: "owner", isOwner: true, joinedAt: "2026-10-19T00:00:00Z",
    });
    expect(rows[1]).toEqual({
      userId: "person-2", email: "member@dokanos.test", fullName: null,
      role: "member", isOwner: false, joinedAt: null,
    });
  });
});
