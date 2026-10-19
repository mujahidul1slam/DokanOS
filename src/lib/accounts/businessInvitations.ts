/**
 * Issue #13: pure mapping for business-account invitations.
 *
 * The server is the authority: it decides who may invite, accept or remove a
 * member. This module only turns RPC payloads and PostgREST errors into the
 * states and copy the account surfaces render, so that every arrival gets one
 * clear, honest outcome and a link that works for someone else never looks
 * acceptable to the wrong identity.
 */

export type InvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired"
  | "invalid"
  /** The describe call could not be read at all; claim nothing about it. */
  | "unavailable";

export interface InvitationDescription {
  status: InvitationStatus;
  businessName: string | null;
  emailMatches: boolean;
  /** True only for an open invitation addressed to the signed-in identity. */
  canAccept: boolean;
  message: string;
}

export type AcceptanceOutcome =
  | "joined"
  | "already_member"
  | "wrong_email"
  | "not_verified"
  | "invalid"
  | "expired"
  | "revoked"
  | "used"
  | "forbidden"
  | "failed";

export interface AcceptanceResult {
  outcome: AcceptanceOutcome;
  businessName: string | null;
  role: string | null;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: InvitationStatus;
  token: string;
  expiresAt: string | null;
}

export interface MemberRow {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  isOwner: boolean;
  joinedAt: string | null;
}

const KNOWN_STATUSES: readonly Exclude<InvitationStatus, "unavailable">[] = [
  "pending",
  "accepted",
  "revoked",
  "expired",
  "invalid",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function email(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

function toStatus(value: unknown): Exclude<InvitationStatus, "unavailable"> | null {
  return typeof value === "string" && (KNOWN_STATUSES as readonly string[]).includes(value)
    ? (value as Exclude<InvitationStatus, "unavailable">)
    : null;
}

export function describeInvitation(raw: unknown): InvitationDescription {
  if (!isRecord(raw)) return { status: "unavailable", businessName: null, emailMatches: false, canAccept: false, message: unavailableMessage() };

  const status = toStatus(raw.status);
  if (status === null) {
    return { status: "unavailable", businessName: null, emailMatches: false, canAccept: false, message: unavailableMessage() };
  }

  const businessName = text(raw.business_name);
  const emailMatches = raw.email_matches === true;
  const canAccept = status === "pending" && emailMatches;
  return { status, businessName, emailMatches, canAccept, message: descriptionMessage(status, emailMatches, businessName) };
}

function unavailableMessage(): string {
  return "We couldn't check this invitation right now. Open the link again in a moment.";
}

function descriptionMessage(
  status: Exclude<InvitationStatus, "unavailable">,
  emailMatches: boolean,
  businessName: string | null,
): string {
  const account = businessName ?? "this business account";
  switch (status) {
    case "pending":
      return emailMatches
        ? `You're invited to join ${account}.`
        : "This invitation was issued for a different email address. Sign in with the invited address to join.";
    case "accepted":
      return `You have already joined ${account}.`;
    case "revoked":
      return "This invitation was withdrawn by the account owner.";
    case "expired":
      return "This invitation has expired. Ask the account owner for a new one.";
    case "invalid":
      return "This invitation link is not valid. Ask the account owner for a new one.";
  }
}

export function parseAcceptanceResult(raw: unknown): AcceptanceResult {
  if (!isRecord(raw)) return { outcome: "failed", businessName: null, role: null };
  const outcome = raw.outcome === "joined" || raw.outcome === "already_member"
    ? raw.outcome
    : "failed";
  return { outcome, businessName: text(raw.business_name), role: text(raw.role) };
}

export function acceptanceOutcomeFromError(error: unknown): AcceptanceOutcome {
  if (!isRecord(error)) return "failed";
  const message = typeof error.message === "string" ? error.message : "";
  const code = typeof error.code === "string" ? error.code : "";

  if (message.startsWith("INVITATION_EMAIL_MISMATCH")) return "wrong_email";
  if (message.startsWith("VERIFICATION_REQUIRED")) return "not_verified";
  if (message.startsWith("AUTH_REQUIRED")) return "forbidden";
  if (message.startsWith("OWNER_REQUIRED") || message.startsWith("MEMBER_REQUIRED")) return "forbidden";
  if (message.startsWith("INVITATION_INVALID")) return "invalid";
  if (message.startsWith("INVITATION_EXPIRED")) return "expired";
  if (message.startsWith("INVITATION_REVOKED")) return "revoked";
  if (message.startsWith("INVITATION_USED")) return "used";

  // PostgREST may surface only the SQLSTATE; map only unambiguous classes.
  if (code === "42501") return "forbidden";
  if (code === "23514") return "invalid";
  return "failed";
}

export function acceptanceMessage(outcome: AcceptanceOutcome): string {
  switch (outcome) {
    case "joined":
      return "You've joined the business account. Its account-wide operations are now available.";
    case "already_member":
      return "You already belong to this business account.";
    case "wrong_email":
      return "This invitation was issued for a different email address. Sign in with the invited address.";
    case "not_verified":
      return "Confirm your email address first, then accept the invitation.";
    case "invalid":
      return "This invitation is not valid. Ask the account owner for a new one.";
    case "expired":
      return "This invitation has expired. Ask the account owner for a new one.";
    case "revoked":
      return "This invitation was withdrawn by the account owner.";
    case "used":
      return "This invitation was already accepted.";
    case "forbidden":
      return "You do not have permission to accept this invitation.";
    case "failed":
      return "We couldn't accept the invitation. Please try again.";
  }
}

export function normalizeInviteEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidInviteEmail(input: string): boolean {
  const value = normalizeInviteEmail(input);
  return value.length > 0
    && value.length <= 254
    && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function normalizeInvitationRows(raw: unknown): InvitationRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): InvitationRow[] => {
    if (!isRecord(row)) return [];
    const id = text(row.id);
    if (id === null) return [];
    return [{
      id,
      email: email(row.email) ?? "",
      role: text(row.role) ?? "member",
      // An unrecognizable row state is surfaced as unusable, never as open.
      status: toStatus(row.status) ?? "invalid",
      token: text(row.token) ?? "",
      expiresAt: text(row.expires_at),
    }];
  });
}

export function normalizeMemberRows(raw: unknown): MemberRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): MemberRow[] => {
    if (!isRecord(row)) return [];
    const userId = text(row.user_id);
    if (userId === null) return [];
    const role = text(row.role) ?? "member";
    return [{
      userId,
      email: email(row.email),
      fullName: text(row.full_name),
      role,
      isOwner: role === "owner",
      joinedAt: text(row.joined_at),
    }];
  });
}
