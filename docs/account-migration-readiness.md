# Account migration readiness — issue #8

Scope: [Accounts 1/8](https://github.com/mujahidul1slam/DokanOS/issues/8), under
[the confirmed account model](https://github.com/mujahidul1slam/DokanOS/issues/7).
This is evidence collection and a release gate, **not a migration**. No application
reader, RPC, RLS policy, signup flow, membership, resource or deployed row is changed.

## Run the read-only audit

Requires Node **22.18+** (native TypeScript stripping) and the existing `pg` dependency.
From the repository root:

```powershell
node scripts/audit-legacy-accounts.mjs --fixture scripts/fixtures/account-readiness/safe.json --mappings scripts/fixtures/account-readiness/reviewed-mappings.json --out safe-report.json
node scripts/audit-legacy-accounts.mjs --fixture scripts/fixtures/account-readiness/ambiguous.json --mappings scripts/fixtures/account-readiness/reviewed-mappings.json --out blocked-report.json
```

Exit codes: **0** = no detected blockers for a reviewed additive slice; **2** = report
written, but affected migration paths are blocked; **1** = incomplete/invalid evidence
or collection/output failure. Existing output files are never overwritten. Store
real reports outside version control in a private directory (on Windows, enforce
directory ACLs; POSIX mode `0600` alone does not establish Windows ACLs).

For an operator-approved database inspection, explicitly supply `AUDIT_DATABASE_URL`
and run `node scripts/audit-legacy-accounts.mjs --database --out <new-private-report.json>`.
The command never discovers application env files, remote credentials or Supabase
project links. Do not run it against deployed infrastructure without approval.
Use a dedicated auditor with `SELECT` on every inventoried table and `BYPASSRLS`;
do not grant it write privileges. Provisioning that role is a separate human action.

The collector uses one `REPEATABLE READ READ ONLY` transaction, disables RLS filtering,
sets a 30-second per-statement timeout, and always rolls back. Missing tables/columns,
permissions, unsupported composite/cross-schema FKs, or SQL failures abort collection;
there is no partial-success report. The entire inventory is held in memory: schedule
large audits appropriately and do not interpret timeout/OOM as an empty database.

## Inventory and gates

The report includes all `public` base tables (partition roots include their rows),
`auth.users` identity IDs, catalog-discovered foreign keys and known legacy links
that lack FKs. For every row it records its ID/key, relationship IDs, selected
authority/type fields and a SHA-256 full-row fingerprint calculated **inside PostgreSQL**.
Credential values, emails, order notes, addresses and arbitrary JSON payloads are not
exported. IDs and fingerprints are still sensitive. Nonempty opaque JSON columns are
flagged for review, not parsed to invent ownership. Config-only/embedded references
therefore cannot become a false ready result. RLS policy and relevant authorization
function definitions/EXECUTE ACLs and ownership, table/column/schema ACLs and ownership, table RLS flags,
database role capabilities and role membership are fingerprinted, not exported as source code.

| Evidence | Blocking cases |
| --- | --- |
| `businesses`, `user_business_access`, `auth.users` | Missing owner, multiple owners, missing identities/accounts; legacy `admin`/`viewer` roles require an explicit authority decision. Existing owners are never demoted. |
| `user_roles`, permission overrides (including revokes), custom roles/assignments, store assignments, permission settings and invitations | Global roles/grants/restrictions and legacy invitation intent are retained verbatim. Assignments/invitations block normalization; they never imply account membership. An empty store-assignment list is not evidence of account isolation. |
| `brands.woo_store_id`, `storefronts.brand_id/store_id`, locations and selling points | No established brand/account, more than one brand/account, dangling links, inconsistent account identifiers, or lack of an explicit physical/online versus retain-legacy decision. |
| All discovered operational relationship paths | Missing targets, unscoped operations, and cross-account references. Includes indirect history such as order items → orders, stock → products/locations, source registries, POS, fulfillment and storefront children where those tables exist. |
| Full row and authorization fingerprints | Rehearsal blocks removed/changed legacy rows, removed relationship contracts, and added/changed/removed authorization evidence, including ACLs and RLS flags. Additive data rows/tables/references are permitted, but authorization changes need separate review. |

Legacy `stores` rows are WooCommerce connections; a `location`, `selling_point` or
`storefront` is **not automatically** a store in the new model. Relationship graphs
establish only candidate parent brands/accounts. No source/name/channel heuristic
can establish physical/online type. Brands with no stores and empty accounts are valid.

Every legacy resource candidate requires a mapping record, illustrated in
`scripts/fixtures/account-readiness/reviewed-mappings.json`: resource key, exact row
fingerprint, brand, named reviewer, evidence, and either `disposition: "store"` with
`storeType: "physical" | "online"`, or `disposition: "retain-legacy"`. Retaining an
operational warehouse/connector does not manufacture a selling operation. These
records are review evidence only, not executable assignments. Stale/duplicate,
unlinked or conflicting decisions cannot override blockers. Global-authority
exceptions and multiple owners deliberately have **no automatic override** here.

Each blocker names an affected resource (or incomplete table). Do not apply a migration
to a blocked resource, its connected candidates or dependent operations. A whole-report
failure is deliberately conservative; partitioning an unaffected slice requires a
separately reviewed dependency boundary, not filtering out inconvenient blockers.

## Preservation rehearsal

Capture an isolated fixture baseline, rehearse a **separately approved additive slice**
only in a disposable database, then collect again using the original baseline:

```powershell
node scripts/audit-legacy-accounts.mjs --fixture after-inventory.json --mappings reviewed-mappings.json --baseline before-report.json --out rehearsal-report.json
```

`--baseline` accepts either a prior report or inventory; it never runs migration SQL.
Its `preservation` result verifies surviving identifiers, payload fingerprints,
relationships, membership roles, global grants/revokes and authorization evidence.
Full-row fingerprints are strict: even an additive column default may change a
fingerprint and require reviewed, column-specific preservation evidence in the later
slice. Do not regenerate the baseline simply to make a difference disappear.

This is necessary evidence, **not proof of effective authorization**. Later slices
must use real authenticated owner/member/nonmember and multi-account requests to
prove account isolation, protected owner management and retained intended access.
This slice changes no authorization and does not replace those tests. The glossary
also describes future granular permissions; those are deferred by issue #7.

## Compatibility and rollback boundaries for subsequent slices

1. **Expand first:** add nullable/versioned mapping structures and explicit store
   types without reinterpreting or removing `stores`, locations, selling points,
   storefront links, membership/global-grant tables or their existing IDs. Each new
   store must have one brand; its business account is derived from that brand.
2. **Review before backfill:** retain the immutable inventory and reviewed decisions.
   Shared/unlinked/type-ambiguous resources, additional owners and global authority
   require operator decisions and preservation/access tests. No guessed reassignment,
   deletion, merge, implicit memberships or silent grant stripping.
3. **Keep compatibility readers:** introduce adapters/parallel readers for operations,
   inventory, fulfillment, integrations, storefronts and account routing. Do not drop
   old columns/RPCs or publish storefronts as a side effect. Signup/business/brand
   decoupling belongs to later tickets, not this audit.
4. **Gate cutover:** rehearse identifiers/history/access preservation and real server
   authorization, including cross-account forged IDs, retry behavior and owner
   protection. An audit passing on synthetic fixtures is not deployed-data approval.
5. **Rollback before contract:** switch back to compatible readers only while all new
   writes remain representable there. Keep additive data/mappings; do not delete new
   operational history or restore an old database over live writes. After writes
   diverge, require a reviewed reverse adapter/forward repair and reconciliation.
   Changed authorization needs its own reviewed rollback, not restoring a known
   cross-account bypass. Destructive contract cleanup is a separate later approval.

## Reproducible verification

```powershell
npx vitest run src/lib/accounts/legacy-readiness.test.ts src/lib/accounts/legacy-readiness-cli.test.ts
npm run typecheck
```

The CLI tests execute both committed fixtures and verify exit codes, preservation of
input/access and refusal to overwrite evidence. Observed results:

| Fixture | Outcome |
| --- | --- |
| Safe inventory + reviewed online mapping | Exit 0; one parent brand/account, original history and owner/member memberships retained. |
| Ambiguous inventory + same decision | Exit 2; shared Woo connection, unlinked connection, unreviewed location/type, multiple owners, global admin and permission-revoke exceptions block. Nothing is reassigned or removed. |
| Additive rehearsal | Preserved; additional table/link permitted. |
| Deleted order / reassigned membership rehearsal | Blocked with `row-removed` / `row-changed`. |

Real PostgreSQL collection tests are opt-in:

```powershell
$env:ACCOUNTS_AUDIT_TEST_URL = 'postgresql://<local-test-admin>:<password>@localhost:<port>/postgres'
npx vitest run src/lib/accounts/legacy-readiness-db.test.ts
```

The URL must be localhost. The harness creates a randomly named
`dokanos_accounts_fixture_*` database, installs the representative legacy fixture,
and drops **only that database**. The supplied role needs CREATEDB and BYPASSRLS
(a dedicated local test superuser is suitable). It never resets Supabase or touches
application tables in an existing database. This fixture exercises actual PostgreSQL
catalog/transaction/hash behavior, not the entire application migration/RLS suite.
Without the explicit URL, these tests are visibly skipped. During implementation,
Docker/local PostgreSQL was unavailable, so these integration checks remain a release
verification gate; no deployed inspection or migration was attempted.

Validation snapshot (2026-10-19, local `Frontpage` including the concurrently landed
personal-signup slice): full Vitest suite **134 passed, 3 PostgreSQL tests skipped**;
typecheck and production build passed; targeted lint passed. Repository-wide lint
still fails with **780 errors and 43 warnings outside this slice**; this work does
not change those files. Two-axis review found and corrected missing owner identity
validation, authorization-addition handling, and ACL/RLS preservation evidence; the
collector and offline auditor now share known legacy relationship definitions.
