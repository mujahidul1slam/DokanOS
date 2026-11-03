/**
 * Stale-while-revalidate cache for the Orders page payload (issue #9 follow-up:
 * the list was slow on every visit).
 *
 * Why: the Orders page unmounts on navigation, so every revisit repeated the
 * whole blocking load — a paged `orders` select, then a paged
 * `product_categories` lookup — while the user stared at a skeleton. The data
 * that load produces does not change second-to-second, so the page may render
 * the last good payload immediately and refresh it in the background.
 *
 * Design notes:
 *
 *  - One module-level Map, keyed by a *scope signature* (business + session
 *    scope + store ids + order-source ids, see `makeOrdersScopeKey`). Two
 *    different scopes never share a payload, which matters for tenancy: a
 *    business switch or a store-filter change must not paint another scope's
 *    rows.
 *  - The cache stores the payload **and** the in-flight promise per key, so
 *    concurrent callers of an identical load share one request (`dedupeFetch`)
 *    instead of stampeding the database on every remount.
 *  - `readOrdersCache` returns synchronously — the caller can paint on the
 *    first render after mount, with no spinner and no network wait.
 *  - Entries expire (`ORDERS_CACHE_MAX_AGE_MS`). An expired entry is ignored
 *    and dropped, so a long-idle tab refetches instead of trusting old rows.
 *  - Nothing here touches React: the hook owns state, this module owns
 *    bookkeeping. That keeps the behaviour unit-testable without a DOM.
 *
 * The cache is per browser tab (module state). It is deliberately not
 * persisted to localStorage/sessionStorage: tenant data should not outlive the
 * tab session, and a stale cross-session payload is a security footgun, not a
 * performance win.
 */

/**
 * How long a cached payload counts as fresh, in milliseconds (5 minutes).
 *
 * Inside this window a mount paints the cached payload and revalidates in the
 * background; after it, `readOrdersCache` reports a miss so the page falls
 * back to its first-load skeleton and a blocking fetch. Five minutes keeps
 * revisits fast while bounding how stale a list can look after edits made in
 * another tab or by another user.
 */
export const ORDERS_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Hard deadline for one Orders load (row fetch + category map), in
 * milliseconds. A hung request used to leave the page on its skeleton forever;
 * the hook aborts at this point and surfaces a retryable error instead.
 */
export const ORDERS_LOAD_TIMEOUT_MS = 20_000;

/** Internal bookkeeping for one cache key. */
interface OrdersCacheRecord {
  /** Last successfully committed payload (absent = nothing to paint yet). */
  payload?: unknown;
  /** `Date.now()` when `payload` was written. */
  timestamp: number;
  /** The load currently in flight for this key, if any. */
  inflight?: Promise<unknown>;
}

const records = new Map<string, OrdersCacheRecord>();

/** What `readOrdersCache` hands back on a hit. */
export interface OrdersCacheHit<T> {
  payload: T;
  /** `Date.now()` timestamp of the write (for diagnostics/logging). */
  timestamp: number;
  /** Age of the payload at read time; `0 <= ageMs <= maxAgeMs`. */
  ageMs: number;
}

/** Extra inputs that make a cache entry scope-specific. */
export interface OrdersScopeOptions {
  /** Canonical order-source ids in scope (source-only orders need them). */
  orderSourceIds?: readonly (string | null | undefined)[] | null;
  /** Active business id. */
  businessId?: string | null;
  /**
   * Opaque per-context token from `ordersContextSessionToken`. Ties the entry
   * to the context instance that produced it (see that function's docs).
   */
  sessionScope?: string | null;
}

/** Dedupe + sort ids so scope ordering never produces a different key. */
function canonicalIds(ids: readonly (string | null | undefined)[] | null | undefined): string[] {
  const seen = new Set<string>();
  for (const raw of ids ?? []) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id) continue;
    seen.add(id);
  }
  return Array.from(seen).sort();
}

/**
 * Build the cache key for a load scope.
 *
 * The signature is canonical (ids deduped and sorted) so the same scope always
 * maps to the same key regardless of the order the stores/sources arrived in.
 * `biz` isolates businesses, `ctx` isolates context instances (see
 * `ordersContextSessionToken`), `stores` is the legacy Woo-store scope and
 * `sources` the canonical order-source scope — together they are the exact
 * predicate the page puts on the wire.
 */
export function makeOrdersScopeKey(
  storeIds: readonly (string | null | undefined)[] | null | undefined,
  options: OrdersScopeOptions = {},
): string {
  const stores = canonicalIds(storeIds);
  const sources = canonicalIds(options.orderSourceIds);
  const businessId =
    typeof options.businessId === "string" ? options.businessId.trim() : "";
  const sessionScope =
    typeof options.sessionScope === "string" ? options.sessionScope.trim() : "";

  return [
    "orders:v1",
    `biz=${businessId}`,
    `ctx=${sessionScope}`,
    `stores=${stores.length > 0 ? stores.join(",") : "-"}`,
    `sources=${sources.length > 0 ? sources.join(",") : "-"}`,
  ].join(":");
}

let nextContextToken = 0;
const contextTokens = new WeakMap<object, string>();

