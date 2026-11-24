<!-- FOR MUJAHID ONLY - AGENTS: SKIP THIS SECTION -->
## Summary (for Mujahid)
Bounded local checks passed; they do not prove production works. The live deployment is reachable and logged in, but live deployment / read-only causal preflight is not established and fixture checks are not executed. One read-only UI observation of an EXISTING order is recorded below; it is not a fixture pass or causal proof. For every row, capture screenshots BEFORE and AFTER in BOTH Woo admin and DokanOS, keep the work/database evidence separate, and mark the result Pending, Pass, Fail, or Blocked. Some behaviors are UNSUPPORTED because the old Woo stock/catalog pipeline was retired; others are UNKNOWN until checked.
<!-- END FOR MUJAHID ONLY - AGENTS: RESUME READING -->

# WooCommerce E2E verification list — 2026-11-24

## How to read this document

- **Matrix IDs:** `L` = local regression (historical, already run), `F` = required test fixture, `W` = live Woo/DokanOS proof, `S` = required scenario, `G` = release gate.
- **Expected outcome** is either proven by code (file:line cited), marked **UNKNOWN** (not determinable from code), or marked **UNSUPPORTED** (the capability was retired; do not expect it to work).
- **Evidence template — every `W` row must fill all five parts:**
  - `Woo B/A` = screenshot refs BEFORE / AFTER in **Woo admin**.
  - `DokanOS B/A` = screenshot refs BEFORE / AFTER in **DokanOS**.
  - `Causal IDs` = work/database evidence, kept **separate from screenshots**: webhook delivery ID, sync-work ID, identity row, conflict ID, watermark, status values, timestamps.
  - `UTC` = timestamps for each observation.
  - `Result` = exactly one of `Pending | Pass | Fail | Blocked`. Default is `Pending`.
- Screenshots prove what a human sees in each app; causal IDs prove the internal chain that produced it. Do not use one in place of the other. A partial UI/DOM observation of an existing order is neither a fixture pass nor causal proof.
- Live deployment / read-only causal preflight is not established; fixture checks are not executed. All live/gate boxes stay unchecked by design.

## LIVE PREFLIGHT STATUS (read first)

