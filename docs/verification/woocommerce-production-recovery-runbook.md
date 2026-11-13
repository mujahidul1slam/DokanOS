# WooCommerce production recovery runbook

> **Reviewed procedure with production evidence.** This document does not itself execute production changes. It describes the controlled procedure and the reviewed adapters (`scripts/prod-migrate.mjs`, `scripts/prod-deploy-functions.mjs`, `scripts/prod-schedule.mjs`) that replace ad-hoc SQL and `supabase db push`. Production actions recorded below were performed under change ID `CHG-2026-11-12-01`; no action was performed by copying SQL from this document.

## For Mujahid

- The reviewed adapters now exist: `scripts/prod-migrate.mjs`, `scripts/prod-deploy-functions.mjs`, and `scripts/prod-schedule.mjs`. They refuse uncommitted or mismatched targets and write audit rows naming the change ID and git commit where applicable.
- Job 18 is proven: `woocommerce-sync-worker-5min`, every 5 minutes, job ID 18; job 19 is `woocommerce-reconciliation-15min`. Both identities came from the live database, not a guess. Job 18 was paused during containment, then resumed only after the migrations and function deployments were verified; both actions are audited.
- Change ID `CHG-2026-11-12-01` is the audit anchor. The production database password was not available and was not needed: production migrations and audit writes use the Supabase Management API with the CLI's existing access token, held in the environment and never printed.
- Webhook intake stayed enabled throughout: both connectors remained `intake_enabled=true` and `webhook_status=active`. The scheduler token was rotated through the reviewed adapter; its value was never displayed.

## Scope and non-goals

This recovery covers the WooCommerce connector, worker, reconciliation, and auditable replay path. It does **not** perform ad-hoc SQL, direct production writes, `supabase db push`, secret inspection, or destructive cleanup. All production changes must flow through a reviewed pull request and the protected deployment environment.

The repository currently contains:

- `supabase/functions/woocommerce-webhook` for signed durable intake.
- `supabase/functions/woocommerce-worker` for durable work processing.
- `supabase/functions/woocommerce-reconcile` for overlapping REST reconciliation.
- `supabase/functions/woocommerce-admin` for audited health, pause/resume, replay, correction, and conflict controls.
- Migration-managed pg_cron jobs named `woocommerce-sync-worker-5min` and `woocommerce-reconciliation-15min` in `supabase/migrations/20261110090000_woocommerce_order_connector.sql`.
- Read-only inspection is performed through the reviewed Management API adapter and authenticated `woocommerce-admin` health path; the historical `scripts/prod-probe.mjs` reference is not present in this checkout.

## Required organizational inputs before any production action

Record these in the change ticket; do not infer them from repository defaults:

1. Protected environment name and its required reviewers/approvers.
2. Production project/ref and the approved deployment workflow/run ID.
3. ~~Authoritative job-18 identity~~ — **resolved**, see "Scheduler identity" below.
4. ~~Approved reviewed migration artifact and migration-pipeline command~~ — **resolved**, see `scripts/prod-migrate.mjs`.
5. ~~Deployed worker/reconcile function versions and the approved deployment mechanism~~ — **resolved**, see `scripts/prod-deploy-functions.mjs`.
6. Named operator and incident/change IDs for audit correlation. **Still missing.**
7. Recovery scope: connector IDs, time window, and explicit order/replay selection criteria. **Still missing.**

If any input is missing, stop and report that the recovery remains blocked.

## Scheduler identity

Proven on 2026-11-11 from a read-only query of `cron.job` on project `jiwndicvfkiltgageqwv`, not inferred from the repository:

| Field | Worker | Reconciliation |
|---|---|---|
| `jobid` | 18 | 19 |
| `jobname` | `woocommerce-sync-worker-5min` | `woocommerce-reconciliation-15min` |
| `schedule` | `*/5 * * * *` | `*/15 * * * *` |
| `active` | true (resumed under `CHG-2026-11-12-01`) | true |
| `username` / `database` | `postgres` / `postgres` | `postgres` / `postgres` |
| target | `/functions/v1/woocommerce-worker` | `/functions/v1/woocommerce-reconcile` |

Both jobs authenticate to the function with header `x-woocommerce-scheduler-secret`, whose value is read at call time from `vault.decrypted_secrets` where `name = 'sync_worker_cron_token'`, and both use `timeout_milliseconds := 300000`. The secret value was never read, printed, or stored.

