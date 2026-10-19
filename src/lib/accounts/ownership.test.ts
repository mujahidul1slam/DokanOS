import { describe, expect, it } from "vitest";
import {
  canLeaveWithoutTransfer,
  classifyOwnershipError,
  departureErrorMessage,
  isTransferTarget,
  parseDepartureResult,
  parseTransferResult,
  transferErrorMessage,
} from "./ownership";

describe("ownership error classification", () => {
  it.each([
    ["AUTH_REQUIRED: authentication required", "auth_required"],
    ["OWNER_REQUIRED: only a current owner can transfer ownership", "owner_required"],
    ["TARGET_NOT_MEMBER: choose an existing member of this account", "target_not_member"],
    ["TARGET_IS_CALLER: ownership must be transferred to another member", "target_is_caller"],
    ["OWNER_TRANSFER_REQUIRED: transfer ownership to another member before leaving", "owner_transfer_required"],
    ["MEMBER_NOT_FOUND: you are not a member of this account", "member_not_found"],
    ["BUSINESS_NOT_FOUND: that account does not exist", "business_not_found"],
    ["OWNER_INVARIANT: ownership transfer would leave the account ownerless", "owner_invariant"],
  ])("maps %s to %s", (message, outcome) => {
    expect(classifyOwnershipError({ message, code: "P0001" })).toBe(outcome);
  });

  it("uses unambiguous SQLSTATE classes only when no stable prefix is present", () => {
    expect(classifyOwnershipError({ message: "permission denied", code: "42501" })).toBe("owner_required");
    expect(classifyOwnershipError({ message: "check violation", code: "23514" })).toBe("owner_invariant");
    expect(classifyOwnershipError({ message: "network down", code: "ECONNRESET" })).toBe("failed");
    expect(classifyOwnershipError(null)).toBe("failed");
  });

  it("explains a target that belongs to a different account without implying success", () => {
    const message = transferErrorMessage(
      { message: "TARGET_NOT_MEMBER: choose an existing member of this account", code: "22023" },
      "outsider@example.com",
    );

    expect(message).toContain("outsider@example.com");
    expect(message).toMatch(/not an existing member/i);
  });

  it("tells an owner that ownership must be transferred before leaving", () => {
    expect(departureErrorMessage({
      message: "OWNER_TRANSFER_REQUIRED: transfer ownership to another member before leaving",
      code: "23514",
    })).toMatch(/transfer ownership/i);
  });

  it("never reports an ownerless-account guard as a successful transfer", () => {
    expect(transferErrorMessage({
      message: "OWNER_INVARIANT: ownership transfer would leave the account ownerless",
      code: "23514",
    })).toMatch(/must keep at least one owner/i);
  });
});

describe("ownership result parsing", () => {
  it("accepts an explicit transferred result and keeps the audited identities", () => {
    const result = parseTransferResult({
      transferred: true,
      business_id: "11111111-0000-0000-0000-000000000001",
      business_name: "Biz A Fixture",
      previous_owner_id: "00000000-0000-0000-0000-000000000001",
      new_owner_id: "00000000-0000-0000-0000-000000000004",
      owner_count: 2,
    });

    expect(result.outcome).toBe("transferred");
    expect(result.businessName).toBe("Biz A Fixture");
    expect(result.previousOwnerId).toBe("00000000-0000-0000-0000-000000000001");
    expect(result.newOwnerId).toBe("00000000-0000-0000-0000-000000000004");
  });

  it.each([null, undefined, [], "ok", {}, { transferred: "true" }, { transferred: false }])(
    "treats %s as a failed transfer",
    (raw) => {
      expect(parseTransferResult(raw)).toEqual({
        outcome: "failed",
        businessName: null,
        previousOwnerId: null,
        newOwnerId: null,
      });
    },
  );

  it("accepts only an explicit left result", () => {
    expect(parseDepartureResult({ left: true, business_name: "Biz A Fixture" })).toEqual({
      outcome: "left",
      businessName: "Biz A Fixture",
    });
    for (const raw of [null, {}, { left: "yes" }, { left: false }]) {
      expect(parseDepartureResult(raw)).toEqual({ outcome: "failed", businessName: null });
    }
  });
});

describe("departure and transfer eligibility", () => {
  it("lets ordinary members depart but blocks every owner until a transfer", () => {
    expect(canLeaveWithoutTransfer("member")).toBe(true);
    expect(canLeaveWithoutTransfer("admin")).toBe(true);
    expect(canLeaveWithoutTransfer("viewer")).toBe(true);
    expect(canLeaveWithoutTransfer("owner")).toBe(false);
    expect(canLeaveWithoutTransfer(null)).toBe(false);
    expect(canLeaveWithoutTransfer("unexpected")).toBe(false);
  });

  it("only offers a different, non-owner member as a transfer target", () => {
    const caller = "00000000-0000-0000-0000-000000000001";

    expect(isTransferTarget(caller, "00000000-0000-0000-0000-000000000004", "member")).toBe(true);
    expect(isTransferTarget(caller, caller, "member")).toBe(false);
    expect(isTransferTarget(caller, "00000000-0000-0000-0000-000000000002", "owner")).toBe(false);
    expect(isTransferTarget(null, "00000000-0000-0000-0000-000000000004", "member")).toBe(false);
  });
});
