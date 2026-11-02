/**
 * Pure decision module for the WooCommerce online-payment gate.
 *
 * Issue #27 (Patch B), decided by docs/adr/0001-woo-online-payment-gate.md:
 * - Only orders that arrived from WooCommerce with an unconfirmed online
 *   payment (payment_status "online", i.e. Woo on-hold non-COD) are gated.
 * - Manual, POS, and COD orders are NEVER gated.
 * - Recording any payment (partial or paid) releases the gate.
 * - The gate blocks courier entry (consignment booking) and ordinary manual
 *   status changes. Payment confirmation is the sanctioned exit: a manual,
 *   permission-controlled action audited in order_timeline + audit_log.
 * - Order creation is never blocked (this module never says otherwise).
 * - The rename is display-only: the stored value "payment_pending" is kept;
 *   GLOSSARY.md's canonical "Payment Needs Confirmation" replaces the avoided
 *   "Payment Pending" at the display layer only — no migration, woo-mapping
 *   untouched.
 *
 * This module is intentionally pure (no I/O, no React) so the gate scope is
 * unit-testable at a single seam: {@link evaluatePaymentGate}.
 */

/** GLOSSARY.md canonical label for the state; _Avoid_: "Payment Pending". */
export const PAYMENT_NEEDS_CONFIRMATION_LABEL = "Payment Needs Confirmation";

export interface PaymentGateInput {
  /** orders.source — "online"/"woo"/"woocommerce" are the WooCommerce origins. */
  source?: string | null;
  /** orders.payment_method — COD-flavoured methods are never gated. */
  payment_method?: string | null;
  /** orders.payment_status — "online" marks an unconfirmed Woo online payment. */
  payment_status?: string | null;
}

export interface PaymentGateDecision {
  /** True while a WooCommerce online payment is promised but not recorded. */
  gated: boolean;
  /** Whether the order may be entered with a courier (consignment booked). */
  canEnterCourier: boolean;
  /** Whether ordinary manual status changes are allowed (the confirm-payment flow is the sanctioned exit). */
  canChangeStatus: boolean;
  /** Display label for the order's payment state. */
  displayLabel: string;
}

const norm = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();

/** Source values that mark a WooCommerce order (see SourceBadge in OrderBadges.tsx). */
const WOO_SOURCES = ["woo", "woocommerce", "online"];

/** Payment statuses that mean a payment has been recorded (releases the gate). */
const RECORDED_PAYMENT_STATUSES = ["paid", "partial", "partially_paid"];

function isWooSource(source: string | null | undefined): boolean {
  return WOO_SOURCES.includes(norm(source));
}

/** COD is never gated (mirrors the isCod logic in supabase/functions/_shared/woo-mapping.ts). */
function isCodPayment(payment_method: string | null | undefined, payment_status: string | null | undefined): boolean {
  const method = norm(payment_method);
  return (
    norm(payment_status) === "cod" ||
    method.includes("cod") ||
    method.includes("cash on delivery")
  );
}

export function evaluatePaymentGate(input: PaymentGateInput): PaymentGateDecision {
  const paymentStatus = norm(input.payment_status);

  const awaitingOnlinePayment = paymentStatus === "online";
  const paymentRecorded = RECORDED_PAYMENT_STATUSES.includes(paymentStatus);

  const gated =
    isWooSource(input.source) &&
    awaitingOnlinePayment &&
    !isCodPayment(input.payment_method, input.payment_status) &&
    !paymentRecorded;

  return {
    gated,
    canEnterCourier: !gated,
    canChangeStatus: !gated,
    displayLabel: paymentDisplayLabel(paymentStatus, gated),
  };
}

/**
 * Display label for an order's payment state. Gated orders always read
 * "Payment Needs Confirmation"; everything else maps the stored value.
 * Issue #27 cleanup: "pending_payment" (old PaymentBadge wording) now renders
 * the same as "unpaid" (the edit dropdown's value) — one concept, one label.
 */
function paymentDisplayLabel(paymentStatus: string, gated: boolean): string {
  if (gated) return PAYMENT_NEEDS_CONFIRMATION_LABEL;
  switch (paymentStatus) {
    case "paid":
      return "Paid";
    case "cod":
      return "COD";
    case "online":
      return "Online";
    case "partial":
      return "Partial";
    case "refunded":
      return "Refunded";
    case "unpaid":
    case "pending_payment":
    default:
      return "Unpaid";
  }
}
