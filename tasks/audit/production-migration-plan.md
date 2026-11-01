# Production migration plan — 28 pending migrations (catch-up batch + schema wave + integration)

Status: **Gate 1 APPROVED 2026-11-01 — 28 files, not applied yet.** All findings below come from a
read-only audit (2026-10-30) comparing production schema identifiers against a fresh local
build of the full migration chain, re-verified read-only on 2026-11-01
([task17-readiness-report.md](task17-readiness-report.md)). Raw data:
[prod-vs-repo.json](prod-vs-repo.json).

> **Scope correction (2026-11-01).** This document was written for the 19-file catch-up batch.
> The repo has since grown the domain-revamp schema wave plus the Tasks 13/15/option-B work, so the
> genuinely-pending set is **28 files** (rows 20–28 below). The user approved all 28 at Gate 1.

Target: Supabase project `jiwndicvfkiltgageqwv` — the real database, tenant **Enveil Vincent**
(brands Vincent + Enveil). Never run `supabase db reset --linked` (it wipes data).

## Where production stands

- Ledger head `20261014120000` (162 of 190 repo migrations applied at the 2026-11-01 re-check) →
  the 16 pending, the drift repair, and the two Phase-1 migrations = the **19-file catch-up batch**;
  plus the **5-file schema wave** (Tasks 4/5/9/10/12) and the **4 integration migrations**
  (Tasks 13/15 ×2, option B) = **28 files to apply** in filename order.
- **Signup on production is currently broken**: `is_signup_open()` does not exist there
  (verified `PGRST202`), and the frontend since commit `2435c1b` calls exactly that RPC and
  fails closed ("Unable to check sign-up availability"). Migration #10 below fixes it.

## The batch (apply in filename order)

| # | migration | adds | risk |
|---|---|---|---|
| 1 | 20261019120000_personal_signup_profile_only | `handle_new_user` rewrite (profile-only signup) | low |
| 2 | 20261019130000_explicit_account_api_privileges | function grants | low |
| 3 | 20261019131000_fix_member_access_permissions_result | RLS/function fix | low |
| 4 | 20261019160000_account_operational_boundaries | RLS policy rewrite (drops old policies) | med |
| 5 | 20261019170000_create_business_brand | `create_business_brand` RPC | low |
| 6 | 20261019180000_create_brand_stores | **new table** `brand_stores` + RPC + trigger | low |
| 7 | 20261019190000_business_member_invitations | **new table** `business_invitations` + invite/accept RPCs | med |
| 8 | 20261019200000_business_ownership_transfer | transfer/leave RPCs | med |
| 9 | 20261020100000_retire_legacy_combined_setup | revokes `create_my_brand_store` | low |
| 10 | 20261022120000_signup_config_accessor | `is_signup_open()` + grants — **restores signup** | low |
| 11 | 20261023100000_signup_service_role_grants | service-role grants | low |
| 12 | 20261024100000_active_business_context | **new table** `active_business_context` + RPCs | low |
| 13 | 20261026100000_active_business_context_service_role_grants | grants | low |
| 14 | 20261026120000_active_business_context_operational_rls | RLS | low |
| 15 | 20261026140000_explicit_api_table_grants | grants only — **grant-only, no REVOKE** (the "−459" claim was wrong; measured +252/−0 after the whole chain) | **attention** |
| 16 | 20261026150000_fix_anon_public_surface | splits the storefronts SELECT policy + grants `invoice_settings` columns to anon — **no anon revoke either** | **attention** |
| 17 | 20261030090000_repair_audit_drift *(new)* | `orders.payment_meta` + `webhook_events` convergence | low |
| 18 | 20261030180000_profiles_default_business *(new, Task 2)* | `profiles.default_business_id` + index | low |
| 19 | 20261030200000_profile_setup *(new, Task 3)* | `profiles.phone`, `profiles.profile_setup_completed_at` + backfill | low |
| 20 | 20261031090000_unified_order_sources *(Task 4)* | **renames** legacy `order_sources` → `legacy_order_channels`, creates new `order_sources` (+`order_source_type`) | high |
| 21 | 20261031113000_warehouses_stock *(Task 5)* | `warehouses` + stock-holder columns on `product_locations` | med |
| 22 | 20261031140000_courier_services *(Task 9)* | `courier_services` (+`courier_providers` registry) | med |
| 23 | 20261031180000_payment_accounts *(Task 9)* | `payment_accounts` (+`payment_providers`) | low |
| 24 | 20261101090000_role_ladder_rename *(Task 12)* | role ladder owner/admin/member/viewer → Owner/Admin/Manager/Staff | med |
| 25 | 20261102090000_business_onboarding *(Task 13)* | `businesses.onboarding_completed_at`, `business_onboarding_steps`, `joined_via` | low |
| 26 | 20261102120000_legacy_pool_rls *(Task 15)* | pool RLS policies | low |
| 27 | 20261102150000_storefront_brand_scoped_rls *(Task 15)* | storefront brand-scoped RLS | med |
| 28 | 20261103090000_operational_store_provisioning *(option B)* | `order_sources.legacy_woo_store_id` + stores insert policy | low |

> Rows 20–28 are the post-audit additions. #20 is the one that reshapes a live table the deployed
> frontend still reads by its old column set — see the apply-order warning below.

## Safety analysis

- **No top-level data writes in #1–16.** Every `INSERT/UPDATE/DELETE` in those files sits
  inside function bodies (RPC runtime logic); apply-time is DDL + grants only. Verified by scan.
