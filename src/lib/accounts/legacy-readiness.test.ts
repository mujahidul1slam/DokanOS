import { describe, expect, it } from "vitest";
import { auditLegacyAccounts, rehearsePreservation, type LegacyInventory } from "./legacy-readiness";

function safeInventory(): LegacyInventory {
  return {
    version: 1,
    tables: {
      "auth.users": [{ id: "owner", row_hash: "person-1" }, { id: "member", row_hash: "person-2" }],
      businesses: [{ id: "account", row_hash: "account-1" }],
      user_business_access: [
        { id: "owner-membership", user_id: "owner", business_id: "account", role: "owner", row_hash: "membership-1" },
        { id: "member-membership", user_id: "member", business_id: "account", role: "member", row_hash: "membership-2" },
      ],
      brands: [{ id: "brand", business_id: "account", woo_store_id: "woo", row_hash: "brand-1" }],
      stores: [{ id: "woo", row_hash: "store-1" }],
      storefronts: [], locations: [], selling_points: [],
      user_roles: [], user_permissions: [], user_store_access: [],
      user_custom_roles: [], custom_roles: [], permission_settings: [], invitations: [],
      orders: [{ id: "order", store_id: "woo", row_hash: "history-1" }],
    },
    references: [{ table: "orders", column: "store_id", target: "stores" }],
  };
}

const reviewedStore = [{
  resource: "stores:woo", rowHash: "store-1", brandId: "brand",
  disposition: "store" as const, storeType: "online" as const,
  reviewedBy: "operator", evidence: "Review #8: confirmed online operation; preserve Woo connector ID",
}];

