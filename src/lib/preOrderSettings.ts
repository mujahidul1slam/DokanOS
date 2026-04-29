import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const KEY = "omnisync-preorder-category-ids";
const DB_KEY = "preorder_category_ids";
const EVENT = "omnisync-preorder-categories-change";

export const getPreOrderCategoryIds = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const writeLocal = (ids: string[]) => {
  const unique = Array.from(new Set(ids));
  localStorage.setItem(KEY, JSON.stringify(unique));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: unique }));
};

export const setPreOrderCategoryIds = async (ids: string[]) => {
  const unique = Array.from(new Set(ids));
  try {
    const { error } = await supabase
      .from("app_settings" as any)
      .upsert({ key: DB_KEY, value: { ids: unique } }, { onConflict: "key" });
    if (error) throw error;
    writeLocal(unique);
  } catch (e) {
    console.warn("Failed to persist pre-order categories to DB", e);
    throw e;
  }
};

/**
 * Fetch from DB. Returns the authoritative ids array (or null if no row exists / error).
 * Concurrent calls share the same in-flight promise.
 */
let inflight: Promise<string[] | null> | null = null;
export const fetchPreOrderCategoriesFromDB = (): Promise<string[] | null> => {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("value")
        .eq("key", DB_KEY)
        .maybeSingle();
      if (error) return null;
      if (data && (data as any).value && Array.isArray((data as any).value.ids)) {
        const ids = (data as any).value.ids.filter((x: any) => typeof x === "string");
        writeLocal(ids);
        return ids;
      }
      return null;
    } catch {
      return null;
    } finally {
      // Allow refresh on next caller after a short delay so simultaneous mounts share, but later visits re-fetch
      setTimeout(() => { inflight = null; }, 0);
    }
  })();
  return inflight;
};

/** React hook reflecting the configured pre-order category id set. */
export const usePreOrderCategoryIds = (): Set<string> => {
  const [ids, setIds] = useState<Set<string>>(() => new Set(getPreOrderCategoryIds()));
  useEffect(() => {
    let cancelled = false;
    // Always re-fetch from DB on mount so every screen sees the same authoritative value
    fetchPreOrderCategoriesFromDB().then((dbIds) => {
      if (cancelled) return;
      if (dbIds !== null) setIds(new Set(dbIds));
    });
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (Array.isArray(detail)) setIds(new Set(detail));
      else setIds(new Set(getPreOrderCategoryIds()));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setIds(new Set(getPreOrderCategoryIds()));
    };
    const refresh = () => {
      fetchPreOrderCategoriesFromDB().then((dbIds) => {
        if (!cancelled && dbIds !== null) setIds(new Set(dbIds));
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return ids;
};

/**
 * Returns the set of category-ids (including descendants) that mark an order as Pre-Order.
 * Selecting a parent category implicitly includes all descendants.
 */
export const expandWithDescendants = (
  selected: Iterable<string>,
  categories: { id: string; parent_id?: string | null }[],
): Set<string> => {
  const childMap = new Map<string, string[]>();
  categories.forEach((c) => {
    if (c.parent_id) {
      if (!childMap.has(c.parent_id)) childMap.set(c.parent_id, []);
      childMap.get(c.parent_id)!.push(c.id);
    }
  });
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    (childMap.get(id) || []).forEach(walk);
  };
  for (const id of selected) walk(id);
  return out;
};

/**
 * Lookup helper: given an order's product ids, decide if it's a pre-order
 * based on configured category ids. Used in non-React contexts (e.g. slip print).
 * Always reads from DB to guarantee consistency.
 */
export const isOrderPreOrderByProducts = async (productIds: string[]): Promise<boolean> => {
  let configured = await fetchPreOrderCategoriesFromDB();
  if (configured === null) configured = getPreOrderCategoryIds();
  if (configured.length === 0 || productIds.length === 0) return false;

  const [{ data: cats }, { data: pcs }] = await Promise.all([
    supabase.from("categories").select("id, parent_id"),
    supabase.from("product_categories").select("product_id, category_id").in("product_id", productIds),
  ]);
  const expanded = expandWithDescendants(configured, (cats || []) as any);
  return (pcs || []).some((pc: any) => expanded.has(pc.category_id));
};
