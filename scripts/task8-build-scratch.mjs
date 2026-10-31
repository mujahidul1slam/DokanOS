#!/usr/bin/env node
/**
 * Task 8 (spec §7) — build the SCRATCH database for the migration dry-run:
 * a fresh local database with the full repo schema and the production data
 * loaded from the read-only extract (.tmp-task8/extract/).
 *
 * Local-only: refuses any non-local database. Nothing here ever talks to
 * production — the extract step (scripts/task8-extract-prod.mjs) is read-only
 * and separate.
 *
 * Usage: node scripts/task8-build-scratch.mjs [extractDir]
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import pg from "pg";

const SCRATCH_DB = "task8_scratch";
const extractDir = path.resolve(process.argv[2] ?? ".tmp-task8/extract");

const config = JSON.parse(
  execSync("supabase status --output json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
);
const adminUrl = new URL(config.DB_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname)) {
  console.error(`Refusing non-local database: ${adminUrl.hostname}`);
  process.exit(1);
}

const container = execSync(
  `docker ps --filter "name=supabase_db_" --format "{{.Names}}"`,
  { encoding: "utf8" },
).trim().split("\n")[0];
if (!container) {
  console.error("No local supabase_db_* container found — is `supabase start` running?");
  process.exit(1);
}

/** SQL literal for a JSON value (extract rows are plain JSON). */
function lit(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

// FK-safe load order. auth.users rows use the RLS-harness insert shape
// (run-rls-tests.mjs) — user_business_access.user_id references them.
const LOAD_ORDER = [
  "businesses",
  "stores",
  "brands",
  "locations",
  "storefronts",
  "storefront_pages",
  "selling_points",
  "connectors",
  "product_sources",
  "customer_sources",
  "products",
  "product_variations",
  "product_locations",
  "customers",
  "customer_aliases",
  "pathao_integrations",
  "courier_providers",
  "orders",
  "user_business_access",
];

/** auth.users needs GoTrue's required shape; passwords are never exercised. */
async function loadAuthUsers(db, rows) {
  for (const row of rows) {
    await db.query(
      `INSERT INTO auth.users
         (id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, 'authenticated', 'authenticated', $2,
          'scratch-fixture-password-never-used-for-login', now(),
          '{"provider":"email","providers":["email"]}'::jsonb, $3::jsonb, $4, now())
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.email, JSON.stringify(row.raw_user_meta_data ?? {}), row.created_at ?? new Date().toISOString()],
    );
  }
  return rows.length;
}

async function loadTable(db, name, rows) {
  if (rows.length === 0) return 0;
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch
      .map((r) => `(${columns.map((c) => lit(r[c])).join(", ")})`)
      .join(",\n");
    await db.query(`INSERT INTO public.${name} (${columns.join(", ")}) VALUES ${values}`);
  }
  return rows.length;
}

async function main() {
  // 1. fresh scratch database
  const admin = new pg.Client({ connectionString: config.DB_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  await admin.end();

  // 2. full repo schema (schemas+DDL only) from the locally migrated stack
  const schemaFile = ".tmp-task8/schema.sql";
  execSync(
    `docker exec ${container} pg_dump -U postgres --schema-only --no-owner --no-privileges postgres > ${schemaFile}`,
    { shell: true },
  );
  execSync(
    `Get-Content -Raw ${schemaFile} | docker exec -i ${container} psql -U postgres -d ${SCRATCH_DB} -v ON_ERROR_STOP=0 -q`,
    { shell: "powershell" },
  );

  // 3. production data
  const scratchUrl = new URL(config.DB_URL);
  scratchUrl.pathname = `/${SCRATCH_DB}`;
  const db = new pg.Client({ connectionString: scratchUrl.href });
  await db.connect();

  const required = ["businesses", "brands", "stores", "selling_points", "orders", "customers", "order_sources", "warehouses"];
  for (const table of required) {
    const { rows } = await db.query(`SELECT to_regclass('public.${table}') AS t`);
    if (!rows[0].t) {
      console.error(`Scratch schema is missing public.${table} — check ${schemaFile} for restore errors.`);
      process.exit(1);
    }
  }

  for (const name of LOAD_ORDER) {
    const file = path.join(extractDir, `${name}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`${name}: no extract file — skipped`);
      continue;
    }
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    const n = await loadTable(db, name, rows);
    console.log(`${name}: loaded ${n} rows`);
    if (name === "orders") {
      // auth.users before user_business_access (the FK lives on user_id)
      const authFile = path.join(extractDir, "auth_users.json");
      const authRows = fs.existsSync(authFile) ? JSON.parse(fs.readFileSync(authFile, "utf8")) : [];
      console.log(`auth_users: loaded ${await loadAuthUsers(db, authRows)} rows`);
    }
  }

  // sanity: the audited production counts must be visible in scratch
  for (const [label, sql] of [
    ["products", "SELECT count(*)::int AS n FROM public.products"],
    ["customers", "SELECT count(*)::int AS n FROM public.customers"],
    ["orders", "SELECT count(*)::int AS n FROM public.orders"],
    ["product_locations", "SELECT count(*)::int AS n FROM public.product_locations"],
  ]) {
    const { rows } = await db.query(sql);
    console.log(`sanity ${label}: ${rows[0].n}`);
  }
  await db.end();
  console.log(`\nScratch database "${SCRATCH_DB}" is ready.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
