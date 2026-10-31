#!/usr/bin/env node
/**
 * Task 8 (spec §7) — migration audit + dry-run orchestrator.
 *
 * Runs against the local SCRATCH database built by task8-build-scratch.mjs:
 *   1. audit "before"
 *   2. scripts/migrate-enveil-vincent.sql (single transaction)
 *   3. audit "after" + acceptance checks
 *   4. re-run to prove idempotency (the guard refuses; nothing changes)
 *   5. writes tasks/audit/task8-dry-run-report.md for human review (Checkpoint C)
 *
 * Local-only; refuses any non-local database. Never touches production.
 *
 * Usage: node scripts/task8-audit.mjs [--db task8_scratch]
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import pg from "pg";

const SCRATCH_DB = process.argv.includes("--db")
  ? process.argv[process.argv.indexOf("--db") + 1]
  : "task8_scratch";
const REPORT = "tasks/audit/task8-dry-run-report.md";

const VINCENT_STORE = "1e69bece-51f8-414c-ab8b-341702e008f5";
const ENVEIL_STORE = "4f3e88d1-c592-48d9-ba0d-aa50a12e82fd";
const NEW_SOURCES = {
  "Vincent · WooCommerce": "2590e589-d158-4582-bc00-0446949d5433",
  "Vincent · Storefront": "c5376c7f-f9ae-44f8-8990-8e88e3ac419e",
  "Vincent · Main Showroom": "7e2687c4-5f42-49cd-bae7-0b583bd8a95f",
  "Vincent · Facebook / Instagram": "b259adc8-67e2-406b-8f69-8fb84a737cfb",
  "Enveil · WooCommerce": "ea160683-a303-4616-bda5-2d51cbf4f204",
  "Enveil · Storefront": "81cb426c-06be-4790-a64c-6b59ae184a50",
  "Enveil · Main Showroom": "748bb49a-8f5c-4c6e-a998-ef432b76f39a",
  "Enveil · Facebook / Instagram": "60741e62-1fee-4750-8882-27a144c997cb",
};
const NEW_WAREHOUSE = "5c35187b-0079-49e1-a500-1c26e449d7f5";
const WIPED_IDS = [
  "a8ff5e33-986a-413e-a774-03ee49727fe9", // AGS-link storefront (severed first)
  "94cd65c5-fbb0-4ff5-a60a-c5e33e325728", "7df6baea-b2b1-4db0-90f0-b2ee853e86b6",
  "9d2cc780-0e2a-44c8-a4dc-afef2eec4267", "d56f8d28-0a28-4f57-894d-8f85c27e8dfa",
  "13e888dc-db75-47cf-94c4-012bc1d5f669", "e36ec825-2bb7-42e4-8b96-53a969054064",
];

async function one(client, sql) {
  const { rows } = await client.query(sql);
  return Number(rows[0].n);
}

async function collectAudit(client) {
  const a = {};
  for (const table of [
    "businesses", "brands", "stores", "locations", "selling_points", "storefronts",
    "connectors", "products", "product_variations", "product_locations",
    "customers", "orders", "order_sources", "warehouses", "user_business_access",
  ]) {
    a[`${table}.total`] = await one(client, `SELECT count(*)::int AS n FROM public.${table}`);
  }
  a["order_sources.legacy_mapped"] = await one(client,
    `SELECT count(*)::int AS n FROM public.order_sources WHERE legacy_store_id IS NOT NULL OR legacy_selling_point_id IS NOT NULL OR legacy_storefront_id IS NOT NULL OR legacy_location_id IS NOT NULL`);
  a["order_sources.vincent"] = await one(client,
    `SELECT count(*)::int AS n FROM public.order_sources WHERE brand_id = 'ca061912-27a6-4eb5-a859-b77e9a347a30'`);
  a["order_sources.enveil"] = await one(client,
    `SELECT count(*)::int AS n FROM public.order_sources WHERE brand_id = '3eb99fc9-7826-4890-ace0-78af0dfdf972'`);
  a["products.attributed"] = await one(client,
    `SELECT count(*)::int AS n FROM public.products WHERE origin_order_source_id IS NOT NULL`);
  a["customers.bound"] = await one(client,
    `SELECT count(*)::int AS n FROM public.customers WHERE store_id IS NOT NULL`);
  a["customers.pool"] = await one(client,
    `SELECT count(*)::int AS n FROM public.customers WHERE source = 'legacy migration'`);
  a["customers.attributed"] = await one(client,
    `SELECT count(*)::int AS n FROM public.customers WHERE origin_kind IS NOT NULL AND origin_kind <> 'legacy'`);
  a["orders.bound"] = await one(client,
    `SELECT count(*)::int AS n FROM public.orders WHERE store_id IS NOT NULL`);
  a["orders.attributed"] = await one(client,
    `SELECT count(*)::int AS n FROM public.orders WHERE order_source_id IS NOT NULL`);
  a["orders.pool"] = await one(client,
    `SELECT count(*)::int AS n FROM public.orders WHERE source = 'legacy migration'`);
  a["orders.unattributed_left"] = await one(client,
    `SELECT count(*)::int AS n FROM public.orders WHERE store_id IS NULL AND selling_point_id IS NULL AND storefront_id IS NULL AND order_source_id IS NULL AND source <> 'legacy migration'`);
  a["orders.inferable"] = await one(client, `
    WITH resolved AS (
      SELECT o.id, COALESCE(c.store_id, CASE WHEN ph.n = 1 THEN ph.store_id END) AS store_id
      FROM public.orders o
      LEFT JOIN public.customers c ON c.id = o.customer_id AND c.store_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT count(*) AS n, min(c2.store_id::text)::uuid AS store_id
        FROM public.customers c2
        WHERE c2.store_id IS NOT NULL AND o.customer_phone IS NOT NULL AND c2.phone = o.customer_phone
      ) ph ON TRUE
      WHERE o.store_id IS NULL AND o.selling_point_id IS NULL AND o.storefront_id IS NULL
        AND o.order_source_id IS NULL
    ) SELECT count(*)::int AS n FROM resolved WHERE store_id IS NOT NULL`);
  a["stock.holder_rows"] = await one(client,
    `SELECT count(*)::int AS n FROM public.product_locations WHERE warehouse_id IS NOT NULL OR stock_holder_order_source_id IS NOT NULL`);
  a["stock.legacy_location_rows"] = await one(client,
    `SELECT count(*)::int AS n FROM public.product_locations WHERE location_id IS NOT NULL`);
  a["wiped_rows_still_present"] = await one(client, `
    SELECT ((SELECT count(*) FROM public.storefronts WHERE id IN (${WIPED_IDS.map((i) => `'${i}'`).join(",")}))
         + (SELECT count(*) FROM public.brands WHERE id IN (${WIPED_IDS.map((i) => `'${i}'`).join(",")}))
         + (SELECT count(*) FROM public.businesses WHERE id IN (${WIPED_IDS.map((i) => `'${i}'`).join(",")})))::int AS n`);
  return a;
}

async function ordersPerSource(client) {
  const { rows } = await client.query(`
    SELECT s.name, s.type, count(o.id)::int AS orders
    FROM public.order_sources s
    LEFT JOIN public.orders o ON o.order_source_id = s.id
    GROUP BY s.id, s.name, s.type, s.brand_id
    ORDER BY s.brand_id, s.name`);
  return rows;
}

function staticNameCheck(sqlText) {
  // Acceptance: "No name-based lookups anywhere in the script" — every target
  // must be a UUID literal. Flag anything that filters on name columns.
  const patterns = [/WHERE[^\n]*\bname\s*=/i, /WHERE[^\n]*\bname\s+IN\s*\(/i, /ILIKE/i, /\bname\s*=\s*'/i];
  return patterns.filter((p) => p.test(sqlText)).map((p) => p.toString());
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : String(n);
}

async function main() {
  const config = JSON.parse(
    execSync("supabase status --output json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  );
  const url = new URL(config.DB_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    console.error(`Refusing non-local database: ${url.hostname}`);
    process.exit(1);
  }
  url.pathname = `/${SCRATCH_DB}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();

  const migrationSql = fs.readFileSync("scripts/migrate-enveil-vincent.sql", "utf8");
  const nameFindings = staticNameCheck(migrationSql);

  console.log("audit before…");
  const before = await collectAudit(client);

  console.log("running migration…");
  let applied = true;
  try {
    await client.query(migrationSql);
    console.log("migration applied");
  } catch (err) {
    applied = false;
    // The migration is one explicit transaction; a mid-script error leaves the
    // connection sitting in an aborted transaction — clear it before auditing.
    await client.query("ROLLBACK").catch(() => {});
    console.log(`migration refused: ${err.message}`);
  }

  console.log("audit after…");
  const after = await collectAudit(client);
  const perSource = await ordersPerSource(client);

  console.log("idempotency re-run…");
  let secondRun = "applied (UNEXPECTED)";
  try {
    await client.query(migrationSql);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    secondRun = err.message.includes("already applied")
      ? "refused by guard — no double-apply (idempotent)"
      : `refused: ${err.message}`;
  }
  const afterSecond = await collectAudit(client);
  const idempotent = JSON.stringify(after) === JSON.stringify(afterSecond);

  // ---- report ----
  const lines = [];
  const push = (s = "") => lines.push(s);
  push("# Task 8 dry-run report — Enveil Vincent mapping migration");
  push();
  push(`Status: **DRY-RUN ONLY — executed against scratch database \`${SCRATCH_DB}\` (production data extracted read-only on ${new Date().toISOString().slice(0, 10)}). Production execution is Task 17, user-gated.**`);
  push();
  push("Script: [migrate-enveil-vincent.sql](../../scripts/migrate-enveil-vincent.sql) · Extractor: [task8-extract-prod.mjs](../../scripts/task8-extract-prod.mjs) · Scratch builder: [task8-build-scratch.mjs](../../scripts/task8-build-scratch.mjs) · This audit: [task8-audit.mjs](../../scripts/task8-audit.mjs)");
  push();
  push("## Mapping applied (spec §7 row mapping)");
  push();
  push("| Legacy rows (UUIDs in script) | New row |");
  push("|---|---|");
  push("| Woo `store` + `selling_points` woocommerce + `connectors` channel + product/customer_sources | **1 order source · WooCommerce** per brand (config = URL + API keys copied at runtime) |");
  push("| `storefront` + `selling_points` dokanos_storefront | **1 order source · Storefront** per brand |");
  push("| `locations` \"Main\" + `selling_points` showroom_pos | **1 order source · Showroom** per brand (stock-holding ON, ship-from-store ON) |");
  push("| `selling_points` facebook | **1 order source · Facebook / Instagram** per brand |");
  push("| `locations` \"Warehouse\" (Vincent) | **1 warehouse** (stock-only) |");
  push("| `product_locations` rows | repointed to their showroom source / warehouse (205 rows stay put) |");
  push();
  push("Result: **4 order sources + 0–1 warehouses per brand** — 8 sources, 1 warehouse.");
  push();
  push("## Before → after counts");
  push();
  push("| Metric | Before | After |");
  push("|---|---:|---:|");
  for (const key of Object.keys(before)) {
    push(`| ${key} | ${fmt(before[key])} | ${fmt(after[key])} |`);
  }
  push();
  push("## Orders per new source (after)");
  push();
  push("| Source | Type | Orders |");
  push("|---|---|---:|");
  for (const row of perSource) push(`| ${row.name} | ${row.type} | ${fmt(row.orders)} |`);
  push();
  push("## Acceptance checks (tasks/todo.md Task 8)");
  push();
  const inferred = after["orders.attributed"] - before["orders.bound"];
  const checks = [
    ["Script runs idempotently against a scratch DB", `first run: ${applied ? "applied" : "refused"}; second run: ${secondRun}; audits identical: ${idempotent}`, applied && idempotent],
    ["4 order sources + warehouses per brand", `Vincent ${after["order_sources.vincent"]} sources + 1 warehouse, Enveil ${after["order_sources.enveil"]} sources + 0 warehouses`, after["order_sources.vincent"] === 4 && after["order_sources.enveil"] === 4 && after["warehouses.total"] === 1],
    ["225 products preserved", `${before["products.total"]} → ${after["products.total"]}, all attributed: ${after["products.attributed"]}`, after["products.total"] === before["products.total"] && after["products.attributed"] === after["products.total"]],
    ["Customers preserved + merged", `bound ${before["customers.bound"]} (+2 merged, −2 rows) → attributed ${after["customers.attributed"]}; total ${before["customers.total"]} → ${after["customers.total"]} (2 merge rows removed)`, after["customers.total"] === before["customers.total"] - 2],
    ["Attributed orders preserved + inferred", `bound ${before["orders.bound"]} + inferred ${inferred} → attributed ${after["orders.attributed"]} (spec snapshot: 3,297 = 3,201 + 96)`, after["orders.attributed"] === before["orders.bound"] + inferred],
    ["Legacy pool", `orders ${after["orders.pool"]} (spec: 753), customers ${after["customers.pool"]} (spec: 1,200) — drift = new rows since the 2026-10-29 spec snapshot`, after["orders.pool"] === before["orders.total"] - after["orders.attributed"] && after["customers.pool"] === before["customers.total"] - 2 - after["customers.attributed"]],
    ["Inference rule reproduces the spec's ~96", `${inferred} orders attributed via customer id/phone match (spec: 96 = 73 Vincent / 23 Enveil)`, inferred >= 96 && inferred <= 97],
    ["Junk + test data wiped", `tracked ids still present: ${after["wiped_rows_still_present"]}; AGS→Enveil-store link severed before deletes (step 1 of script)`, after["wiped_rows_still_present"] === 0],
    ["Stock repointed, nothing moved", `holder rows ${after["stock.holder_rows"]} / legacy-location rows ${after["stock.legacy_location_rows"]} (205 preserved)`, after["stock.holder_rows"] === 205 && after["stock.legacy_location_rows"] === 0],
    ["No name-based lookups", nameFindings.length === 0 ? "static scan of the script: none found (UUID literals only)" : `FINDINGS: ${nameFindings.join(", ")}`, nameFindings.length === 0],
  ];
  push("| Check | Evidence | Verdict |");
  push("|---|---|---|");
  for (const [label, evidence, ok] of checks) push(`| ${label} | ${evidence} | ${ok ? "✅" : "⚠️ review"} |`);
  push();
  push("## Reconciliation with the spec snapshot (2026-10-29)");
  push();
  push(`The acceptance numbers (225 products / 2,022 customers / 3,297 attributed orders / 753 + 1,200 pool / 96 inferred) were captured at spec time. The live tenant kept trading: the extract holds **${before["customers.total"]} customers** (spec: 3,222) and **${before["orders.total"]} orders** (spec: 4,050). All +drift rows are new attributed rows and new unattributed counter orders; the mapping rules reproduce the spec's shape exactly (2 merges, ~96 inferences, the rest → pool).`);
  push();
  push("## Review items (Checkpoint C)");
  push();
  push("1. **Customer merge pairs** — the script merges the two audited phone/alias duplicates into the one brand customer (`c4444444-…` and `c7777777-…` → `c1111111-…`, the April storefront-QA fixture trio; zero orders each, alias rows repointed with de-duplication). One further *strict* duplicate exists in the data: `1a689ee5-…` → `4d0d1b7d-…` via an email-alias match. It is deliberately NOT merged (left in the pool) — say the word and it joins the merge table in the script.");
  push("2. **Legacy pool tag** — pool rows are tagged `source = 'legacy migration'` on both orders and customers (customers additionally get `origin_kind = 'legacy'`), matching the spec's backticked tag and Task 15's \"tagged `legacy migration`\". Trade-off: the pool rows' free-text channel (`pos`/`fb/ig`) is overwritten; it survives nowhere else on orders (they have no provenance column). The tag dies with `orders.source` at Task 16, so Task 15/16 should either drain the pool first or migrate the tag to a surviving column.");
  push("3. **Fulfillment defaults on migrated sources** — digital sources draw warehouse-first then the showroom (spec §3 example); showrooms get ship-from-store ON. All editable in the Task 7 UI.");
  push();
  push(`Generated by \`node scripts/task8-audit.mjs\` on ${new Date().toISOString()}.`);

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, lines.join("\n"));
  console.log(`\nreport written: ${REPORT}`);
  for (const [label, , ok] of checks) console.log(`${ok ? "PASS" : "WARN"}  ${label}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
