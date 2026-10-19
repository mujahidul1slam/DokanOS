import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectLegacyInventory } from "../../../scripts/lib/collect-legacy-accounts.mjs";
import { auditLegacyAccounts, rehearsePreservation } from "./legacy-readiness";

// Opt-in real PostgreSQL integration. Creates/drops ONLY its own randomly named database.
// No Supabase reset, application env, schema drops or deployed credentials.
const testUrl = process.env.ACCOUNTS_AUDIT_TEST_URL;
const database = `dokanos_accounts_fixture_${randomUUID().split("-").join("")}`;
let admin: pg.Client;
let connectionString: string;
let fixture: pg.Client;

describe.skipIf(!testUrl)("account audit against disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(testUrl);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Integration tests require an explicit localhost PostgreSQL URL.");
    admin = new pg.Client({ connectionString: testUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    connectionString = url.toString();
    fixture = new pg.Client({ connectionString });
    await fixture.connect();
    await fixture.query(readFileSync("scripts/fixtures/account-readiness/schema.sql", "utf8"));
  }, 30000);

  afterAll(async () => {
    await fixture?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  });

  it("collects all rows and indirect operational references without altering data or exposing secrets", async () => {
    const before = await collectLegacyInventory(connectionString);
    expect(before.source.transactionReadOnly).toBe(true);
    expect(before.tables.stores[0]).not.toHaveProperty("consumer_secret");
    expect(JSON.stringify(before)).not.toContain("fixture-secret-do-not-export");
    expect(before.tables.order_items).toHaveLength(1);
    expect(before.references).toContainEqual(expect.objectContaining({ table: "order_items", column: "order_id", target: "orders" }));
    const store = before.tables.stores[0];
    const report = auditLegacyAccounts(before, [{
      resource: "stores:woo", rowHash: store.row_hash, brandId: "brand", disposition: "store",
      storeType: "online", reviewedBy: "fixture-operator", evidence: "Synthetic online-operation review",
    }]);
    expect(report.ready).toBe(true);
    expect(report.operations).toContainEqual({ resource: "order_items:item", businessIds: ["account"] });
    const after = await collectLegacyInventory(connectionString);
    expect(rehearsePreservation(before, after).preserved).toBe(true);
  });

  it("blocks a shared store and detects changes to non-exported historical payload", async () => {
    const before = await collectLegacyInventory(connectionString);
    await fixture.query("INSERT INTO brands (id, business_id, woo_store_id) VALUES ('second-brand', 'account', 'woo')");
    await fixture.query("UPDATE orders SET notes = 'changed history' WHERE id = 'order'");
    const after = await collectLegacyInventory(connectionString);
    expect(auditLegacyAccounts(after).blockers).toContainEqual(expect.objectContaining({ code: "shared-resource", resource: "stores:woo" }));
    expect(rehearsePreservation(before, after).violations).toContainEqual(expect.objectContaining({ code: "row-changed", resource: "orders:order" }));
  });

  it("detects table privilege revocation, RLS changes and restrictive policy additions", async () => {
    await fixture.query("GRANT SELECT ON orders TO PUBLIC");
    const before = await collectLegacyInventory(connectionString);
    await fixture.query("REVOKE SELECT ON orders FROM PUBLIC");
    await fixture.query("ALTER TABLE orders ENABLE ROW LEVEL SECURITY");
    await fixture.query("CREATE POLICY deny_members ON orders AS RESTRICTIVE FOR SELECT USING (false)");
    const after = await collectLegacyInventory(connectionString);
    expect(rehearsePreservation(before, after).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "authority-changed", resource: "table-security:public.orders" }),
      expect.objectContaining({ code: "authority-added", resource: "policy:public.orders:deny_members" }),
    ]));
  });
});
