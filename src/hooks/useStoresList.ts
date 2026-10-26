import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";

export interface StoreLite {
  id: string;
  name: string;
  status?: string;
}

/**
 * Brand → store mapping kept as one extractable expression so Release 2's
 * useBusinessStores generalizes it rather than rewrites it
 * (Release-2 constraint 2).
 */
export const brandStoreIdsOf = (
  brands: Array<{ woo_store_id: string | null }> | null | undefined,
): string[] => (brands ?? []).map((b) => b.woo_store_id).filter(Boolean) as string[];

/**
 * Canonical identity of a store-id SET: order- and duplicate-insensitive, so the
 * emission order of the ids can never masquerade as a scope change.
 *
 * Why it matters: the scope is an effect dependency for every tenant-scoped read
 * (and for the fail-closed gate). A re-read that emits the SAME links in a
 * different order — or the same stores in a different row order — must not look
 * like a business switch, because a false switch clears the scope, publishes the
 * fail-closed empty scope for a render and re-sweeps the whole dashboard.
 * Two accounts for the same store (duplicate links) are one store, not two.
 */
export const storeScopeKey = (storeIds: string[]): string =>
  Array.from(new Set(storeIds)).sort().join(",");

/**
 * Task 10.11 Consumer Guard + R3-a fail-closed fix:
 *
 * Scopes store lists to the active business's brands and FAILS CLOSED
 * (audit R3-a / R2a; D-17 seam):
 * - active business with zero brand-store links → [] with NO stores query
 *   at all — never all readable stores (the old fail-open behavior)
 * - no business context (outside provider or null active) → [] without a query
 * - with brand-store links → only those stores (.in("id", ids))
 *
 * Does NOT read usePermissions.storeIds / hasStoreAccess for scoping — that
 * source is fail-open and unions across ALL businesses (audit R2a prohibition).
 *
 * Hybrid tenancy (issue #16): the returned list is the tenant scope every
 * operational query derives from, so it must never be STALE. When the active
 * business (or its brand-store mapping) changes, the list is cleared during that
 * very render — a consumer reading `useActiveBusinessStoreIds()` in the same
 * render as a business switch sees the empty, fail-closed scope, not the
 * previous business's stores (the effects that re-fetch run too late for that).
 */
// Stable empty fallback — a per-render `[]` in the effect deps would
// retrigger the effect every render (reference inequality) and loop forever.
const NO_BRANDS: Array<{ woo_store_id: string | null }> = [];

/**
 * The scoped store list PLUS whether the current scope has settled.
 *
 * An empty list is ambiguous on its own — "this business's brands map to no
 * stores" and "the list is still being read" look identical — and the difference
 * is user-visible: a page that fails closed must show an empty state for the
 * first and its loading state for the second, never claim the first while the
 * second is true. `settled` is the missing bit: true only once the list returned
 * belongs to the scope currently requested, the server-side context for that
 * scope has converged, AND an active business exists to attribute that answer
 * to (with no active business there is no tenant scope to have mapped — or not
 * mapped — any store).
 */
export const useStoresListState = (): { stores: StoreLite[]; settled: boolean } => {
  const [stores, setStores] = useState<StoreLite[]>([]);
  /** Scope whose list `stores` currently reflects; null until the first resolve. */
  const [settledScope, setSettledScope] = useState<string | null>(null);
  let brands = NO_BRANDS;
  let activeId: string | null = null;
  /**
   * Server-context convergence gate (issue #16): stores are operational data,
   * so this read must not fire until the provider confirms the server-side
   * active business. Fail closed when the gate is shut or the provider is
   * absent — an unconfirmed context is not a scope to read under.
   */
  let contextReady = false;
  try {
    const ctx = useBusinessContext();
    brands = ctx.brands || NO_BRANDS;
    activeId = ctx.active?.id || null;
    contextReady = ctx.contextReady === true;
  } catch {
    // Graceful fallback if called outside BusinessContextProvider (e.g. tests
    // or public surfaces) — fail-closed: no query, empty list.
  }

  /**
   * Identity of the scope the current `stores` belong to. Canonical, so a benign
   * brands refresh (same brand-store links, new array, any order, duplicate
   * links) cannot clear a perfectly valid list — a false scope change.
   */
  const scopeKey = `${activeId ?? ""}|${storeScopeKey(brandStoreIdsOf(brands))}`;
  const loadedScopeKey = useRef<string | null>(null);
  if (loadedScopeKey.current !== scopeKey) {
    // Render-phase reset: this render already publishes the new (empty) scope.
    loadedScopeKey.current = scopeKey;
    if (stores.length > 0) setStores([]);
  }

  useEffect(() => {
    if (!activeId || !contextReady) {
      // Either there is no active business (nothing to read, nothing to
      // attribute an answer to) or the server has not confirmed one yet —
      // no tenant read may be issued in either case.
      setStores([]);
      return;
    }
    const activeStoreIds = brandStoreIdsOf(brands);
    if (activeStoreIds.length === 0) {
      // Fail closed without a query: the scope is settled, and it is empty.
      setStores([]);
      setSettledScope(scopeKey);
      return;
    }
    let active = true;
    (async () => {
      const query = supabase
        .from("stores")
        .select("id, name, status")
        .order("name")
        .in("id", activeStoreIds);
      const { data } = await query;
      if (!active) return;
      setStores((data as StoreLite[]) || []);
      setSettledScope(scopeKey);
    })();
    return () => {
      active = false;
    };
  }, [activeId, brands, scopeKey, contextReady]);

  return {
    stores,
    settled: activeId !== null && contextReady && settledScope === scopeKey,
  };
};

export const useStoresList = (): StoreLite[] => useStoresListState().stores;
