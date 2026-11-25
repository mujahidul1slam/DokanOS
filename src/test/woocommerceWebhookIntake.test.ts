import { describe, expect, it } from "vitest";
import {
  allowedWooWebhookTopic,
  bindingMatchesDelivery,
  deliveryFingerprintInput,
  extractWooExternalId,
  extractWooOrderId,
  isStrictWebhookId,
  isWooWebhookResourceValid,
  normalizeWooWebhookSource,
  resolveWooWebhookBinding,
  shouldEnqueueWooDelivery,
  shouldEnqueueWooWebhookWork,
  shouldPromoteWooWebhookStatus,
  webhookSecretNames,
  WOO_WEBHOOK_TOPICS,
} from "@/lib/woocommerceWebhookIntake";

const now = "2026-11-10T12:00:00.000Z";

describe("WooCommerce webhook intake contract", () => {
  it.each(["order.created", "order.updated", "order.deleted", "product.created", "product.updated"])("accepts %s", (topic) => {
    expect(allowedWooWebhookTopic(topic)).toBe(true);
  });

  it.each(["product.deleted", "order.created.foo", "product.created.foo", "", null, undefined])("rejects unsupported topic %s", (topic) => {
    expect(allowedWooWebhookTopic(topic)).toBe(false);
  });

  it("requires a complete numeric webhook id", () => {
    expect(isStrictWebhookId("42")).toBe(true);
    expect(isStrictWebhookId("0")).toBe(true);
    expect(isStrictWebhookId("42x")).toBe(false);
    expect(isStrictWebhookId("1.5")).toBe(false);
    expect(isStrictWebhookId("-1")).toBe(false);
    expect(isStrictWebhookId("9007199254740992")).toBe(false);
  });

  describe("bindingMatchesDelivery", () => {
    const binding = { webhook_id: 77, topic: "product.updated", status: "active" };
    it("accepts an active binding on the matching webhook id and topic", () => {
      expect(bindingMatchesDelivery(binding, { webhookId: 77, topic: "product.updated" })).toBe(true);
    });
    it("rejects a topic mismatch", () => {
      expect(bindingMatchesDelivery(binding, { webhookId: 77, topic: "product.created" })).toBe(false);
      expect(bindingMatchesDelivery(binding, { webhookId: 77, topic: "order.updated" })).toBe(false);
    });
    it("rejects a paused or disabled binding", () => {
      expect(bindingMatchesDelivery({ ...binding, status: "paused" }, { webhookId: 77, topic: "product.updated" })).toBe(false);
      expect(bindingMatchesDelivery({ ...binding, status: "disabled" }, { webhookId: 77, topic: "product.updated" })).toBe(false);
    });
    it("fails closed on a blank or missing delivery topic", () => {
      expect(bindingMatchesDelivery(binding, { webhookId: 77, topic: "" })).toBe(false);
      expect(bindingMatchesDelivery(binding, { webhookId: 77, topic: null })).toBe(false);
    });
    it("rejects a different webhook id", () => {
      expect(bindingMatchesDelivery(binding, { webhookId: 78, topic: "product.updated" })).toBe(false);
    });
  });

  it("binds the source, webhook id, and active intake state without payload tenancy", () => {
    const connector = {
      id: "connector-1",
      external_store_url: "https://shop.example/",
      expected_webhook_id: 42,
      expected_webhook_topic: "order.updated",
      intake_enabled: true,
      status: "healthy",
    };
    expect(resolveWooWebhookBinding(connector, {
      source: "HTTPS://SHOP.EXAMPLE",
      webhookId: "42",
      topic: "order.created",
      resource: "order",
    })).toMatchObject({ accepted: true, reason: "accepted" });
    expect(resolveWooWebhookBinding({ ...connector, status: "paused" }, {
      source: "https://shop.example",
      webhookId: "42",
      topic: "order.updated",
      resource: "order",
    })).toMatchObject({ accepted: false, reason: "inactive_connector" });
    expect(resolveWooWebhookBinding(connector, {
      source: "https://evil.example",
      webhookId: "42",
      topic: "order.updated",
      resource: "order",
    })).toMatchObject({ accepted: false, reason: "wrong_source" });
    expect(resolveWooWebhookBinding(connector, {
      source: "https://shop.example",
      webhookId: "42x",
      topic: "order.updated",
      resource: "order",
    })).toMatchObject({ accepted: false, reason: "invalid_webhook_id" });
    expect(resolveWooWebhookBinding(connector, {
      source: "https://shop.example",
      webhookId: "42",
      topic: "order.updated",
      resource: "product",
    })).toMatchObject({ accepted: false, reason: "wrong_resource" });
    // Product topics bind only to resource=product; order topics stay order-only.
    expect(resolveWooWebhookBinding(connector, {
      source: "https://shop.example",
      webhookId: "42",
      topic: "product.created",
      resource: "product",
    })).toMatchObject({ accepted: true, reason: "accepted" });
    expect(resolveWooWebhookBinding(connector, {
      source: "https://shop.example",
      webhookId: "42",
      topic: "product.created",
      resource: "order",
    })).toMatchObject({ accepted: false, reason: "wrong_resource" });
  });

  it("extracts only a safe external Order ID, including deleted ID-only bodies", () => {
    expect(extractWooOrderId({ id: 123 })).toBe(123);
    expect(extractWooOrderId({ id: "123", business_id: "forged", brand_id: "forged" })).toBe(123);
    expect(extractWooOrderId({ id: 123, line_items: [] })).toBe(123);
    expect(extractWooOrderId({ id: 1.5 })).toBeNull();
    expect(extractWooOrderId({ id: "not-an-id" })).toBeNull();
    expect(extractWooOrderId(null)).toBeNull();
  });

  it("extracts a product payload id with the same safe numeric guard", () => {
    expect(extractWooExternalId({ id: 88001, name: "Widget" })).toBe(88001);
    expect(extractWooExternalId({ id: "88001" })).toBe(88001);
    expect(extractWooExternalId({ id: 0 })).toBeNull();
    expect(extractWooExternalId({ id: -1 })).toBeNull();
    expect(extractWooExternalId({ id: "1.5" })).toBeNull();
  });

  it("never enqueues a duplicate delivery or fingerprint", () => {
    expect(shouldEnqueueWooDelivery({ duplicateDeliveryId: false, duplicateFingerprint: false, orderId: 10 })).toBe(true);
    expect(shouldEnqueueWooDelivery({ duplicateDeliveryId: true, duplicateFingerprint: false, orderId: 10 })).toBe(false);
    expect(shouldEnqueueWooDelivery({ duplicateDeliveryId: false, duplicateFingerprint: true, orderId: 10 })).toBe(false);
    expect(shouldEnqueueWooDelivery({ duplicateDeliveryId: false, duplicateFingerprint: false, orderId: null })).toBe(false);
  });

  it("matches the resource header to the topic family", () => {
    expect(isWooWebhookResourceValid("order.updated", "order")).toBe(true);
    expect(isWooWebhookResourceValid("product.created", "product")).toBe(true);
    expect(isWooWebhookResourceValid("product.updated", "order")).toBe(false);
    expect(isWooWebhookResourceValid("order.updated", "product")).toBe(false);
    expect(isWooWebhookResourceValid("product.deleted", "product")).toBe(false);
    expect(isWooWebhookResourceValid(null, "order")).toBe(false);
  });

  it("includes binding headers in the deterministic fallback fingerprint", () => {
    const base = { source: "https://shop.example", webhookId: "42", topic: "order.updated", resource: "order", rawBody: "{}" };
    expect(deliveryFingerprintInput(base)).toBe(deliveryFingerprintInput(base));
    expect(deliveryFingerprintInput(base)).not.toBe(deliveryFingerprintInput({ ...base, topic: "order.deleted" }));
    expect(deliveryFingerprintInput(base)).not.toBe(deliveryFingerprintInput({ ...base, rawBody: " { }" }));
  });

  it("normalizes sources and fingerprints them the way the intake signs them", () => {
    expect(normalizeWooWebhookSource("  HTTPS://Shop.Example/ ")).toBe("https://shop.example");
    expect(WOO_WEBHOOK_TOPICS).toEqual(["order.created", "order.updated", "order.deleted", "product.created", "product.updated"]);
    // The edge function hashes this string, a null byte, then the raw body; a
    // trailing slash or header casing must not change the dedupe identity.
    expect(deliveryFingerprintInput({ source: "HTTPS://SHOP.EXAMPLE/", webhookId: "42", topic: "order.updated", resource: "order", rawBody: "" }))
      .toBe(["https://shop.example", "42", "order.updated", "order", ""].join(String.fromCharCode(0)));
  });
});

