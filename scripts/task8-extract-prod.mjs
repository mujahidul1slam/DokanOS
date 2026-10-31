#!/usr/bin/env node
/**
 * Task 8 (spec §7) — STRICTLY READ-ONLY extraction of the production inventory
 * needed to author the Enveil Vincent mapping migration by UUID.
 *
 * It runs SELECT-only SQL through the Supabase Management API /database/query
 * and writes one JSON file per table into an output directory (default
 * `.tmp-task8/extract/`, which stays untracked — production data contains
 * customer PII and must never be committed).
 *
 * Credentials (never printed): SUPABASE_ACCESS_TOKEN env var or
 * `~/.supabase/access-token-extracted`; project id from SUPABASE_PROJECT_ID env
 * var or `VITE_SUPABASE_PROJECT_ID` in `.env`.
 *
 * Usage: node scripts/task8-extract-prod.mjs [outputDir]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const outDir = path.resolve(process.argv[2] ?? ".tmp-task8/extract");

function readEnvFile() {
  try {
    return fs.readFileSync(path.join(root, ".env"), "utf8");
  } catch {
    return "";
  }
}

const envText = readEnvFile();
const envGet = (key) => {
  const m = envText.match(new RegExp("^" + key + "\\s*=\\s*(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};

const TOKEN = (
  process.env.SUPABASE_ACCESS_TOKEN ??
  (fs.existsSync(path.join(os.homedir(), ".supabase", "access-token-extracted"))
    ? fs.readFileSync(path.join(os.homedir(), ".supabase", "access-token-extracted"), "utf8").trim()
    : null)
);
const PROJECT = process.env.SUPABASE_PROJECT_ID ?? envGet("VITE_SUPABASE_PROJECT_ID");

if (!TOKEN) {
  console.error("No Supabase access token (SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token-extracted).");
  process.exit(1);
}
if (!PROJECT) {
  console.error("No project id (SUPABASE_PROJECT_ID or VITE_SUPABASE_PROJECT_ID in .env).");
  process.exit(1);
}

/** Run one read-only statement; refuses anything that is not SELECT/WITH. */
async function query(sql) {
  const statement = sql.trim();
  if (!/^(select|with)\b/i.test(statement)) {
    throw new Error(`Refusing non-read-only statement: ${statement.slice(0, 60)}`);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: statement }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`query failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Tables the mapping migration and its audit read or write (spec §7).
// `orders` and `customers` are batched: they are the big ones.
const TABLES = {
  businesses: "select * from public.businesses order by created_at",
  user_business_access: "select * from public.user_business_access order by business_id, user_id",
  auth_users: "select id, email, created_at, raw_user_meta_data from auth.users order by created_at",
  brands: "select * from public.brands order by created_at",
  stores: "select * from public.stores order by created_at",
  locations: "select * from public.locations order by created_at",
  selling_points: "select * from public.selling_points order by created_at",
  brand_stores: "select * from public.brand_stores order by created_at",
  storefronts: "select * from public.storefronts order by created_at",
  storefront_pages: "select * from public.storefront_pages order by created_at",
  connectors: "select * from public.connectors order by created_at",
  product_sources: "select * from public.product_sources order by created_at",
  customer_sources: "select * from public.customer_sources order by created_at",
  products: "select * from public.products order by created_at",
  product_variations: "select * from public.product_variations order by created_at",
  product_locations: "select * from public.product_locations order by created_at",
  customer_aliases: "select * from public.customer_aliases order by created_at",
  pathao_integrations: "select * from public.pathao_integrations order by created_at",
};

const BATCHED = {
  customers: { table: "public.customers", order: "created_at, id" },
  orders: { table: "public.orders", order: "created_at, id" },
};
const BATCH_SIZE = 1000;

async function extractBatched(name, { table, order }) {
  const rows = [];
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const batch = await query(`select * from ${table} order by ${order} limit ${BATCH_SIZE} offset ${offset}`);
    rows.push(...batch);
    console.log(`  ${name}: ${rows.length} rows…`);
    if (batch.length < BATCH_SIZE) return rows;
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const summary = {};
  for (const [name, sql] of Object.entries(TABLES)) {
    let rows;
    try {
      rows = await query(sql);
    } catch (err) {
      // Production runs an older schema (the catch-up batch is still pending),
      // so tables like brand_stores legitimately do not exist there yet.
      console.warn(`${name}: SKIPPED (${err.message.slice(0, 80)})`);
      summary[name] = "missing";
      continue;
    }
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(rows, null, 1));
    summary[name] = rows.length;
    console.log(`${name}: ${rows.length} rows`);
  }
  for (const [name, spec] of Object.entries(BATCHED)) {
    let rows;
    try {
      rows = await extractBatched(name, spec);
    } catch (err) {
      console.warn(`${name}: SKIPPED (${err.message.slice(0, 80)})`);
      summary[name] = "missing";
      continue;
    }
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(rows, null, 1));
    summary[name] = rows.length;
  }
  fs.writeFileSync(path.join(outDir, "_summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nExtract written to ${outDir}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
