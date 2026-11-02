import { useSyncExternalStore } from "react";

/**
 * An order whose measurement slip was printed and is now awaiting a manual
 * decision to move it into "making". Printing a slip no longer flips the
 * status automatically — it queues the order here and a persistent prompt asks
 * the user to confirm the change. Newly printed slips are appended while the
 * prompt is open, so it accumulates orders until it is explicitly dismissed.
 */
export interface MakingCandidate {
  orderId: string;
  orderNumber: string | null;
  /** Human label for where the order is coming from, e.g. "Pre-Order" / "New Order". */
  fromLabel: string;
  /** Raw status at the time the slip was printed (used for the timeline note). */
  fromStatus: string;
}

interface MakingPromotionState {
  /** Whether the prompt is on screen. Stays true until explicitly dismissed. */
  open: boolean;
  pending: MakingCandidate[];
}

let state: MakingPromotionState = { open: false, pending: [] };
const listeners = new Set<() => void>();

function setState(next: MakingPromotionState) {
  state = next;
  listeners.forEach((l) => l());
}

function getSnapshot(): MakingPromotionState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Queue an order for the prompt. Re-opens/keeps the prompt visible. */
export function addMakingCandidate(candidate: MakingCandidate) {
  const exists = state.pending.some((p) => p.orderId === candidate.orderId);
  const pending = exists ? state.pending : [...state.pending, candidate];
  setState({ open: true, pending });
}

/** Drop resolved orders from the queue. Does not close the prompt. */
export function removeMakingCandidates(ids: string[]) {
  const pending = state.pending.filter((p) => !ids.includes(p.orderId));
  setState({ ...state, pending });
}

/** Close the prompt and clear any remaining orders. */
export function dismissMakingPromotion() {
  setState({ open: false, pending: [] });
}

/** Subscribe a component to the prompt state. */
export function useMakingPromotion(): MakingPromotionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
