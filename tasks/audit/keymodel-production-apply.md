# Key-model migration production apply — pre-flight record + gated run card

**Status: PREPARED (read-only) 2026-11-02; production apply USER-GATED — not yet executed.**

Migration: `supabase/migrations/20261103140000_key_model_attribution.sql` (committed `dbfde1c`,
battery-green locally on a clean DB: RLS **29/29 files**, vitest 496 passed | 3 skipped, typecheck +
eslint + build clean).

## 1. Pre-state probe — 11/11 PASS (2026-11-02, read-only Management-API probe)

| Check | Expected | Actual |
| --- | --- | --- |
| Ledger | count 192, head `20261103120000`, key model pending | ✅ 192 / `20261103120000` |
| `business_id` on orders/customers | present (Task 16) | ✅ both |
| Derivation triggers | absent | ✅ none |
| Pre-state policies reference the tag | yes (pre-rewrite) | ✅ 8 orders + 8 customers policies, 4 tag refs |
| Rows needing backfill | — | ✅ orders 4,047 / 4,095 NULL; customers 3,196 / 3,247 NULL |
| Orders: every bound row resolves | 0 unresolved | ✅ by source 4,047 (0 unresolved), by store 0 |
| Customers: every bound row resolves | 0 unresolved | ✅ by source 3,194 (0 unresolved), by store 2 (0 unresolved) |
| Source-vs-store leg disagreements | 0 | ✅ 0 / 0 |
| Manual-customer repair target | resolvable | ✅ 2 rows |
| Residual unattributable | the Task 16 pool | ✅ orders 48 / customers 51 |
| Row snapshot | — | ✅ orders 4,095 / customers 3,247 / products 225 / order_items 5,329 / stores 2 |

## 2. Apply-safety probe — production-only branches are unambiguous

The local battery runs against an EMPTY dataset, so the branches that only execute in production
were probed directly before writing this card:

- `order_sources.legacy_store_id` is **unique per source** (0 duplicates) → the §2 repair join cannot
  fan out.
- The 2 repair rows (`nabil`, `shoriful islam sorif`) both resolve to **Vincent WooCommerce** →
  business `de31fd60-a520-4d42-aef2-c72ededc4c09`; **0 customers match more than one** legacy source.
- Residual unattributable rows are exactly the Task 16 pool (48 orders / 51 customers) — the backfill
  cannot silently swallow or invent attribution.
- **Every brand resolves to ONE business** (`de31fd60-…`) → the whole backfill is single-tenant and
  deterministic; 0 source-vs-store leg disagreements confirm the leg precedence is safe.
- §5 verification is self-guarding: it RAISEs (rolling the single transaction back) if any bound row
  is left unstamped, if either trigger is missing, if the policy count is not 5+5, or if any policy
  still references the pool tag.

**No file-order hazard.** Unlike Task 16, every statement references objects that already exist at its
position: §1/§2 only UPDATE existing columns (`business_id` came in `20261103120000`, and the backfill
deliberately runs BEFORE the triggers exist so there is no re-derivation churn), §3 creates the
functions/triggers, §4 drops and recreates policies, §5 verifies. There is no conditional branch whose
execution depends on production data volume.

## 3. Rollback basis — fresh pre-apply dumps

Taken immediately before the apply (supersedes the pre-Task-16 pair **for this step**; the older pairs
remain their own steps' rollback):

- `C:\Users\mujah\dokan-prod-backups\20261102-pre-keymodel\prod-schema-public.sql` — 329,779 B, sha256 `4C79FA8324CAFA83440F853C4A5039D145592C862BC2F5AF7C3A3BE295BB9905`
- `C:\Users\mujah\dokan-prod-backups\20261102-pre-keymodel\prod-data-public.sql` — 21,757,060 B, sha256 `772AF1C14F8D787AE234B532C65E04A2B5EF8EF25BB46D2B3F2983C41EABA3EB`

**Rollback procedure if the apply fails mid-way:** the migration is a single transaction — a failed
apply leaves production untouched; re-run after fixing the cause. If the apply SUCCEEDS and a defect is
found later, rollback = restore the two dumps above (destructive, last resort — loses any data written
after the dump; coordinate a freeze first).

## 4. Apply (USER-GATED)

```powershell
npx supabase db push --linked --yes     # pushes exactly the one pending migration
```

Expected NOTICEs:

```
key model: unstamped bound orders 0, unstamped bound customers 0, triggers 2, policies 5+5,
tag refs in policies 0, manual customers still missing origin source 0
```

Ledger 192 → **193**, head `20261103140000`.

**Attempt log:** _(none yet — the apply has not been approved)_

## 5. Post-apply verification (24 checks, SELECT-only)

Run `.tmp-keymodel-postverify.mjs` after the apply:

1. Ledger 193 / head `20261103140000`.
2. Both derivation triggers exist and are enabled; functions are `SECURITY DEFINER` with
   `search_path=""`.
3. Exactly 5 policies per table; **0** policies reference `legacy migration`.
4. `orders.business_id` / `customers.business_id` NULL counts are exactly the residual pool
   (0 orders, 0 customers besides the atomic 0 the §5 block guarantees for BOUND rows — the pool is
   already stamped by Task 16, so expect **0 NULL on both tables**).
5. Backfill closure: 0 bound rows left unstamped.
6. The 2 manual customers carry `origin_order_source_id` = Vincent WooCommerce.
7. Row snapshot IDENTICAL to the pre-apply snapshot (4,095 / 3,247 / 225 / 5,329 / 2) — zero data loss.
8. RLS posture: `relrowsecurity` true on both tables; `is_signup_open()` still true.

## 6. Frontend coupling — none required

The key model adds a trigger and rewrites policies; it drops **no** column and no relation, so the
currently deployed bundle keeps working. The only client change (`src/lib/legacyPool.ts` predicate
legs stop naming the tag) is a **widening/clarification**, not a requirement: the tag survives in the
data, so the old bundle's `.eq("source","legacy migration")` pool read still returns the same rows and
the new RLS read policy permits them. Redeploy after the apply is optional and cosmetic (it makes the
client predicate match the documented structural model).

## 7. Follow-ups recorded (not blockers)

- `orders.source` / `customers.source` / `customers.origin_kind` are **unconstrained by design** (a
  CHECK would make the tag load-bearing again). Vocabulary is documented in the migration header.
- The bound-only UPDATE restriction means staff cannot edit unbound rows (e.g. POS local-store order
  corrections) — accepted tradeoff recorded in the migration header; the reassignment ladder wins.
