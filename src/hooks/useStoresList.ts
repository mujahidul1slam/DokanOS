import { useEffect, useState } from "react";
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
 */
// Stable empty fallback — a per-render `[]` in the effect deps would
// retrigger the effect every render (reference inequality) and loop forever.
const NO_BRANDS: Array<{ woo_store_id: string | null }> = [];

export const useStoresList = () => {
  const [stores, setStores] = useState<StoreLite[]>([]);
  let brands = NO_BRANDS;
  let activeId: string | null = null;
  try {
    const ctx = useBusinessContext();
    brands = ctx.brands || NO_BRANDS;
    activeId = ctx.active?.id || null;
  } catch {
    // Graceful fallback if called outside BusinessContextProvider (e.g. tests
    // or public surfaces) — fail-closed: no query, empty list.
  }

  useEffect(() => {
    if (!activeId) {
      setStores([]);
      return;
    }
    const activeStoreIds = brandStoreIdsOf(brands);
    if (activeStoreIds.length === 0) {
      setStores([]);
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
      if (active) setStores((data as StoreLite[]) || []);
    })();
    return () => {
      active = false;
    };
  }, [activeId, brands]);

  return stores;
};
