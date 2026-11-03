# DokanOS platform migration audit

Date: 2026-11-03  
Audited revision: `a5ab695` (`feat: update integrations and order workflows`) plus the existing uncommitted order/POS changes in the working tree.  
Audit focus: business accounts, brands, order sources, `business_id` tenancy, Woo retirement, Pathao dispatch/tracking, Orders filters, Dashboard, Analytics, POS Reports, and dependent order flows.

## Executive result

The migration is **not release-verifiable in this workspace** because the local Supabase/Docker stack is stopped. The frontend build is healthy, but the current browser audit found a real source-only business regression:

- Orders can load a source-only order (`store_id = NULL`, `order_source_id != NULL`).
- Dashboard says **“No stores in this business”**.
- Analytics shows **“No data”**.
- POS Reports shows no POS orders.

This is caused by those reporting surfaces still using `brands.woo_store_id → stores.id` as their only client scope even though the new key model makes `orders.business_id` authoritative and allows order-source-only rows.

WooCommerce sync is no longer present: the latest migration intentionally removes the Woo workers, queue, webhook log, push triggers, and sync health view. Pathao code remains present, but live dispatch/tracking could not be exercised without Supabase and external credentials.

## Checks actually run

| Check | Result | Evidence |
|---|---|---|
| Environment probe | **RED** | `npm run verify:env`: repo/Vite/files pass; Supabase, Edge Runtime, signup-event and Mailpit unavailable. |
| TypeScript | **PASS** | `npm run typecheck` |
| Production build | **PASS** | `npm run build` |
| Vitest | **PASS** | 86 files passed; 909 tests passed; 3 PostgreSQL tests skipped. |
| Repository lint | **FAIL** | 633 errors, 58 warnings across the repository. |
| Diff whitespace | **PASS** | `git diff --check` produced no whitespace errors. |
| Account browser suite | **39 PASS / 3 FAIL** | Chrome channel, `npx playwright test --config playwright.accounts.config.ts`. The 3 failures are stale expectations for Brands “New Store” and the old “Order Sources” sidebar name; current code intentionally uses Integrations. |
| Source-only browser audit | **PASS with findings** | `npx playwright test --config playwright.audit.config.ts`; 1 test passed. It verified the source-only order on Orders and the reporting failures above. Realtime connection errors were expected because the backend was stopped. |
| Real-stack smoke | **BLOCKED/FAIL** | `npm run test:smoke`: signup could not render against the stopped local stack; 7 dependent steps did not run. |

## Verification register

### A. Migration and backend contract checks

| ID | Human verification | Result |
|---|---|---|
| A1 | Apply the complete migration chain to a disposable database; confirm all migrations complete. | **BLOCKED** — Docker/Supabase unavailable. |
| A2 | Inspect `orders.business_id` and `customers.business_id` after migration; confirm rows derive from source/store bindings and cross-business bindings are rejected. | **BLOCKED** — SQL/RLS execution unavailable. |
| A3 | Verify RLS with owner/member/non-member users, two businesses, source-only orders, forged order IDs, and switched active-business context. | **BLOCKED** — no database/auth stack. |
| A4 | Run the SQL RLS battery and PostgreSQL account-readiness tests. | **BLOCKED** — PostgreSQL tests are visibly skipped without a local URL. |
| A5 | Verify pending-order normalization, consignment→`pickup_pending`, merged-order immutability, and 72-hour auto-cancel exclusions. | **BLOCKED** — database trigger/function execution unavailable. |
| A6 | Verify `order_brands` backfill and trigger updates for single-brand and mixed-brand POS orders. | **BLOCKED** — database execution unavailable. |
| A7 | Verify physical-only `is_stock_holding` constraint rejects digital/manual sources. | **BLOCKED** — database execution unavailable. |
| A8 | Verify `order_sources.is_default` uniqueness and Add Order default-source behavior. | UI unit coverage passed; live persistence **BLOCKED**. |

### B. Sync and integration checks

