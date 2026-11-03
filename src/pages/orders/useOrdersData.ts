/**
 * Orders page data loading (issue #9 + the "slow on every visit" follow-up).
 *
 * Extracted from Orders.tsx so the load pipeline has a testable seam — the
 * intermittent "orders don't load" bug was a data-loading race, not
 * rendering. This hook owns:
 *
 *  1. Business scoping — an order is in scope through its legacy Woo store
 *     binding (`store_id`) OR its canonical Order Source (`order_source_id`);
 *     source-only orders (store_id NULL) must not disappear from the list.
 *  2. Stale-response guarding (issue #9 ROOT CAUSE). The scope inputs resolve
 *     asynchronously and independently (useStoresList fetch, the
 *     order_sources fetch below, business-context brands refresh), so several
 *     load runs overlap — first "no scope", then "one scope only" (a PARTIAL
 *     row set), then "both scopes" (full). Previously the last RESPONSE won,
 *     so a slow partial response could overwrite the full list and it stayed
 *     wrong until remount. Every run now takes a request token and a run that
 *     has been superseded never touches state.
 *  3. Pagination (issue #9). PostgREST silently truncates an unpaginated
 *     request at the server max-rows cap (1000 on hosted projects) with HTTP
 *     200 and no error — see src/lib/supabasePage.ts. All fetches go through
 *     fetchAllRows.
 *  4. Error surfacing (issue #9). A failed request used to be swallowed and
 *     rendered as an empty or stale list with no feedback. Errors now land in
 *     `loadError` / `orderSourceError` (the page shows a banner with Retry)
 *     and the previous rows stay on screen — stale-but-real beats a silent
 *     blank page.
 *  5. Stale-while-revalidate (perf follow-up). The page unmounts on
 *     navigation, so every revisit repeated the blocking load. The payload is
 *     now cached per scope in src/lib/ordersCache.ts: a mount paints the last
 *     good rows immediately (no skeleton) and refreshes in the background.
 *     Because the exact store/source scope only resolves after a small async
 *     lookup, the mount also seeds state from the freshest payload cached for
 *     the *business + context* (readLatestOrdersCache) and keeps it on screen
 *     while that lookup settles — otherwise a revisit would flash the empty
 *     state before the (already in-memory) rows appeared. Identical concurrent
 *     loads share one request via `dedupeFetch`.
 *  6. Progressive first paint. The row fetch and the order → category map
 *     fetch are no longer committed atomically: rows render as soon as they
 *     resolve, then the map (which needs its own query per product chunk)
 *     arrives and is committed in a second state update. The map feeds
 *     pre-order detection and category tabs only, so the list is interactive
 *     while it loads. Losing atomicity is a deliberate trade: a missing map
 *     entry can briefly mis-tab an order between "new"/"pre_order", whereas a
 *     blocking map query delays the whole page.
 *  7. Robustness. PostgREST can hand back NULL to-one relations, numeric
 *     columns as strings (bigint), partial and malformed rows. Mapping now
 *     normalizes every field, skips rows whose store is outside the active
 *     scope, and drops unreadable rows with a `console.warn` instead of
 *     letting one bad row throw away the whole list. A hung request is
 *     cancelled after ORDERS_LOAD_TIMEOUT_MS (20s) and surfaces as a
 *     retryable `loadError`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBusinessContext, type Brand } from "@/hooks/useBusinessContext";
import { useStoresList } from "@/hooks/useStoresList";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePage";
import { brandAccent, deriveBrandForStore } from "@/lib/brandIdentity";
import {
  dedupeFetch,
  invalidateOrdersCache,
  makeOrdersScopeKey,
  ordersContextSessionToken,
  readLatestOrdersCache,
  readOrdersCache,
  writeOrdersCache,
  ORDERS_LOAD_TIMEOUT_MS,
} from "@/lib/ordersCache";
import {
  buildOrderCategoryMap,
  chunkArray,
  collectProductIds,
  PRODUCT_CATEGORY_QUERY_CHUNK,
  type CategoryMapOrder,
  type ProductCategoryRow,
} from "./orderCategoryMap";

export interface OrderBrand {
  id: string;
  name: string;
  logo_url: string | null;
  woo_store_id: string | null;
  accent: string;
}

export interface OrderOrderSource {
  id: string;
  name: string;
  type: string;
  brand_id: string | null;
  brands: Omit<OrderBrand, "accent"> | null;
}

export interface OrderRow {
  id: string;
  order_number: string;
  total: number;
  status: string;
  source: string;
  payment_method: string | null;
  payment_status: string;
  consignment_id: string | null;
  tracking_status: string | null;
  fulfillment_type: string;
  created_at: string;
  deleted_at: string | null;
  amount_to_collect: number | null;
  pathao_recipient_city: number | null;
  pathao_recipient_zone: number | null;
  pathao_recipient_area: number | null;
  pathao_store_id: number | null;
  item_weight: number | null;
  special_instruction: string | null;
  store_id: string | null;
  order_source_id: string | null;
  order_source: OrderOrderSource | null;
  brand: (OrderBrand & { accent: string }) | null;
  /** Every brand attributed to the order's items (order_brands); null when unknown. */
  brands: OrderBrand[] | null;
  /** Issue #30: on merged source orders this points at the merged order. */
  parent_order_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_email: string | null;
  pickup_slip_printed_at: string | null;
  measurement_slip_printed_at: string | null;
  stores: { name: string } | null;
  itemCount: number;
  productItems: { name: string; qty: number }[];
  isPreOrder: boolean;
}

