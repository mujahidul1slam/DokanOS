import { createClient } from "npm:@supabase/supabase-js@2.49.4";
// Revamp 2.5: the ~60-entry Pathao status map now lives in the adapter.
import { legacyStatusFor, canonicalStatusFor } from "../adapters/pathao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const PATHAO_BASE = "https://api-hermes.pathao.com";

// In-memory token cache per integration (lives for the function's runtime)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// Legacy order-status bucket mapper (shipped/delivered/returned/cancelled/
// processing) — delegates to the adapter's status map.
function mapPathaoStatus(status: string | null | undefined): string | undefined {
  const mapped = legacyStatusFor(status);
  if (!mapped && status) {
    console.warn(`[pathao-courier] Unmapped Pathao status: "${status}"`);
  }
  return mapped;
}

// Revamp 2.1: keep courier_shipments (the provider-agnostic shipment record)
// in lockstep with the legacy orders.* fields the UI reads today. Best-effort
// by design — a failure here must never fail dispatch/tracking.
async function upsertShipmentRow(
  sb: ReturnType<typeof supabaseAdmin>,
  row: {
    order_id: string;
    consignment_id: string;
    integration_id: string | null;
    raw_status?: string | null;
    canonical_status?: string | null;
    last_tracked_at?: string | null;
    cancelled_at?: string | null;
  },
): Promise<void> {
  try {
    const payload: Record<string, any> = {
      order_id: row.order_id,
      provider: "pathao",
      integration_id: row.integration_id && row.integration_id !== "env" ? row.integration_id : null,
      consignment_id: row.consignment_id,
      raw_status: row.raw_status ?? null,
      canonical_status: row.canonical_status ?? null,
      last_tracked_at: row.last_tracked_at ?? new Date().toISOString(),
    };
    if (row.cancelled_at !== undefined) {
      payload.cancelled_at = row.cancelled_at;
    }
    const { error } = await sb.from("courier_shipments").upsert(payload, { onConflict: "provider,consignment_id" });
    if (error) console.warn(`[pathao-courier] courier_shipments upsert warn: ${error.message}`);
  } catch (e: unknown) {
    console.warn(`[pathao-courier] courier_shipments upsert failed: ${(e as Error)?.message || e}`);
  }
}

// Enqueue a push_order so the linked WooCommerce order gets marked completed
// once the Pathao cycle terminates (delivered/returned). Uses the new
// store-aware queue — store_id is NOT NULL, so it must be looked up from the
// order before enqueueing.
async function pushOrderStatusToWoo(sb: any, orderId: string): Promise<void> {
  const { data: order, error: orderErr } = await sb
    .from("orders")
    .select("store_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order?.store_id) {
    throw new Error(
      `Cannot queue woo-push for order ${orderId}: ${orderErr?.message || "no store_id"}`,
    );
  }
  const { error } = await sb.from("sync_queue").insert({
    store_id: order.store_id,
    order_id: orderId,
    action: "push_order",
    payload: { order_id: orderId },
  });
  if (error) {
    throw new Error(`Failed to queue woo-push: ${error.message}`);
  }
}

// Post a note on the WooCommerce order (silently no-ops if not Woo-linked)
async function postWooOrderNote(orderId: string, note: string): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    await fetch(`${supabaseUrl}/functions/v1/woo-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ action: "post_note", order_id: orderId, note }),
    });
  } catch (e) {
    console.warn("postWooOrderNote failed:", e);
  }
}

interface PathaoCreds {
  id: string;
  client_id: string;
  client_secret: string;
  username: string;
  password: string;
}

function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function loadIntegration(sb: ReturnType<typeof supabaseAdmin>, integrationId?: string): Promise<PathaoCreds> {
  let q = sb.from("pathao_integrations").select("id, client_id, client_secret, username, password").eq("is_active", true);
  if (integrationId) q = q.eq("id", integrationId);
  // Deterministic pick: without an explicit ORDER BY, "limit 1" returned an
  // arbitrary active integration per invocation — with multiple merchants that
  // meant random credentials for default-token calls (location lists, price
  // checks, token bootstrap). created_at makes the oldest active integration
  // the stable default.
  const { data, error } = await q.order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error || !data) {
    // Fallback to env vars (legacy)
    const envCreds = {
      id: "env",
      client_id: Deno.env.get("PATHAO_CLIENT_ID") || "",
      client_secret: Deno.env.get("PATHAO_CLIENT_SECRET") || "",
      username: Deno.env.get("PATHAO_USERNAME") || "",
      password: Deno.env.get("PATHAO_PASSWORD") || "",
    };
    if (!envCreds.client_id) throw new Error("No Pathao integration found");
    return envCreds;
  }
  return data as PathaoCreds;
}

async function getAccessToken(creds: PathaoCreds): Promise<string> {
  // Two-tier cache (revamp 1.2):
  //   1. in-memory Map — free, but dies with the function instance (cold
  //      starts used to re-issue a token EVERY invocation);
  //   2. courier_tokens table — survives cold starts. Supabase edge functions
  //      recycle frequently, so the DB tier is what actually saves Pathao
  //      issue-token round-trips in practice.
  const sb = supabaseAdmin();
  const now = Date.now();

  const cached = tokenCache.get(creds.id);
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  if (creds.id !== "env") {
    const { data: row } = await sb
      .from("courier_tokens")
      .select("token, expires_at")
      .eq("provider", "pathao")
      .eq("integration_id", creds.id)
      .maybeSingle();
    if (row && new Date(row.expires_at).getTime() > now + 60_000) {
      tokenCache.set(creds.id, {
        token: row.token,
        expiresAt: new Date(row.expires_at).getTime(),
      });
      return row.token;
    }
  }

  const res = await fetch(`${PATHAO_BASE}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      username: creds.username,
      password: creds.password,
      grant_type: "password",
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Pathao auth failed [${res.status}]: ${txt}`);
  }
  const data = await res.json();
  const expiresAt = now + (data.expires_in || 3600) * 1000;
  tokenCache.set(creds.id, { token: data.access_token, expiresAt });

  // Persist for other (possibly cold) instances. Best-effort: env creds and
  // transient DB errors must not break dispatch/tracking over a cache write.
  if (creds.id !== "env") {
    sb.from("courier_tokens")
      .upsert({
        provider: "pathao",
        integration_id: creds.id,
        token: data.access_token,
        expires_at: new Date(expiresAt).toISOString(),
      }, { onConflict: "provider,integration_id" })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn(`[pathao-courier] courier_tokens upsert failed: ${error.message}`);
      });
  }
  return data.access_token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET with retry on 429 (rate-limit) and 5xx using exponential backoff +
// honoring the Retry-After header when Pathao provides one.
async function pathaoGet(token: string, path: string, maxRetries = 4) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${PATHAO_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return res.json();

    const txt = await res.text();
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= maxRetries) {
      throw new Error(`Pathao GET ${path} failed [${res.status}]: ${txt}`);
    }
    const retryAfterHeader = Number(res.headers.get("retry-after"));
    const backoffMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
    console.warn(`pathaoGet ${path} ${res.status}; retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);
    await sleep(backoffMs);
    attempt++;
  }
}

