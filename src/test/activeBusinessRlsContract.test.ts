import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Deterministic SQL policy contract for the hybrid tenancy (issue #16) RLS
 * enforcement. Runs without Docker or a database: it replays every
 * CREATE/DROP POLICY statement across `supabase/migrations/` in document order
 * (including EXECUTE format() loops inside DO blocks) and asserts the FINAL
 * policy state — the same state `supabase db reset` produces.
 *
 * This is the static half of the acceptance bar ("the new policies must
 * reference current_business_context() directly or through a helper, and no
 * target tenant policy may remain an authenticated USING(true) read"). The
 * behavioural half lives in supabase/tests/rls/*_test.sql and runs with
 * `npm run test:rls` when Docker is available.
 *
 * Excluded tables are deliberate, documented scope decisions:
 *  - invoice_settings, pathao_stores: no tenant key at all (deployment-global
 *    settings row / shared courier directory) — scoping them needs a schema
 *    change tracked separately in issue #16.
 *  - brands, brand_stores, businesses: the issue #11/#12 membership-scoped
 *    model, not store-linked operational data.
 *  - pathao_integrations: admin-only rows plus a security_invoker safe view.
 */

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

/** Tables whose operational rows must be active-business bounded. */
const TENANT_TABLES = [
  "stores",
  "storefronts",
  "products",
  "orders",
  "order_items",
  "order_payments",
  "order_timeline",
  "customers",
  "customer_aliases",
  "held_carts",
  "pos_returns",
  "pos_shifts",
  "categories",
  "product_categories",
  "product_variations",
  "product_locations",
  "pathao_store_links",
];

const ENFORCEMENT_MIGRATION = "active_business_context_operational_rls.sql";
const CONTEXT_MIGRATION = "20261024100000_active_business_context.sql";

interface Policy {
  name: string;
  table: string;
  /** Normalized `FOR ... TO ... USING (...) WITH CHECK (...)` text. */
  expr: string;
  source: string;
}

interface Event {
  idx: number;
  kind: "create" | "drop";
  name: string;
  table: string;
  expr: string;
  source: string;
}

const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

const parseEvents = (sql: string, source: string): Event[] => {
  const events: Event[] = [];
  for (const m of sql.matchAll(/CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)([\s\S]*?);/gi)) {
    events.push({ idx: m.index, kind: "create", name: m[1], table: m[2], expr: m[3], source });
  }
  for (const m of sql.matchAll(/DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.)?(\w+)/gi)) {
    events.push({ idx: m.index, kind: "drop", name: m[1], table: m[2], expr: "", source });
  }
  // EXECUTE format() policy statements inside DO blocks, expanded over the
  // block's literal table list (ARRAY[...] or VALUES tuples).
  for (const block of sql.matchAll(/DO\s+\$\$([\s\S]*?)\$\$/g)) {
    const body = block[1];
    const tables = new Set<string>();
    for (const arr of body.matchAll(/ARRAY\[([\s\S]*?)\]/g)) {
      for (const t of arr[1].matchAll(/'([a-z_]+)'/g)) tables.add(t[1]);
    }
    const tuples = new Map<string, string>();
    for (const t of body.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'((?:[^']|'')*)'\s*\)/g)) {
      tables.add(t[1]);
      tuples.set(t[1], t[2].replace(/''/g, "'"));
    }
    if (tables.size === 0) continue;
    for (const sm of body.matchAll(/EXECUTE\s+format\(\s*'(DROP\s+POLICY[^']*|CREATE\s+POLICY[^']*)'/g)) {
      const tpl = sm[1].replace(/''/g, "'");
      for (const tbl of tables) {
        const stmt = tpl
          .replace(/%1\$[Is]/g, tbl)
          .replace(/%2\$s/g, tuples.get(tbl) ?? "%2$s");
        const create = stmt.match(/CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)([\s\S]*)/i);
        const drop = stmt.match(/DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.)?(\w+)/i);
        const idx = (block.index ?? 0) + (sm.index ?? 0);
        if (create) events.push({ idx, kind: "create", name: create[1], table: create[2], expr: create[3], source });
        else if (drop) events.push({ idx, kind: "drop", name: drop[1], table: drop[2], expr: "", source });
      }
    }
  }
  return events;
};

