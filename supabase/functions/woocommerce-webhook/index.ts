import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  allowedWooWebhookTopic,
  deliveryFingerprintInput,
  extractWooOrderId,
  isStrictWebhookId,
  normalizeWooWebhookSource,
  shouldEnqueueWooWebhookWork,
  shouldPromoteWooWebhookStatus,
  webhookSecretNames,
} from "../../../src/lib/woocommerceWebhookIntake.ts";

const encoder = new TextEncoder();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-wc-webhook-signature, x-wc-webhook-id, x-wc-webhook-topic, x-wc-webhook-resource, x-wc-webhook-source, x-wc-webhook-delivery-id, x-wc-webhook-payload-version",
};

type Connector = {
  id: string;
  business_id: string;
  brand_id: string;
  store_id: string;
  order_source_id: string;
  external_store_url: string;
  expected_webhook_id: number | null;
  webhook_secret_fingerprint: string | null;
  webhook_secret_ref: string | null;
  previous_webhook_secret_ref: string | null;
  previous_secret_expires_at: string | null;
  intake_enabled: boolean;
  status: string;
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function header(req: Request, name: string): string | null {
  return req.headers.get(name) ?? req.headers.get(name.toLowerCase());
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
}

async function verify(raw: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const expected = base64ToBytes(signature.trim());
  if (!expected) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const actual = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  return constantTimeEqual(actual, expected);
}

async function secretsFor(connector: Connector): Promise<string[]> {
  // Only the connector's own secret reference may authenticate a delivery.
  // The global WOO_WEBHOOK_SECRET and the id-derived WOO_WEBHOOK_SECRET_<id>
  // fallbacks are gone: either could verify every store against one key, so a
  // connector without a declared secret reference fails closed (no secrets,
  // hence no valid signature) instead of borrowing shared tenancy.
  const names = webhookSecretNames({
    webhookSecretRef: connector.webhook_secret_ref,
    previousWebhookSecretRef: connector.previous_webhook_secret_ref,
    previousSecretExpiresAt: connector.previous_secret_expires_at,
    now: new Date().toISOString(),
  });
  if (!names.length) console.error("woocommerce webhook secret reference missing", connector.id);
  return names.map((name) => Deno.env.get(name) ?? "").filter(Boolean);
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

async function retainRejection(
  client: ReturnType<typeof admin>,
  input: { connector_id?: string | null; webhook_id?: number | null; delivery_id?: string | null; source_url?: string | null; topic?: string | null; resource?: string | null; raw_body: Uint8Array; reason: string; signature_present: boolean },
): Promise<void> {
  await client.from("woocommerce_webhook_rejections").insert({
    connector_id: input.connector_id ?? null,
    webhook_id: input.webhook_id ?? null,
    delivery_id: input.delivery_id ?? null,
    source_url: input.source_url ?? null,
    topic: input.topic ?? null,
    resource: input.resource ?? null,
    raw_body: `\\x${bytesToHex(input.raw_body)}`,
    reason: input.reason,
    signature_present: input.signature_present,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);

  const raw = new Uint8Array(await req.arrayBuffer());
  const source = header(req, "x-wc-webhook-source");
  const webhookIdRaw = header(req, "x-wc-webhook-id");
  const webhookId = isStrictWebhookId(webhookIdRaw) ? Number(webhookIdRaw) : NaN;
  const topic = header(req, "x-wc-webhook-topic");
  const resource = header(req, "x-wc-webhook-resource");
  const deliveryId = header(req, "x-wc-webhook-delivery-id");
  const signature = header(req, "x-wc-webhook-signature");
  const payloadVersion = header(req, "x-wc-webhook-payload-version");
  // Include the authenticated binding headers in the fallback fingerprint. A
  // body-only fingerprint would incorrectly coalesce the same bytes delivered
  // under different topics or webhook registrations.
  const fingerprintInput = new Uint8Array([
    ...encoder.encode(deliveryFingerprintInput({
      source: source ?? "",
      webhookId: webhookIdRaw ?? "",
      topic: topic ?? "",
      resource: resource ?? "",
      rawBody: "",
    })),
    0,
    ...raw,
  ]);
  const fingerprint = await crypto.subtle.digest("SHA-256", fingerprintInput).then((digest) => bytesToHex(new Uint8Array(digest)));
  const sb = admin();

  if (!source || Number.isNaN(webhookId)) {
    await retainRejection(sb, {
      webhook_id: Number.isSafeInteger(webhookId) ? webhookId : null,
      delivery_id: deliveryId,
      source_url: source,
      topic,
      resource,
      raw_body: raw,
      reason: "invalid_webhook_identity",
      signature_present: Boolean(signature),
    });
    return response({ error: "invalid_webhook_identity" }, 400);
  }
  const { data: connectors, error: connectorError } = await sb.from("woocommerce_connectors")
    .select("id,business_id,brand_id,store_id,order_source_id,external_store_url,expected_webhook_id,webhook_secret_fingerprint,webhook_secret_ref,previous_webhook_secret_ref,previous_secret_expires_at,intake_enabled,status")
    .eq("expected_webhook_id", webhookId)
    .eq("intake_enabled", true)
    .in("status", ["healthy", "degraded"])
    .limit(20);
  if (connectorError || !connectors?.length) {
    await retainRejection(sb, {
      webhook_id: webhookId,
      delivery_id: deliveryId,
      source_url: source,
      topic,
      resource,
      raw_body: raw,
      reason: "unbound_webhook",
      signature_present: Boolean(signature),
    });
    return response({ error: "unbound_webhook" }, 404);
  }

  // The binding contract module is imported piecemeal on purpose. Its
  // resolveWooWebhookBinding() would re-assert the expected webhook id (the
  // connector is already selected by that id in the query above) and returns
  // wrong_source for an unclaimed id, turning the 404 unbound_webhook above
  // into a 401 wrong_webhook_source. These predicates carry the same rules
  // without changing the responses the live intake already returns.
  const rawSource = normalizeWooWebhookSource(source);
  const typedConnector = connectors.find((candidate) => normalizeWooWebhookSource(candidate.external_store_url) === rawSource) as Connector | undefined;
  // A webhook id is only meaningful within its external store. Do not let a
  // caller use a valid id from one installation against another connector.
  if (!typedConnector) {
    await retainRejection(sb, {
      webhook_id: webhookId,
      delivery_id: deliveryId,
      source_url: source,
      topic,
      resource,
      raw_body: raw,
      reason: "wrong_webhook_source",
      signature_present: Boolean(signature),
    });
    return response({ error: "wrong_webhook_source" }, 401);
  }
  const configuredSource = normalizeWooWebhookSource(typedConnector.external_store_url);
  const sourceValid = rawSource === configuredSource;
  const topicValid = allowedWooWebhookTopic(topic);
  const resourceValid = resource === "order";
  const signatureValid = sourceValid && (await Promise.all((await secretsFor(typedConnector)).map((secret) => verify(raw, signature, secret)))).some(Boolean);
  let parsed: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (value && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    // The raw body is retained as delivery evidence below and the request is
    // rejected with 400 malformed_payload; a null payload never queues work.
  }

  const externalOrderId = extractWooOrderId(parsed);
  const verificationResult = shouldEnqueueWooWebhookWork({
    signatureValid,
    topicValid,
    resourceValid,
    payload: parsed,
  })
    ? "accepted"
    : "quarantined";
  if (!signatureValid) {
    await retainRejection(sb, {
      connector_id: typedConnector.id,
      webhook_id: webhookId,
      delivery_id: deliveryId,
      source_url: source,
      topic,
      resource,
      raw_body: raw,
      reason: "invalid_signature",
      signature_present: Boolean(signature),
    });
    return response({ error: "invalid_signature" }, 401);
  }
  if (!topicValid || !resourceValid) {
    await retainRejection(sb, {
      connector_id: typedConnector.id,
      webhook_id: webhookId,
      delivery_id: deliveryId,
      source_url: source,
      topic,
      resource,
      raw_body: raw,
      reason: "unsupported_webhook",
      signature_present: Boolean(signature),
    });
    return response({ error: "unsupported_webhook" }, 400);
  }
  // Malformed JSON is retained above as delivery evidence (raw_body plus the
  // rejection row) and rejected here, before any work row can be written.
  if (!parsed) {
    await retainRejection(sb, {
      connector_id: typedConnector.id,
      webhook_id: webhookId,
      delivery_id: deliveryId,
      source_url: source,
      topic,
      resource,
      raw_body: raw,
      reason: "malformed_payload",
      signature_present: Boolean(signature),
    });
    return response({ error: "malformed_payload" }, 400);
  }

  if (externalOrderId === null) {
    await retainRejection(sb, {
      connector_id: typedConnector.id,
      webhook_id: webhookId,
      delivery_id: deliveryId,
      source_url: source,
      topic,
      resource,
      raw_body: raw,
      reason: "missing_order_id",
      signature_present: Boolean(signature),
    });
    return response({ error: "missing_order_id" }, 400);
  }
  if (verificationResult !== "accepted") return response({ accepted: false }, 400);

  const { data: rpcData, error: rpcError } = await sb.rpc("accept_woocommerce_webhook_delivery", {
    p_connector_id: typedConnector.id,
    p_webhook_id: webhookId,
    p_delivery_id: deliveryId,
    p_delivery_fingerprint: fingerprint,
    p_topic: topic,
    p_resource: resource,
    p_source_url: source,
    p_payload_version: payloadVersion,
    p_raw_body: `\\x${bytesToHex(raw)}`,
    p_parsed_payload: parsed,
    p_external_order_id: externalOrderId,
  });
  const result = rpcData as { status?: unknown; delivery_id?: unknown; work_id?: unknown } | null;
  if (rpcError || !result || typeof result.status !== "string") {
    console.error("woocommerce webhook intake RPC failed", rpcError?.message ?? "malformed response");
    return response({ error: "intake_persistence_failed" }, 503);
  }
  if (!["accepted", "duplicate", "repaired"].includes(result.status)) {
    if (result.status === "conflict") return response({ error: "duplicate_delivery_conflict" }, 409);
    return response({ error: "intake_persistence_failed" }, 503);
  }
  const receivedAt = new Date().toISOString();
  const promoteWebhookStatus = shouldPromoteWooWebhookStatus({ expectedWebhookId: typedConnector.expected_webhook_id, webhookId });
  const { error: updateError } = await sb.from("woocommerce_connectors").update({
    last_webhook_received_at: receivedAt,
    last_webhook_verified_at: receivedAt,
    ...(promoteWebhookStatus ? { webhook_status: "active" } : {}),
  }).eq("id", typedConnector.id);
  if (updateError) {
    console.error("woocommerce connector promotion failed", updateError.message);
    return response({ error: "intake_persistence_failed" }, 503);
  }
  return response({ accepted: true, durable: true, ...(result.status === "accepted" ? {} : { duplicate: true }), delivery_id: result.delivery_id ?? null, work_id: result.work_id ?? null });
});
