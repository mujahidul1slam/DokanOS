/**
 * Orders page data loading (issue #9).
 *
 * Extracted from Orders.tsx so the load pipeline has a testable seam — the
 * intermittent "orders don't load" bug was a data-loading race, not
 * rendering. This hook owns:
 *
 *  1. Business scoping — an order is in scope through its legacy Woo store
 *     binding (`store_id`) OR its canonical Selling Point
 *     (`selling_point_id`); selling-point-only orders (store_id NULL) must
 *     not disappear from the list.
 *  2. Stale-response guarding (issue #9 ROOT CAUSE). The scope inputs resolve
 *     asynchronously and independently (useStoresList fetch, the
 *     selling_points fetch below, business-context brands refresh), so
 *     several load runs overlap — first "no scope", then "one scope only"
 *     (a PARTIAL row set), then "both scopes" (full). Previously the last
 *     RESPONSE won, so a slow partial response could overwrite the full list
 *     and it stayed wrong until remount: missing rows were exactly the
 *     class one scope didn't cover (app-created selling-point-only orders —
 *     the "new" and "pre-order" pipeline). Every run now takes a request
 *     token and a run that has been superseded never touches state.
 *  3. Pagination (issue #9). PostgREST silently truncates an unpaginated
 *     request at the server max-rows cap (1000 on hosted projects) with
 *     HTTP 200 and no error — see src/lib/supabasePage.ts, which documents
 *     this exact class of bug hitting this app before. All fetches go
 *     through fetchAllRows.
 *  4. Error surfacing (issue #9). A failed request used to be swallowed
 *     (`const { data } = await ...`) and rendered as an empty or stale list
 *     with no feedback. Errors now land in `loadError` / `sellingPointError`
 *     (the page shows a banner with Retry) and the previous rows stay on
 *     screen — stale-but-real beats a silent blank page.
 *  5. Atomic commit: rows and the order → category map are committed
 *     together. A half-updated pair (rows from one run, map from another)
 *     mis-tab-orders between "new" and "pre_order", which both key off
 *     pre-order category detection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { useStoresList } from "@/hooks/useStoresList";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePage";
import { brandAccent, deriveBrandForStore } from "@/lib/brandIdentity";
import {
  buildOrderCategoryMap,
  chunkArray,
  collectProductIds,
  PRODUCT_CATEGORY_QUERY_CHUNK,
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
  woo_order_id: number | null;
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

/** The orders select — one constant so the query and its docs stay in sync. */
const ORDERS_SELECT =
  "id, order_number, total, status, source, payment_method, payment_status, consignment_id, tracking_status, fulfillment_type, created_at, deleted_at, store_id, order_source_id, woo_order_id, parent_order_id, customer_id, amount_to_collect, pathao_recipient_city, pathao_recipient_zone, pathao_recipient_area, pathao_store_id, item_weight, special_instruction, customer_name, customer_phone, customer_address, customer_city, customer_email, pickup_slip_printed_at, measurement_slip_printed_at, stores(name), order_source:order_sources(id, name, brand_id, type, brands(id, name, logo_url, woo_store_id)), order_items(id, product_id, product_name, quantity, products(stock_status))";

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
  /** True only before the first load settles (page shows its skeleton). */
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

