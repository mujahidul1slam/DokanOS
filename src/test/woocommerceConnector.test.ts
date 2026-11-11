import { describe, expect, it } from "vitest";
import {
  classifyAuthoritativeWooOrder,
  classifyWooFailure,
  isStaleWooOrder,
  mapWooOrderStatus,
  nextWooPageUrl,
  outboundIdempotencyKey,
  outboundWooStatus,
  decideWooCommerceOutbound,
  isWooCommerceEcho,
  validateWooCommerceConfirmation,
  retryDelayMs,
  verifyWooCommerceSignature,
  deriveWooConnectorHealth,
  validateWooOperation,
  rollbackWooConnectorPatch,
  resumeWooConnectorPatch,
} from "@/lib/woocommerceConnector";

describe("WooCommerce operations contract", () => {
  it("allows only owner/admin operations and all explicit actions", () => {
    for (const operation of ["setup", "health", "pause", "resume", "rotate_secret", "correct", "replay", "rollback"]) {
      expect(validateWooOperation(operation, "owner")).toBe(true);
      expect(validateWooOperation(operation, "admin")).toBe(true);
      expect(validateWooOperation(operation, "manager")).toBe(false);
      expect(validateWooOperation(operation, "staff")).toBe(false);
    }
    expect(validateWooOperation("service_role", "owner")).toBe(false);
  });

  it("aggregates queue, recovery, conflict, and webhook state without exposing secrets", () => {
    expect(deriveWooConnectorHealth({
      state: "healthy", webhookStatus: "disabled", queueCounts: { pending: 2, retrying: 3, dead_letter: 1, quarantined: 2 }, openConflicts: 4,
    })).toEqual({ state: "healthy", webhook: "inactive", queueDepth: 8, retryCount: 3, deadLetterCount: 1, quarantineCount: 2, openConflictCount: 4 });
    expect(deriveWooConnectorHealth({ state: "rolled_back", webhookStatus: "missing" }).state).toBe("rolled_back");
    expect(deriveWooConnectorHealth({ state: "not-a-state", webhookStatus: null }).state).toBe("disabled");
  });

  it("makes rollback containment explicit and resume deliberate", () => {
    expect(rollbackWooConnectorPatch()).toEqual({ status: "rolled_back", intake_enabled: false, outbound_enabled: false });
    expect(resumeWooConnectorPatch()).toEqual({ status: "healthy", intake_enabled: true, outbound_enabled: true });
  });
});

describe("WooCommerce connector status contract", () => {
  it.each([
    ["pending", "payment_needs_confirmation", false],
    ["on-hold", "payment_needs_confirmation", false],
    ["processing", "fulfillment_eligible", true],
    ["completed", "external_completed", false],
    ["cancelled", "external_terminal", false],
    ["refunded", "external_terminal", false],
    ["failed", "external_terminal", false],
    ["trash", "external_deleted", false],
  ] as const)("maps %s without inventing local delivery", (status, outcome, createsWork) => {
    expect(mapWooOrderStatus(status)).toMatchObject({ outcome, createsCourierWork: createsWork });
  });

  it("quarantines an external terminal edit after fulfillment begins", () => {
    expect(mapWooOrderStatus("cancelled", true)).toMatchObject({
      requiresConflictReview: true,
      createsCourierWork: false,
    });
  });

  it("does not emit refunds or unsafe cancellation", () => {
    expect(outboundWooStatus({})).toBeNull();
    expect(outboundWooStatus({ safePreDispatchCancellation: true, localHasEnteredFulfillment: true })).toBeNull();
    expect(outboundWooStatus({ accepted: true })).toBe("processing");
    expect(outboundWooStatus({ allFulfillmentUnitsDelivered: true })).toBe("completed");
    expect(outboundWooStatus({ safePreDispatchCancellation: true })).toBe("cancelled");
  });
});

describe("WooCommerce authoritative current-state import", () => {
  it("rejects older current-state observations without regressing facts", () => {
    expect(isStaleWooOrder("2026-11-09T23:59:00Z", "2026-11-10T00:00:00Z")).toBe(true);
    expect(classifyAuthoritativeWooOrder({
      httpStatus: 200,
      externalStatus: "processing",
      incomingModifiedAt: "2026-11-09T23:59:00Z",
      lastModifiedAt: "2026-11-10T00:00:00Z",
    })).toBe("stale");
  });

  it("distinguishes missing current Orders from unsupported status payloads", () => {
    expect(classifyAuthoritativeWooOrder({ httpStatus: 404 })).toBe("external_deleted");
    expect(classifyAuthoritativeWooOrder({ httpStatus: 200, externalStatus: "custom-status" })).toBe("unsupported");
    expect(classifyAuthoritativeWooOrder({ httpStatus: 503, externalStatus: "processing" })).toBe("unsupported");
  });

  it("keeps completed external facts separate from local delivery", () => {
    expect(mapWooOrderStatus("completed")).toMatchObject({
      outcome: "external_completed",
      paymentStatus: "paid",
    });
    expect(mapWooOrderStatus("completed")).not.toHaveProperty("localStatus");
  });
});

