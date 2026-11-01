# Task 17 readiness report — read-only preflight (Gate 1 input)

Status: **READ-ONLY. No production write has been performed.** Every query behind this report is
SELECT/WITH-only (or a Management-API GET); no `db push`, no migration apply, no data SQL, no
restore into production. Generated 2026-11-01.

Target: Supabase project `jiwndicvfkiltgageqwv` ("DokanOS", region ap-northeast-1, Postgres 17.6.1.166,
status ACTIVE_HEALTHY). Raw evidence in `.tmp-task8/*-readonly.json` (untracked — contains production
row shapes; never commit).

Repo: branch `integration/accounts-8-15`, HEAD `1104909`.

---

## 1. 🔴 BLOCKER — production has NO backup and NO PITR

The runbook's entire rollback strategy is "restore the pre-migration backup / PITR". **That path does
not currently exist:**

| Check | Result |
|---|---|
| `GET /v1/projects/{ref}/database/backups` | `walg_enabled: true`, **`pitr_enabled: false`**, **`backups: []`**, `physical_backup_data: {}` |
| `supabase backups list --project-ref jiwndicvfkiltgageqwv` | WALG `true`, PITR `false`, **earliest `0`, latest `0`** |
| `GET /v1/projects/{ref}/database/backups/pitr` | 404 |
| Organization plan | **`free`** (`mujahidul1slam's Org`) |

There are **no `DOWN` scripts** in the migration set (confirmed in `tasks/runbook-cutover.md:390-392`),
so with no restorable backup the data migration is **irreversible** as things stand.

### Mitigation prepared and PROVEN (read-only w.r.t. production)

A logical dump was taken and **successfully restored into a throwaway local database**, so a working
rollback artifact now exists:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `.tmp-task8/rollback/prod-schema-public.sql` | 259,063 | `81B220AD90E3E98B7E1158E9B4DF0098A59FD861CBF0EBBC7E6262BF1D554A3A` |
| `.tmp-task8/rollback/prod-data-public.sql` | 19,197,734 | `CF7F8FC744EE1EFD127BCA2A2634955583FB32B7CC1314DD4AF05C0E2DAA07DD` |

Restore rehearsal (`DROP DATABASE task8_restore_check` → restore → verify → drop; local Docker only):

- 67 public tables, 56 public functions, 44 policies restored
- Row counts matched production exactly: businesses 8, brands 9, stores 8, customers 3,246,
  customer_aliases 5,787, orders 4,092, order_items 5,325, products 225, audit_log 8,212,
  courier_shipments 1,732
- 3 benign schema-restore errors, all from extension placement (`pg_trgm` lives in `public` on
  production, so `gin_trgm_ops` resolves as `public.gin_trgm_ops`); data restore was clean

**Caveat:** these dumps live in an untracked scratch directory. Before Gate 2 they should be moved to
durable, access-controlled storage the operator controls (they contain customer PII).

**Alternatives for the user to weigh:**
- (a) proceed with the proven logical dump as the rollback (no cost, fully reversible for the data script)
- (b) upgrade the org to a paid plan to enable PITR first (adds platform-native rollback)
- (c) postpone the cutover

---

## 2. Pending migrations: **28**, not the 19 the plan document states

`tasks/audit/production-migration-plan.md:12-13` says "Ledger head `20261014120000` … 19 files to
apply". Production is still at that head, but the repo has since grown the schema wave plus Tasks
13/15/option-B migrations, so the real pending set is **28 files**:

```
 1. 20261019120000_personal_signup_profile_only.sql
 2. 20261019130000_explicit_account_api_privileges.sql
 3. 20261019131000_fix_member_access_permissions_result.sql
 4. 20261019160000_account_operational_boundaries.sql
 5. 20261019170000_create_business_brand.sql
 6. 20261019180000_create_brand_stores.sql
 7. 20261019190000_business_member_invitations.sql
 8. 20261019200000_business_ownership_transfer.sql
 9. 20261020100000_retire_legacy_combined_setup.sql
10. 20261022120000_signup_config_accessor.sql
11. 20261023100000_signup_service_role_grants.sql
12. 20261024100000_active_business_context.sql
13. 20261026100000_active_business_context_service_role_grants.sql
14. 20261026120000_active_business_context_operational_rls.sql
15. 20261026140000_explicit_api_table_grants.sql
16. 20261026150000_fix_anon_public_surface.sql
17. 20261030090000_repair_audit_drift.sql
18. 20261030180000_profiles_default_business.sql
19. 20261030200000_profile_setup.sql
20. 20261031090000_unified_order_sources.sql
21. 20261031113000_warehouses_stock.sql
22. 20261031140000_courier_services.sql
23. 20261031180000_payment_accounts.sql
24. 20261101090000_role_ladder_rename.sql
25. 20261102090000_business_onboarding.sql          <- Task 13, not in the plan doc
26. 20261102120000_legacy_pool_rls.sql              <- Task 15, not in the plan doc
27. 20261102150000_storefront_brand_scoped_rls.sql  <- Task 15, not in the plan doc
28. 20261103090000_operational_store_provisioning.sql <- option B, not in the plan doc
```

No duplicate version prefixes; no remote-only ledger rows. **Doc drift to fix:** the runbook's
post-batch expectation (`tasks/runbook-cutover.md:411`) is "ledger head `20261101090000`"; after all 28
it becomes **`20261103090000`**.

---

## 3. Conflict scan — the one hit is a false positive (by design)

Static scan of `CREATE TABLE` / `RENAME TO` against the live catalog flagged
`20261031090000_unified_order_sources.sql` as creating `public.order_sources` while it already exists.
Reading the file (`:14`, `:36`) shows this is intended: it **renames the legacy 5-row lookup to
`legacy_order_channels` first**, then creates the new table under the canonical name. No other
CREATE/RENAME collides with an existing relation. Zero unguarded conflicts.

The data script's guard predicate (`scripts/migrate-enveil-vincent.sql:33-39`) reads
`order_sources.legacy_store_id`, which correctly does **not** exist in production yet (0 columns) —
i.e. the guard reads "not applied" exactly as designed, and becomes meaningful only after migration #20.

---

## 4. Production state snapshot (pre-wave)