/**
 * The orders select — one constant so the query and its docs stay in sync.
 *
 * Trimmed (perf follow-up): the previous select also pulled
 * `order_items(id, …, products(stock_status))` although nothing on the Orders
 * surface reads either. `products(stock_status)` was a per-line join whose
 * payload dwarfs the line itself, and `id` was never consumed (the category
 * map keys off `product_id`). The nested `order_items` join stays because
 * `itemCount` and `productItems` are rendered on every row.
 */
const ORDERS_SELECT =
  "id, order_number, total, status, source, payment_method, payment_status, consignment_id, tracking_status, fulfillment_type, created_at, deleted_at, store_id, order_source_id, parent_order_id, customer_id, amount_to_collect, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, pathao_store_id, item_weight, special_instruction, customer_name, customer_phone, customer_address, customer_city, customer_email, pickup_slip_printed_at, measurement_slip_printed_at, stores(name), order_source:order_sources(id, name, brand_id, type, brands(id, name, logo_url, woo_store_id)), order_brands(brand_id, is_primary, brands(id, name, logo_url, woo_store_id)), order_items(product_id, product_name, quantity)";

export interface UseOrdersDataResult {
  /** Display rows (brand/derived fields mapped in), newest first. */
  orders: OrderRow[];
  /**
   * Direct row patching (e.g. the COD pre-order auto-promotion reflects its
   * status change locally without a refetch).
   */
  setOrders: React.Dispatch<React.SetStateAction<OrderRow[]>>;
  /** order id → category ids, for category filtering and pre-order detection. */
  orderCategoryMap: Map<string, Set<string>>;
  /** True only while the first load for the current scope is in flight without a cached payload. */
  loading: boolean;
  /** Orders fetch failure message (issue #9) — shown with a Retry action. */
  loadError: string | null;
  /**
   * Order-source scope fetch failure message (issue #9). Distinct from
   * `loadError` because it leaves the query UNDER-SCOPED (the row fetch then
   * succeeds but misses source-only orders) — retry must re-run the scope
   * fetch, not just the row fetch.
   */
  orderSourceError: string | null;
  /** Refetch rows + category map with the current scope. */
  loadOrders: () => Promise<void>;
  /** Retry action: re-runs the order-source scope fetch AND the row load. */
  retryLoad: () => void;
}

/** Keep category lookups parallel without stampeding PostgREST on large histories. */
const CATEGORY_QUERY_CONCURRENCY = 4;

/** The payload the cache stores: rows plus the map that arrived with them. */
interface OrdersCachePayload {
  orders: OrderRow[];
  orderCategoryMap: Map<string, Set<string>>;
}

type UnknownRecord = Record<string, unknown>;