`vault.secrets` contains exactly one relevant entry, `sync_worker_cron_token`. There is no second scheduler credential.

## Deployment adapters

Two reviewed scripts replace the forbidden paths. Both refuse to run unless the files they ship are committed and identical to `HEAD`, so what runs is what was reviewed.

### `scripts/prod-migrate.mjs`

Applies migrations and writes the ledger row plus a `public.audit_log` row (`action = 'woocommerce.migrations.applied'`) carrying the change ID, git SHA, branch, target and version list.

```
node scripts/prod-migrate.mjs --dry-run
node scripts/prod-migrate.mjs --apply --change-id <id> --expect-ref jiwndicvfkiltgageqwv
```

Refuses when: no `--dry-run`/`--apply`; `--apply` without `--change-id`; production `--apply` without `--expect-ref`; `--local` with a non-local host; production mode with a local host; connection string missing the expected ref; `SUPABASE_ACCESS_TOKEN` unset; `supabase/migrations` dirty or a file untracked; or the requested set is partially applied.

**Transport is split, because the production database password does not exist on this machine.** Local runs use the `pg` driver against `127.0.0.1:54322`. Production runs go through the Supabase Management API (`POST /v1/projects/<ref>/database/query`) authenticated with `SUPABASE_ACCESS_TOKEN`, which the CLI already holds in Windows Credential Manager. Either way the credential comes from the environment, never an argument, so it stays out of shell history.

Two consequences of that transport worth knowing before the first production run:

- The Management API accepts multi-statement SQL, which is why a migration file can be sent as one batch. It returns only the **last** statement's result set, so the runner never reads intermediate output.
- `20261110110000_woocommerce_conflict_resolution.sql` carries its own `BEGIN;`/`COMMIT;`. It is therefore sent verbatim and commits inside the batch, so a failure in the *following* ledger insert would leave it applied-but-unledgered. This is the same failure mode the `pg` path already had and is not introduced by the transport split, but it is the one place where "one file, one transaction" does not hold.

### `scripts/prod-deploy-functions.mjs`

Deploys `woocommerce-worker` and `woocommerce-reconcile` and writes `public.audit_log` (`action = 'woocommerce.functions.deployed'`) carrying the version each function reports *after* the deploy, not what was intended.

```
node scripts/prod-deploy-functions.mjs --dry-run --expect-ref jiwndicvfkiltgageqwv
node scripts/prod-deploy-functions.mjs --apply --change-id <id> --expect-ref jiwndicvfkiltgageqwv
```

Refuses when: no mode flag; `--apply` without `--change-id`; `--apply` without `--expect-ref`; the checkout is not `--expect-worktree`; a target function directory or `supabase/functions/_shared` is dirty; `supabase/config.toml` disagrees with the expected `verify_jwt` posture; the deployed function currently has a different `verify_jwt` (that is a security change, not a redeploy); or the connection string is local or lacks the expected ref.

`verify_jwt` is asserted because it decides who can call the function: `woocommerce-worker` and `woocommerce-reconcile` must stay `false` so the scheduler's vault secret is the only gate.

**Why the deploy adapter exists at all:** `functions list` shows the live `woocommerce-worker` entrypoint as `file:///Work/Web Development/DokanOS/shohozbiz/shohozbiz/supabase/functions/woocommerce-worker/index.ts` — the **main checkout**, not the PR worktree, and that checkout carries unrelated uncommitted changes. The adapter's committed-files gate is what prevents that from happening again.


## Safety invariants

- Obtain protected-environment approval immediately before every production mutation.
- Verify job 18 by **all** of: project/ref, scheduler, numeric ID, exact name, command target, and current enabled state. Never disable a job based on `18` alone.
- Preserve webhook intake. Do not disable, delete, or rotate the WooCommerce webhook merely to pause processing. Intake evidence must continue to be durably accepted.
- Pause only the verified worker/reconciliation dispatch control, using the approved scheduler control or reviewed migration. Do not use ad-hoc SQL.
- Deploy `woocommerce-worker` and `woocommerce-reconcile` through the reviewed production pipeline. Do not paste secrets into logs, tickets, SQL, or command arguments.
- Apply schema changes only through the reviewed migration pipeline. Never use `supabase db push` for this recovery.
- Use connector-scoped, audited admin controls for pause/resume, replay, correction, and conflict decisions. Do not edit work, delivery, identity, or order rows directly.
- Keep a timestamped evidence bundle: approval, workflow run IDs, verified job identity, health output, deployment versions, migration result, replay selection, before/after counts, and final sign-off.

