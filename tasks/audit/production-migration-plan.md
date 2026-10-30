# Production migration plan — 16 pending migrations + 1 repair

Status: **NOT APPLIED — awaiting explicit user go-ahead.** All findings below come from a
read-only audit (2026-10-30) comparing production schema identifiers against a fresh local
build of the full migration chain. Raw data: [prod-vs-repo.json](prod-vs-repo.json).

Target: Supabase project `jiwndicvfkiltgageqwv` — the real database, tenant **Enveil Vincent**
(brands Vincent + Enveil). Never run `supabase db reset --linked` (it wipes data).

## Where production stands

- Ledger head `20261014120000` (162 of 178 repo migrations applied) → **16 pending**,
  `20261019120000` … `20261026150000`, plus the new repair = **17 files to apply**.
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
| 15 | 20261026140000_explicit_api_table_grants | deliberate grant rebalance (−459/+19 table grants) | **attention** |
| 16 | 20261026150000_fix_anon_public_surface | revokes anon's direct table surface | **attention** |
| 17 | 20261030090000_repair_audit_drift *(new)* | `orders.payment_meta` + `webhook_events` convergence | low |

## Safety analysis

- **No top-level data writes in #1–16.** Every `INSERT/UPDATE/DELETE` in those files sits
  inside function bodies (RPC runtime logic); apply-time is DDL + grants only. Verified by scan.
- Expected schema delta (from the fresh-build diff): +3 tables, +29 columns, +17 functions,
  +1 trigger, policies +67/−58, table grants +19/−459, routine grants +20/−84. The large
  negative sides are the old broad grant/policy surface that #4/#15/#16 deliberately remove.
- **Drift found (pre-existing, not caused by the batch):**
  - `orders.payment_meta` (jsonb, nullable) exists only on production — added out of band;
    no migration creates it, yet the checkout RPCs INSERT it. Fresh builds break at checkout
    runtime. **Fixed by #17** (`ADD COLUMN IF NOT EXISTS`, exact live definition).
  - `webhook_events.created_at/status_code/topic`: nullable on production (0 NULLs in 885
    rows, audited 2026-10-30) vs NOT NULL in the chain — the live table predates the
    migration that defines it and the `IF NOT EXISTS` repair no-op'd. **Converged by #17**
    (guarded backfill + SET DEFAULT + SET NOT NULL).
  - Nothing else: no production-only tables; all remaining diff sides come from the batch itself.

## Apply-order warning (frontend)

- If the currently deployed frontend **predates** `2435c1b`, it reads `app_config` directly —
  #15/#16 revoke that surface and it will 401. **Ship the frontend built from this branch
  together with the migrations.**
- Since the current code path is already the RPC one (and signup is down *now*),
  migrations-first is also acceptable; signup stays down only until the frontend ships.
- `scripts/verify-live-deployment.mjs`'s deployment URL returns **410 Gone** — confirm which
  deployment is current before applying.

## Pre-checks (read-only)

1. Take a Supabase backup / confirm PITR. There are no DOWN scripts; backup is the rollback.
2. `select count(*) from webhook_events where created_at is null or status_code is null or topic is null;` → expect 0 (re-verify at apply time; #17 backfills if not).
3. `select to_regprocedure('public.is_signup_open()')` → expect `null` (still pending).
4. Snapshot row counts (orders/customers/products/webhook_events) to compare after.
5. Save a grants snapshot: `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public';`

## Apply

- `supabase db push` from this repo (applies pending in order, each file transactional),
  or the dashboard SQL editor running the 17 files in filename order.
- Expected duration: seconds. Largest touched table is `webhook_events` (885 rows).

## Post-checks

1. `is_signup_open()` answers over anon REST → `true` (production `app_config.signup_open = true`).
2. Ledger head = `20261030090000`, count = 179.
3. `/signup` renders the form (not the error gate) on the deployed frontend.
4. Smoke: login, business list, create brand, invite member, storefront checkout inserts an order (`payment_meta` path).
5. Re-run the schema diff → expected zero unexplained drift.

## Rollback

- Restore the pre-apply backup (PITR). For a partial issue caused by #15/#16, re-apply the
  saved grants snapshot instead of restoring.

## Out of scope

- The domain revamp (unified `order_sources`, warehouses, courier/payment services) is a
  separate schema wave (tasks/plan.md Tasks 4–5) and the Enveil Vincent data migration is
  Task 8 — both land **after** this catch-up batch.