/**
 * Return a stable, opaque token for a context object (the active business from
 * `useBusinessContext`), minting one on first sight.
 *
 * Why the cache needs it: `biz=<businessId>` alone cannot tell two *users of
 * the same business* apart in one tab (log out, log in as a teammate — or, in
 * tests, two different contexts sharing a business id). Keying by object
 * identity ties cached rows to the exact context instance that scoped them:
 * the SPA keeps the same `active` object across navigation (it lives in
 * provider state), so revisits still hit the cache, while a freshly built
 * context (account switch, test isolation) starts cold and can never paint
 * another session's rows.
 *
 * Tokens are per module instance and are never reused; the WeakMap keeps the
 * bookkeeping from leaking context objects.
 */
export function ordersContextSessionToken(
  context: object | null | undefined,
): string {
  if (!context || typeof context !== "object") return "none";
  const existing = contextTokens.get(context);
  if (existing !== undefined) return existing;

  nextContextToken += 1;
  const token = `ctx-${nextContextToken}`;
  contextTokens.set(context, token);
  return token;
}

/**
 * Read a cached payload, synchronously.
 *
 * Returns `null` on a miss (nothing written, or the entry outlived
 * `maxAgeMs`). Expired entries are dropped here unless a revalidation is still
 * in flight — dropping the record mid-flight would let the next caller start a
 * duplicate request.
 */
export function readOrdersCache<T>(
  key: string,
  maxAgeMs: number = ORDERS_CACHE_MAX_AGE_MS,
): OrdersCacheHit<T> | null {
  const record = records.get(key);
  if (!record || record.payload === undefined) return null;

  const ageMs = Math.max(0, Date.now() - record.timestamp);
  if (ageMs > maxAgeMs) {
    if (!record.inflight) records.delete(key);
    return null;
  }

  return {
    payload: record.payload as T,
    timestamp: record.timestamp,
    ageMs,
  };
}

/**
 * Read the freshest payload cached for a business + context instance,
 * regardless of the exact store/source predicate it was written under.
 *
 * Why this exists: on a revisit the store list and order-source ids resolve
 * asynchronously, so the exact scope key is unknown for the first render(s).
 * Without this lookup the page paints its empty state until those small
 * queries land, even though a perfectly good payload is already in memory
 * (the heavy list query is what we must never repeat). Matching only
 * `biz` + `ctx` keeps the lookup inside one business/session, and the
 * payload is only ever a hint: the caller revalidates against the real
 * predicate and overwrites it.
 *
 * Returns `null` when no fresh entry exists for that business/context.
 */
export function readLatestOrdersCache<T>(
  businessId: string | null | undefined,
  sessionScope: string | null | undefined,
  maxAgeMs: number = ORDERS_CACHE_MAX_AGE_MS,
): OrdersCacheHit<T> | null {
  const biz = typeof businessId === "string" ? businessId.trim() : "";
  if (!biz) return null;
  const ctx = typeof sessionScope === "string" ? sessionScope.trim() : "";
  const prefix = `orders:v1:biz=${biz}:ctx=${ctx}:`;

  let best: OrdersCacheHit<T> | null = null;
  for (const [key, record] of records) {
    if (!key.startsWith(prefix) || record.payload === undefined) continue;

    const ageMs = Math.max(0, Date.now() - record.timestamp);
    if (ageMs > maxAgeMs) continue;

    if (!best || record.timestamp > best.timestamp) {
      best = { payload: record.payload as T, timestamp: record.timestamp, ageMs };
    }
  }

  return best;
}

/**
 * Store the last successful payload for `key`.
 *
 * `timestamp` is exposed for tests and for callers replaying an older commit
 * (never for production code to fudge freshness); it defaults to now. Any
 * in-flight promise for the key is preserved so a write cannot break dedupe.
 */
export function writeOrdersCache<T>(
  key: string,
  payload: T,
  timestamp: number = Date.now(),
): void {
  const existing = records.get(key);
  records.set(key, {
    payload,
    timestamp,
    inflight: existing?.inflight,
  });
}

/**
 * Drop one cached entry, or every entry when `key` is omitted.
 *
 * Used by Retry (a failed load must not keep serving the payload it could not
 * refresh) and by tests. In-flight promises are left alone: their callers
 * still need the result, and a rejected fetch never writes a payload anyway.
 */
export function invalidateOrdersCache(key?: string): void {
  if (key === undefined) {
    records.clear();
    return;
  }
  records.delete(key);
}

/**
 * Share one in-flight request per key: concurrent calls while a fetch for
 * `key` is running return that same promise instead of starting another.
 *
 * The fetcher is started on a microtask, not synchronously, for two reasons:
 * a caller holding a cached payload can paint it before any request goes out,
 * and the fetcher's synchronous throw (if any) surfaces as a rejection like
 * every other failure instead of escaping the function.
 *
 * A rejection clears the in-flight slot but never touches a previously written
 * payload: failed refreshes must leave the last good data readable, not poison
 * the cache.
 */
export function dedupeFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const record = records.get(key) ?? { timestamp: 0 };
  records.set(key, record);

  if (record.inflight) return record.inflight as Promise<T>;

  const promise = Promise.resolve().then(fetcher);
  record.inflight = promise;

  const settle = () => {
    if (record.inflight !== promise) return;
    delete record.inflight;
    // Nothing was ever cached for this key: keep the Map small instead of
    // leaving a payload-less tombstone behind.
    if (record.payload === undefined) records.delete(key);
  };
  promise.then(settle, settle);

  return promise;
}