async function pathaoPost(token: string, path: string, body: unknown) {
  const res = await fetch(`${PATHAO_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Pathao POST ${path} failed [${res.status}]: ${JSON.stringify(data)}`
    );
  }
  return data;
}

// Terminal canonical statuses — parcels in these states need no cancellation,
// so a failed Pathao "cancel" for them can be treated as a no-op success.
const TERMINAL_CANONICAL_STATUSES = new Set(["cancelled", "delivered", "returned", "lost"]);

interface CancelPathaoResult {
  success: boolean;
  error?: string;
  /** Pathao HTTP status when available (0 if the request never completed). */
  status?: number;
  /** True when Pathao rejected the cancel because the parcel is already in a terminal state (nothing to cancel). */
  noop?: boolean;
}

// Query Pathao for the live status of a consignment and report whether it has
// already reached a terminal state (cancelled/delivered/returned/lost). Used to
// turn a "can't cancel because it's already done" error into a no-op success.
async function getParcelTerminalStatus(
  token: string,
  consignmentId: string,
): Promise<{ terminal: boolean; rawStatus?: string }> {
  try {
    const res = await fetch(`${PATHAO_BASE}/aladdin/api/v1/orders/${consignmentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { terminal: false };
    const body = await res.json();
    const info = body.data || body;
    const raw = typeof info.order_status === "string"
      ? info.order_status.trim()
      : typeof info.status === "string"
      ? info.status.trim()
      : String(info.order_status_slug ?? "").trim();
    const canonical = canonicalStatusFor(raw);
    return { terminal: canonical != null && TERMINAL_CANONICAL_STATUSES.has(canonical), rawStatus: raw || undefined };
  } catch {
    return { terminal: false };
  }
}

// Cancel a parcel on Pathao. Pathao only allows cancelling parcels that are
// still in a cancellable state (e.g. pending / pickup pending). For parcels that
// are already in a terminal state — already cancelled, delivered, returned or
// lost — there is nothing to cancel, and Pathao responds with a non-2xx. In that
// case we verify the live status and return a no-op success so callers do not
// get a confusing non-2xx failure that blocks a replace/delete.
async function cancelPathaoOrder(token: string, consignmentId: string): Promise<CancelPathaoResult> {
  let status = 0;
  try {
    const res = await fetch(`${PATHAO_BASE}/aladdin/api/v1/orders/${consignmentId}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({}),
    });
    status = res.status;
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.type !== "error" && data?.type !== "validation_error") {
      return { success: true, status };
    }
    const errMsg = data?.message || data?.errors || data?.error || JSON.stringify(data) || `HTTP ${res.status}`;
    const errText = typeof errMsg === "object" ? JSON.stringify(errMsg) : String(errMsg);

    // Cheap first pass: Pathao's "can't cancel" errors usually mention that the
    // parcel is already cancelled/closed/delivered or otherwise no longer
    // cancellable. If such a hint is present, confirm against the live status
    // before declaring a no-op.
    const lower = errText.toLowerCase();
    const terminalHints = [
      "already canc", "cancelled", "already deliver", "already picked", "already closed",
      "cannot be cancelled", "not cancellable", "not cancellable now", "no longer", "completed",
    ];
    const hintHit = terminalHints.some((h) => lower.includes(h));
    if (hintHit) {
      const live = await getParcelTerminalStatus(token, consignmentId);
      if (live.terminal) {
        return { success: true, status, noop: true };
      }
    }
    return { success: false, error: errText, status };
  } catch (err: any) {
    return { success: false, error: err.message || String(err), status };
  }
}
// Cancel an order's previous active parcel on Pathao and mark it cancelled
// locally in courier_shipments. Resolves the correct Pathao credentials for the
// old consignment (which may belong to a different integration than the one the
// caller is currently acting on). Returns enough info for the caller to decide
// whether to block on a genuine failure or proceed (via `force`).
async function cancelPreviousParcel(
  sb: ReturnType<typeof supabaseAdmin>,
  opts: {
    defaultToken: string;
    currentCredsId: string;
    orderId: string;
    orderNumber: string | number | null;
    oldConsignment: string;
    orderIntegId: string | null;
    force: boolean;
    callerId: string | null;
    callerEmail: string | null;
    callerName: string | null;
  },
): Promise<{
  success: boolean;
  cancelledOnPathao: boolean;
  noop: boolean;
  error?: string;
}> {
  let cancelToken = opts.defaultToken;
  const { data: oldShipment, error: shipErr } = await sb
    .from("courier_shipments")
    .select("id, integration_id")
    .eq("order_id", opts.orderId)
    .eq("consignment_id", opts.oldConsignment)
    .maybeSingle();
  if (shipErr) console.warn(`[pathao-courier] locating old shipment failed: ${shipErr.message}`);

  const oldIntegId = oldShipment?.integration_id || opts.orderIntegId;
  if (oldIntegId && oldIntegId !== opts.currentCredsId) {
    try {
      const oldCreds = await loadIntegration(sb, oldIntegId);
      cancelToken = await getAccessToken(oldCreds);
    } catch (e) {
      console.warn("Could not load credentials for previous integration:", e);
    }
  }

  const cancelRes = await cancelPathaoOrder(cancelToken, opts.oldConsignment);
  if (!cancelRes.success && !opts.force) {
    return { success: false, cancelledOnPathao: false, noop: false, error: cancelRes.error };
  }

  // Mark cancelled locally (even when forced past a Pathao refusal).
  await sb.from("courier_shipments").update({
    cancelled_at: new Date().toISOString(),
    canonical_status: "cancelled",
    raw_status: "Cancelled",
  }).eq("order_id", opts.orderId).eq("consignment_id", opts.oldConsignment);

  return { success: true, cancelledOnPathao: cancelRes.success, noop: !!cancelRes.noop, error: cancelRes.error };
}

