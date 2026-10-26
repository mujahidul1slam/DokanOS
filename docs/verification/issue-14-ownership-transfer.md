# Issue #14 — transfer business-account ownership safely before owner departure

Spec: https://github.com/mujahidul1slam/DokanOS/issues/14

## Outcome

- Owners keep full authority. An ordinary member, a legacy account admin, a
  platform admin or a nonmember cannot transfer ownership, restrict an owner or
  remove owner authority. The RPCs enforce this independently of the UI.
- A transfer is a deliberate act by a **current owner** and names an **existing
  member of the same account**. A forged or cross-account target (a real user id
  with no `user_business_access` row in this account) is denied. Transferring to
  yourself is denied.
- A transfer promotes the target to `owner` and demotes **only the caller** to
  `member`. Reviewed legacy co-owners are preserved untouched, and the transfer
  asserts the final owner-count invariant before committing.
- An owner cannot leave until ownership is transferred (`OWNER_TRANSFER_REQUIRED`,
  SQLSTATE 23514). Ordinary members, viewers and legacy account admins may leave
  their own membership. A missing membership returns `MEMBER_NOT_FOUND`.
- Every ownership transition takes the business row lock and then locks all
  membership rows in a deterministic order, so repeated and concurrent transfer,
  departure, removal and role-change requests serialize and can never leave the
  account ownerless.
- The app adds Transfer-ownership and Leave-account controls to `/members`.
  Non-owners never see transfer controls; an owner sees a disabled leave control
  and an explanation instead of a way out. The context refreshes after each
  transition so the former owner immediately sees member-level departure.

## Migration

`supabase/migrations/20261019200000_business_ownership_transfer.sql`

- `transfer_business_ownership(p_business_id uuid, p_new_owner_id uuid) returns
  jsonb` — strictly current-owner-only (no platform-admin bypass). Locks the
  business row `FOR UPDATE`, locks membership rows `ORDER BY user_id FOR UPDATE`,
  re-reads caller and target roles under the lock, rejects non-members and
  self-targets, promotes the target, demotes only the caller, asserts an owner
  remains, then writes `audit_log`.
- `leave_business_account(p_business_id uuid) returns jsonb` — blocks every owner
  with `OWNER_TRANSFER_REQUIRED`; deletes only the caller's row otherwise; asserts
  an owner remains; writes `audit_log`.
- Re-defines `remove_business_member` and `set_member_business_role` with the same
  per-business mutex so a removal or role change cannot act on a stale role that a
  concurrent transfer just changed. Their #13 authorization behavior is unchanged.
- Error codes: `AUTH_REQUIRED` 42501, `OWNER_REQUIRED` 42501, `TARGET_NOT_MEMBER`
  22023, `TARGET_IS_CALLER` 22023, `BUSINESS_NOT_FOUND` 22023,
  `OWNER_TRANSFER_REQUIRED` 23514, `MEMBER_NOT_FOUND` 22023, `OWNER_INVARIANT`
  23514. `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO authenticated`.
  A documented rollback block restores the previous definitions.

## Frontend

- `src/lib/accounts/ownership.ts` — pure mapper from RPC payloads and PostgREST
  errors to explicit states/copy (`classifyOwnershipError`, `transferErrorMessage`,
  `departureErrorMessage`, `parseTransferResult`, `parseDepartureResult`,
  `canLeaveWithoutTransfer`, `isTransferTarget`). An unreadable or non-confirming
  response is treated as a failure, never as a successful transfer.
- `src/pages/BusinessMembers.tsx` — owner-only “Make owner” control with an
  explicit confirmation step, plus a Leave-account section. Owners see the block
  and a disabled control; members see the leave control and no ownership actions.
  Successful transitions refresh the business context and confirm via toast
  (which survives the context-driven route remount).
- `src/integrations/supabase/types.ts` — added `transfer_business_ownership` and
  `leave_business_account` under `Functions`.

## Validation

Checked on integration tip `a5aea432425b8c856ea5f344b8d47bf31fb626e0` using the
labelled disposable local project `ownership14disposable261`. No deployed database
was migrated or mutated and nothing was pushed.

| Check | Latest result |
| --- | --- |
| Focused red test | `business_ownership_transfer_test.sql` failed first with `function public.transfer_business_ownership(unknown, unknown) does not exist` |
| Fresh reset + full SQL/RLS battery | **ALL GREEN (14 files)** incl. `business_ownership_transfer_test.sql` (AC-1…AC-6b) |
| PostgREST ownership probes | **PASS** `business_ownership_transfer_api` (owner-only, forged cross-account target, legacy co-owner preserved, repeat, competing concurrent transfers) and **PASS** `business_ownership_departure_api` (owner blocked until transfer, member leave, transfer/leave race) |
| Real local Auth + PostgREST probe | **PASS** `scripts/ownership-transfer-api.test.mjs` (real GoTrue sign-in; unauthorized callers, cross-account target, legacy co-owner, repeated ops, two competing transfers, transfer/leave race, concurrent member departures, no platform role or account manufactured) |
| Unit suite | **194 passed, 3 skipped** (23 new ownership-mapper tests) |
| Typecheck | **Passed** |
| Production build | **Passed** |
| Chrome accounts browser suite | **27 passed** (23 existing + 4 new) |
| Repository ESLint | **776 errors / 43 warnings**; **0 worker-only findings** vs the `a5aea43` integration baseline (`issue14-lint.json` vs `integration-eslint.json`) |

Browser coverage (real app, mocked Data API): an owner transfers to a member,
sees the confirmation, then (now a member) leaves and lands on `/accounts`; a
refused transfer keeps the owner in place and explains the refusal; an ordinary
member leaves with no ownership control; a member still sees the directory with
no invitation/removal/transfer controls. The SQL battery, PostgREST probes and
the real Auth probe — not the browser mocks — prove database authorization.

Detailed logs are in
`C:/Users/mujah/AppData/Local/Temp/opencode/accounts-8-15-check-logs/`
(`issue14-db-reset.log`, `issue14-rls-final.log`, `issue14-real-auth.log`,
`issue14-unit.log`, `issue14-typecheck.log`, `issue14-build.log`,
`issue14-lint.json`, `issue14-lint-compare.log`).

## Deployment boundary

**No deployed database was changed and nothing was pushed.** Apply the migration
with the frontend together: the new `/members` controls call RPCs that do not
exist on an older database. The #15 rehearsal and any granular-permission or
invitation redesign are intentionally out of scope. Direct co-owner self-delete
through the raw `user_business_access` RLS path keeps its prior, reviewed
behavior; the new `leave_business_account` RPC is the enforced
transfer-before-departure path.

## Standards / Spec check

- Server authority stays in SQL: the UI hides controls, but the RPCs reject
  non-owner callers, forged/cross-account targets and ownerless transitions on
  their own.
- The per-business mutex plus a final owner-count assertion make the invariant
  explicit and testable, and repeated/concurrent requests are covered by real
  PostgREST and real Auth probes.
- The pure mapper keeps error copy testable and never renders a non-confirming
  response as a successful transfer.
- Scope stays inside #14: additional/legacy owners are preserved, no rehearsal
  (#15), no invitation redesign, no granular permissions, no deployed change.
