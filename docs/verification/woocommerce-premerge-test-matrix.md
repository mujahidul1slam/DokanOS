# WooCommerce sync — pre-merge test matrix

Run on `pr/woocommerce-sync-recovery` @ `71eeaba` (now `e45d1a7`, docs only).
Host: Windows, Node v26.12.1, npm 11.20.0, Docker 29.9.3, Supabase CLI 3.2.0 (npx).
Local stack: `supabase start` + `supabase db reset` — all 217 migrations applied from scratch.

Nothing was merged. Nothing was applied to production.

## Verdict

The branch is sound. Every WooCommerce layer passes on a real stack, including
the two migrations that are missing from production. The remaining blockers are
**not defects in this PR** — they are pre-existing gaps on `main` and one missing
operator prerequisite.

| Suite | Result | Notes |
|---|---|---|
| Migration rehearsal (217 from scratch) | **PASS** | Both unapplied migrations apply cleanly |
| WooCommerce SQL battery | **PASS** 7/7 | rollback-only, real PostgreSQL |
| Vertical sync (real stack) | **PASS** 6/6 | was skipped for lack of a stack before |
| Durable intake race | **PASS** 16/16 | 8 concurrent deliveries converge on one row |
| Webhook bytea transport | **PASS** 3/3 | bytes preserved exactly through PostgREST |
| Typecheck | **PASS** | `tsc --noEmit` exit 0 |
| Unit tests | **PASS** 1074/1077 | 3 skipped need a real stack |
| Mocked browser suite | **PASS** 42/42 | Playwright, intercepted API |
| Production build | **PASS** | `vite build` exit 0 |
| Lint (PR's own files) | **PASS** | 29 changed TS/JS files clean |
| Personal signup API | **PASS** 1/1 | real GoTrue + PostgREST |
| RLS battery | **FAIL** 2/27 | pre-existing, files byte-identical to `main` |
| Smoke journey | **FAIL** step 1 | pre-existing drift, spec byte-identical to `main` |
| Ownership transfer API | **FAIL** | pre-existing: asserts `member`, ladder renamed to `manager` |
| Account lifecycle rehearsal | **FAIL** | pre-existing: same `member`/`manager` drift |
| Liveness fail-closed guard | **PASS** | proven to refuse duplicate live rows |

## What the PR actually fixes, proven

### The 23505 dead letters

Production raised `duplicate key value violates unique constraint
"woocommerce_sync_work_connector_id_identity_key_state_key"` and surfaced it as
`woocommerce_finish_failed`.

Cause: the old key was `UNIQUE (connector_id, identity_key, state)`. Because
`state` was part of the key it forbade duplicate *state buckets*, not duplicate
identities. Every enqueue used `ON CONFLICT (connector_id, identity_key, state)
DO NOTHING`, which only suppresses that exact triple — so once a row left
`pending`, the next reconciliation tick inserted a sibling with the same
`identity_key`, and a later transition into an occupied terminal state collided.

`20261113130000_woocommerce_work_identity_liveness.sql` replaces it with a
partial unique index over the live states only:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS woocommerce_sync_work_live_identity_key
  ON public.woocommerce_sync_work (connector_id, identity_key)
  WHERE state IN ('pending', 'leased', 'retrying');
```

Verified on the live local database after `db reset`:

- old state-inclusive unique constraint: **none**
- index `woocommerce_sync_work_live_identity_key`: **present**
- functions still using the old conflict target: **0**
- functions repointed at the partial index: **4**
  (`enqueue_woocommerce_reconciliation_work`, `create_woocommerce_work_correction`,
  `enqueue_woocommerce_status_write`, `resolve_woocommerce_sync_conflict`)
- terminal states now unbounded: two `replayed` rows for one identity accepted
  (this was the exact production failure)

### The fail-closed guard

The migration refuses to install the index over data that would violate it.
Proven by extracting the guard's `DO $$ ... END $$;` block and running it
against a fixture holding two live rows for one identity:

```
PASS  index dropped inside transaction (pre-migration state)
PASS  fixture holds 2 live rows sharing one identity — got 2
PASS  guard refused to proceed
PASS  message names the index
PASS  message reports 1 group / 2 rows

cannot install woocommerce_sync_work_live_identity_key: 1 (connector_id,
identity_key) group(s) holding 2 live row(s) have more than one row in
pending/leased/retrying; collapse each group to a single live row before migrating
```

This matters for the production run: the migration comment says production held
**8 identity groups with more than one row**. If any of those groups has two
*live* rows, the migration aborts instead of half-applying. **Check read-only
first** — see below.

### The ordering hazard

`supabase/functions/woocommerce-worker/index.ts:158` calls
`upsert_woocommerce_order_v2` with no fallback. That function does not exist
until `20261112160000_woocommerce_order_contract_v2.sql` is applied. Deploying
functions before migrations would make every inbound import fail on a missing
function. The runbook previously said the reverse order; it is now corrected.

Both RPCs coexist after the migration, which is what makes the safe order safe:

```
upsert_woocommerce_order_v2(uuid,bigint,...,jsonb,jsonb,text,boolean)   -- 25 args
upsert_woocommerce_order(uuid,bigint,...,jsonb,jsonb)                   -- 23 args, retained
```

The deployed v4 worker keeps working against the new schema until it is replaced.

## Pre-existing failures (not caused by this PR)

Every failure below reproduces on files that are **byte-identical to
`origin/main`** — `git diff origin/main...HEAD` returns 0 lines for each.

### 1. Smoke journey — step 1

`tests/smoke/full-journey.spec.ts` and `src/pages/Signup.tsx` are both unchanged
by this branch. Three independent causes, all on `main`:

1. **Missing field.** `Signup.tsx` requires Confirm Password (added in `6dac1fc`
   "feat(signup): require confirm password on personal signup", which is on
   `main`). The spec never fills it, so submission is blocked by HTML validation.
2. **No signup gate.** A clean `db reset` seeds `app_config.signup_open = false`
   (fail-closed by design). The spec's own comment says "is_signup_open RPC must
   return true for smoke" but nothing opens it. The app renders
   "Sign Up Currently Closed" and no form exists.
3. **Stale assertion.** Even after fixing both, the spec expects
   `toHaveURL(/\/check-email/)`. `Signup.tsx:158` does navigate there, but
   `App.tsx:136` redirects authenticated users from `/check-email` to
   `/accounts`, and `signUp` establishes a session — so the URL never sticks.

This job is `if: workflow_dispatch || vars.SMOKE == 'true'` and has never gated
merges. It needs its own repair ticket; it is not a merge blocker for this PR.

### 2. RLS battery — 2 of 27 files

| File | Failure |
|---|---|
| `rls_hardening_test.sql` | `relation "public.sync_queue" does not exist` |
| `api_table_grants_test.sql` | `anon` lacks DML on `public.order_brands` for its own policies |

`sync_queue` was dropped by `20261103160000_retire_woocommerce_integration.sql`,
which is on `main`. The test still asserts on it. The `order_brands` mismatch is
a grants-vs-policy drift also on `main`. Neither file is touched by this branch,
and `npm run test:rls` is **not** a CI gate.

Also worth noting: `npm run test:rls` chains `supabase db reset`, so it cannot
run against a dirty stack. Running it after the WooCommerce SQL battery produced
4 failures instead of 2 — the extra 2 were fixture pollution from my own race
test (a leaked `WooCommerce SQL fixture business`), not real defects. On a clean
reset it is 2.

### 3. Role-ladder drift in two opt-in scripts

`scripts/ownership-transfer-api.test.mjs` and
`scripts/account-lifecycle-rehearsal.test.mjs` assert `role === "member"` and
insert `role: "member"`. The ladder was renamed
`owner/admin/member/viewer` → `owner/admin/manager/staff` by
`20261101090000_role_ladder_rename.sql`, which is on `main`. Both scripts are
unchanged by this branch and neither is in CI. They need a one-word update each.

## Operator prerequisite for production

`SUPABASE_ACCESS_TOKEN` is unset in a fresh shell. The Windows Credential
Manager entry `Supabase CLI:supabase` is the CLI's own login and does **not**
export the variable. The guarded runner refuses without it. This is now
recorded in the runbook, correcting an earlier claim that the credential was
"available".

## Recommended order for production

1. Read-only check for duplicate live rows (the guard's own predicate):

   ```sql
   SELECT connector_id, identity_key, count(*)
     FROM public.woocommerce_sync_work
    WHERE state IN ('pending','leased','retrying')
    GROUP BY connector_id, identity_key
   HAVING count(*) > 1;
   ```

   Any row returned must be collapsed to one live row per group **before** the
   migration, or the migration aborts (by design).

2. Export `SUPABASE_ACCESS_TOKEN`.
3. `node scripts/prod-migrate.mjs --apply --change-id <id> --expect-ref jiwndicvfkiltgageqwv`
   — applies `20261112160000` then `20261113130000`.
4. `node scripts/prod-deploy-functions.mjs --apply --change-id <id> --expect-ref jiwndicvfkiltgageqwv`
   — only after step 3 succeeds.
5. Confirm the ledger shows 217 and the `audit_log` rows exist for both actions.

## Local environment notes

- Docker daemon must be running; it was down at session start.
- `supabase` is not on PATH. Use `npx supabase@latest`, or the npx-cached binary
  at `%LOCALAPPDATA%\npm-cache\_npx\aa8e5c70f9d8d161\node_modules\@supabase\cli-windows-x64\bin\supabase.exe`.
- `supabase start` initially left `supabase_edge_runtime` **stopped**, which made
  signup fail with a 503 `name resolution failed`. A full `supabase stop` then
  `supabase start` brought it up. Any Edge-Function-dependent test needs it.
- Vite serves on **8080** per `vite.config.ts`, not 5173. The smoke config forces
  `--port 5173 --strictPort`.
- `npm run lint` fails repo-wide with 632 errors in 143 files, none of them
  touched by this PR. Lint is not a CI gate. Scoping eslint to the PR's 29
  changed files exits 0.
- `test-results/` is gitignored but eslint's default glob walks it; running lint
  while Playwright is deleting that directory produces a spurious `ENOENT`.
