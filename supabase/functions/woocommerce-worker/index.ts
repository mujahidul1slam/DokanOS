import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { decideWorkFailure, type WorkFailureDecision } from "../../../src/lib/woocommerceWork.ts";
import {
  expandWooCategoryIds,
  hasWooPreOrderItem,
  isWooProductPreOrder,
  mapWooFulfillmentType,
  mapWooLocalStatus,
  mapWooPaymentStatus,
  type WooLocalCategoryRef,
} from "../../../src/lib/woocommerceConnector.ts";
import { assertOutboundWritePersisted, serializeWorkerFailure, validateFinishResult, validateOutboundConfirmation } from "../../../src/lib/woocommerceWorkerValidation.ts";
export { assertOutboundWritePersisted, serializeWorkerFailure, validateFinishResult, validateOutboundConfirmation } from "../../../src/lib/woocommerceWorkerValidation.ts";

const TERMINAL = new Set(["cancelled", "refunded", "failed", "trash"]);
const encoder = new TextEncoder();

type Work = {
  id: string;
  connector_id: string;
  kind: string;
  direction: string;
  external_order_id: number | null;
  attempt_count: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  related_delivery_id: string | null;
};

type Connector = {
  id: string;
  external_store_url: string;
  credentials_ref: string;
  business_id: string;
  brand_id: string;
  store_id: string;
  order_source_id: string;
};

// The subset of the WooCommerce v3 order representation that the worker
// consumes. Keeping it explicit (instead of `any`) preserves lint hygiene and
// documents exactly which external facts are trusted.
type WooAddress = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
};

type WooOrder = {
  id: number | string;
  status?: string;
  number?: string | number;
  total?: string | number;
  subtotal?: string | number;
  shipping_total?: string | number;
  discount_total?: string | number;
  payment_method?: string;
  currency?: string;
  customer_note?: string;
  date_created_gmt?: string;
  date_created?: string;
  date_modified_gmt?: string;
  date_modified?: string;
  billing?: WooAddress;
  line_items?: unknown[];
  shipping_lines?: Array<{ method_id?: string; method_title?: string }>;
};

// The subset of the WooCommerce v3 product representation the product import
// consumes. `categories` is retained for the pre-order lookup that already
// uses currentProduct(); the remaining fields feed upsert_woocommerce_product.
type WooProduct = {
  id: number | string;
  type?: string;
  name?: string;
  sku?: string;
  description?: string;
  short_description?: string;
  price?: string | number;
  regular_price?: string | number;
  sale_price?: string | number;
  manage_stock?: boolean;
  stock_quantity?: number;
  stock_status?: string;
  backorders?: string;
  date_modified_gmt?: string;
  date_modified?: string;
  images?: Array<{ src?: string }>;
  attributes?: unknown;
  categories?: unknown;
};

function sb() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function workerId(): string {
  return `woocommerce-worker:${crypto.randomUUID()}`;
}

function credentials(ref: string): { consumer_key: string; consumer_secret: string } {
  const raw = Deno.env.get(ref);
  if (!raw) throw new Error("woocommerce_credentials_unavailable");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || typeof (parsed as Record<string, unknown>).consumer_key !== "string" || typeof (parsed as Record<string, unknown>).consumer_secret !== "string") {
    throw new Error("woocommerce_credentials_invalid");
  }
  return parsed as { consumer_key: string; consumer_secret: string };
}

async function currentOrder(connector: Connector, id: number): Promise<WooOrder> {
  const auth = credentials(connector.credentials_ref);
  const url = `${connector.external_store_url.replace(/\/$/, "")}/wp-json/wc/v3/orders/${encodeURIComponent(String(id))}`;
  const token = btoa(`${auth.consumer_key}:${auth.consumer_secret}`);
  const result = await fetch(url, { headers: { Authorization: `Basic ${token}`, Accept: "application/json" } });
  if (!result.ok) {
    const error = new Error(`woocommerce_http_${result.status}`);
    (error as Error & { status?: number }).status = result.status;
    throw error;
  }
  const value: unknown = await result.json();
  if (!value || typeof value !== "object") throw new Error("woocommerce_invalid_order_payload");
  return value as WooOrder;
}

function shippingMethod(external: WooOrder): { method: string | null; title: string | null } {
  const line = external.shipping_lines?.[0];
  return { method: line?.method_id || null, title: line?.method_title || null };
}

async function currentProduct(connector: Connector, productId: number): Promise<{ categories?: unknown }> {
  return fetchWooProduct(connector, productId);
}

