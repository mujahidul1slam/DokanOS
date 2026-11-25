export const WOO_WEBHOOK_TOPICS = [
  "order.created",
  "order.updated",
  "order.deleted",
  "product.created",
  "product.updated",
] as const;

export type WooWebhookTopic = (typeof WOO_WEBHOOK_TOPICS)[number];

export type WooWebhookBindingInput = {
  source: string | null | undefined;
  webhookId: string | null | undefined;
  topic: string | null | undefined;
  resource: string | null | undefined;
};

export type WooWebhookBindingConnector = {
  id: string;
  external_store_url: string;
  expected_webhook_id: number | null;
  expected_webhook_topic?: string | null;
  intake_enabled: boolean;
  status: string;
};

export type WooWebhookBindingResult =
  | { accepted: true; reason: "accepted" }
  | {
      accepted: false;
      reason:
        | "invalid_webhook_id"
        | "wrong_source"
        | "wrong_webhook_id"
        | "wrong_topic"
        | "wrong_resource"
        | "inactive_connector";
    };

export function normalizeWooWebhookSource(value: string): string {
  return value.trim().replace(/\/$/, "").toLowerCase();
}

export function allowedWooWebhookTopic(value: string | null | undefined): value is WooWebhookTopic {
  return typeof value === "string" && (WOO_WEBHOOK_TOPICS as readonly string[]).includes(value);
}

/** Which `x-wc-webhook-resource` header a topic is allowed to carry. */
export function expectedWooWebhookResource(topic: string | null | undefined): "order" | "product" | null {
  // Fail closed: only an explicitly allowed topic has a valid resource family.
  // An arbitrary `product.*` string (e.g. the unsupported product.deleted) must
  // not be treated as a valid product delivery.
  if (!allowedWooWebhookTopic(topic)) return null;
  return topic.startsWith("product.") ? "product" : "order";
}

/**
 * A delivery is only internally consistent when its resource header matches
 * its topic. Order topics must still say `order`, product topics `product`.
 */
export function isWooWebhookResourceValid(
  topic: string | null | undefined,
  resource: string | null | undefined,
): boolean {
  const expected = expectedWooWebhookResource(topic);
  return expected !== null && resource === expected;
}

export function isStrictWebhookId(value: string | null | undefined): boolean {
  if (!value || !/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0;
}

/**
 * A binding is a promise about one topic: honouring a product binding for an
 * order topic (or a blank topic) would cross wires. Fail closed unless the
 * binding is active, the id matches and the topic matches exactly.
 */
export function bindingMatchesDelivery(
  binding: { webhook_id: number; topic: string; status: string },
  input: { webhookId: number; topic: string | null },
): boolean {
  return binding.status === "active"
    && binding.webhook_id === input.webhookId
    && typeof input.topic === "string"
    && input.topic.length > 0
    && binding.topic === input.topic;
}

export function resolveWooWebhookBinding(
  connector: WooWebhookBindingConnector,
  input: WooWebhookBindingInput,
): WooWebhookBindingResult {
  if (!isStrictWebhookId(input.webhookId)) return { accepted: false, reason: "invalid_webhook_id" };
  if (normalizeWooWebhookSource(input.source ?? "") !== normalizeWooWebhookSource(connector.external_store_url)) {
    return { accepted: false, reason: "wrong_source" };
  }
  if (Number(input.webhookId) !== connector.expected_webhook_id) {
    return { accepted: false, reason: "wrong_webhook_id" };
  }
  if (!allowedWooWebhookTopic(input.topic)) return { accepted: false, reason: "wrong_topic" };
  if (!isWooWebhookResourceValid(input.topic, input.resource)) return { accepted: false, reason: "wrong_resource" };
  if (!connector.intake_enabled || !["healthy", "degraded"].includes(connector.status)) {
    return { accepted: false, reason: "inactive_connector" };
  }
  return { accepted: true, reason: "accepted" };
}

/**
 * Read a positive numeric `id` from a WooCommerce payload. Both order and
 * product webhook bodies carry their external identity in `id`, so the same
 * guard serves both: only a safe positive integer is accepted, never a
 * stringified object or a borrowed tenancy field.
 */
export function extractWooExternalId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).id;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/** Backwards-compatible name: order and product payloads both use `id`. */
export function extractWooOrderId(payload: unknown): number | null {
  return extractWooExternalId(payload);
}

export function shouldEnqueueWooDelivery(input: {
  duplicateDeliveryId: boolean;
  duplicateFingerprint: boolean;
  orderId: number | null;
}): boolean {
  return !input.duplicateDeliveryId && !input.duplicateFingerprint && input.orderId !== null;
}

export function webhookSecretNames(input: {
  webhookSecretRef: string | null | undefined;
  previousWebhookSecretRef: string | null | undefined;
  previousSecretExpiresAt: string | null | undefined;
  now: string;
}): string[] {
  // Fail closed: when the connector has no secret reference there is nothing
  // to authenticate against. A process-wide fallback secret would let one
  // misconfigured deployment verify every store's deliveries with one key.
  if (!input.webhookSecretRef) return [];
  const names = [input.webhookSecretRef];
  const expiresAt = input.previousSecretExpiresAt ? Date.parse(input.previousSecretExpiresAt) : NaN;
  if (input.previousWebhookSecretRef && Number.isFinite(expiresAt) && expiresAt > Date.parse(input.now)) {
    names.push(input.previousWebhookSecretRef);
  }
  return names;
}

export function shouldPromoteWooWebhookStatus(input: {
  expectedWebhookId: number | null | undefined;
  webhookId: number;
}): boolean {
  // Promotion claims the *expected* registration is live, which is what makes
  // cutover preconditions satisfiable. An arbitrary valid webhook id does not
  // prove that, so an unregistered expectation never promotes.
  return typeof input.expectedWebhookId === "number" && input.expectedWebhookId === input.webhookId;
}

export function shouldEnqueueWooWebhookWork(input: {
  signatureValid: boolean;
  topicValid: boolean;
  resourceValid: boolean;
  payload: unknown;
  deliveryId?: string | null;
}): boolean {
  // A body that did not parse arrives as a null payload, so malformed JSON can
  // never reach the work queue: it stays retained as delivery evidence only.
  return input.signatureValid
    && input.topicValid
    && input.resourceValid
    && input.payload !== null
    && input.payload !== undefined
    && extractWooExternalId(input.payload) !== null;
}

export function deliveryFingerprintInput(input: {
  source: string;
  webhookId: string;
  topic: string;
  resource: string;
  rawBody: string;
}): string {
  return [
    normalizeWooWebhookSource(input.source),
    input.webhookId,
    input.topic,
    input.resource,
    input.rawBody,
  ].join("\u0000");
}
