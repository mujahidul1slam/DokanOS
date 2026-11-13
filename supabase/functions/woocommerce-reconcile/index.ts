import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { serializeWorkerFailure } from "../../../src/lib/woocommerceWorkerValidation.ts";
import {
  buildReconciliationWindow,
  classifyReconciliationFailure,
  nextWooPageUrl,
  reconciliationRequestUrl,
} from "../../../src/lib/woocommerceReconciliation.ts";

function sb() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function credentials(ref: string): { consumer_key: string; consumer_secret: string } {
  const value = Deno.env.get(ref);
  if (!value) throw new Error("woocommerce_credentials_unavailable");
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("woocommerce_credentials_invalid");
  const record = parsed as Record<string, unknown>;
  if (typeof record.consumer_key !== "string" || typeof record.consumer_secret !== "string") throw new Error("woocommerce_credentials_invalid");
  return { consumer_key: record.consumer_key, consumer_secret: record.consumer_secret };
}

type Connector = {
  id: string;
  external_store_url: string;
  credentials_ref: string;
  reconciliation_watermark: string | null;
};

type Order = Record<string, unknown>;

function stableOrders(values: unknown[]): Order[] {
  return values
    .filter((value): value is Order => Boolean(value) && typeof value === "object")
    .sort((left, right) => {
      const leftModified = String(left.date_modified_gmt ?? left.date_modified ?? "");
      const rightModified = String(right.date_modified_gmt ?? right.date_modified ?? "");
      return leftModified.localeCompare(rightModified) || Number(left.id ?? 0) - Number(right.id ?? 0);
    });
}

async function schedulerAuthorized(req: Request, client: ReturnType<typeof sb>): Promise<boolean> {
  const provided = req.headers.get("x-woocommerce-scheduler-secret");
  if (!provided) return false;
  // Match the production pg_cron jobs, which read the managed Vault secret
  // `sync_worker_cron_token`; this avoids a second scheduler-secret drift path.
  const token = await client.rpc("get_sync_worker_cron_token");
  const expected = typeof token.data === "string" ? token.data : null;
  if (token.error || !expected || expected.length !== provided.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  return difference === 0;
}

async function scanConnector(client: ReturnType<typeof sb>, connector: Connector): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const window = buildReconciliationWindow(connector.reconciliation_watermark, now);
  const run = await client.from("woocommerce_reconciliation_runs").insert({
    connector_id: connector.id,
    watermark_before: window.watermarkBefore,
    window_start: window.start,
    window_end: window.end,
  }).select("id").single();
  if (run.error) throw run.error;

  let url: string | null = reconciliationRequestUrl(connector.external_store_url, window);
  const auth = credentials(connector.credentials_ref);
  const token = btoa(`${auth.consumer_key}:${auth.consumer_secret}`);
  let pages = 0;
  let discovered = 0;
  let enqueued = 0;
  const metadata: unknown[] = [];
  try {
    while (url) {
      const requestUrl = url;
      const result = await fetch(requestUrl, { redirect: "manual", headers: { Authorization: `Basic ${token}`, Accept: "application/json" } });
      if (result.status >= 300 && result.status < 400) {
        const location = result.headers.get("location");
        if (!location) throw new Error("woocommerce_redirect_location_missing");
        nextWooPageUrl(requestUrl, `<${location}>; rel="next"`, connector.external_store_url);
        throw new Error("woocommerce_redirect_requires_manual_follow");
      }
      if (!result.ok) {
        const error = new Error(`woocommerce_http_${result.status}`);
        (error as Error & { status?: number }).status = result.status;
        throw error;
      }
      const payload: unknown = await result.json();
      if (!Array.isArray(payload)) throw new Error("woocommerce_invalid_collection");
      const orders = stableOrders(payload);
      pages += 1;
      discovered += orders.length;
      for (const order of orders) {
        const externalId = Number(order.id);
        if (!Number.isSafeInteger(externalId)) continue;
        // Missing WooCommerce timestamps are not fresh observations; keep their identity stable.
        const modifiedValue = order.date_modified_gmt ?? order.date_modified;
        const modified = typeof modifiedValue === "string" && modifiedValue.length > 0 ? modifiedValue : null;
        const identityComponent = modified ?? "unknown";
        const queued = await client.rpc("enqueue_woocommerce_reconciliation_work", {
          p_connector_id: connector.id,
          p_external_order_id: externalId,
          p_identity_key: `reconcile:${externalId}:${identityComponent}`,
          p_payload: { source: "reconciliation", external_order_id: externalId, modified_at: modified },
        });
        if (queued.error) throw queued.error;
        if (queued.data === true) enqueued += 1;
      }
      metadata.push({ url: requestUrl, status: result.status, count: orders.length, next: result.headers.get("link") });
      url = nextWooPageUrl(requestUrl, result.headers.get("link"), connector.external_store_url);
    }
    const completedAt = new Date().toISOString();
    const updated = await client.from("woocommerce_reconciliation_runs").update({
      watermark_after: window.end, pages, requests: pages, discovered, enqueued,
      page_metadata: metadata, state: "succeeded", completed_at: completedAt,
    }).eq("id", run.data.id);
    if (updated.error) throw updated.error;
    const health = await client.from("woocommerce_connectors").update({
      reconciliation_watermark: window.end, last_reconciliation_at: completedAt,
      status: "healthy", last_error: null, error_class: null,
    }).eq("id", connector.id);
    if (health.error) throw health.error;
    return { connector_id: connector.id, state: "succeeded", pages, requests: pages, discovered, enqueued, watermark_after: window.end };
  } catch (cause) {
    const message = serializeWorkerFailure(cause);
    const status = (cause as Error & { status?: number }).status ?? null;
    const errorClass = classifyReconciliationFailure(status);
    await client.from("woocommerce_reconciliation_runs").update({
      pages, requests: pages, discovered, enqueued, page_metadata: metadata,
      state: "failed", failure_count: 1, error_class: errorClass,
      last_error: message.slice(0, 1000), completed_at: new Date().toISOString(),
    }).eq("id", run.data.id);
    await client.from("woocommerce_connectors").update({ status: "degraded", last_error: message.slice(0, 1000), error_class: errorClass }).eq("id", connector.id);
    throw cause;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  const client = sb();
  if (!await schedulerAuthorized(req, client)) return new Response("unauthorized", { status: 401 });
  const { data: connectors, error } = await client.from("woocommerce_connectors")
    .select("id,external_store_url,credentials_ref,reconciliation_watermark")
    .eq("intake_enabled", true).in("status", ["healthy", "degraded"]);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 503 });
  const results: Record<string, unknown>[] = [];
  for (const connector of (connectors ?? []) as Connector[]) {
    try { results.push(await scanConnector(client, connector)); }
    catch (cause) { results.push({ connector_id: connector.id, state: "failed", error: serializeWorkerFailure(cause) }); }
  }
  return new Response(JSON.stringify({ results }), { headers: { "content-type": "application/json" } });
});