describe("WooCommerce outbound decision adapter", () => {
  const base = {
    connectorId: "connector-1",
    externalOrderId: 42,
    localOrderId: "order-1",
    localVersion: "2026-11-10T00:00:00.000Z",
    localActionId: "timeline-1",
    externalStatus: "processing" as const,
    fulfillmentUnits: [
      { id: "unit-1", status: "delivered" },
      { id: "unit-2", status: "delivered" },
    ],
  };

  it.each([
    ["accepted", "processing"],
    ["entered", "processing"],
    ["delivered", "completed"],
    ["pre_dispatch_cancel", "cancelled"],
  ] as const)("allows safe %s as %s", (origin, targetStatus) => {
    const decision = decideWooCommerceOutbound({ ...base, origin });
    expect(decision).toMatchObject({ allowed: true, targetStatus });
    expect(decision.audit).toMatchObject({ origin, expectedExternalStatus: base.externalStatus, localVersion: base.localVersion, targetStatus, relatedLocalAction: base.localActionId });
    expect(decision.idempotencyKey).toContain("connector-1:42");
    expect(decision.audit).toHaveProperty("requestedAt");
  });

  it("gives duplicate local transitions the same durable work key", () => {
    const first = decideWooCommerceOutbound({ ...base, origin: "accepted" });
    const duplicate = decideWooCommerceOutbound({ ...base, origin: "accepted" });
    expect(duplicate.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("only requests completed when every fulfillment unit is delivered", () => {
    const decision = decideWooCommerceOutbound({ ...base, origin: "delivered", fulfillmentUnits: [{ id: "unit-1", status: "delivered" }, { id: "unit-2", status: "partial" }] });
    expect(decision).toMatchObject({ allowed: false, reason: "fulfillment_incomplete" });
  });

  it.each(["refunded", "partial", "returned", "post_dispatch_cancel", "conflict"] as const)("rejects unsafe %s without a target write", (origin) => {
    expect(decideWooCommerceOutbound({ ...base, origin })).toMatchObject({ allowed: false, targetStatus: null, reason: `unsafe_${origin}` });
  });

  it("rejects pre-dispatch cancellation when a consignment is active", () => {
    expect(decideWooCommerceOutbound({ ...base, origin: "pre_dispatch_cancel", hasActiveConsignment: true })).toMatchObject({ allowed: false, reason: "cancellation_after_dispatch" });
  });

  it("confirms only the authoritative target status", () => {
    const decision = decideWooCommerceOutbound({ ...base, origin: "accepted" });
    expect(validateWooCommerceConfirmation(decision, { status: "processing", id: 42 })).toMatchObject({ confirmed: true });
    expect(validateWooCommerceConfirmation(decision, { status: "completed", id: 42 })).toMatchObject({ confirmed: false, reason: "confirmation_status_mismatch" });
    expect(validateWooCommerceConfirmation(decision, { status: "processing", id: 99 })).toMatchObject({ confirmed: false, reason: "confirmation_order_mismatch" });
  });

  it("suppresses a webhook echo for the confirmed outbound write", () => {
    const decision = decideWooCommerceOutbound({ ...base, origin: "accepted" });
    expect(isWooCommerceEcho({ source: "woocommerce_webhook", externalOrderId: 42, externalStatus: "processing", outbound: decision })).toBe(true);
    expect(isWooCommerceEcho({ source: "woocommerce_webhook", externalOrderId: 42, externalStatus: "completed", outbound: decision })).toBe(false);
  });
});


describe("WooCommerce connector authentication", () => {
  it("verifies HMAC over the exact raw body and rejects altered bytes", async () => {
    const body = new TextEncoder().encode('{"id":12,"status":"processing"}');
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
    const signature = btoa(String.fromCharCode(...digest));
    expect(await verifyWooCommerceSignature(body, signature, "secret")).toBe(true);
    expect(await verifyWooCommerceSignature(new TextEncoder().encode('{"id":12,"status":"completed"}'), signature, "secret")).toBe(false);
    expect(await verifyWooCommerceSignature(body, signature, "wrong-secret")).toBe(false);
  });
});

describe("WooCommerce connector transport decisions", () => {
  it("classifies retryable API failures", () => {
    expect(classifyWooFailure(401)).toBe("auth");
    expect(classifyWooFailure(429)).toBe("rate_limit");
    expect(classifyWooFailure(503)).toBe("server");
    expect(classifyWooFailure(null)).toBe("transport");
    expect(classifyWooFailure(422)).toBe("permanent");
  });

  it("uses bounded jittered exponential backoff", () => {
    expect(retryDelayMs(1, 0)).toBe(750);
    expect(retryDelayMs(2, 1)).toBe(2500);
    expect(retryDelayMs(100, 0.5)).toBeLessThanOrEqual(900000);
  });

  it("follows only the RFC Link next relation", () => {
    expect(nextWooPageUrl("https://shop.test/wp-json/wc/v3/orders?page=1", '<https://shop.test/orders?page=2>; rel="next"')).toBe("https://shop.test/orders?page=2");
    expect(nextWooPageUrl("https://shop.test/orders", '<https://shop.test/orders?page=2>; rel="last"')).toBeNull();
  });

  it("follows a multi-rel next via the shared tolerant parser", () => {
    expect(nextWooPageUrl("https://shop.test/wp-json/wc/v3/orders?page=1", '<orders?page=2>; rel="prev next", <orders?page=9>; rel="last"')).toBe(
      "https://shop.test/wp-json/wc/v3/orders?page=2",
    );
  });

  it("scopes outbound idempotency to connector and local version", () => {
    expect(outboundIdempotencyKey("c1", 12, "processing", "v1")).toBe("c1:12:processing:v1");
    expect(outboundIdempotencyKey("c1", 12, "processing", "v2")).not.toBe(outboundIdempotencyKey("c1", 12, "processing", "v1"));
  });
});
