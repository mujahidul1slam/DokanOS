# Task 8 dry-run report — Enveil Vincent mapping migration

Status: **DRY-RUN ONLY — executed against scratch database `task8_scratch` (production data extracted read-only at 2026-11-01T22:56:39.233Z (.tmp-task8/extract)). Production execution is Task 17, user-gated.**

Script: [migrate-enveil-vincent.sql](../../scripts/migrate-enveil-vincent.sql) · Extractor: [task8-extract-prod.mjs](../../scripts/task8-extract-prod.mjs) · Scratch builder: [task8-build-scratch.mjs](../../scripts/task8-build-scratch.mjs) · This audit: [task8-audit.mjs](../../scripts/task8-audit.mjs)

## Mapping applied (spec §7 row mapping)

| Legacy rows (UUIDs in script) | New row |
|---|---|
| Woo `store` + `selling_points` woocommerce + `connectors` channel + product/customer_sources | **1 order source · WooCommerce** per brand (config = URL + API keys copied at runtime) |
| `storefront` + `selling_points` dokanos_storefront | **1 order source · Storefront** per brand |
| `locations` "Main" + `selling_points` showroom_pos | **1 order source · Showroom** per brand (stock-holding ON, ship-from-store ON) |
| `selling_points` facebook | **1 order source · Facebook / Instagram** per brand |
| `locations` "Warehouse" (Vincent) | **1 warehouse** (stock-only) |
| `pathao_integrations` + courier `connectors` | **business-level courier services** (Task 9) — credentials copied at runtime, paired via `config.integration_id` |
| `product_locations` rows | repointed to their showroom source / warehouse (205 rows stay put) |

Result: **4 order sources + 0–1 warehouses per brand** — 8 sources, 1 warehouse.

## Before → after counts

| Metric | Before | After |
|---|---:|---:|
| businesses.total | 8 | 1 |
| brands.total | 9 | 2 |
| stores.total | 8 | 2 |
| locations.total | 7 | 3 |
| selling_points.total | 24 | 8 |
| storefronts.total | 10 | 2 |
| connectors.total | 5 | 4 |
| products.total | 225 | 225 |
| product_variations.total | 1,204 | 1,204 |
| product_locations.total | 205 | 205 |
| customers.total | 3,249 | 3,247 |
| orders.total | 4,095 | 4,095 |
| order_sources.total | 0 | 8 |
| warehouses.total | 0 | 1 |
| courier_services.total | 0 | 2 |
| user_business_access.total | 9 | 2 |
| order_sources.legacy_mapped | 0 | 8 |
| order_sources.vincent | 0 | 4 |
| order_sources.enveil | 0 | 4 |
| courier_services.legacy_mapped | 0 | 2 |
| products.attributed | 0 | 225 |
| customers.bound | 2,034 | 3,196 |
| customers.pool | 0 | 51 |
| customers.attributed | 2 | 3,196 |
| orders.bound | 3,238 | 3,238 |
| orders.attributed | 0 | 4,047 |
| orders.pool | 0 | 48 |
| orders.unattributed_left | 857 | 0 |
| orders.inferable | 97 | 0 |
| customers.unattributed_with_order_evidence | 1,162 | 0 |
| stock.holder_rows | 0 | 205 |
| stock.legacy_location_rows | 205 | 0 |
| wiped_rows_still_present | 5 | 0 |

## Orders per new source (after)

| Source | Type | Orders |
|---|---|---:|
| Enveil Storefront | storefront | 0 |
| Enveil WooCommerce | woocommerce | 660 |
| Facebook / Instagram | facebook | 243 |
| Main Showroom | showroom | 179 |
| Facebook / Instagram | facebook | 555 |
| Main Showroom | showroom | 638 |
| Vincent Storefront | storefront | 0 |
| Vincent WooCommerce | woocommerce | 1,772 |

## Acceptance checks (tasks/todo.md Task 8)

