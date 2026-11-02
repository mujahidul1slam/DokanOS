# Issue #9 — personal signup independent of business setup

Spec: https://github.com/mujahidul1slam/DokanOS/issues/9

## Outcome

- Signup asks for person name, email, password and required consent, with existing anti-abuse checks. It records personal consent intent, not a business-provisioning anchor.
- Confirmation and recovery never provision business resources or accept invitations. Recovery intent is captured before Supabase removes its callback hash.
- `/accounts` is a valid signed-in destination with no memberships. Creating a business is an explicit choice; existing members can select an authorized business.
- An opaque `invite` query parameter survives signup, confirmation, resend, sign-in and recovery callbacks. It is not treated as membership, account identity or authorization. Account-aware acceptance remains a separate slice.
- User creation becomes profile-only through `20261019120000_personal_signup_profile_only.sql`. Existing identities, roles, memberships, invitations and business resources are not rewritten.
- The legacy `team-manage` endpoint returns HTTP 409 `INVITATION_ACCEPTANCE_REQUIRED` for new/unconfirmed `invite` and `resend_invite` targets before writes or email dispatch. Its global invitation rows cannot safely establish a business-account mapping. Existing grants and independent login/password recovery remain intact; do not restore implicit email-match grants.

## Validation

### Integration repair verification — 2026-10-19

Supersedes the initial infrastructure-blocked results below. Repairs are based
on integration tip `505c5d18d1d4cb9d2ebbd5faf7b9ff7c01f0bb45`, not ticket #10.
Only the labelled disposable local project `accounts-8-15-disposable-20261019`
was migrated/reset; no deployed database or dirty source tree was changed.

| Check | Latest result |
| --- | --- |
| Real local Auth signup/confirmation/recovery | **Passed**, including repeated-token rejection, no invitation acceptance/provisioning, direct business/membership/profile denials and member-RPC denials |
| Fresh-stack SQL/RLS battery | **8 files passed** after correcting stale direct-DML expectations for membership rows hidden by the documented SELECT policy |
| Unit suite with explicit disposable local DB URL | **137 passed, no skips** |
| Typecheck / production build | **Passed** |
| Chrome accounts browser suite | **10 passed** |
| Full ESLint vs original start | **777 errors / 43 warnings**, versus **782 / 43**; no added normalized diagnostics |

Root causes and bounded repairs:

- JSON CLI status parsing replaces presentation-text scraping; numbered SQL
  seed parameters replace literal `$A`/`$B`; invalid top-level `PERFORM` becomes
  `SELECT`; failed SQL batches roll back before the next file.
- The original-start migration set reproduces missing table DML grants with
  CLI 2.107.0. Its `ApplyApiPrivileges` deliberately revokes default Data API
  privileges. The new migration explicitly grants authenticated DML only on
  businesses, memberships and app settings, plus profile SELECT/INSERT/UPDATE. All
  four retain RLS. No anon/service-role grants or default privileges change.
- Before enabling profile reads, a rollback-only probe proved the old
  authenticated `USING (true)` policy exposed unrelated people. Profile reads
  now allow self, shared-business directory members and existing platform
  admins; unrelated people remain hidden. Self-update remains self-only.
- Test fixtures/privileged resource-count observations use the verified local
  SQL connection, not new service-role production grants. Application
  authorization is exercised through the real Auth/PostgREST client.
- The member-access RPC incorrectly aggregated a nonexistent `permission`
  column from an array-returning function. Returning the typed array fixes it.
  This also uncovered a masked authorization bug: a nonmember's management
  predicate returned NULL, so PL/pgSQL `IF NOT predicate` skipped rejection.
  The predicate now returns false for nonmembers. Real API tests prove both
  member-read and role-write RPCs reject the new person with SQLSTATE 42501.

**Membership-policy contract resolution:**
`user_business_access_test.sql` now preserves the expressly documented “no
manager widening” SELECT posture from
`20260911000100_rls_tighten_user_business_access.sql`. Direct filtered DELETE
and UPDATE assertions require zero affected invisible other-member rows.
Authorized owner role management is exercised through the existing guarded
`set_member_business_role` RPC instead. Legacy business managers are not
promoted to owners to make the test pass, and their direct other-member DML
remains denied. Fixture restoration is committed before later rollback-only
cases so owner-RPC assertions retain the intended authority. The corrected
file passes alone and as part of the fresh eight-file disposable battery,
without widening membership reads, weakening authorization, or implementing
#10.