export function useOrdersData(): UseOrdersDataResult {
  const { brands, active } = useBusinessContext();
  const businessStores = useStoresList();
  const storeIds = useMemo(() => businessStores.map((s) => s.id), [businessStores]);
  const brandIds = useMemo(() => brands.map((brand) => brand.id), [brands]);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderCategoryMap, setOrderCategoryMap] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orderSourceError, setOrderSourceError] = useState<string | null>(null);

  // Order-source scoping companion: orders whose source has no legacy Woo-store
  // binding get store_id NULL, so store_id scoping alone would hide them. They
  // stay visible through their order_source_id instead.
  const [orderSourceIds, setOrderSourceIds] = useState<string[]>([]);
  // Issue #9: retry bumps this so the effect below re-runs the scope fetch —
  // a failed scope fetch otherwise leaves the query under-scoped forever.
  const [scopeReloadKey, setScopeReloadKey] = useState(0);

  // Issue #9 (ROOT CAUSE): request token for the load pipeline. Each
  // loadOrders() call takes a token; after every await a run checks whether a
  // newer run has started and abandons itself if so. Without this, the last
  // *response* won — a slow scope-partial response could overwrite the full
  // list and nothing refetched it. Same idiom as useBusinessContext's
  // scopedLoadToken.
  const loadTokenRef = useRef(0);

  useEffect(() => {
    if (!active?.id || brandIds.length === 0) {
      setOrderSourceIds([]);
      setOrderSourceError(null);
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
          // Issue #9: was swallowed (`{ data }` only) — the page then ran a
          // store-scope-only query and silently lost source-only orders.
          // Surface it; retryLoad() re-runs this fetch.
          setOrderSourceError(error.message || "Could not load order sources");
          return;
        }
        setOrderSourceError(null);
        setOrderSourceIds((data || []).map((row: { id: string }) => row.id));
      } catch (err: any) {
        if (!cancelled) setOrderSourceError(err?.message ? String(err.message) : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.id, brandIds, scopeReloadKey]);

  const loadOrders = useCallback(async () => {
    const token = ++loadTokenRef.current;
    const isStale = () => token !== loadTokenRef.current;

    const hasStoreScope = storeIds.length > 0;
    const hasOrderSourceScope = orderSourceIds.length > 0;
    if (!hasStoreScope && !hasOrderSourceScope) {
      // Fail-closed: no scoping known yet (still resolving) or none exists.
      // When a scope source lands, this callback's deps change and a real
      // load supersedes this placeholder state.
      setOrders([]);
      setOrderCategoryMap(new Map());
      setLoadError(null);
      setLoading(false);
      return;
    }

    try {
      // Paged fetch: an unpaginated select is silently truncated at the
      // PostgREST max-rows cap (see supabasePage.ts). The secondary
      // `.order("id")` gives paging a deterministic tie-break so rows can
      // never be skipped or duplicated across pages on equal created_at.
      const rows = await fetchAllRows(({ from, to }) => {
        const orderQuery = supabase.from("orders").select(ORDERS_SELECT);
        // A business order is in scope through its legacy Woo store binding
        // OR its canonical Order Source — source-only orders
        // (store_id NULL) must not disappear from the list.
        const scopedQuery =
          hasStoreScope && hasOrderSourceScope
            ? orderQuery.or(
                `store_id.in.(${storeIds.join(",")}),order_source_id.in.(${orderSourceIds.join(",")})`,
              )
            : hasStoreScope
              ? orderQuery.in("store_id", storeIds)
              : orderQuery.in("order_source_id", orderSourceIds);
        return scopedQuery
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
      });
      if (isStale()) return;

      // order → category-id map (pre-order detection + category filter).
      // Chunked so the `.in()` request line stays bounded at scale (issue #9).
      const productCatRows: ProductCategoryRow[] = [];
      const productIds = collectProductIds(rows as any[]);
      if (productIds.length > 0) {
        for (const chunk of chunkArray(productIds, PRODUCT_CATEGORY_QUERY_CHUNK)) {
          const page = await fetchAllRows<ProductCategoryRow>(({ from, to }) =>
            supabase
              .from("product_categories")
              .select("product_id, category_id")
              .in("product_id", chunk)
              .range(from, to),
          );
          productCatRows.push(...page);
          if (isStale()) return;
        }
      }
      const orderCatMap = buildOrderCategoryMap(rows as any[], productCatRows);
      if (isStale()) return;

      // Atomic commit — rows and map together (issue #9): a half-updated
      // pair mis-tabs orders between "new" and "pre_order".
      const mapped = (rows || []).map((o: any) => {
        const canonicalBrand = o.order_source?.brands
          ? { ...o.order_source.brands, accent: brandAccent(o.order_source.brands.id) }
          : undefined;
        const legacyBrand = canonicalBrand || (() => {
          const fallback = deriveBrandForStore(brands, o.store_id);
          return fallback ? { ...fallback, accent: brandAccent(fallback.id) } : undefined;
        })();
        return {
          ...o,
          brand: legacyBrand || null,
          itemCount: o.order_items?.length || 0,
          productItems: (o.order_items || [])
            .filter((i: any) => i.product_name)
            .map((i: any) => ({ name: i.product_name, qty: i.quantity || 1 })),
          isPreOrder: false, // recomputed reactively from category settings
        };
      });
      setOrders(mapped as OrderRow[]);
      setOrderCategoryMap(orderCatMap);
      setLoadError(null);
      setLoading(false);
    } catch (err: any) {
      // Issue #9: was silent (`const { data } = await ...`) — a failed
      // request rendered as an empty or stale list with no feedback and no
      // retry. Surface it and KEEP the previous rows: stale-but-real data
      // plus an error banner beats a silently blank page.
      if (isStale()) return;
      setLoadError(err?.message ? String(err.message) : String(err));
      setLoading(false);
    }
  }, [storeIds, orderSourceIds, brands]);

  // Refetch whenever the scope inputs settle/change. On first render this
  // runs with no scope (placeholder above), then again per scope arrival;
  // the request token keeps the overlapping runs from clobbering each other.
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
    // Re-run the selling-point scope fetch too (via the effect's reload key):
    // retrying the same under-scoped query would just refetch the wrong set.
    setScopeReloadKey((k) => k + 1);
    loadOrders();
  }, [loadOrders]);

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
