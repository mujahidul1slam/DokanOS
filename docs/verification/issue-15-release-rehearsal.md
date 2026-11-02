# Issue #15 — rehearse migration and verify the complete account-to-store and invitation journeys

Spec: https://github.com/mujahidul1slam/DokanOS/issues/15

Release-verification/consolidation slice for the accounts series (#8–#14), run on
a fresh worker branch based exactly on the integration tip
`ca876ab706c2ab68f20f00f7d2858a1fa7e08572`. It adds rehearsal seams, an
end-to-end rehearsal and a minimal contract-removal change; it adds membership-only
authorization corrections for brand/store paths and retires legacy combined-setup
execution without implementing deferred scoped-permission behavior.

## Outcome

- **End-to-end rehearsal** against the integrated implementation, on real Chrome
  (behaviour) and a real local Supabase stack (authorization):
  personal signup → email verification → business account → brand → **physical
  and online** store → invitation for a **new invitee** (their own registration +
  verification, then explicit acceptance) → invitation for an **existing
  person** → account switching, owner/member restrictions, direct API/RLS
  isolation, and legacy operational data still readable.
- **Migration rehearsal** composes the issue #8 readiness seams
  (`auditLegacyAccounts`, `rehearsePreservation`) into a thin routing layer
  (`src/lib/accounts/migrationRehearsal.ts`). Reviewed exceptions resolve exactly
  the records they cover; multiple owners, shared/unlinked resources and legacy
  global authority stay **release blockers** and are never guessed away.
- **Contract removal (minimal, conservative):** the dead `signup-provision` edge
  function and its `config.toml` entry are deleted, `/onboarding` redirects to the
  app, and `create_my_brand_store` remains defined but loses authenticated EXECUTE.
  The inert service-role-only `provision_owner_business` RPC is retained and recorded
  as a separate cleanup residual (see below) per `docs/account-migration-readiness.md` §5.
- **Release gate result: BLOCKED.** The migration rehearsal preserves every
  fingerprinted legacy record and legitimate access, but seven affected records
  still require an operator decision. This is a release blocker, not a passing
  result.

## Validation

### Opt-in real-backend scripts

These scripts are deliberately separate from `npm test` and do not run by default.
Use a freshly initialized, disposable localhost Supabase project only (never a linked
or deployed project), then opt in explicitly:

```powershell
$env:RUN_LOCAL_AUTH_TESTS = '1'
npm run test:local:personal-signup-api
npm run test:local:ownership-transfer-api
$env:RUN_LOCAL_REHEARSAL = '1'
npm run test:local:account-lifecycle-rehearsal
```

The API scripts require the local Auth/PostgREST URLs and service credentials emitted
by `supabase status`; the harness rejects non-local endpoints. The rehearsal requires
the local DB URL. Ensure the project is disposable and freshly migrated before running;
these scripts never perform a database reset themselves. Default Vitest runs and
`npm test` do not invoke any of them.

Run on a fresh disposable local Supabase project (project id
`jiwndicvfkiltgageqwv`, disposable launch directory
`C:/Users/mujah/AppData/Local/Temp/opencode/issue-15-disposable`). `supabase db
reset` applied **170** migrations. No deployed database was migrated or mutated;
nothing was pushed or merged.

| Check | Result |
| --- | --- |
| Focused red → green | `src/lib/accounts/migrationRehearsal.test.ts` + `migrationRehearsalCli.test.ts` **7 passed (2 files)** |
| Fresh reset + full SQL/RLS battery | `supabase db reset` (170 migrations) then `node scripts/run-rls-tests.mjs` **ALL GREEN (14 files)**, including the real PostgREST/RLS probe set |
| Real-backend rehearsal | `RUN_LOCAL_REHEARSAL=1 node --test scripts/account-lifecycle-rehearsal.test.mjs` **1/1 passed** |
| Real local Auth/PostgREST | `RUN_LOCAL_AUTH_TESTS=1 node --test scripts/personal-signup-api.test.mjs` **1/1 passed**; `.../ownership-transfer-api.test.mjs` **1/1 passed** |
| Migration-fixture rehearsal | `audit-legacy-accounts.mjs` pre-change **exit 2 (7 blockers)**; post-change `--baseline` rehearsal **exit 2, `preservation: {preserved:true, violations:[]}`, `ready:false`** |
| Unit suite | **201 passed / 3 skipped** (23 files passed, 1 skipped) |
| Typecheck | **Passed** |
| Production build | **Passed** |
| Chrome accounts browser suite | **30 passed** (`PLAYWRIGHT_CHANNEL=chrome`) |
| Repository ESLint | **775 errors / 43 warnings** vs integration tip **776 / 43**: zero added diagnostics, one removed (the deleted `signup-provision/index.ts` `no-explicit-any`) |

### What the browser suite proves

`tests/accounts/account-lifecycle-rehearsal.spec.ts` drives the real app and
Supabase SDK (Data API mocked): personal signup has no business fields and never
calls `/signup-provision`; business creation issues no `brands` / `stores` /
`storefronts` write and never calls `provision_owner_business`; a brand is
created name-only with `woo_store_id: null`; a physical and an online store are
created under that brand and stay unpublished; a brand-new invitee registers,
verifies (invitation intent preserved, **no** acceptance) and only then accepts,
gaining a `member` membership and **no** `user_roles` write; an existing person
accepts and sees the directory with **no** invitation/removal controls.

### What the real-backend rehearsal proves

`scripts/account-lifecycle-rehearsal.test.mjs` uses real GoTrue, PostgREST/RLS and
PostgreSQL: business creation provisions **no** legacy `stores` or `storefronts`
(delta-scoped counts); the first business is exactly one `owner` membership; the
owner creates a brand and one `physical` + one `online` store (both
`is_published = false`); a new invitee's confirmation does **not** accept; the
explicit acceptance yields role `member` and creates **zero** `user_roles` /
`user_permissions` rows; an existing person joins as `member`; account switching
shows `member` in the joined account and `owner` in the invitee's own account; a
member is refused invitation, ownership transfer and owner removal; a non-member
cannot read a foreign account's brands, cannot direct-insert a store under a
foreign brand, and cannot create one via the RPC; legacy `orders` stay readable.

### Migration rehearsal result

Representative pre-change fixture (`scripts/fixtures/account-readiness/rehearsal/`)
covers an unambiguous mapped connector (`stores:clean` → `online`), a
`retain-legacy` location, **multiple owners**, a **shared** Woo connection (two
brands), an **unlinked** connection, and **legacy global grants** (a global
`admin` role and a global permission revoke).

| Report | Result |
| --- | --- |
| Pre-change | `ready:false`, **7** blockers: `multiple-owners`, `shared-resource`, `unlinked-resource`, two `global-authority`, two `mapping-review` |
| Post-change vs baseline | `preservation: {preserved:true, violations:[]}`; **7** blockers (`ready:false`) |

The two reviewed mappings resolve only their own `mapping-review` blockers
(`stores:clean`, `locations:warehouse`); everything else is retained verbatim.
An additive slice (the new `brand_stores` link) does not touch fingerprinted
legacy history or membership records, so preservation holds — but the release
stays **blocked** until a human resolves the records a mapping cannot.

## Contract removal

| Change | Detail |
| --- | --- |
| Deleted `supabase/functions/signup-provision/` | The last consumer of the legacy forced-provisioning path; no active code invoked it |
| Removed `[functions.signup-provision]` from `supabase/config.toml` | The function was already deployable-dead |
| `src/components/CreateBusinessDialog.tsx`, `/onboarding` route | Creation switches to the account app screen; the retired wizard redirects, and no reserved storefront/automatic store is promised |
| `20261020100000_retire_legacy_combined_setup.sql` | Revokes authenticated execute on the legacy combined setup RPC while retaining its definition for rollback/cleanup review |

## Rollback and release gates

1. **Expand first, review before backfill** — no existing rows are changed or
   deleted. The legacy combined-setup RPC execute grant is revoked; its definition
   and existing data remain intact.
2. **Rollback** — restore the authenticated EXECUTE grant only as part of a reviewed
   rollback that also restores the compatible wizard. Do not drop the function or
   clean deployed rows as part of this change. The retained
   `provision_owner_business` RPC remains service-role-only, so restoring the deleted
   edge function remains a separate deployment decision.
3. **Do not cut over while the regression blocker is open.** Affected records
   (multiple owners, shared/unlinked connectors, legacy global authority) and
   their dependent operations must remain untouched until an operator resolves
   them per `docs/account-migration-readiness.md`.
4. **Destructive contract cleanup is a separate later approval.** Removing the
   now-inert provisioning RPC and its generated types is deliberately out of
   scope here.

## Final review corrections

- Owners ignore restrictive legacy permission and selected-store rows. Members receive account-wide
  operational UI capabilities (including refund/delete/analytics and store/integration
  operations), independent of legacy permission and selected-store rows; team membership
  controls and global settings/audit controls remain excluded because their existing
  backend checks are owner/platform authority. Legacy `admin` is operational, not owner.
  Viewers are constrained to the compatibility read-only capability set even when legacy
  rows contain writes. No active membership fails closed. Server membership isolation
  remains authoritative.
- Global platform role alone cannot read or create brands/brand stores through the new
  account paths. Direct API/RLS probes cover global admin, global staff, foreign
  account, viewer, member, and forged parent identities. The unresolved global-authority
  records in the readiness report remain release blockers; no rows are reassigned or
  stripped.
- `handle_new_user` pins an empty search path; the SQL suite checks its catalog
  configuration. Real-backend scripts are explicitly opt-in and separate from
  `npm test`.

Final review verification on the worker branch: fresh disposable local reset applied
171 migrations; `node scripts/run-rls-tests.mjs` **ALL GREEN (14 files)**; real local
Auth/PostgREST signup, ownership-transfer, and lifecycle scripts **1/1 each**; unit
suite **210 passed / 3 skipped**; typecheck/build passed; Chrome accounts suite
**30/30**. Chrome runs the real routed UI with mocked Data API responses; it is not
real-browser/real-backend E2E. Separate real-backend scripts and the RLS battery prove
server authorization. Lint remains at the
known **775 errors / 43 warnings** baseline; normalized changed-source diagnostic delta
is **0 added / 0 removed**. The fixture rehearsal remains **7 blockers**, with
`preservation: { preserved: true, violations: [] }`.

## Residual blockers

1. **Migration release blocker (7 records).** Multiple owners
   (`businesses:account`), shared/unlinked connectors (`stores:shared`,
   `stores:unlinked`) and legacy global authority (`user_roles:global-admin`,
   `user_permissions:global-revoke`) require operator decisions
   (`docs/account-migration-readiness.md`). The rehearsal must stay red until
   they are resolved; do not filter them out to make a slice look ready.
2. **Retained inert RPC.** `provision_owner_business` still exists as a
   service-role-only function, still appears in the generated
   `src/integrations/supabase/types.ts`, and is still exercised by the operator
   script `scripts/test_signup_rpc.sql`. It has no caller in the application or
   edge functions. Remove it (and the script) only under the later destructive
   cleanup approval.
3. **Deferred scoped permissions.** Granular per-user/per-store permissions
   remain deferred by issue #7 and are not implemented or rehearsed here.
4. **Host quirks (test-local, not production config).**
   - The local **edge runtime crashes** on this host, so the disposable stack was
     started with `supabase start -x edge-runtime`; the real-backend rehearsal
     crosses the business-creation seam through the service-role
     `create_additional_business` RPC that mirrors the `create-business` edge
     function. The edge-function hand-off itself is covered by the mocked browser
     suite.
   - The CLI reported a local-vs-linked-version skew (postgres `17.6.1.147` vs
     `17.6.1.166`, gotrue `v2.194.0` vs `v2.197.0`, storage-api `v1.67.15` vs
     `v1.80.2`) and the installed CLI is `2.107.0`; banners are local-only.
   - Chrome is the required browser (`PLAYWRIGHT_CHANNEL=chrome`); the bundled
     headless shell is incomplete on this host.
   - The real-Auth confirmation probe requires local email confirmations, supplied
     by a **disposable-only** `[auth.email] enable_confirmations = true` override in
     the disposable launch directory — never committed to the repository config.

## Reproduce

```powershell
# disposable stack (local-only confirmation override under a temp workdir)
supabase start -x edge-runtime --workdir <disposable>
supabase db reset
node scripts/run-rls-tests.mjs
$env:RUN_LOCAL_REHEARSAL=1;   node --test scripts/account-lifecycle-rehearsal.test.mjs
$env:RUN_LOCAL_AUTH_TESTS=1;  node --test scripts/personal-signup-api.test.mjs
$env:RUN_LOCAL_AUTH_TESTS=1;  node --test scripts/ownership-transfer-api.test.mjs

# browser + unit + gates
$env:PLAYWRIGHT_CHANNEL='chrome'; npx playwright test --config playwright.accounts.config.ts
node node_modules/vitest/vitest.mjs run
npm run typecheck; npm run build
```

Detailed logs are in
`C:/Users/mujah/AppData/Local/Temp/opencode/accounts-8-15-check-logs/issue-15/`
(`focused-tests.log`, `db-reset.log`, `rls-tests*.log`, `rehearsal-real.log`,
`personal-signup-real.log`, `ownership-transfer-real.log`, `unit-full.log`,
`pw-accounts.log`, `typecheck.log`, `build.log`,
`issue-15-pre-report.json`, `issue-15-rehearsal-report.json`, `lint-*.json`).

## Deployment boundary

**Local only, not the default branch.** No deployed database changed and no push.
The application change is copy-only plus the removal of a dead edge function; the
rehearsal seams are test/documentation code. Shipping is gated on resolving the
migration release blocker above.
