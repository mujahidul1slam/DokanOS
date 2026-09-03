// Revamp Phase 2.5: the Pathao adapter — everything Pathao-specific lives
// here (status map, auth, REST calls). Extracted from pathao-courier/index.ts
// so courier #2 can land beside it without touching the core.
import type {
  CanonicalStatus,
  CourierAdapter,
  CourierIntegration,
  CourierStore,
  CourierToken,
  ParcelRequest,
  ParcelResult,
  TrackedStatus,
} from "../_shared/courier-adapter.ts";

export const PATHAO_BASE = "https://api-hermes.pathao.com";

/** Normalize status string: lowercase, underscores/hyphens -> spaces. */
function normalizeStatus(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

// The ~60-entry Pathao status map (moved verbatim from
// pathao-courier/index.ts, revamp 2.5). Maps to the canonical statuses
// AND to the legacy DokanOS order-status buckets the UI reads today:
//   pending/picked_up/in_transit/out_for_delivery -> "shipped"
//   delivered -> "delivered", returned -> "returned", cancelled -> "cancelled",
//   on_hold -> "processing", lost -> "returned" (legacy mapping kept).
const RAW_STATUS_MAP: Record<string, { canonical: CanonicalStatus; legacy: string }> = {
  // Pickup lifecycle
  "pending": { canonical: "pending", legacy: "shipped" },
  "pickup pending": { canonical: "pending", legacy: "shipped" },
  "waiting for pickup": { canonical: "pending", legacy: "shipped" },
  "pickup requested": { canonical: "pending", legacy: "shipped" },
  "assigned for pickup": { canonical: "pending", legacy: "shipped" },
  "picked": { canonical: "picked_up", legacy: "shipped" },
  "picked up": { canonical: "picked_up", legacy: "shipped" },
  // Hub / transit lifecycle
  "at sorting hub": { canonical: "in_transit", legacy: "shipped" },
  "received at sorting hub": { canonical: "in_transit", legacy: "shipped" },
  "sent to sub sorting hub": { canonical: "in_transit", legacy: "shipped" },
  "received at sub sorting hub": { canonical: "in_transit", legacy: "shipped" },
  "sent to last mile hub": { canonical: "in_transit", legacy: "shipped" },
  "in transit": { canonical: "in_transit", legacy: "shipped" },
  "on the way to delivery hub": { canonical: "in_transit", legacy: "shipped" },
  "at delivery hub": { canonical: "in_transit", legacy: "shipped" },
  // Delivery lifecycle
  "assigned for delivery": { canonical: "out_for_delivery", legacy: "shipped" },
  "sent for delivery": { canonical: "out_for_delivery", legacy: "shipped" },
  "out for delivery": { canonical: "out_for_delivery", legacy: "shipped" },
  "delivery confirmed": { canonical: "out_for_delivery", legacy: "shipped" },
  "delivered": { canonical: "delivered", legacy: "delivered" },
  "partial delivery": { canonical: "delivered", legacy: "delivered" },
  "partial delivered": { canonical: "delivered", legacy: "delivered" },
  "payment invoice": { canonical: "delivered", legacy: "delivered" },
  // Return lifecycle
  "return": { canonical: "returned", legacy: "returned" },
  "returned": { canonical: "returned", legacy: "returned" },
  "paid return": { canonical: "returned", legacy: "returned" },
  "return requested": { canonical: "returned", legacy: "returned" },
  "return in transit": { canonical: "returned", legacy: "returned" },
  "returned to merchant": { canonical: "returned", legacy: "returned" },
  "merchant return": { canonical: "returned", legacy: "returned" },
  "return delivered": { canonical: "returned", legacy: "returned" },
  "delivery failed": { canonical: "returned", legacy: "returned" },
  "customer refused": { canonical: "returned", legacy: "returned" },
  "drt requested": { canonical: "returned", legacy: "returned" },
  "drt pick requested": { canonical: "returned", legacy: "returned" },
  "drt pick failed": { canonical: "returned", legacy: "returned" },
  "drt cancelled": { canonical: "returned", legacy: "returned" },
  "lost": { canonical: "lost", legacy: "returned" },
  "damaged": { canonical: "lost", legacy: "returned" },
  // Cancel / hold
  "cancelled": { canonical: "cancelled", legacy: "cancelled" },
  // Pickup never happened, so no shipment exists to track.
  "pickup cancel": { canonical: "cancelled", legacy: "cancelled" },
  "pickup cancelled": { canonical: "cancelled", legacy: "cancelled" },
  "pickup failed": { canonical: "cancelled", legacy: "cancelled" },
  "on hold": { canonical: "on_hold", legacy: "processing" },
  "pickup on hold": { canonical: "on_hold", legacy: "processing" },
  "on hold by customer request": { canonical: "on_hold", legacy: "processing" },
  "hold": { canonical: "on_hold", legacy: "processing" },
  "exchange": { canonical: "on_hold", legacy: "processing" },
};

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
    throw new Error(`Pathao POST ${path} failed [${res.status}]: ${JSON.stringify(data)}`);
  }
  return data;
}

