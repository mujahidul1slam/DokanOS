import { nextWooPageUrl as nextWooPageUrlCanonical } from "./woocommerceReconciliation.ts";

export const WOO_ORDER_STATUSES = [
  "pending",
  "on-hold",
  "processing",
  "completed",
  "cancelled",
  "refunded",
  "failed",
  "trash",
] as const;

export type WooOrderStatus = (typeof WOO_ORDER_STATUSES)[number];
export type WooInboundOutcome =
  | "payment_needs_confirmation"
  | "fulfillment_eligible"
  | "external_completed"
  | "external_terminal"
  | "external_deleted"
  | "unsupported";

export type WooInboundDecision = {
  outcome: WooInboundOutcome;
  createsCourierWork: boolean;
  requiresConflictReview: boolean;
  localStatus?: string;
  paymentStatus?: string;
};

export const WOO_CONNECTOR_STATES = [
  "healthy", "degraded", "paused", "disabled", "quarantined", "rolled_back",
] as const;
export type WooConnectorState = (typeof WOO_CONNECTOR_STATES)[number];
export type WooOperation = "setup" | "health" | "pause" | "resume" | "rotate_secret" | "correct" | "replay" | "rollback";

export type WooHealthInput = {
  state: string | null | undefined;
  webhookStatus: string | null | undefined;
  lastVerifiedAt?: string | null;
  lastProcessedAt?: string | null;
  lastReconciliationAt?: string | null;
  queueCounts?: Record<string, number>;
  openConflicts?: number;
};

export type WooHealth = {
  state: WooConnectorState;
  webhook: "active" | "inactive" | "unknown";
  queueDepth: number;
  retryCount: number;
  deadLetterCount: number;
  quarantineCount: number;
  openConflictCount: number;
};

export function deriveWooConnectorHealth(input: WooHealthInput): WooHealth {
  const state = WOO_CONNECTOR_STATES.includes(input.state as WooConnectorState)
    ? input.state as WooConnectorState : "disabled";
  const counts = input.queueCounts ?? {};
  return {
    state,
    webhook: input.webhookStatus === "active" ? "active" : input.webhookStatus ? "inactive" : "unknown",
    queueDepth: Object.values(counts).reduce((total, value) => total + Math.max(0, value || 0), 0),
    retryCount: Math.max(0, counts.retrying || 0),
    deadLetterCount: Math.max(0, counts.dead_letter || 0),
    quarantineCount: Math.max(0, counts.quarantined || 0),
    openConflictCount: Math.max(0, input.openConflicts || 0),
  };
}

export function validateWooOperation(operation: string, role: string | null | undefined): boolean {
  if (!(WOO_CONNECTOR_STATES.length > 0) || !["owner", "admin"].includes(role ?? "")) return false;
  return ["setup", "health", "pause", "resume", "rotate_secret", "correct", "replay", "rollback"].includes(operation);
}

export function rollbackWooConnectorPatch(): { status: "rolled_back"; intake_enabled: false; outbound_enabled: false } {
  return { status: "rolled_back", intake_enabled: false, outbound_enabled: false };
}

export function resumeWooConnectorPatch(): { status: "healthy"; intake_enabled: true; outbound_enabled: true } {
  return { status: "healthy", intake_enabled: true, outbound_enabled: true };
}

const TERMINAL_EXTERNAL = new Set<WooOrderStatus>([
  "cancelled",
  "refunded",
  "failed",
  "trash",
]);

export function normalizeWooStoreUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("WooCommerce store URL must use HTTPS");
  }
  return url.toString().replace(/\/$/, "").toLowerCase();
}