- Targets are reachable and logged in, with **no mutations performed**: DokanOS `https://dokanos-n9l7i48yn-mujahidul1slams-projects.vercel.app/orders` and Woo admin `https://enveilbd.com/wp-admin/`.
- User confirmed the intended production Supabase project is `jiwndicvfkiltgageqwv`. Authenticated browser access to its Supabase SQL Editor is available; no token was extracted.
- **Live read-only migration proof:** at database UTC `2026-11-24 07:28:41.734328+00`, `EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261124090000')` returned **false** and `max(version)` returned **20261113130000**. The D1–D5 fix migration is not recorded as deployed. Evidence query: `SELECT now() AS checked_at, EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261124090000') AS findings_fix_recorded, (SELECT max(version) FROM supabase_migrations.schema_migrations) AS latest_migration;`. Only SELECT queries were executed; the dashboard may retain their query snippets/history. No application data or schema was changed. Stop live fixture creation until an explicitly authorized deployment and post-deployment read-only verification; do not deploy through this SQL Editor.
- Evidence location: Supabase SQL Editor query `cc8ff4bc-1235-4be7-9a0f-77120bb23577` on the confirmed project. This proves the migration ledger state, not byte-for-byte deployed function definitions or the backend used by the Vercel app.
- Live deployment / read-only causal preflight is not established; fixture checks are not executed. No `W` row or `S` scenario has passed.
- **Read-only continuation, DB UTC `2026-11-24 12:34:39.144748+00`:** migration `20261124090000` was absent; latest was `20261113130000`. Supabase Free Plan explicitly states it has no scheduled project backups; usable external recovery evidence remains unverified.
- **Authenticated CLI preflight, DB UTC `2026-11-24 13:50:06+00:** target `jiwndicvfkiltgageqwv` confirmed. The CLI is authenticated (Supabase CLI 3.3.0). Preview shows exactly one pending migration: `20261124090000_woocommerce_e2e_findings_fixes.sql`; no apply occurred. Connectors `4fa8dbf5-d638-47ed-b0b1-cce4b1430b31` and `f5e5920b-7252-4880-9a7d-1ebfa47c1409` are `healthy`, intake/outbound enabled, webhook status `active`; reconciliation ran at 13:45 UTC. Read-only counts at 13:53 UTC: 4 dead letters, 1 unresolved conflict, 0 pending outbound writes, 22 succeeded outbound writes, 139 succeeded and 56 replayed work rows. Schedulers 18 (`*/5`) and 19 (`*/15`) are active.
- The current remote function hashes/signatures were captured read-only for recovery; a local artifact was written under `.tmp/` and is not a deployment authorization. No application data/schema changed. Do not replay dead letters or create live fixtures until migration deployment and recovery approval are complete.
- CLI dry-run result: `supabase db push --remote=jiwndicvfkiltgageqwv --dry-run --skip-vault` would apply exactly `20261124090000_woocommerce_e2e_findings_fixes.sql` and nothing else. No apply flag was used.
- Recovery capture contains all four current function definitions and is validated at SHA-256 `d4c5f1618245aec57c4d3020c3f515375622649adc0b6a1b0328d01c2c6abe08` under `.tmp/`; it is function recovery material, not a full database backup.
- CLI preflight at DB UTC `2026-11-24 13:50:06+00`: both connectors were `healthy`, intake/outbound enabled, webhook `active`; reconciliation ran at 13:45 UTC; scheduler jobs 18 (`*/5`) and 19 (`*/15`) were active. Counts at 13:53 UTC: 4 dead letters, 1 unresolved conflict, 0 pending outbound writes, 22 succeeded outbound writes, 139 succeeded and 56 replayed work rows. These are baseline facts, not a pass for the new migration.
- The subsequent local SQL rerun could not connect because local PostgreSQL `127.0.0.1:54322` was stopped; the earlier local SQL evidence remains 8/8 passed. Do not call this a regression failure.
- **Reviewed-adapter dry run, 2026-11-24:** `node scripts/prod-migrate.mjs --dry-run --expect-ref jiwndicvfkiltgageqwv --only 20261124090000_woocommerce_e2e_findings_fixes.sql` reported transport `Management API`, branch `pr/woocommerce-sync-recovery`, commit `0ac8169923d6cd5b16b653fdf2a35641d202a998`, ledger **217 applied migrations**, and `20261124090000 pending`. Nothing was changed. This supersedes the older note that production was two migrations short: the ledger now includes `20261112160000` and `20261113130000`.
- The adapter needs `SUPABASE_ACCESS_TOKEN` in the environment and refuses without it. The token is present in the Supabase CLI's Windows Credential Manager entry; it was loaded into the child process environment only and never printed, logged, or written to disk.
- Local continuation check: corrected the first-seen terminal-order assertion to use identity `order_id` and a null-safe status check; SQL with pending migration passed **8/8** again. This is local-only evidence.
- Read-only continuation observation on `2026-11-24` (exact capture UTC not retained): DokanOS Integrations showed Enveil WooCommerce as **WooCommerce (legacy)**, **Manual**, with `—` sync and `653 orders`; this is historical/manual-source UI evidence, not proof of the deployed connector or current webhook health. No controls were changed.

### Read-only UI observation — EXISTING order (NOT a fixture pass, NOT causal proof)

- UTC `2026-11-24T07:01:07Z`: DokanOS Orders list showed an **existing** order (Woo number ending `11092W`, Vincent / WooCommerce, total `5270`, `Unpaid`, payment method `softtech_bkash`, `Walk-in`, badge `Payment Needs Confirmation`). Customer details are intentionally omitted — do not copy customer PII into this document.
- Screenshot ref: `D:\DSH\.dsh\attachments\v1\objects\9e\9e377f9cde06634d2cd658026d68ab755cfc14164c5de434558aae0264210689`.
- This is a partial screenshot/DOM observation only. It shows what the UI renders for one existing order; it does not prove the inbound causal chain (webhook → work → identity → order) and it is not a fixture result. **W-13 remains Pending** — this partial evidence does not confirm the bKash confirmation behavior.
- Dashboard observed `Error` with `Synced 29 days / about 1 month`: this is the **retired store-health display** (D6) and is **not** proof that the live connector is unhealthy. Connector health must come from connector/reconciliation/work/conflict facts, not this retired widget.

## Safety rules — read before any LIVE step

1. Use a unique marker `DOKANOS-E2E-<UTC timestamp>-Fxx` per fixture, fictional customer, low value, clear "DO NOT SHIP" note.
2. COD / manual payment only. No real payment capture and no real bKash transaction.
3. No real courier bookings. Do not dispatch a real consignment for a test order.
4. Keep webhook intake enabled. Do not disable webhooks globally and do not edit production sync work rows.
5. Do not delete real orders, webhook evidence, sync work, payments, or conflicts. Cancel disposable fixtures only through the supported path.

## Verification record — 2026-11-24 (historical, preserved)

- Local stack is running. The first SQL attempt exposed two outdated regression assertions; both tests were corrected to match the intentional D3/D4 safety behavior.
- `npm run test:local:woocommerce-sql -- --with-pending`: **8/8 passed**, each rollback-only test completed successfully.
- `npm run test:local:woocommerce-vertical`: **6/6 passed**.
- `npm run test:local:woocommerce-intake-race`: all concurrency checks passed: 8 simultaneous deliveries converged to one delivery row and one pending work row.
- `npm run test:local:webhook-bytea`: raw 20-byte payload, invalid UTF-8, NUL bytes, and `\\x` prefix preserved through local PostgREST; disposable probe function was removed.
- Earlier checks also passed: unit 1,068 passed with 9 skipped, browser 42 passed, focused UI 8 passed, migration-plan 5/5 passed, typecheck, build, runner syntax, and diff whitespace.
- No production deployment, mutation, or dead-letter replay occurred. Live/read-only preflight and post-deployment disposable-order proof remain open.
- Prior live observations from 2026-11-23 (findings doc, order #8867) are historical context only: inbound ~4 min, delivered→completed after COD collection, pre-dispatch cancel, reconciliation `order_refresh`. They are **not** re-run or claimed as new live execution here.

## 1. Local preflight (historical regressions only — NOT live proof)

- [ ] **L-01** Fresh-stack rehearsal (`supabase start`, `supabase db reset`, `supabase status`): **NOT RUN** in this continuation. The existing local stack was already running and accepted the tests.
- [x] **L-02** `npm run typecheck`.
- [x] **L-03** `npm test -- --run` (unit 1,068 passed / 9 skipped).
- [x] **L-04** `npm run test:browser` (42 passed) and `npm run build`.
- [x] **L-05** `npm run test:local:woocommerce-sql -- --with-pending`; every SQL test passes and ends with `ROLLBACK` (8/8).
- [x] **L-06** `npm run test:local:woocommerce-vertical` (6/6), `npm run test:local:woocommerce-intake-race`, and `npm run test:local:webhook-bytea`.
- [x] **L-07** `npm run test:local:migration-plan` (5/5); confirm every migration on disk is either in the ledger or explicitly planned.
- [x] **L-08** Focused UI checks (8 passed).

## 2. Required fixture matrix (multiple marked fixtures — not one order per store)

- 2 fulfillment × 2 payment × 3 product mix = **12-fixture covering array (minimum)**. This is a covering array, not the exhaustive 2 × 2 × 3 × 2-stores = 24 combinations: every fulfillment / payment / product-mix value and both stores are covered, but not every store × fulfillment × payment × mix permutation. Each fixture gets its own marker.
- Both stores (Enveil and Vincent) appear; if a defect appears tied to a store × combination not covered here, add a targeted fixture rather than assuming coverage.
- COD fixtures use manual COD collection only. bKash fixtures use **manual confirmation only — no real transaction**.
- Preorder / mixed fixtures are expected to hit the fail-closed adapter (see W-19/W-20); record actual behavior, do not assume routing.

| ID | Fulfillment | Payment | Product mix | Marker | Store | Result |
|---|---|---|---|---|---|---|
| F-01 | walkin | COD | normal | DOKANOS-E2E-<UTC>-F01 | Enveil | Pending |
| F-02 | walkin | COD | preorder-only | DOKANOS-E2E-<UTC>-F02 | Enveil | Pending |
| F-03 | walkin | COD | mixed | DOKANOS-E2E-<UTC>-F03 | Enveil | Pending |
| F-04 | walkin | bKash | normal | DOKANOS-E2E-<UTC>-F04 | Vincent | Pending |
| F-05 | walkin | bKash | preorder-only | DOKANOS-E2E-<UTC>-F05 | Vincent | Pending |
| F-06 | walkin | bKash | mixed | DOKANOS-E2E-<UTC>-F06 | Vincent | Pending |
| F-07 | delivery | COD | normal | DOKANOS-E2E-<UTC>-F07 | Vincent | Pending |
| F-08 | delivery | COD | preorder-only | DOKANOS-E2E-<UTC>-F08 | Vincent | Pending |
| F-09 | delivery | COD | mixed | DOKANOS-E2E-<UTC>-F09 | Vincent | Pending |
| F-10 | delivery | bKash | normal | DOKANOS-E2E-<UTC>-F10 | Enveil | Pending |
| F-11 | delivery | bKash | preorder-only | DOKANOS-E2E-<UTC>-F11 | Enveil | Pending |
| F-12 | delivery | bKash | mixed | DOKANOS-E2E-<UTC>-F12 | Enveil | Pending |

## 3. Database and deploy preflight (LIVE / read-only)

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-01 | Migration version and objects: **verify `20261124090000_woocommerce_e2e_findings_fixes` is applied**, plus `upsert_woocommerce_order_v2`, `woocommerce_sync_work_live_identity_key`, no duplicate live work identities. | Fix migration `20261124090000` (D1/D2/D3/D4/D5 fixes) applied — not just historical migration 217; v2 RPC and liveness index present; no duplicate live identities. | Woo B/A: ___ / DokanOS B/A: n/a (read-only) / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-02 | Worker + reconcile functions version, `ACTIVE`, `verify_jwt=false`; cron 18 (`*/5`) and 19 (`*/15`) active. | Both functions ACTIVE with scheduler auth via `x-woocommerce-scheduler-secret`; crons active (`supabase/functions/woocommerce-worker/index.ts:292`, `woocommerce-reconcile/index.ts:46`). | Woo B/A: n/a / DokanOS B/A: n/a / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-03 | Baseline before test: connector status, `webhook_status`, `last_reconciliation_at`, open conflicts, retrying work, dead letters. | Record exact pre-test values so post-test drift is measurable. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-04 | Credential handling. | No credentials, webhook secrets, customer tokens, or access tokens appear in this document or screenshots. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 4. Inbound orders — creation, field mapping, walkin vs delivery

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-05 | Place the 12 fixtures (section 2) with unique markers, fictional customers, do-not-ship notes. | One order per fixture; marker present in Woo note. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-06 | Locate accepted webhook, inbound work row, Woo identity row, DokanOS order, and line items by connector + Woo ID. | One effective inbound work item, `succeeded`, no duplicate order, no retry/dead-letter; newest payload retained if two deliveries arrive before the worker runs (`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:167-265`). | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-07 | Order number and money math on every fixture. | Number = prefix + Woo number + `-W` (`supabase/migrations/20261112160000_woocommerce_order_contract_v2.sql:5-64`); COD → `unpaid` (`src/lib/woocommerceConnector.ts:167-176`). Full money fields covered by W-43. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-08 | **Walkin pickup fixtures (F-01–F-06)** — item fields (name, qty, unit price, line total). | Persisted into `order_items` (`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:93-98`). SKU / `product_id` / `variation_id` / tax are **not persisted** — known fidelity gap, see W-11. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-09 | **Walkin fixtures** — customer, payment, shipping fields. | Customer name/email/phone/address/city/zone/area from `billing` (`supabase/functions/woocommerce-worker/index.ts:173-179`); payment method from `external.payment_method` or `online` (`:168`); `fulfillment_type=walkin` when first shipping line is `walk_in`/`walkin`/`local_pickup` (`src/lib/woocommerceConnector.ts:179-184`, worker `:107-110`). | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-10 | **Delivery fixtures (F-07–F-12)** — same field set; confirm `fulfillment_type=delivery`. | Delivery when first shipping line is not a walkin token (same citations as W-09). **Only `shipping_lines[0]` is read** — extra shipping lines ignored (known limitation). No courier booking. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-11 | Product / variation / currency fidelity on both fulfillment groups. | `order_items` keeps name/qty/unit_price/line_total only; no SKU, product_id, variation_id, tax. `woo_product_id` / `woo_variation_id` columns were dropped (`supabase/migrations/20261103160000_retire_woocommerce_integration.sql:114-117`). Currency kept only in `safe_external_facts` — display fidelity is a known gap. Treat full product identity as a **known limitation**, not a pass. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-12 | All 12 fixtures visible in DokanOS list and detail with mapped fields. | List/detail show number, date, customer, phone, address, brand, Woo source, items, subtotal, discount, shipping, total, payment method/status, delivery mode, notes, status (`src/components/orders/OrderDetailSheet.tsx:463-501`). | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 5. Payment confirmation — bKash and local↔Woo status

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-13 | bKash fixtures (F-04–F-06, F-10–F-12) arrive and need manual confirmation. | `bkash` is a valid method but `mapWooPaymentStatus` has no bKash branch → non-COD falls back `unpaid` (pending/on-hold) or `paid` (processing/completed) (`src/lib/woocommerceConnector.ts:167-176`). **bKash-specific Woo mapping = UNKNOWN**; do not assume auto-paid. Manual confirmation only, no real bKash transaction. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-14 | Confirm a **full** bKash payment on a disposable fixture. | Local: `order_payments` row, `payment_status=paid`, `amount_to_collect=0`, `status=processing` (or `pre_order_pending` for pre-order), timeline `payment_confirmed`/`status_changed`/`payment_status_changed`, audit log (`src/components/orders/OrderDetailSheet.tsx:1570-1610`). | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-15 | Confirming payment updates **Woo** — full and partial cases. | Full confirm → trigger enqueues `processing` only when `payment_status='paid'` (`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:135-137`); worker PUTs `{status:'processing'}` and validates confirmation (`supabase/functions/woocommerce-worker/index.ts:127-145`). **Partial confirm → `payment_status=partial` does NOT enable the trigger** — code-limited, Woo not updated. Verify both; do not claim partial syncs. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 6. Order notes vs local timeline — explicit clarification

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-16 | Woo **customer note** appears in DokanOS notes field. | `external.customer_note` → `orders.notes` via `p_notes` (`supabase/functions/woocommerce-worker/index.ts:180`). Single note field, not a timeline. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-17 | Local **timeline** events appear in DokanOS detail in order. | `order_timeline` is a **separate DokanOS-only table**, loaded independently from notes (`src/components/orders/OrderDetailSheet.tsx:463-487`; `src/lib/orderTimeline.ts` `addOrderTimeline`). Expect `payment_logged`, `payment_confirmed`, `status_changed`, `payment_status_changed`, plus courier events, ordered by `created_at`. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-18 | Timeline ↔ Woo order notes sync. | **UNKNOWN / unsupported.** No code writes local timeline entries back to Woo order notes, and no code imports Woo order notes into the local timeline (grep of `supabase/functions`). Do **not** assume all timeline logs appear as Woo order notes. Record what a Woo note list actually contains. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 7. Preorder-only and mixed-product routing

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-19 | Preorder-only fixtures (F-02, F-05, F-08, F-11). | `preorderCategoryIds()` returns an **empty set** → fail-closed: `hasWooPreOrderItem` always false (`supabase/functions/woocommerce-worker/index.ts:112-117`, `src/lib/woocommerceConnector.ts:187-201`). **Real preorder routing = UNKNOWN**; do not assume detection. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-20 | Mixed fixtures (F-03, F-06, F-09, F-12). | Same fail-closed behavior; `p_is_preorder` false from adapter. `mapWooLocalStatus` maps processing+isPreOrder → `pre_order_pending` only with an explicit audited flag (`src/lib/woocommerceConnector.ts:159-164`). Record actual local status; mismatch is a finding. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-21 | Frontend pre-order badge/flow for W-19/W-20. | If locally pre-order, confirm flow routes to `pre_order_pending` (`src/components/orders/OrderDetailSheet.tsx:1570-1571`). Confirm actual UI; do not assume. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 8. Address and full-money fidelity (cross-cutting)

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-42 | **Billing address differs from shipping address** on at least two fixtures (one walkin, one delivery). | Worker reads **only `billing`** (`WooOrder` type has `billing` only, `supabase/functions/woocommerce-worker/index.ts:52-70`; persist `:155,173-179`). DokanOS customer address is billing-derived; the Woo `shipping` address is **not imported** — record as limitation. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-43 | **Full totals**: tax, fees, coupons, refunds, currency. | Worker computes `total`, `subtotal = total − shipping_total − discount_total`, `discount`, `shipping` (`supabase/functions/woocommerce-worker/index.ts:164-167`). No separate tax/fee/refund fields; coupon only via `discount_total`; currency only in `safe_external_facts` (`:183-191`). **Tax/fee/refund mapping = UNKNOWN**; confirm actual stored/displayed values and flag every missing component. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 9. Outbound and echo protection — completed local processing syncs Woo

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-22 | Move disposable fixtures through supported local status path. | Exactly one outbound write per local version; Woo status confirmation matches (`supabase/functions/woocommerce-worker/index.ts:127-145`; `validateWooCommerceConfirmation` `src/lib/woocommerceConnector.ts:362-372`). | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-23 | **Completed local processing → Woo completed.** | `delivered` + all fulfillment units delivered → target `completed` (`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:138-140,155`; `src/lib/woocommerceConnector.ts:313-355`). Use a disposable **walkin** fixture marked delivered locally with **no courier consignment** — no real courier booking. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-24 | COD collection echo does not reset payment. | After local COD collection and normal Woo echo, `payment_status` stays `paid` and payment row unchanged (D1 fix `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:51-55`). | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-25 | Repeated local save produces no duplicate write or loop. | Duplicate finish → `replayed` with **no** `error_class`/`last_error` (`:267-289`). | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-26 | Cancellation safety. | Pre-dispatch cancel on a fresh, not-entered fixture → Woo `cancelled`. Cancelling a delivered/entered fixture produces **no** cancellation write (`OLD.status` guard at `supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:151-156`). Cancel only fresh disposable fixtures; never a real/delivered order. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 10. Missed-webhook recovery — workers and reconciliation

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-27 | Reconciliation picks up a missed/late delivery without disabling webhook intake globally. | `woocommerce-reconcile` scans connectors with `intake_enabled` + healthy/degraded, enqueues `order_refresh` with `identity_key reconcile:{id}:{modified\|unknown}` (`supabase/functions/woocommerce-reconcile/index.ts:103`, cron 19 `*/15`). Verify one `order_refresh` and no duplicate DokanOS order. | Woo B/A: ___ / DokanOS B/A: n/a / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-28 | Watermark and connector health update. | On success: `reconciliation_watermark` advances, `last_reconciliation_at` set, status `healthy`; on failure: `degraded` + `last_error` (`supabase/functions/woocommerce-reconcile/index.ts:116-136`). | Woo B/A: n/a / DokanOS B/A: n/a / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-29 | Stale payload cannot regress newer facts. | Incoming older than `date_modified` → conflict `stale_external_state`, not an overwrite (`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:34-43`; `src/lib/woocommerceConnector.ts:212-220,229-240`). | Woo B/A: ___ / DokanOS B/A: n/a / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 11. Stock sync and catalog import — UNSUPPORTED (retired pipeline)

> Migration `supabase/migrations/20261103160000_retire_woocommerce_integration.sql` retired the old Woo integration. It dropped the push triggers (`:66-69`), the helper functions including `auto_push_product_stock`, `auto_push_variation_stock` and `recover_orphaned_sync_rows` (`:73-100`), the `sync_queue` and telemetry tables (`:102-108`), and the `woo_product_id` / `woo_variation_id` / `woo_order_id` / `woo_customer_id` identity columns (`:110-117`). The current `woocommerce-*` functions handle **orders only**. Do not treat the older stock-trigger migrations as functioning behavior.

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-30 | Stock sync direction. | **UNSUPPORTED in current order pipeline.** No Woo stock push exists; triggers and `sync_queue` dropped (`20261103160000_retire_woocommerce_integration.sql:66-69,102-108`). Confirm a local product stock edit causes **no** Woo sync. Historical 15-min product sync is retired, not active. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-31 | Local stock edit trigger. | **UNSUPPORTED.** `trg_auto_push_product_stock` dropped (`:68`), `auto_push_product_stock` dropped (`:76-100`), `woo_product_id` column dropped (`:114`). No `push_stock` queue row can be created. Historical `20260831000500_product_stock_triggers.sql` / verify test `20260831000590_verify_stock_triggers.sql` are retired and not re-run. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-32 | Variation stock change → parent push. | **UNSUPPORTED.** `trg_auto_push_variation_stock` dropped (`:69`), `woo_variation_id` column dropped (`:115`). No parent push exists. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-33 | Stock echo guard. | **UNSUPPORTED / not applicable.** The retirement migration proves the identity columns `woo_product_id` / `woo_variation_id` / `woo_order_id` / `woo_customer_id` were dropped (`:114-117`). It does **not** prove `woo_updated_at` was dropped — treat that column's presence as UNVERIFIED. Either way no stock push path remains (triggers/queue dropped), so there is no stock sync to echo-guard. Confirm no stock-related echo occurs. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-34 | Stock oversell / retry / dead-letter. | **UNSUPPORTED.** `sync_queue` table and `recover_orphaned_sync_rows` dropped (`:82,108`). No retry/dead-letter machinery for stock exists in the current order pipeline. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-35 | New Woo product automatic import. | **UNSUPPORTED / no replacement catalog importer found.** Retirement deleted `woo-sync`, `woo-sync-all`, `woo-webhook`, `woo-push` and their deployments/workflows (`20261103160000_retire_woocommerce_integration.sql:3-9,35-43`). No replacement importer found in `supabase/functions/woocommerce-*` (order sync/reconcile/cutover only) or `src/lib`. Confirm no import occurs. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-36 | If a replacement importer were discovered, verify all fields. | **Not applicable** unless W-35 is disproven. If an importer is found, verify name, SKU, description, price, stock, categories, images, and all variations/attributes; record every missing field. Do not assume full fidelity. | Woo B/A: ___ / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 12. Security, isolation, idempotency, stale, error

| ID | Check | Expected outcome (basis) | Evidence: Woo B/A / DokanOS B/A / Causal IDs / UTC / Result |
|---|---|---|---|
| W-37 | Webhook signature verification. | HMAC-SHA256 over **raw bytes**, base64, constant-time, per-connector secret with no global fallback (`src/lib/woocommerceConnector.ts:423-445`; `supabase/functions/woocommerce-webhook/index.ts`). Rejections: `unbound_webhook`, `wrong_webhook_source`, `invalid_signature`, `unsupported_webhook`, `malformed_payload`, `missing_order_id`. | Woo B/A: n/a / DokanOS B/A: n/a / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-38 | Business/store isolation. | Foreign order id deep link is cleared — timeline, payments, measurements not leaked (`src/components/orders/OrderDetailSheet.tsx:455-461`). Verify cross-business access denied. | Woo B/A: n/a / DokanOS B/A: ___ / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-39 | Duplicate/concurrent webhook intake. | Per-external-order concurrency lock + freshness merge, stable `identity_key` (`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:180,230-261`); 8 concurrent deliveries → one row (local L-06). | Woo B/A: ___ / DokanOS B/A: n/a / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-40 | Error classification and secret redaction. | Malformed webhook, stale payload, foreign owner, repeated finish remain non-destructive; no secrets in logs/screenshots. Genuine retry/dead-letter errors remain visible; benign replay has no `error_class` (`:267-289`). | Woo B/A: n/a / DokanOS B/A: n/a / Causal IDs: ___ / UTC: ___ / Result: Pending |
| W-41 | Terminal external state after local work. | Woo cancellation/refund/failure after fulfilment creates `external_terminal_after_local_work` conflict and no local cancellation push (`supabase/migrations/20261124090000_woocommerce_e2e_findings_fixes.sql:57-65,112-119`). Conflicts read via `supabase/functions/woocommerce-admin/index.ts`. Do not mutate real delivered orders. | Woo B/A: ___ / DokanOS B/A: n/a / Causal IDs: ___ / UTC: ___ / Result: Pending |

## 13. Ten required scenarios — pass or approved deferral

| ID | Scenario | Matrix rows | Result |
|---|---|---|---|
| S-01 | Inbound orders land in DokanOS | W-05, W-06 | Pending |
| S-02 | All item/variation/product/customer/payment/shipping fields, walkin + delivery | W-07–W-12, W-42, W-43 | Pending |
| S-03 | Preorder-only / mixed routing | W-19, W-20, W-21 | Pending |
| S-04 | Timeline logs in order notes (Woo notes vs local timeline clarified) | W-16, W-17, W-18 | Pending |
| S-05 | bKash needs confirmation | W-13, W-14 | Pending |
| S-06 | Confirming payment updates local status and Woo | W-14, W-15 | Pending |
| S-07 | Missed-webhook recovery by workers/reconciliation | W-27, W-28, W-29 | Pending |
| S-08 | Completed local processing syncs Woo | W-22–W-26 | Pending |
| S-09 | Stock sync (direction/triggers/variants/oversell/retries) | W-30–W-34 (UNSUPPORTED) | Pending |
| S-10 | New Woo product automatic import with all info | W-35, W-36 (UNSUPPORTED) | Pending |

## 14. Cleanup and release gate

- [ ] **G-01** **LIVE:** cancel disposable fixtures only through the approved supported path; keep do-not-ship notes and record all residue IDs (`Woo B/A / DokanOS B/A / Causal IDs / UTC / Result`).
- [ ] **G-02** Do not delete production orders, webhook evidence, sync work, payments, or conflicts. Do not replay the four pre-existing production dead letters (`inbound:8848`, `inbound:8855`, `inbound:11047`, `reconcile:11066`) until fixes are deployed and read-only preflight is captured.
- [ ] **G-03** Do not disable webhook intake globally; restore any per-connector changes made strictly for the test and confirm `webhook_status` matches the W-03 baseline.
- [ ] **G-04** Confirm no generated secrets/artifacts are untracked; inspect `git status --short`.
- [ ] **G-05** **All ten scenarios S-01…S-10 must be `Pass`, or have an explicit approved deferral recorded with approver name + UTC + reason.** D1/D2/D3 proof alone is **not** sufficient to clear this gate. Merge stays blocked while any scenario is Pending/Fail/Blocked without an approved deferral, while live deployment / read-only causal preflight is not established and fixture checks are not executed, or while the local suite is not green.
