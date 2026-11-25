# WooCommerce historical mapping dry-run review

**Scope:** repository review plus local, non-mutating verification only. No production backfill or order-window execution was attempted because no approved connector/date/order window was supplied.

## Detection and classification

The historical path is `supabase/functions/woocommerce-cutover/index.ts`, backed by `src/lib/woocommerceCutover.ts`.

- The request is dry-run by default (`dry_run` is treated as true unless explicitly false), requires an authenticated owner/admin, and refuses unless the connector has `intake_enabled`, an expected webhook ID, and `webhook_status = active`.
- The database run is always exactly seven days immediately before the supplied watermark. The API requests Woo orders with `modified_after = window_start` and `modified_before = window_end`; WooCommerce's date-boundary behavior is external/API-defined, while the local run window is the half-open interval `[window_start, window_end)`. Results are ordered by modified time, 100 per page, capped at 100 pages.
- Exact mapping is only `(connector_id, external_order_id)` in `woocommerce_order_identities`. Connector scope is enforced; a matching external ID on another connector is not exact.
- Legacy candidates are only non-deleted `orders` rows with `source = 'woocommerce'` and the connector's `business_id`, excluding local IDs already represented in connector identities. Unknown business rows are fail-closed.
- A record is `review` (ambiguous) when at least one legacy candidate has at least two equal normalized signals among email, name, total, SKU, address, or modified-date within 24 hours. Signals and candidate local UUIDs are recorded; candidates are never auto-merged or queued.
- A record is `unmapped` when no exact identity and no two-signal legacy candidate exist.
- Unsupported Woo statuses are failures before enqueue. Woo external IDs are accepted only as positive safe integer JSON numbers; missing, string-coerced, fractional, zero, negative, or unsafe IDs are malformed. The planner records each malformed observation as an `incomplete` failure. The Edge Function also inserts one failed report item per malformed payload with `external_order_id = null`, `failure_class = incomplete`, and a bounded `failure_detail` naming the malformed-ID category; the raw payload is retained in `external_snapshot` for audit. Such items are included in `discovered` and failure counts but cannot participate in identity matching or queue work.

## Dry-run side effects and output

The safe operational entrypoint is the authenticated `POST /functions/v1/woocommerce-cutover` call with `{"connector_id":"...","dry_run":true,"watermark":"..."}`. There is no repository CLI that can invoke this against each connector.

Dry-run does **not** enqueue operational sync work or mutate local orders: `planCutoverEnqueue` returns `work: false` for every match kind when `dryRun` is true. It does, however, insert a `woocommerce_cutover_runs` row, one `woocommerce_cutover_report_items` row per scanned Woo order, and then finishes the run. Therefore it is non-mutating with respect to orders/queue/backfill, but not a zero-write database operation. The response fields are:

`run_id`, `state`, `dry_run`, `window.start`, `window.end`, `pages`, `requests`, `discovered`, `enqueued`, `exact_matches`, `review_candidates`, `unmapped`, `failures`, and up to ten `failure_details`.

No authenticated production dashboard/API session was available to this worker, and no connector IDs or approved watermark were supplied, so no live per-connector dry-run was executed. Consequently current production counts by connector/status are unavailable and must not be invented. The report table can provide per-order status/match/outcome after an approved dry-run; the run counters provide connector-level totals. The current implementation does not return a status histogram, so status-by-connector counts require an additional read-only aggregate query over the report items (or client-side grouping of the report rows). Malformed-ID report items have no external ID and are grouped by `failure_class = incomplete` when reconciling audit totals.

## Counts and queue/conflict checks

No live counts are available in this checkout. The required evidence bundle should capture, per connector and exact window:

- run counters and report-item count; `discovered = report items + malformed/failed observations` should be reconciled;
- report-item grouping by `external_status`, `match_kind`, and `outcome`;
- exact identity count and duplicate/conflict count;
- queue counts for pending/retrying/succeeded/dead-letter/quarantined, plus `enqueued` and work IDs;
- open conflicts and dead-letter/quarantine rows;
- outbound-write count, expected to be zero for this dry-run;
- terminal run state and completion timestamp.

The health endpoint `woocommerce-admin` action `health` returns connector-safe health aggregates, up to 100 dead-letter/quarantined work rows, and up to 100 open conflicts. It is useful for pre/post checks but is not a historical mapping dry-run and does not expose the full report or an unbounded queue completion proof. Report/run evidence reads must use an authenticated session authorized by the connector's business-membership RLS policy; service-role access is not evidence of end-user read authorization. Regular `woocommerce-reconcile` is not safe for this task: it inserts reconciliation runs, enqueues work, updates connector health, and is scheduler-secret protected.

## Candidate bounds and approvals still required

