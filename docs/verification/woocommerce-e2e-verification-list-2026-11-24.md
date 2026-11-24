<!-- FOR MUJAHID ONLY - AGENTS: SKIP THIS SECTION -->
## Summary (for Mujahid)
This is the complete WooCommerce verification list after the fixes: local checks prove the code is safe; live checks prove production behavior after deployment. Live production testing must use a clearly marked disposable order, must not collect real money, and must leave an audit trail.
<!-- END FOR MUJAHID ONLY - AGENTS: RESUME READING -->

# WooCommerce E2E verification list — 2026-11-24

## Verification record — 2026-11-24

- Local stack is running. The first SQL attempt exposed two outdated regression assertions; both tests were corrected to match the intentional D3/D4 safety behavior.
- `npm run test:local:woocommerce-sql -- --with-pending`: **8/8 passed**, each rollback-only test completed successfully.
- `npm run test:local:woocommerce-vertical`: **6/6 passed**.
- `npm run test:local:woocommerce-intake-race`: all concurrency checks passed: 8 simultaneous deliveries converged to one delivery row and one pending work row.
- `npm run test:local:webhook-bytea`: raw 20-byte payload, invalid UTF-8, NUL bytes, and `\\x` prefix preserved through local PostgREST; disposable probe function was removed.
- Earlier checks also passed: unit 1,068 passed with 9 skipped, browser 42 passed, focused UI 8 passed, migration-plan 5/5 passed, typecheck, build, runner syntax, and diff whitespace.
- No production deployment, mutation, or dead-letter replay occurred. Live/read-only preflight and post-deployment disposable-order proof remain open.


## 1. Local preflight

- [ ] Fresh-stack rehearsal (`supabase start`, `supabase db reset`, `supabase status`) was not performed in this continuation; the existing local stack was running and accepted the tests.
- [x] `npm run typecheck`.
- [x] `npm test -- --run`.
- [x] `npm run test:browser` and `npm run build`.
- [x] `npm run test:local:woocommerce-sql -- --with-pending`; every SQL test passes and ends with `ROLLBACK`.
- [x] `npm run test:local:woocommerce-vertical`, `npm run test:local:woocommerce-intake-race`, and `npm run test:local:webhook-bytea`.
- [x] `npm run test:local:migration-plan`; confirm every migration on disk is either in the ledger or explicitly planned.

## 2. Database and deploy preflight

- [ ] **LIVE/read-only:** verify the expected migration version, `upsert_woocommerce_order_v2`, `woocommerce_sync_work_live_identity_key`, and no duplicate live work identities.
- [ ] **LIVE/read-only:** verify worker and reconciliation functions are the intended version, `ACTIVE`, and `verify_jwt=false`; verify cron jobs 18 (`*/5`) and 19 (`*/15`) are active.
- [ ] **LIVE/read-only:** record connector status, `webhook_status`, `last_reconciliation_at`, open conflicts, retrying work, and dead letters before the test.
- [ ] Never paste credentials, webhook secrets, customer tokens, or access tokens into this document.

## 3. Inbound creation and mapping

- [ ] **LIVE:** place exactly one low-value in-stock COD order on each configured Woo store using a unique note such as `DOKANOS-E2E-<UTC timestamp>`, a fictional customer, and a clearly marked do-not-ship note.
- [ ] **LIVE/read-only:** locate the accepted webhook, the linked inbound work row, the Woo identity row, the DokanOS order, and its line items by connector and Woo order ID.
- [ ] Expect one effective inbound work item, `succeeded`, no duplicate order, no retry/dead-letter, and the newest webhook payload retained when two deliveries arrive before the worker runs.
- [ ] Verify order number is configured prefix + Woo order number + `-W`; totals equal subtotal + shipping - discount; COD is `unpaid`; notes, customer, variation, source, and delivery mode are preserved.

## 4. Outbound and echo protection

- [ ] **LIVE:** move the disposable order through the supported local status path; verify exactly one outbound write per local version and the Woo status confirmation.
- [ ] **LIVE:** after a COD collection is recorded locally, deliver/process the normal Woo echo; confirm local `payment_status` remains `paid` and the payment row remains unchanged.
- [ ] **LIVE:** repeat the same local save; confirm no duplicate write or loop.
- [ ] **LIVE:** test only a pre-dispatch cancellation on a fresh, not-entered order; confirm Woo becomes `cancelled`.
- [ ] **LIVE:** do not cancel a delivered/entered order as a production mutation test; confirm the local guard produces no cancellation write in local SQL tests.

## 5. Reconciliation

- [ ] **LIVE:** change the disposable Woo order through a supported action that updates `date_modified`.
- [ ] **LIVE/read-only:** verify one `order_refresh`, a successful reconciliation run, zero failures, and no duplicate DokanOS order.
- [ ] Verify the freshness watermark advances and an older payload cannot regress newer local/external facts.

## 6. UI and operational surface

- [ ] **LIVE:** open Dashboard, Brands, Integrations, and `/orders` for each business; record unexplained console/network errors.
- [ ] Verify the order list and detail modal show number, date, customer, phone, address, brand, Woo source, items, subtotal, discount, shipping, total, payment method/status, delivery mode, notes, and status.
- [ ] Verify an external terminal cancellation is either reflected as a safe local cancellation (before fulfilment) or visibly marked as an unresolved conflict (after fulfilment); it must never look silently deliverable.
- [ ] Verify `new_order` is displayed as `New Order`, not the raw enum.
- [ ] Verify health uses connector/reconciliation/work/conflict facts, not retired `stores.status` or `sync_queue` timestamps.

## 7. Negative and regression checks

- [ ] **LOCAL:** duplicate webhook intake keeps one effective live work row and retains the newest payload; both deliveries receive correct `processed_at` evidence.
- [ ] **LOCAL:** duplicate finish is `replayed` without `error_class`/`last_error`; genuine retry/dead-letter errors remain visible.
- [ ] **LOCAL:** terminal Woo cancellation after local fulfilment creates `external_terminal_after_local_work`; it does not enqueue a local-to-Woo cancellation.
- [ ] **LOCAL:** malformed webhook, stale payload, foreign owner, and repeated finish remain non-destructive; secrets are redacted.
- [ ] **LIVE:** do not replay the four pre-existing production dead letters until D1 is deployed and the read-only preflight is captured.

## 8. Cleanup and release gate

- [ ] **LIVE:** cancel the disposable test orders only through the approved supported path; keep the do-not-ship note and record all residue IDs.
- [ ] Do not delete production orders, webhook evidence, sync work, payments, or conflict rows.
- [ ] Confirm no generated secrets/artifacts are untracked; inspect `git status --short`.
- [ ] Merge remains blocked until the local suite is green and the live D1/D2/D3 proof is captured after deployment.
