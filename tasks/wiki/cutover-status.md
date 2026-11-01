# Cutover & contract status (Tasks 16–17)

## Task 17 — runbook DONE, execution USER-GATED
- Runbook: [../runbook-cutover.md](../runbook-cutover.md), committed `dcd3454` (2026-10-31), refreshed against the 2026-11-01 Task 8 rehearsal. Three gates: user go-ahead before the schema chain → go-ahead before the data write → user signs off the live audit before enabling the new UI. **No production write happens without explicit user approval.**
- Current rehearsal: `task8_scratch` rebuilt from a coherent read-only extract including `order_items`; **12/12 checks pass**. After counts: 3,244 customers (3,193 attributed / 51 residual pool), 4,092 orders (4,044 attributed / 48 pool; 3,235 bound + 809 inferred), 0 inferable orders, and 1,162 connected-order-evidence customers resolved by the signed-off Checkpoint C rule.
- Preconditions chain: Checkpoints A–E → **28-file production chain** (19-file catch-up batch + 5-file domain-revamp schema wave + 4 integration migrations: Task 13 onboarding, Task 15 ×2, option B) → data script `scripts/migrate-enveil-vincent.sql` (self-wrapping one transaction; applied via SQL editor/psql — `scripts/task8-audit.mjs` is local-only by design, hostname-guarded). **Gate 1 approved 2026-11-01**: rollback basis = proven logical dump (production has no native backup/PITR), scope = all 28. Signup stays fail-closed on prod until `is_signup_open()` lands (chain #10).
- Discrepancies found during the runbook cross-check (2026-10-31; refreshed 2026-11-01):
  1. The original Task 8 card and runbook counts were historical/spec-snapshot values. The refreshed rehearsal is authoritative for the current cutover window; `tasks/todo.md` now records the 2026-11-01 extract and 12-check result.
  2. `task8-audit.mjs` cannot target production (local-only) — runbook splits rehearsal vs apply vs live audit.
  3. Script header says "Tasks 4–5 schema" but step 2b writes `courier_services` (Task 9) — full schema wave required.
  4. ✅ Resolved: the foreign deletion of catch-up-batch files #10/#11 is gone — both are present, clean, committed (`git status --short -- supabase/migrations` empty).
  5. Scope/post-check drift corrected: the pending set is **28**, not 19; the plan doc and runbook now expect ledger head `20261103090000`, count 190 (not `20261030090000`/179).
  6. Apply-order risk re-measured against the live bundle: the deployed build (2026-10-30) has **no `app_config` reference at all**, so the old "app_config will 401" concern is void; the real constraint is that it still queries the legacy `order_sources` shape (`is_default`/`sort_order`), which breaks at chain #20 — the window must include the frontend deploy.

## Task 16 — Contract (drop legacy): BLOCKED until cutover
- By design: "run after successful cutover" (Task 17). Dropping `stores`/`selling_points`/`brand_stores`/`connectors`/… before the production data is migrated would destroy the source rows the migration script reads.
- Extra candidate for the contract pass (from Task 15, 2026-11-01): stamp `business_id` on legacy-pool rows (see [legacy-pool-semantics.md](legacy-pool-semantics.md)).
- Also from Task 14 (2026-11-01): the `store_id=null` storefront quirk in the create pipeline is worth fixing in the same pass.

## Human gates still open (as of 2026-11-01)
- Checkpoints A–E and the Task 8 review items are signed off in `tasks/todo.md` and the generated dry-run report.
- Production execution remains user-gated: Gate 1 (schema chain), Gate 2 (data migration), and Gate 3 (live audit sign-off) are still open. Task 16 remains blocked until a successful cutover audit.

## related
- [foreign-worktree-state.md](foreign-worktree-state.md) · [legacy-pool-semantics.md](legacy-pool-semantics.md) · [task-conventions.md](task-conventions.md)