Before any production dry-run or later backfill, record in the change ticket:

1. protected environment and required approver(s);
2. production project/ref and approved workflow/run ID;
3. named operator and incident/change ID;
4. exact connector UUID(s), with business/brand/store/order-source identity verified;
5. one explicit UTC watermark per connector and the derived exact seven-day half-open window `[watermark - 7 days, watermark)`;
6. explicit order selection criteria, if narrower than the seven-day API window (external order IDs or a documented status/time subset);
7. whether the dry-run's evidence/report-table writes are approved, since dry-run is not transactionally read-only;
8. stop thresholds for failures, ambiguous candidates, duplicate identities, open conflicts, dead letters, and outbound writes;
9. independent review/approval and final sign-off owner.

No backfill approval exists in the supplied task, so the backfill mode must remain unused. Any ambiguity in connector/business scope is a stop condition.

## Duplicate/conflict and completion policy

The schema prevents duplicate connector identity via unique `(connector_id, external_order_id)` and `(connector_id, order_id)`. Webhook evidence is immutable and delivery fingerprints/delivery IDs are connector-scoped unique. Cutover report work identity is `cutover:<run_id>:<external_order_id>` and is inserted only in non-dry-run mode. Fuzzy candidates remain review-only and are reported separately from `conflict_count`; the run's conflict counter is reserved for true conflicts (currently none are produced by this scanner). Completion is not proven by a successful HTTP response alone: inspect the terminal run row, reconcile report-item totals and outcomes, verify no operational work was enqueued by a dry-run, then compare queue/conflict/dead-letter/outbound counts to the approved baseline and capture evidence.

## Verification executed

- `pnpm exec vitest run src/test/woocommerceCutover.test.ts` — **PASS**, 1 file / 13 tests (including strict ID and malformed-observation regressions).
- `node scripts/prod-migrate.mjs --dry-run` — **REFUSED** safely because `supabase/migrations` has uncommitted changes, specifically `?? supabase/migrations/20261112160000_woocommerce_order_contract_v2.sql`; exact output was:
  `REFUSED: supabase/migrations has uncommitted changes. Commit and push first so the run matches the reviewed commit.`
- `node scripts/run-woocommerce-sql-tests.mjs --with-pending` — **BLOCKED**, local Postgres unavailable: `FAIL: connect ECONNREFUSED 127.0.0.1:54322`.

## Code/spec gaps blocking merge or production action

- No safe CLI exists to run the historical cutover dry-run per connector; it is only an authenticated Edge Function request, so operator evidence collection is manual and connector/status aggregation is external to the response.
- The dry-run writes run/report evidence, contrary to a strict interpretation of “non-mutating”; the contract must explicitly approve these evidence writes or provide a transaction/read-only preview mode.
- The API exposes only aggregate match counters, not status-by-connector histograms or a report pagination/export endpoint; proving status counts requires direct authenticated reads/client grouping.
- `MAX_PAGES = 100` can leave a non-null continuation URL; the run becomes `partial` with only a generic failure increment. The approval must account for this cap or the implementation needs an explicit bounded-order-ID mode.
- The cutover scanner initializes and passes `conflict_count = 0`; it does not detect true conflicts. Fuzzy candidates remain separately counted as `review_candidates`, so `conflict_count` must not be interpreted as that review count. Duplicate/conflict verification still requires the separate identity/conflict checks described above.
- The current tests cover the public planner/enqueue seams, including strict external-ID handling, malformed-ID audit classification, and dry-run no-enqueue behavior; there is no Edge Function integration test proving report rows, terminal-state counters, per-status counts, and queue/outbound invariants together. The Edge Function filters stored identities through the same positive safe-integer rule before exact matching; malformed stored identities are ignored rather than coerced into matches. Failure-path finalization preserves the original error and explicitly reports a finalization error when `finish_woocommerce_cutover_run` fails or returns false.
- The local SQL rehearsal cannot currently run because the local Supabase database is not listening on `127.0.0.1:54322`; production migration dry-run is also correctly blocked by an uncommitted migration.
- Repository status also contains unrelated pre-existing modified files; these were not changed by this review and must be isolated before a reviewed merge.

**Conclusion:** the pure dry-run planner is safe for queue/order mutation, but no production per-connector dry-run/counts can be claimed without authenticated access and explicit connector/window approval. The merge should remain blocked on the reporting/aggregation and strict read-only contract gaps above unless the change request explicitly accepts evidence-table writes and manual grouping.
Assumptions: “dry-run” means no order, identity, sync-work, outbound, or conflict mutation; evidence rows are permitted only as a documented audit side effect. The requested historical mapping path refers to `source = 'woocommerce'`, not broader storefront `source = 'online'` rows.