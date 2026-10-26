/**
 * Order split — pure domain logic for issue #31
 * ("Order split with payment transfer + charge allocation"),
 * following docs/adr/0002-order-merge-split-payment-semantics.md.
 *
 * A split divides one order into two independent orders:
 *   - the ORIGINAL keeps its payment records (amounts are decreased when money
 *     is transferred to the new order);
 *   - the NEW order's payment is assigned during the split.
 *
 * The three payment cases are DISTINCT:
 *   1. "cod"         — the new order is cash-on-delivery; no money moves.
 *   2. "new-payment" — a genuinely NEW payment is collected for the new order.
 *   3. "transfer"    — an existing payment of the original is transferred to
 *                      the new order; the original decreases by the transferred
 *                      amount. Existing money is NEVER duplicated.
 *
 * Money invariant enforced by construction, for every plan:
 *   paid(original) + paid(new) === paid(source)          (cod, transfer)
 *   paid(original) + paid(new) === paid(source) + amount (new-payment)
 * and charges are allocated per resulting order such that
 *   original.X + newOrder.X === source.X  (shipping, discount, each charge).
 *
 * This module is deliberately self-contained: it neither imports nor creates
 * shared money helpers. All arithmetic runs in integer poisha (1/100 BDT)
 * and is converted back at the boundary.
 */

export type SplitErrorCode =
  | "invalid-source"
  | "no-items-moved"
  | "all-items-moved"
  | "unknown-item"
  | "duplicate-item"
  | "invalid-quantity"
  | "invalid-amount"
  | "unknown-payment"
  | "invalid-charge-share";

export class SplitPlanError extends Error {
  readonly code: SplitErrorCode;

  constructor(code: SplitErrorCode, message: string) {
    super(message);
    this.name = "SplitPlanError";
    this.code = code;
  }
}

/** One order line of the source order. */
export interface SplitItem {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  /** Discount already applied to this line, in currency. */
  lineDiscount?: number;
}

/** One recorded payment of the source order (an order_payments row). */
export interface SplitPaymentRecord {
  id: string;
  method: string;
  amount: number;
}

/** One non-delivery, non-discount charge of the source order. */
export interface SplitCharge {
  id: string;
  label: string;
  amount: number;
}

/** The order being split. */
export interface SplitSourceOrder {
  items: SplitItem[];
  payments: SplitPaymentRecord[];
  /** Delivery charge. */
  shipping: number;
  /** Order-level discount. */
  discount: number;
  otherCharges: SplitCharge[];
}

/**
 * How the new order is paid — the three DISTINCT cases.
 *   "cod":         no payment assigned; the new order is cash-on-delivery.
 *   "new-payment": a new payment record (method + amount) is collected.
 *   "transfer":    an existing payment of the original moves to the new order
 *                  (the original decreases by the transferred amount).
 */
export type SplitPaymentAssignment =
  | { kind: "cod" }
  | { kind: "new-payment"; method: string; amount: number }
  | { kind: "transfer"; sourcePaymentId: string; amount: number };

/** How much of one source line moves to the new order. */
export interface SplitItemMove {
  itemId: string;
  quantity: number;
}

/**
 * Optional per-result-order charge allocation. Each value is the amount
 * assigned to the NEW order; the original keeps the remainder. Values must
 * lie within [0, source amount]. Unset fields fall back to the default
 * allocation (proportional to each side's gross item value).
 */
export interface SplitChargeShares {
  shipping?: number;
  discount?: number;
  otherCharges?: Record<string, number>;
}

export interface SplitRequest {
  movedItems: SplitItemMove[];
  newOrderPayment: SplitPaymentAssignment;
  chargeShares?: SplitChargeShares;
}

/** One line of a resulting order. */
export interface SplitPlanLine {
  itemId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  /** This line's allocated share of the source line's discount. */
  lineDiscount: number;
  /** unitPrice * quantity - lineDiscount */
  lineNet: number;
}

