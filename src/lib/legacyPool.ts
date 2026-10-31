import { supabase } from "@/integrations/supabase/client";

/**
 * Task 15 — Legacy / unattributed pool (spec §7).
 *
 * After the cutover migration, rows nobody could attribute live in a
 * business-level "Legacy / unattributed" pool until staff reassign them to a
 * brand. The pool predicates below are the EXACT shapes
 * `scripts/migrate-enveil-vincent.sql` step 10 (lines 361-374) writes:
 *
 *   orders    UPDATE … SET source = 'legacy migration'
 *             WHERE store_id IS NULL AND selling_point_id IS NULL
 *               AND storefront_id IS NULL AND order_source_id IS NULL
 *   customers UPDATE … SET source = 'legacy migration', origin_kind = 'legacy',
 *                          origin_order_source_id = NULL
 *             WHERE store_id IS NULL AND origin_order_source_id IS NULL
 *
 * So membership of the pool is: the `legacy migration` tag (which identifies
 * the row as a pool row) AND the unbound binding columns the script's WHERE
 * targeted (which is what makes a reassignment drain the row from the pool —
 * the reassign write sets those binding columns).
 *
 * Reassignment follows the same mapping the migration uses for attribution
 * (spec §7 "Data mapping"): brand level carries provenance — the order source
 * plus the "how". A pool row's "how" IS `legacy`, so reassigning keeps
 * `origin_kind = 'legacy'` on customers and binds the row to the chosen
 * brand's order source (`orders.order_source_id` /
 * `customers.origin_order_source_id`) — the binding that survives Task 16's
 * contract. Until then it also writes the transitional brand binding the
 * operational queries still scope by (`store_id` = the brand's legacy store,
 * same pattern as POS/AddOrderDialog writes). Orders carry no origin_kind
 * column; their surviving provenance is the `source = 'legacy migration'`
 * tag itself, which reassignment deliberately leaves in place (see the Task 8
 * audit note: the tag dies with `orders.source` at Task 16).
 */

export const LEGACY_POOL_TAG = "legacy migration";
export const LEGACY_POOL_ORIGIN_KIND = "legacy";

export type PoolFilterOp =
  | { column: string; op: "eq"; value: string }
  | { column: string; op: "is"; value: null };

/**
 * Canonical pool predicates. Kept as data so the queries, the unit tests and
 * the RLS migration (supabase/migrations/*_legacy_pool_rls.sql) pin the same
 * shape.
 */
export const poolOrderFilters: readonly PoolFilterOp[] = Object.freeze([
  { column: "source", op: "eq", value: LEGACY_POOL_TAG },
  { column: "store_id", op: "is", value: null },
  { column: "selling_point_id", op: "is", value: null },
  { column: "storefront_id", op: "is", value: null },
  { column: "order_source_id", op: "is", value: null },
]);

export const poolCustomerFilters: readonly PoolFilterOp[] = Object.freeze([
  { column: "source", op: "eq", value: LEGACY_POOL_TAG },
  { column: "origin_kind", op: "eq", value: LEGACY_POOL_ORIGIN_KIND },
  { column: "store_id", op: "is", value: null },
  { column: "origin_order_source_id", op: "is", value: null },
]);

/** Shape of the builder methods a pool predicate uses (PostgREST or a test fake). */
export interface FilterChain {
  is(column: string, value: null): unknown;
  eq(column: string, value: string): unknown;
}

/**
 * Apply a pool predicate to any PostgREST query (select or update). The
 * builders mutate in place, so this returns nothing — call it in line before
 * awaiting. The update guards make reassignment atomic against concurrent
 * reassigns: a second writer matches zero rows and is told so.
 *
 * The query is taken as `unknown` on purpose: structural assignability checks
 * against supabase-js's recursive builder types exceed TypeScript's
 * instantiation depth (TS2589), so the cast is contained here instead.
 */
export function applyPoolFilter(
  query: unknown,
  filter: readonly PoolFilterOp[],
): void {
  const chain = query as FilterChain;
  for (const f of filter) {
    if (f.op === "is") chain.is(f.column, f.value);
    else chain.eq(f.column, f.value);
  }
}

export interface ReassignTarget {
  brand: { id: string; name: string; woo_store_id: string | null };
  source: { id: string; name: string };
}

export interface OrderReassignPayload {
  order_source_id: string;
  store_id?: string;
}

export interface CustomerReassignPayload {
  origin_order_source_id: string;
  origin_kind: string;
  store_id?: string;
}

/**
 * Reassign payload for an order: bind the chosen brand's order source (the
 * attribution the migration itself writes for inferred orders — step 9 only
 * sets `order_source_id`), plus the transitional store binding when the brand
 * still has a legacy store.
 */
export function orderReassignPayload(
  target: ReassignTarget,
): OrderReassignPayload {
  return {
    order_source_id: target.source.id,
    ...(target.brand.woo_store_id
      ? { store_id: target.brand.woo_store_id }
      : {}),
  };
}

/**
 * Reassign payload for a customer: same brand binding, and provenance stays
 * `legacy` exactly as the migration tags pool customers (origin_kind='legacy';
 * the row did not arrive through the source it is being filed under).
 */
