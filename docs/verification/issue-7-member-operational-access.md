# Issue #7 (user stories 30–35) — account members reach operational modules

Spec: https://github.com/mujahidul1slam/DokanOS/issues/7
Related: #10 (account boundaries), #11 (brand nav fallback), #13 (invitations)

## Outcome

- A verified member of the active business account (a `user_business_access`
  row with role `member`, no legacy `user_roles`/`user_permissions` rows — by
  design per #13 AC-3) now resolves the reviewed operational permission
  baseline and can use the operational modules the server already authorizes
  through `user_business_access` (#10 RLS).
- The resolver mirrors the #11 sidebar nav-role mapping exactly:

  | account membership role | resolved baseline |
  | --- | --- |
  | `owner` / `admin` | admin (full permission set) |
  | `member` | staff (operational defaults) |
  | `viewer` | viewer (read-only basics) |

- The account membership baseline applies **only when the user holds no legacy
  permission rows**. Existing legacy users keep exactly what they had; the
  baseline never widens legacy grants. A platform admin (`isAdmin`) is
  unchanged.
- Strictly preserved: account isolation (the baseline comes from the active
  membership, and server RLS still scopes every operational table through
  `user_business_access`); owner-only management (invitations, membership
  management, ownership transfer, deletion) — members map to staff, which holds
  no `.manage`/`team.manage`/`settings.manage`/`audit.view` keys; viewer
  read-only; no `user_roles`, `user_permissions`, `user_store_access`, business,
  brand or store row is created on any client path.
- Ownership transfer (#14) and the final rehearsal (#15) are not implemented.

## Implementation

`src/hooks/usePermissions.tsx`

- `accountBaselinePermissions(role)` returns the reviewed baseline (staff/viewer
  key sets mirror the SQL `has_permission` presets; owner/admin = the full set).
- `PermissionsProvider` consumes the active business context (`active`,
  `myRole`) and, when the user holds no legacy permission rows, exposes the
  membership baseline through `can` / `canAny` / `permissions`. `loading`
  remains true until the membership context settles, so guarded routes never
  flash a denial.

`src/App.tsx`

- Provider order is `Auth → BusinessContext → Permissions` (previously
  `Auth → Permissions → BusinessContext`) so the resolver can read the active
  membership. `BusinessContextProvider` has no dependency on permissions, so the
  swap is behaviour-preserving for every other consumer.

`src/pages/Orders.tsx`

- `canWrite` now follows the resolved permission baseline
  (`can("orders.create") || can("orders.edit")`) instead of the legacy
  `useAuth().role` string, so a first-release member gets the staff-level order
  write affordances while a viewer stays read-only. This is the only operational
  write gate that bypassed `can(...)`; every other write affordance already
  resolved through the permission hook.

No migration and no server change: the database/API already authorize members
(#10). This closes the UI-only gap recorded in the #13 merger checkpoint.

## Validation

Run on a fresh disposable local Supabase project
`memberaccess20261019` (`C:/Users/mujah/AppData/Local/Temp/opencode/member-access-disposable`).
No deployed database was migrated or mutated; nothing was pushed or merged.

| Check | Result |
| --- | --- |
| Focused red | `src/test/accountPermissions.test.tsx` **5 failed** before the fix (member/owner operational cases returned "no") |
| Focused green | **9 passed** after the fix |
| Fresh reset + full SQL/RLS battery | `supabase db reset` (169 migrations) then `node scripts/run-rls-tests.mjs` **ALL GREEN (13 files)** |
| Real Auth/PostgREST probes | battery includes `account_boundaries_api` (member-allow read; nonmember/legacy-staff cross-account deny), `business_invitation_boundaries_api` + `business_invitation_acceptance_api` (owner-only issuance/removal denied for member/viewer/admin/nonmember/other-account; join created **0** `user_roles` / `user_store_access` / `user_permissions` / business rows; cross-account brand read denied) |
| Real local Auth | `RUN_LOCAL_AUTH_TESTS=1 node --test scripts/personal-signup-api.test.mjs` **1/1 passed** |
| Unit suite | **171 passed, 3 skipped** (9 new resolver tests) |
| Typecheck | **Passed** |
| Production build | **Passed** |
| Chrome accounts browser suite | **24 passed** (20 existing + 4 new member/viewer/owner/nonmember cases) |
| Repository ESLint | **776 errors / 43 warnings**, zero normalized per-file/rule/message delta vs the integration tip `ddf6c2c` |

Browser coverage (real app, mocked Data API): an account member reaches `/` and
`/orders` without "Access denied" and can create orders, with no
`user_roles`/`user_permissions` write issued; a viewer views `/orders` but gets
no Add Order control and stays denied at `/pos`; an owner retains operational and
management surfaces; a signed-in non-member never reaches operational routes.
The SQL and real-PostgREST probes, not the browser mocks, prove database
authorization.

Detailed logs are in
`C:/Users/mujah/AppData/Local/Temp/opencode/accounts-8-15-check-logs/`
(`member-access-focused-red.log`, `member-access-focused-green.log`,
`member-access-db-reset.log`, `member-access-rls-final.log`,
`member-access-real-auth.log`, `member-access-lint.json`,
`member-access-lint-compare.mjs`).

## Deployment boundary

**Local only, not the default branch.** No deployed database changed and no
push. The change is frontend-only and can ship with the rest of the accounts
slice; no migration ordering constraint is introduced.
