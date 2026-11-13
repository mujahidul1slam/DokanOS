import { createClient } from "npm:@supabase/supabase-js@2.49.4";

// Owner/admin operations on WooCommerce connectors. Mutating RPCs
// (create/update/transition/rotate) resolve authorization from auth.uid(),
// so they MUST be called with the caller's JWT (userClient) — a service-role
// client has no auth.uid() and every mutation would fail. Service-role-only
// RPCs (replay/correction) and plain reads stay on the admin client.
const OWNER_ADMIN_ACTIONS = new Set(["create", "view", "update", "pause", "disable", "quarantine", "rollback", "resume", "rotate_secret", "replay", "correct", "setup_webhook", "health", "resolve_conflict"]);
const ACTIONS = OWNER_ADMIN_ACTIONS;
const SAFE_CONNECTOR_FIELDS = "id,business_id,brand_id,store_id,order_source_id,external_store_url,status,intake_enabled,outbound_enabled,webhook_status,expected_webhook_id,expected_webhook_topic,expected_delivery_url,webhook_secret_fingerprint,cutover_watermark,reconciliation_watermark,last_webhook_received_at,last_webhook_verified_at,last_webhook_processed_at,last_reconciliation_at,last_error,error_class,created_at,updated_at";
const TRANSITIONS = ["pause", "disable", "quarantine", "rollback", "resume"];
const WEBHOOK_TOPICS = ["order.created", "order.updated", "order.deleted"];
// Must stay identical to the allowlist inside resolve_woocommerce_sync_conflict;
// the RPC re-validates, this only produces a clean 400 instead of a 409.
const CONFLICT_RESOLUTIONS = ["accepted_external", "kept_local", "dismissed", "replayed"];
const CONFLICT_SELECT = "id,reason,created_at,resolution,resolution_note,resolved_at,resolved_by,external_order_id,order_id";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Input = Record<string, unknown>;
type Connector = { id: string; business_id: string; status: string; intake_enabled: boolean; outbound_enabled: boolean; webhook_status?: string; credentials_ref?: string; webhook_secret_ref?: string; expected_webhook_topic?: string | null; external_store_url?: string };

