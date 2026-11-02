/**
 * Orders tab filtering — pure predicates extracted from Orders.tsx.
 *
 * Keep this file dependency-free (no React, no Supabase) so the rules are
 * trivial to reason about and unit-test. Behavior must exactly match the
 * original Orders.tsx `getTabOrders` switch, since both the visible list and
 * the per-tab counts rely on it.
 */

export type TabKey =
  | "all"
  | "new"
  | "ready"
  | "pre_order"
  | "pre_order_pending"
  | "pre_order_making"
  | "pre_order_ready"
  | "pickup_pending"
  | "in_transit"
  | "delivered"
  | "on_hold"
  | "returned"
  | "cancelled"
  | "trash";

export const ALL_TAB_KEYS: TabKey[] = [
  "all",
  "new",
  "ready",
  "pre_order",
  "pre_order_pending",
  "pre_order_making",
  "pre_order_ready",
  "pickup_pending",
  "in_transit",
  "delivered",
  "on_hold",
  "returned",
  "cancelled",
  "trash",
];

/* ─── Banner visibility scoping (issue #7) ───
 *
 * Product reasoning: both warnings (possible-duplicate orders, same-customer
 * merge groups) are only ACTIONABLE while the order is still pre-dispatch —
 * nothing has been handed to the courier yet, so a duplicate can still be
 * caught/cancelled and same-customer orders can still be merged (merge is
 * pre-entry only, ADR-0002). On the post-dispatch tabs (transit, delivered,
 * on-hold, returned) and the archive tabs (all, cancelled, trash) the
 * warnings are noise: the moment to act has passed. The user's decision
 * (issue #7) is therefore:
 *   - duplicate warning → New, Pre-Order, Ready, Pickup, Transit
 *     (Transit is kept: a duplicate can still be recalled in transit),
 *   - merge panel → New, Pre-Order, Ready, Pickup only. Transit is
 *     excluded because every order there has a consignment already, so
 *     every group would render "Merge blocked" — pure noise.
 *
 * These sets gate VISIBILITY only — the detection logic and per-tab counts
 * are unchanged. The pre_order_pending / pre_order_making / pre_order_ready
 * keys are chip filters inside the Pre-Order tab (the tab key stays
 * "pre_order"), so the keys below cover every screen the user listed. */

/** Tabs where the possible-duplicate-orders warning is shown (issue #7). */
export const DUPLICATE_WARNING_TABS: readonly TabKey[] = [
  "new",
  "pre_order",
  "ready",
  "pickup_pending",
  "in_transit",
];

/** Tabs where the same-customer merge-groups panel is shown (issue #7). */
export const MERGE_PANEL_TABS: readonly TabKey[] = [
  "new",
  "pre_order",
  "ready",
  "pickup_pending",
];

/** True when the duplicate-orders warning belongs on `tab` (issue #7). */
export function showDuplicateWarningOn(tab: TabKey): boolean {
  return DUPLICATE_WARNING_TABS.includes(tab);
}

/** True when the merge-groups panel belongs on `tab` (issue #7). */
export function showMergePanelOn(tab: TabKey): boolean {
  return MERGE_PANEL_TABS.includes(tab);
}

/** Pathao tracking_status values that mean the parcel was cancelled at pickup. */
const CANCELLED_TRACKING = ["Pickup Cancel", "Pickup Cancelled", "Pickup Failed"];

const PICKUP_PENDING_TRACKING = [
  "Pending",
  "Pickup Pending",
  "Waiting for Pickup",
  "Pickup Requested",
  "Assigned for Pickup",
  "Assigned For Pickup",
  "Picked",
  "Picked Up",
];

const IN_TRANSIT_TRACKING = [
  "At Sorting Hub",
  "In Transit",
  "On the Way To Delivery Hub",
  "At Delivery Hub",
  "Out for Delivery",
  "Assigned for Delivery",
  "Assigned For Delivery",
];

const DELIVERED_TRACKING = ["Delivered", "Partial Delivered", "Payment Invoice"];

const ON_HOLD_TRACKING = ["On Hold", "Hold", "Exchange"];

const RETURNED_TRACKING = [
  "Return",
  "Returned",
  "Paid Return",
  "Return Requested",
  "Return In Transit",
  "Returned to Merchant",
  "Merchant Return",
  "Return Delivered",
  "Delivery Failed",
  "Customer Refused",
];