/**
 * Fetch one product with the same authenticated transport as currentOrder.
 * Kept separate from currentProduct() so the pre-order routing path (which
 * only needs categories) is untouched by the import path.
 */
async function fetchWooProduct(connector: Connector, productId: number): Promise<WooProduct> {
  const auth = credentials(connector.credentials_ref);
  const url = `${connector.external_store_url.replace(/\/$/, "")}/wp-json/wc/v3/products/${encodeURIComponent(String(productId))}`;
  const token = btoa(`${auth.consumer_key}:${auth.consumer_secret}`);
  const result = await fetch(url, { headers: { Authorization: `Basic ${token}`, Accept: "application/json" } });
  if (!result.ok) {
    const error = new Error(`woocommerce_http_${result.status}`);
    (error as Error & { status?: number }).status = result.status;
    throw error;
  }
  const value: unknown = await result.json();
  if (!value || typeof value !== "object") throw new Error("woocommerce_invalid_product_payload");
  return value as WooProduct;
}

/**
 * Fetch every variation of a variable product. `per_page=100` keeps the common
 * case to one request; the worker calls this only for `type=variable`.
 */
async function fetchWooProductVariations(connector: Connector, productId: number): Promise<WooProduct[]> {
  const auth = credentials(connector.credentials_ref);
  const url = `${connector.external_store_url.replace(/\/$/, "")}/wp-json/wc/v3/products/${encodeURIComponent(String(productId))}/variations?per_page=100`;
  const token = btoa(`${auth.consumer_key}:${auth.consumer_secret}`);
  const result = await fetch(url, { headers: { Authorization: `Basic ${token}`, Accept: "application/json" } });
  if (!result.ok) {
    const error = new Error(`woocommerce_http_${result.status}`);
    (error as Error & { status?: number }).status = result.status;
    throw error;
  }
  const value: unknown = await result.json();
  if (!Array.isArray(value)) throw new Error("woocommerce_invalid_variations_payload");
  return value as WooProduct[];
}

/**
 * Resolve which configured pre-order categories apply. Configured ids are
 * local category UUIDs; fetch them with their `woo_category_id` and descendants
 * so a parent selection covers its subcategories. Missing/unreadable config is
 * fail-closed (no pre-order) with a warning, and never stops the order import.
 */
async function preorderContext(
  client: ReturnType<typeof sb>,
): Promise<{ ids: ReadonlySet<string>; categories: WooLocalCategoryRef[] }> {
  try {
    const settingResult = await client.from("app_settings").select("value").eq("key", "preorder_category_ids").maybeSingle();
    if (settingResult.error) throw settingResult.error;
    const raw = settingResult.data?.value as unknown;
    const idsValue = raw && typeof raw === "object" ? (raw as Record<string, unknown>).ids : null;
    const ids = Array.isArray(idsValue)
      ? idsValue.filter((id): id is string => typeof id === "string")
      : [];
    if (ids.length === 0) return { ids: new Set(), categories: [] };
    const categoryResult = await client.from("categories").select("id,parent_id,woo_category_id,slug,name");
    if (categoryResult.error) throw categoryResult.error;
    const categories = (categoryResult.data ?? []) as WooLocalCategoryRef[];
    return { ids: expandWooCategoryIds(ids, categories), categories };
  } catch (cause) {
    console.warn("woocommerce_preorder_lookup_failed; treating order as not pre-order", cause);
    return { ids: new Set(), categories: [] };
  }
}

/**
 * Inspect the order's line items. Woo line items carry a product_id (and
 * optionally a parent product_id for variations), never categories; so fetch
 * each product to read its authoritative categories. Any lookup failure is
 * fail-closed with a warning rather than dropping the order.
 */
async function isPreOrderOrder(
  client: ReturnType<typeof sb>,
  connector: Connector,
  items: unknown[],
): Promise<boolean> {
  const { ids, categories } = await preorderContext(client);
  if (ids.size === 0) return false;
  // Legacy line items that do embed categories can still be honoured directly.
  if (hasWooPreOrderItem(items, ids)) return true;
  const productIds = new Set<number>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    // Woo line items carry the variable product in `product_id` and the
    // variation in `variation_id`; the product endpoint is keyed by product_id.
    // `parent_id` is accepted as a fallback for adapters that fill it instead.
    const line = item as { product_id?: unknown; parent_id?: unknown };
    const productId = Number(line.product_id);
    const parentId = Number(line.parent_id);
    const id = Number.isSafeInteger(productId) && productId > 0
      ? productId
      : parentId;
    if (Number.isSafeInteger(id) && id > 0) productIds.add(id);
  }
  for (const productId of productIds) {
    try {
      const product = await currentProduct(connector, productId);
      if (isWooProductPreOrder(product.categories, categories, ids)) return true;
    } catch (cause) {
      console.warn(`woocommerce_preorder_product_lookup_failed for product ${productId}; treating as not pre-order`, cause);
    }
  }
  return false;
}