| ID | Human verification | Result |
|---|---|---|
| B1 | Change a Woo order in WooCommerce and confirm it imports into DokanOS. | **NOT AVAILABLE** — Woo sync was intentionally retired in `20261103160000`; `woo-sync`, `woo-sync-all`, and `woo-webhook` are gone. |
| B2 | Change a DokanOS order/product/stock row and confirm it pushes to WooCommerce with retry/idempotency. | **NOT AVAILABLE** — sync queue, push functions, triggers, and workflows were intentionally removed. |
| B3 | Confirm no stale Woo scheduler still runs. | Static review: current repo has only the Pathao tracking workflow; hosted scheduler/deployment state **BLOCKED**. |
| B4 | Open Integrations and confirm Order Sources, default source, legacy Woo mapping display, and Courier Services render. | **PASS in mocked browser/UI tests**; live persistence **BLOCKED**. |
| B5 | Create/edit a business-level Pathao service and confirm credentials/state persist. | UI surface exists; live save **BLOCKED**. |
| B6 | Dispatch one order through Pathao, retry the same dispatch, and confirm no duplicate consignment/COD. | **BLOCKED** — Edge Function/database/Pathao unavailable. Static code contains the existing idempotency guard. |
| B7 | Track one consignment manually and through the scheduled `track_all` path; verify raw status, canonical shipment row, order status and timeline. | **BLOCKED**. Static review confirms `pathao-courier` and scheduler paths remain. |
| B8 | Rotate Pathao credentials, reauthorize, and confirm stale tokens are evicted. | **BLOCKED**. Static code includes credential-fingerprint and token eviction logic. |

### C. Orders and filters

| ID | Human verification | Result |
|---|---|---|
| C1 | Load store-bound and source-only orders together. | **PASS for Orders list** in focused browser audit; source-only `SO-1001` rendered. |
| C2 | Verify all tabs: All, New, Pre-Order, Ready, Pickup, Transit, Delivered, On Hold, Returned, Cancelled, Trash. | Predicate/unit coverage **PASS** (`tabFilters.test.ts`); full live data **BLOCKED**. |
| C3 | Verify every Pathao raw tracking status lands in exactly one courier tab. | Predicate/unit coverage **PASS** for the backend status map; live tracking **BLOCKED**. |
| C4 | Verify search, date range, status, payment, source, delivery, courier, store, category and pre-order-stage filters. | Code/unit coverage exists; complete human data-driven browser run **BLOCKED**. |
| C5 | Verify duplicate warning and merge panel visibility by tab. | Predicate/unit coverage **PASS**; live order data **BLOCKED**. |
| C6 | Open a source-only order and use detail, payment, status, measurement, print, merge/split and dispatch actions. | **BROKEN/at risk**: `OrderDetailSheet`, measurement printing, exchange and several actions require a non-empty legacy store scope and/or `order.store_id`. |
| C7 | Use Dashboard Action Queue and Pipeline links to reach the intended filtered Orders view. | **BROKEN by code path**: links such as `?status=shipped` land on the default New tab, while `Orders.tsx` only applies `statusFilter` when the All tab is active. Ready/Transit/Delivered/Failed links can therefore show the wrong set or no rows. |
| C8 | Create a manual order for a brand with an order source but no legacy store. | **BROKEN/blocked by current UI**: Add Order requires `hasStoreScope`, requires a selected legacy store, and inserts `store_id`; the new source-only contract does not require that binding. |

### D. Dashboard, Analytics and POS reporting

| ID | Human verification | Result |
|---|---|---|
| D1 | Dashboard KPIs include source-only orders. | **FAIL** in focused browser audit: source-only business showed “No stores in this business”. |
| D2 | Dashboard pipeline/action queue includes source-only orders and links filter correctly. | **FAIL/at risk**: Dashboard is gated on legacy store IDs; deep-link filter issue also applies. |
| D3 | Analytics revenue/order/AOV/customer/source charts include source-only orders. | **FAIL** in focused browser audit: rendered “No data”. `businessOrderSourceIds` is fetched but the computed `scope` is unused; queries still call `scopeStoreIds`. |
| D4 | Analytics excludes cancelled/returned/merged orders and handles previous periods. | Pure revenue tests and code path pass; live data **BLOCKED**. |
| D5 | POS Reports sales, cash, AR, fulfillment, returns, exports and daily print load. | **FAIL for source-only/no-store business** in focused audit; general live verification **BLOCKED**. Payment reads also scope through `orders.store_id`, excluding source-only orders. |
| D6 | POS mixed-brand order attributes every brand and reports it once. | **BLOCKED** — no database/POS runtime. Static implementation retains legacy store requirements. |
| D7 | Customer list/history and command-palette search include source-only customers/orders. | **BROKEN/at risk**: Customers and Command Palette fail closed or scope only through legacy store IDs. |
| D8 | Products, POS catalog and inventory work for a brand with physical/source stock but no Woo store. | **BROKEN/at risk**: Products/POS catalog load through `businessStoreIds`; a new-model brand with no `woo_store_id` gets an empty scope. |