/**
 * One payment record of a resulting order.
 *   "kept"        — a source payment record that stays on the original.
 *   "transferred" — money moved from a source payment record to the new order.
 *   "new"         — genuinely new money collected for the new order.
 */
export interface SplitPlanPayment {
  kind: "kept" | "transferred" | "new";
  method: string;
  amount: number;
  /** Set for "kept"/"transferred": the source payment record this derives from. */
  sourcePaymentId?: string;
}

/** One of the two resulting orders. */
export interface SplitPlanOrder {
  items: SplitPlanLine[];
  /** Sum of lineNet. */
  itemSubtotal: number;
  shipping: number;
  discount: number;
  otherCharges: SplitCharge[];
  /** itemSubtotal - discount + shipping + otherCharges */
  total: number;
  payments: SplitPlanPayment[];
  /** Sum of payments. */
  paid: number;
  /** total - paid (negative means overpaid). */
  due: number;
}

export type SplitPlanWarningCode = "assigned-exceeds-recorded" | "transfer-exceeds-payment";

/** Soft finding — warned, never hard-blocked ("staff may be correcting reality"). */
export interface SplitPlanWarning {
  code: SplitPlanWarningCode;
  message: string;
}

export interface SplitPlan {
  original: SplitPlanOrder;
  newOrder: SplitPlanOrder;
  warnings: SplitPlanWarning[];
}

// ---------------------------------------------------------------------------
// money helpers (local to this module on purpose — no shared money module)
// ---------------------------------------------------------------------------

const POISHA = 100;

function toMinor(value: number, code: SplitErrorCode, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SplitPlanError(code, `${label} must be a non-negative finite number`);
  }
  return Math.round(value * POISHA);
}

function fromMinor(minor: number): number {
  return minor / POISHA;
}

/**
 * Divide `sourceMinor` between the original and the new order.
 * The default share is proportional to the two sides' gross item value;
 * `forcedNewMinor` (a SplitChargeShares override) pins the new order's share.
 * The original always keeps the remainder, so the two shares always sum to
 * the source amount exactly — charges are split, never duplicated.
 */
function allocateMinor(
  sourceMinor: number,
  origBaseMinor: number,
  newBaseMinor: number,
  forcedNewMinor: number | undefined,
  label: string,
): { orig: number; neu: number } {
  if (forcedNewMinor !== undefined) {
    if (forcedNewMinor < 0 || forcedNewMinor > sourceMinor) {
      throw new SplitPlanError(
        "invalid-charge-share",
        `${label} share must be between 0 and ${fromMinor(sourceMinor)}`,
      );
    }
    return { orig: sourceMinor - forcedNewMinor, neu: forcedNewMinor };
  }
  const baseTotal = origBaseMinor + newBaseMinor;
  if (sourceMinor === 0 || baseTotal === 0 || newBaseMinor === 0) {
    return { orig: sourceMinor, neu: 0 };
  }
  const neu = Math.floor((sourceMinor * newBaseMinor) / baseTotal);
  return { orig: sourceMinor - neu, neu };
}

// ---------------------------------------------------------------------------
// plan computation
// ---------------------------------------------------------------------------

export function computeSplitPlan(source: SplitSourceOrder, request: SplitRequest): SplitPlan {
  // --- validate source items and build a lookup ---
  const itemById = new Map<string, SplitItem>();
  for (const item of source.items) {
    if (itemById.has(item.id)) {
      throw new SplitPlanError("invalid-source", `duplicate source item id "${item.id}"`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new SplitPlanError("invalid-source", `item "${item.id}" quantity must be a positive integer`);
    }
    toMinor(item.unitPrice, "invalid-source", `item "${item.id}" unitPrice`);
    if (item.lineDiscount !== undefined) {
      toMinor(item.lineDiscount, "invalid-source", `item "${item.id}" lineDiscount`);
    }
    itemById.set(item.id, item);
  }

  // --- movement: which items move, how much of each ---
  const movedQty = new Map<string, number>();
  for (const move of request.movedItems) {
    const item = itemById.get(move.itemId);
    if (!item) {
      throw new SplitPlanError("unknown-item", `no source item "${move.itemId}"`);
    }
    if (movedQty.has(move.itemId)) {
      throw new SplitPlanError("duplicate-item", `item "${move.itemId}" is listed twice in movedItems`);
    }
    if (!Number.isInteger(move.quantity) || move.quantity <= 0) {
      throw new SplitPlanError("invalid-quantity", `move quantity for "${move.itemId}" must be a positive integer`);
    }
    if (move.quantity > item.quantity) {
      throw new SplitPlanError(
        "invalid-quantity",
        `move quantity ${move.quantity} exceeds source quantity ${item.quantity} for "${move.itemId}"`,
      );
    }
    movedQty.set(move.itemId, move.quantity);
  }
  if (movedQty.size === 0) {
    throw new SplitPlanError("no-items-moved", "a split must move at least one item");
  }

  const originalItems: SplitPlanLine[] = [];
  const newItems: SplitPlanLine[] = [];
  let origItemMinor = 0;
  let newItemMinor = 0;
  let origGrossMinor = 0;
  let newGrossMinor = 0;

  for (const item of source.items) {
    const qtyMoved = movedQty.get(item.id) ?? 0;
    const qtyKept = item.quantity - qtyMoved;
    const unitMinor = toMinor(item.unitPrice, "invalid-source", `item "${item.id}" unitPrice`);
    const discMinor = item.lineDiscount === undefined ? 0 : toMinor(item.lineDiscount, "invalid-source", `item "${item.id}" lineDiscount`);

    if (qtyMoved === item.quantity) {
      // Whole line moves: its discount moves with it.
      const lineNet = unitMinor * qtyMoved - discMinor;
      newItems.push({ itemId: item.id, productName: item.productName, quantity: qtyMoved, unitPrice: item.unitPrice, lineDiscount: fromMinor(discMinor), lineNet: fromMinor(lineNet) });
      newItemMinor += lineNet;
      newGrossMinor += unitMinor * qtyMoved;
    } else if (qtyMoved === 0) {
      const lineNet = unitMinor * qtyKept - discMinor;
      originalItems.push({ itemId: item.id, productName: item.productName, quantity: qtyKept, unitPrice: item.unitPrice, lineDiscount: fromMinor(discMinor), lineNet: fromMinor(lineNet) });
      origItemMinor += lineNet;
      origGrossMinor += unitMinor * qtyKept;
    } else {
      // Partial move: split the line; the moved share of the line discount
      // follows the quantity, the remainder stays with the original.
      const movedDiscMinor = Math.floor((discMinor * qtyMoved) / item.quantity);
      const keptDiscMinor = discMinor - movedDiscMinor;
      const movedNet = unitMinor * qtyMoved - movedDiscMinor;
      const keptNet = unitMinor * qtyKept - keptDiscMinor;
      newItems.push({ itemId: item.id, productName: item.productName, quantity: qtyMoved, unitPrice: item.unitPrice, lineDiscount: fromMinor(movedDiscMinor), lineNet: fromMinor(movedNet) });
      originalItems.push({ itemId: item.id, productName: item.productName, quantity: qtyKept, unitPrice: item.unitPrice, lineDiscount: fromMinor(keptDiscMinor), lineNet: fromMinor(keptNet) });
      newItemMinor += movedNet;
      origItemMinor += keptNet;
      newGrossMinor += unitMinor * qtyMoved;
      origGrossMinor += unitMinor * qtyKept;
    }
  }

  if (originalItems.length === 0) {
    throw new SplitPlanError("all-items-moved", "a split must leave at least one item on the original");
  }

  // --- charge allocation: per resulting order, conserving the source amounts ---
  const shares = request.chargeShares ?? {};
  const forcedShippingMinor =
    shares.shipping === undefined
      ? undefined
      : toMinor(shares.shipping, "invalid-charge-share", "shipping share");
  const forcedDiscountMinor =
    shares.discount === undefined
      ? undefined
      : toMinor(shares.discount, "invalid-charge-share", "discount share");
  const forcedOtherMinor = new Map<string, number>();
  for (const [id, amount] of Object.entries(shares.otherCharges ?? {})) {
    forcedOtherMinor.set(id, toMinor(amount, "invalid-charge-share", `charge "${id}" share`));
  }

  const shippingAlloc = allocateMinor(
    toMinor(source.shipping, "invalid-source", "shipping"),
    origGrossMinor,
    newGrossMinor,
    forcedShippingMinor,
    "shipping",
  );
  const discountAlloc = allocateMinor(
    toMinor(source.discount, "invalid-source", "discount"),
    origGrossMinor,
    newGrossMinor,
    forcedDiscountMinor,
    "discount",
  );

  const seenChargeIds = new Set<string>();
  const originalCharges: SplitCharge[] = [];
  const newCharges: SplitCharge[] = [];
  let origOtherMinor = 0;
  let newOtherMinor = 0;
  for (const charge of source.otherCharges) {
    if (seenChargeIds.has(charge.id)) {
      throw new SplitPlanError("invalid-source", `duplicate source charge id "${charge.id}"`);
    }
    seenChargeIds.add(charge.id);
    const chargeMinor = toMinor(charge.amount, "invalid-source", `charge "${charge.id}" amount`);
    const alloc = allocateMinor(
      chargeMinor,
      origGrossMinor,
      newGrossMinor,
      forcedOtherMinor.get(charge.id),
      `charge "${charge.id}"`,
    );
    originalCharges.push({ id: charge.id, label: charge.label, amount: fromMinor(alloc.orig) });
    newCharges.push({ id: charge.id, label: charge.label, amount: fromMinor(alloc.neu) });
    origOtherMinor += alloc.orig;
    newOtherMinor += alloc.neu;
  }
  for (const id of forcedOtherMinor.keys()) {
    if (!seenChargeIds.has(id)) {
      throw new SplitPlanError("invalid-charge-share", `no source charge "${id}" to allocate`);
    }
  }

  const origTotalMinor = origItemMinor - discountAlloc.orig + shippingAlloc.orig + origOtherMinor;
  const newTotalMinor = newItemMinor - discountAlloc.neu + shippingAlloc.neu + newOtherMinor;

  // --- payment assignment: the three DISTINCT cases ---
  // Case "cod": the new order is cash-on-delivery — NO money moves and every
  // payment record stays on the original untouched.
  const seenPaymentIds = new Set<string>();
  for (const p of source.payments) {
    if (seenPaymentIds.has(p.id)) {
      throw new SplitPlanError("invalid-source", `duplicate source payment id "${p.id}"`);
    }
    seenPaymentIds.add(p.id);
  }
  const originalPayments: SplitPlanPayment[] = source.payments.map((p) => ({
    kind: "kept",
    method: p.method,
    amount: p.amount,
    sourcePaymentId: p.id,
  }));
  const newPayments: SplitPlanPayment[] = [];
  const warnings: SplitPlanWarning[] = [];
  const assignment = request.newOrderPayment;
  let assignedMinor = 0;
  if (assignment.kind === "cod") {
    // Nothing assigned — see above.
  } else if (assignment.kind === "new-payment") {
    // Case "new-payment": a genuinely NEW payment is collected for the new
    // order. The original's recorded money is untouched.
    const amountMinor = toMinor(assignment.amount, "invalid-amount", "new payment amount");
    if (amountMinor <= 0) {
      throw new SplitPlanError("invalid-amount", "new payment amount must be greater than zero");
    }
    assignedMinor = amountMinor;
    newPayments.push({ kind: "new", method: assignment.method, amount: fromMinor(amountMinor) });
  } else {
    // Case "transfer": an existing payment of the original moves to the new
    // order. The original decreases by the transferred amount — existing money
    // is MOVED, never duplicated.
    const amountMinor = toMinor(assignment.amount, "invalid-amount", "transfer amount");
    if (amountMinor <= 0) {
      throw new SplitPlanError("invalid-amount", "transfer amount must be greater than zero");
    }
    assignedMinor = amountMinor;
    const sourceIdx = source.payments.findIndex((p) => p.id === assignment.sourcePaymentId);
    if (sourceIdx < 0) {
      throw new SplitPlanError("unknown-payment", `no source payment "${assignment.sourcePaymentId}"`);
    }
    const sourcePayment = source.payments[sourceIdx];
    const sourceMinor = toMinor(sourcePayment.amount, "invalid-source", `payment "${sourcePayment.id}" amount`);
    // Money can never be duplicated: the transferred amount is capped at what
    // the record actually holds. Over-assignment warns, never hard-blocks.
    const transferredMinor = Math.min(amountMinor, sourceMinor);
    if (transferredMinor < amountMinor) {
      warnings.push({
        code: "transfer-exceeds-payment",
        message:
          `transfer of ${fromMinor(amountMinor)} exceeds recorded payment "${sourcePayment.id}" ` +
          `(${fromMinor(sourceMinor)}); ${fromMinor(transferredMinor)} transferred to keep money un-duplicated`,
      });
    }
    // The original keeps its records; the transferred one decreases.
    originalPayments[sourceIdx] = {
      kind: "kept",
      method: sourcePayment.method,
      amount: fromMinor(sourceMinor - transferredMinor),
      sourcePaymentId: sourcePayment.id,
    };
    if (transferredMinor > 0) {
      newPayments.push({
        kind: "transferred",
        method: sourcePayment.method,
        amount: fromMinor(transferredMinor),
        sourcePaymentId: sourcePayment.id,
      });
    }
  }

  // Soft finding on any over-assignment: warn, never hard-block — "staff may
  // be correcting reality" (issue #31).
  const recordedMinor = source.payments.reduce(
    (sum, p) => sum + toMinor(p.amount, "invalid-source", `payment "${p.id}" amount`),
    0,
  );
  if (assignedMinor > recordedMinor) {
    warnings.push({
      code: "assigned-exceeds-recorded",
      message:
        `assigned amount ${fromMinor(assignedMinor)} exceeds the original order's ` +
        `recorded payments (${fromMinor(recordedMinor)})`,
    });
  }

  const origPaidMinor = originalPayments.reduce((sum, p) => sum + toMinor(p.amount, "invalid-source", "payment amount"), 0);
  const newPaidMinor = newPayments.reduce((sum, p) => sum + toMinor(p.amount, "invalid-source", "payment amount"), 0);

  const original: SplitPlanOrder = {
    items: originalItems,
    itemSubtotal: fromMinor(origItemMinor),
    shipping: fromMinor(shippingAlloc.orig),
    discount: fromMinor(discountAlloc.orig),
    otherCharges: originalCharges,
    total: fromMinor(origTotalMinor),
    payments: originalPayments,
    paid: fromMinor(origPaidMinor),
    due: fromMinor(origTotalMinor - origPaidMinor),
  };
  const newOrder: SplitPlanOrder = {
    items: newItems,
    itemSubtotal: fromMinor(newItemMinor),
    shipping: fromMinor(shippingAlloc.neu),
    discount: fromMinor(discountAlloc.neu),
    otherCharges: newCharges,
    total: fromMinor(newTotalMinor),
    payments: newPayments,
    paid: fromMinor(newPaidMinor),
    due: fromMinor(newTotalMinor - newPaidMinor),
  };

  return { original, newOrder, warnings };
}
