/**
 * Pure helpers for the order → category-id map the Orders page builds after
 * every load (issue #9).
 *
 * Why this is its own dependency-free module: the map feeds two tab rules
 * (see tabFilters.ts) — "new" excludes pre-order orders and "pre_order"
 * catches them by category — so a missing or stale map entry silently moves
 * orders between exactly those two tabs (the tabs the bug report says lose
 * orders). Keeping the builder pure lets unit tests pin that the map comes
 * out complete whenever its raw inputs are complete.
 *
 * It is also home of the product-id chunking that bounds request URLs
 * (issue #9): one `.in("product_id", ids)` carrying every product id on the
 * page inflates the request URL past proxy limits at scale (hundreds of
 * 36-char UUIDs → 10s of KB of query string), and a 414 there fails the
 * whole fetch. Chunking keeps every request small.
 */

/** One order row as the map builder needs it. */
export interface CategoryMapOrder {
  id: string;
  order_items?: { product_id?: string | null }[] | null;
}

/** One product_categories row as the map builder needs it. */
export interface ProductCategoryRow {
  product_id: string;
  category_id: string;
}

/**
 * Max product ids per product_categories query (issue #9). 150 UUIDs ≈ 5.6KB
 * of query string — safely under the common 8KB proxy request-line limits —
 * while staying few enough requests for realistic catalogs.
 */
export const PRODUCT_CATEGORY_QUERY_CHUNK = 150;

/**
 * Split `items` into arrays of at most `size` (last chunk may be shorter).
 * Throws on a non-positive size so a bad constant fails loudly instead of
 * looping forever.
 */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size) as T[]);
  }
  return out;
}

/**
 * Distinct non-empty product ids across all order lines, in first-seen order.
 * These are the keys the product_categories lookup needs.
 */
export function collectProductIds(orders: readonly CategoryMapOrder[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of orders) {
    for (const item of o.order_items || []) {
      const id = String(item.product_id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Build order-id → set-of-category-ids from raw order rows plus the
 * product_categories rows for their products (issue #9).
 *
 * Every order in `orders` gets an entry (possibly an empty set) — callers ask
 * "is this order in category X?" and must be able to distinguish "no" from
 * "not loaded". Product ids missing from `productCategoryRows` contribute
 * nothing: absence there means the product has no category link.
 */
export function buildOrderCategoryMap(
  orders: readonly CategoryMapOrder[],
  productCategoryRows: readonly ProductCategoryRow[],
): Map<string, Set<string>> {
  const productCatMap = new Map<string, Set<string>>();
  productCategoryRows.forEach((pc) => {
    if (!productCatMap.has(pc.product_id)) productCatMap.set(pc.product_id, new Set());
    productCatMap.get(pc.product_id)!.add(pc.category_id);
  });
  const orderCatMap = new Map<string, Set<string>>();
  orders.forEach((o) => {
    const set = new Set<string>();
    (o.order_items || []).forEach((i) => {
      const cats = productCatMap.get(i.product_id ?? "");
      if (cats) cats.forEach((c) => set.add(c));
    });
    orderCatMap.set(o.id, set);
  });
  return orderCatMap;
}