export function mapWooOrderStatus(
  status: string | null | undefined,
  localHasEnteredFulfillment = false,
): WooInboundDecision {
  switch (status) {
    case "pending":
    case "on-hold":
      return {
        outcome: "payment_needs_confirmation",
        createsCourierWork: false,
        requiresConflictReview: false,
        localStatus: "payment_pending",
        paymentStatus: "unpaid",
      };
    case "processing":
      return {
        outcome: "fulfillment_eligible",
        createsCourierWork: true,
        requiresConflictReview: false,
        paymentStatus: "paid",
      };
    case "completed":
      return {
        outcome: "external_completed",
        // WooCommerce completion is an external fact, never a DokanOS delivery
        // command. Staff may still review/dispatch the paid local order.
        createsCourierWork: false,
        requiresConflictReview: false,
        paymentStatus: "paid",
      };
    case "cancelled":
    case "refunded":
    case "failed":
      return {
        outcome: "external_terminal",
        createsCourierWork: false,
        requiresConflictReview: localHasEnteredFulfillment,
        paymentStatus: status === "refunded" ? "refunded" : "unpaid",
      };
    case "trash":
      return {
        outcome: "external_deleted",
        createsCourierWork: false,
        requiresConflictReview: localHasEnteredFulfillment,
      };
    default:
      return {
        outcome: "unsupported",
        createsCourierWork: false,
        requiresConflictReview: true,
      };
  }
}

export function isKnownWooStatus(status: string | null | undefined): status is WooOrderStatus {
  return typeof status === "string" && (WOO_ORDER_STATUSES as readonly string[]).includes(status);
}

export function isTerminalWooStatus(status: string | null | undefined): boolean {
  return isKnownWooStatus(status) && TERMINAL_EXTERNAL.has(status);
}

/** A Woo timestamp older than the identity watermark cannot regress local facts. */
export function isStaleWooOrder(
  incomingModifiedAt: string | null | undefined,
  lastModifiedAt: string | null | undefined,
): boolean {
  if (!incomingModifiedAt || !lastModifiedAt) return false;
  const incoming = Date.parse(incomingModifiedAt);
  const last = Date.parse(lastModifiedAt);
  return Number.isFinite(incoming) && Number.isFinite(last) && incoming < last;
}

export type AuthoritativeImportOutcome =
  | "import"
  | "stale"
  | "external_deleted"
  | "unsupported";

/** Classify the authoritative GET result without turning Woo `completed` into delivery. */
export function classifyAuthoritativeWooOrder(input: {
  httpStatus: number;
  externalStatus?: string | null;
  incomingModifiedAt?: string | null;
  lastModifiedAt?: string | null;
}): AuthoritativeImportOutcome {
  if (input.httpStatus === 404) return "external_deleted";
  if (input.httpStatus < 200 || input.httpStatus >= 300) return "unsupported";
  if (!isKnownWooStatus(input.externalStatus)) return "unsupported";
  if (isStaleWooOrder(input.incomingModifiedAt, input.lastModifiedAt)) return "stale";
  return "import";
}

export function outboundWooStatus(input: {
  accepted?: boolean;
  entered?: boolean;
  allFulfillmentUnitsDelivered?: boolean;
  safePreDispatchCancellation?: boolean;
  localHasEnteredFulfillment?: boolean;
}): "processing" | "completed" | "cancelled" | null {
  if (input.safePreDispatchCancellation && !input.localHasEnteredFulfillment) return "cancelled";
  if (input.allFulfillmentUnitsDelivered) return "completed";
  if (input.accepted || input.entered) return "processing";
  return null;
}

export type WooFulfillmentUnit = {
  id: string;
  status: string;
};

export type WooOutboundOrigin =
  | "accepted"
  | "entered"
  | "delivered"
  | "pre_dispatch_cancel"
  | "refunded"
  | "partial"
  | "returned"
  | "post_dispatch_cancel"
  | "conflict";

export type WooOutboundAudit = {
  origin: WooOutboundOrigin;
  expectedExternalStatus: string | null;
  localVersion: string;
  targetStatus: "processing" | "completed" | "cancelled" | null;
  relatedLocalAction: string | null;
  requestedAt: string;
};

export type WooOutboundDecision = {
  allowed: boolean;
  targetStatus: "processing" | "completed" | "cancelled" | null;
  reason: string | null;
  idempotencyKey: string;
  audit: WooOutboundAudit;
};

export type WooOutboundInput = {
  connectorId: string;
  externalOrderId: number;
  localOrderId: string;
  localVersion: string;
  localActionId?: string | null;
  externalStatus?: string | null;
  fulfillmentUnits: readonly WooFulfillmentUnit[];
  origin: WooOutboundOrigin;
  hasActiveConsignment?: boolean;
};

