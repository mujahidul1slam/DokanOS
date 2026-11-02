import { describe, expect, it } from "vitest";
import {
  activeConsignmentIds,
  consignmentAccountConflict,
  describeIdentityChange,
  identityChangeBlocked,
  identityChanged,
  legacyStoreIdFor,
  orderSourcesForBrand,
  resolveOrderSource,
  type IdentityOrderSource,
} from "@/lib/orderIdentity";

const source = (
  id: string,
  over: Partial<IdentityOrderSource> = {},
): IdentityOrderSource => ({
  id,
  name: id,
  brand_id: "brand-a",
  type: "showroom",
  ...over,
});

describe("orderIdentity", () => {
  describe("orderSourcesForBrand", () => {
    it("keeps only the brand's order sources", () => {
      const sources = [
        source("src-1"),
        source("src-2", { brand_id: "brand-b" }),
        source("src-3", { type: "facebook" }),
      ];
      expect(orderSourcesForBrand(sources, "brand-a").map((s) => s.id)).toEqual(["src-1", "src-3"]);
    });

    it("returns empty for a missing brand", () => {
      expect(orderSourcesForBrand([source("src-1")], null)).toEqual([]);
      expect(orderSourcesForBrand([source("src-1")], "")).toEqual([]);
    });
  });

  describe("resolveOrderSource (issue #21 rules)", () => {
    it("keeps the previous selection when it is still an option (editable)", () => {
      const sources = [source("src-1"), source("src-2")];
      expect(resolveOrderSource(sources, "src-2")).toEqual({ orderSourceId: "src-2", reason: "kept" });
    });

    it("auto-selects the single option", () => {
      expect(resolveOrderSource([source("src-only")], null)).toEqual({
        orderSourceId: "src-only",
        reason: "only",
      });
    });

    it("stays unresolved with multiple options and no previous choice", () => {
      const sources = [source("src-1"), source("src-2")];
      expect(resolveOrderSource(sources, null)).toEqual({ orderSourceId: null, reason: "none" });
    });

    it("stays unresolved with zero options (blocked)", () => {
      expect(resolveOrderSource([], "src-gone")).toEqual({ orderSourceId: null, reason: "none" });
    });

    it("ignores a previous id that is no longer among the options", () => {
      expect(resolveOrderSource([source("src-1")], "src-old")).toEqual({
        orderSourceId: "src-1",
        reason: "only",
      });
    });
  });

  describe("legacyStoreIdFor (Woo store binding only — never an order source UUID)", () => {
    it("prefers the brand's woo binding", () => {
      expect(legacyStoreIdFor({ woo_store_id: "store-brand" })).toBe("store-brand");
    });

    it("keeps the previous legacy binding only when the brand is unchanged", () => {
      const brand = { id: "b", name: "B", woo_store_id: null };
      expect(legacyStoreIdFor(brand, { previousStoreId: "store-legacy", brandChanged: false })).toBe(
        "store-legacy",
      );
      expect(legacyStoreIdFor(brand, { previousStoreId: "store-legacy", brandChanged: true })).toBeNull();
    });

    it("never writes an order source UUID when no binding exists", () => {
      expect(legacyStoreIdFor(null, { previousStoreId: null, brandChanged: true })).toBeNull();
      expect(legacyStoreIdFor(undefined)).toBeNull();
    });
  });

  describe("activeConsignmentIds", () => {
    it("counts only non-cancelled shipments and the legacy id once", () => {
      const shipments = [
        { consignment_id: "CID-1", cancelled_at: null },
        { consignment_id: "CID-2", cancelled_at: "2026-01-01T00:00:00Z" },
      ];
      expect(activeConsignmentIds(shipments, "CID-1")).toEqual(["CID-1"]);
      expect(activeConsignmentIds(shipments, "CID-9")).toEqual(["CID-1", "CID-9"]);
      expect(activeConsignmentIds([], null)).toEqual([]);
    });
  });

  describe("consignmentAccountConflict (never silently desync the courier record)", () => {
    const active = [{ consignment_id: "CID-1", cancelled_at: null }];

    it("warns when an active consignment was booked through another account", () => {
      const result = consignmentAccountConflict(active, null, "int-1:11", "int-2:33");
      expect(result.conflicted).toBe(true);
      expect(result.consignmentIds).toEqual(["CID-1"]);
    });

    it("stays silent when the booked account is the new default", () => {
      expect(consignmentAccountConflict(active, null, "int-1:11", "int-1:11").conflicted).toBe(false);
    });

    it("stays silent when there is no active consignment", () => {
      const cancelled = [{ consignment_id: "CID-1", cancelled_at: "2026-01-01T00:00:00Z" }];
      expect(consignmentAccountConflict(cancelled, null, "int-1:11", "int-2:33").conflicted).toBe(false);
    });

    it("stays silent when either account is unknown (no false warning)", () => {
      expect(consignmentAccountConflict(active, null, null, "int-2:33").conflicted).toBe(false);
      expect(consignmentAccountConflict(active, null, "int-1:11", null).conflicted).toBe(false);
    });

    it("detects a legacy consignment id with no shipment rows", () => {
      expect(consignmentAccountConflict([], "CID-legacy", "int-1:11", "int-2:33").conflicted).toBe(true);
    });
  });

  describe("identityChanged / identityChangeBlocked", () => {
    it("detects brand or order source moves and ignores empty-string noise", () => {
      const before = { brandId: "b1", orderSourceId: "src1" };
      expect(identityChanged(before, { brandId: "b1", orderSourceId: "src1" })).toBe(false);
      expect(identityChanged(before, { brandId: "b2", orderSourceId: "src1" })).toBe(true);
      expect(identityChanged(before, { brandId: "b1", orderSourceId: "src2" })).toBe(true);
      expect(
        identityChanged({ brandId: null, orderSourceId: null }, { brandId: "", orderSourceId: "" }),
      ).toBe(false);
    });

    it("blocks only when a brand is selected and no order source resolves", () => {
      expect(identityChangeBlocked("b1", { orderSourceId: null, reason: "none" })).toBe(true);
      expect(identityChangeBlocked("b1", { orderSourceId: "src1", reason: "only" })).toBe(false);
      expect(identityChangeBlocked(null, { orderSourceId: null, reason: "none" })).toBe(false);
    });
  });

  describe("describeIdentityChange", () => {
    it("describes brand + order source + re-resolved account changes for timeline and audit", () => {
      const result = describeIdentityChange(
        {
          brandId: "b1",
          brandName: "Acme",
          orderSourceId: "src1",
          orderSourceName: "Showroom",
          accountKey: "int-1:11",
          accountLabel: "Pathao Main · Mirpur Hub",
        },
        {
          brandId: "b2",
          brandName: "Bolt",
          orderSourceId: "src2",
          orderSourceName: "Facebook",
          accountKey: "int-2:33",
          accountLabel: "Pathao Outlet · Chattogram Hub",
        },
      );
      expect(result.description).toContain('Brand: "Acme" → "Bolt"');
      expect(result.description).toContain('Order Source: "Showroom" → "Facebook"');
      expect(result.description).toContain("default Pathao Account");
      expect(result.changes).toHaveLength(3);
      expect(result.metadata.brand).toMatchObject({ from: "b1", to: "b2" });
      expect(result.metadata.order_source).toMatchObject({ from: "src1", to: "src2" });
      expect(result.metadata.pathao_account).toMatchObject({ from: "int-1:11", to: "int-2:33" });
    });

    it("omits unchanged fields from the change list", () => {
      const snapshot = {
        brandId: "b1",
        brandName: "Acme",
        orderSourceId: "src1",
        orderSourceName: "Showroom",
        accountKey: "int-1:11",
        accountLabel: "Pathao Main · Mirpur Hub",
      };
      const result = describeIdentityChange(snapshot, { ...snapshot, orderSourceId: "src2", orderSourceName: "Facebook" });
      expect(result.changes).toEqual(['Order Source: "Showroom" → "Facebook"']);
    });
  });
});