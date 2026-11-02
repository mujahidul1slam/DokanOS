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

/**
 * Normalize a raw Pathao tracking_status exactly like the backend adapter
 * does (normalizeStatus in supabase/functions/adapters/pathao.ts):
 * lowercase, underscores/hyphens -> single spaces. All tab matching runs on
 * the normalized form, so casing/spacing variants ("Pickup On Hold" vs
 * "pickup_on_hold" vs "PICKUP-ON-HOLD") can never fall through the cracks.
 */
export function normalizeTrackingStatus(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Raw Pathao tracking_status values (normalized form) per tab bucket.
 * MUST stay a superset of RAW_STATUS_MAP in supabase/functions/adapters/pathao.ts
 * — that map has ~48 raw statuses and any raw status missing here makes the
 * order invisible in every specific tab (it only shows in "all"), because the
 * pickup/transit/hold tabs match ONLY on tracking_status (their legacy
 * orders.status buckets "shipped"/"processing" would otherwise catch them).
 */

/** Pathao tracking_status values that mean the parcel was cancelled. */
const CANCELLED_TRACKING = [
  "pickup cancel",
  "pickup cancelled",
  "pickup failed",
  "cancelled",
  "canceled",
];

const PICKUP_PENDING_TRACKING = [
  "pending",
  "pickup pending",
  "waiting for pickup",
  "pickup requested",
  "assigned for pickup",
  "picked",
  "picked up",
  // Pickup never completed because it was put on hold — still a pickup-phase
  // parcel, so it belongs in the Pickup tab (not lost between tabs).
  "pickup on hold",
];

const IN_TRANSIT_TRACKING = [
  "at sorting hub",
  "received at sorting hub",
  "sent to sub sorting hub",
  "received at sub sorting hub",
  "sent to last mile hub",
  "in transit",
  "on the way to delivery hub",
  "at delivery hub",
  "assigned for delivery",
  "sent for delivery",
  "out for delivery",
  "delivery confirmed",
];

const DELIVERED_TRACKING = [
  "delivered",
  "partial delivery",
  "partial delivered",
  "payment invoice",
];

const ON_HOLD_TRACKING = [
  "on hold",
  "on hold by customer request",
  "hold",
  "exchange",
];

const RETURNED_TRACKING = [
  "return",
  "returned",
  "paid return",
  "return requested",
  "return in transit",
  "returned to merchant",
  "merchant return",
  "return delivered",
  "delivery failed",
  "customer refused",
  "drt requested",
  "drt pick requested",
  "drt pick failed",
  "drt cancelled",
  "lost",
  "damaged",
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
    (!!o.consignment_id && CANCELLED_TRACKING.includes(normalizeTrackingStatus(o.tracking_status || "")))
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

  const tracking = normalizeTrackingStatus(o.tracking_status || "");

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
      return !!o.consignment_id && PICKUP_PENDING_TRACKING.includes(tracking);
    case "in_transit":
      return !!o.consignment_id && IN_TRANSIT_TRACKING.includes(tracking);
    case "delivered":
      // Delivered: any order whose internal status is delivered,
      // OR a dispatched parcel whose Pathao tracking reports a delivered state.
      return (
        o.status === "delivered" ||
        (!!o.consignment_id && DELIVERED_TRACKING.includes(tracking))
      );
    case "on_hold":
      return !!o.consignment_id && ON_HOLD_TRACKING.includes(tracking);
    case "returned":
      return (
        o.status === "returned" ||
        (!!o.consignment_id && RETURNED_TRACKING.includes(tracking))
      );
    case "cancelled":
      return cancelled;
    default:
      return true;
  }
}