export function outboundIdempotencyKey(
  connectorId: string,
  externalOrderId: number,
  targetStatus: string,
  localVersion: string,
): string {
  return `${connectorId}:${externalOrderId}:${targetStatus}:${localVersion}`;
}

function allFulfillmentUnitsDelivered(units: readonly WooFulfillmentUnit[]): boolean {
  return units.length > 0 && units.every((unit) => unit.status.toLowerCase() === "delivered");
}

export function decideWooCommerceOutbound(input: WooOutboundInput): WooOutboundDecision {
  let targetStatus: WooOutboundDecision["targetStatus"] = null;
  let reason: string | null = null;

  switch (input.origin) {
    case "accepted":
    case "entered":
      targetStatus = "processing";
      break;
    case "delivered":
      if (allFulfillmentUnitsDelivered(input.fulfillmentUnits)) targetStatus = "completed";
      else reason = "fulfillment_incomplete";
      break;
    case "pre_dispatch_cancel":
      if (input.hasActiveConsignment) reason = "cancellation_after_dispatch";
      else targetStatus = "cancelled";
      break;
    default:
      reason = `unsafe_${input.origin}`;
      break;
  }

  const audit: WooOutboundAudit = {
    origin: input.origin,
    expectedExternalStatus: input.externalStatus ?? null,
    localVersion: input.localVersion,
    targetStatus,
    relatedLocalAction: input.localActionId ?? null,
    requestedAt: new Date().toISOString(),
  };
  return {
    allowed: targetStatus !== null,
    targetStatus,
    reason,
    idempotencyKey: outboundIdempotencyKey(
      input.connectorId,
      input.externalOrderId,
      targetStatus ?? `rejected:${reason}`,
      input.localVersion,
    ),
    audit,
  };
}

export type WooCommerceConfirmation = {
  status?: unknown;
  id?: unknown;
};

export function validateWooCommerceConfirmation(
  decision: WooOutboundDecision,
  response: WooCommerceConfirmation,
): { confirmed: boolean; reason: string | null } {
  if (!decision.allowed || !decision.targetStatus) return { confirmed: false, reason: "write_not_allowed" };
  if (response.id !== undefined && response.id !== Number(decision.idempotencyKey.split(":")[1])) {
    return { confirmed: false, reason: "confirmation_order_mismatch" };
  }
  if (response.status !== decision.targetStatus) return { confirmed: false, reason: "confirmation_status_mismatch" };
  return { confirmed: true, reason: null };
}

export function isWooCommerceEcho(input: {
  source: string;
  externalOrderId: number;
  externalStatus: string;
  outbound: WooOutboundDecision;
}): boolean {
  return input.source === "woocommerce_webhook"
    && input.outbound.allowed
    && input.outbound.targetStatus === input.externalStatus
    && input.outbound.idempotencyKey.split(":")[1] === String(input.externalOrderId);
}

export function validateWooCommerceOutboundRequest(input: WooOutboundInput): WooOutboundDecision {
  return decideWooCommerceOutbound(input);
}

export function classifyWooFailure(status: number | null): "auth" | "rate_limit" | "server" | "transport" | "permanent" {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === null) return "transport";
  if (status >= 500) return "server";
  return "permanent";
}

export function retryDelayMs(attempt: number, random = Math.random()): number {
  const boundedAttempt = Math.max(1, Math.min(attempt, 8));
  const base = Math.min(15 * 60_000, 1_000 * 2 ** (boundedAttempt - 1));
  return Math.round(base * (0.75 + Math.max(0, Math.min(1, random)) * 0.5));
}

export function nextWooPageUrl(responseUrl: string, linkHeader: string | null): string | null {
  return nextWooPageUrlCanonical(responseUrl, linkHeader);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/** Verify WooCommerce's base64 HMAC over the exact raw request bytes. */
export async function verifyWooCommerceSignature(
  rawBody: Uint8Array,
  signature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const normalized = signature.trim();
  let expected: Uint8Array;
  try {
    expected = base64ToBytes(normalized);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody as BufferSource));
  return constantTimeEqual(digest, expected);
}