- Expected schema delta (from the fresh-build diff): +3 tables, +29 columns, +17 functions,
  +1 trigger, policies +67/−58, table grants +19/−459, routine grants +20/−84. The large
  negative sides are the old broad grant/policy surface that #4/#15/#16 deliberately remove.
  ⚠ **Corrected 2026-11-01 after the actual apply:** the measured production diff was
  **table grants +252 / −0**. #15 and #16 contain only `GRANT` statements; the sole table-level
  anon revoke in the whole history is the older `20260620172022:4 REVOKE SELECT ON public.products
  FROM anon;`. The `−459` figure came from the fresh-build diff (where default grants never existed)
  and does not describe production. Consequently the anon surface did **not** shrink: anon keeps
  ALL on every default-granted table, the `products.cost_price` carve-out is unenforced, and nine
  public tables have RLS disabled — see §8 of `task17-readiness-report.md`.
- **Drift found (pre-existing, not caused by the batch):**
  - `orders.payment_meta` (jsonb, nullable) exists only on production — added out of band;
    no migration creates it, yet the checkout RPCs INSERT it. Fresh builds break at checkout
    runtime. **Fixed by #17** (`ADD COLUMN IF NOT EXISTS`, exact live definition).
  - `webhook_events.created_at/status_code/topic`: nullable on production (0 NULLs in 885
    rows, audited 2026-10-30) vs NOT NULL in the chain — the live table predates the
    migration that defines it and the `IF NOT EXISTS` repair no-op'd. **Converged by #17**
    (guarded backfill + SET DEFAULT + SET NOT NULL).
- **#19 has one deliberate top-level data write**: it stamps `profile_setup_completed_at`
  on every existing profile so nobody is pushed through the new setup step; only accounts
  created afterwards owe it. This is the only non-DDL statement in the batch.
  - Nothing else: no production-only tables; all remaining diff sides come from the batch itself.

## Apply-order warning (frontend)

Measured against the **actual deployed bundle** on 2026-11-01 (`https://dokanos.vercel.app`,
`/assets/index-DSV-o5nx.js`, `last-modified: Fri, 30 Oct 2026 04:28:06 GMT`): all 89 reachable
chunks were crawled read-only. The deploy **contains zero references to `app_config`** — the old
"deployed frontend reads `app_config` directly and will 401" concern does **not** apply to this
build; nothing in it calls `app_config` or `is_signup_open` at all. (The `is_signup_open` RPC path
was added in commit `2435c1b`, which is **not** in this deploy — so signup in the deployed UI does
not depend on #10 landing.)

What *does* matter for apply order:

- **The deploy still queries legacy row shapes.** With `20261031090000_unified_order_sources`
  (#20) the new `order_sources` table has `brand_id`/`type`/`config`, **not**
  `is_default`/`sort_order`. The deployed chunks call `order_sources.select("id, name, is_default")`
  (Orders page), `select("*").order("sort_order")` and `insert({name, sort_order})` (Settings page)
  — those PostgREST requests **fail once #20 lands**, until the new frontend is deployed.
  `legacy_order_channels` preserves the old rows, so no data is lost; the old UI just errors until
  replaced.
- **Therefore the new frontend must deploy in the same window as the chain**, and the read-only
  freeze should span it. Practically this can be sequenced as: apply chain → deploy frontend →
  resume trading, with the freeze covering the whole stretch.
- `scripts/verify-live-deployment.mjs`'s deployment URL returns **410 Gone** — confirm which
  deployment is current before applying (the live production alias is `https://dokanos.vercel.app`).
- The repo has **no `.vercel/` link** and the branch is **51 commits ahead of `origin`**, so the
  Vercel project is presumably Git-integration-based on the remote branch: the new build only
  reaches production after those commits are pushed. Pushing is a user-visible, outbound action and
  has not been done.

## Pre-checks (read-only)

1. Rollback basis: production has **no native backup and no PITR** (org on the `free` plan,
   `pitr_enabled: false`, `backups: []`). Gate 1 decision (2026-11-01): proceed on the **proven
   logical dump** — `prod-schema-public.sql` + `prod-data-public.sql`, restored end-to-end into a
   local DB with exact row-count match; see
   [task17-readiness-report.md](task17-readiness-report.md) §1 for checksums and the durable copy
   location. There are no DOWN scripts; this dump is the rollback.
2. `select count(*) from webhook_events where created_at is null or status_code is null or topic is null;` → expect 0 (re-verified 2026-11-01: 0; #17 backfills if not).
3. `select to_regprocedure('public.is_signup_open()')` → expect `null` (still pending; re-verified 2026-11-01).
4. Snapshot row counts (orders/customers/products/webhook_events) to compare after.
5. Save a grants snapshot: `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public';`

## Apply

- `supabase db push` from this repo (applies pending in order, each file transactional),
  or the dashboard SQL editor running the 28 files in filename order.
- Expected duration: seconds. Largest touched table is `webhook_events` (771 rows at the
  2026-11-01 re-check; an earlier audit noted 885 — recount at apply time).

## Post-checks

1. `is_signup_open()` answers over anon REST → `true` (production `app_config.signup_open = true`).
2. Ledger head = **`20261103090000`**, count = **190**.
3. Frontend deploy of this branch is live (legacy `order_sources` shape is gone from the UI).
4. `/signup` renders the form (not the error gate) on the deployed frontend.
5. Smoke: login, business list, create brand, invite member, storefront checkout inserts an order (`payment_meta` path).
6. Re-run the schema diff → expected zero unexplained drift.

## Rollback

- Restore the pre-apply logical dump (Gate 1 decision; the folder also holds the pre-apply schema).
  For a partial issue caused by #15/#16, re-apply the saved grants snapshot instead of restoring.

## Out of scope

- The domain revamp (unified `order_sources`, warehouses, courier/payment services) is a
  separate schema wave (tasks/plan.md Tasks 4–5) and the Enveil Vincent data migration is
  Task 8 — both land **after** this catch-up batch.
