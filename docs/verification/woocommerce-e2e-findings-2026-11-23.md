# WooCommerce sync — live production verification findings (2026-11-23)

Scope: PR #56 (`pr/woocommerce-sync-recovery`) against **production** (`jiwndicvfkiltgageqwv`)
and the Enveil storefront (`enveilbd.com`), using one clearly marked fictional test order.
No merge was performed. No payment was collected from a customer and no goods were shipped.

Test order: WooCommerce **#8867**, note `DOKANOS SYNC TEST - DO NOT SHIP - automated E2E
verification 2026-11-23`, customer `DOKANOS SYNC TEST` / `01000000000` /
`dokanos-e2e@example.com`, 1 × "Contrast Polo T-shirts-Black - L" ৳1,195 + ৳80 shipping,
Cash on delivery. Local order number `EE-8867-W`.

## What was verified working

| Path | Result | Evidence |
| --- | --- | --- |
| Migration state | 217 applied, `upsert_woocommerce_order_v2` present, `woocommerce_sync_work_live_identity_key` installed, old `(connector_id, identity_key, state)` unique index gone | read-only SQL on `supabase_migrations.schema_migrations` and `pg_class` after CHG-2026-11-23-02 |
| Worker/reconcile deploy | both `version 5`, `ACTIVE`, `verify_jwt=false` | dashboard function list, CHG-2026-11-23-01 |
| Schedulers | job 18 `woocommerce-sync-worker-5min` (`*/5`), job 19 `woocommerce-reconciliation-15min` (`*/15`), both active | `cron.job` |
| Inbound creation | Woo order 06:31:32Z → webhook received 06:32:00Z → local order persisted 06:35:05Z (~4 min) | `orders`, `order_items`, `woocommerce_order_identities`, `woocommerce_sync_work` |
| Inbound field mapping | totals 1195 + 80 = 1275, `payment_method cod`, `payment_status unpaid` (ADR-0001), `fulfillment_type delivery`, notes preserved, product line "Contrast Polo T-shirts-Black - L" | `public.orders` row `e3902af2-9d4d-453c-9cd8-7e2a0a0958e1` |
| Order numbering | `EE-8867-W` (configured prefix + Woo number + `W`), not the legacy `EE-WC-<connector>-<n>W` | order row + UI |
| Frontend list | row renders number, date, customer, phone, address, brand, source "Enveil WooCommerce", item count, total, payment, delivery, status; tab counts moved All 4211→4212, New 4→5 | preview `/orders` |
| Frontend detail | modal (there is no `/orders/:id` route) shows brand, source, payment method/status, delivery method, customer, line item, subtotal/discount/shipping/total, preserved notes, status combobox | `src/pages/Orders.tsx:678`, `src/pages/Orders.tsx:1018` |
| Outbound delivered→completed | log COD collection (cash ৳1,275) → paid; set Delivered → Woo order becomes `Completed`; write row `succeeded`, `confirmed_status: completed` | `woocommerce_outbound_writes` `ecc2965f-…`, `woocommerce_sync_work` `355a09c0-…` |
| Outbound pre-dispatch cancel | local cancel → Woo `cancelled`, write `succeeded`, `confirmed_status: cancelled` | same tables, second write |
| Reconciliation | sees a changed `date_modified` and enqueues one `order_refresh`; runs recorded `succeeded` with zero failures | `woocommerce_reconciliation_runs`, work `ee4f22c4-…` |
| Local tests | typecheck, 1074 unit tests, 42 mocked browser tests, 7/7 WooCommerce SQL tests, 6/6 vertical sync, 16/16 intake race, build — all pass | see `woocommerce-premerge-test-matrix.md` |

## Defects found (none fixed in this pass)

### D1 — High: every inbound echo resets a COD order's `payment_status` to `unpaid`

`src/lib/woocommerceConnector.ts:167` maps `cash_on_delivery` to `unpaid` **before** it looks
at the Woo order status, and the update branch of `upsert_woocommerce_order` (latest body in
`supabase/migrations/20261112140000_woocommerce_order_snapshot_and_prefix_repair.sql`) does
`payment_status = coalesce(nullif(p_payment_status,''), target.payment_status)`, i.e. the
external mapping unconditionally overwrites the local collection record.

Observed: after the delivered→completed write, the echo webhook flipped the order from
`paid` back to `unpaid` while the ৳1,275 cash payment row still existed. The UI then showed
`Unpaid` in the orders list. Re-saving the status from the sheet repaired it (that path runs
`recomputePaymentStatus`), so any Woo-side status change silently un-pays a collected order
until someone re-saves it. This is the same symptom already noted at
`docs/verification/woocommerce-e2e-production-checklist.md:192`.

### D2 — High: a Woo cancellation never reaches DokanOS and the divergence is invisible

Two independent causes:

1. `src/lib/woocommerceConnector.ts:159` maps `completed/cancelled/refunded/failed/trash` to
   `pending`, and `supabase/migrations/20261112160000_woocommerce_order_contract_v2.sql:157-163`
   only advances `status` while the row is still `pending`/`payment_pending`. A terminal
   external status therefore never overrides a local status that has moved on.
2. Nothing in `src/` reads `woocommerce_external_status` (only `src/test/woocommerceVerticalSync.test.ts`
   does), and `woocommerce_sync_conflicts` is read only by `supabase/functions/woocommerce-admin/index.ts:186/209`,
   a function no `src/` code invokes.

Observed: Woo order cancelled at 06:56:43Z; after processing, local `orders.status` was still
`delivered`; a conflict row `external_terminal_after_local_work` was written with
`resolution: null`; the orders page still showed `Delivered`, and nothing in the UI hints at
the divergence. An order cancelled by the customer in Woo can therefore still be dispatched.

### D3 — High: cancelling a delivered order pushes `cancelled` to Woo

`enqueue_woocommerce_outbound_on_order_status()` in
`supabase/migrations/20261110100000_woocommerce_outbound_trigger.sql` decides "pre-dispatch"
from current state only — `active_consignment := (NEW.consignment_id IS NOT NULL AND btrim <> '') OR any_active_shipment`
— and never looks at `OLD.status`. An order with no consignment row that is already
`delivered` (or `entered`/`accepted`) still enqueues a Woo `cancelled` write.

Observed: cancelling `EE-8867-W` (local `delivered`, no consignment) created a
`pre_dispatch_cancel` write that the worker delivered to Woo as `cancelled`. In this test Woo
was already cancelled, so nothing changed there; had Woo still been `completed`, the write
would have erased the completion record on the store side.

### D4 — Medium: a second webhook for the same order is acknowledged but thrown away

`accept_woocommerce_webhook_delivery` in
`supabase/migrations/20261111100000_woocommerce_durable_intake.sql:33` reuses an existing
pending `inbound` work row for the same order without merging the newer payload, and only the
work's own `related_delivery_id` is ever marked processed.

Observed: deliveries at 06:32:00Z (processed 06:35:05Z) and 06:32:17Z (both `accepted`) — the
second is permanently `processed_at NULL`. An `order.updated` that arrives inside the 5-minute
worker window is silently dropped and only recovered if the 15-minute reconciliation scan
notices `date_modified`.

### D5 — Medium: normal echoes are recorded as errors and inflate `replayed`

Every post-write webhook ends `state: "replayed"` with
`last_error {"reason":"duplicate_succeeded","prior_state":"succeeded"}`. At 07:12Z the census
was `succeeded 136, replayed 55, dead_letter 4, pending 0` — i.e. most of the "replayed" bucket
is ordinary echo traffic, and the fake error makes genuine finish failures harder to spot.

### D6 — Medium: the dashboard's Store Health is a retired surface

`src/components/integrations/OrderSourcesPanel.tsx:62` and
`src/components/order-sources/LegacySourceRows.tsx:43` render `stores.status` and
`stores.last_synced_at`. `supabase/migrations/20261103160000_retire_woocommerce_integration.sql`
deliberately kept those columns while removing the writer, so the dashboard permanently shows
`error` and "Synced 28 days ago" / "about 1 month ago" for both stores even though
`woocommerce_connectors` is healthy (`last_reconciliation_at` minutes old, `webhook_status active`,
which the dashboard never shows). `public.sync_health` (`supabase/migrations/20260903000300_sync_health_view.sql`)
still reads the retired `sync_queue`/`stores` too.

### D7 — Low: raw enum in the order detail badge

The detail sheet header renders `new_order` while the list renders "New Order".

### D8 — Low: dead code in the worker

`supabase/functions/woocommerce-worker/index.ts:12` defines
`const TERMINAL = new Set(["cancelled","refunded","failed","trash"])` and never uses it.

### D9 — Fixed in this pass: the recovery runner's migration list went stale

`scripts/prod-migrate.mjs` carried a hardcoded eight-migration list that did not include
`20261112160000_woocommerce_order_contract_v2.sql` or `20261113130000_woocommerce_work_identity_liveness.sql`,
so `--dry-run` printed "Nothing to do: every requested migration is already applied" while
production was two migrations short. Fixed by refusing a default run whenever a migration on
disk is absent from the ledger and from the plan (`scripts/lib/woocommerce-migration-plan.mjs`,
tested by `scripts/lib/woocommerce-migration-plan.test.mjs`, wired into the SQL CI job as
"Recovery plan completeness"). `--only` remains an explicit operator override.

### D10 — Low: orders page renders every row client-side

4212 orders; the list timed out twice ("Loading orders took longer than 20 seconds and was
cancelled" — `src/pages/orders/useOrdersData.ts:543`) before loading after a hard reload.

## Residue left in production

| Row | State |
| --- | --- |
| Woo order **8867** | `Cancelled`, marked `DOKANOS SYNC TEST - DO NOT SHIP` |
| `public.orders` `e3902af2-9d4d-453c-9cd8-7e2a0a0958e1` (`EE-8867-W`) | `cancelled`, `paid` (one ৳1,275 cash payment row), `woocommerce_external_status cancelled` |
| Customer `3bd2a931-d6bd-40f1-9398-2d8aa2dbe412` | fictional, name `DOKANOS SYNC TEST` |
| 4 `woocommerce_webhook_deliveries` | 3 processed, 1 permanently `processed_at NULL` (D4) |
| `woocommerce_sync_work` / `woocommerce_outbound_writes` for 8867 | inbound succeeded, echoed replays, 2 succeeded writes |
| `woocommerce_sync_conflicts` | one `external_terminal_after_local_work`, `resolution NULL` |

Nothing was deleted: the order is cancelled on both sides (matching), it is clearly marked,
and every row above is the evidence for the findings. Deleting it would also break the audit
trail that D1/D2/D4 point at.

## Four pre-existing dead letters were left in place

`inbound:8848`, `inbound:8855` (Enveil), `inbound:11047` (Vincent),
`reconcile:11066:2026-11-16T07:20:54` are still `dead_letter` with the old
`23505 woocommerce_finish_failed` error text. They are replayable
(`public.replay_woocommerce_sync_work(uuid)`), but a replay re-runs the inbound upsert, and
**until D1 is fixed that can reset `payment_status` on a real collected order**. Recommended
order of work: fix D1, then replay those four as the production proof of the 23505 fix.

## Merge recommendation

**Do not merge yet.** The pipeline works end to end in both directions, but D1, D2 and D3 are
live correctness problems on real data: a collected COD order can silently become unpaid, a
cancellation made in Woo leaves DokanOS believing the order is still deliverable, and a local
cancellation of a delivered order rewrites the store's order to cancelled. D4 and D5 make
failures harder to see; D6–D8 and D10 are cosmetic or operational.

Smallest credible fix set before merge: D1 and D2 in the contract + connector mapping, surface
`woocommerce_external_status`/conflicts in the order detail (or at minimum a badge), D3 in the
outbound trigger guard, D4 by merging the newer payload into the pending work row (or by
accepting the newest delivery only), D5 by using a distinct terminal state or a non-error field
for `duplicate_succeeded`.