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

- [x] Confirm the test change/incident ID: `CHG-2026-11-12-01`.
- [x] Confirm the browser app is the PR branch build, not the `main` deployment` — preview URL and local PR build verified.
- [x] Confirm the app points to Supabase project `jiwndicvfkiltgageqwv` — local PR build used the production URL/key in process memory; no key was persisted.
- [x] Confirm no production migrations, functions, scheduler, webhook, or order writes occur before the read-only baseline is captured.
- [x] Confirm job 18 is active after the audited resume, job 19 is active, and webhook intake is enabled.
- [x] Confirm the scheduler-secret rotation audit row exists and no secret value is displayed.

## Gate 1 — Read-only production baseline

Capture before/after values for both connectors without exposing credentials:

- [ ] Connector identity: Enveil and Vincent; business/brand/source links.
- [ ] Connector status and `intake_enabled`.
- [ ] Webhook endpoint URL, delivery topics, signature state, and last delivery time.
- [ ] WooCommerce API URL host only; never record consumer keys/secrets.
- [ ] Current Woo order counts by status for the selected test scope.
- [ ] DokanOS order counts by mapped status and source.
- [x] Pending, retrying, leased, succeeded, replayed, quarantined, and dead-letter work counts captured in the production baseline.
- [ ] Establish the disposition of all previously unprocessed accepted webhook deliveries. Subsequent health reads showed the latest deliveries accepted, verified and processed, but aggregate health does not prove the entire backlog drained.
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
- [ ] Verify complete order detail including discounts and payment status. The order list showed customer name, phone, address, item, total, source and configured prefixes after backfill; the latest attempt to open the detail sheet did not succeed.
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
- [x] Place one Enveil order and one Vincent order only: Enveil Woo `8848` (`Ivory-Rose - L`, COD, ৳4,076) and Vincent Woo `11047` (`Nomad Olive Green Linen Shirt - M`, COD, ৳2,070).
- [x] Capture Woo order IDs/statuses: Enveil `8848` and Vincent `11047`, both COD and observed as `Processing` in Woo admin; totals ৳4,076 and ৳2,070 respectively, with customer/item/address/note evidence in the Woo admin views.
- [ ] Confirm webhook delivery is accepted and signature/source/resource checks pass.
- [ ] Confirm exactly one work row is created for each order.
- [ ] Confirm the worker claims and finishes each row without duplicate rows.
- [x] Confirm DokanOS orders appear under the correct brand/source: Enveil `#EE-WC-4fa8dbf5-d638-47ed-b0b1-cce4b1430b31-8848W` and Vincent `#VC-WC-f5e5920b-7252-4880-9a7d-1ebfa47c1409-11047W` (historical production evidence; the v2 contract now targets configured prefix + Woo number + one `W`).
- [ ] Verify all order details end-to-end. Customer name, phone, address and configured number were visible in the order list after backfill; item and totals were observed. Payment display was inconsistent and requires investigation. Woo admin separately showed SKU and variation IDs; their DokanOS persistence remains unverified.
- [ ] Re-run production evidence that Woo `processing` maps to the expected DokanOS New Order state; local vertical coverage now passes.
- [ ] Confirm Woo `on-hold` or unpaid COD behavior maps to Payment Needs Confirmation/On Hold where applicable; local pure mapping coverage preserves `payment_pending`.
- [ ] Re-run the production verification for the reported Woo import `pending` vs DokanOS New Order discrepancy without bypassing payment-confirmation rules. The reviewed worker/v2 contract now maps Woo `processing` to `new_order`; local vertical coverage is green, but production deployment is not approved.
- [ ] Verify checkout walk-in vs delivery mapping using actual Woo shipping selections. The local worker maps `walk-in`/`walkin`/`local_pickup` to `walkin` and other selections to `delivery`; the adapter currently reads only the first Woo shipping line, so production evidence and payload-shape review remain open.
- [ ] Verify pre-order product and mixed-product cases using authoritative Woo product metadata. The worker remains fail-closed because current line items lack authoritative category metadata; a reviewed catalog resolver is still required before production pre-order claims.
- [ ] Apply the collision-safe v2 order-number contract only through the reviewed production adapter and an explicit migration gate: configured prefix(es) + Woo number + one `W`, manual/social `M`, POS unchanged. Same-prefix collisions fail closed as `woocommerce_order_number_collision`; existing UUID-based production identifiers remain unchanged until the approved preview/rewrite step.
- [ ] Confirm no credential or raw secret appears in any failure field.
- [ ] Confirm final per-order work state is `succeeded` and no retry/dead-letter row remains. Aggregate connector health showed accepted/verified/processed latest deliveries, successful reconciliation, and no dead letters; the supported health surface does not expose per-order delivery/work IDs.

## Gate 5 — DokanOS outbound status verification

Use only a reversible status change on the test order:

