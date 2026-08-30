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

  // Cancelled orders are surfaced ONLY in the cancelled tab (and "all").
  const cancelled = isOrderCancelled(o);
  if (tabKey !== "cancelled" && tabKey !== "all" && cancelled) return false;

  switch (tabKey) {
    case "all":
      return true;
    case "new":
      // New = processing or payment_pending orders not yet dispatched and not pre-order.
      return (
        ["processing", "payment_pending"].includes(o.status) &&
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