| Probe | Value |
|---|---|
| Ledger rows / head | 162 / `20261014120000` |
| `is_signup_open()` | **missing** (RPC → 404) — signup broken on production, as documented |
| `app_config` anon direct read | **ALLOWED** (1 row returned with the public anon key) — confirms the apply-order warning: the currently deployed frontend still uses this surface |
| `app_config` grants | anon + authenticated + postgres + service_role each hold 7 privileges (full table surface) |
| anon table grants (to be revoked by #15/#16) | **455** |
| public tables / policies / functions | 67 / 173 / 87 |
| `webhook_events` null-shape rows | **0** (drift repaired) |
| `orders.payment_meta` | already present (1 column) |
| `app_role` enum | `admin`, `staff`, `viewer` — no `owner`/`manager` |
| `user_business_access.role` | all 9 rows `owner` (`role` is TEXT with an owner/admin/member/viewer CHECK) |
| `order_sources` (legacy) | 3 rows, 5 columns (`id,name,is_default,sort_order,created_at`), 4 policies |
| Real tenant `de31fd60-…` | present (1); brands `Vincent` `ca061912-…`, `Enveil` `3eb99fc9-…`, plus junk `safsdfsafsd` `d56f8d28-…` |
| `stores` shape | **no `business_id`** (linked via `brands.woo_store_id`) — matches the script's assumptions |
| Row counts | businesses 8, brands 9, stores 8, customers 3,246, orders 4,092, order_items 5,325, products 225, webhook_events 771 |
| `extensions` | pg_cron, pg_net, pg_stat_statements, **pg_trgm (public)**, pgcrypto, plpgsql, supabase_vault, uuid-ossp |

Column provenance for everything the data script writes is covered by the pending set:
`origin_order_source_id`/`origin_kind` ← #20, `ship_from_store`/`fulfillment_preference`/
`stock_holder_order_source_id`/`warehouse_id` ← #21, `legacy_woo_store_id` ← #28. `business_id` on the
pool is **not** added by any pending migration — the Task 16 checklist item ("pool rows stamped with
`business_id`") therefore has no column to write to yet and needs a decision.

---

## 5. Freshness of the rehearsal

The production extract backing the green 12-check rehearsal is dated **2026-11-01 18:20-18:21**
(`.tmp-task8/extract/_summary.json`: customers 3,246 · orders 4,092 · order_items 5,325), and its
counts still match the live production preflight run minutes ago exactly. Production is currently
static enough that the extract is inside the runbook's ≤24 h window; re-extract in the cutover window
if trading resumes.

---

## 6. Other operational notes

- Deployed frontend `https://dokanos.vercel.app` responds 200; the URL hard-coded in
  `scripts/verify-live-deployment.mjs:16` (`dokanos-732dtm5x4-…`) returns **410 Gone** — that script's
  target is stale. Local branch is **51 commits ahead of `origin/integration/accounts-8-15`**, so the
  branch carrying this work is not pushed.
- ⚠ `supabase db dump --linked --dry-run` prints a **transient CLI login-role password** to stdout. It
  was not stored or reused; avoid capturing that output in logs.
- Both Woo stores reporting `status=error` (`tasks/plan.md` risks table) is pre-existing and does not
  block the migration.

---

## 6.5 Deployed-frontend re-measure (read-only crawl of the live bundle)

The plan's apply-order warning was written against an assumption; the actual deployed artifact was
measured. `https://dokanos.vercel.app/` serves `/assets/index-DSV-o5nx.js` with
`last-modified: Fri, 30 Oct 2026 04:28:06 GMT`. All **89** reachable JS chunks were fetched and
scanned read-only:

- **Zero references to `app_config`** anywhere — and zero to `is_signup_open`/`signup_open`. The
  documented "deployed frontend reads `app_config` directly and will 401 once #15/#16 revoke it"
  risk **does not apply to this build**; the RPC-only path (`2435c1b`) is not in production yet.
- **But the deploy still uses legacy row shapes.** It calls
  `order_sources.select("id, name, is_default").order("sort_order")` (Orders page),
  `select("*").order("sort_order")` and `insert({name, sort_order})` (Settings page). Migration
  **#20 `20261031090000` renames that table** to `legacy_order_channels` and creates the new
  brand-scoped `order_sources` — so those two pages **break from #20 until the new frontend ships**.
  No data is lost (`legacy_order_channels` keeps the rows), but the window must cover both.
- Same class of exposure, smaller: the deploy also reads `locations`, `selling_points`,
  `connectors`, `product_sources`, `customer_sources`, `pathao_store_links`, `user_store_access`,
  `invitations` (the StoresHub / Integrations / Team pages that Tasks 11–12 retire or replace).
- Deploy mechanics: the repo has **no `.vercel/` link** and the branch is **51 commits ahead of
  `origin/integration/accounts-8-15`** (nothing pushed). The new build therefore reaches production
  only after those commits are pushed (or a manual `vercel --prod` deploy) — an outbound action that
  has **not** been taken and needs the user's say-so.

**Consequence for sequencing:** `chain → frontend deploy → smoke → lift freeze`, with the read-only
freeze spanning the whole stretch.

---

## Gate 1 decision — APPROVED 2026-11-01

Nothing has been written to production. The user answered both Gate 1 questions:

1. **Rollback basis → accept the proven logical dump.** Dumps were copied to durable storage and
   checksum-verified: `C:\Users\mujah\dokan-prod-backups\20261101-pre-cutover\`
   (`prod-schema-public.sql` 259,063 bytes sha256 `81B220AD…54A3A`; `prod-data-public.sql`
   19,197,734 bytes sha256 `CF7F8FC7…A07DD`). A fresh dump is to be taken immediately before the
   data script (Gate 2) and its time + checksums recorded as the recovery point.
2. **Scope → approve all 28 migrations**, and fix the stale 19-file plan doc + the runbook's
   expected ledger head. Both doc corrections are done in this change set.

Gates still ahead: **Gate 2** (immediate go-ahead before `scripts/migrate-enveil-vincent.sql`) and
**Gate 3** (sign-off of `tasks/audit/task17-live-audit-report.md` before enabling the new UI).