/** What the row mapper needs from the active scope. */
interface OrderMappingContext {
  brands: readonly Brand[];
  storeIds: readonly string[];
  orderSourceIds: readonly string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Non-empty string, else null. Numbers are stringified (numeric ids from bigint columns). */
function asText(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Finite number, else null. Accepts numeric strings (bigint/numeric columns). */
function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBrandRef(value: unknown): Omit<OrderBrand, "accent"> | null {
  // PostgREST returns a to-one relation as an object, but arrays show up in
  // optimistic/embedded payloads — accept both and keep the first.
  const record = Array.isArray(value) ? value[0] : value;
  if (!isRecord(record)) return null;
  return {
    id: asText(record.id) ?? "",
    name: asText(record.name) ?? "",
    logo_url: asText(record.logo_url),
    woo_store_id: asText(record.woo_store_id),
  };
}

/** Normalize the joined order_source (NULL when the row has none/unreadable). */
function normalizeOrderSource(value: unknown): OrderOrderSource | null {
  const record = Array.isArray(value) ? value[0] : value;
  if (!isRecord(record)) return null;
  const id = asText(record.id);
  if (!id) return null;
  return {
    id,
    name: asText(record.name) ?? "",
    type: asText(record.type) ?? "",
    brand_id: asText(record.brand_id),
    brands: normalizeBrandRef(record.brands),
  };
}

/**
 * Multi-brand attribution (`public.order_brands`): a POS order can carry items
 * from several brands while its order source names only one of them. Rows come
 * back primary-first so the Orders table's brand column still leads with the
 * brand the source belongs to and the rest are available behind the "+N" chip.
 */
function normalizeOrderBrands(value: unknown): OrderBrand[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set<string>();
  const rows: Array<{ brand: OrderBrand; primary: boolean }> = [];
  for (const entry of value) {
    const record = Array.isArray(entry) ? entry[0] : entry;
    if (!isRecord(record)) continue;
    const ref = normalizeBrandRef(record.brands);
    const id = asText(record.brand_id) ?? ref?.id ?? null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      brand: {
        id,
        name: ref?.name || "Unknown brand",
        logo_url: ref?.logo_url ?? null,
        woo_store_id: ref?.woo_store_id ?? null,
        accent: brandAccent(id),
      },
      primary: record.is_primary === true,
    });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return a.brand.name.localeCompare(b.brand.name);
  });
  return rows.map((row) => row.brand);
}

/**
 * Pick the brand accent/branding for a row: the canonical order-source brand
 * wins, then the legacy store binding.
 *
 * Context brands can arrive without an `id` (partial brand rows). Previously
 * that crashed the whole load inside `brandAccent(undefined)`; now a missing
 * brand id falls back to a stable synthetic id derived from the store, so the
 * accent is deterministic and the row still renders.
 */
function resolveOrderBrand(
  source: OrderOrderSource | null,
  fallback: Brand | undefined,
  storeId: string | null,
): OrderBrand | null {
  const ref =
    source?.brands ??
    (fallback
      ? {
          id: asText(fallback.id) ?? "",
          name: asText(fallback.name) ?? "",
          logo_url: asText(fallback.logo_url),
          woo_store_id: asText(fallback.woo_store_id),
        }
      : null);
  if (!ref) return null;

  const brandId = ref.id || (storeId ? `store:${storeId}` : "");
  if (!brandId) return null;

  return {
    id: brandId,
    name: ref.name,
    logo_url: ref.logo_url ?? null,
    woo_store_id: ref.woo_store_id ?? null,
    accent: brandAccent(brandId),
  };
}

function normalizeStores(value: unknown): { name: string } | null {
  const record = Array.isArray(value) ? value[0] : value;
  if (!isRecord(record)) return null;
  const name = asText(record.name);
  return name ? { name } : null;
}

function mapProductItems(value: unknown): { name: string; qty: number }[] {
  if (!Array.isArray(value)) return [];
  const items: { name: string; qty: number }[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const name = asText(raw.product_name);
    if (!name) continue;
    items.push({ name, qty: asNumber(raw.quantity) || 1 });
  }
  return items;
}

/**
 * Defence in depth for tenancy: never publish a row whose store belongs to a
 * different business. RLS should already prevent such rows, but a stale
 * payload or an over-broad predicate must not leak one onto the page — and its
 * order_items must not seed the category map either. Source-scoped rows
 * (store_id NULL) stay: their scope is the order source, not the store.
 */
function isRowInScope(
  storeId: string | null,
  orderSourceId: string | null,
  ctx: OrderMappingContext,
): boolean {
  if (!storeId || ctx.storeIds.length === 0) return true;
  if (ctx.storeIds.includes(storeId)) return true;
  return Boolean(orderSourceId && ctx.orderSourceIds.includes(orderSourceId));
}