- [x] Change test orders in DokanOS to the UI's `New Order` equivalent; timeline/audit events were observed.
- [ ] Capture each corresponding outbound work row and verify its final state.
- [ ] Confirm exactly one Woo update was sent for the intended order.
- [x] Observe Woo `processing` on both test orders. Enveil showed a pending-to-processing note after the save; Vincent's prior status and the causal outbound work are not established.
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
- [x] Verify job 18 identity before resume: ID 18, exact name, schedule, target, active state.
- [x] Verify job 19 identity and successful reconciliation runs.
- [x] After recovery, verify the five abandoned leased rows stop gaining attempts; all five became `replayed` with leases cleared and succeeded-sibling pointers.
- [ ] Verify or document the disposition of all previously unprocessed accepted deliveries. Latest-delivery health and successful reconciliation do not establish the disposition of the entire backlog.
- [x] Initiate Enveil order 8847 dead-letter replay through the supported path; the first replay exposed an order-number collision. A later replay was accepted after the namespace migration, but its individual final work state remains unverified.
- [ ] Verify the second Enveil replay's individual work state. Subsequent aggregate health showed no dead letters, queue `replayed=2, succeeded=1`, and successful reconciliation without a new `[object Object]`; the returned work ID was not independently inspected.
- [x] Verify worker and reconciliation function versions after deployment: both v4, `ACTIVE`, `verify_jwt=false`.
- [x] Verify audit rows contain change ID, commit, target, versions, and no secrets.
- [x] Verify webhook intake stayed enabled throughout.

## Gate 8 — Evidence and merge decision

- [ ] Complete the redacted evidence table for the bounded scenarios. Order IDs and partial observations are below; per-order delivery/work IDs and final states remain unverified.
- [x] Record known fidelity gaps separately: currency, SKU, Woo product ID, variation ID, tax, and customer fields not explicitly verified. Customer name, phone and address and configured prefixes were observed after backfill; full customer-snapshot fidelity is not established.
- [ ] Update and run the local vertical sync test: its existing assertions still expect the pre-repair order number and null customer snapshot, and it currently expects a Woo `processing` COD order to be `paid`. Revisit the payment expectation only after the payment invariant is agreed and reproduced.
- [x] Strengthen and rerun the local snapshot backfill regression: the legacy customer fixture is linked to the legacy order and snapshot comparisons use NULL-safe assertions. The rollback-only SQL suite passed 6/6 locally; the change is not yet committed or tested in CI.
- [x] Record the replay failure, collision fix, migration, and aggregate follow-up in the runbook; bounded frontend observations and the COD payment-state risk are recorded below.
- [ ] Run typecheck, unit tests, SQL regression, browser tests, and CI required checks again after any further fix. Required CI passed for commit `8ecf830` on run `43188691551`; uncommitted documentation changes are not included in that run.
- [ ] Recheck branch protection, PR head, and required checks before a merge decision. At the last read, `8ecf830` was the PR head and both required checks passed.
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
| New COD inbound | Enveil | `8848` | `EE-WC-…-8848W` | Per-order IDs unavailable in supported health | Correct brand/source, item, total, customer | Present after reviewed backfill; latest delivery aggregate accepted/verified/processed | Partial: per-order work not exposed |
| New COD inbound | Vincent | `11047` | `VC-WC-…-11047W` | Per-order IDs unavailable in supported health | Correct brand/source, item, total, customer | Present after reviewed backfill; latest delivery aggregate accepted/verified/processed | Partial: per-order work not exposed |
| DokanOS → Woo processing | Enveil | `8848` | `EE-WC-…-8848W` | Timeline/audit observed; per-order work ID not exposed | Woo `processing` | Woo admin showed a pending-to-processing transition after the DokanOS save; the individual outbound work was not inspected | Partial |
| DokanOS → Woo processing | Vincent | `11047` | `VC-WC-…-11047W` | Timeline/audit observed; per-order work ID not exposed | Woo `processing` | Woo admin showed `Processing`; its prior state and causal outbound write are not established | Partial |
| Duplicate finish recovery | Vincent/Enveil | Existing identities | Existing orders preserved | Five duplicate work rows | Duplicate lease becomes `replayed` | Leases cleared; succeeded siblings preserved | Pass |
| Dead-letter replay | Enveil | `8847` | `EE-WC-…-8847W` | `18ac3e58-36f9-454c-b526-8c0d8e78ec7d` | Replay succeeds without duplicate order | Aggregate health showed succeeded work and no new dead letter; per-work state not independently verified | Partial |

## Result

- Date/time:
- PR commit:
- Production change ID:
- Migrations deployed: yes — eight recovery migrations, audited under `CHG-2026-11-12-01`; production ledger count 215
- Functions deployed: yes — worker/reconcile v4, `ACTIVE`, `verify_jwt=false`
- Job 18 state: active after audited resume; exact identity `woocommerce-sync-worker-5min`, ID 18
- Job 19 state: active and producing successful reconciliation runs
- Recovery work state: five abandoned leases safely `replayed`; aggregate Enveil health showed no current dead letter after the 8847 replay, but its individual work state was not verified
- Overall result: PARTIAL — both COD orders appeared in DokanOS and Woo showed processing; individual delivery/work state and causal outbound writes are not proven. Customer fields and prefixes were visible after backfill.
- Remaining risk: historical `[object Object]` remains on the original dead-letter. After status saves, both COD test orders showed Unpaid after initially showing Paid; a later read showed Vincent Paid again and Enveil Unpaid. The cause and actual payment state need investigation; do not repeat this test in production. The save path recomputes payment from recorded payments. The local v2 worker contract now keeps Woo COD `processing`/`completed` imports unpaid until collection is recorded; production deployment and root-cause verification remain gated.
- Remaining fidelity gaps: currency, SKU, Woo product ID, variation ID, tax, and any denormalized fields not explicitly verified above. Customer name/phone/address and configured prefixes were repaired and observed on the two test orders.
- Merge decision: do not merge until the remaining evidence/payment risks are explicitly accepted and the PR head/CI are reverified
