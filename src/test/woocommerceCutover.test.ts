import { describe, expect, it } from "vitest";
import {
  buildCutoverWindow,
  createBackfillPlan,
  describeWooExternalOrderId,
  isValidWooExternalOrderId,
  matchWooOrder,
  planCutoverEnqueue,
  type CutoverIdentity,
  type CutoverOrder,
} from "@/lib/woocommerceCutover";

const watermark = "2026-11-10T00:00:00.000Z";
const remote: CutoverOrder = {
  id: 42,
  status: "processing",
  dateModified: "2026-11-09T12:00:00.000Z",
  total: 100,
  email: "buyer@example.com",
  name: "A Buyer",
  sku: "SKU-1",
};

describe("WooCommerce cutover window", () => {
  it("is exactly the seven days immediately before the watermark", () => {
    expect(buildCutoverWindow(watermark)).toMatchObject({
      start: "2026-11-03T00:00:00.000Z",
      end: watermark,
      durationMs: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it("uses an exclusive end so the watermark is not backfilled twice", () => {
    const window = buildCutoverWindow(watermark);
    expect(window.contains("2026-11-03T00:00:00.000Z")).toBe(true);
    expect(window.contains("2026-11-10T00:00:00.000Z")).toBe(false);
  });
});

describe("WooCommerce external order IDs", () => {
  it("accepts only positive safe integer numbers without coercion", () => {
    expect(isValidWooExternalOrderId(42)).toBe(true);
    expect(describeWooExternalOrderId(undefined)).toBe("missing");
    expect(describeWooExternalOrderId("42")).toBe("string");
    expect(describeWooExternalOrderId(1.5)).toBe("fractional number");
    for (const value of [undefined, null, "42", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(isValidWooExternalOrderId(value)).toBe(false);
    }
  });

  it("audits malformed IDs as incomplete planner failures", () => {
    const report = createBackfillPlan({
      connectorId: "connector-a",
      watermark,
      dryRun: true,
      remoteOrders: [{ ...remote, id: 0 }, { ...remote, id: 1.5 }, { ...remote, id: undefined }],
      identities: [],
      legacyOrders: [],
    });
    expect(report.items).toHaveLength(3);
    expect(report.failures).toHaveLength(3);
    expect(report.failures.every((failure) => failure.kind === "incomplete")).toBe(true);
  });
});

describe("WooCommerce cutover matching", () => {
  it("accepts exact connector plus external order identity", () => {
    const identity: CutoverIdentity = { connectorId: "connector-a", externalOrderId: 42, localOrderId: "local-1" };
    expect(matchWooOrder(remote, "connector-a", [identity], [])).toEqual({ kind: "exact", localOrderId: "local-1" });
  });

  it("never auto-merges fuzzy legacy candidates", () => {
    const legacy: CutoverOrder = { ...remote, id: undefined, email: "buyer@example.com", name: "A Buyer" };
    expect(matchWooOrder(remote, "connector-a", [], [legacy])).toMatchObject({ kind: "review" });
  });

  it("leaves an unmapped legacy order alone when there is no exact identity", () => {
    expect(matchWooOrder(remote, "connector-a", [], [])).toEqual({ kind: "unmapped" });
  });
});

describe("WooCommerce cutover backfill planning", () => {
  it("does no writes in dry-run mode and reports every supported status", () => {
    const statuses = ["pending", "on-hold", "processing", "completed", "cancelled", "refunded", "failed", "trash"] as const;
    const report = createBackfillPlan({
      connectorId: "connector-a",
      watermark,
      dryRun: true,
      remoteOrders: statuses.map((status, index) => ({ ...remote, id: index + 1, status })),
      identities: [],
      legacyOrders: [],
    });
    expect(report.window.durationMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(report.writes).toHaveLength(0);
    expect(report.items.map((item) => item.status)).toEqual(statuses);
    expect(report.failures).toEqual([]);
  });

  it("imports an unmapped order only on a real backfill and keeps ambiguous work recoverable", () => {
    const report = createBackfillPlan({
      connectorId: "connector-a",
      watermark,
      dryRun: false,
      remoteOrders: [{ ...remote, status: "custom-status" }, { ...remote, id: 43, email: "other@example.com", name: "Other Buyer", total: 99, sku: "SKU-OTHER" }],
      identities: [],
      legacyOrders: [{ ...remote, id: undefined }],
    });
    expect(report.writes).toEqual([
      { kind: "import", connectorId: "connector-a", externalOrderId: 43, status: "processing" },
    ]);
    expect(report.failures.map((failure) => failure.kind)).toEqual(["ambiguous", "unsupported_status"]);
  });

  it("never imports an unmapped order on a dry run", () => {
    const report = createBackfillPlan({
      connectorId: "connector-a",
      watermark,
      dryRun: true,
      remoteOrders: [{ ...remote, id: 43, email: "other@example.com", name: "Other Buyer", total: 99, sku: "SKU-OTHER" }],
      identities: [],
      legacyOrders: [],
    });
    expect(report.items.map((item) => item.match.kind)).toEqual(["unmapped"]);
    expect(report.writes).toEqual([]);
    expect(report.failures).toEqual([]);
  });
});

describe("WooCommerce cutover enqueue decisions", () => {
  it("never enqueues sync work on a dry run", () => {
    for (const matchKind of ["exact", "unmapped", "review"] as const) {
      expect(planCutoverEnqueue({ dryRun: true, matchKind, status: "processing" })).toEqual({
        work: false,
        failureClass: null,
      });
    }
  });

  it("enqueues exact refreshes and real-backfill imports but never review candidates", () => {
    expect(planCutoverEnqueue({ dryRun: false, matchKind: "exact", status: "processing" }).work).toBe(true);
    expect(planCutoverEnqueue({ dryRun: false, matchKind: "unmapped", status: "processing" }).work).toBe(true);
    expect(planCutoverEnqueue({ dryRun: false, matchKind: "review", status: "processing" }).work).toBe(false);
  });

  it("classifies unsupported statuses as a failure before any enqueue", () => {
    expect(planCutoverEnqueue({ dryRun: false, matchKind: "exact", status: "custom-status" })).toEqual({
      work: false,
      failureClass: "unsupported_status",
    });
  });
});