/** Map one raw order row, throwing only on data that cannot be displayed. */
function mapOrderRow(raw: UnknownRecord, ctx: OrderMappingContext): OrderRow | null {
  const id = asText(raw.id);
  if (!id) throw new Error("order row has no id");

  const storeId = asText(raw.store_id);
  const orderSourceId = asText(raw.order_source_id);
  if (!isRowInScope(storeId, orderSourceId, ctx)) return null;

  const orderSource = normalizeOrderSource(raw.order_source);
  const brand = resolveOrderBrand(
    orderSource,
    deriveBrandForStore(ctx.brands, storeId ?? ""),
    storeId,
  );

  return {
    id,
    order_number: asText(raw.order_number) ?? id,
    total: asNumber(raw.total) ?? 0,
    status: asText(raw.status) ?? "",
    source: asText(raw.source) ?? "",
    payment_method: asText(raw.payment_method),
    payment_status: asText(raw.payment_status) ?? "",
    consignment_id: asText(raw.consignment_id),
    tracking_status: asText(raw.tracking_status),
    fulfillment_type: asText(raw.fulfillment_type) ?? "",
    created_at: asText(raw.created_at) ?? "",
    deleted_at: asText(raw.deleted_at),
    amount_to_collect: asNumber(raw.amount_to_collect),
    pathao_recipient_city: asNumber(raw.pathao_recipient_city),
    pathao_recipient_zone: asNumber(raw.pathao_recipient_zone),
    pathao_recipient_area: asNumber(raw.pathao_recipient_area),
    pathao_store_id: asNumber(raw.pathao_store_id),
    item_weight: asNumber(raw.item_weight),
    special_instruction: asText(raw.special_instruction),
    store_id: storeId,
    order_source_id: orderSourceId,
    order_source: orderSource,
    brand,
    brands: normalizeOrderBrands(raw.order_brands),
    parent_order_id: asText(raw.parent_order_id),
    customer_id: asText(raw.customer_id),
    customer_name: asText(raw.customer_name),
    customer_phone: asText(raw.customer_phone),
    customer_address: asText(raw.customer_address),
    customer_city: asText(raw.customer_city),
    customer_email: asText(raw.customer_email),
    pickup_slip_printed_at: asText(raw.pickup_slip_printed_at),
    measurement_slip_printed_at: asText(raw.measurement_slip_printed_at),
    stores: normalizeStores(raw.stores),
    itemCount: Array.isArray(raw.order_items) ? raw.order_items.length : 0,
    productItems: mapProductItems(raw.order_items),
    isPreOrder: false, // recomputed reactively from category settings
  };
}

/**
 * Map every row, isolating failures: one malformed row is warned about and
 * dropped, the rest of the list still loads.
 *
 * Returns only the rows that survived (so the category map is built from
 * exactly the orders on screen, never from a foreign/dead row).
 */
function mapOrderRows(
  rawRows: readonly unknown[],
  ctx: OrderMappingContext,
): { orders: OrderRow[]; rows: UnknownRecord[] } {
  const orders: OrderRow[] = [];
  const rows: UnknownRecord[] = [];

  for (const raw of rawRows) {
    if (!isRecord(raw)) {
      console.warn("[orders] Skipping an order row that is not an object", raw);
      continue;
    }
    try {
      const mapped = mapOrderRow(raw, ctx);
      if (!mapped) continue; // out of the active business scope — filtered, not corrupt
      orders.push(mapped);
      rows.push(raw);
    } catch (err) {
      console.warn("[orders] Skipping an unreadable order row", raw.id, err);
    }
  }

  return { orders, rows };
}

/**
 * Fetch the paged order rows for a scope.
 *
 * The secondary `.order("id")` gives paging a deterministic tie-break so rows
 * can never be skipped or duplicated across pages on equal `created_at`.
 */
async function fetchOrderRows(
  scope: {
    businessId: string;
    storeIds: readonly string[];
    orderSourceIds: readonly string[];
  },
  signal: AbortSignal,
): Promise<unknown[]> {
  const hasStoreScope = scope.storeIds.length > 0;
  const hasOrderSourceScope = scope.orderSourceIds.length > 0;

  const rows: unknown[] = await fetchAllRows(({ from, to }) => {
    const orderQuery = supabase.from("orders").select(ORDERS_SELECT);
    // `business_id` is the authoritative tenancy key and has a composite
    // created-at index. Keep the store/source predicate below as a defence-in-
    // depth guard for legacy and source-only rows, but let the database narrow
    // the relation by business before evaluating the more expensive OR branch.
    const businessScopedQuery = orderQuery.eq("business_id", scope.businessId);
    // A business order is in scope through its legacy Woo store binding OR its
    // canonical Order Source — source-only orders (store_id NULL) must not
    // disappear from the list.
    const scopedQuery =
      hasStoreScope && hasOrderSourceScope
        ? businessScopedQuery.or(
            `store_id.in.(${scope.storeIds.join(",")}),order_source_id.in.(${scope.orderSourceIds.join(",")})`,
          )
        : hasStoreScope
          ? businessScopedQuery.in("store_id", scope.storeIds)
          : businessScopedQuery.in("order_source_id", scope.orderSourceIds);
    return withAbortSignal(scopedQuery, signal)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
  });

  return rows;
}