/** Final policy set per table: every migration applied in filename order. */
const finalPolicies = (): Map<string, Map<string, Policy>> => {
  const policies = new Map<string, Map<string, Policy>>();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = stripComments(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    const events = parseEvents(sql, file).sort((a, b) => a.idx - b.idx);
    for (const e of events) {
      if (!policies.has(e.table)) policies.set(e.table, new Map());
      const tablePolicies = policies.get(e.table)!;
      if (e.kind === "create") {
        tablePolicies.set(e.name, {
          name: e.name,
          table: e.table,
          expr: e.expr.replace(/\s+/g, " ").trim(),
          source: e.source,
        });
      } else {
        tablePolicies.delete(e.name);
      }
    }
  }
  return policies;
};

const enforcementMigrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(ENFORCEMENT_MIGRATION))
    .sort();

describe("active-business RLS policy contract (static, no Docker)", () => {
  const policies = finalPolicies();

  it("defines user_can_access_store on top of current_business_context()", () => {
    const definitions = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => ({ file: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), "utf8") }))
      .filter(({ sql }) => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?user_can_access_store/i.test(sql));
    expect(definitions.length).toBeGreaterThan(0);
    const latest = definitions[definitions.length - 1];
    expect(latest.file).toContain("active_business_context_operational_rls");
    // The predicate must require the SELECTED business, not merely membership:
    // without this, a member of A and B reads both regardless of the switch.
    expect(latest.sql).toMatch(/business_id\s*=\s*public\.current_business_context\(\)/);
  });

  it("ships the enforcement migration after the context foundation", () => {
    const enforcement = enforcementMigrations();
    expect(enforcement).toHaveLength(1);
    expect(enforcement[0] > CONTEXT_MIGRATION).toBe(true);
    const sql = readFileSync(path.join(MIGRATIONS_DIR, enforcement[0]), "utf8");
    // FORCE RLS on active_business_context must not blind the SECURITY DEFINER
    // context RPCs: a definer-side policy keeps the caller's own row resolvable
    // while client roles still hold no table privileges at all.
    expect(sql).toMatch(/CREATE\s+POLICY[^;]+ON\s+(?:public\.)?active_business_context[^;]*user_id\s*=\s*\(?SELECT\s+auth\.uid\(\)/i);
  });

  it.each(TENANT_TABLES)("%s has no authenticated USING(true) policy left", (table) => {
    const tablePolicies = [...(policies.get(table)?.values() ?? [])];
    expect(tablePolicies.length).toBeGreaterThan(0);
    for (const policy of tablePolicies) {
      if (!/\bTO\b[^;]*\bauthenticated\b/i.test(policy.expr) && !/\bFOR\s+ALL\b/i.test(policy.expr)) continue;
      // A bare true is never an authorization decision.
      expect(policy.expr, `${table}."${policy.name}" (${policy.source})`).not.toMatch(
        /\b(USING|WITH\s+CHECK)\s*\(\s*true\s*\)/i,
      );
    }
  });

  it.each(TENANT_TABLES)("%s predicates every non-admin policy on the tenant scope", (table) => {
    const tablePolicies = [...(policies.get(table)?.values() ?? [])];
    for (const policy of tablePolicies) {
      const grantsToAuthenticated =
        /\bTO\b[^;]*\bauthenticated\b/i.test(policy.expr) || /\bFOR\s+ALL\b/i.test(policy.expr);
      if (!grantsToAuthenticated) continue;
      // Platform-admin recovery policies (has_role) are the reviewed issue #10
      // contract and stay as they are; everything else must be tenant-predicated.
      if (/\bhas_role\s*\(/i.test(policy.expr)) continue;
      expect(policy.expr, `${table}."${policy.name}" (${policy.source})`).toMatch(
        /user_can_access_store\s*\(|current_business_context\s*\(/i,
      );
    }
  });

  it.each(TENANT_TABLES)("%s carries no legacy global-staff grant", (table) => {
    const tablePolicies = [...(policies.get(table)?.values() ?? [])];
    for (const policy of tablePolicies) {
      // "staff::app_role" role grants are the legacy global staff authority
      // issue #10 removed from operational data; they must not survive here.
      expect(policy.expr, `${table}."${policy.name}" (${policy.source})`).not.toMatch(
        /'staff'::/i,
      );
    }
  });
});
