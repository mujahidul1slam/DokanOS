# Key-model migration production apply — pre-flight record + gated run card

**Status: APPLIED to production 2026-11-02 ~10:29 +06 (user-approved), post-verified 14/14, UI smoke
green.**

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

**Attempt log:** **APPLIED 2026-11-02 ~10:29 +06 in one attempt** (`npx supabase db push --linked --yes`,
log `.tmp/keymodel-push.log`) — exit 0; NOTICEs `trigger "trg_orders_derive_business_id" … does not
exist, skipping` (expected, first create) + `key model: unstamped bound orders 0, unstamped bound
customers 0, triggers 2, policies 5+5, tag refs in policies 0, manual customers still missing origin
source 0`. Ledger 192 → **193**.

## 5. Post-apply verification — 14/14 PASS (2026-11-02, read-only)

`.tmp-keymodel-postverify.mjs` (SELECT-only via the Management API; the first run reported 13/14 on a
probe artifact — the API JSON-escapes `proconfig` as `{"search_path=\"\""}`, so the literal compare
missed; fixed the probe, not the database):

| Check | Result |
| --- | --- |
| 1. Ledger | ✅ 193 / head `20261103140000` |
| 2. Both derivation triggers exist + enabled | ✅ `tgname=O` for orders and customers |
| 3. Functions `SECURITY DEFINER` + locked `search_path` | ✅ both |
| 4. Exactly 5 policies per table | ✅ orders 5 / customers 5 |
| 5. Policies referencing the pool tag | ✅ 0 |
| 6. Bound rows left unstamped | ✅ 0 / 0 |
| 7. ALL rows stamped (pool included) | ✅ orders NULL 0 / customers NULL 0 |
| 8. Distinct businesses behind the rows | ✅ 1 |
| 9. Manual customers repaired | ✅ 2 repaired / 0 unrepaired |
| 10. RLS enabled on both tables | ✅ true / true |
| 11. Row snapshot | ✅ 4,095 / 3,247 / 225 / 5,329 / 2 stores — IDENTICAL to pre-apply (zero data loss) |
| 12. `is_signup_open()` | ✅ true |
| 13. Pool rows structurally intact | ✅ 48 orders / 51 customers |
| 14. Expected policy set | ✅ read/insert/update/delete + the pool reassign ladder on both tables |

## 6. UI smoke — GREEN (2026-11-02, live production as Enveil Vincent)

No redeploy needed (the migration drops nothing); the deployed bundle was smoked as-is:

- **Dashboard** — renders, no Dispatch entry, live counters.
- **Orders** — 908 orders across statuses; table + filters render.
- **Order Sources** — 8 sources with live order counts; the legacy section is stores-only with the new copy; **the repair is visible**: `VC-4721M · shoriful islam sorif` and `VC-4720M · nabil` now hang off Vincent WooCommerce (previously unattributed).
- **Customers** — 3,196 unique customers (grouped by phone) render.
- **Brands** — both brands with the "Legacy Woo store linked" subtitle; no store UI (Task 16).
- **Legacy Pool** — **48 orders / 51 customers** under the new structural RLS, rows + Reassign actions render.

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