/**
 * Chunked order → category-id map fetch (pre-order detection + category
 * filter). Chunking keeps the `.in()` request line bounded at scale.
 */
async function loadOrderCategoryMap(
  rows: readonly UnknownRecord[],
  signal: AbortSignal,
): Promise<Map<string, Set<string>>> {
  const productIds = collectProductIds(rows as unknown as CategoryMapOrder[]);
  const chunks = chunkArray(productIds, PRODUCT_CATEGORY_QUERY_CHUNK);
  const pages: ProductCategoryRow[][] = [];
  for (let offset = 0; offset < chunks.length; offset += CATEGORY_QUERY_CONCURRENCY) {
    const batch = await Promise.all(
      chunks.slice(offset, offset + CATEGORY_QUERY_CONCURRENCY).map((chunk) =>
        fetchAllRows<ProductCategoryRow>(({ from, to }) =>
          withAbortSignal(
            supabase
              .from("product_categories")
              .select("product_id, category_id")
              .in("product_id", chunk),
            signal,
          ).range(from, to),
        ),
      ),
    );
    pages.push(...batch);
  }
  const productCatRows = pages.flat();

  return buildOrderCategoryMap(rows as unknown as CategoryMapOrder[], productCatRows);
}

/**
 * Attach an abort signal to a Supabase query builder when the installed client
 * supports it (postgrest-js `abortSignal`). Mocks/older clients may not expose
 * the method; the timeout still surfaces as a rejection there, this just makes
 * the in-flight request cancellable when possible.
 */
function withAbortSignal<T extends object>(query: T, signal: AbortSignal): T {
  const candidate = query as T & { abortSignal?: (value: AbortSignal) => unknown };
  if (typeof candidate.abortSignal === "function") candidate.abortSignal(signal);
  return query;
}

/** Extract a displayable message from a thrown value (unknown-safe). */
function readErrorMessage(err: unknown): string | null {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  if (typeof message === "string" && message.length > 0) return message;
  const text = String(err ?? "");
  return text.length > 0 ? text : null;
}

/** Turn a thrown value into a user-facing message, preferring a timeout hint. */
function describeLoadError(err: unknown, signal: AbortSignal): string {
  if (signal.aborted) {
    return `Loading orders took longer than ${Math.round(
      ORDERS_LOAD_TIMEOUT_MS / 1000,
    )} seconds and was cancelled. Check your connection, then retry.`;
  }
  return readErrorMessage(err) ?? "Could not load orders";
}

/** Structural check so an unexpected cache entry is ignored, never painted. */
function isOrdersCachePayload(value: unknown): value is OrdersCachePayload {
  if (!isRecord(value)) return false;
  return Array.isArray(value.orders) && value.orderCategoryMap instanceof Map;
}

/** Clone cached rows so page-local mutations (e.g. pre-order promotion) can't write through. */
function cloneOrders(orders: readonly OrderRow[]): OrderRow[] {
  return orders.map((order) => ({
    ...order,
    order_source: order.order_source
      ? {
          ...order.order_source,
          brands: order.order_source.brands ? { ...order.order_source.brands } : null,
        }
      : null,
    brand: order.brand ? { ...order.brand } : null,
    brands: order.brands ? order.brands.map((b) => ({ ...b })) : null,
    stores: order.stores ? { ...order.stores } : null,
    productItems: order.productItems.map((item) => ({ ...item })),
  }));
}

function cloneCategoryMap(
  map: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const clone = new Map<string, Set<string>>();
  map.forEach((categories, orderId) => {
    clone.set(orderId, new Set(categories));
  });
  return clone;
}

export interface UseOrdersDataOptions {
  /**
   * The store the page is filtered to ("all" or a store id). A filter that is
   * not one of this business's stores (stale deep link, back button, a link
   * from another business) must not become a scope of its own nor downgrade to
   * "every store of the business": it fails closed, so nothing is read.
   */
  storeFilter?: string;
}

