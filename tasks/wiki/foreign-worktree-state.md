# Foreign uncommitted changes in this shared checkout

This Temp checkout has been touched by actors other than the chief-of-staff session. Rule (from [../plan.md](../plan.md) risks, 2026-10-30): **never `git add -A`; stage only your task's explicit paths; ask the user before reverting foreign changes.**

## The signup-deletion wave (unstaged deletions first observed 2026-10-31)
An unidentified actor deleted from the worktree (all still tracked at HEAD):
- `supabase/migrations/20261022120000_signup_config_accessor.sql`, `supabase/migrations/20261023100000_signup_service_role_grants.sql`
- `supabase/functions/_shared/signup-gate.ts`, `supabase/functions/_shared/signup-utils.ts`, `supabase/functions/signup-event/index.ts`
- `src/test/signupConfiguration.test.tsx`, `src/test/signupGate.test.ts`

Consequences found on 2026-10-31: `is_signup_open()` vanished from a `db reset` schema (local signup fail-closed, same as production); and three **live** edge functions (`auth-resend`, `create-business`, `purge-unconfirmed`) imported the deleted `_shared/signup-utils.ts`, breaking the create-business chain that onboarding depends on.

**User decision (2026-11-01): restore.** The chief restored via `git checkout HEAD --`: the 2 migrations and the 3 `supabase/functions` modules (the functions were imported by live edge functions — `auth-resend`, `create-business`, `purge-unconfirmed` — so the deletions broke the create-business chain). Later the same day the 4 deleted TEST files (`src/test/signupConfiguration.test.tsx`, `src/test/signupGate.test.ts`, `supabase/tests/rls/signup_config_accessor_test.sql`, `supabase/tests/rls/signup_service_role_grants_test.sql`) were restored too, superseding the earlier "tests remain deleted" note: they test exactly the restored runtime code, and leaving them out was a silent coverage gap before cutover. All 9 deletions are now reverted; if the deleting actor's intent was to remove the signup gate feature, revisit with the user.

## The Storage Sense wipe (2026-11-02 10:34) — **this checkout lives under `%TEMP%`**
A second, much larger deletion wave hit this worktree (and the sibling `accounts-review-disposable-261019`) while the key-model work was finishing. **Not an agent action** — Windows Storage Sense reclaimed `%TEMP%`.

Evidence: Storage Sense's `StoragePoliciesLastTrigger` (HKCU\…\StorageSense\Parameters\StoragePolicy) decodes to **2026-11-02 10:33:47**, ~20 s before the files vanished (dir mtimes 10:34:07); the `SilentCleanup` scheduled task had also run at 09:07. The checkout path `C:\Users\mujah\AppData\Local\Temp\opencode\accounts-8-15-integration` is **inside `%TEMP%`**, i.e. flagged as disposable, and `C:` was down to **1.6 GB free**.

Wiped and restored the same day (`git checkout HEAD --`, explicit paths, per the rule above; 29 files):
- `src/hooks/`: `useStoresList.ts`, `useDashboardData.ts`, `useActiveBusinessStoreIds.ts` (39 import sites total)
- `src/components/`: `dashboard/SyncHealthCard.tsx`, `orders/ExchangeDialog.tsx`, `pos/{HeldCartsDialog,RecentOrdersDialog,ReturnDialog,ShiftDialog}.tsx`, `products/{CategoriesTab,ProductDetailSheet}.tsx`
- `src/pages/PosReports.tsx`; `src/test/` 10 files incl. `setup.ts` and `support/tenantScopedClient.ts`
- `supabase/migrations/`: the 5 active-business-context migrations (`20261024100000`, `20261026100000`, `20261026120000`, `20261026140000`, `20261026150000`) — these define `current_business_context()` / `set_active_business_context()`, which the key-model migration calls in 34 places
- `supabase/tests/rls/`: `_harness.md`, `anon_public_surface_test.sql`

Also emptied: **`node_modules/`** (only `.vite/` survived) — `npx tsc` did not resolve until reinstalled.

**Consequence for future work:** any agent session working in this path can have its checkout silently pruned mid-task. Prefer a path outside `%TEMP%` for long-running work, or keep changes committed early (which is why the key-model work survived: it was committed at 10:22/10:28/10:35 to `integration/accounts-8-15`).

## Other foreign state (left untouched)
- `package.json` modified, uncommitted: adds `test:browser`, `test:smoke`, `verify:env` scripts (used by task verifications — keep).
- Untracked cruft: `.tmp-*` files, `.tmp-run/`, `.tmp-task8/`, `test-results/`, `backups/`, `xkiro-limits/`, `dsh-oms-workflow/`, `OMS-WORKFLOW-HANDOVER.md`, `scripts/verify-env.mjs`, `~\gstack`, `.claude/worktrees/` deletions. None of it belongs to task commits.

## related
- [environment-quirks.md](environment-quirks.md) · [cutover-status.md](cutover-status.md) (the deletions also blocked cutover batch items #10/#11 — see the runbook)
