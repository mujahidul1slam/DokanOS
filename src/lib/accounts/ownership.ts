/**
 * Issue #14: pure mapping for business-account ownership transitions.
 *
 * The server is the authority: only a current owner may transfer ownership,
 * the target must already belong to the same account, and an owner cannot
 * leave before transferring. This module only turns RPC results and PostgREST
 * errors into the states and copy the account surfaces render, so a failed or
 * refused transition never looks like a successful one.
 */

export type OwnershipErrorOutcome =
  | "auth_required"
  | "owner_required"
  | "target_not_member"
  | "target_is_caller"
  | "owner_transfer_required"
  | "member_not_found"
  | "business_not_found"
  | "owner_invariant"
  | "failed";

export interface TransferResult {
  outcome: "transferred" | "failed";
  businessName: string | null;
  previousOwnerId: string | null;
  newOwnerId: string | null;
}

export interface DepartureResult {
  outcome: "left" | "failed";
  businessName: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function messageOf(error: unknown): string {
  if (!isRecord(error)) return "";
  return typeof error.message === "string" ? error.message : "";
}

function codeOf(error: unknown): string {
  if (!isRecord(error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

/**
 * Classify a failed RPC. Prefer the stable error prefix the migrations raise;
 * fall back only to unambiguous SQLSTATE classes.
 */
export function classifyOwnershipError(error: unknown): OwnershipErrorOutcome {
  const message = messageOf(error);
  const code = codeOf(error);

  if (message.includes("AUTH_REQUIRED")) return "auth_required";
  if (message.includes("OWNER_REQUIRED")) return "owner_required";
  if (message.includes("TARGET_IS_CALLER")) return "target_is_caller";
  if (message.includes("TARGET_NOT_MEMBER")) return "target_not_member";
  if (message.includes("OWNER_TRANSFER_REQUIRED")) return "owner_transfer_required";
  if (message.includes("MEMBER_NOT_FOUND")) return "member_not_found";
  if (message.includes("BUSINESS_NOT_FOUND")) return "business_not_found";
  if (message.includes("OWNER_INVARIANT")) return "owner_invariant";

  // PostgREST may surface only the SQLSTATE; map only unambiguous classes.
  if (code === "42501") return "owner_required";
  if (code === "23514") return "owner_invariant";
  return "failed";
}

/** Copy for a refused or failed ownership transfer. */
export function transferErrorMessage(error: unknown, targetLabel = "that person"): string {
  switch (classifyOwnershipError(error)) {
    case "auth_required":
      return "Sign in again to transfer ownership.";
    case "owner_required":
      return "Only a current owner can transfer ownership.";
    case "target_is_caller":
      return "Choose another member of this account.";
    case "target_not_member":
      return `${targetLabel} is not an existing member of this account.`;
    case "business_not_found":
      return "That business account no longer exists.";
    case "owner_invariant":
      return "The account must keep at least one owner, so ownership was not transferred.";
    case "owner_transfer_required":
    case "member_not_found":
    case "failed":
      return "Could not transfer ownership. Please try again.";
  }
}

/** Copy for a refused or failed self-departure. */
export function departureErrorMessage(error: unknown): string {
  switch (classifyOwnershipError(error)) {
    case "auth_required":
      return "Sign in again to leave this account.";
    case "owner_transfer_required":
      return "Transfer ownership to another member before leaving this account.";
    case "member_not_found":
      return "You no longer belong to this account.";
    case "business_not_found":
      return "That business account no longer exists.";
    case "owner_required":
    case "target_is_caller":
    case "target_not_member":
    case "owner_invariant":
    case "failed":
      return "Could not leave this account. Please try again.";
  }
}

export function parseTransferResult(raw: unknown): TransferResult {
  if (!isRecord(raw) || raw.transferred !== true) {
    return { outcome: "failed", businessName: null, previousOwnerId: null, newOwnerId: null };
  }
  return {
    outcome: "transferred",
    businessName: text(raw.business_name),
    previousOwnerId: text(raw.previous_owner_id),
    newOwnerId: text(raw.new_owner_id),
  };
}

export function parseDepartureResult(raw: unknown): DepartureResult {
  if (!isRecord(raw) || raw.left !== true) {
    return { outcome: "failed", businessName: null };
  }
  return { outcome: "left", businessName: text(raw.business_name) };
}

/**
 * Only an ordinary member may depart immediately. Owners must first transfer
 * ownership; an unknown role claims nothing, so the control stays hidden.
 */
export function canLeaveWithoutTransfer(role: string | null | undefined): boolean {
  return role === "member" || role === "admin" || role === "viewer";
}

/** A transfer target must be a different, existing member of this account. */
export function isTransferTarget(callerId: string | null, memberUserId: string, role: string): boolean {
  return callerId !== null && memberUserId !== callerId && role !== "owner";
}