function localStatus(externalStatus: string, isPreOrder: boolean): string {
  return mapWooLocalStatus(externalStatus, isPreOrder);
}

function paymentStatus(externalStatus: string, paymentMethod: string | null | undefined): string {
  return mapWooPaymentStatus(externalStatus, paymentMethod);
}

async function writeExternalStatus(connector: Connector, externalOrderId: number, payload: Record<string, unknown>): Promise<void> {
  const auth = credentials(connector.credentials_ref);
  const targetStatus = typeof payload.target_status === "string" ? payload.target_status : "";
  if (!["processing", "completed", "cancelled"].includes(targetStatus)) throw new Error("unsupported_outbound_status");
  const url = `${connector.external_store_url.replace(/\/$/, "")}/wp-json/wc/v3/orders/${encodeURIComponent(String(externalOrderId))}`;
  const token = btoa(`${auth.consumer_key}:${auth.consumer_secret}`);
  const result = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Basic ${token}`, Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ status: targetStatus }),
  });
  if (!result.ok) {
    const error = new Error(`woocommerce_http_${result.status}`);
    (error as Error & { status?: number }).status = result.status;
    throw error;
  }
  const confirmation: unknown = await result.json();
  validateOutboundConfirmation(confirmation, targetStatus);
}

async function persistOrder(client: ReturnType<typeof sb>, connector: Connector, external: WooOrder): Promise<void> {
  const externalId = Number(external.id);
  const status = String(external.status ?? "");
  if (!Number.isSafeInteger(externalId) || !status) throw new Error("woocommerce_order_identity_invalid");
  if (!["pending", "on-hold", "processing", "completed", "cancelled", "refunded", "failed", "trash"].includes(status)) throw new Error("woocommerce_unsupported_status");
  // Never manufacture a freshness timestamp: an absent Woo timestamp must not
  // make an older observation appear newer than the trusted identity watermark.
  const modified = external.date_modified_gmt || external.date_modified || null;
  const billing: WooAddress = external.billing ?? {};
  const items = Array.isArray(external.line_items) ? external.line_items : [];
  const isPreOrder = await isPreOrderOrder(client, connector, items);
  const { error } = await client.rpc("upsert_woocommerce_order_v2", {
    p_connector_id: connector.id,
    p_external_order_id: externalId,
    p_external_order_number: external.number ? String(external.number) : null,
    p_external_status: status,
    p_external_modified_at: modified,
    p_total: Number(external.total ?? 0),
    p_subtotal: Number(external.total ?? 0) - Number(external.shipping_total ?? 0) - Number(external.discount_total ?? 0),
    p_discount: Number(external.discount_total ?? 0),
    p_shipping: Number(external.shipping_total ?? 0),
    p_payment_method: external.payment_method || "online",
    p_local_status: localStatus(status, isPreOrder),
    p_payment_status: paymentStatus(status, external.payment_method),
    p_fulfillment_type: mapWooFulfillmentType(shippingMethod(external).method, shippingMethod(external).title),
    p_is_preorder: isPreOrder,
    p_customer_name: [billing.first_name, billing.last_name].filter(Boolean).join(" "),
    p_customer_email: billing.email || null,
    p_customer_phone: billing.phone || null,
    p_customer_address: [billing.address_1, billing.address_2].filter(Boolean).join(", ") || null,
    p_customer_city: billing.city || null,
    p_customer_zone: billing.state || null,
    p_customer_area: billing.postcode || null,
    p_notes: external.customer_note || null,
    p_created_at: external.date_created_gmt || external.date_created || null,
    p_items: items,
    p_safe_external_facts: {
      status,
      payment_method: external.payment_method || null,
      currency: external.currency || null,
      total: external.total || null,
      date_created: external.date_created || null,
      date_modified: external.date_modified || null,
    },
  });
  if (error) throw error;
}
export async function processWooCommerceWork(client: ReturnType<typeof sb>, work: Work): Promise<void> {
  const connectorResult = await client.from("woocommerce_connectors").select("id,external_store_url,credentials_ref,business_id,brand_id,store_id,order_source_id,status,intake_enabled,outbound_enabled").eq("id", work.connector_id).single();
  if (connectorResult.error) throw connectorResult.error;
  const connector = connectorResult.data as Connector & { status: string; intake_enabled: boolean; outbound_enabled: boolean };
  if ((work.direction === "outbound" || work.kind === "status_write") && (!connector.outbound_enabled || ["paused", "disabled", "quarantined", "rolled_back"].includes(connector.status))) {
    throw new Error("woocommerce_outbound_contained");
  }
  if (work.direction !== "outbound" && work.kind !== "status_write" && (!connector.intake_enabled || ["paused", "disabled", "quarantined", "rolled_back"].includes(connector.status))) {
    throw new Error("woocommerce_intake_contained");
  }
  if (work.direction === "outbound" || work.kind === "status_write") {
    if (!Number.isSafeInteger(work.external_order_id)) throw new Error("missing_external_order_id");
    await writeExternalStatus(connector, work.external_order_id!, work.payload);
    if (typeof work.payload.outbound_write_id === "string") {
      const updateResult = await client.from("woocommerce_outbound_writes")
        .update({ state: "succeeded", response_metadata: { confirmed_status: work.payload.target_status } }, { count: "exact" })
        .eq("id", work.payload.outbound_write_id);
      assertOutboundWritePersisted(updateResult);
    }
    return;
  }
  // Product import is a separate inbound product path. Handle it before the
  // order-kind gate, which still requires an external ORDER id for webhook /
  // order_refresh / reconciliation work.
  if (work.kind === "product_import") {
    const productId = work.external_order_id;
    if (!Number.isSafeInteger(productId) || productId === null || productId <= 0) throw new Error("missing_external_product_id");
    const product = await fetchWooProduct(connector, productId);
    const variations = product.type === "variable"
      ? await fetchWooProductVariations(connector, productId)
      : [];
    const payload = { ...product, variations_data: variations };
    const modified = product.date_modified_gmt || product.date_modified || null;
    const { error: productError } = await client.rpc("upsert_woocommerce_product", {
      p_connector_id: connector.id,
      p_external_product_id: productId,
      p_payload: payload,
      p_modified_at: modified,
    });
    if (productError) throw productError;
    return;
  }
  // Reconciliation deliberately uses the same current-state import path as a
  // webhook refresh. Keep the durable direction/kind vocabulary compatible
  // with both the reconciler and replayed work from older migrations.
  if (work.kind !== "webhook" && work.kind !== "order_refresh" && work.kind !== "reconciliation") throw new Error("unsupported_work_kind");
  if (!Number.isSafeInteger(work.external_order_id)) throw new Error("missing_external_order_id");
  let order: WooOrder;
  try {
    order = await currentOrder(connectorResult.data as Connector, work.external_order_id!);
  } catch (cause) {
    const status = (cause as Error & { status?: number }).status;
    if (status === 404) {
      const { error } = await client.rpc("record_woocommerce_external_deletion", {
        p_connector_id: connectorResult.data.id,
        p_external_order_id: work.external_order_id,
      });
      if (error) throw error;
      return;
    }
    throw cause;
  }
  const externalStatus = typeof order.status === "string" ? order.status : null;
  if (!["pending", "on-hold", "processing", "completed", "cancelled", "refunded", "failed", "trash"].includes(externalStatus ?? "")) {
    await client.rpc("record_woocommerce_sync_observation", {
      p_connector_id: connectorResult.data.id,
      p_external_order_id: work.external_order_id,
      p_reason: "unsupported_status",
      p_external_state: { status: externalStatus, order: { id: order.id, modified: order.date_modified_gmt ?? order.date_modified ?? null } },
    });
    throw new Error("woocommerce_unsupported_status");
  }
  await persistOrder(client, connectorResult.data as Connector, order);
  // A webhook carrying the status we requested is acknowledgement evidence,
  // not a new local transition. Mark the matching write complete so this
  // delivery cannot enqueue an outbound echo.
  await client.from("woocommerce_outbound_writes")
    .update({
      state: "succeeded",
      response_metadata: {
        confirmed_status: order.status,
        confirmed_external_order_id: order.id,
        acknowledged_by: "woocommerce_webhook",
      },
    })
    .eq("connector_id", work.connector_id)
    .eq("external_order_id", work.external_order_id)
    .eq("target_status", String(order.status))
    .in("state", ["pending", "retrying"]);
}

function isLeaseLost(cause: unknown): boolean {
  if (cause instanceof Error) return cause.message === "work_lease_lost";
  return typeof cause === "object" && cause !== null && (cause as { message?: unknown }).message === "work_lease_lost";
}

function isValidStatus(status: unknown): status is number {
  return typeof status === "number" && Number.isFinite(status);
}

/**
 * Mistakes in the worker's own request, or external facts the connector cannot
 * represent, arrive as plain Errors with no HTTP status. They can never succeed
 * on retry, so they quarantine instead of burning the attempt budget. An
 * unrecognised no-status failure stays transient (transport) and is retried.
 */
function isLocalPermanentFailure(message: string): boolean {
  return /^woocommerce_(unsupported_status|intake_contained|outbound_contained)$/.test(message);
}

function decideFailure(status: unknown, message: string, attemptCount: number, maxAttempts: number): WorkFailureDecision {
  // Status codes are authoritative; the message heuristic never overrides one.
  if (isValidStatus(status)) return decideWorkFailure(status, attemptCount, maxAttempts);
  return isLocalPermanentFailure(message)
    ? { state: "quarantined", errorClass: "permanent", retryable: false }
    : decideWorkFailure(null, attemptCount, maxAttempts);
}

async function schedulerAuthorized(req: Request, client: ReturnType<typeof sb>): Promise<boolean> {
  const provided = req.headers.get("x-woocommerce-scheduler-secret");
  if (!provided) return false;
  // The existing production pg_cron jobs read the managed Vault secret
  // `sync_worker_cron_token`; resolve that same value through the service-role
  // getter instead of requiring a second, drift-prone Edge Function secret.
  const token = await client.rpc("get_sync_worker_cron_token");
  const expected = typeof token.data === "string" ? token.data : null;
  if (token.error || !expected || expected.length !== provided.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return difference === 0;
}

type RpcResult<T> = { data: T; error: { message: string } | null };

async function run(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  const client = sb();
  if (!await schedulerAuthorized(req, client)) return new Response("unauthorized", { status: 401 });
  const owner = workerId();
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 20)));
  const { data: works, error } = await client.rpc("claim_woocommerce_sync_work", { p_owner: owner, p_limit: limit });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 503 });

  const results = [];
  for (const work of (works ?? []) as Work[]) {
    try {
      const heartbeat = await client.rpc("heartbeat_woocommerce_sync_work", {
        p_work_id: work.id,
        p_owner: owner,
        p_lease_seconds: 120,
      });
      if (heartbeat.error || heartbeat.data !== true) throw new Error("work_lease_lost");
      await processWooCommerceWork(client, work);
      const finishResult = await client.rpc("finish_woocommerce_sync_work", { p_work_id: work.id, p_owner: owner, p_state: "succeeded" });
      validateFinishResult(finishResult);
      if (work.related_delivery_id) await client.rpc("mark_woocommerce_delivery_processed", { p_delivery_id: work.related_delivery_id });
      results.push({ id: work.id, state: "succeeded" });
    } catch (cause) {
      const leaseLost = isLeaseLost(cause);
      const message = serializeWorkerFailure(cause);
      // Failure classification is owned by src/lib/woocommerceWork.ts so the
      // unit tests exercise the same decision the worker runs.
      const decision = decideFailure((cause as Error & { status?: number }).status, message, work.attempt_count, work.max_attempts);
      // Backoff is authoritative in SQL: finish_woocommerce_sync_work computes
      // next_attempt_at (2^attempt_count seconds, jittered, capped at 900) when
      // the state is retrying, so the worker never computes or passes a delay.
      const finishResult = await client.rpc("finish_woocommerce_sync_work", {
        p_work_id: work.id,
        p_owner: owner,
        p_state: decision.state,
        p_error_class: decision.errorClass,
        p_error: message.slice(0, 1000),
      });
      if (finishResult.error) {
        results.push({ id: work.id, state: "finish_failed" });
        continue;
      }
      if (finishResult.data !== true) {
        results.push({ id: work.id, state: "finish_failed" });
        continue;
      }
      // A lost lease means finish_woocommerce_sync_work refuses the write
      // (lease_owner no longer matches); the row belongs to another worker.
      results.push({ id: work.id, state: leaseLost ? "lease_lost" : decision.state });
    }
  }
  return new Response(JSON.stringify({ owner, claimed: results.length, results }), { headers: { "content-type": "application/json" } });
}

Deno.serve(run);