## Read-only preflight

Run only through approved read-only CI/probe steps, with output captured as evidence and secrets redacted:

1. Confirm the incident/change ticket, protected environment, approvers, operator, and scope.
2. Inspect connector health for the affected connector(s): intake status, webhook status, last received/verified/processed timestamps, reconciliation watermark, queue depth, retry/dead-letter/quarantine counts, and open conflicts.
3. Confirm the expected webhook ID/topic/delivery URL from the connector record and WooCommerce admin. Do not reveal webhook secrets.
4. Inspect recent deliveries, work, reconciliation runs, conflicts, and outbound writes using the reviewed Management API transport and authenticated `woocommerce-admin` health path; do not use direct production SQL.
5. Confirm current deployed function versions and the migration ledger through the deployment platform's read-only view.
6. Verify job 18 identity using the authoritative scheduler UI/API. Capture the complete identity tuple listed above.

**Stop conditions:** webhook intake is not healthy; job 18 identity cannot be proven; secrets are unavailable through the deployment platform; the connector or business scope is ambiguous; or the evidence cannot be tied to the incident/change ID.

## Controlled recovery sequence

### 1. Protect intake before pausing dispatch

- Confirm the webhook endpoint returns durable-intake success and that new deliveries continue to appear as accepted evidence.
- Confirm `intake_enabled` remains true for the affected connector.
- If intake is unhealthy, do not pause anything blindly; escalate to the function/deployment owner.

### 2. Pause only after job-18 identity verification

- Obtain protected approval.
- Re-check the exact job-18 identity immediately before the action.
- Pause the verified dispatch job using the approved scheduler control or a reviewed migration artifact.
- Record the action result, actor, timestamp, job identity, and reason.
- Verify afterward that webhook intake remains enabled and that no unrelated scheduler jobs were changed.

### 3. Deploy the reviewed worker/reconcile fix

- Merge the reviewed change through the normal pull-request checks.
- Deploy with `node scripts/prod-deploy-functions.mjs --apply --change-id <id> --expect-ref jiwndicvfkiltgageqwv`. It refuses to run if the function sources are dirty and asserts the `verify_jwt` posture did not change.
- Apply schema changes with `node scripts/prod-migrate.mjs --apply --change-id <id> --expect-ref jiwndicvfkiltgageqwv`. Never `supabase db push`.
- Confirm the versions the API reports afterwards, and that the `public.audit_log` rows exist for both the deploy and the migration.

### 4. Resume dispatch in a controlled canary

- Obtain a second protected approval for resume.
- Re-verify job 18 identity and confirm the deployment versions are the intended ones.
- Resume only the verified job or invoke the approved worker/reconcile canary mechanism.
- Process a bounded connector-scoped sample. Keep outbound writes disabled unless separately approved; recovery should first prove inbound processing and reconciliation.
- Confirm no duplicate local orders, no unsafe status regressions, and expected idempotency behavior.

### 5. Auditable recovery/replay checks

For the selected connector and bounded time window, record before and after:

- accepted, verified, processed, duplicate, rejected, and quarantined delivery counts;
- pending, retrying, succeeded, dead-letter, and quarantined work counts;
- reconciliation run IDs, windows, pages, discovered/enqueued counts, and watermark movement;
- external-order identity count and duplicate/conflict count;
- open conflicts and each operator resolution with reason;
- outbound-write count and status (expected zero unless separately approved);
- sample delivery/work/order IDs sufficient to reproduce the audit without logging payload secrets.

Replay only through `woocommerce-admin`'s connector-scoped, audited replay/correction operation. Before replay, verify the work ID belongs to the selected connector and is eligible. After replay, verify one durable outcome, no duplicate identity, and a recorded audit event. Never replay the entire queue without an approved bounded scope.

## Rollback and abort

**Rollback owner: Mujahid.** Solo developer; there is no second operator to hand this to, and this is stated plainly rather than implying coverage that does not exist.