describe("WooCommerce webhook verification outcome", () => {
  const accepted = {
    signatureValid: true,
    topicValid: true,
    resourceValid: true,
    payload: { id: 10 },
    deliveryId: "delivery-1",
  };

  it("only queues work for a verified, well-formed delivery", () => {
    expect(shouldEnqueueWooWebhookWork(accepted)).toBe(true);
    expect(shouldEnqueueWooWebhookWork({ ...accepted, signatureValid: false })).toBe(false);
    expect(shouldEnqueueWooWebhookWork({ ...accepted, topicValid: false })).toBe(false);
    expect(shouldEnqueueWooWebhookWork({ ...accepted, resourceValid: false })).toBe(false);
    expect(shouldEnqueueWooWebhookWork({ ...accepted, payload: { id: null } })).toBe(false);
    expect(shouldEnqueueWooWebhookWork({ ...accepted, deliveryId: null })).toBe(true);
    expect(shouldEnqueueWooWebhookWork({ ...accepted, deliveryId: undefined })).toBe(true);
  });

  it("never queues work for a body that failed to parse", () => {
    // JSON.parse failures leave the payload null; it is retained as delivery
    // evidence and rejected with 400 malformed_payload, never enqueued.
    for (const payload of [null, undefined]) {
      expect(shouldEnqueueWooWebhookWork({ ...accepted, payload })).toBe(false);
    }
    expect(shouldEnqueueWooWebhookWork({
      signatureValid: true,
      topicValid: true,
      resourceValid: true,
      payload: null,
      deliveryId: "delivery-1",
    })).toBe(false);
  });

  it("never queues work from a JSON scalar or array body", () => {
    for (const payload of ["10", 10, true, [], [{ id: 10 }]]) {
      expect(shouldEnqueueWooWebhookWork({ ...accepted, payload })).toBe(false);
    }
  });
});

