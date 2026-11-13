import { describe, expect, it } from "vitest";
import { assertOutboundWritePersisted, validateOutboundConfirmation } from "../lib/woocommerceWorkerValidation";

describe("WooCommerce outbound HTTP confirmation", () => {
  it.each(["processing", "completed", "cancelled"])(
    "accepts a WooCommerce response confirming %s",
    (targetStatus) => {
      expect(() => validateOutboundConfirmation({ status: targetStatus }, targetStatus)).not.toThrow();
    },
  );

  it("rejects a response that does not echo the requested status", () => {
    expect(() => validateOutboundConfirmation({ status: "processing" }, "completed"))
      .toThrow("woocommerce_outbound_confirmation_mismatch");
  });

  it("rejects outbound success when confirmation persistence fails", () => {
    expect(() => assertOutboundWritePersisted({ error: { message: "database unavailable" }, count: 0 }))
      .toThrow("woocommerce_outbound_persistence_failed: database unavailable");
  });

  it("rejects outbound success when no confirmation row is updated", () => {
    expect(() => assertOutboundWritePersisted({ error: null, count: 0 }))
      .toThrow("woocommerce_outbound_persistence_failed: no_row_updated");
  });
});