Abort and restore the pause state if deployment verification fails, intake stops, job identity changes, health degrades, or duplicate/conflict counts exceed the approved threshold. Do not delete accepted evidence or local orders.

Rollback paths, in order of preference:

1. **Functions** — redeploy the previously reviewed version through `scripts/prod-deploy-functions.mjs` against the last known-good commit. Record the resulting version numbers in the audit row.
2. **Scheduler** — re-enable the verified job through the approved scheduler control. Confirm `active` is true and the job name/schedule are unchanged.
3. **Schema** — a schema rollback must be a new reviewed migration applied through `scripts/prod-migrate.mjs`. Never reverse a migration with ad-hoc SQL.

The recovery migrations are additive in intent: `resolve_woocommerce_sync_conflict` and the corrections policy are replaced objects, `woocommerce_delivery_accepted_*` are new indexes, and `finish_woocommerce_sync_work`/`upsert_woocommerce_order` are `CREATE OR REPLACE` functions. `20261112120000` namespaces new Woo imports by full connector UUID; `20261112130000` applies configured prefix/suffix and customer snapshots to new imports; `20261112140000` repairs repeat-import behavior; and `20261112150000` runs the reviewed service-role-only backfill for existing Woo rows. The un-deployed `20261112160000` contract v2 is append-only: local verification covers processing to `new_order`, COD-safe payment preservation, supported shipping to `walkin`/`delivery`, local fulfillment-state preservation, configured connector-store prefix + Woo number + one `W`, and fail-closed same-prefix collisions. It does not yet provide authoritative Woo pre-order classification or multi-brand prefix attribution because the current worker payload/catalog path lacks product/category linkage; its backfill raises `woocommerce_order_number_collision` instead of silently retaining a UUID-based identifier. Rolling back function behavior means re-applying a prior function body as a new reviewed migration, not dropping data. No v2 migration or identifier rewrite has been applied to production.

## Known residual risk

- No independent reviewer exists. Any approval recorded here is a self-acknowledgement and must be labelled as such, never presented as independent review.
- The Production GitHub environment has a 10-minute wait timer and a branch policy allowing only `main`. A wait timer is a delay, not a review.
- Migration and deploy adapters have been exercised against production under `CHG-2026-11-12-01`; this does not establish that the deployment path or production recovery is free of risk.
- The two COD test orders showed a payment-display change following status saves. Later Vincent showed Paid again, while Enveil showed Unpaid. Actual payment state and root cause remain unverified; do not treat Woo `processing` alone as proof of payment.
- Latest-delivery health is aggregate evidence; it does not prove full backlog disposition or the final state of a specific replay or outbound work item.
- The local snapshot-backfill regression was strengthened to link its customer fixture and use NULL-safe assertions; the rollback-only SQL suite passed 6/6 locally. This test change remains uncommitted and has not run in CI. Live UI showed customer fields on two test orders; broader production coverage remains unverified.

## Production evidence under CHG-2026-11-12-01

- Eight recovery migrations were applied through `scripts/prod-migrate.mjs`; the post-action ledger contains 215 applied migrations and the target versions are already applied on dry-run. The later additions are `20261112130000_woocommerce_order_snapshot_and_prefix`, `20261112140000_woocommerce_order_snapshot_and_prefix_repair`, and `20261112150000_woocommerce_order_snapshot_prefix_backfill`, all under the same change ID.
- `woocommerce-worker` and `woocommerce-reconcile` were deployed through `scripts/prod-deploy-functions.mjs`; both report v4, `ACTIVE`, `verify_jwt=false`.
- Job 18 (`woocommerce-sync-worker-5min`) was resumed through `scripts/prod-schedule.mjs` only after deployment verification; job 19 remained active and unchanged.
- The five previously abandoned leased rows were processed without manual row edits: each is now `replayed`, lease cleared, and points to its succeeded sibling via `duplicate_finish.replayed_to`. The highest-attempt inbound row reached 148 before the recovery and did not create a duplicate order.
- Enveil work `8b560cc3-0686-4482-9743-0b71b507b454` (external order 8847) was replayed through `woocommerce-admin`; the first replay work `0753eab7-606c-4c52-80f8-dc105bf35a4f` exposed the real `uq_orders_order_number` collision and dead-lettered without `[object Object]`. After applying `20261112120000_woocommerce_order_number_namespace` through the audited runner, a second connector-scoped replay returned work `18ac3e58-36f9-454c-b526-8c0d8e78ec7d`; health then showed no dead letters, queue counts `replayed=2, succeeded=1`, and the latest reconciliation succeeded with `error_class=null` and `last_error=null`.
- Both connectors remained healthy with intake and outbound enabled; no conflict or outbound rows were present in the baseline sample. No webhook intake was disabled.