| Check | Evidence | Verdict |
|---|---|---|
| Script runs idempotently against a scratch DB | first run: applied; second run: refused by guard — no double-apply (idempotent); audits identical: true | ✅ |
| 4 order sources + warehouses per brand | Vincent 4 sources + 1 warehouse, Enveil 4 sources + 0 warehouses | ✅ |
| 225 products preserved | 225 → 225, all attributed: 225 | ✅ |
| Customers preserved + merged | bound 2034 (+2 merged, −2 rows) → attributed 3196; total 3249 → 3247 (2 merge rows removed) | ✅ |
| Pool customers attributed via connected orders (Checkpoint C ruling 2026-11-01) | cohort 1,162 unattributed customers had connected-order brand evidence (order binding + items' products) → migrated to that brand (both brands → first); residual with evidence: 0 | ✅ |
| Attributed orders preserved + inferred | bound 3238 + inferred 809 → attributed 4047 (spec snapshot: 3,297 = 3,201 + 96) | ✅ |
| Legacy pool | orders 48 (spec: 753), customers 51 (spec: 1,200) — drift = new rows since the 2026-10-29 spec snapshot | ✅ |
| Orders follow their customer (id/phone match) | 809 orders attributed (spec snapshot: 96 = 73 Vincent / 23 Enveil; extra = orders of 8b-attributed customers), resolvable-left 0 | ✅ |
| Junk + test data wiped | tracked ids still present: 0; AGS→Enveil-store link severed before deletes (step 1 of script) | ✅ |
| Stock repointed, nothing moved | holder rows 205 / legacy-location rows 0 (205 preserved) | ✅ |
| No name-based lookups | static scan of the script: none found (UUID literals only) | ✅ |
| Courier services mapped (Task 9) | 2 business-level services, 2 with legacy ids mapped (spec: 2 Pathao integrations → services) | ✅ |

## Reconciliation with the spec snapshot (2026-10-29)

The acceptance numbers (225 products / 2,022 customers / 3,297 attributed orders / 753 + 1,200 pool / 96 inferred) were captured at spec time. The live tenant kept trading: the extract holds **3249 customers** (spec: 3,222) and **4095 orders** (spec: 4,050). All +drift rows are new attributed rows and new unattributed counter orders; the mapping rules reproduce the spec's shape (2 merges, ~96 inferences at spec scope, pool customers with connected-order brand evidence attributed per the 2026-11-01 ruling, the rest → pool).

## Review items (Checkpoint C) — verdicts recorded (human sign-off 2026-11-01)

1. **Customer merge pairs** — RESOLVED: the script merges the two audited phone/alias duplicates into the one brand customer (`c4444444-…` and `c7777777-…` → `c1111111-…`, the April storefront-QA fixture trio; zero orders each, alias rows repointed with de-duplication). The further strict email-alias duplicate (`1a689ee5-…` → `4d0d1b7d-…`) **stays in the pool — NOT merged** (email aliases can be distinct people; a later manual merge via the pool UI is possible).
2. **Legacy pool tag / pool customers** — RESOLVED (custom ruling): pool **customers** are auto-migrated to a brand inferred from their connected orders' products (the order's own binding + the store/brand of the products in its items) — script step 8b. Exactly one brand → that brand; products/orders from **both** brands → **the first one** (tie-break: the brand of the customer's earliest connected order). Their still-unattributed orders then follow their customer via the existing step 9 inference. The `source='legacy migration'` tag remains only on the residual pool (rows with no brand evidence) and at Task 16 migrates to a surviving column together with the `business_id` stamp.
3. **Fulfillment defaults on migrated sources** — RESOLVED: defaults accepted (digital sources draw warehouse-first then the showroom; showrooms get ship-from-store ON; all editable in the Task 7 UI).

Generated by `node scripts/task8-audit.mjs` on 2026-11-01T22:58:55.636Z.