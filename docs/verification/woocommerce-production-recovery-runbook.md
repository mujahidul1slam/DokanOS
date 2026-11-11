# WooCommerce production recovery runbook

> **Local-only reviewed proposal.** This document does not execute production changes, SQL, migrations, `supabase db push`, function deployment, or scheduler control. It is an operator checklist to be reviewed and adapted to the organization's protected CI/CD environment before use.

## For Mujahid

- The repository has WooCommerce worker/reconciliation functions and a migration-managed scheduler, but no reviewed production deployment workflow.
- Do not use this document as authorization to change production. A protected environment, named approvers, and the exact scheduler job identity must be supplied first.
- Webhook intake remains enabled while job 18 is investigated or paused; only worker/reconciliation dispatch is paused after identity verification.

## Scope and non-goals

This recovery covers the WooCommerce connector, worker, reconciliation, and auditable replay path. It does **not** perform ad-hoc SQL, direct production writes, `supabase db push`, secret inspection, or destructive cleanup. All production changes must flow through a reviewed pull request and the protected deployment environment.

The repository currently contains:

- `supabase/functions/woocommerce-webhook` for signed durable intake.
- `supabase/functions/woocommerce-worker` for durable work processing.
- `supabase/functions/woocommerce-reconcile` for overlapping REST reconciliation.
- `supabase/functions/woocommerce-admin` for audited health, pause/resume, replay, correction, and conflict controls.
- Migration-managed pg_cron jobs named `woocommerce-sync-worker-5min` and `woocommerce-reconciliation-15min` in `supabase/migrations/20261110090000_woocommerce_order_connector.sql`.
- Read-only inspection tooling in `scripts/prod-probe.mjs`.

## Required organizational inputs before any production action

Record these in the change ticket; do not infer them from repository defaults:

1. Protected environment name and its required reviewers/approvers.
2. Production project/ref and the approved deployment workflow/run ID.
3. Authoritative job-18 identity: scheduler system, numeric job ID, job name, command/function, and project/ref. **A number alone is insufficient.**
4. Approved reviewed migration artifact and migration-pipeline command. Direct `supabase db push` is not an approved recovery step.
5. Deployed worker/reconcile function versions and the approved deployment mechanism.
6. Named operator and incident/change IDs for audit correlation.
7. Recovery scope: connector IDs, time window, and explicit order/replay selection criteria.

If any input is missing, stop and report that the recovery remains blocked.

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
4. Inspect recent deliveries, work, reconciliation runs, conflicts, and outbound writes using `scripts/prod-probe.mjs` or its approved CI equivalent.
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
- Use the protected production environment's deployment workflow to deploy `woocommerce-worker` and `woocommerce-reconcile`.
- Apply any required schema changes through the reviewed migration pipeline only; never run `supabase db push`.
- Confirm deployment versions and health endpoints/log summaries without exposing credentials.

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

Abort and restore the pause state if deployment verification fails, intake stops, job identity changes, health degrades, or duplicate/conflict counts exceed the approved threshold. Do not delete accepted evidence or local orders. Roll back by deploying the previously reviewed function version through the protected pipeline and using the approved scheduler control; any schema rollback must be a reviewed migration, not an ad-hoc SQL reversal.

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

This repository does not currently provide a dedicated protected production deployment workflow for these Edge Functions, nor does it define the organization's approval/environment names or authoritative scheduler API for job 18. It also cannot prove from source alone whether the production job numbered 18 is either WooCommerce dispatch job. Those are organizational/production facts and must be supplied before this runbook can authorize action.

The existing migration schedules jobs by names `woocommerce-sync-worker-5min` and `woocommerce-reconciliation-15min`; it does not establish a numeric job-18 mapping. The runbook therefore intentionally refuses to guess that mapping.

**Status: proposal only; no production changes performed.**

## References

- [`supabase/migrations/20261110090000_woocommerce_order_connector.sql`](../../supabase/migrations/20261110090000_woocommerce_order_connector.sql#L804-L832)
- [`supabase/functions/woocommerce-admin/index.ts`](../../supabase/functions/woocommerce-admin/index.ts#L177-L253)
- [`supabase/functions/woocommerce-worker/index.ts`](../../supabase/functions/woocommerce-worker/index.ts#L174-L180)
- [`supabase/functions/woocommerce-reconcile/index.ts`](../../supabase/functions/woocommerce-reconcile/index.ts#L45-L56)
- [`scripts/prod-probe.mjs`](../../scripts/prod-probe.mjs#L1-L14)
- [`docs/verification/2026-11-10-woocommerce-connector-implementation.md`](./2026-11-10-woocommerce-connector-implementation.md#L31-L80)

## Static review checklist

- [ ] No production command is executable from this document.
- [ ] No secret value or credential is present.
- [ ] `supabase db push` is explicitly prohibited.
- [ ] Job 18 identity is verified before any pause.
- [ ] Webhook intake is preserved.
- [ ] Worker/reconcile deployment is reviewed and protected.
- [ ] Migration pipeline is reviewed and protected.
- [ ] Recovery and replay checks are bounded and auditable.
- [ ] Missing organizational inputs are explicit.

As a documentation-only proposal, this file must be reviewed by the deployment owner before it is treated as an operational procedure.
