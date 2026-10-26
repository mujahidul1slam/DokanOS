import { useMemo } from "react";
import type { PostgrestFilterBuilder } from "@supabase/supabase-js";
import { storeScopeKey, useStoresList } from "@/hooks/useStoresList";

/**
 * Hybrid-tenancy scope seam (issue #16).
 *
 * Operational tables (orders, products, order_items, categories, …) have no
 * business_id column: their only tenant link is store_id. Every tenant-scoped
 * read therefore needs "the store ids of the ACTIVE business" — derived from the
 * active business's brands (legacy woo_store_id links), never from the active
 * business id.
 *
 * One seam, reused everywhere, so pages cannot each re-derive it differently:
 *
 *   - `useActiveBusinessStoreIds()` → the scope array (empty when out of scope)
 *   - `scopeStoreIds(query, ids)`    → apply `.in("store_id", ids)` to a query
 *   - `selectedStoreScope(...)`      → the effective scope for a store filter
 */

/** Module-level constant so "fail closed" keeps a stable identity across renders. */
export const NO_STORE_IDS: string[] = [];

/**
 * Fail-closed scope of the active business's legacy store ids.
 *
 * Returns a STABLE array identity while the store SET is unchanged — the value
 * is memoized on the canonical key of that set, so neither a re-emitted array
 * nor a reordered one can fake a switch — and the out-of-scope case returns the
 * module constant, so a caller may safely put it in an effect dependency list.
 *
 * Empty means "no tenant scope". Callers must NOT read (fail open) in that case:
 * an empty scope is not "all stores", it is "no stores readable".
 */
export const useActiveBusinessStoreIds = (): string[] => {
  const stores = useStoresList();
  /**
   * Canonical identity of the current store set (order- and duplicate-insensitive
   * — see `storeScopeKey`). Memoizing on this KEY rather than on the `stores`
   * array identity is what keeps the scope honest: a benign re-emission of the
   * same stores (new array, possibly a different row order) must not hand a
   * consumer a new array, because every scoped effect and query key reads that
   * as a scope change — clearing the scope and re-sweeping the dashboard for a
   * business that never changed.
   *
   * The array is canonical (deduplicated, sorted) for the same reason: two
   * renderings of one store set are one identity, and `.in(column, ids)` is
   * order-insensitive, so no caller depends on emission order.
   */
  const key = storeScopeKey(stores.map((store) => store.id));
  return useMemo(() => (key === "" ? NO_STORE_IDS : key.split(",")), [key]);
};

/** The shape a store-id filter is applied to: any supabase-js filter builder. */
export type StoreScopedQuery = PostgrestFilterBuilder<any, any, any, unknown, unknown>;

/**
 * Applies the tenant predicate to a query. Passing the empty scope is a caller
 * bug — callers must fail closed *before* building the query — so this is only
 * ever called with a non-empty scope.
 */
export const scopeStoreIds = <Q extends StoreScopedQuery>(query: Q, storeIds: string[]): Q =>
  query.in("store_id", storeIds) as Q;

/**
 * Effective store scope for a Dashboard-style filter.
 *
 * - explicit store selection → `[storeId]`, but ONLY when that store belongs to
 *   the active business's `businessStoreIds`; otherwise `[]` (fail closed — a
 *   stale selection from the previous business must never become the scope)
 * - "pos" → `null` source filter, still scoped by the business's store ids
 * - "all" (any other value) → every store of the ACTIVE business, never
 *   "every store the RLS policies happen to allow"
 */
export const selectedStoreScope = (
  storeId: string,
  businessStoreIds: string[],
): { source?: "pos"; storeIds: string[] } => {
  if (storeId === "pos") return { source: "pos", storeIds: businessStoreIds };
  if (storeId !== "all") {
    const inBusiness = !!storeId && businessStoreIds.includes(storeId);
    return { storeIds: inBusiness ? [storeId] : NO_STORE_IDS };
  }
  return { storeIds: businessStoreIds };
};

/**
 * True when the scope can query at all. Consumers use this to fail closed:
 * render "no stores in this business" instead of issuing an unscoped read.
 */
export const hasStoreScope = (storeIds: string[]): boolean => storeIds.length > 0;
