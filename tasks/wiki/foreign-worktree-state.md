# Foreign uncommitted changes in this shared checkout

This Temp checkout has been touched by actors other than the chief-of-staff session. Rule (from [../plan.md](../plan.md) risks, 2026-10-30): **never `git add -A`; stage only your task's explicit paths; ask the user before reverting foreign changes.**

## The signup-deletion wave (unstaged deletions first observed 2026-10-31)
An unidentified actor deleted from the worktree (all still tracked at HEAD):
- `supabase/migrations/20261022120000_signup_config_accessor.sql`, `supabase/migrations/20261023100000_signup_service_role_grants.sql`
- `supabase/functions/_shared/signup-gate.ts`, `supabase/functions/_shared/signup-utils.ts`, `supabase/functions/signup-event/index.ts`
- `src/test/signupConfiguration.test.tsx`, `src/test/signupGate.test.ts`

Consequences found on 2026-10-31: `is_signup_open()` vanished from a `db reset` schema (local signup fail-closed, same as production); and three **live** edge functions (`auth-resend`, `create-business`, `purge-unconfirmed`) imported the deleted `_shared/signup-utils.ts`, breaking the create-business chain that onboarding depends on.

**User decision (2026-11-01): restore.** The chief restored via `git checkout HEAD --`: the 2 migrations and the 3 `supabase/functions` modules (the functions were imported by live edge functions — `auth-resend`, `create-business`, `purge-unconfirmed` — so the deletions broke the create-business chain). Later the same day the 4 deleted TEST files (`src/test/signupConfiguration.test.tsx`, `src/test/signupGate.test.ts`, `supabase/tests/rls/signup_config_accessor_test.sql`, `supabase/tests/rls/signup_service_role_grants_test.sql`) were restored too, superseding the earlier "tests remain deleted" note: they test exactly the restored runtime code, and leaving them out was a silent coverage gap before cutover. All 9 deletions are now reverted; if the deleting actor's intent was to remove the signup gate feature, revisit with the user.

## Other foreign state (left untouched)
- `package.json` modified, uncommitted: adds `test:browser`, `test:smoke`, `verify:env` scripts (used by task verifications — keep).
- Untracked cruft: `.tmp-*` files, `.tmp-run/`, `.tmp-task8/`, `test-results/`, `backups/`, `xkiro-limits/`, `dsh-oms-workflow/`, `OMS-WORKFLOW-HANDOVER.md`, `scripts/verify-env.mjs`, `~\gstack`, `.claude/worktrees/` deletions. None of it belongs to task commits.

## related
- [environment-quirks.md](environment-quirks.md) · [cutover-status.md](cutover-status.md) (the deletions also blocked cutover batch items #10/#11 — see the runbook)