export function customerReassignPayload(
  target: ReassignTarget,
): CustomerReassignPayload {
  return {
    origin_order_source_id: target.source.id,
    origin_kind: LEGACY_POOL_ORIGIN_KIND,
    ...(target.brand.woo_store_id
      ? { store_id: target.brand.woo_store_id }
      : {}),
  };
}

/**
 * PostgREST `or()` filters take a bare expression list — commas, parentheses
 * and quotes in user input would change its grammar, so strip them before the
 * search term is interpolated (same precedent as CommandPalette's search).
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw.replace(/[,()"']/g, "").trim().slice(0, 80);
}

export function likeTerm(raw: string): string | null {
  const term = sanitizeSearchTerm(raw);
  return term ? `%${term}%` : null;
}

export interface PoolCounts {
  orders: number;
  customers: number;
}

export interface PoolOrderRow {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total: number | null;
  status: string | null;
  payment_status: string | null;
  created_at: string | null;
  source: string | null;
  deleted_at: string | null;
}

export interface PoolCustomerRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  created_at: string | null;
  source: string | null;
}

export interface SourceLite {
  id: string;
  name: string;
  type: string;
}

export async function fetchPoolCounts(): Promise<PoolCounts> {
  const orderQuery = supabase
    .from("orders")
    .select("id", { count: "exact", head: true });
  applyPoolFilter(orderQuery, poolOrderFilters);
  const customerQuery = supabase
    .from("customers")
    .select("id", { count: "exact", head: true });
  applyPoolFilter(customerQuery, poolCustomerFilters);
  const [orderRes, customerRes] = await Promise.all([orderQuery, customerQuery]);
  if (orderRes.error) {
    throw new Error(`legacy pool order count: ${orderRes.error.message}`);
  }
  if (customerRes.error) {
    throw new Error(`legacy pool customer count: ${customerRes.error.message}`);
  }
  return {
    orders: orderRes.count ?? 0,
    customers: customerRes.count ?? 0,
  };
}

export interface PoolListOptions {
  search?: string;
  /** Soft-deleted orders stay in the pool inventory; default lists everything. */
  includeDeleted?: boolean;
  limit?: number;
}

export async function fetchPoolOrders(
  options: PoolListOptions = {},
): Promise<PoolOrderRow[]> {
  const query = supabase
    .from("orders")
    .select(
      "id, order_number, customer_name, customer_phone, total, status, payment_status, created_at, source, deleted_at",
    )
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 200);
  applyPoolFilter(query, poolOrderFilters);
  if (options.includeDeleted === false) query.is("deleted_at", null);
  const term = likeTerm(options.search ?? "");
  if (term) {
    query.or(
      `order_number.ilike.${term},customer_name.ilike.${term},customer_phone.ilike.${term}`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(`legacy pool orders: ${error.message}`);
  return (data as PoolOrderRow[]) ?? [];
}

export async function fetchPoolCustomers(
  options: PoolListOptions = {},
): Promise<PoolCustomerRow[]> {
  const query = supabase
    .from("customers")
    .select("id, name, phone, email, city, created_at, source")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 200);
  applyPoolFilter(query, poolCustomerFilters);
  const term = likeTerm(options.search ?? "");
  if (term) {
    query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`legacy pool customers: ${error.message}`);
  return (data as PoolCustomerRow[]) ?? [];
}

export class AlreadyReassignedError extends Error {
  constructor() {
    super("This row already left the pool (reassigned elsewhere).");
    this.name = "AlreadyReassignedError";
  }
}

/**
 * Move one pool order to a brand. The pool predicate rides along on the
 * UPDATE, so a concurrent reassign cannot double-move a row: zero matched rows
 * means it is already gone.
 */
export async function reassignOrderToBrand(
  orderId: string,
  target: ReassignTarget,
): Promise<void> {
  const query = supabase
    .from("orders")
    .update(orderReassignPayload(target))
    .eq("id", orderId);
  applyPoolFilter(query, poolOrderFilters);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`reassign order: ${error.message}`);
  if (!data || data.length === 0) throw new AlreadyReassignedError();
}

export async function reassignCustomerToBrand(
  customerId: string,
  target: ReassignTarget,
): Promise<void> {
  const query = supabase
    .from("customers")
    .update(customerReassignPayload(target))
    .eq("id", customerId);
  applyPoolFilter(query, poolCustomerFilters);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`reassign customer: ${error.message}`);
  if (!data || data.length === 0) throw new AlreadyReassignedError();
}

/**
 * Order sources per brand, for the reassign dialog's brand → source pickers
 * (a pool row is filed under a brand's source, per spec §7).
 */
export async function fetchOrderSourcesByBrand(
  brandIds: string[],
): Promise<Record<string, SourceLite[]>> {
  const byBrand: Record<string, SourceLite[]> = {};
  if (brandIds.length === 0) return byBrand;
  const { data, error } = await supabase
    .from("order_sources")
    .select("id, name, type, brand_id")
    .in("brand_id", brandIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`order sources: ${error.message}`);
  for (const row of (data as Array<SourceLite & { brand_id: string }>) ?? []) {
    (byBrand[row.brand_id] ??= []).push({
      id: row.id,
      name: row.name,
      type: row.type,
    });
  }
  return byBrand;
}
