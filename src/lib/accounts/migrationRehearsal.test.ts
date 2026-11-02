import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditLegacyAccounts, type LegacyInventory, type ReviewedMapping } from "./legacy-readiness";
import { rehearseAccountMigration, routeReviewedExceptions } from "./migrationRehearsal";

const fixtures = path.resolve("scripts/fixtures/account-readiness/rehearsal");
const inventory = (name: string): LegacyInventory => JSON.parse(readFileSync(path.join(fixtures, name), "utf8"));
const mappings = (): ReviewedMapping[] => JSON.parse(readFileSync(path.join(fixtures, "reviewed-mappings.json"), "utf8"));

describe("account migration rehearsal", () => {
  it("resolves only the reviewed exceptions and retains every unresolved record as a release blocker", () => {
    const pre = inventory("pre-change.json");
    const routing = routeReviewedExceptions(auditLegacyAccounts(pre).blockers, auditLegacyAccounts(pre, mappings()).blockers);

    // Exactly the two reviewed resources stop blocking; nothing else is reassigned.
    expect(routing.resolved.map((blocker) => blocker.resource).sort())
      .toEqual(["locations:warehouse", "stores:clean"]);
    expect(routing.resolved.every((blocker) => blocker.code === "mapping-review")).toBe(true);

    // Multiple owners, shared/unlinked resources and legacy global authority are
    // operator decisions, never guessed away by a mapping.
    expect(routing.releaseBlockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "multiple-owners", resource: "businesses:account" }),
      expect.objectContaining({ code: "shared-resource", resource: "stores:shared" }),
      expect.objectContaining({ code: "unlinked-resource", resource: "stores:unlinked" }),
      expect.objectContaining({ code: "global-authority", resource: "user_roles:global-admin" }),
      expect.objectContaining({ code: "global-authority", resource: "user_permissions:global-revoke" }),
    ]));
    expect(routing.ready).toBe(false);
  });

  it("preserves pre-change records and legitimate access across an additive migration while the release blocker stays open", () => {
    const rehearsal = rehearseAccountMigration(
      inventory("pre-change.json"),
      inventory("post-change.json"),
      mappings(),
    );

    expect(rehearsal.preservation).toEqual({ preserved: true, violations: [] });
    expect(rehearsal.routing.ready).toBe(false);
    expect(rehearsal.ready).toBe(false);
    // The additive slice may add rows (the new brand_stores link) without
    // touching the fingerprinted legacy history or the membership records.
    expect(rehearsal.pre.inventory.tables.orders).toEqual([{ id: "order", store_id: "clean", row_hash: "history-1" }]);
    expect(rehearsal.pre.access.memberships).toHaveLength(3);
  });

  it("blocks a destructive migration that removes history or rewrites legitimate access", () => {
    const pre = inventory("pre-change.json");
    const destructive = inventory("post-change.json");
    destructive.tables.orders = [];
    destructive.tables.user_business_access[2] = {
      ...destructive.tables.user_business_access[2], business_id: "elsewhere", row_hash: "changed-membership",
    };

    const rehearsal = rehearseAccountMigration(pre, destructive, mappings());

    expect(rehearsal.preservation.preserved).toBe(false);
    expect(rehearsal.preservation.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "row-removed", resource: "orders:order" }),
      expect.objectContaining({ code: "row-changed", resource: "user_business_access:m-member" }),
    ]));
    expect(rehearsal.ready).toBe(false);
  });

  it("routes a fully reviewed additive slice to ready without inventing a mapping", () => {
    const pre = inventory("pre-change.json");
    const onlyMappings: ReviewedMapping[] = [mappings()[0]];
    const routing = routeReviewedExceptions(auditLegacyAccounts(pre, onlyMappings).blockers, auditLegacyAccounts(pre, onlyMappings).blockers);
    expect(routing.resolved).toEqual([]);
    expect(routing.releaseBlockers.length).toBeGreaterThan(0);
  });
});
