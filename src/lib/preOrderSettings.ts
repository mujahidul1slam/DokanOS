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
  writeLocal(unique);
  try {
    await supabase
      .from("app_settings" as any)
      .upsert({ key: DB_KEY, value: { ids: unique } }, { onConflict: "key" });
  } catch (e) {
    console.warn("Failed to persist pre-order categories to DB", e);
  }
};

/** Hydrate from DB once on app load, overriding any stale local value. */
let hydrated = false;
export const hydratePreOrderCategoriesFromDB = async () => {
  if (hydrated) return;
  hydrated = true;
  try {
    const { data } = await supabase
      .from("app_settings" as any)
      .select("value")
      .eq("key", DB_KEY)
      .maybeSingle();
    if (data && (data as any).value && Array.isArray((data as any).value.ids)) {
      writeLocal((data as any).value.ids.filter((x: any) => typeof x === "string"));
    }
  } catch (e) {
    // ignore — fall back to local cache
  }
};

/** React hook reflecting the configured pre-order category id set. */
export const usePreOrderCategoryIds = (): Set<string> => {
  const [ids, setIds] = useState<Set<string>>(() => new Set(getPreOrderCategoryIds()));
  useEffect(() => {
    hydratePreOrderCategoriesFromDB();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (Array.isArray(detail)) setIds(new Set(detail));
      else setIds(new Set(getPreOrderCategoryIds()));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setIds(new Set(getPreOrderCategoryIds()));
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
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
 */
export const isOrderPreOrderByProducts = async (productIds: string[]): Promise<boolean> => {
  const configured = getPreOrderCategoryIds();
  if (configured.length === 0 || productIds.length === 0) return false;

  const [{ data: cats }, { data: pcs }] = await Promise.all([
    supabase.from("categories").select("id, parent_id"),
    supabase.from("product_categories").select("product_id, category_id").in("product_id", productIds),
  ]);
  const expanded = expandWithDescendants(configured, (cats || []) as any);
  return (pcs || []).some((pc: any) => expanded.has(pc.category_id));
};