export function useOrdersData(options: UseOrdersDataOptions = {}): UseOrdersDataResult {
  const requestedStore = options.storeFilter ?? "all";
  const { brands, active } = useBusinessContext();
  const businessStores = useStoresList();
  // Memoized on the store array's identity (useStoresList memoizes it by the
  // canonical scope), so the row query predicate is stable across renders.
  const storeIds = useMemo(() => businessStores.map((store) => store.id), [businessStores]);
  // Brand ids feed the order-source scope. Filter empties so a partial brand
  // row can never turn into `.in("brand_id", [undefined])` (a 400 in PostgREST)
  // — the load then just keeps the store-only scope.
  const brandIds = useMemo(
    () => brands.map((brand) => asText(brand.id)).filter((id): id is string => id !== null),
    [brands],
  );

  // Cache scope: business id + the context instance (so a different session
  // can't read this one's payload) + the exact row predicate.
  const sessionScope = useMemo(() => ordersContextSessionToken(active), [active]);

  // First-render snapshot: the exact scope key (store ids, order-source ids)
  // only resolves after async lookups, but last visit's payload is already in
  // memory. Seeding state from it lets a revisit paint real rows on its first
  // render instead of a skeleton (or an empty-state flash) while those lookups
  // land; `loadOrders` revalidates against the real predicate and overwrites it.
  // It is stamped with the business/session it came from, so switching business
  // can never leave the previous business's rows on screen.
  const [cachedSnapshot] = useState<{
    businessId: string;
    sessionScope: string;
    payload: OrdersCachePayload;
  } | null>(() => {
    const hit = readLatestOrdersCache<OrdersCachePayload>(
      active?.id ?? null,
      sessionScope,
    );
    if (!hit || !isOrdersCachePayload(hit.payload)) return null;
    return {
      businessId: (active?.id ?? "").trim(),
      sessionScope,
      payload: hit.payload,
    };
  });
  // Brands that still carry a store mapping mean stores are *expected*: an
  // empty list at that point is "not resolved yet", not "no scope". A business
  // with no mapped stores at all still fails closed (the branch in loadOrders).
  const hasConfiguredStores = useMemo(
    () => brands.some((brand) => asText(brand.woo_store_id) !== null),
    [brands],
  );

  const [orders, setOrders] = useState<OrderRow[]>(() =>
    cachedSnapshot ? cloneOrders(cachedSnapshot.payload.orders) : [],
  );
  const [orderCategoryMap, setOrderCategoryMap] = useState<Map<string, Set<string>>>(
    () =>
      cachedSnapshot
        ? cloneCategoryMap(cachedSnapshot.payload.orderCategoryMap)
        : new Map<string, Set<string>>(),
  );
  const [loading, setLoading] = useState(cachedSnapshot === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orderSourceError, setOrderSourceError] = useState<string | null>(null);

  // Order-source scoping companion: orders whose source has no legacy Woo-store
  // binding get store_id NULL, so store_id scoping alone would hide them. They
  // stay visible through their order_source_id instead.
  const [orderSourceIds, setOrderSourceIds] = useState<string[]>([]);
  // Retry bumps this so the effect below re-runs the scope fetch — a failed
  // scope fetch otherwise leaves the query under-scoped forever.
  const [scopeReloadKey, setScopeReloadKey] = useState(0);
  // An order-source-only business has no store ids to keep the empty state from
  // rendering while its source scope is still being resolved.
  const [orderSourceScopeSettled, setOrderSourceScopeSettled] = useState(false);

  // Request token for the load pipeline. Each loadOrders() call takes a token;
  // after every await a run checks whether a newer run has started and abandons
  // itself if so. Without this, the last *response* won — a slow scope-partial
  // response could overwrite the full list and nothing refetched it.
  const loadTokenRef = useRef(0);

  // Aborts the previous in-flight request when a new load starts. A scope
  // change mid-fetch (e.g. store scope lands, order-source scope lands, or
  // the user retries) used to leave the stale request running until it either
  // timed out or resolved and got silently dropped by isStale(). Aborting it
  // frees the connection immediately and surfaces the new scope's response.
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeLoadScopeRef = useRef<string | null>(null);
  const cancelLoad = useCallback((nextScopeKey: string) => {
    // A same-scope refresh may join the existing deduped request. Aborting in
    // that case would cancel the request that the new caller is about to
    // reuse, so only cancel when the query predicate actually changed.
    if (activeLoadScopeRef.current === null || activeLoadScopeRef.current === nextScopeKey) {
      return;
    }
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeLoadScopeRef.current = null;
  }, []);

  const scopeKey = useMemo(
    () =>
      makeOrdersScopeKey(storeIds, {
        orderSourceIds,
        businessId: active?.id ?? null,
        sessionScope,
      }),
    [storeIds, orderSourceIds, active?.id, sessionScope],
  );

  useEffect(() => {
    setOrderSourceScopeSettled(false);
    if (!active?.id || brandIds.length === 0) {
      setOrderSourceIds([]);
      setOrderSourceError(null);
      setOrderSourceScopeSettled(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("order_sources")
          .select("id")
          .in("brand_id", brandIds);
        if (cancelled) return;
        if (error) {
          // Was swallowed (`{ data }` only) — the page then ran a
          // store-scope-only query and silently lost source-only orders.
          // Surface it; retryLoad() re-runs this fetch.
          setOrderSourceError(error.message || "Could not load order sources");
          setOrderSourceScopeSettled(true);
          return;
        }
        setOrderSourceError(null);
        setOrderSourceIds((data || []).map((row: { id: string }) => row.id));
        setOrderSourceScopeSettled(true);
      } catch (err) {
        if (!cancelled) {
          setOrderSourceError(readErrorMessage(err) ?? "Could not load order sources");
          setOrderSourceScopeSettled(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.id, brandIds, scopeReloadKey]);

  // Abandon any in-flight run on unmount so a late response can't set state.
  // (The request itself is left to finish: a remount may join it via dedupe.)
  useEffect(() => {
    return () => {
      loadTokenRef.current += 1;
    };
  }, []);

  const loadOrders = useCallback(async () => {
    const token = ++loadTokenRef.current;
    const isStale = () => token !== loadTokenRef.current;

    // Scope inputs resolve independently. Stop the old scope's network work
    // before starting a new one; otherwise the initial source-only query and
    // the later full query both scan the entire orders relation in parallel.
    cancelLoad(scopeKey);

    const hasStoreScope = storeIds.length > 0;
    const hasOrderSourceScope = orderSourceIds.length > 0;
    const waitingForOrderSourceScope =
      !hasStoreScope && Boolean(active?.id) && brandIds.length > 0 && !orderSourceScopeSettled;

    if (waitingForOrderSourceScope) {
      setLoading(true);
      return;
    }

    // A store filter carried over from somewhere else (previous business, stale
    // session, hand-edited URL) would otherwise read the whole business and then
    // filter client-side to nothing — a pointless read that still leaks the
    // shape of the data into the network log. Fail closed instead.
    const filterIsForeign =
      requestedStore !== "all" && !storeIds.includes(requestedStore);
    if (filterIsForeign) {
      setOrders([]);
      setOrderCategoryMap(new Map());
      setLoadError(null);
      setLoading(false);
      return;
    }

    if (!hasStoreScope && !hasOrderSourceScope) {
      // Fail-closed: no scoping known yet (still resolving) or none exists.
      // When a scope source lands, this callback's deps change and a real
      // load supersedes this placeholder state.
      //
      // The one exception is a business that is merely still resolving its
      // store list while we already hold its last payload: keep that snapshot
      // on screen rather than flashing the empty state, and let the scoped
      // load replace it. The snapshot is stamped with the business/session it
      // came from, so a business switch clears the old rows instead of keeping
      // them. A business with no store mapping has nothing cached, so it still
      // shows nothing (fail-closed).
      const snapshotMatchesScope =
        cachedSnapshot !== null &&
        cachedSnapshot.businessId === (active?.id ?? "").trim() &&
        cachedSnapshot.sessionScope === sessionScope;
      if (snapshotMatchesScope && hasConfiguredStores) {
        setOrders((prev) =>
          prev.length > 0 ? prev : cloneOrders(cachedSnapshot.payload.orders),
        );
        setOrderCategoryMap((prev) =>
          prev.size > 0 ? prev : cloneCategoryMap(cachedSnapshot.payload.orderCategoryMap),
        );
        setLoadError(null);
        setLoading(false);
        return;
      }
      setOrders([]);
      setOrderCategoryMap(new Map());
      setLoadError(null);
      setLoading(false);
      return;
    }

    // 1. Paint the last good payload synchronously. On a hit the page never
    //    shows its skeleton and no request has to finish before rows render;
    //    the revalidation below refreshes it in the background.
    const cached = readOrdersCache<OrdersCachePayload>(scopeKey);
    if (cached && isOrdersCachePayload(cached.payload)) {
      setOrders(cloneOrders(cached.payload.orders));
      setOrderCategoryMap(cloneCategoryMap(cached.payload.orderCategoryMap));
      setLoadError(null);
      setLoading(false);
    }
    if (isStale()) return;

    // One deadline for the whole load (rows + category map): a hung request
    // used to leave the page on its skeleton forever. `abortSignal` is only
    // attached when the client supports it (mocks/older clients don't).
    const abortController = new AbortController();
    // A same-scope caller can join the existing deduped promise. Keep the
    // original controller in that case; replacing it would make a later scope
    // switch unable to abort the network request that is actually running.
    const ownsAbortController = activeLoadScopeRef.current !== scopeKey;
    if (ownsAbortController) {
      abortControllerRef.current = abortController;
      activeLoadScopeRef.current = scopeKey;
    }
    const loadSignal = ownsAbortController
      ? abortController.signal
      : abortControllerRef.current?.signal ?? abortController.signal;
    const timeoutId = globalThis.setTimeout(
      () => abortController.abort(),
      ORDERS_LOAD_TIMEOUT_MS,
    );

    try {
      // Concurrent identical loads (StrictMode double-mount, a remount racing
      // a scope change, the "orders:refresh" event during a fetch) share one
      // request — telemetry says the list query is the expensive part.
      const rows = await dedupeFetch<unknown[]>(`${scopeKey}|rows`, () =>
        fetchOrderRows(
          { businessId: active?.id ?? "", storeIds, orderSourceIds },
          loadSignal,
        ),
      );
      if (isStale()) return;

      const mapped = mapOrderRows(rows, { brands, storeIds, orderSourceIds });

      // 2. Progressive first paint: commit the rows NOW, before the category
      //    map is fetched. The map only gates category tabs / pre-order
      //    detection, so the list is interactive while it loads.
      setOrders(mapped.orders);
      setLoadError(null);
      setLoading(false);
      if (isStale()) return;

      // The map request starts in the same tick as the row commit, so its
      // query goes out immediately while React renders the rows.
      const orderCatMap = await loadOrderCategoryMap(mapped.rows, loadSignal);
      if (isStale()) return;

      // 3. Second commit: rows + map are complete and safe to cache together.
      //    Only this commit writes the cache, so a half-loaded payload (rows
      //    without the map) is never painted on the next visit.
      setOrderCategoryMap(orderCatMap);
      writeOrdersCache<OrdersCachePayload>(scopeKey, {
        orders: mapped.orders,
        orderCategoryMap: orderCatMap,
      });
    } catch (err) {
      // Surface the failure and KEEP the previous rows: stale-but-real data
      // plus an error banner beats a silently blank page. A cached payload
      // painted above is deliberately left in place.
      if (isStale()) return;
      setLoadError(describeLoadError(err, loadSignal));
      setLoading(false);
    } finally {
      globalThis.clearTimeout(timeoutId);
      if (ownsAbortController && abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
        activeLoadScopeRef.current = null;
      }
    }
  }, [
    storeIds,
    orderSourceIds,
    brands,
    brandIds,
    scopeKey,
    cachedSnapshot,
    hasConfiguredStores,
    active?.id,
    sessionScope,
    orderSourceScopeSettled,
    requestedStore,
    cancelLoad,
  ]);

  // Refetch whenever the scope inputs settle/change. On first render this runs
  // with no scope (placeholder above), then again per scope arrival; the
  // request token keeps the overlapping runs from clobbering each other.
  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // External triggers (e.g. the "Move to Making" popup applying a status
  // change) can dispatch "orders:refresh" to refetch without prop-drilling.
  useEffect(() => {
    const handler = () => {
      loadOrders();
    };
    window.addEventListener("orders:refresh", handler);
    return () => window.removeEventListener("orders:refresh", handler);
  }, [loadOrders]);

  const retryLoad = useCallback(() => {
    // Drop the cached payload first: retrying while the cache still serves the
    // payload we failed to refresh would just repaint stale rows. Then re-run
    // the order-source scope fetch too (via the effect's reload key): retrying
    // the same under-scoped query would just refetch the wrong set.
    invalidateOrdersCache(scopeKey);
    setScopeReloadKey((k) => k + 1);
    loadOrders();
  }, [loadOrders, scopeKey]);

  return {
    orders,
    setOrders,
    orderCategoryMap,
    loading,
    loadError,
    orderSourceError,
    loadOrders,
    retryLoad,
  };
}
