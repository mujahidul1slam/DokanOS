/**
 * Paged Supabase fetching.
 *
 * The hosted Supabase REST API (PostgREST) silently truncates any single
 * request at a server-side max-rows cap (1000 on hosted projects): the
 * response is HTTP 200 with `Content-Range: 0-999/*` and NO error field, so
 * an unpaginated `.select()` on a larger table returns partial data that is
 * indistinguishable from a complete result.
 *
 * ShohozBiz hit exactly this on the Add Order screen: `product_variations`
 * had 1180 rows, the unpaginated fetch returned 1000, and the 180 silently
 * missing rows meant variable products lost their variation selector
 * entirely (added without a size) or showed only some of their sizes.
 *
 * `fetchAllRows` walks range windows until a short page (the last page)
 * arrives, throwing on error so a failed fetch is never silently swallowed.
 */
export const SUPABASE_MAX_ROWS = 1000;

/** Hard safety valve: stop after 50k rows (50 pages) even if a short page never arrives. */
const MAX_PAGES = 50;

interface SupabasePageResponse<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

export async function fetchAllRows<T = any>(
  makeQuery: (range: { from: number; to: number }) => PromiseLike<SupabasePageResponse<T>>,
  pageSize: number = SUPABASE_MAX_ROWS,
): Promise<T[]> {
  if (pageSize < 1) throw new Error("pageSize must be >= 1");
  const out: T[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await makeQuery({ from, to: from + pageSize - 1 });
    if (error) throw new Error(error.message || "Fetch failed");
    const rows = data || [];
    out.push(...rows);
    // A short page means we've reached the end of the table.
    if (rows.length < pageSize) return out;
    from += pageSize;
  }
  return out;
}