describe("legacy account readiness report", () => {
  it("reports an unambiguous reviewed mapping without changing history or access", () => {
    const inventory = safeInventory();
    const original = structuredClone(inventory);
    const report = auditLegacyAccounts(inventory, reviewedStore);

    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.resources).toContainEqual(expect.objectContaining({
      resource: "stores:woo", businessIds: ["account"], brandIds: ["brand"], storeType: "online", status: "reviewed",
    }));
    expect(report.inventory.tables.orders).toEqual([{ id: "order", store_id: "woo", row_hash: "history-1" }]);
    expect(report.access.memberships).toHaveLength(2);
    expect(inventory).toEqual(original);
  });

  it("blocks shared, unlinked and type-ambiguous resources, multiple owners and global authority", () => {
    const inventory = safeInventory();
    inventory.tables.businesses.push({ id: "other-account", row_hash: "account-2" });
    inventory.tables.brands.push({ id: "other-brand", business_id: "other-account", woo_store_id: "woo", row_hash: "brand-2" });
    inventory.tables.stores.push({ id: "unlinked", row_hash: "store-2" });
    inventory.tables.locations.push({ id: "warehouse", business_id: "account", brand_id: "brand", type: "warehouse", row_hash: "location-1" });
    inventory.tables.user_business_access.push({ id: "extra-owner", business_id: "account", user_id: "member", role: "owner", row_hash: "membership-3" });
    inventory.tables.user_roles.push({ id: "global-admin", user_id: "owner", role: "admin", row_hash: "role-1" });
    inventory.tables.user_permissions.push({ id: "global-revoke", user_id: "member", permission: "orders.view", granted: false, row_hash: "permission-1" });
    const original = structuredClone(inventory);

    const report = auditLegacyAccounts(inventory, reviewedStore);

    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "shared-resource", resource: "stores:woo" }),
      expect.objectContaining({ code: "unlinked-resource", resource: "stores:unlinked" }),
      expect.objectContaining({ code: "mapping-review", resource: "locations:warehouse" }),
      expect.objectContaining({ code: "multiple-owners", resource: "businesses:account" }),
      expect.objectContaining({ code: "global-authority", resource: "user_roles:global-admin" }),
      expect.objectContaining({ code: "global-authority", resource: "user_permissions:global-revoke" }),
    ]));
    expect(report.resources.find((r) => r.resource === "stores:woo").storeType).toBeNull();
    expect(inventory).toEqual(original);
  });

  it("blocks orphaned references, unscoped history and cross-account operational links", () => {
    const inventory = safeInventory();
    inventory.tables.businesses.push({ id: "other-account", row_hash: "account-2" });
    inventory.tables.user_business_access.push({ id: "other-owner", user_id: "owner", business_id: "other-account", role: "owner", row_hash: "membership-3" });
    inventory.tables.brands.push({ id: "other-brand", business_id: "other-account", row_hash: "brand-2" });
    inventory.tables.locations.push({ id: "other-location", business_id: "other-account", brand_id: "other-brand", row_hash: "location-2" });
    inventory.tables.orders.push(
      { id: "cross-account", store_id: "woo", location_id: "other-location", row_hash: "history-2" },
      { id: "orphan", store_id: "missing", row_hash: "history-3" },
      { id: "unscoped", store_id: null, row_hash: "history-4" },
    );
    inventory.references.push({ table: "orders", column: "location_id", target: "locations" });

    const report = auditLegacyAccounts(inventory, reviewedStore);

    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "cross-account-reference", resource: "orders:cross-account" }),
      expect.objectContaining({ code: "orphan-reference", resource: "orders:orphan" }),
      expect.objectContaining({ code: "unscoped-operation", resource: "orders:unscoped" }),
    ]));
    expect(report.operations).toContainEqual(expect.objectContaining({ resource: "orders:order", businessIds: ["account"] }));
  });

  it("rehearses additive compatibility and blocks removal or alteration of history and legitimate access", () => {
    const before = safeInventory();
    const additive = structuredClone(before);
    additive.tables.new_store_links = [{ id: "new-link", legacy_store_id: "woo", row_hash: "link-1" }];
    expect(rehearsePreservation(before, additive)).toEqual({ preserved: true, violations: [] });

    const destructive = structuredClone(before);
    destructive.tables.orders = [];
    destructive.tables.user_business_access[1] = {
      ...destructive.tables.user_business_access[1], business_id: "other-account", row_hash: "changed-membership",
    };
    const result = rehearsePreservation(before, destructive);
    expect(result.preserved).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "row-removed", resource: "orders:order" }),
      expect.objectContaining({ code: "row-changed", resource: "user_business_access:member-membership" }),
    ]));
  });

  it("fails closed on incomplete evidence, stale decisions, unknown roles and opaque references", () => {
    const inventory = safeInventory();
    delete inventory.tables.invitations;
    inventory.tables.user_business_access[1].role = "viewer";
    inventory.tables.orders[0].opaque_columns = ["items"];
    const report = auditLegacyAccounts(inventory, [{ ...reviewedStore[0], rowHash: "stale" }]);
    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "incomplete-inventory", resource: "invitations" }),
      expect.objectContaining({ code: "membership-authority", resource: "user_business_access:member-membership" }),
      expect.objectContaining({ code: "mapping-review", resource: "stores:woo" }),
      expect.objectContaining({ code: "opaque-reference", resource: "orders:order" }),
    ]));
  });

  it("blocks authorization additions that could restrict otherwise preserved access", () => {
    const before = safeInventory();
    before.authorization = [];
    const after = structuredClone(before);
    after.authorization.push({ kind: "policy", id: "public.orders:deny-member", row_hash: "restrictive-policy" });
    expect(rehearsePreservation(before, after)).toEqual({
      preserved: false,
      violations: [expect.objectContaining({ code: "authority-added", resource: "policy:public.orders:deny-member" })],
    });
  });

  it("cannot establish an owner from an imported membership with no personal identity", () => {
    const inventory = safeInventory();
    delete inventory.tables.user_business_access[0].user_id;
    const report = auditLegacyAccounts(inventory, reviewedStore);
    expect(report.ready).toBe(false);
    expect(report.blockers).toContainEqual(expect.objectContaining({ code: "missing-relationship", resource: "user_business_access:owner-membership" }));
  });
});