/** Extract the order status from any known Pathao response shape. */
export function extractPathaoStatus(info: Record<string, unknown>): string {
  const raw = info.order_status ?? info.status ?? info.order_status_slug ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

// Adapter-level in-memory token cache (lives for the function's runtime);
// the persistent courier_tokens DB cache is handled by the caller
// (pathao-courier getAccessToken) which fronts this adapter.
const memTokenCache = new Map<string, CourierToken>();

export const pathaoAdapter: CourierAdapter = {
  code: "pathao",
  label: "Pathao",
  rateLimit: { maxPerMinute: 60, trackIntervalMinutes: 15 },

  async authenticate(integration: CourierIntegration): Promise<CourierToken> {
    const cached = memTokenCache.get(integration.id);
    const now = Date.now();
    if (cached && cached.expiresAt > now + 60_000) return cached;

    const c = integration.credentials;
    const res = await fetch(`${PATHAO_BASE}/aladdin/api/v1/issue-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: c.client_id,
        client_secret: c.client_secret,
        username: c.username,
        password: c.password,
        grant_type: "password",
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Pathao auth failed [${res.status}]: ${txt}`);
    }
    const data = await res.json();
    const tok: CourierToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in || 3600) * 1000,
    };
    memTokenCache.set(integration.id, tok);
    return tok;
  },

  async listMerchantStores(integration: CourierIntegration): Promise<CourierStore[]> {
    const { token } = await this.authenticate(integration);
    const data = await pathaoGet(token, "/aladdin/api/v1/stores");
    const stores = data.data?.data || data.data || [];
    return stores.map((s: Record<string, unknown>) => ({
      id: String(s.store_id),
      name: String(s.store_name),
      address: (s.store_address as string) || null,
      raw: s,
    }));
  },

  async createParcels(integration, parcels) {
    const { token } = await this.authenticate(integration);
    const out: Array<ParcelResult | (ParcelResult & { error: string })> = [];
    // Bounded concurrency 5 (matches the old create_bulk behavior).
    const CH = 5;
    for (let i = 0; i < parcels.length; i += CH) {
      const chunk = parcels.slice(i, i + CH);
      const settled = await Promise.allSettled(
        chunk.map(async (p: ParcelRequest) => {
          // Adapter idempotency: the caller passes raw payload through for
          // now; when the queue route lands, parcel bodies are built here.
          const data = await pathaoPost(token, "/aladdin/api/v1/orders", p.raw ?? p);
          const consignmentId = data.data?.consignment_id || data.consignment_id;
          return { orderId: p.orderId, consignmentId, raw: data } as ParcelResult;
        }),
      );
      for (const r of settled) {
        if (r.status === "fulfilled") out.push(r.value);
        else out.push({ orderId: "unknown", consignmentId: "", error: String(r.reason?.message || r.reason) } as ParcelResult & { error: string });
      }
    }
    return out;
  },

  async trackParcels(integration, consignments) {
    const { token } = await this.authenticate(integration);
    const out: Array<TrackedStatus | (TrackedStatus & { error: string })> = [];
    const CH = 8; // matches the old track_all pool
    let cursor = 0;
    const worker = async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const i = cursor++;
        if (i >= consignments.length) return;
        const cid = consignments[i];
        try {
          const data = await pathaoGet(token, `/aladdin/api/v1/orders/${cid}`);
          const info = data.data || data;
          const raw = extractPathaoStatus(info);
          const canonical = this.mapStatus(raw);
          out.push({
            consignmentId: cid,
            rawStatus: raw,
            canonicalStatus: canonical ?? "pending",
          });
        } catch (e) {
          out.push({
            consignmentId: cid,
            rawStatus: "",
            canonicalStatus: "pending",
            error: String((e as Error)?.message || e),
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CH, consignments.length) }, worker));
    return out;
  },

  async cancelParcel(integration, consignmentId) {
    const { token } = await this.authenticate(integration);
    try {
      const data = await pathaoPost(token, `/aladdin/api/v1/orders/${consignmentId}/cancel`, {});
      return { cancelled: true, raw: data };
    } catch (e) {
      return { cancelled: false, error: String((e as Error)?.message || e) };
    }
  },

  async refreshLocations(integration) {
    const { token } = await this.authenticate(integration);
    const cityData = await pathaoGet(token, "/aladdin/api/v1/countries/1/city-list");
    return { cities: (cityData.data?.data || cityData.data || []).length };
  },

  mapStatus(raw: string | null | undefined): CanonicalStatus | undefined {
    if (!raw) return undefined;
    const entry = RAW_STATUS_MAP[normalizeStatus(raw)];
    if (!entry) {
      console.warn(`[pathao-adapter] Unmapped Pathao status: "${raw}"`);
      return undefined;
    }
    return entry.canonical;
  },
};

/** Legacy order-status bucket for the UI (shipped/delivered/returned/...). */
export function legacyStatusFor(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const entry = RAW_STATUS_MAP[normalizeStatus(raw)];
  return entry?.legacy;
}

/** Canonical status for DB persistence (courier_shipments.canonical_status). */
export function canonicalStatusFor(raw: string | null | undefined): CanonicalStatus | undefined {
  if (!raw) return undefined;
  return RAW_STATUS_MAP[normalizeStatus(raw)]?.canonical;
}

export { pathaoGet, pathaoPost };
