import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";

export interface StoreLite {
  id: string;
  name: string;
  status?: string;
}

/**
 * Task 10.11 Consumer Guard:
 * Scopes store pickers to the active business's brands when within a business context,
 * preventing disconnected placeholder stores or other tenant stores from leaking.
 */
export const useStoresList = () => {
  const [stores, setStores] = useState<StoreLite[]>([]);
  let brands: any[] = [];
  let activeId: string | null = null;
  try {
    const ctx = useBusinessContext();
    brands = ctx.brands || [];
    activeId = ctx.active?.id || null;
  } catch {
    // Graceful fallback if called outside BusinessContextProvider (e.g. tests or public surfaces)
  }

  useEffect(() => {
    let active = true;
    (async () => {
      let query = supabase.from("stores").select("id, name, status").order("name");
      const activeStoreIds = brands.map((b) => b.woo_store_id).filter(Boolean) as string[];
      if (activeStoreIds.length > 0) {
        query = query.in("id", activeStoreIds);
      }
      const { data } = await query;
      if (active) setStores((data as StoreLite[]) || []);
    })();
    return () => {
      active = false;
    };
  }, [activeId, brands.length]);

  return stores;
};
