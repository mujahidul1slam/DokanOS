# Task 8 dry-run report — Enveil Vincent mapping migration

Status: **DRY-RUN ONLY — executed against scratch database `task8_scratch` (production data extracted read-only on 2026-10-31). Production execution is Task 17, user-gated.**

Script: [migrate-enveil-vincent.sql](../../scripts/migrate-enveil-vincent.sql) · Extractor: [task8-extract-prod.mjs](../../scripts/task8-extract-prod.mjs) · Scratch builder: [task8-build-scratch.mjs](../../scripts/task8-build-scratch.mjs) · This audit: [task8-audit.mjs](../../scripts/task8-audit.mjs)

## Mapping applied (spec §7 row mapping)

| Legacy rows (UUIDs in script) | New row |
|---|---|
| Woo `store` + `selling_points` woocommerce + `connectors` channel + product/customer_sources | **1 order source · WooCommerce** per brand (config = URL + API keys copied at runtime) |
| `storefront` + `selling_points` dokanos_storefront | **1 order source · Storefront** per brand |
| `locations` "Main" + `selling_points` showroom_pos | **1 order source · Showroom** per brand (stock-holding ON, ship-from-store ON) |
| `selling_points` facebook | **1 order source · Facebook / Instagram** per brand |
| `locations` "Warehouse" (Vincent) | **1 warehouse** (stock-only) |
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
| customers.total | 3,234 | 3,232 |
| orders.total | 4,073 | 4,073 |
| order_sources.total | 0 | 8 |
| warehouses.total | 0 | 1 |
| user_business_access.total | 9 | 2 |
| order_sources.legacy_mapped | 0 | 8 |
| order_sources.vincent | 0 | 4 |
| order_sources.enveil | 0 | 4 |
| products.attributed | 0 | 225 |
| customers.bound | 2,024 | 2,024 |
| customers.pool | 0 | 1,208 |
| customers.attributed | 0 | 2,024 |
| orders.bound | 3,218 | 3,218 |
| orders.attributed | 0 | 3,315 |
| orders.pool | 0 | 758 |
| orders.unattributed_left | 855 | 0 |
| orders.inferable | 97 | 0 |
| stock.holder_rows | 0 | 205 |
| stock.legacy_location_rows | 205 | 0 |
| wiped_rows_still_present | 5 | 0 |

## Orders per new source (after)

| Source | Type | Orders |
|---|---|---:|
| Enveil Storefront | storefront | 0 |
| Enveil WooCommerce | woocommerce | 657 |
| Facebook / Instagram | facebook | 235 |
| Main Showroom | showroom | 29 |
| Facebook / Instagram | facebook | 549 |
| Main Showroom | showroom | 80 |
| Vincent Storefront | storefront | 0 |
| Vincent WooCommerce | woocommerce | 1,765 |

## Acceptance checks (tasks/todo.md Task 8)

| Check | Evidence | Verdict |
|---|---|---|
| Script runs idempotently against a scratch DB | first run: applied; second run: refused by guard — no double-apply (idempotent); audits identical: true | ✅ |
| 4 order sources + warehouses per brand | Vincent 4 sources + 1 warehouse, Enveil 4 sources + 0 warehouses | ✅ |
| 225 products preserved | 225 → 225, all attributed: 225 | ✅ |
| Customers preserved + merged | bound 2024 (+2 merged, −2 rows) → attributed 2024; total 3234 → 3232 (2 merge rows removed) | ✅ |
| Attributed orders preserved + inferred | bound 3218 + inferred 97 → attributed 3315 (spec snapshot: 3,297 = 3,201 + 96) | ✅ |
| Legacy pool | orders 758 (spec: 753), customers 1208 (spec: 1,200) — drift = new rows since the 2026-10-29 spec snapshot | ✅ |
| Inference rule reproduces the spec's ~96 | 97 orders attributed via customer id/phone match (spec: 96 = 73 Vincent / 23 Enveil) | ✅ |
| Junk + test data wiped | tracked ids still present: 0; AGS→Enveil-store link severed before deletes (step 1 of script) | ✅ |
| Stock repointed, nothing moved | holder rows 205 / legacy-location rows 0 (205 preserved) | ✅ |
| No name-based lookups | static scan of the script: none found (UUID literals only) | ✅ |

## Reconciliation with the spec snapshot (2026-10-29)

The acceptance numbers (225 products / 2,022 customers / 3,297 attributed orders / 753 + 1,200 pool / 96 inferred) were captured at spec time. The live tenant kept trading: the extract holds **3234 customers** (spec: 3,222) and **4073 orders** (spec: 4,050). All +drift rows are new attributed rows and new unattributed counter orders; the mapping rules reproduce the spec's shape exactly (2 merges, ~96 inferences, the rest → pool).

## Review items (Checkpoint C)

1. **Customer merge pairs** — the script merges the two audited phone/alias duplicates into the one brand customer (`c4444444-…` and `c7777777-…` → `c1111111-…`, the April storefront-QA fixture trio; zero orders each, alias rows repointed with de-duplication). One further *strict* duplicate exists in the data: `1a689ee5-…` → `4d0d1b7d-…` via an email-alias match. It is deliberately NOT merged (left in the pool) — say the word and it joins the merge table in the script.
2. **Legacy pool tag** — pool rows are tagged `source = 'legacy migration'` on both orders and customers (customers additionally get `origin_kind = 'legacy'`), matching the spec's backticked tag and Task 15's "tagged `legacy migration`". Trade-off: the pool rows' free-text channel (`pos`/`fb/ig`) is overwritten; it survives nowhere else on orders (they have no provenance column). The tag dies with `orders.source` at Task 16, so Task 15/16 should either drain the pool first or migrate the tag to a surviving column.
3. **Fulfillment defaults on migrated sources** — digital sources draw warehouse-first then the showroom (spec §3 example); showrooms get ship-from-store ON. All editable in the Task 7 UI.

Generated by `node scripts/task8-audit.mjs` on 2026-10-31T05:52:00.695Z.