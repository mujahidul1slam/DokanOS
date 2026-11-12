#!/usr/bin/env node
/**
 * Local-only runner for the WooCommerce SQL regression battery.
 *
 *   node scripts/run-woocommerce-sql-tests.mjs
 *   node scripts/run-woocommerce-sql-tests.mjs --with-pending
 *
 * Every file under supabase/tests/woocommerce_*_test.sql owns its own
 * `BEGIN; ... ROLLBACK;` block, so nothing here survives the run. Tests that
 * need a migration which is on disk but not yet in the local ledger require
 * `--with-pending`; that migration is prepended inside the same transaction so
 * the rehearsal is still rollback-only.
 *
 * Refuses to run against anything that is not the local Docker stack, and
 * refuses to prepend a migration containing a top-level COMMIT (which would
 * end the transaction and make the run non-rehearsal).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const REPO = process.cwd();
const TESTS_DIR = path.join(REPO, "supabase", "tests");
const MIGRATIONS_DIR = path.join(REPO, "supabase", "migrations");
const DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// The WooCommerce tests hardcode this business id and do not create it. A fresh
// `supabase db reset` has no seed, so insert it inside each test's own
// BEGIN ... ROLLBACK block; it never survives the run.
const FIXTURE_BUSINESS_SQL = `INSERT INTO public.businesses (id, name, slug, currency, timezone)
  VALUES ('11111111-0000-0000-0000-000000000001', 'WooCommerce SQL fixture business', 'woocommerce-sql-fixture', 'BDT', 'Asia/Dhaka')
  ON CONFLICT DO NOTHING;`;

// Each test file, and the migrations it needs applied first when the local
// ledger does not already contain them.
const TESTS = [
  {
    file: "woocommerce_outbound_status_test.sql",
    requires: [],
  },
  {
    file: "woocommerce_order_freshness_test.sql",
    requires: [],
  },
  {
    file: "woocommerce_durable_intake_test.sql",
    requires: ["20261111100000_woocommerce_durable_intake.sql"],
  },
  {
    file: "woocommerce_duplicate_finish_test.sql",
    requires: ["20261111110000_woocommerce_duplicate_finish.sql"],
  },
  {
    file: "woocommerce_conflict_resolution_test.sql",
    requires: ["20261110110000_woocommerce_conflict_resolution.sql"],
  },
  {
    file: "woocommerce_order_number_collision_test.sql",
    requires: [
      "20261112120000_woocommerce_order_number_namespace.sql",
      "20261112130000_woocommerce_order_snapshot_and_prefix.sql",
      "20261112140000_woocommerce_order_snapshot_and_prefix_repair.sql",
      "20261112150000_woocommerce_order_snapshot_prefix_backfill.sql",
    ],
  },
];

function localDbUrl() {
  const raw = process.env.LOCAL_SUPABASE_DB_URL || DEFAULT_DB_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LOCAL_SUPABASE_DB_URL is not a valid URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Refusing a non-postgres LOCAL_SUPABASE_DB_URL");
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing a non-local database host: ${url.hostname}`);
  }
  return raw;
}

function topLevelCommit(sql) {
  // A COMMIT outside a DO/$$ block ends the outer transaction. Migrations that
  // carry one cannot be rehearsed inside `BEGIN; ... ROLLBACK;`.
  return /^\s*COMMIT\s*;/im.test(sql);
}

async function appliedVersions(client) {
  const { rows } = await client.query(
    "SELECT version FROM supabase_migrations.schema_migrations",
  );
  return new Set(rows.map((row) => row.version));
}

async function run() {
  const withPending = process.argv.includes("--with-pending");
  const connectionString = localDbUrl();
  const client = new Client({ connectionString });
  await client.connect();

  let failures = 0;
  let passes = 0;
  let skips = 0;
  try {
    const applied = await appliedVersions(client);

    for (const test of TESTS) {
      const testPath = path.join(TESTS_DIR, test.file);
      const testSql = readFileSync(testPath, "utf8");
      if (!/^\s*BEGIN\s*;/im.test(testSql) || !/ROLLBACK\s*;\s*$/im.test(testSql)) {
        console.log(`FAIL  ${test.file}: file does not own a BEGIN ... ROLLBACK block`);
        failures++;
        continue;
      }

      let preamble = "";
      const missing = test.requires.filter(
        (name) => !applied.has(name.slice(0, name.indexOf("_"))),
      );
      if (missing.length > 0) {
        if (!withPending) {
          skips++;
          console.log(
            `SKIP  ${test.file}: needs unapplied migration(s) ${missing.join(", ")}; re-run with --with-pending`,
          );
          continue;
        }
        for (const name of missing) {
          const sql = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
          if (topLevelCommit(sql)) {
            console.log(
              `FAIL  ${test.file}: ${name} contains a top-level COMMIT, so it cannot be rehearsed rollback-only`,
            );
            failures++;
            preamble = null;
            break;
          }
          preamble += `${sql}\n`;
        }
        if (preamble === null) continue;
      }

      // Keep the test's own BEGIN; insert the preamble right after it so the
      // migration and its assertions share one transaction.
      // A function replacement: a string replacement would treat `$$` and `$1`
      // in the migration's dollar-quoted bodies as replacement patterns.
      const combined = testSql.replace(/^(\s*BEGIN\s*;)/im, (match) => `${match}\n${FIXTURE_BUSINESS_SQL}\n${preamble}`);
      try {
        const results = await client.query(combined);
        const last = Array.isArray(results) ? results.at(-1) : results;
        if (String(last?.command ?? "").toUpperCase() !== "ROLLBACK") {
          throw new Error(`transaction did not end in ROLLBACK (last command: ${last?.command})`);
        }
        passes++;
        console.log(`PASS  ${test.file}`);
      } catch (error) {
        failures++;
        console.log(`FAIL  ${test.file}: ${error.message}`);
        // The batch aborts mid-transaction; recover so the next file is judged
        // independently of this one.
        try {
          await client.query("ROLLBACK");
        } catch {
          /* already rolled back by the server */
        }
      }
    }
  } finally {
    await client.end();
  }

  const skippedNote = skips > 0 ? `, ${skips} skipped` : "";
  console.log(
    failures === 0
      ? `\nALL GREEN (${passes} passed${skippedNote} of ${TESTS.length})`
      : `\n${failures} file(s) FAILED (${passes} passed${skippedNote} of ${TESTS.length})`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