// Issue #23: courier product descriptions ride in Pathao's `item_description`
// (parcel description). The official API docs publish no length cap for it, so
// mirror the client-side safe cap from src/lib/courierDescription.ts (255) at
// the API boundary: whatever a caller sends, Pathao never receives more than
// the limit and the cut never splits a surrogate pair. `special_instruction`
// is untouched — the API does not need it for item information.
const ITEM_DESCRIPTION_MAX = 255;
function clampItemDescription(orderPayload: any): any {
  const desc = orderPayload?.item_description;
  if (typeof desc !== "string" || desc.length <= ITEM_DESCRIPTION_MAX) return orderPayload;
  let cut = desc.slice(0, ITEM_DESCRIPTION_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return { ...orderPayload, item_description: cut };
}

// Issue #27 (server side): the payment gate must hold at the API boundary, not
// just in the UI. Mirrors the predicate in src/lib/paymentGate.ts
// (evaluatePaymentGate): only WooCommerce online-payment orders awaiting
// confirmation are gated — manual/POS/COD orders are never gated. A gated order
// reads "Payment Needs Confirmation" and cannot be entered with a courier.
const WOO_SOURCES = ["woo", "woocommerce", "online"];
const RECORDED_PAYMENT_STATUSES = ["paid", "partial", "partially_paid"];
function isPaymentGateBlocking(order: any): boolean {
  if (!order) return false;
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  const paymentStatus = norm(order.payment_status);
  const method = norm(order.payment_method);
  return (
    WOO_SOURCES.includes(norm(order.source)) &&
    paymentStatus === "online" &&
    !(paymentStatus === "cod" || method.includes("cod") || method.includes("cash on delivery")) &&
    !RECORDED_PAYMENT_STATUSES.includes(paymentStatus)
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const sb = supabaseAdmin();
    const body = await req.json();
    const { action, integration_id, ...params } = body;

    // `track_all` is a system-level refresh action: it does not accept user-specific
    // input and only writes Pathao tracking status onto orders. Allow it via
    // service-role bearer, a valid user JWT (the Dispatch/Orders pages' bulk
    // "refresh tracking" buttons), OR the x-cron-secret vault token
    // `sync_worker_cron_token` (schedulers: GitHub Actions / Cloudflare cron).
    // The public anon key alone is rejected.
    const isSystemTrackAll = action === "track_all";

    let callerId: string | null = null;
    let callerEmail: string | null = null;
    let callerName: string | null = null;

    if (!isSystemTrackAll) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const bearer = authHeader.replace("Bearer ", "");
      const { data: { user: caller }, error: authErr } = await sb.auth.getUser(bearer);
      if (authErr || !caller) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = caller.id;
      callerEmail = caller.email ?? null;
      const { data: prof } = await sb
        .from("profiles")
        .select("full_name")
        .eq("user_id", caller.id)
        .maybeSingle();
      callerName = (prof?.full_name as string | undefined) || callerEmail;
    } else {
      // System path (track_all). Order matters: schedulers send BOTH an anon
      // bearer (gateway JWT) and x-cron-secret, so the secret must be checked
      // BEFORE attempting user-JWT verification (an anon key is a Bearer but
      // not a user session).
      const authHeader = req.headers.get("Authorization") || "";
      const providedSecret = req.headers.get("x-cron-secret") || "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (serviceKey && authHeader === `Bearer ${serviceKey}`) {
        // service-role — ok
      } else if (providedSecret) {
        const { data: token } = await sb.rpc("get_sync_worker_cron_token");
        if (!token || providedSecret !== token) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else if (authHeader.startsWith("Bearer ")) {
        const { data: { user: caller }, error: authErr } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
        if (authErr || !caller) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        callerId = caller.id;
        callerEmail = caller.email ?? null;
      } else {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const creds = await loadIntegration(sb, integration_id);
    const token = await getAccessToken(creds);

    let result: unknown;

    switch (action) {
      case "get_cities": {
        const data = await pathaoGet(token, "/aladdin/api/v1/countries/1/city-list");
        const cities = data.data?.data || data.data || [];
        if (cities.length > 0) {
          await sb.from("pathao_cities").upsert(
            cities.map((c: any) => ({
              city_id: c.city_id,
              city_name: c.city_name,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "city_id" }
          );
        }
        result = cities;
        break;
      }

      case "get_zones": {
        const { city_id } = params;
        const data = await pathaoGet(token, `/aladdin/api/v1/cities/${city_id}/zone-list`);
        const zones = data.data?.data || data.data || [];
        if (zones.length > 0) {
          await sb.from("pathao_zones").upsert(
            zones.map((z: any) => ({
              zone_id: z.zone_id,
              zone_name: z.zone_name,
              city_id,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "zone_id" }
          );
        }
        result = zones;
        break;
      }

      case "get_areas": {
        const { zone_id } = params;
        const data = await pathaoGet(token, `/aladdin/api/v1/zones/${zone_id}/area-list`);
        const areas = data.data?.data || data.data || [];
        if (areas.length > 0) {
          await sb.from("pathao_areas").upsert(
            areas.map((a: any) => ({
              area_id: a.area_id,
              area_name: a.area_name,
              zone_id,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "area_id" }
          );
        }
        result = areas;
        break;
      }

      case "get_stores": {
        const data = await pathaoGet(token, "/aladdin/api/v1/stores");
        const allStores = data.data?.data || data.data || [];

        let allowed: number[] = [];
        if (creds.id !== "env") {
          const { data: integ } = await sb
            .from("pathao_integrations")
            .select("allowed_store_ids")
            .eq("id", creds.id)
            .single();
          if (integ?.allowed_store_ids && Array.isArray(integ.allowed_store_ids) && integ.allowed_store_ids.length > 0) {
            allowed = integ.allowed_store_ids as number[];
          }
        }

        const stores = allowed.length > 0
          ? allStores.filter((s: any) => allowed.includes(s.store_id))
          : allStores;

        if (stores.length > 0) {
          await sb.from("pathao_stores").upsert(
            stores.map((s: any) => ({
              pathao_store_id: s.store_id,
              store_name: s.store_name,
              store_address: s.store_address || null,
              city_id: s.city_id || null,
              zone_id: s.zone_id || null,
              hub_id: s.hub_id || null,
              is_active: s.is_active === 1,
              integration_id: creds.id !== "env" ? creds.id : null,
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "pathao_store_id" }
          );
        }
        result = stores;
        break;
      }

      case "get_price": {
        const { store_id, item_type, delivery_type, item_weight, recipient_city, recipient_zone } = params;
        const data = await pathaoPost(
          token,
          "/aladdin/api/v1/merchant/price-plan",
          { store_id, item_type, delivery_type, item_weight, recipient_city, recipient_zone }
        );
        result = data.data || data;
        break;
      }

      case "create_order": {
        const { order_id, order_payload, replace = false, force = false } = params;

        // Dispatch idempotency: never create a second parcel for an order that
        // already has an ACTIVE one (timeout + retry / double-invoke previously
        // created two physical parcels and two COD collections for one order).
        // If the caller opts into `replace`, cancel the previous active parcel
        // first (cancel-then-create), then create the new one.
        if (order_id) {
          const { data: existing } = await sb
            .from("orders")
            .select("id, consignment_id, order_number, pathao_integration_id, source, payment_method, payment_status")
            .eq("id", order_id)
            .maybeSingle();
          // Issue #27: reject gated orders at the API boundary (same predicate
          // as src/lib/paymentGate.ts evaluatePaymentGate).
          if (isPaymentGateBlocking(existing)) {
            return new Response(
              JSON.stringify({
                error: `Order ${existing.order_number} is in Payment Needs Confirmation and cannot be dispatched until the payment is confirmed.`,
                payment_gate_blocked: true,
              }),
              { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          if (existing?.consignment_id) {
            if (!replace) {
              result = {
                skipped: true,
                has_existing: true,
                consignment_id: existing.consignment_id,
                existing_consignment_id: existing.consignment_id,
                reason: `Order ${existing.order_number} already has a courier entry (${existing.consignment_id}).`,
              };
              break;
            }
            // Replace: cancel the previous parcel on Pathao first, then detach it.
            const r = await cancelPreviousParcel(sb, {
              defaultToken: token,
              currentCredsId: creds.id,
              orderId: order_id,
              orderNumber: existing.order_number,
              oldConsignment: existing.consignment_id,
              orderIntegId: existing.pathao_integration_id,
              force,
              callerId,
              callerEmail,
              callerName,
            });
            if (!r.success) {
              return new Response(
                JSON.stringify({
                  error: `Could not cancel previous parcel ${existing.consignment_id} on Pathao: ${r.error}`,
                  pathao_failed: true,
                  reason: r.error,
                  consignment_id: existing.consignment_id,
                }),
                { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            await sb.from("orders").update({ consignment_id: null, tracking_status: null }).eq("id", order_id);
            await sb.from("order_timeline").insert({
              order_id,
              event: "parcel_detached",
              description: `Previous Pathao parcel ${existing.consignment_id} cancelled${r.cancelledOnPathao ? " on Pathao" : " locally (Pathao API cancel failed/forced)"} and marked for replacement.`,
              metadata: {
                old_consignment_id: existing.consignment_id,
                pathao_cancel_success: r.cancelledOnPathao,
                pathao_cancel_error: r.error || null,
                user_id: callerId,
                user_email: callerEmail,
                user_name: callerName,
              },
            });
            await sb.from("audit_log").insert({
              user_id: callerId,
              user_email: callerEmail,
              action: "parcel_detached",
              entity_type: "order",
              entity_id: order_id,
              details: {
                old_consignment_id: existing.consignment_id,
                pathao_cancel_success: r.cancelledOnPathao,
                pathao_cancel_error: r.error || null,
                pending_replacement: true,
                courier: "pathao",
              },
            });
          }
        }

        const data = await pathaoPost(token, "/aladdin/api/v1/orders", clampItemDescription(order_payload));
        const consignment_id = data.data?.consignment_id || data.consignment_id;

        if (order_id && consignment_id) {
          await sb.from("orders").update({
            consignment_id,
            tracking_status: "Pickup Pending",
            status: "shipped",
            pathao_integration_id: creds.id !== "env" ? creds.id : null,
            pathao_store_id: order_payload.store_id || null,
          }).eq("id", order_id);

          await upsertShipmentRow(sb, {
            order_id,
            consignment_id,
            integration_id: creds.id,
            raw_status: "Pickup Pending",
            canonical_status: "pending",
          });

          await sb.from("order_timeline").insert({
            order_id,
            event: "dispatched",
            description: `Dispatched to Pathao. Consignment: ${consignment_id}`,
            metadata: {
              consignment_id,
              integration_id: creds.id,
              user_id: callerId,
              user_email: callerEmail,
              user_name: callerName,
            },
          });

          await sb.from("audit_log").insert({
            user_id: callerId,
            user_email: callerEmail,
            action: "dispatch",
            entity_type: "order",
            entity_id: order_id,
            details: { consignment_id, integration_id: creds.id, courier: "pathao" },
          });

          await postWooOrderNote(order_id, `[DokanOS] Dispatched to Pathao by ${callerName || callerEmail || "system"}. Consignment: ${consignment_id}`);
        }

        result = { consignment_id, raw: data };
        break;
      }

      case "create_bulk": {
        const { orders } = params;
        const results: any[] = [];
        const CONCURRENCY = 5;
        for (let i = 0; i < orders.length; i += CONCURRENCY) {
          const chunk = orders.slice(i, i + CONCURRENCY);
          const chunkResults = await Promise.allSettled(
            chunk.map(async (entry: any) => {
              try {
                // Dispatch idempotency: never create a second parcel for an order
                // that already has an ACTIVE one. A timeout + user retry (or a
                // double-invoke) used to create TWO physical parcels and TWO COD
                // collections for the same order. If the caller opts into
                // `replace` for this order, cancel the previous active parcel
                // first (cancel-then-create), then create the new one.
                const replace = !!entry.replace;
                const force = !!entry.force;
                let existingConsignment: string | null = null;
                let orderNumber: string | number | null = null;
                let orderIntegId: string | null = null;

                if (entry.order_id) {
                  const { data: existing } = await sb
                    .from("orders")
                    .select("id, consignment_id, order_number, pathao_integration_id, source, payment_method, payment_status")
                    .eq("id", entry.order_id)
                    .maybeSingle();
                  if (existing) {
                    // Issue #27: reject gated orders at the API boundary (same
                    // predicate as src/lib/paymentGate.ts evaluatePaymentGate).
                    if (isPaymentGateBlocking(existing)) {
                      return {
                        order_id: entry.order_id,
                        success: false,
                        payment_gate_blocked: true,
                        error: `Order ${existing.order_number} is in Payment Needs Confirmation and cannot be dispatched until the payment is confirmed.`,
                      };
                    }
                    existingConsignment = existing.consignment_id;
                    orderNumber = existing.order_number;
                    orderIntegId = existing.pathao_integration_id;
                  }

                  if (existingConsignment) {
                    if (!replace) {
                      return {
                        order_id: entry.order_id,
                        success: false,
                        skipped: true,
                        has_existing: true,
                        existing_consignment_id: existingConsignment,
                        consignment_id: existingConsignment,
                        error: `Order ${orderNumber} already has a courier entry (${existingConsignment}).`,
                      };
                    }
                    // Replace: cancel the previous parcel on Pathao, mark it
                    // cancelled locally, and detach it before creating the new one.
                    const r = await cancelPreviousParcel(sb, {
                      defaultToken: token,
                      currentCredsId: creds.id,
                      orderId: entry.order_id,
                      orderNumber,
                      oldConsignment: existingConsignment,
                      orderIntegId,
                      force,
                      callerId,
                      callerEmail,
                      callerName,
                    });
                    if (!r.success) {
                      return {
                        order_id: entry.order_id,
                        success: false,
                        error: `Could not cancel previous parcel ${existingConsignment} on Pathao: ${r.error}`,
                        pathao_failed: true,
                        reason: r.error,
                        consignment_id: existingConsignment,
                      };
                    }
                    await sb.from("orders").update({ consignment_id: null, tracking_status: null }).eq("id", entry.order_id);
                    await sb.from("order_timeline").insert({
                      order_id: entry.order_id,
                      event: "parcel_detached",
                      description: `Previous Pathao parcel ${existingConsignment} cancelled${r.cancelledOnPathao ? " on Pathao" : " locally (Pathao API cancel failed/forced)"} and marked for replacement.`,
                      metadata: {
                        old_consignment_id: existingConsignment,
                        pathao_cancel_success: r.cancelledOnPathao,
                        pathao_cancel_error: r.error || null,
                        user_id: callerId,
                        user_email: callerEmail,
                        user_name: callerName,
                      },
                    });
                    await sb.from("audit_log").insert({
                      user_id: callerId,
                      user_email: callerEmail,
                      action: "parcel_detached",
                      entity_type: "order",
                      entity_id: entry.order_id,
                      details: {
                        old_consignment_id: existingConsignment,
                        pathao_cancel_success: r.cancelledOnPathao,
                        pathao_cancel_error: r.error || null,
                        pending_replacement: true,
                        courier: "pathao",
                      },
                    });
                  }
                }

                const data = await pathaoPost(token, "/aladdin/api/v1/orders", clampItemDescription(entry.order_payload));
                const consignment_id = data.data?.consignment_id || data.consignment_id;

                if (entry.order_id && consignment_id) {
                  await sb.from("orders").update({
                    consignment_id,
                    tracking_status: "Pickup Pending",
                    status: "shipped",
                    pathao_integration_id: creds.id !== "env" ? creds.id : null,
                    pathao_store_id: entry.order_payload.store_id || null,
                  }).eq("id", entry.order_id);

                  await upsertShipmentRow(sb, {
                    order_id: entry.order_id,
                    consignment_id,
                    integration_id: creds.id,
                    raw_status: "Pickup Pending",
                    canonical_status: "pending",
                  });

                  await sb.from("order_timeline").insert({
                    order_id: entry.order_id,
                    event: "dispatched",
                    description: `Dispatched to Pathao. Consignment: ${consignment_id}`,
                    metadata: {
                      consignment_id,
                      integration_id: creds.id,
                      user_id: callerId,
                      user_email: callerEmail,
                      user_name: callerName,
                    },
                  });

                  await sb.from("audit_log").insert({
                    user_id: callerId,
                    user_email: callerEmail,
                    action: "dispatch",
                    entity_type: "order",
                    entity_id: entry.order_id,
                    details: { consignment_id, integration_id: creds.id, courier: "pathao" },
                  });

                  await postWooOrderNote(entry.order_id, `[DokanOS] Dispatched to Pathao by ${callerName || callerEmail || "system"}. Consignment: ${consignment_id}`);
                }

                return { order_id: entry.order_id, success: true, consignment_id };
              } catch (err: any) {
                return { order_id: entry.order_id, success: false, error: err.message };
              }
            })
          );
          for (const r of chunkResults) {
            results.push(r.status === "fulfilled" ? r.value : { success: false, error: String(r.reason) });
          }
        }
        result = { results };
        break;
      }

      case "track_order": {
        const { consignment_id } = params;
        const data = await pathaoGet(token, `/aladdin/api/v1/orders/${consignment_id}`);
        const info = data.data || data;
        const orderStatusRaw = info.order_status ?? info.status ?? info.order_status_slug ?? "";
        const order_status = typeof orderStatusRaw === "string" ? orderStatusRaw.trim() : "";

        if (consignment_id) {
          const mappedStatus = mapPathaoStatus(order_status);
          const updateData: any = { tracking_status: order_status };
          if (mappedStatus) updateData.status = mappedStatus;
          await sb.from("orders").update(updateData).eq("consignment_id", consignment_id);

          const { data: ord } = await sb
            .from("orders")
            .select("id, woo_order_id, store_id, tracking_status, pathao_integration_id")
            .eq("consignment_id", consignment_id)
            .maybeSingle();

          if (ord?.id) {
            await upsertShipmentRow(sb, {
              order_id: ord.id,
              consignment_id,
              integration_id: ord.pathao_integration_id || creds.id,
              raw_status: order_status,
              canonical_status: canonicalStatusFor(order_status) || null,
            });
          }

          if (ord?.id && ord.tracking_status !== order_status) {
            await postWooOrderNote(ord.id, `[DokanOS] Pathao status update: ${order_status}`);
          }

          // Once the Pathao cycle has terminated (delivered/returned), close out the
          // linked WooCommerce order — woo-push maps both to "completed".
          if ((mappedStatus === "delivered" || mappedStatus === "returned") && ord?.woo_order_id && ord?.store_id) {
            await pushOrderStatusToWoo(sb, ord.id).catch((e) =>
              console.warn(`woo-push from track_order failed: ${e?.message || e}`)
            );
          }
        }
        result = info;
        break;
      }

      case "track_all": {
        const { order_ids } = params;

        let query = sb
          .from("orders")
          .select("id, consignment_id, tracking_status, pathao_integration_id")
          .not("consignment_id", "is", null);

        if (order_ids && Array.isArray(order_ids) && order_ids.length > 0) {
          query = query.in("id", order_ids);
        } else {
          query = query.not("status", "in", '("delivered","cancelled","returned")');
        }

        // Order by last_tracked_at, not updated_at: updated_at only moves when a
        // status actually changes, so terminal-but-still-open orders kept their
        // original timestamp and permanently occupied this 50-row window. Every
        // order below is stamped whether or not it changed, so the window
        // rotates through the whole active set instead of deadlocking.
        const { data: activeOrders } = await query
          .order("last_tracked_at", { ascending: true, nullsFirst: true })
          .limit(50);

        const trackResults: any[] = [];
        const tokenByIntegration = new Map<string, string>();
        tokenByIntegration.set(creds.id, token);

        // Parallel tracking (revamp Phase 0): a serial loop measured ~2.3s per
        // consignment (~2.65s with pacing), capping the whole system at ~200
        // consignments/hour — at 500 stores each parcel's status would be a
        // DAY stale. A worker pool keeps the per-request retry/backoff (inside
        // pathaoGet) but overlaps the network latency. Concurrency 8 is a safe
        // compromise between throughput (~15-20x serial) and Pathao's limits;
        // 429 backoff inside pathaoGet absorbs bursts.
        const TRACK_CONCURRENCY = 8;

        let cursor = 0;
        const trackOrder = async (order: any): Promise<any> => {
          // Stamped in `finally` below so that *every* outcome — changed,
          // unchanged, unusable status, or a thrown error — moves this order to
          // the back of the queue. If any path could skip the stamp, that order
          // would keep last_tracked_at = NULL, sort first forever (NULLS FIRST)
          // and re-jam the window exactly like updated_at did.
          let stamped = false;
          const polledAt = new Date().toISOString();
          try {
            let useToken = token;
            const intId = (order as any).pathao_integration_id as string | null;
            if (intId && intId !== creds.id) {
              if (!tokenByIntegration.has(intId)) {
                const otherCreds = await loadIntegration(sb, intId);
                tokenByIntegration.set(intId, await getAccessToken(otherCreds));
              }
              useToken = tokenByIntegration.get(intId)!;
            }

            const data = await pathaoGet(useToken, `/aladdin/api/v1/orders/${order.consignment_id}`);
            const info = data.data || data;
            const orderStatusRaw = info.order_status ?? info.status ?? info.order_status_slug;
            const order_status = typeof orderStatusRaw === "string" ? orderStatusRaw.trim() : "";

            if (!order_status || order_status.toLowerCase() === "undefined" || order_status.toLowerCase() === "null") {
              return null;
            }

            const mappedStatus = mapPathaoStatus(order_status);
            const updateData: any = { tracking_status: order_status, last_tracked_at: polledAt };
            if (mappedStatus) updateData.status = mappedStatus;

            if (order.tracking_status !== order_status) {
              const { error: updErr } = await sb.from("orders").update(updateData).eq("id", order.id);
              // Only claim the stamp landed if the write actually succeeded —
              // otherwise fall through to the `finally` stamp, or this order
              // would keep a NULL cursor and re-jam the queue.
              stamped = !updErr;
              if (updErr) throw new Error(`orders update failed: ${updErr.message}`);
              await upsertShipmentRow(sb, {
                order_id: order.id,
                consignment_id: order.consignment_id,
                integration_id: (order as any).pathao_integration_id || creds.id,
                raw_status: order_status,
                canonical_status: canonicalStatusFor(order_status) || null,
                last_tracked_at: polledAt,
              });
              await sb.from("order_timeline").insert({
                order_id: order.id,
                event: "tracking_update",
                description: `Pathao courier status: ${order_status}`,
                metadata: {
                  tracking_status: order_status,
                  mapped_status: mappedStatus,
                  previous_status: order.tracking_status,
                  user_name: "Pathao Tracking",
                  user_email: null,
                },
              });

              await postWooOrderNote(order.id, `[DokanOS] Pathao status update: ${order_status}`);

              // Once the Pathao cycle has terminated (delivered/returned), close out the
              // linked WooCommerce order — woo-push maps both to "completed".
              if (mappedStatus === "delivered" || mappedStatus === "returned") {
                await pushOrderStatusToWoo(sb, order.id).catch((e) =>
                  console.warn(`woo-push from track_all failed for ${order.id}: ${e?.message || e}`)
                );
              }
            }

            trackResults.push({
              order_id: order.id,
              consignment_id: order.consignment_id,
              status: order_status,
              updated: order.tracking_status !== order_status,
            });
          } catch (err: any) {
            trackResults.push({
              order_id: order.id,
              consignment_id: order.consignment_id,
              error: err.message,
            });
          } finally {
            if (!stamped) {
              // supabase-js resolves with { error } instead of rejecting, so read
              // the error rather than relying on a catch handler here.
              const { error: stampErr } = await sb.from("orders")
                .update({ last_tracked_at: polledAt })
                .eq("id", order.id);
              if (stampErr) {
                console.warn(`last_tracked_at stamp failed for ${order.id}: ${stampErr.message}`);
              }
            }
          }
          return null;
        };

        // Worker pool: N trackers pull from a shared cursor until the window
        // is exhausted. Results are pushed by the workers themselves, so order
        // in trackResults is arrival order (irrelevant to the consumers, which
        // only read counts and per-order fields).
        const workers = Array.from(
          { length: Math.min(TRACK_CONCURRENCY, (activeOrders || []).length) },
          async () => {
            while (true) {
              const i = cursor++;
              if (i >= (activeOrders || []).length) return;
              await trackOrder((activeOrders as any[])[i]);
            }
          },
        );
        await Promise.all(workers);
        const updatedCount = trackResults.filter((r) => r.updated).length;
        // `total`/`updated` are what the Orders and Dispatch toasts read; keep
        // them in sync with those callers or the UI silently reports 0/0.
        result = {
          tracked: trackResults.length,
          total: trackResults.length,
          updated: updatedCount,
          results: trackResults,
        };
        break;
      }

      case "attach_parcel": {
        const { order_id, consignment_id: newConsignmentId, replace, add_new, force } = params;

        // --- Validate inputs ---
        if (!order_id || !newConsignmentId) {
          return new Response(
            JSON.stringify({ error: "order_id and consignment_id are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const cid = String(newConsignmentId).trim();
        if (!cid) {
          return new Response(
            JSON.stringify({ error: "consignment_id cannot be empty" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // --- Load the target order ---
        const { data: targetOrder, error: orderErr } = await sb
          .from("orders")
          .select("id, consignment_id, status, tracking_status, order_number, store_id, woo_order_id, pathao_integration_id")
          .eq("id", order_id)
          .maybeSingle();
        if (orderErr || !targetOrder) {
          return new Response(
            JSON.stringify({ error: `Order not found: ${orderErr?.message || order_id}` }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // --- Handle existing consignment (replace vs add_new) ---
        const oldConsignment = targetOrder.consignment_id;
        let cancelRes: { success: boolean; error?: string } = { success: false };

        if (oldConsignment) {
          if (!replace && !add_new) {
            return new Response(
              JSON.stringify({
                error: `Order #${targetOrder.order_number} already has consignment ${oldConsignment}.`,
                existing_consignment_id: oldConsignment,
                has_existing: true,
              }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          if (replace) {
            // Overwrite mode: cancel previous active parcel on Pathao and mark cancelled in courier_shipments
            let oldToken = token;
            const { data: oldShipment } = await sb
              .from("courier_shipments")
              .select("id, integration_id")
              .eq("order_id", order_id)
              .eq("consignment_id", oldConsignment)
              .maybeSingle();

            const oldIntegId = oldShipment?.integration_id || targetOrder.pathao_integration_id;
            if (oldIntegId && oldIntegId !== creds.id) {
              try {
                const oldCreds = await loadIntegration(sb, oldIntegId);
                oldToken = await getAccessToken(oldCreds);
              } catch (e) {
                console.warn("Could not load credentials for previous integration:", e);
              }
            }

            cancelRes = await cancelPathaoOrder(oldToken, oldConsignment);
            if (!cancelRes.success && !force) {
              return new Response(
                JSON.stringify({
                  error: `Could not cancel previous parcel ${oldConsignment} on Pathao: ${cancelRes.error}`,
                  pathao_failed: true,
                  reason: cancelRes.error,
                  consignment_id: oldConsignment,
                }),
                { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }

            const cancelNow = new Date().toISOString();
            await sb.from("courier_shipments").update({
              cancelled_at: cancelNow,
              canonical_status: "cancelled",
              raw_status: "Cancelled",
            }).eq("order_id", order_id).eq("consignment_id", oldConsignment);

            // Log the cancellation and detachment before overwriting
            await sb.from("order_timeline").insert({
              order_id,
              event: "parcel_detached",
              description: `Previous Pathao parcel ${oldConsignment} cancelled${cancelRes.success ? " on Pathao" : " locally (Pathao API cancel failed/forced)"} and replaced with ${cid}.`,
              metadata: {
                old_consignment_id: oldConsignment,
                old_tracking_status: targetOrder.tracking_status,
                pathao_cancel_success: cancelRes.success,
                pathao_cancel_error: cancelRes.error || null,
                user_id: callerId,
                user_email: callerEmail,
                user_name: callerName,
              },
            });
            await sb.from("audit_log").insert({
              user_id: callerId,
              user_email: callerEmail,
              action: "parcel_detached",
              entity_type: "order",
              entity_id: order_id,
              details: {
                old_consignment_id: oldConsignment,
                old_tracking_status: targetOrder.tracking_status,
                new_consignment_id: cid,
                pathao_cancel_success: cancelRes.success,
                pathao_cancel_error: cancelRes.error || null,
                courier: "pathao",
              },
            });
          }
        }

        // --- Check no OTHER order already uses this consignment ---
        const { data: conflicting } = await sb
          .from("orders")
          .select("id, order_number")
          .eq("consignment_id", cid)
          .neq("id", order_id)
          .maybeSingle();
        if (conflicting) {
          return new Response(
            JSON.stringify({
              error: `Consignment ${cid} is already attached to order #${conflicting.order_number}`,
              conflicting_order_id: conflicting.id,
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // --- Verify consignment exists on Pathao and fetch live status ---
        let liveStatus = "";
        let pathaoInfo: any = {};
        try {
          const data = await pathaoGet(token, `/aladdin/api/v1/orders/${cid}`);
          pathaoInfo = data.data || data;
          const rawStatus = pathaoInfo.order_status ?? pathaoInfo.status ?? pathaoInfo.order_status_slug ?? "";
          liveStatus = typeof rawStatus === "string" ? rawStatus.trim() : "";
        } catch (verifyErr: any) {
          return new Response(
            JSON.stringify({
              error: `Pathao could not verify consignment ${cid}: ${verifyErr.message}`,
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (!liveStatus || liveStatus.toLowerCase() === "undefined" || liveStatus.toLowerCase() === "null") {
          return new Response(
            JSON.stringify({ error: `Pathao returned no valid status for consignment ${cid}` }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // --- Map Pathao status to DokanOS status ---
        const mappedStatus = mapPathaoStatus(liveStatus) || "shipped";

        // --- Update the order ---
        const now = new Date().toISOString();
        const { error: updateErr } = await sb.from("orders").update({
          consignment_id: cid,
          tracking_status: liveStatus,
          status: mappedStatus,
          pathao_integration_id: creds.id !== "env" ? creds.id : null,
          last_tracked_at: now,
        }).eq("id", order_id);
        if (updateErr) {
          return new Response(
            JSON.stringify({ error: `Failed to update order: ${updateErr.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        await upsertShipmentRow(sb, {
          order_id,
          consignment_id: cid,
          integration_id: creds.id,
          raw_status: liveStatus,
          canonical_status: canonicalStatusFor(liveStatus) || null,
          last_tracked_at: now,
          cancelled_at: null,
        });

        // --- Timeline entry ---
        const verb = replace ? "replaced" : (add_new ? "added" : (oldConsignment ? "replaced" : "attached"));
        await sb.from("order_timeline").insert({
          order_id,
          event: "dispatched",
          description: `Pathao parcel ${verb} manually. Consignment: ${cid}. Current status: ${liveStatus}${oldConsignment && add_new ? ` (Previous active consignment: ${oldConsignment})` : ""}`,
          metadata: {
            consignment_id: cid,
            tracking_status: liveStatus,
            mapped_status: mappedStatus,
            integration_id: creds.id,
            replaced_from: replace ? (oldConsignment || null) : null,
            previous_consignment_id: add_new ? (oldConsignment || null) : null,
            user_id: callerId,
            user_email: callerEmail,
            user_name: callerName,
          },
        });

        // --- Audit log ---
        await sb.from("audit_log").insert({
          user_id: callerId,
          user_email: callerEmail,
          action: `parcel_${verb}`,
          entity_type: "order",
          entity_id: order_id,
          details: {
            consignment_id: cid,
            tracking_status: liveStatus,
            mapped_status: mappedStatus,
            integration_id: creds.id,
            replaced_from: replace ? (oldConsignment || null) : null,
            previous_consignment_id: add_new ? (oldConsignment || null) : null,
            courier: "pathao",
          },
        });

        // --- Woo note (best-effort) ---
        await postWooOrderNote(
          order_id,
          `[DokanOS] Pathao parcel ${verb} by ${callerName || callerEmail || "system"}. Consignment: ${cid}. Status: ${liveStatus}`,
        );

        result = {
          consignment_id: cid,
          tracking_status: liveStatus,
          mapped_status: mappedStatus,
          replaced_from: replace ? (oldConsignment || null) : null,
          previous_consignment_id: add_new ? (oldConsignment || null) : null,
        };
        break;
      }

      case "delete_courier_entry": {
        const { order_id, shipment_id, consignment_id: reqCid, force } = params;

        if (!order_id || (!shipment_id && !reqCid)) {
          return new Response(
            JSON.stringify({ error: "order_id and shipment_id (or consignment_id) are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Load target shipment. Orders dispatched before courier_shipments was
        // introduced only carry orders.consignment_id (the UI renders those as a
        // "legacy-" entry). Falling back to the order's own consignment keeps the
        // delete/cancel working instead of returning a 404 that never calls Pathao.
        let q = sb.from("courier_shipments").select("*").eq("order_id", order_id);
        if (shipment_id) {
          q = q.eq("id", shipment_id);
        } else {
          q = q.eq("consignment_id", reqCid);
        }
        const { data: shipment, error: shipErr } = await q.maybeSingle();

        if (shipErr) {
          return new Response(
            JSON.stringify({ error: `Courier entry lookup failed: ${shipErr.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        let targetShipment = shipment as Record<string, any> | null;
        if (!targetShipment) {
          const { data: legacyOrder } = await sb
            .from("orders")
            .select("consignment_id, tracking_status, pathao_integration_id")
            .eq("id", order_id)
            .maybeSingle();
          const legacyCid = legacyOrder?.consignment_id || reqCid;
          if (!legacyCid) {
            return new Response(
              JSON.stringify({ error: `Courier entry not found: ${shipment_id || reqCid}` }),
              { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          targetShipment = {
            id: null,
            order_id,
            provider: "pathao",
            consignment_id: legacyCid,
            raw_status: legacyOrder?.tracking_status ?? null,
            integration_id: legacyOrder?.pathao_integration_id ?? null,
            cancelled_at: null,
            legacy: true,
          };
        }
        const shipmentRow = targetShipment;

        if (shipmentRow.cancelled_at) {
          return new Response(
            JSON.stringify({ error: `Courier entry ${shipmentRow.consignment_id} is already cancelled` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Attempt Pathao cancellation via API
        let cancelToken = token;
        if (shipmentRow.integration_id && shipmentRow.integration_id !== creds.id) {
          try {
            const shipCreds = await loadIntegration(sb, shipmentRow.integration_id);
            cancelToken = await getAccessToken(shipCreds);
          } catch (e) {
            console.warn("Could not load creds for shipment integration:", e);
          }
        }

        const cancelRes = await cancelPathaoOrder(cancelToken, shipmentRow.consignment_id);
        if (!cancelRes.success && !force) {
          return new Response(
            JSON.stringify({
              error: `Failed to cancel parcel ${shipmentRow.consignment_id} on Pathao: ${cancelRes.error}`,
              pathao_failed: true,
              reason: cancelRes.error,
              consignment_id: shipmentRow.consignment_id,
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const now = new Date().toISOString();

        // Soft-cancel the shipment row. Legacy entries have no courier_shipments
        // row yet, so record one (already cancelled) to keep the history intact.
        if (shipmentRow.id) {
          const { error: updShipErr } = await sb.from("courier_shipments").update({
            cancelled_at: now,
            canonical_status: "cancelled",
            raw_status: "Cancelled",
          }).eq("id", shipmentRow.id);
          if (updShipErr) {
            return new Response(
              JSON.stringify({ error: `Failed to update shipment: ${updShipErr.message}` }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        } else {
          await upsertShipmentRow(sb, {
            order_id,
            consignment_id: shipmentRow.consignment_id,
            integration_id: shipmentRow.integration_id || creds.id,
            raw_status: "Cancelled",
            canonical_status: "cancelled",
            cancelled_at: now,
          });
        }

        // Check if this was the active consignment on the order
        const { data: order } = await sb
          .from("orders")
          .select("id, consignment_id, status, tracking_status")
          .eq("id", order_id)
          .single();

        let nextActiveConsignment: string | null = null;
        if (order && order.consignment_id === shipmentRow.consignment_id) {
          // Find the next active (non-cancelled) shipment for this order. Match on
          // consignment_id rather than id so this also works for legacy entries
          // that have no courier_shipments row at all.
          const { data: nextActive } = await sb
            .from("courier_shipments")
            .select("consignment_id, raw_status, canonical_status, integration_id")
            .eq("order_id", order_id)
            .is("cancelled_at", null)
            .neq("consignment_id", shipmentRow.consignment_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (nextActive) {
            nextActiveConsignment = nextActive.consignment_id;
            const mapped = mapPathaoStatus(nextActive.raw_status) || "shipped";
            await sb.from("orders").update({
              consignment_id: nextActive.consignment_id,
              tracking_status: nextActive.raw_status,
              pathao_integration_id: nextActive.integration_id,
              status: mapped,
              last_tracked_at: now,
            }).eq("id", order_id);
          } else {
            // No active shipments remaining
            await sb.from("orders").update({
              consignment_id: null,
              tracking_status: null,
              pathao_integration_id: null,
              status: order.status === "shipped" ? "processing" : order.status,
            }).eq("id", order_id);
          }
        }

        const cancelSuffix = cancelRes.noop
          ? " on Pathao (already in a terminal state — nothing to cancel)"
          : cancelRes.success
          ? " on Pathao"
          : " locally (Pathao API cancel failed/forced)";

        // Order timeline
        await sb.from("order_timeline").insert({
          order_id,
          event: "parcel_cancelled",
          description: `Courier entry ${shipmentRow.consignment_id} deleted/cancelled${cancelSuffix}.${nextActiveConsignment ? ` Active parcel is now ${nextActiveConsignment}.` : " Order now has no active courier parcel."}`,
          metadata: {
            consignment_id: shipmentRow.consignment_id,
            shipment_id: shipmentRow.id,
            pathao_cancel_success: cancelRes.success,
            pathao_cancel_noop: !!cancelRes.noop,
            pathao_cancel_error: cancelRes.error || null,
            next_active_consignment: nextActiveConsignment,
            user_id: callerId,
            user_email: callerEmail,
            user_name: callerName,
          },
        });

        // Audit log
        await sb.from("audit_log").insert({
          user_id: callerId,
          user_email: callerEmail,
          action: "courier_entry_deleted",
          entity_type: "order",
          entity_id: order_id,
          details: {
            shipment_id: shipmentRow.id,
            consignment_id: shipmentRow.consignment_id,
            pathao_cancel_success: cancelRes.success,
            pathao_cancel_noop: !!cancelRes.noop,
            pathao_cancel_error: cancelRes.error || null,
            next_active_consignment: nextActiveConsignment,
          },
        });

        // Woo note (best-effort)
        await postWooOrderNote(
          order_id,
          `[DokanOS] Courier entry ${shipmentRow.consignment_id} deleted by ${callerName || callerEmail || "system"}.`,
        );

        result = {
          success: true,
          consignment_id: shipmentRow.consignment_id,
          pathao_cancelled: cancelRes.success,
          pathao_cancel_noop: !!cancelRes.noop,
          next_active_consignment: nextActiveConsignment,
        };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("pathao-courier error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
