# Cutover & contract status (Tasks 16–17)

## Task 17 — runbook DONE, execution USER-GATED
- Runbook: [../runbook-cutover.md](../runbook-cutover.md), committed `dcd3454` (2026-10-31), refreshed against the 2026-11-01 Task 8 rehearsal. Three gates: user go-ahead before the schema chain → go-ahead before the data write → user signs off the live audit before enabling the new UI. **No production write happens without explicit user approval.**
- Current rehearsal: `task8_scratch` rebuilt from a coherent read-only extract including `order_items`; **12/12 checks pass**. After counts: 3,244 customers (3,193 attributed / 51 residual pool), 4,092 orders (4,044 attributed / 48 pool; 3,235 bound + 809 inferred), 0 inferable orders, and 1,162 connected-order-evidence customers resolved by the signed-off Checkpoint C rule.
- Preconditions chain: Checkpoints A–E → 19-file production catch-up batch ([../audit/production-migration-plan.md](../audit/production-migration-plan.md); signup fail-closed on prod until `is_signup_open()` = batch #10) → 5-file domain-revamp schema wave (`20261031090000`, `20261031113000`, `20261031140000`, `20261031180000`, `20261101090000`) → data script `scripts/migrate-enveil-vincent.sql` (self-wrapping one transaction; applied via SQL editor/psql — `scripts/task8-audit.mjs` is local-only by design, hostname-guarded).
- Discrepancies found during the runbook cross-check (2026-10-31; refreshed 2026-11-01):
  1. The original Task 8 card and runbook counts were historical/spec-snapshot values. The refreshed rehearsal is authoritative for the current cutover window; `tasks/todo.md` now records the 2026-11-01 extract and 12-check result.
  2. `task8-audit.mjs` cannot target production (local-only) — runbook splits rehearsal vs apply vs live audit.
  3. Script header says "Tasks 4–5 schema" but step 2b writes `courier_services` (Task 9) — full schema wave required.
  4. Blocked at the time by the foreign deletion of catch-up-batch files #10/#11 — since restored per user decision (see [foreign-worktree-state.md](foreign-worktree-state.md)).
  5. `production-migration-plan.md`'s "head 20261030090000, count 179" post-check is stale (19-file batch → 181; +schema wave → 186). Re-count at execution time.

## Task 16 — Contract (drop legacy): BLOCKED until cutover
- By design: "run after successful cutover" (Task 17). Dropping `stores`/`selling_points`/`brand_stores`/`connectors`/… before the production data is migrated would destroy the source rows the migration script reads.
- Extra candidate for the contract pass (from Task 15, 2026-11-01): stamp `business_id` on legacy-pool rows (see [legacy-pool-semantics.md](legacy-pool-semantics.md)).
- Also from Task 14 (2026-11-01): the `store_id=null` storefront quirk in the create pipeline is worth fixing in the same pass.

## Human gates still open (as of 2026-11-01)
- Checkpoints A–E and the Task 8 review items are signed off in `tasks/todo.md` and the generated dry-run report.
- Production execution remains user-gated: Gate 1 (schema chain), Gate 2 (data migration), and Gate 3 (live audit sign-off) are still open. Task 16 remains blocked until a successful cutover audit.

## related
- [foreign-worktree-state.md](foreign-worktree-state.md) · [legacy-pool-semantics.md](legacy-pool-semantics.md) · [task-conventions.md](task-conventions.md)
