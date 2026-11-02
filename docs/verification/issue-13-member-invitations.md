# Issue #13 — invite and manage business-account members with verified personal identities

Spec: https://github.com/mujahidul1slam/DokanOS/issues/13

## Outcome

- The owner, and only the owner, can invite an intended personal email to an
  existing business account. Members, nonmembers and platform admins do not get
  an implicit invitation right.
- An invitation is an intent row (`public.business_invitations`), not a business
  account, platform role, brand/store grant or permission grant. It is reachable
  only through SECURITY DEFINER RPCs: RLS is enabled with no client policy and
  the table has no `anon`/`authenticated` Data API privileges.
- Opening an invitation link only describes it. Joining is an explicit click by
  the signed-in, email-verified identity the owner invited. Personal signup and
  email verification never consume an invitation, and accepting one never
  provisions a business or a platform role.
- Acceptance is safely repeatable: an existing account membership returns
  `already_member`; wrong-email, unverified, revoked, expired, invalid and
  already-used links each have a distinct, honest outcome and grant nothing.
- Joining adds exactly one `user_business_access` row with role `member`
  (account-wide operational access). No `user_roles`, `user_store_access` or
  `user_permissions` rows are created.
- Membership management is owner-only through the API. Ordinary removal cannot
  remove an owner, including the caller removing themselves; ownership transfer
  remains #14.
- The app adds `/members` (owner-only invitation and removal controls; directory
  visible to account members) and an accept card on `/accounts?invite=…`. After
  acceptance the business context refreshes in place, so the new account is
  selectable without a reload.

## Migration

`supabase/migrations/20261019190000_business_member_invitations.sql`

- Table `business_invitations` with normalized lowercase email, role constrained
  to `member`, unique bearer token, 14-day expiry and accepted/revoked audit
  stamps. A partial unique index allows one open invitation per account/email
  while preserving history for later re-invitation.
- Helpers/RPCs: `business_invitation_state`,
  `invite_business_member`, `accept_business_invitation`,
  `describe_business_invitation`, `list_business_invitations`,
  `list_business_members`, `remove_business_member`,
  `revoke_business_invitation`.
- Every mutation writes the existing `audit_log`. The migration has a documented
  rollback block.

## Validation

Checked on integration tip `d5a428dfc000e5db3c5fbd70ba1a6bebcf45121f` using the
labelled disposable local project `issue13disposable261`. No deployed database
was migrated or mutated.

| Check | Latest result |
| --- | --- |
| Focused red test | `business_invitations_test.sql` failed first with `function public.invite_business_member(unknown, unknown) does not exist` |
| Fresh reset + full SQL/RLS battery | **ALL GREEN (13 files)**, including `business_invitations_test.sql` (AC-1…AC-12) |
| Real local Auth/PostgREST probes | **PASS** `business_invitation_boundaries_api` (owner-only issuance, direct ledger read/insert/update denial, wrong-identity describe, six actor denials) and **PASS** `business_invitation_acceptance_api` (wrong email, unverified, join with no platform/granular grants and no new business, repeat `already_member` with one row, revoke, owner-only removal incl. co-owner/self/nonmember, refreshed contexts) |
| Unit suite | **162 passed, 3 skipped** (23 new invitation-mapper tests) |
| Typecheck | **Passed** |
| Production build | **Passed** |
| Chrome accounts browser suite | **20 passed** (15 existing + 5 new) |
| Repository ESLint | **776 errors / 43 warnings**, unchanged from the `f2b2ba3`/`d5a428d` baseline; the two `AppSidebar` `no-explicit-any` diagnostics are pre-existing |

Browser coverage (real app, mocked Data API): owner invites by email, sees the
shareable link and pending state, revokes it and removes a member without any
business creation; a member sees the directory but no invitation/removal
controls and no Members navigation link; a verified invitee explicitly accepts
and immediately sees the refreshed account; a link for another identity shows
the mismatch and never calls accept; an already-used link explains itself
without a second acceptance. The SQL and API probes, not the browser mocks,
prove database authorization.

Detailed logs are in
`C:/Users/mujah/AppData/Local/Temp/opencode/accounts-8-15-check-logs/`
(`issue13-rls-red.log`, `issue13-rls-green.log`, `issue13-rls-final.log`,
`issue13-lint.json`).

## Deployment boundary

**No deployed database was changed and nothing was pushed.** Apply the migration
with the frontend together: the new `/members` surface calls RPCs that do not
exist on an older database. Deployed invitation links must continue to be built
from the trusted app origin (`/accounts?invite=…`); no auth redirect allowlist
change is required beyond the existing `/accounts` callback. Ownership transfer
(#14) and the final rehearsal (#15) are intentionally not implemented here.

## Standards / Spec check

- Server authority stays in SQL: the UI hides owner-only controls, but the RPCs
  independently reject non-owner callers and never grant membership to a
  mismatched or unverified identity.
- The invitation ledger mirrors the existing `signup_events` posture (RLS, no
  policy, no client privileges), so a bearer token cannot be listed or minted
  through a direct request.
- Acceptance writes only membership + invitation stamp + audit; the pure mapper
  keeps status/error copy testable and never renders an unreadable response as
  an open invitation.
- Scope stays inside #13: no ownership transfer, no granular grants, no business
  creation for invitees, and the #9 invitation-intent copy remains visible and
  non-accepting.