## Closure evidence

The incident owner signs off only after:

- webhook intake remains enabled and healthy;
- verified scheduler identity is restored to the intended state;
- worker/reconcile deployment versions are recorded;
- migration pipeline result and migration ledger are recorded, if applicable;
- bounded replay/reconciliation checks pass;
- open conflicts, dead letters, and retries have an owner or documented disposition;
- no secrets, raw credentials, or ad-hoc SQL were included in evidence;
- protected-environment approvals and workflow run IDs are attached to the incident.

## Repository gaps that still block production

Resolved on 2026-11-11:

- ~~No reviewed migration runner~~ — `scripts/prod-migrate.mjs`, applied the eight recovery migrations and recorded audit rows under `CHG-2026-11-12-01`; post-deploy ledger read shows 215 applied migrations.
- ~~No approved Edge Function deployment adapter~~ — `scripts/prod-deploy-functions.mjs`, deployed worker/reconcile v4 and recorded the audit row under `CHG-2026-11-12-01`.
- ~~Job-18 identity unproven~~ — proven read-only, see "Scheduler identity".
- ~~Rollback owner unnamed~~ — Mujahid.

Still blocking:

- **No independent review**, by the user's own account. Accept and label the gap.

Resolved since this section was first written:

- ~~No change/incident ID~~ — `CHG-2026-11-12-01`, recorded in `public.audit_log` against the scheduler pause, token rotation, migration deployment, function deployment, and scheduler resume.
- ~~No production credential in this environment~~ — `SUPABASE_ACCESS_TOKEN` is available from Windows Credential Manager (the CLI's own login), and the runner's production transport now uses it. `PROD_SUPABASE_DB_URL` is still unset and is no longer needed: the production database password does not exist on this machine, which is exactly why the Management API transport was built.

The existing migration schedules jobs by names `woocommerce-sync-worker-5min` and `woocommerce-reconciliation-15min`; the numeric mapping to 18 and 19 was established from the live `cron.job` table, not from the repository.

**Status: eight migrations and worker/reconcile functions deployed; scheduler resumed; five abandoned leases were marked `replayed`. Following the Enveil 8847 replay, aggregate health showed no dead letters, but the individual replay state was not verified. Both COD test orders appeared in DokanOS and Woo admin showed `processing`; causal per-order outbound work evidence remains unverified. Customer fields and configured prefixes were visible after backfill. Delivery evidence is aggregate-only; no terminal/courier/payment-capture checks were performed.**


## References

- [`supabase/migrations/20261110090000_woocommerce_order_connector.sql`](../../supabase/migrations/20261110090000_woocommerce_order_connector.sql#L804-L832)
- [`supabase/functions/woocommerce-admin/index.ts`](../../supabase/functions/woocommerce-admin/index.ts#L177-L253)
- [`supabase/functions/woocommerce-worker/index.ts`](../../supabase/functions/woocommerce-worker/index.ts#L174-L180)
- [`supabase/functions/woocommerce-reconcile/index.ts`](../../supabase/functions/woocommerce-reconcile/index.ts#L45-L56)
- [`scripts/prod-migrate.mjs`](../../scripts/prod-migrate.mjs) — reviewed migration adapter.
- [`docs/verification/2026-11-10-woocommerce-connector-implementation.md`](./2026-11-10-woocommerce-connector-implementation.md#L31-L80)

## Static review checklist

- [x] No production command is executable from this document.
- [x] No secret value or credential is present.
- [x] `supabase db push` is explicitly prohibited.
- [x] Job 18 identity is verified before any pause.
- [x] Webhook intake is preserved.
- [x] Worker/reconcile deployment is reviewed and protected.
- [x] Migration pipeline is reviewed and protected.
- [x] Recovery and replay checks are bounded and auditable.
- [x] Missing organizational inputs are explicit.

Reviewed by the deployment owner (self-acknowledgement, **not** independent review) on 2026-11-11.
