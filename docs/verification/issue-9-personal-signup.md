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

Summary: Standards **2 findings resolved, 0 remaining**; Spec **3 findings resolved, 0 remaining**. Real database/API verification remains blocked, not passed.

Review baseline approved by the user: `71602f510531f639a99949135e9754fd04dfb7aa`. The unrelated concurrent issue #8 commit was excluded by the issue #9 file list. Reviews used separate parallel agents and preserved unrelated worktree changes.