### E. Business/brand/account surfaces

| ID | Human verification | Result |
|---|---|---|
| E1 | Create a personal account, verify email, skip/complete profile setup, create a business, and switch businesses. | Mocked account browser coverage: **PASS** for the exercised cases; real stack **BLOCKED**. |
| E2 | Create empty brands without stores, then create order sources under them. | Mocked account/integration coverage: **PASS**. |
| E3 | Confirm brand creation no longer auto-creates stores/storefronts. | **PASS** in account browser suite. |
| E4 | Confirm old Brands “New Store” and old “Stores” contracts are gone. | Current UI **PASS**; three existing browser failures are stale tests that still expect them. |
| E5 | Switch business and verify Orders/Products/Dashboard/Analytics cannot retain the previous business. | Existing tenant tests **PASS** for legacy store-scoped paths; source-only reporting boundary **FAIL** as above. |
| E6 | Verify Legacy Pool attribution/reassignment and business isolation. | **BLOCKED** — live RLS/database unavailable. |

## Findings requiring action

### F1 — High: source-only orders disappear from reporting

Affected files:

- `src/hooks/useDashboardData.ts`
- `src/pages/Dashboard.tsx`
- `src/pages/Analytics.tsx`
- `src/pages/PosReports.tsx`

These surfaces require `businessStoreIds.length > 0` and apply `.in("store_id", ...)`. The migration explicitly permits `store_id IS NULL` rows attributed by `order_source_id` and stamps `business_id`. The focused browser test reproduced the mismatch.

### F2 — High: source-only orders cannot use several operational actions

Affected files:

- `src/components/orders/AddOrderDialog.tsx`
- `src/pages/POS.tsx`
- `src/components/orders/OrderDetailSheet.tsx`
- `src/components/orders/MeasurementSlipPrint.tsx`

They require a legacy store scope or reject orders without `store_id`. This conflicts with the new order-source/business tenancy model.

### F3 — Medium: Dashboard/Pipeline filter links do not select the intended tab

`ActionQueue` and `OrderPipeline` navigate with `?status=...`, but `Orders.tsx` applies the status filter only when `tab === "all"`; the default tab is `new`. This is independently observable with any non-empty mixed-status order set.

### F4 — Medium: old browser contracts are stale

The account suite still expects Brands to expose “New Store” and the sidebar to expose “Order Sources”. The current migration intentionally moved source management to Integrations and removed brand-store creation from this page. Update the suite before using its 3 failures as release defects.

### F5 — Release gate: backend verification has not run

No claim about live RLS, migrations, Pathao, scheduled functions, hosted data, or production Woo retirement can be made from this run. Start Docker/Supabase, apply migrations to a disposable database, supply test credentials, and rerun the blocked rows before deployment.

### F6 — Contract-test drift to inspect

`20261103160000_retire_woocommerce_integration.sql` drops `sync_health`, while `supabase/tests/rls/rls_hardening_test.sql` still asserts an authenticated `sync_health` privilege. The SQL test should be reconciled with the intentional retirement before the backend gate is run.

### F7 — Credential hygiene

The scheduler-token restoration migration and scheduler documentation contain credential material in source/config context. Rotate the token and replace committed literals with deployment-managed secrets before publishing the audit result or migration chain.

## Reproduction commands

```powershell
npm run verify:env
npm run typecheck
npm test
npm run build
npm run lint
$env:PLAYWRIGHT_CHANNEL = "chrome"
npx playwright test --config playwright.accounts.config.ts
npx playwright test --config playwright.audit.config.ts
npm run test:smoke
```

The focused browser verifier is retained at `tests/audit/migration-platform-audit.spec.ts` with `playwright.audit.config.ts` so the source-only boundary can be rerun after the reporting scope is corrected.

## Audit conclusion

The account/brand UI migration is partially working, and the Orders source-scope seam is ahead of the reporting and operational pages. The platform should not be considered migration-complete until source-only orders, products, customers and POS/source stock are covered by Dashboard, Analytics, POS Reports, customer/catalog flows, order detail/actions, and real RLS/Pathao checks.
