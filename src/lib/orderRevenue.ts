/**
 * Which orders count toward money.
 *
 * Aggregations used to subtract only "cancelled", so a merge (issue #30) — which
 * inserts ONE new order and leaves the absorbed sources behind with status
 * "merged" — counted the same taka twice and the dashboard/report totals looked
 * inflated. Returns/refunds/failures are excluded for the same reason: the money
 * never became revenue.
 *
 * Keep this list in one place: the dashboard, Analytics and POS Reports all read
 * it, and a status added here must not be treated as revenue anywhere else.
 */
export const NON_REVENUE_STATUSES: ReadonlySet<string> = new Set([
  "cancelled",
  "failed",
  "refunded",
  "returned",
  "merged",
]);

/** True when an order may contribute to revenue / AOV / product mix / trend. */
export function isRevenueOrder(order: { status?: string | null }): boolean {
  return !NON_REVENUE_STATUSES.has((order.status || "").toLowerCase());
}

/** Filter helper for the common `rows.filter(isRevenueOrder)` call. */
export function revenueOrders<T extends { status?: string | null }>(rows: T[]): T[] {
  return rows.filter(isRevenueOrder);
}