/** Minimal shape needed by the tab predicate — keeps this module decoupled
 *  from the full OrderRow type used inside the page. */
export interface TabOrder {
  id: string;
  status: string;
  consignment_id?: string | null;
  tracking_status?: string | null;
  deleted_at?: string | null;
}

export function isOrderCancelled(o: TabOrder): boolean {
  return (
    o.status === "cancelled" ||
    (!!o.consignment_id && CANCELLED_TRACKING.includes(o.tracking_status || ""))
  );
}

/**
 * Returns true iff `order` belongs in the given tab.
 * `preOrderOrderIds` is the set of order IDs that have at least one pre-order
 * item (resolved by category); the page computes this once and passes it in.
 */
export function matchesTab(
  o: TabOrder,
  tabKey: TabKey,
  preOrderOrderIds: Set<string>
): boolean {
  if (tabKey === "trash") return !!o.deleted_at;
  if (o.deleted_at) return false;

  // Merged source orders (issue #30): absorbed into a merged order and marked
  // status "merged" WITHOUT deleted_at (trash auto-purges after 15 days).
  // They are historical records — shown ONLY under the "all" tab (where the
  // row is badged by its raw "merged" status), never in an active tab — so
  // this check must run before the cancelled/pre-order rules below.
  if (o.status === "merged") return tabKey === "all";

  // Cancelled orders are surfaced ONLY in the cancelled tab (and "all").
  const cancelled = isOrderCancelled(o);
  if (tabKey !== "cancelled" && tabKey !== "all" && cancelled) return false;

  switch (tabKey) {
    case "all":
      return true;
    case "new":
      // New = fresh orders not yet dispatched and not pre-order. Covers
      // "processing" and "payment_pending" — and "pending" (issue #9
      // follow-up): a fresh unpaid Woo order lands in "pending" (mapWooStatus
      // maps it 1:1 and falls back to "pending" for unknown statuses), and it
      // is New-tab work until paid or cancelled. Without it such orders
      // matched NO active tab ("all" only) — the reported "new orders don't
      // load" symptom — and the dashboard's /orders?status=pending link had
      // nothing to land on.
      return (
        ["pending", "processing", "payment_pending"].includes(o.status) &&
        !o.consignment_id &&
        !preOrderOrderIds.has(o.id)
      );
    case "ready":
      // Once moved to ready_to_ship, show here regardless of pre-order origin.
      return o.status === "ready_to_ship" && !o.consignment_id;
    case "pre_order":
      // Pre-order tab catches pre_order_* statuses, plus payment_pending orders that
      // contain pre-order items. Exclude orders already advanced past pre-order stage
      // (ready_to_ship, shipped, delivered, etc.) so they show in their proper tab.
      return (
        ["pre_order_pending", "pre_order_making", "pre_order_ready"].includes(o.status) ||
        (preOrderOrderIds.has(o.id) &&
          !o.consignment_id &&
          !["cancelled", "returned", "ready_to_ship", "shipped", "delivered"].includes(o.status))
      );
    case "pre_order_pending":
      return o.status === "pre_order_pending";
    case "pre_order_making":
      return o.status === "pre_order_making";
    case "pre_order_ready":
      return o.status === "pre_order_ready";
    case "pickup_pending":
      return !!o.consignment_id && PICKUP_PENDING_TRACKING.includes(o.tracking_status || "");
    case "in_transit":
      return !!o.consignment_id && IN_TRANSIT_TRACKING.includes(o.tracking_status || "");
    case "delivered":
      // Delivered: any order whose internal status is delivered,
      // OR a dispatched parcel whose Pathao tracking reports a delivered state.
      return (
        o.status === "delivered" ||
        (!!o.consignment_id && DELIVERED_TRACKING.includes(o.tracking_status || ""))
      );
    case "on_hold":
      return !!o.consignment_id && ON_HOLD_TRACKING.includes(o.tracking_status || "");
    case "returned":
      return (
        o.status === "returned" ||
        (!!o.consignment_id && RETURNED_TRACKING.includes(o.tracking_status || ""))
      );
    case "cancelled":
      return cancelled;
    default:
      return true;
  }
}
