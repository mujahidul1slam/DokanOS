/**
 * Wiring helpers for the WooCommerce online-payment gate (issue #27).
 *
 * paymentGate.ts owns the pure gate decision; this module owns the shared
 * skip-and-notify wiring used by the ROW quick actions (OrderRowActions) and
 * the BULK action surface (useOrderBulkActions): given an action's gate
 * channel and one or more orders, decide which orders the gate locks, skip
 * them, and phrase the brief "locked" toast naming them
 * ("Order X is locked — Payment Needs Confirmation").
 *
 * Like paymentGate.ts this module is intentionally pure (no I/O, no React) so
 * the skip rules are unit-testable at one seam (src/test/paymentGateWiring.test.ts).
 */

import {
  evaluatePaymentGate,
  PAYMENT_NEEDS_CONFIRMATION_LABEL,
  type PaymentGateInput,
} from "@/lib/paymentGate";

/** Gate channel an action needs: courier entry (consignment booking) or a manual status change. */
export type PaymentGateChannel = "courier" | "status";

/** Minimal order shape the wiring needs (order rows carry these fields). */
export interface GateWiringOrder extends PaymentGateInput {
  order_number: string;
}

/**
 * Quick-action keys (built by getQuickActions in src/pages/Orders.tsx) mapped
 * to the gate channel they need. Keys outside this map are never gated:
 * edit/print/track/trash/restore touch neither courier entry nor status.
 */
const QUICK_ACTION_CHANNELS: Record<string, PaymentGateChannel> = {
  dispatch: "courier",
  attach_parcel: "courier",
  replace_parcel: "courier",
  ready: "status",
};

/** Gate channel a quick action needs, or null when the gate never applies to it. */
export function quickActionGateChannel(key: string): PaymentGateChannel | null {
  return QUICK_ACTION_CHANNELS[key] ?? null;
}

/** Whether the gate locks this order for the given channel. */
export function isOrderLockedFor(order: GateWiringOrder, channel: PaymentGateChannel): boolean {
  const decision = evaluatePaymentGate(order);
  return channel === "courier" ? !decision.canEnterCourier : !decision.canChangeStatus;
}

/** Whether the quick action (by key) is locked for this order. */
export function isQuickActionLocked(key: string, order: GateWiringOrder): boolean {
  const channel = quickActionGateChannel(key);
  return channel !== null && isOrderLockedFor(order, channel);
}

export interface GateSplit<T extends GateWiringOrder> {
  /** Orders the operation may run against. */
  allowed: T[];
  /** Gated orders to skip (courier entry / status change blocked). */
  skipped: T[];
}

/** Split orders into runnable vs. gate-skipped for one gate channel. */
export function splitGatedOrders<T extends GateWiringOrder>(
  orders: T[],
  channel: PaymentGateChannel,
): GateSplit<T> {
  const allowed: T[] = [];
  const skipped: T[] = [];
  for (const order of orders) {
    (isOrderLockedFor(order, channel) ? skipped : allowed).push(order);
  }
  return { allowed, skipped };
}

/** At most this many order numbers are named in a skip toast; the rest are counted. */
const MAX_NAMED_ORDERS = 3;

/**
 * Brief toast text naming the skipped order(s), e.g.
 * "Order 1042 is locked — Payment Needs Confirmation".
 */
export function gateLockedMessage(orders: Pick<GateWiringOrder, "order_number">[]): string {
  const names = orders.map((o) => o.order_number).filter(Boolean);
  if (names.length === 0) return `Locked — ${PAYMENT_NEEDS_CONFIRMATION_LABEL}`;
  const shown = names.slice(0, MAX_NAMED_ORDERS).join(", ");
  const extra = names.length - Math.min(names.length, MAX_NAMED_ORDERS);
  const list = extra > 0 ? `${shown} +${extra} more` : shown;
  const subject = names.length === 1 ? "Order" : "Orders";
  const verb = names.length === 1 ? "is" : "are";
  return `${subject} ${list} ${verb} locked — ${PAYMENT_NEEDS_CONFIRMATION_LABEL}`;
}