type AdminClient = ReturnType<typeof admin>;

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function userClient(authorization: string) {
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_API_KEY")!;
  return createClient(Deno.env.get("SUPABASE_URL")!, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

function text(input: Input, key: string): string | null {
  return typeof input[key] === "string" && input[key].trim() ? input[key].trim() : null;
}

function uuid(input: Input, key: string): string | null {
  const value = text(input, key);
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function normalizeStoreUrl(value: string): string {
  const url = new URL(value.trim());
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("external_store_url_requires_https");
  if (url.username || url.password || url.search || url.hash) throw new Error("external_store_url_must_not_contain_credentials_or_query");
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return url.toString().replace(/\/$/, "").toLowerCase();
}

function secretRef(value: string | null): value is string {
  return !!value && /^[A-Z][A-Z0-9_]{2,127}$/.test(value);
}
function fingerprint(value: string | null): value is string {
  return !!value && /^[a-f0-9]{64}$/.test(value);
}

async function audit(client: AdminClient, user: { id: string; email?: string | null }, action: string, connectorId: string, details: Input = {}) {
  await client.from("audit_log").insert({
    user_id: user.id,
    user_email: user.email,
    action: `woocommerce_connector_${action}`,
    entity_type: "woocommerce_connector",
    entity_id: connectorId,
    details: { action, connector_id: connectorId, ...details },
  });
}

function safeConnector(record: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!record) return null;
  const { credentials_ref: _credentialsRef, webhook_secret_ref: _webhookSecretRef, ...safe } = record;
  return safe;
}

function wooCredentials(ref: string): { consumer_key: string; consumer_secret: string } {
  const raw = Deno.env.get(ref);
  if (!raw) throw new Error("woocommerce_credentials_unavailable");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("woocommerce_credentials_invalid");
  const record = parsed as Record<string, unknown>;
  if (typeof record.consumer_key !== "string" || typeof record.consumer_secret !== "string") throw new Error("woocommerce_credentials_invalid");
  return { consumer_key: record.consumer_key, consumer_secret: record.consumer_secret };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "auth_required" }, 401);
  const client = admin();
  const token = authorization.slice("Bearer ".length);
  const userResult = await client.auth.getUser(token);
  if (userResult.error || !userResult.data.user) return json({ error: "auth_required" }, 401);
  const user = userResult.data.user;
  // Carries the caller's JWT so SECURITY DEFINER RPCs see a real auth.uid().
  const scoped = userClient(authorization);

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_request" }, 400);
  const input = body as Input;
  const action = text(input, "action");
  if (!action || !ACTIONS.has(action)) return json({ error: "unsupported_action" }, 400);

  const connectorId = uuid(input, "connector_id");
  let connector: Connector | null = null;
  let businessId = uuid(input, "business_id");
  if (connectorId) {
    const found = await client.from("woocommerce_connectors")
      .select("id,business_id,status,intake_enabled,outbound_enabled,webhook_status,credentials_ref,webhook_secret_ref,expected_webhook_topic,external_store_url")
      .eq("id", connectorId).maybeSingle();
    if (found.error) return json({ error: "connector_lookup_failed" }, 500);
    if (!found.data) return json({ error: "connector_not_found" }, 404);
    connector = found.data as Connector;
    businessId = connector.business_id;
  }
  if (!businessId) return json({ error: "business_id_required" }, 400);

  const membership = await client.from("user_business_access")
    .select("role").eq("business_id", businessId).eq("user_id", user.id).maybeSingle();
  if (membership.error || !membership.data) return json({ error: "forbidden" }, 403);
  const role = membership.data.role as string;
  if (OWNER_ADMIN_ACTIONS.has(action) && role !== "owner" && role !== "admin") return json({ error: "forbidden" }, 403);

  if (action === "create") {
    if (connectorId) return json({ error: "connector_already_exists" }, 409);
    const brandId = uuid(input, "brand_id");
    const storeId = uuid(input, "store_id");
    const orderSourceId = uuid(input, "order_source_id");
    const rawUrl = text(input, "external_store_url");
    const credentialsRef = text(input, "credentials_ref");
    const webhookSecretRef = text(input, "webhook_secret_ref");
    const webhookSecretFingerprint = text(input, "webhook_secret_fingerprint");
    const expectedWebhookTopic = text(input, "expected_webhook_topic") ?? "order.updated";
    if (!brandId || !storeId || !orderSourceId || !rawUrl || !secretRef(credentialsRef) || !secretRef(webhookSecretRef) || !fingerprint(webhookSecretFingerprint) || !WEBHOOK_TOPICS.includes(expectedWebhookTopic)) {
      return json({ error: "invalid_connector_identity" }, 400);
    }
    let externalStoreUrl: string;
    try { externalStoreUrl = normalizeStoreUrl(rawUrl); } catch (error) { return json({ error: error instanceof Error ? error.message : "invalid_external_store_url" }, 400); }
    const inserted = await scoped.rpc("create_woocommerce_connector", {
      p_business_id: businessId,
      p_brand_id: brandId,
      p_store_id: storeId,
      p_order_source_id: orderSourceId,
      p_external_store_url: externalStoreUrl,
      p_credentials_ref: credentialsRef,
      p_webhook_secret_ref: webhookSecretRef,
      p_webhook_secret_fingerprint: webhookSecretFingerprint,
      p_expected_webhook_topic: expectedWebhookTopic,
    });
    if (inserted.error) return json({ error: inserted.error.code === "23505" ? "active_store_already_connected" : inserted.error.message }, 409);
    await audit(client, user, action, inserted.data.id, { brand_id: brandId, order_source_id: orderSourceId });
    return json({ connector: safeConnector(inserted.data as unknown as Record<string, unknown>) }, 201);
  }

  if (!connectorId || !connector) return json({ error: "connector_id_required" }, 400);
  if (action === "view") {
    // Never return credentials_ref or webhook_secret_ref through an API/UI
    // response. Operators only need safe identity, state and fingerprint
    // metadata; secret references remain deployment-managed configuration.
    const result = await client.from("woocommerce_connectors").select(SAFE_CONNECTOR_FIELDS).eq("id", connectorId).single();
    return result.error ? json({ error: result.error.message }, 500) : json({ connector: result.data });
  }
  if (action === "health") {
    // The bounded SQL aggregate is the single source of truth for operator
    // health: webhook state, delivery timestamps, watermark, queue depth/age,
    // retry/dead-letter/quarantine counts and open conflicts. Raw work rows
    // are returned separately for dead-letter/quarantine inspection.
    const [health, work, conflicts] = await Promise.all([
      client.rpc("get_woocommerce_connector_health", { p_connector_id: connectorId }),
      client.from("woocommerce_sync_work").select("id,state,kind,direction,attempt_count,last_error,created_at,lease_expires_at")
        .eq("connector_id", connectorId).in("state", ["dead_letter", "quarantined"]).order("created_at", { ascending: false }).limit(100),
      client.from("woocommerce_sync_conflicts").select(CONFLICT_SELECT)
        .eq("connector_id", connectorId).is("resolution", null).order("created_at", { ascending: false }).limit(100),
    ]);
    if (health.error) return json({ error: health.error.message }, 500);
    return json({
      connector: safeConnector(connector as unknown as Record<string, unknown>),
      health: health.data,
      dead_letters_and_quarantines: work.data ?? [],
      open_conflicts: conflicts.data ?? [],
    });
  }
  if (action === "resolve_conflict") {
    // An operator decision on a sync conflict. The RPC resolves the conflict ->
    // connector -> business -> membership chain from auth.uid(), so it runs on
    // the caller's JWT; the service-role client has no auth.uid() and would be
    // rejected. The connector scoping below keeps the API's own contract: a
    // conflict belonging to another connector is never reachable from here.
    const conflictId = uuid(input, "conflict_id");
    if (!conflictId) return json({ error: "conflict_id_required" }, 400);
    const resolution = text(input, "resolution");
    if (!resolution || !CONFLICT_RESOLUTIONS.includes(resolution)) return json({ error: "unsupported_conflict_resolution" }, 400);
    const note = text(input, "note");
    if (note && note.length > 2000) return json({ error: "conflict_note_too_long" }, 400);
    const owned = await client.from("woocommerce_sync_conflicts").select("id,resolution").eq("id", conflictId).eq("connector_id", connectorId).maybeSingle();
    if (owned.error) return json({ error: "conflict_lookup_failed" }, 500);
    if (!owned.data) return json({ error: "conflict_not_in_connector" }, 404);
    const resolved = await scoped.rpc("resolve_woocommerce_sync_conflict", {
      p_conflict_id: conflictId,
      p_resolution: resolution,
      p_note: note,
    });
    if (resolved.error) return json({ error: resolved.error.message }, 409);
    const result = (resolved.data ?? {}) as { conflict?: unknown; reenqueued_work_id?: string | null; open_conflict_count?: number };
    await audit(client, user, action, connectorId, { conflict_id: conflictId, resolution, reenqueued_work_id: result.reenqueued_work_id ?? null });
    return json({
      conflict: result.conflict ?? null,
      reenqueued_work_id: result.reenqueued_work_id ?? null,
      open_conflict_count: result.open_conflict_count ?? 0,
    });
  }
  if (action === "replay" || action === "correct") {
    const workId = uuid(input, "work_id");
    if (!workId) return json({ error: "work_id_required" }, 400);
    // Both replay and correction are connector-scoped: never allow an operator
    // to act on work belonging to a different connector (or Business).
    const owned = await client.from("woocommerce_sync_work").select("id,state").eq("id", workId).eq("connector_id", connectorId).maybeSingle();
    if (owned.error) return json({ error: "work_lookup_failed" }, 500);
    if (!owned.data) return json({ error: "work_not_in_connector" }, 404);
    if (action === "replay") {
      const replay = await client.rpc("replay_woocommerce_sync_work", { p_work_id: workId });
      if (replay.error) return json({ error: replay.error.message }, 409);
      await audit(client, user, action, connectorId, { work_id: workId });
      return json({ replayed_work_id: replay.data });
    }
    const reason = text(input, "reason");
    if (!reason) return json({ error: "reason_required" }, 400);
    const payload = input.payload;
    if (payload !== undefined && (typeof payload !== "object" || payload === null || Array.isArray(payload))) {
      return json({ error: "invalid_correction_payload" }, 400);
    }
    const corrected = await client.rpc("create_woocommerce_work_correction", {
      p_original_work_id: workId,
      p_reason: reason,
      p_payload: payload ?? {},
    });
    if (corrected.error) return json({ error: corrected.error.message }, 409);
    await audit(client, user, action, connectorId, { work_id: workId, reason });
    return json({ correction_work_id: corrected.data });
  }
  if (action === "rotate_secret") {
    const newRef = text(input, "webhook_secret_ref");
    const newFingerprint = text(input, "webhook_secret_fingerprint");
    const graceSeconds = typeof input.grace_seconds === "number" && Number.isInteger(input.grace_seconds) ? input.grace_seconds : 3600;
    if (!secretRef(newRef) || !fingerprint(newFingerprint)) return json({ error: "invalid_managed_webhook_secret" }, 400);
    const rotated = await scoped.rpc("rotate_woocommerce_webhook_secret", { p_connector_id: connectorId, p_new_secret_ref: newRef, p_new_fingerprint: newFingerprint, p_grace_seconds: graceSeconds });
    if (rotated.error) return json({ error: rotated.error.message }, 409);
    await audit(client, user, action, connectorId, { grace_seconds: graceSeconds });
    return json({ connector: safeConnector(rotated.data as unknown as Record<string, unknown>) });
  }

  if (action === "setup_webhook") {
    // Registers the delivery webhook on the WooCommerce store (Woo REST v3)
    // using the deployment-managed consumer credentials, then binds the
    // returned webhook id to the connector. Nothing secret is stored — the
    // signing secret lives in the deployment environment under
    // webhook_secret_ref and is passed to Woo once at registration.
    const topic = text(input, "topic") ?? connector.expected_webhook_topic ?? "order.updated";
    if (!WEBHOOK_TOPICS.includes(topic)) return json({ error: "unsupported_webhook_topic" }, 400);
    if (!connector.credentials_ref || !connector.webhook_secret_ref || !connector.external_store_url) {
      return json({ error: "connector_identity_incomplete" }, 409);
    }
    let credentials: { consumer_key: string; consumer_secret: string };
    let secret: string;
    try {
      credentials = wooCredentials(connector.credentials_ref);
      secret = Deno.env.get(connector.webhook_secret_ref) ?? "";
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "woocommerce_credentials_unavailable" }, 409);
    }
    if (!secret) return json({ error: "webhook_secret_unavailable" }, 409);
    const deliveryUrl = `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/woocommerce-webhook`;
    const token = btoa(`${credentials.consumer_key}:${credentials.consumer_secret}`);
    const storeBase = connector.external_store_url.replace(/\/$/, "");
    let webhookRow: { id?: number; status?: string } | null = null;
    try {
      const webhookResult = await fetch(`${storeBase}/wp-json/wc/v3/webhooks`, {
        method: "POST",
        headers: { Authorization: `Basic ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: "DokanOS Order Sync", topic, delivery_url: deliveryUrl, secret }),
      });
      if (!webhookResult.ok) {
        const detail = await webhookResult.text().catch(() => "");
        return json({ error: "webhook_registration_failed", status: webhookResult.status, detail: detail.slice(0, 500) }, 502);
      }
      const payload: unknown = await webhookResult.json();
      if (!payload || typeof payload !== "object") return json({ error: "webhook_registration_failed" }, 502);
      webhookRow = payload as { id?: number; status?: string };
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "webhook_registration_failed" }, 502);
    }
    const webhookId = typeof webhookRow?.id === "number" ? webhookRow.id : null;
    if (!webhookId) return json({ error: "webhook_registration_failed" }, 502);
    const bound = await client.from("woocommerce_connectors").update({
      expected_webhook_id: webhookId,
      expected_webhook_topic: topic,
      expected_delivery_url: deliveryUrl,
      webhook_status: webhookRow?.status === "paused" ? "paused" : "active",
      last_error: null,
      error_class: null,
    }).eq("id", connectorId).select("id,expected_webhook_id,webhook_status,expected_webhook_topic").single();
    if (bound.error) return json({ error: bound.error.message }, 500);
    await audit(client, user, action, connectorId, { webhook_id: webhookId, topic });
    return json({ connector: bound.data });
  }

  if (TRANSITIONS.includes(action)) {
    const reason = text(input, "reason");
    const transitioned = await scoped.rpc("transition_woocommerce_connector", {
      p_connector_id: connectorId,
      p_action: action,
      p_reason: reason,
    });
    if (transitioned.error) return json({ error: transitioned.error.message }, 409);
    await audit(client, user, action, connectorId, { reason });
    return json({ connector: safeConnector(transitioned.data as unknown as Record<string, unknown>) });
  }

  if (action === "update") {
    if (input.webhook_secret_ref !== undefined || input.webhook_secret_fingerprint !== undefined) return json({ error: "use_rotate_secret_for_webhook_secret" }, 400);
    let externalStoreUrl: string | null = null;
    if (input.external_store_url !== undefined) {
      const rawUrl = text(input, "external_store_url");
      if (!rawUrl) return json({ error: "invalid_external_store_url" }, 400);
      try { externalStoreUrl = normalizeStoreUrl(rawUrl); } catch (error) { return json({ error: error instanceof Error ? error.message : "invalid_external_store_url" }, 400); }
    }
    let credentialsRef: string | null = null;
    if (input.credentials_ref !== undefined) { credentialsRef = text(input, "credentials_ref"); if (!secretRef(credentialsRef)) return json({ error: "invalid_secret_reference" }, 400); }
    const expectedWebhookId = typeof input.expected_webhook_id === "number" && Number.isSafeInteger(input.expected_webhook_id) ? input.expected_webhook_id : null;
    const expectedWebhookTopic = text(input, "expected_webhook_topic");
    if (!externalStoreUrl && !credentialsRef && expectedWebhookId === null && !expectedWebhookTopic) return json({ error: "no_update_fields" }, 400);
    const updated = await scoped.rpc("update_woocommerce_connector", {
      p_connector_id: connectorId,
      p_external_store_url: externalStoreUrl,
      p_credentials_ref: credentialsRef,
      p_expected_webhook_id: expectedWebhookId,
      p_expected_webhook_topic: expectedWebhookTopic,
    });
    if (updated.error) return json({ error: updated.error.code === "23505" ? "active_store_already_connected" : updated.error.message }, 409);
    await audit(client, user, action, connectorId, { fields: [externalStoreUrl ? "external_store_url" : null, credentialsRef ? "credentials_ref" : null, expectedWebhookId !== null ? "expected_webhook_id" : null, expectedWebhookTopic ? "expected_webhook_topic" : null].filter(Boolean) });
    return json({ connector: safeConnector(updated.data as unknown as Record<string, unknown>) });
  }

  return json({ error: "unsupported_action" }, 400);
});
