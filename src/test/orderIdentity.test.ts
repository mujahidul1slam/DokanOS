import { describe, expect, it } from "vitest";
import {
  activeConsignmentIds,
  consignmentAccountConflict,
  describeIdentityChange,
  identityChangeBlocked,
  identityChanged,
  legacyStoreIdFor,
  resolveSellingPoint,
  sellingPointsForBrand,
  type IdentitySellingPoint,
} from "@/lib/orderIdentity";

const point = (
  id: string,
  over: Partial<IdentitySellingPoint> = {},
): IdentitySellingPoint => ({
  id,
  name: id,
  brand_id: "brand-a",
  woo_store_id: null,
  is_default: false,
  is_active: true,
  ...over,
});

describe("orderIdentity", () => {
  describe("sellingPointsForBrand", () => {
    it("keeps only the brand's active selling points", () => {
      const points = [
        point("sp-1"),
        point("sp-2", { brand_id: "brand-b" }),
        point("sp-3", { is_active: false }),
      ];
      expect(sellingPointsForBrand(points, "brand-a").map((p) => p.id)).toEqual(["sp-1"]);
    });

    it("returns empty for a missing brand", () => {
      expect(sellingPointsForBrand([point("sp-1")], null)).toEqual([]);
      expect(sellingPointsForBrand([point("sp-1")], "")).toEqual([]);
    });
  });

  describe("resolveSellingPoint (issue #21 rules)", () => {
    it("keeps the previous selection when it is still an option (editable)", () => {
      const points = [point("sp-1", { is_default: true }), point("sp-2")];
      expect(resolveSellingPoint(points, "sp-2")).toEqual({ sellingPointId: "sp-2", reason: "kept" });
    });

    it("preselects the brand default when there is no previous selection", () => {
      const points = [point("sp-1"), point("sp-2", { is_default: true })];
      expect(resolveSellingPoint(points, "")).toEqual({ sellingPointId: "sp-2", reason: "default" });
    });

    it("auto-selects the single option", () => {
      expect(resolveSellingPoint([point("sp-only")], null)).toEqual({
        sellingPointId: "sp-only",
        reason: "only",
      });
    });

    it("stays unresolved with multiple options and no default", () => {
      const points = [point("sp-1"), point("sp-2")];
      expect(resolveSellingPoint(points, null)).toEqual({ sellingPointId: null, reason: "none" });
    });

    it("stays unresolved with zero options (blocked)", () => {
      expect(resolveSellingPoint([], "sp-gone")).toEqual({ sellingPointId: null, reason: "none" });
    });

    it("ignores a previous id that is no longer among the options", () => {
      const points = [point("sp-1", { is_default: true })];
      expect(resolveSellingPoint(points, "sp-old")).toEqual({ sellingPointId: "sp-1", reason: "default" });
    });
  });

  describe("legacyStoreIdFor (Woo store binding only — never a Selling Point UUID)", () => {
    it("prefers the Selling Point's woo binding", () => {
      expect(
        legacyStoreIdFor(
          point("sp-uuid", { woo_store_id: "store-sp" }),
          { woo_store_id: "store-brand" },
        ),
      ).toBe("store-sp");
    });

    it("falls back to the brand's woo binding", () => {
      expect(
        legacyStoreIdFor(
          point("sp-uuid", { woo_store_id: null }),
          { woo_store_id: "store-brand" },
        ),
      ).toBe("store-brand");
    });

    it("never writes a Selling Point UUID when no binding exists", () => {
      expect(
        legacyStoreIdFor(point("sp-uuid", { woo_store_id: null }), null, {
          previousStoreId: null,
          brandChanged: true,
        }),
      ).toBeNull();
    });

    it("keeps the previous legacy binding only when the brand is unchanged", () => {
      const sp = point("sp-uuid", { woo_store_id: null });
      const brand = { id: "b", name: "B", woo_store_id: null };
      expect(legacyStoreIdFor(sp, brand, { previousStoreId: "store-legacy", brandChanged: false })).toBe(
        "store-legacy",
      );
      expect(legacyStoreIdFor(sp, brand, { previousStoreId: "store-legacy", brandChanged: true })).toBeNull();
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
    it("detects brand or selling point moves and ignores empty-string noise", () => {
      const before = { brandId: "b1", sellingPointId: "sp1" };
      expect(identityChanged(before, { brandId: "b1", sellingPointId: "sp1" })).toBe(false);
      expect(identityChanged(before, { brandId: "b2", sellingPointId: "sp1" })).toBe(true);
      expect(identityChanged(before, { brandId: "b1", sellingPointId: "sp2" })).toBe(true);
      expect(
        identityChanged({ brandId: null, sellingPointId: null }, { brandId: "", sellingPointId: "" }),
      ).toBe(false);
    });

    it("blocks only when a brand is selected and no selling point resolves", () => {
      expect(identityChangeBlocked("b1", { sellingPointId: null, reason: "none" })).toBe(true);
      expect(identityChangeBlocked("b1", { sellingPointId: "sp1", reason: "default" })).toBe(false);
      expect(identityChangeBlocked(null, { sellingPointId: null, reason: "none" })).toBe(false);
    });
  });

  describe("describeIdentityChange", () => {
    it("describes brand + selling point + re-resolved account changes for timeline and audit", () => {
      const result = describeIdentityChange(
        {
          brandId: "b1",
          brandName: "Acme",
          sellingPointId: "sp1",
          sellingPointName: "Showroom",
          accountKey: "int-1:11",
          accountLabel: "Pathao Main · Mirpur Hub",
        },
        {
          brandId: "b2",
          brandName: "Bolt",
          sellingPointId: "sp2",
          sellingPointName: "Facebook",
          accountKey: "int-2:33",
          accountLabel: "Pathao Outlet · Chattogram Hub",
        },
      );
      expect(result.description).toContain('Brand: "Acme" → "Bolt"');
      expect(result.description).toContain('Selling Point: "Showroom" → "Facebook"');
      expect(result.description).toContain("default Pathao Account");
      expect(result.changes).toHaveLength(3);
      expect(result.metadata.brand).toMatchObject({ from: "b1", to: "b2" });
      expect(result.metadata.selling_point).toMatchObject({ from: "sp1", to: "sp2" });
      expect(result.metadata.pathao_account).toMatchObject({ from: "int-1:11", to: "int-2:33" });
    });

    it("omits unchanged fields from the change list", () => {
      const snapshot = {
        brandId: "b1",
        brandName: "Acme",
        sellingPointId: "sp1",
        sellingPointName: "Showroom",
        accountKey: "int-1:11",
        accountLabel: "Pathao Main · Mirpur Hub",
      };
      const result = describeIdentityChange(snapshot, { ...snapshot, sellingPointId: "sp2", sellingPointName: "Facebook" });
      expect(result.changes).toEqual(['Selling Point: "Showroom" → "Facebook"']);
    });
  });
});
