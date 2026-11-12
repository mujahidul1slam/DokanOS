# WooCommerce ↔ DokanOS Production E2E Verification Checklist

## For Mujahid

This checklist is for the PR branch running against the production Supabase project and the two live WooCommerce stores. It separates **read-only checks**, **reversible test writes**, and **irreversible/destructive actions**. A test passes only when the same record is traced through both systems.

**Production target:** Supabase project `jiwndicvfkiltgageqwv` (DokanOS/main)

**Stores:** Enveil and Vincent

**Rules:**

- Use a unique test marker in every test order, for example `DOKANOS-E2E-<timestamp>`.
- Never use a real customer, real payment, or a high-value product.
- Do not use `completed`, `cancelled`, refunds, courier dispatch, or real payment capture.
- Use Cash on Delivery/manual payment only.
- Record IDs, timestamps, status values, and screenshots/log references without recording secrets.
- Do not edit or delete production sync work rows manually.
- Keep webhook intake enabled.
- Job 18 remains paused until migration/function deployment and recovery gates pass.
- Job 19 remains unchanged unless a separately approved incident action is required.

## Gate 0 — Change and environment identity

- [ ] Confirm the test change/incident ID: `CHG-2026-11-12-01`.
- [ ] Confirm the browser app is the PR branch build, not the `main` deployment.
- [ ] Confirm the app points to Supabase project `jiwndicvfkiltgageqwv`.
- [ ] Confirm no production migrations, functions, scheduler, webhook, or order writes occur before the read-only baseline is captured.
- [ ] Confirm job 18 is paused, job 19 is active, and webhook intake is enabled.
- [ ] Confirm the scheduler-secret rotation audit row exists and no secret value is displayed.

## Gate 1 — Read-only production baseline

Capture before/after values for both connectors without exposing credentials:

- [ ] Connector identity: Enveil and Vincent; business/brand/source links.
- [ ] Connector status and `intake_enabled`.
- [ ] Webhook endpoint URL, delivery topics, signature state, and last delivery time.
- [ ] WooCommerce API URL host only; never record consumer keys/secrets.
- [ ] Current Woo order counts by status for the selected test scope.
- [ ] DokanOS order counts by mapped status and source.
- [ ] Pending, retrying, leased, succeeded, replayed, quarantined, and dead-letter work counts.
- [ ] Unprocessed accepted webhook deliveries.
- [ ] Reconciliation-run history and last errors, with credentials/URLs redacted.
- [ ] Existing conflicts and their resolution state.
- [ ] Existing audit rows for scheduler actions and later deployment actions.
- [ ] Browser console and network failure scan on Dashboard, Brands, Integrations, Orders, and sync-related views.

## Gate 2 — Frontend and connector read-only verification

For each of Enveil and Vincent:

- [ ] Login and business selection work.
- [ ] Brands page shows the expected brand.
- [ ] Integrations page shows the expected order source and connector relationship.
- [ ] Legacy store-binding cards are clearly separated from live connector health.
- [ ] Connector health, sync timestamp, last error, and order counts are internally consistent.
- [ ] Orders page loads without unscoped or cross-business requests.
- [ ] Existing order detail shows customer, address, items, quantities, prices, discounts, shipping, total, payment method/status, source, and timeline.
- [ ] Sync/conflict/reconciliation views load and show actionable errors without leaking credentials.
- [ ] Browser console has no errors and failed requests are explained or fixed.

## Gate 3 — Historical missed-order reconciliation (read-only first)

Select one known missed order per connector, using existing production records only:

- [ ] Identify its Woo order ID, order number, status, modified time, customer, items, totals, payment, and shipping.
- [ ] Locate the corresponding DokanOS work row/delivery/order identity.
- [ ] Verify no duplicate DokanOS order was created.
- [ ] Verify mapping of Woo status to DokanOS status:
  - Woo `processing` → DokanOS New/appropriate inbound state.
  - Woo `on-hold` → DokanOS On Hold / Payment Needs Confirmation.
  - Woo `pending`/unpaid → the documented pending or payment-confirmation state.
  - Woo `pre-order` → DokanOS Pre-Order.
  - Woo `completed`, `cancelled`, `refunded`, `failed` → documented terminal/exception mapping; do not change these during the first test.
- [ ] Verify customer identity and contact fields.
- [ ] Verify product identity, SKU, Woo product ID, variation ID, name, quantity, price, tax, discount, shipping, currency, and total.
- [ ] Verify payment method and payment status.
- [ ] Verify shipping address and fulfillment/source attribution.
- [ ] Verify timestamps and last external modification guard.
- [ ] Verify duplicate/retry behavior and final worker state.

## Gate 4 — New inbound Woo order, one per connector

Use the WooCommerce frontend, not the admin order editor:

