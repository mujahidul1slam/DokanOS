export const WOO_WEBHOOK_TOPICS = [
  "order.created",
  "order.updated",
  "order.deleted",
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

export function isStrictWebhookId(value: string | null | undefined): boolean {
  if (!value || !/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0;
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
  if (input.resource !== "order") return { accepted: false, reason: "wrong_resource" };
  if (!connector.intake_enabled || !["healthy", "degraded"].includes(connector.status)) {
    return { accepted: false, reason: "inactive_connector" };
  }
  return { accepted: true, reason: "accepted" };
}

export function extractWooOrderId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).id;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
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
    && extractWooOrderId(input.payload) !== null;
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