Detailed red/green logs, catalog audit, baseline replay, lint delta and the
minimal contract probe are in
`C:/Users/mujah/AppData/Local/Temp/opencode/accounts-9-repair-logs/`.
Run the battery after a disposable reset as documented; it contains committed
fixture mutations and is not an idempotent production diagnostic.

### Initial slice verification (historical)

Test seams were approved by the user: real routed browser UI with controlled external Supabase responses, and local real Auth/membership APIs when infrastructure is available.

| Check | Result |
| --- | --- |
| `npx playwright test --config playwright.accounts.config.ts` | **10 passed**, using installed Chrome via `PLAYWRIGHT_CHANNEL=chrome` |
| `npm run typecheck` | **Passed** |
| `npm test` | **134 passed, 3 skipped**; skipped database tests belong to the concurrent issue #8 work |
| `npm run build` | **Passed** |
| Repository ESLint | **Not clean:** 780 errors, 43 warnings across the repository; changed app/browser test files have no errors and the two existing provider Fast Refresh warnings |
| `RUN_LOCAL_AUTH_TESTS=1 node --test scripts/personal-signup-api.test.mjs` | **Blocked:** Docker Desktop Linux engine pipe is absent; cannot obtain local Supabase status |
| `supabase/tests/rls/personal_signup_test.sql` | **Not run:** local Docker/Supabase unavailable |

Browser coverage includes personal signup without business fields, a fresh session from a real-format confirmation hash, a recovery hash, password reset/reload with zero memberships, existing-member selection, explicit second-business selection and persistence, invalid/missing-session callbacks, resend without signup state, repeated confirmation/reload, and invitation continuity without acceptance or provisioning requests. Browser tests run the actual application and Supabase SDK; they do not prove database authorization or hosted email delivery.

The local API test checks real signup, confirmation, rejected token reuse, recovery/password sign-in, unaccepted invitations, absent role/membership grants, cross-account read/update denial and preservation of resource counts. The rollback-only SQL fixture checks the auth trigger and authenticated nonmember RLS. These are unverified until run against a disposable, migrated local stack. Local Auth email confirmations must be enabled for the confirmation test.

## Deployment boundary

**No deployed database was changed. The migration has not been applied.** Coordinate the frontend, `signup-event`, `auth-resend`, `team-manage` and profile-only trigger migration after separate deployment approval. Do not ship the new signup intent against the old invitation-consuming trigger or old business-required event endpoint.

Configure Supabase Auth's trusted redirect allowlist for the deployed `/auth/confirm` and `/reset-password` callbacks, including their invitation query parameters. Do not broaden the allowed origins. `auth-resend` rebuilds its callback path from `APP_URL` or the request origin; Supabase's redirect allowlist remains authoritative.

For follow-up local verification, start a disposable Supabase stack, enable local email confirmations and apply migrations there. Run `node scripts/run-rls-tests.mjs` and the opt-in API test above. Do not reset a database containing work that must be preserved.

## Standards

Initial independent review found one documented violation and one heuristic:

1. Browser assertions against private localStorage keys conflicted with the TDD skill's public-interface rule. **Resolved:** tests now assert visible store-name context and persistence after reload, plus external provisioning-request absence. Storage writes only seed stale-state fixtures.
2. Possible duplicated reset code in `useBusinessContext`. **Resolved:** `clearMemberships` centralizes the reset, including the current-memberships ref.

Follow-up reviewer: both findings resolved; no new documented-standard violations. Original worst Standards finding: implementation-coupled assertions.

## Spec

Initial independent review found three P2 findings:

1. Recovery type was read after SDK initialization removed the hash. **Resolved:** capture callback intent before importing the SDK; actual hash recovery now has browser coverage.
2. A stale membership closure rejected a newly created business and left the previous one active. **Resolved:** validate the latest loaded membership ref; browser coverage observes the new business's store-name context before and after reload.
3. The profile-only trigger stranded the legacy native-invite flow. **Resolved by gating:** reject incompatible new/unconfirmed invite/resend requests with a typed 409 before mutation, rather than guessing a business mapping or granting access at identity creation. Full account-aware acceptance is deferred.

Follow-up reviewer: all three findings resolved; no blocking regression identified. No scope creep found. Original worst Spec findings: callback recovery and wrong-account setup context.

Initial review summary: Standards **2 findings resolved, 0 remaining**; Spec **3 findings resolved, 0 remaining**. See the integration repair verification above for later real database/API results and the remaining baseline battery conflict.

Review baseline approved by the user: `71602f510531f639a99949135e9754fd04dfb7aa`. The unrelated concurrent issue #8 commit was excluded by the issue #9 file list. Reviews used separate parallel agents and preserved unrelated worktree changes.