describe("WooCommerce webhook status promotion", () => {
  it("promotes only when the delivery matches the expected webhook id", () => {
    expect(shouldPromoteWooWebhookStatus({ expectedWebhookId: 42, webhookId: 42 })).toBe(true);
  });

  it("never promotes for a different or null expected webhook id", () => {
    expect(shouldPromoteWooWebhookStatus({ expectedWebhookId: 42, webhookId: 43 })).toBe(false);
    expect(shouldPromoteWooWebhookStatus({ expectedWebhookId: null, webhookId: 42 })).toBe(false);
    expect(shouldPromoteWooWebhookStatus({ expectedWebhookId: undefined, webhookId: 42 })).toBe(false);
    expect(shouldPromoteWooWebhookStatus({ expectedWebhookId: 0, webhookId: 0 })).toBe(true);
  });
});

describe("WooCommerce webhook secret resolution", () => {
  it("uses the connector's own secret reference", () => {
    expect(webhookSecretNames({
      webhookSecretRef: "WOO_SHOP_A_WEBHOOK",
      previousWebhookSecretRef: null,
      previousSecretExpiresAt: null,
      now,
    })).toEqual(["WOO_SHOP_A_WEBHOOK"]);
  });

  it("accepts the previous secret only inside an unexpired rotation grace window", () => {
    expect(webhookSecretNames({
      webhookSecretRef: "WOO_SHOP_A_WEBHOOK_V2",
      previousWebhookSecretRef: "WOO_SHOP_A_WEBHOOK",
      previousSecretExpiresAt: "2026-11-10T13:00:00.000Z",
      now,
    })).toEqual(["WOO_SHOP_A_WEBHOOK_V2", "WOO_SHOP_A_WEBHOOK"]);
    expect(webhookSecretNames({
      webhookSecretRef: "WOO_SHOP_A_WEBHOOK_V2",
      previousWebhookSecretRef: "WOO_SHOP_A_WEBHOOK",
      previousSecretExpiresAt: "2026-11-10T11:00:00.000Z",
      now,
    })).toEqual(["WOO_SHOP_A_WEBHOOK_V2"]);
    expect(webhookSecretNames({
      webhookSecretRef: "WOO_SHOP_A_WEBHOOK_V2",
      previousWebhookSecretRef: "WOO_SHOP_A_WEBHOOK",
      previousSecretExpiresAt: "not-a-timestamp",
      now,
    })).toEqual(["WOO_SHOP_A_WEBHOOK_V2"]);
  });

  it("fails closed without a connector secret reference instead of using a global secret", () => {
    for (const webhookSecretRef of [null, undefined, ""]) {
      expect(webhookSecretNames({
        webhookSecretRef,
        previousWebhookSecretRef: "WOO_SHOP_A_WEBHOOK",
        previousSecretExpiresAt: "2026-11-10T13:00:00.000Z",
        now,
      })).toEqual([]);
      expect(webhookSecretNames({
        webhookSecretRef,
        previousWebhookSecretRef: null,
        previousSecretExpiresAt: null,
        now,
      })).toEqual([]);
    }
  });
});