import { describe, it, expect } from "vitest";
import { evaluatePaymentGate } from "@/lib/paymentGate";

// Issue #27 (Patch B) + docs/adr/0001-woo-online-payment-gate.md.
// Seam under test: the pure decision surface of @/lib/paymentGate —
// given source/payment_method/payment_status, decide whether the order is
// gated, whether it may be entered with a courier or change status, and
// what display label applies. Expected labels come from GLOSSARY.md.

describe("paymentGate - WooCommerce online payment gate", () => {
  it("gates a WooCommerce order whose online payment is not confirmed", () => {
    const decision = evaluatePaymentGate({
      source: "online",
      payment_method: "bkash",
      payment_status: "online",
    });

    expect(decision.gated).toBe(true);
    expect(decision.canEnterCourier).toBe(false);
    expect(decision.canChangeStatus).toBe(false);
    expect(decision.displayLabel).toBe("Payment Needs Confirmation");
  });

  it("never gates manual or POS orders", () => {
    for (const source of ["pos", "phone", "fb", "whatsapp", "manual"]) {
      const decision = evaluatePaymentGate({
        source,
        payment_method: "bkash",
        payment_status: "online",
      });
      expect(decision.gated, `source "${source}" must never be gated`).toBe(false);
      expect(decision.canEnterCourier).toBe(true);
      expect(decision.canChangeStatus).toBe(true);
    }
  });

  it("never gates COD orders", () => {
    const cases = [
      { source: "online", payment_method: "cod", payment_status: "online" },
      { source: "online", payment_method: "Cash on Delivery", payment_status: "online" },
      { source: "online", payment_method: "COD", payment_status: "online" },
      { source: "online", payment_method: "bKash", payment_status: "cod" },
      { source: "woo", payment_method: "cod", payment_status: "online" },
    ];
    for (const input of cases) {
      const decision = evaluatePaymentGate(input);
      expect(decision.gated, `${JSON.stringify(input)} must never be gated`).toBe(false);
      expect(decision.canEnterCourier).toBe(true);
      expect(decision.canChangeStatus).toBe(true);
    }
  });

  it("releases the gate once any payment is recorded (partial or paid)", () => {
    for (const payment_status of ["partial", "paid"]) {
      const decision = evaluatePaymentGate({
        source: "online",
        payment_method: "bkash",
        payment_status,
      });
      expect(decision.gated, `payment_status "${payment_status}" must release the gate`).toBe(false);
      expect(decision.canEnterCourier).toBe(true);
      expect(decision.canChangeStatus).toBe(true);
    }
  });

  it("labels the gated state with the canonical GLOSSARY term", () => {
    const decision = evaluatePaymentGate({
      source: "woocommerce",
      payment_method: "card",
      payment_status: "online",
    });
    // GLOSSARY.md: "Payment Needs Confirmation"; _Avoid_: "Payment Pending".
    expect(decision.displayLabel).toBe("Payment Needs Confirmation");
  });

  it("renders pending_payment the same as unpaid (badge/dropdown consistency cleanup)", () => {
    // Issue #27: PaymentBadge rendered "pending_payment" while the edit
    // dropdown's value for the same state is "unpaid" — one concept, one label.
    const stale = evaluatePaymentGate({ payment_status: "pending_payment" });
    const unpaid = evaluatePaymentGate({ payment_status: "unpaid" });
    expect(stale.displayLabel).toBe("Unpaid");
    expect(stale.displayLabel).toBe(unpaid.displayLabel);
  });

  it("keeps the existing labels for the other payment states", () => {
    expect(evaluatePaymentGate({ payment_status: "paid" }).displayLabel).toBe("Paid");
    expect(evaluatePaymentGate({ payment_status: "cod" }).displayLabel).toBe("COD");
    expect(evaluatePaymentGate({ payment_status: "partial" }).displayLabel).toBe("Partial");
    expect(evaluatePaymentGate({ payment_status: "refunded" }).displayLabel).toBe("Refunded");
    // "online" on a non-Woo order is not the gated state.
    expect(evaluatePaymentGate({ source: "pos", payment_status: "online" }).displayLabel).toBe("Online");
  });

  it("never displays the avoided term 'Payment Pending' for any input", () => {
    const statuses = ["paid", "cod", "online", "partial", "refunded", "unpaid", "pending_payment", "failed", ""];
    for (const payment_status of statuses) {
      for (const source of ["online", "woo", "pos", "phone"]) {
        const { displayLabel } = evaluatePaymentGate({ source, payment_status });
        expect(displayLabel).not.toMatch(/Payment Pending|Pending Payment/);
      }
    }
  });

  it("treats every WooCommerce source spelling alike and tolerates missing fields", () => {
    for (const source of ["woo", "woocommerce", "WooCommerce", " ONLINE "]) {
      expect(evaluatePaymentGate({ source, payment_status: "online" }).gated, `source "${source}"`).toBe(true);
    }
    expect(() => evaluatePaymentGate({})).not.toThrow();
    expect(evaluatePaymentGate({ source: null, payment_method: null, payment_status: null }).gated).toBe(false);
  });
});