- [ ] Use COD/manual payment.
- [ ] Use a low-value in-stock product.
- [ ] Include a unique customer name/phone and marker in the order note, e.g. `DOKANOS-E2E-<timestamp>`.
- [ ] Do not use the stale out-of-stock item `Sarmad Beige Punjabi – L`.
- [ ] Place one Enveil order and one Vincent order only.
- [ ] Capture Woo order ID, order number, status, payment status, customer, items, totals, and timestamps.
- [ ] Confirm webhook delivery is accepted and signature/source/resource checks pass.
- [ ] Confirm exactly one work row is created for each order.
- [ ] Confirm the worker claims and finishes each row without duplicate rows.
- [ ] Confirm DokanOS order appears under the correct brand/source.
- [ ] Confirm customer, item, SKU/product/variation IDs, quantity, price, discount, tax, shipping, currency, total, payment, address, note, and order number.
- [ ] Confirm Woo `processing` maps to the expected DokanOS New/processing state.
- [ ] Confirm Woo `on-hold` or unpaid COD behavior maps to Payment Needs Confirmation/On Hold where applicable.
- [ ] Confirm no credential or raw secret appears in any failure field.
- [ ] Confirm final work state is `succeeded` and no retry/dead-letter row remains.

## Gate 5 — DokanOS outbound status verification

Use only a reversible status change on the test order:

- [ ] Change one test order in DokanOS to the documented outbound `processing` equivalent.
- [ ] Capture the outbound work row and audit/timeline event.
- [ ] Confirm exactly one Woo update is sent for the intended order.
- [ ] Confirm Woo status becomes `processing`.
- [ ] Confirm a repeated identical DokanOS save is idempotent and does not create a second effective write.
- [ ] Confirm the Woo-originated echo does not create a loop or overwrite a newer local timestamp.
- [ ] Confirm all other statuses remain unchanged.
- [ ] Do not test `completed`, `cancelled`, refunds, or courier dispatch in this pass.

## Gate 6 — Duplicate, retry, and conflict scenarios

- [ ] Replay or redeliver one identical webhook only through the supported webhook/test path; do not manually edit a work row.
- [ ] Verify durable-intake behavior: one accepted delivery, duplicates safely ignored, one effective work row.
- [ ] Verify a duplicate finish marks the duplicate lease `replayed`, preserves the succeeded sibling, clears the lease, and records `payload.duplicate_finish.replayed_to`.
- [ ] Verify repeated duplicate finish is idempotent.
- [ ] Verify owner mismatch, foreign lease, and terminal-state finish attempts are non-destructive.
- [ ] Verify a conflict with resolution `replayed` records the resolution and creates exactly one reconciliation work row.
- [ ] Verify resolving an already-resolved conflict is refused without new work.
- [ ] Verify an unknown resolution is refused.
- [ ] Verify malformed object errors are serialized as `[unserializable_object]`, not `[object Object]`.
- [ ] Verify Basic auth, proxy auth, bearer, x-api-key, and multiple URL credential parameters are redacted.
- [ ] Verify retry/backoff and max-attempt behavior without manually editing rows.
- [ ] Verify a dead-letter replay uses the supported replay function and preserves `replay_of`.

## Gate 7 — Scheduler and recovery verification

- [ ] Do not resume job 18 until migrations and function deployments are complete and audited.
- [ ] Verify job 18 identity before any resume: ID 18, exact name, schedule, target, active state.
- [ ] Verify job 19 identity and successful reconciliation runs.
- [ ] After recovery, verify the five abandoned leased rows stop gaining attempts.
- [ ] Verify the six accepted unprocessed deliveries are handled by the approved worker path.
- [ ] Verify Enveil order 8847 dead-letter replay through the supported path.
- [ ] Verify no new `[object Object]` errors appear.
- [ ] Verify worker and reconciliation function versions after deployment.
- [ ] Verify audit rows contain change ID, commit, target, versions, and no secrets.
- [ ] Verify webhook intake stayed enabled throughout.

## Gate 8 — Evidence and merge decision

- [ ] Attach a redacted evidence table with every Woo order ID, DokanOS order ID, delivery ID, work ID, final state, and timestamp.
- [ ] Record known fidelity gaps separately: currency, SKU, Woo product ID, variation ID, tax, and denormalized customer snapshot.
- [ ] Record every failed scenario, root cause, code fix, commit, and rerun result.
- [ ] Run typecheck, unit tests, SQL regression, browser tests, and CI required checks again after any fix.
- [ ] Confirm branch protection checks are green and the PR head is current.
- [ ] Merge only after all required gates pass; deployment and cron resumption remain separate approved actions.

## Explicitly out of scope for this pass

- Real card payment or capture.
- High-value or real-customer orders.
- Woo `completed`, `cancelled`, refunds, or chargebacks.
- Courier dispatch or cancellation.
- Manual updates/deletes to sync work rows.
- Direct production SQL outside reviewed adapters.
- `supabase db push`.
- Claiming fidelity gaps are fixed merely because the order appeared.

## Evidence template

| Scenario | Store | Woo order | DokanOS order | Delivery/work IDs | Expected mapping | Actual | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Historical missed order |  |  |  |  |  |  |  |
| New COD inbound |  |  |  |  |  |  |  |
| Woo on-hold/unpaid |  |  |  |  |  |  |  |
| DokanOS → Woo processing |  |  |  |  |  |  |  |
| Duplicate webhook/finish |  |  |  |  |  |  |  |
| Conflict replay |  |  |  |  |  |  |  |
| Dead-letter replay |  |  |  |  |  |  |  |

## Result

- Date/time:
- PR commit:
- Production change ID:
- Migrations deployed: yes/no/not yet
- Functions deployed: yes/no/not yet
- Job 18 state:
- Job 19 state:
- Overall result: PASS / FAIL / BLOCKED
- Remaining defects:
- Remaining fidelity gaps:
- Merge decision:
