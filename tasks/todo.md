# Task List: Domain Revamp

Plan: [plan.md](plan.md) · Spec: [../DOMAIN-REVAMP-SPEC.md](../DOMAIN-REVAMP-SPEC.md)
Verification commands: `npm run typecheck` · `npm test` · `npm run lint` · `npm run build` · `npm run test:browser` (Playwright; env-dependent) · manual UI check in running frontend (`npm run dev` + dsh_browser).

---

## Task 1: Confirm-password on signup

**Description:** Add a "Confirm Password" field to the signup form ([Signup.tsx](../src/pages/Signup.tsx)), with show/hide toggle and mismatch validation. Per spec §5: every password entry form has a confirm field (signup gains one; reset/change already have theirs).

**Acceptance criteria:**
- [x] Signup shows Password + Confirm Password; both with show/hide toggle
- [x] Submit is blocked with a clear inline/toast error when the two differ
- [x] Existing rules unchanged: min 10 chars, strength meter, disposable-email block, consent, Turnstile
- [x] `supabase.auth.signUp` payload unchanged (confirmation is client-side only)

**Verification:**
- [x] `npm run typecheck` (clean), `npm test` (351 passed, 3 skipped), `eslint` on touched files (clean), `npm run build` (clean)
- [x] Real-browser Playwright run on system Chrome (`PLAYWRIGHT_CHANNEL=chrome`): `personal-signup` 14/14 passed, incl. new test "mismatched confirm password blocks personal signup before any auth or signup request"
- [x] Shared-browser visual check (2026-10-30, against the local stack): form renders with Confirm Password + show/hide; mismatched values show the inline "Passwords do not match" hint and submit is blocked (toast, stays on /signup); matching values complete signup end-to-end and land on "Choose a business account". Note: production signup is still fail-closed (`is_signup_open()` missing there) — covered by the user-gated batch in `tasks/audit/production-migration-plan.md`

**Dependencies:** None
**Files likely touched:** `src/pages/Signup.tsx`, `tests/accounts/personal-signup.spec.ts` (if it fills the form)
**Estimated scope:** XS

---

## Task 2: Default business selection + auto-select + fallback

**Description:** Per spec §5: personal profile settings gets a "Default business account" selector; it controls post-login landing only. Exactly one business → auto-selected everywhere, no picker. Default deleted/membership lost → fall back to sole/first remaining. Zero businesses → "create or join" screen.

**Acceptance criteria:**
- [x] ProfileSettingsTab has Default business selector (per-user persisted choice)
- [x] Post-login landing uses the default; single-business users never see a picker
- [x] Fallbacks: dead default → sole/first remaining business (verified in UI). Zero-business → create/join screen: covered by Playwright `personal-signup` "confirmation and repeated visits reach empty account selection" (passes on the final tree)
- [x] Quick-create/search follow the *current* business, not the default (verified by code path: `CommandPalette` → `useActiveBusinessStoreIds` → `useStoresList` → `useBusinessContext().active`; search UI not exercised)

**Verification:**
- [x] `npm run typecheck` (clean), `npm test` (361 passed, 3 skipped), eslint on touched files (clean)
- [x] Manual in UI (2026-10-30, local stack): single business auto-lands on `/`; live default lands on the default; no default shows the picker; a removed default (sole business left) lands on it; a removed default with two businesses left falls back to the first remaining business and the settings form shows that same business; an unrelated profile save leaves a stored default untouched; a deliberate settings change persists and changes the next sign-in's landing; a manual `/accounts` visit still shows the picker
- [x] Playwright: `personal-signup` 14/14, `business-members` + `brands` + `brand-stores` all pass. `account-lifecycle-rehearsal`: 2 tests fail on the clean `HEAD` as well (pre-existing, signup form step), unrelated to this task

**Dependencies:** None (uses existing `active_business_context` infra)
**Files likely touched:** `src/components/settings/ProfileSettingsTab.tsx`, `src/pages/AccountSelection.tsx`, `src/App.tsx`, a migration for `profiles.default_business_id`, `src/lib/*` context helpers
**Estimated scope:** M

---

## Task 3: Post-verification personal profile setup screen

**Description:** Per spec §5/§6b: after email verification, show a skippable "Set up your profile" screen (photo, name, phone) before any business screen. Completable later from settings. Verified email stays the only hard gate.

**Acceptance criteria:**
- [x] New screen appears after `/auth/confirm`, before business flow; skippable in one click (`AuthConfirm` routes a verified, not-yet-set-up person to `/profile/setup`; "Skip for now" stamps completion and changes no profile field)
- [x] Fields: avatar upload, full name, phone; saved to `profiles` (phone normalized and validated by `profileSetup.ts`; same rule in settings)
- [x] Skip lands on the business flow; re-entry possible from settings (settings Phone field; invitation token preserved through the step)

**Verification:**
- [x] `npm run typecheck` (clean), `npm test` (380 passed, 3 skipped), eslint on changed files (clean), `npm run build` (clean)
- [x] Playwright: `profile-setup` 6/6 (gate, skip writes no field, save normalizes phone, invalid phone blocked, completed profile not re-prompted, invitation token survives); `personal-signup` 14/14 and `business-members` 12/12 after the established-account profile mock
- [x] Manual in the running UI (2026-10-30, local stack): setup page rendered with all fields. **Skip path** (`setup.live.direct@example.com`): "Skip for now" → landed on `/accounts`; DB shows `profile_setup_completed_at` stamped, `full_name` preserved, `phone`/`avatar_url` unchanged. **Save path** (`setup.live.save@example.com`): entered `+8801711-234567` → "Save and continue" → landed on `/accounts`; DB shows phone normalized to `01711234567`. **Re-login**: completed user goes directly to `/accounts`, not re-prompted. **Note:** the `/auth/confirm` gate redirect was not exercised live because `getSession()` does not reliably return `email_confirmed_at` (pre-existing `AuthConfirm` limitation); the gate logic is covered by Playwright mocks.
- [x] Pre-existing and unchanged: `account-lifecycle-rehearsal` still fails the same 2 signup-form tests as the clean `HEAD` (stall at `/signup`)

**Dependencies:** None
**Files likely touched:** new `src/pages/ProfileSetup.tsx` (or component), `src/pages/AuthConfirm.tsx`, `src/App.tsx`, `src/components/settings/ProfileSettingsTab.tsx`
**Migration:** `supabase/migrations/20261030200000_profile_setup.sql` (adds `profiles.phone`, `profiles.profile_setup_completed_at`; backfills existing profiles as done so current members are not re-prompted)
**Estimated scope:** M

---

### Checkpoint A
- [x] Tasks 1–3 tested, typechecked, built, UI-verified
- [x] Review with human before Phase 2 *(signed off 2026-11-01)*

---

## Task 4: Unified `order_sources` + provenance + RLS/types

**Description:** Per spec §2: create the per-brand `order_sources` table (type enum `woocommerce|storefront|showroom|physical_store|facebook|instagram|whatsapp|manual`, name, config jsonb, connection/sync config, legacy_* mapping columns, `is_stock_holding` default by type). Add provenance columns to `products`/`customers` (`origin_order_source_id`, `origin_kind`). `orders.order_source_id` column (nullable for now). RLS per brand; regenerate Supabase types.

**Acceptance criteria:**
- [x] `order_sources` exists with UQ(brand_id, name), type enum (`order_source_type`, 8 values), legacy_* audit columns (6, unique-when-set) — migration `20261031090000_unified_order_sources.sql`; legacy 5-row lookup **renamed** to `legacy_order_channels` (not dropped; its 2 consumers patched to it and keep working until Task 6)
- [x] `products.origin_order_source_id` + `origin_kind`; `customers.origin_order_source_id` + `origin_kind` (CHECK `woo_sync|csv|manual|pos|legacy`); provenance is internal-only — pinned as an anon carve-out in `api_table_grants_test` alongside `cost_price`
- [x] `orders.order_source_id` nullable FK added (no backfill yet — Task 8)
- [x] RLS isolates by business membership (brand_stores idiom: members read, owner/admin/member write); RLS tests pass

**Verification:**
- [x] `npm run test:rls` **ALL GREEN (20 files)** incl. new `order_sources_test.sql` (stock-default trigger, override, UQ, viewer read-only, outsider/cross-business denial, value-pinned survival) + extended grants carve-out; `npm run typecheck` clean after type regen; `npm test` 380 passed; `npm run build` clean

**Dependencies:** None (expand phase; no drops)
**Files likely touched:** `supabase/migrations/*.sql` (new), `src/integrations/supabase/types.ts` (generated), `supabase/tests/rls/*.sql`
**Estimated scope:** M

---

## Task 5: Warehouses & stock model schema

**Description:** Per spec §3: `warehouses` table (brand_id, name, address/contact, is_default). Stock holders = warehouses + stock-holding order sources: `product_locations` gets `warehouse_id`/`stock_holder_order_source_id` (exactly one via CHECK) alongside existing `location_id` (kept until contract). `order_sources.fulfillment_preference` (ordered id list jsonb) + `ship_from_store` boolean. `stock_transfers` table (from/to stock holder, items, quantities, status).

**Acceptance criteria:**
- [x] `warehouses` CRUD-able at brand level (schema + RLS) — brand-child RLS idiom, UQ(brand_id,name), address/contact fields, `is_default`
- [x] `product_locations` rows can point at warehouse OR stock-holding order source (CHECK exactly one across legacy `location_id` + the two new holders); partial-unique siblings per holder kind; trigger rejects non-stock-holding sources
- [x] `order_sources` has `is_stock_holding`, `ship_from_store`, `fulfillment_preference` (jsonb ordered holder-id list, array CHECK)
- [x] `stock_transfers` table with RLS — one line per transfer (product, variation, quantity, status), endpoint CHECKs (exactly one from/to holder, distinct endpoints)

**Verification:**
- [x] Migration `20261031113000_warehouses_stock.sql` applies on fresh local DB; `npm run test:rls` **ALL GREEN (22 files)** incl. new `warehouses_test.sql` + `stock_transfers_test.sql` (holder CHECKs, toggle trigger, unique siblings, aggregate rollup 10+5=15 across holders, transfer endpoint CHECKs, brand-child RLS + survival); `npm run typecheck` clean after type regen; `npm test` 380 passed; `npm run build` clean

**Dependencies:** Task 4
**Files likely touched:** `supabase/migrations/*.sql` (new), `src/integrations/supabase/types.ts`, `supabase/tests/rls/*.sql`
**Estimated scope:** M

---

### Checkpoint B
- [x] Fresh-DB migration clean; RLS green (every task's battery ran `test:rls` on fresh resets; 22 → 26+ RLS files across the phase)
- [x] Review with human *(signed off 2026-11-01)*

---

## Task 6: Order Sources page per brand

**Description:** Per spec §2/§8: replace the StoresHub "Stores / Selling Points / Connectors / Product Sources / Customer Sources" tabs with one **Order Sources** page per brand. Create/edit sources (connected + manual user-named), connection config on the source, sync settings on the source. Order creation (`AddOrderDialog`) picks `order_source_id`; walk-ins attach to showroom source. Orders read `orders.order_source_id`.

**Acceptance criteria:**
- [x] Per-brand list of order sources with type badges, connection/sync status — `/order-sources`, one section per brand; type badge per `order_source_type`, connection column (Connected / Setup incomplete / Physical / Manual) derived from config completeness, sync column (last sync / error / never) for Woo + storefront, per-source order count + latest orders
- [x] Create manual source (user-named), create connected source (Woo/storefront config inline) — `OrderSourceDialog`: 8-type picker, per-type connection config on the source (Woo URL + keys, storefront slug…), sync settings (`sync_direction`) on the source; credential fields are write-only (blank on edit keeps the stored secret); UQ(brand_id, name) surfaced as an inline error
- [x] New orders attribute to an order source (`orders.order_source_id`); old `source` text no longer written — AddOrderDialog picker (scoped to the selected store's brand, auto-picks the brand's first source; walk-ins auto-attach to the showroom source), `orders.source` no longer written (column default only); POS also gains `order_source_id` (showroom attachment) while keeping its legacy `source='pos'` tag per agreed scope — POS reports/dashboard `pos` filters keep working until the contract phase re-wires them; customer provenance (`origin_order_source_id` + `origin_kind`) written on both flows
- [x] Legacy rows still readable via mapping (no data loss on the page) — read-only "Legacy rows — not yet migrated" section per brand (Woo store / selling points / brand stores / storefronts) with their spec §7 "Maps to" labels; nothing editable; collapsed rows arrive at Task 8

**Verification:**
- [x] `npm run typecheck` (clean), `npm test` (380 passed, 3 skipped — 372 baseline + 8 new `orderSources.test.ts`), `npm run build` (clean); eslint clean on all new files and unchanged elsewhere (legacy files' pre-existing debt: 142 problems at HEAD → 140 after this task)
- [x] Manual end-to-end in the running frontend (2026-10-31, local stack, `task6.verify@example.com`): created manual source "Phone Orders", connected "Task 6 Woo Connection" (URL + keys inline, sync=import), showroom "Main Showroom". Edit dialog keeps secrets write-only (DB check: config intact after blank-secret save). Created delivery order #3000 → attributed to "Phone Orders" (brand's first source); walk-in order #3001 → auto-attached "Main Showroom"; both appear under their sources on the page ("1 order · 3000 · Test Customer One") and as source badges in the orders list (which now reads `order_source:order_sources(name, type)`). POS order #3002: `source='pos'` kept, `order_source_id` → "Main Showroom", customer `origin_kind=pos`. Settings → Order Sources tab now points at the new page (the `legacy_order_channels` lookup is no longer edited anywhere)
- [x] Per-source counts read `orders.order_source_id`; order badges on Orders/OrderDetail/Customer history prefer the order source name and fall back to the legacy text for old orders

**Dependencies:** Tasks 4, 5
**Files likely touched:** `src/pages/StoresHub.tsx` (split/replace), new `src/pages/OrderSources.tsx`, `src/components/orders/AddOrderDialog.tsx`, `src/lib/*` source helpers, `src/App.tsx`
**Estimated scope:** M

---

## Task 7: Warehouses settings + transfers + fulfillment

**Description:** Per spec §3: brand-level **Warehouses** settings (replaces Locations tab). Stock view per warehouse + stock-holding source (from `product_locations`). Simple transfers (from → to, items, qty) with stock moves. Per-source fulfillment preference + ship-from-store toggle.

**Acceptance criteria:**
- [x] Warehouses CRUD at brand level; showrooms appear as stock holders (order sources with `is_stock_holding`) — Settings → **Warehouses** tab (user-confirmed placement) with per-brand sections; warehouse dialog (name, default, address/city/zone/area/phone), edit + delete (confirmed; warns that stock rows cascade); stock holders = warehouses + `is_stock_holding` sources, shown in the on-hand table
- [x] Transfer creates `stock_transfers` row and moves `product_locations` quantities — Transfer dialog (from → to holder, item lines with live "available at" hints, note); `applyStockTransfer` validates the from side first (clear "Not enough stock" errors), moves quantities, upserts the to side, and writes one ledger line per product/variation (duplicate lines merged); the existing `product_locations_stock_sync` trigger keeps `products.stock_quantity` aggregated
- [x] Fulfillment preference + ship-from-store editable per order source — OrderSourceDialog "Fulfillment" panel: ship-from-store switch for every source, ordered "stock draw order" (checked holders, ↑/↓) persisted as the bare-id `fulfillment_preference` list (self excluded — own stock is the ship-from-store toggle), plus the `is_stock_holding` toggle for physical types only (spec §3)

**Verification:**
- [x] `npm run typecheck` (clean), `npm test` (385 passed, 3 skipped — 380 baseline + 5 new `stockHolders.test.ts`), eslint clean on touched files, `npm run build` (clean)
- [x] Manual in the running frontend (2026-10-31, local stack, `task6.verify@example.com`): created "Main Warehouse" (default) via the dialog; seeded 10 units at it; transferred 4 → "Main Showroom" — stock view moved to 6/4, "Recent transfers" shows the row with note/status, DB shows the `stock_transfers` ledger line and `products.stock_quantity` still 10 (aggregate intact). Over-quantity transfer blocked inline: "Not enough stock at Main Warehouse for Task 6 Test Product: have 6, need 99". Edited "Main Showroom": ship-from-store ON + draw order [Main Warehouse] saved (`ship_from_store=true`, `fulfillment_preference=[warehouse id]` verified in DB); digital source "Task 6 Woo Connection" correctly shows no Holds-stock toggle (`is_stock_holding=false`)

**Dependencies:** Tasks 5, 6
**Files likely touched:** new `src/pages/Warehouses.tsx` (or settings tab), `src/components/settings/*`, `src/lib/stock*.ts`, `src/App.tsx`
**Estimated scope:** M

---

## Task 8: Enveil Vincent mapping migration + audit (DRY-RUN ONLY)

**Description:** Per spec §7: write the data-migration script (id-based only) — collapse stores/selling_points/brand_stores/storefronts into order sources per the mapping table; map warehouses; attribute products/customers/orders + provenance; infer unattributed orders via customer phone/id; merge 2 customer duplicates; attribute pool customers with connected-order product evidence per the signed-off Checkpoint C rule; route residual rows to the Legacy pool; delete 4 junk rows + 7 test businesses (incl. `13e888dc-…`) after severing the AGS→Enveil-store link. Produce an audit report (counts before/after per entity). **Do not execute against production.**

**Acceptance criteria:**
- [x] Script runs idempotently against a restored backup/scratch DB and produces the audit report — `scripts/migrate-enveil-vincent.sql` (one transaction, marker guard refuses a second apply) run by `scripts/task8-audit.mjs` against `task8_scratch` (full repo schema + production data from the read-only extract `scripts/task8-extract-prod.mjs`, loaded by `scripts/task8-build-scratch.mjs`); re-run proven no-op with identical audits
- [x] Audit shows: 4 order sources + warehouses per brand; 225 products preserved; the refreshed 2026-11-01 rehearsal has 3,246 → 3,244 customers after 2 merges, 3,193 attributed + 51 residual pool customers, and 4,044 attributed + 48 pool orders from 4,092 total (3,235 bound + 809 inferred; all 1,162 customers with connected-order evidence attributed; 0 inferable orders remain) — [task8-dry-run-report.md](audit/task8-dry-run-report.md) is authoritative; 8 sources (4/brand) + 1 warehouse; 205 stock rows repointed; 2 courier services mapped. Historical spec/baseline counts and live trading drift are reconciled in the report.
- [x] No name-based lookups anywhere in the script — every target is a UUID literal resolved from the read-only inventory; a static scan of the script (part of the audit) finds no name filters

**Verification:**
- [x] Dry-run on scratch DB: **12/12 audit checks PASS** on the refreshed 2026-11-01 extract (idempotent apply, mapping shape, preservation, pool-customer attribution via connected-order products, order inference, legacy pool, wipe incl. AGS→Enveil-store link severed first, stock repoint, no name lookups, courier mapping). Audit report [task8-dry-run-report.md](audit/task8-dry-run-report.md) **presented for human review (Checkpoint C)** and signed off — the strict email-alias pair remains in the pool, fulfillment defaults are accepted, and mixed-brand pool customers use the earliest connected order's brand. **Production execution remains gated (Task 17).**

**Dependencies:** Tasks 4, 5
**Files likely touched:** `supabase/migrations/*.sql` or `scripts/migrate-*.mjs`, `scripts/*audit*`
**Estimated scope:** M

---

### Checkpoint C
- [x] New pages usable end-to-end (Order Sources / Warehouses / Courier services / Payment accounts all live-verified in Tasks 6–10); mapping dry-run audit produced and **presented** (Task 8)
- [x] Review with human *(signed off 2026-11-01 — verdicts recorded in [audit/task8-dry-run-report.md](audit/task8-dry-run-report.md): merge pair stays in the pool; fulfillment defaults accepted; pool customers auto-attributed to a brand from their connected orders' products — mixed-brand → first brand)*

---

## Task 9: Courier services at business level

**Description:** Per spec §4: business-level **Courier services** page (providers: Pathao, Steadfast, RedX, eCourier). Existing `pathao_integrations`/`courier_integrations`/`connectors` courier rows are represented here (legacy ids mapped). Enable at fulfillment time (DispatchDialog/OrderDetailSheet consume the business-level services).

**Acceptance criteria:**
- [x] Courier services CRUD at business level (credentials, provider) — Settings → **Courier services** tab (`CourierServicesTab` + `CourierServiceDialog`): provider picker (Pathao/Steadfast/RedX/eCourier with per-provider credential fields, write-only — blank on edit keeps the stored secret), UQ(business_id, name) surfaced inline, activate/deactivate; `courier_services` table + RLS in migration `20261031140000_courier_services.sql` (business membership: members read, owner/admin/member write, viewers read-only)
- [x] Dispatch flow selects a business-level courier service — DispatchDialog gains a "Courier service" picker (defaults to the business's first Pathao-capable service) and resolves `integration_id` from the selected service's `legacy_pathao_integration_id` (falling back to the store's legacy link pre-cutover); non-Pathao services explain their adapter is coming and disable the Dispatch button. AttachParcelDialog drops `pathao_integrations_safe` and reads business-level services the same way
- [x] No per-brand courier duplication in UI — single business-level tab (Settings → Business → Courier services); legacy per-brand courier rows (`connectors` + `pathao_integrations`) appear only as a read-only "Legacy courier rows" section until cutover

**Verification:**
- [x] `npm run typecheck` (clean), `npm test` (389 passed, 3 skipped — 385 baseline + 4 new `courierServices.test.ts`), eslint: 0 new problems (8 pre-existing `any` in DispatchDialog/AttachParcelDialog, same as HEAD), `npm run build` (clean)
- [x] `npm run test:rls` **ALL GREEN (21 files)** incl. new `courier_services_test.sql` (member create/update + UQ(business_id, name) + unique-when-set legacy ids, viewer read-only with row-count no-op checks, outsider invisibility, cross-business denial, value-pinned survival)
- [x] API-layer walkthrough of the exact PostgREST calls the UI makes (2026-10-31, local stack, `task9.verify@example.com` → owner of "Task 9 Courier Verify"): `create_business_with_owner` RPC, INSERT Pathao service with credentials + Steadfast service, UPDATE (rename + credential rotation), duplicate name rejected (UQ), null legacy ids allow repeats (unique-when-set), DELETE, SELECT lists scoped rows — all behaved correctly
- [x] Cutover mapping extended into `scripts/migrate-enveil-vincent.sql` (2 legacy `pathao_integrations` → 2 business-level services, paired to their courier `connectors` via `config.integration_id`, UUID literals only) and re-audited on the scratch DB: "Courier services mapped (Task 9)" ✅ in [task8-dry-run-report.md](audit/task8-dry-run-report.md) (12/12 checks green)
- [x] Manual dispatch click-through in the shared browser (2026-10-31, local stack, `task9.verify@example.com` → "Task 9 Courier Verify"): Settings → Business → Courier services tab renders the business-level list with state badges (RedX 2 → Setup incomplete, Task 9 Pathao Renamed → Configured); edit dialog keeps secrets write-only ("saved — leave blank to keep", non-secret username echoes); New service dialog (provider radios + per-provider fields) created "Task 9 eCourier" → appears Configured. Orders → Attach Parcel shows the business-level "Courier service" picker (was "Pathao Account"). Bulk **Dispatch** dialog shows "Courier service:" preselected to the Pathao-capable service (skips RedX) with Dispatch enabled; selecting eCourier shows "eCourier dispatch arrives with its adapter — pick a Pathao service to dispatch now." and disables the Dispatch button. No per-brand courier UI anywhere (single business-level tab)

**Dependencies:** Task 4
**Files likely touched:** new `src/pages/CourierServices.tsx` (or business settings tab), `src/components/orders/DispatchDialog.tsx`, `src/components/orders/OrderDetailSheet.tsx`, `src/lib/courier*.ts`, `src/App.tsx`
**Estimated scope:** M

---

## Task 10: Payment accounts + per-source method toggles

**Description:** Per spec §4: business-level **Payment accounts** (bKash/Nagad/Stripe/card credentials) + per-order-source accepted-method toggles (COD, bKash, card…). No separate integrations area.

**Acceptance criteria:**
- [x] Payment accounts CRUD at business level — Settings → **Payment accounts** tab (`PaymentAccountsTab` + `PaymentAccountDialog`): provider picker (bKash/Nagad/Stripe/Card with per-provider credential fields, write-only — blank on edit keeps the stored secret), UQ(business_id, name) surfaced inline, activate/deactivate; `payment_accounts` table + `payment_providers` registry in migration `20261031180000_payment_accounts.sql` (business membership RLS, mirrors courier_services). No legacy mapping needed — payments were free text on orders, there are no legacy payment integration tables
- [x] Each order source has accepted-methods toggles; order creation reflects them — OrderSourceDialog gains a "Payments" panel (method checkboxes; default cod+cash); `order_sources.accepted_payment_methods` jsonb with a known-codes CHECK. AddOrderDialog gains a "Payment method" picker filtered to the selected source's accepted methods — verified: source with ["cod","cash","bkash"] shows exactly "Cash on delivery / Cash / manual / bKash", and a COD order writes `payment_method='cod'` (previously written only when paid > 0)
- [x] Manual/cash always available for staff-entered orders — `staffPaymentOptions` always injects cash / manual regardless of the source's toggles (unit-tested)

**Verification:**
- [x] `npm run typecheck` (clean), `npm test` (394 passed, 3 skipped — 389 baseline + 5 new `paymentAccounts.test.ts`), eslint: 0 new problems (27 pre-existing `any` in AddOrderDialog, same as HEAD), `npm run build` + `npm run build:dev` (both clean)
- [x] `npm run test:rls` **ALL GREEN (22 files)** incl. new `payment_accounts_test.sql` (member create/UQ/update, viewer read-only with row-count no-ops, outsider + cross-business denial, value-pinned survival; method-toggle default ["cod","cash"], unknown code rejected (check_violation), non-array rejected)
- [x] Manual end-to-end in the running frontend (2026-10-31, local stack, `task9.verify@example.com` → "Task 9 Courier Verify"): created "Main bKash" (bKash, 4 credential fields) via the dialog → shows **Configured**; edit dialog keeps secrets write-only ("saved — leave blank to keep"; non-secret username echoes). Order Sources → New source "Phone Orders" (manual): **Payments** panel shows the 6 methods with cod+cash pre-checked; toggling bKash persisted `["cod","cash","bkash"]` (DB-verified). Add Order → store "Task 9 Woo Store" auto-binds source "Phone Orders · Manual"; the Payment method picker offers exactly the source's three methods (cash / manual never disappears); creating with "Cash on delivery" and 0 paid wrote order **#3000** with `payment_method='cod'`, `payment_status='unpaid'`, COD ৳50 (DB-verified)

**Dependencies:** Tasks 4, 6
**Files likely touched:** new `src/pages/PaymentAccounts.tsx` (or settings tab), `src/components/orders/AddOrderDialog.tsx`, `src/lib/payment*.ts`, `src/App.tsx`
**Estimated scope:** M

---

## Task 11: Retire `/integrations` + legacy StoresHub tabs

**Description:** Per spec §8: remove `/integrations` page and the legacy StoresHub tabs (Stores/Locations/Selling Points/Connectors/Product Sources/Customer Sources) now covered by Order Sources / Warehouses / Courier services / Payment accounts. Keep legacy tables untouched (contract is Task 16). Update tests.

**Acceptance criteria:**
- [x] No integrations UI reachable; no StoresHub tabs referencing removed concepts — `src/pages/Integrations.tsx`, `src/pages/StoresHub.tsx` and its detail components (`WooCommerceDetail`, `PathaoDetail`, `PathaoStoreLinks`) deleted; `/integrations` now redirects to Settings (couriers + payment accounts live there per spec §8) and `/stores` redirects to Order Sources (spec §8: "StoresHub dissolves → Order Sources + Warehouses"). `GlobalSyncIndicator` kept (still used by the dashboard layout). The legacy `integrations.*`/`stores.*` permission keys remain in the role-editor catalog on purpose: they feed `accountBaselinePermissions` (member operational baseline) and the DB enum — "keep legacy tables untouched (contract is Task 16)"
- [x] Navigation points at Order Sources, Warehouses, business-settings pages — sidebar "Integrations" entry removed (Order Sources / Storefronts / Settings remain); the Dashboard "No stores" empty-state CTA and StoreHealthGrid "Manage stores" now point at Order Sources; the Brands page links reworded/repointed to Order Sources
- [x] Playwright account specs updated and passing — `business-members` nav assertions match the post-retirement sidebar (also fixes drift from Task 6's "Stores"→"Order Sources" rename); `brand-stores` drives store creation on the Brands page with data-level brand→store scoping; `account-lifecycle-rehearsal` routes through the Brands page and (drift fixes for gates added since the spec was last green) fills the Task 1 confirm-password field and steps through Task 3's skippable profile setup
- [x] Brand-store CRUD surfaced on the Brands page (StoresHub's own header comment named this destination): each brand card lists its stores inline (type badge + Published/Unpublished) with "Add store" per card

**Verification:**
- [x] `npm run typecheck` (clean), `npm test` (394 passed, 3 skipped), eslint: 0 new problems (5 pre-existing in AppSidebar/usePermissions, same as HEAD), `npm run build` (clean)
- [x] `npm run test:browser` (system Chrome): **37/37 passed** — including the previously "pre-existing" `account-lifecycle-rehearsal` pair, whose real causes were fixed: (a) the dev server died mid-run because chokidar EBUSY-crashed on transient workspace artifacts (hardened via `server.watch.ignored` in vite.config.ts — this also explains the older "stall at /signup" reports), and (b) the specs predated the Task 1 confirm-password field and Task 3's profile-setup gate
- [x] Shared-browser UI check (2026-10-31, local stack, `task9.verify@example.com` → "Task 9 Courier Verify"): sidebar lists Dashboard…Order Sources/Storefronts/Team/Settings with **no Integrations entry**; `/integrations` redirects to `/settings`; `/stores` redirects to `/order-sources`; the Brands page card lists stores inline — created "Task 11 Outlet" (Physical badge) through the "New Store" dialog and it renders in the card; StoreHealthGrid's CTA now reads "Order sources"

**Dependencies:** Tasks 6, 7, 9, 10
**Files likely touched:** `src/pages/Integrations.tsx` (delete), `src/pages/StoresHub.tsx` (remove/replace), `src/App.tsx`, `tests/accounts/*.spec.ts`
**Estimated scope:** S

---

### Checkpoint D
- [x] Integrations UI gone (redirects verified live 2026-10-31); couriers/payments usable (live-verified in Tasks 9–10)
- [x] Review with human *(signed off 2026-11-01)*

---

## Task 12: Roles ladder + invite role picker

**Description:** Per spec §5: rename role enum `owner/admin/member/viewer → Owner/Admin/Manager/Staff` (map owner→Owner, admin→Admin, member→Manager, viewer→Staff). Invitations carry the chosen role (picker in invite UI). Existing memberships mapped.

**Acceptance criteria:**
- [x] Role ladder displays/behaves as Owner/Admin/Manager/Staff everywhere (members page, invites) — `roleLabel`/`ROLE_LADDER` in [rolePresentation.ts](../src/lib/accounts/rolePresentation.ts) drive the members-page badges, the invite picker, and the UserAccessDialog role select (Owner/Admin/Manager/Staff). Behavior is the renamed-but-identical ladder: stored values are lowercase `owner/admin/manager/staff` (member→manager, viewer→staff), semantics unchanged (managers write, staff read-only). The global `app_role` model (user_roles: admin/staff/viewer) is deliberately untouched
- [x] Invite dialog has role picker; accepted invite grants that role — the picker rides `invite_business_member(p_business_id, p_email, p_role)` (new argument, default `manager`, validated against the 4 rungs) and `accept_business_invitation` grants `v_invitation.role` instead of the old hard-coded 'member'
- [x] Existing rows remapped by the enum rename migration — `20261101090000_role_ladder_rename.sql`: rows remapped (member→manager, viewer→staff) in `user_business_access` + `business_invitations`, CHECK constraints and column defaults rebuilt on the new value set, 8 role-literal policies ALTERed, 7 functions rewritten (invite/set-role/transfer also gain their Task 12 behavior; `has_permission` excluded — its literals are the app_role vocabulary)

**Verification:**
- [x] `npm run typecheck` (clean), `npm test` (394 passed, 3 skipped), eslint: 0 new problems (5 pre-existing `any` in UserAccessDialog, same as HEAD), `npm run build` + `npm run build:dev` (clean)
- [x] `npm run test:rls` **ALL GREEN (22 files)** on a fresh DB — the whole chain (rename migration + renamed fixtures) replays cleanly; defaults/CHECK catch was found and fixed here
- [x] `npm run test:browser` (system Chrome): **37/37 passed** — the invite test now drives the role picker (asserts the Owner/Admin/Manager/Staff options and the `p_role` payload)
- [x] API end-to-end (local stack): owner invites with `p_role='staff'` → invitee accepts → membership granted **`staff`** (not the old hard-coded member); an `admin` invite row carries `role='admin'`; `p_role='superuser'` refused with `INVITATION_ROLE_INVALID`
- [x] Shared-browser UI check (local stack): Members page shows the ladder badges (Owner / Staff), the invite form's role picker lists Owner/Admin/Manager/Staff with Manager preselected, and invitation rows carry role badges (Admin · Pending, Staff · Accepted); transfer/leave copy updated to the new rungs

**Dependencies:** None (independent); touches `user_business_access`/`business_invitations`
**Files likely touched:** `supabase/migrations/*.sql`, `src/pages/BusinessMembers.tsx`, `src/components/*invite*`, `src/lib/roles*.ts`
**Estimated scope:** S

---

## Task 13: Business onboarding — shell + profile + brand + order sources

**Description:** Per spec §6a: new onboarding wizard (fresh code — old `src/components/onboarding/` is retired): skippable at any step, resumable (persistent checklist), re-runnable from settings. Steps in order: business profile → first brand (explicit name + optional logo) → connect order sources. Invited members never see it (Task 3 covers their profile setup).

**Acceptance criteria:**
- [x] Onboarding runs after business creation; skip at any point; progress persisted (resumable) — post-create `navigate("/onboarding")` in CreateBusinessDialog; per-step "Skip for now" (persists `skipped`, advances) + persistent "Exit setup"; `business_onboarding_steps` rows (status `completed|skipped`; no row = open); resume = first unmarked step. UI-verified live 2026-11-01 (marks confirmed in DB)
- [x] Checklist re-runnable from settings — `OnboardingChecklistCard` (Settings → Business Account): per-step statuses + "Resume setup"/"Run setup again"; UI-verified live (statuses matched the walkthrough exactly; resume landed on the first unmarked step)
- [x] First-brand step is explicit (no ghost brand); logo optional — typed name via `create_business_brand`; nothing written before submit; logo upload failure never blocks. UI-verified live ("UI Verify Brand")
- [x] Order-source step offers WooCommerce/Storefront/Facebook/WhatsApp/Showroom/Manual — all six rendered live; showroom selection created a real `order_sources` row on the brand (DB-verified)

**Verification:**
- [x] `npm run typecheck` clean, `npm test` **408 passed / 3 skipped** (+14: wizard state, skip, resume, re-mark, completion, invited-member bypass), eslint 0 problems on touched files, `npm run build` clean, `npm run test:rls` **ALL GREEN (23 files)** incl. `business_onboarding_test.sql` on a fresh 186-migration chain
- [x] Manual in the running frontend (2026-11-01, local stack, fresh signup `ui.verify.t1315@example.com`): signup → Create Business → lands on `/onboarding`; steps saved/created; skip → exit → reopen resumed at the first unmarked step; settings card + "Resume setup" re-entry verified. Wizard is **creator-only** (`joined_via==='created'`, fail-closed: invited AND directly-granted members never see it — agent decision per spec §6a "created from scratch", one predicate to widen if wanted). Playwright `test:browser` **38/38** incl. new wizard render/skip coverage (`851d4be`)

**Dependencies:** Tasks 4, 6 (order sources exist), Task 3 (invited-member path)
**Files likely touched:** new `src/components/onboarding/*` (fresh), `src/App.tsx`, `src/pages/AccountSelection.tsx`, `supabase/migrations/*.sql` (checklist state), `src/lib/onboarding*.ts`
**Estimated scope:** M

---

## Task 14: Onboarding — warehouses, product import, storefront sub-onboarding

**Description:** Per spec §6a continued: onboarding steps 4–6: warehouses → product import (Woo push import, CSV action, manual) → optional storefront creation launching the storefront sub-onboarding (name/slug, theme, payments, publish). Same storefront sub-onboarding runs whenever a storefront is created later.

**Acceptance criteria:**
- [x] Warehouse step creates brand warehouses — wizard step reuses `WarehouseDialog`; UI-verified live ("UI Verify Warehouse" created on "UI Verify Brand", DB-confirmed)
- [x] Product import: WooCommerce import (from connected source), CSV import (action), manual add — Woo kicks the sync worker only for connection-complete sources (incomplete ones link to Order Sources); CSV is a one-shot action (`src/lib/productImport.ts`: RFC-4180 subset, per-line errors, batch insert with row-by-row fallback, provenance `origin_kind='csv'`); manual deep-links `/products?new=1`. UI-verified live: CSV of 2 rows → "Imported 2 products", DB rows carry `origin_kind='csv'` and the operational `store_id` (after fix `d26c8e5`)
- [x] Storefront step runs only if storefront chosen; identical sub-onboarding reachable from "create storefront" anytime — one shared flow (`src/components/storefront/`: `storefrontSetup.ts` + `storefrontCreate.ts` + `StorefrontSubOnboarding.tsx`) behind BOTH entry points (StorefrontsPage's old 195-line dialog deleted). UI-verified live: "UI Verify Store" created → starter Home page published → `/storefront/ui-verify-store` renders for the public (after fix `5731853`)
- [x] Onboarding remains skippable/resumable through these steps — open-text `step_key`s `warehouses`/`product_import`/`storefront` appended to the Task 13 vocabulary (no constraint migration needed); verified live across the full walk

**Verification:**
- [x] `npm run typecheck` clean, `npm test` **431 passed / 3 skipped** (+23: CSV parser edges, provenance payloads, step-vocabulary walk, storefront validation/settings), eslint 0 new problems (StorefrontsPage's 3 pre-existing kept in untouched code), `npm run build` clean
- [x] Manual full onboarding incl. CSV import + storefront creation (2026-11-01, local stack) — plus **two real defects found and fixed the same day**: (1) `storefronts` RLS rejected the documented store-less insert and scaffold/publish sat behind global-role gates real accounts fail (`5731853`: brand-scoped policy legs + honest scaffold/publish reporting + `storefront_brand_rls_test.sql`), (2) CSV import wrote `brand_stores` ids into `products.store_id` (`d26c8e5`: picker rebound to the operational store space + payload pin test). The transitional store bridge is implemented and live-verified; WooCommerce sources provision operational store space, and the Product Import step offers a local-store convenience for pure-CSV merchants. See [wiki/transitional-store-model.md](wiki/transitional-store-model.md).

**Dependencies:** Task 13
**Files likely touched:** `src/components/onboarding/*`, `src/components/storefront/*`, `src/lib/import*.ts`, `src/App.tsx`
**Estimated scope:** M

---

## Task 15: Legacy / unattributed pool UI

**Description:** Per spec §7: business-level "Legacy / unattributed" pool listing orders/customers tagged `legacy migration` (753 orders + 1,200 customers after cutover). Reassign to a brand from the UI (sets brand + provenance). Visible in reports context.

**Acceptance criteria:**
- [x] Pool page/section at business level with counts and filters — `/legacy-pool` (sidebar "Legacy Pool"): live counts, tabs All/Orders/Customers, search (order number/name/phone), "Include deleted orders" toggle; `LegacyPoolBanner` on Analytics ("…1 order and 1 customer are not attributed to a brand yet… Review pool"). UI-verified live
- [x] Reassign action moves an item to a chosen brand with provenance `legacy` — `ReassignToBrandDialog` (brand + its order-source picker; "its provenance stays legacy"); dual-write matches the migration script's bindings (`order_source_id`/`origin_order_source_id` + transitional `store_id` when the brand has a legacy store). UI-verified live on one order + one customer: DB bindings written, `origin_kind='legacy'` and the `legacy migration` tag preserved, counts decremented
- [x] Pool is empty-checkable (before/after migration states both render fine) — empty state verified before seeding ("The legacy pool is empty"), populated + post-reassign-drain states verified after

**Verification:**
- [x] `npm run typecheck` clean, `npm test` **447 passed / 3 skipped** (+16 incl. a real Radix-dialog component suite), eslint 0 new problems, `npm run build` clean; `npm run test:rls` **ALL GREEN (24 files)** incl. `legacy_pool_test.sql` (pool read/reassign legs, WITH CHECK cross-business denial, source-attribution legs with store-consistency guard, value-pinned survival) — the work also surfaced that pool rows previously passed **no** RLS policy (invisible/unmodifiable via PostgREST), fixed by policy-only migration `20261102120000_legacy_pool_rls.sql`
- [x] Manual in the running frontend (2026-11-01, local stack): empty state → seeded 2+2 pool rows (exact script predicates) → counts/lists → reassign ×2 → DB-verified → search filter ("990002" narrows; empty-filter message) → Analytics banner with live counts. Task-16 recommendation recorded: stamp `business_id` on pool rows so the pool becomes truly per-business (see [wiki/legacy-pool-semantics.md](wiki/legacy-pool-semantics.md))

**Dependencies:** Task 4 (provenance columns), Task 8 (data shape)
**Files likely touched:** new `src/pages/LegacyPool.tsx` (or component), `src/lib/legacy*.ts`, `src/App.tsx`
**Estimated scope:** S

---

### Checkpoint E
- [x] Onboarding end-to-end + re-run verified; Legacy pool works — all live-verified 2026-11-01 (see Tasks 13–15 verification blocks)
- [x] Review with human *(signed off 2026-11-01)*

---

## Task 16: Contract — drop legacy, delete orphaned code

**Description:** Per spec §7/§8: after cutover audit passes — drop legacy tables/columns, delete orphaned code (old `src/components/onboarding/` Step1–4, `src/pages/Dispatch.tsx`, `mockData` legacy bits). Keep `legacy_*` mapping columns on new rows. **Scope decided with the user (2026-11-02, "Safe contract"):** drop the seven genuinely-dead tables (`legacy_order_channels`, `connectors`, `product_sources`, `customer_sources`, `brand_stores`, `selling_points`, `locations`) + the dead binding columns (`orders.selling_point_id`/`location_id`, `product_locations.location_id`, `purchase_orders.location_id`, `pos_shifts.selling_point_id`); **keep** `stores` + every `store_id` binding (operational per option B) and `orders.source`/`customers.source` (retired as load-bearing by the key-model migration `20261103140000` — the tag survives as data).

**Acceptance criteria:**
- [x] Legacy tables/columns dropped via migration — `supabase/migrations/20261103120000_task16_contract_drop.sql` (§1 `business_id` columns on orders/customers → §2 pool account stamping → §3 `publish_my_storefront` rewritten on the brand leg → §4 pool RLS recreated without the dropped column + the account leg → §5 FK/column drops + the one-holder CHECK rebuilt two-way → §6/§7 table + dead-RPC drops → §8 verification DO block). **APPLIED TO PRODUCTION 2026-11-02 ~09:25 +06 (user-approved)** — post-verify 24/24, zero data loss; record in [audit/task16-production-apply.md](audit/task16-production-apply.md)
- [x] Orphaned components/pages deleted — `src/components/onboarding/Step1Store/Step2Locations/Step3SellingPoints/Step4Storefront.tsx`, `src/pages/Dispatch.tsx` (dead `/dispatch` links retargeted to `/orders`), `src/lib/mockData.ts`, `src/components/stores/CreateBrandStoreDialog.tsx`, `src/lib/brandStores.ts`
- [x] `legacy_*` mapping columns retained on order sources (`legacy_store_id`/`legacy_selling_point_id`/`legacy_woo_store_id` — pinned by `supabase/tests/rls/task16_contract_drop_test.sql` 1h)
- [x] Pool rows stamped with `business_id` (§2 stamps from the legacy account when the mapping is unambiguous; production's 99 pool rows stamp to Enveil Vincent `de31fd60-…`) + pool RLS gains the account leg (`business_id IS NULL OR business_id = current_business_context()`); the `source='legacy migration'` tag SURVIVES (orders.source kept in this scope)
- [x] Client surgery: `useBusinessContext` (brandStores/sellingPointsCount removed), OrderSources legacy section (stores-only), Brands (store UI removed), CourierServicesTab (connectors legacy section removed), OrderDetailSheet (location picker removed, storefront_id kept for the restore-stock trigger), `legacyPool.ts` filters (3 legs), signup RPC test updated to the brand-leg publish

**Verification:**
- [x] Battery green (2026-11-02): `npm run typecheck` clean · `npm run test:rls` **ALL GREEN (28 files)** incl. the new `task16_contract_drop_test.sql` (7 tables gone, 5 columns gone, pool RLS shape without the dropped column + account leg, publish rewrite, dead RPCs, mapping columns survive, one-holder CHECK rebuilt two-way) · vitest **496 passed | 3 skipped (61 files)** · `npm run build` clean · eslint: no new issues (the 18 `no-explicit-any` errors in OrderDetailSheet exist identically at HEAD). The battery caught two real defects pre-commit: the auto-dropped one-holder CHECK (rebuilt in §5) and the §3 body-comment literal that would have failed §8's own verification grep

**Dependencies:** Task 17 (cutover must precede drop) — run after successful cutover
**Files likely touched:** `supabase/migrations/*.sql`, deleted `src/components/onboarding/*`, `src/pages/Dispatch.tsx`, affected imports
**Estimated scope:** M

---

## Task 17: Cutover runbook + execute migration (USER-GATED)

**Description:** Per spec §7: prepare the runbook (backup → maintenance window → run Task 8 script → audit → verify → enable new UI) and **execute only on explicit user go-ahead**. Real tenant: Enveil Vincent `de31fd60-…`. Wipe test data per Q24/Q27 (by UUID, sever AGS→Enveil-store link first).

**Acceptance criteria:**
- [x] Runbook documents exact steps, rollback (backup), and verification queries — [runbook-cutover.md](runbook-cutover.md) (`dcd3454`, 2026-10-31): three user gates + sign-off checklist; precondition chain (Checkpoints A–E → **28-file production chain** → data script); rehearsal flow; line-cited migration walkthrough; Q24/Q27 wipe rules; live-audit queries; expected counts + drift rules; rollback. Cross-checked against the scripts and the dry-run report — discrepancies recorded in its appendix (incl. the stale card counts corrected above). Refreshed 2026-11-01 after the read-only readiness review ([audit/task17-readiness-report.md](audit/task17-readiness-report.md)): scope corrected 19 → 28, rollback basis switched from "backup/PITR" to the proven logical dump (production has no native backup or PITR), and the deployed-frontend apply-order risk re-measured against the live bundle
- [x] **Gate 1 — user approved** (2026-11-01): rollback basis = proven logical dump (restore-verified locally, checksums + durable copy in the readiness report); scope = all 28 migrations
- [x] **Schema chain applied** (2026-11-01 19:54, `supabase db push --linked --yes`): all 28 migrations exit 0; ledger 162 → **190**, head `20261103090000`; `is_signup_open()` live; `legacy_order_channels` keeps its 3 rows; new tables + `joined_via` present; business/customer/order/product counts unchanged. Post-apply verification in [audit/task17-readiness-report.md](audit/task17-readiness-report.md) §7. Two follow-ups surfaced: the deployed Vercel build has not landed yet (Orders/Settings pages stay broken on the legacy shape until it does), and §8's RLS-disabled-table exposure
- [x] **RLS hardening written + battery-green** (2026-11-01, local): [20261103100000_rls_hardening.sql](../supabase/migrations/20261103100000_rls_hardening.sql) repairs the root cause (permissive `ALTER DEFAULT PRIVILEGES` on the prod `postgres` role — new tables born fully granted to anon incl. TRUNCATE, which RLS does not gate), enables RLS on all nine exposed tables, adds the three intent-matching policies, revokes the anon/authenticated default surface and re-grants exactly the policy-derived surface + carve-outs (restores the `products.cost_price` exclusion and the `app_config` function-only contract). Companion [rls_hardening_test.sql](../supabase/tests/rls/rls_hardening_test.sql) pins the posture; `npm run test:rls` **ALL GREEN (29 files + 6 API suites)**. Local ledger 191. **Applying it to production is a gated write — bundle it with the next production window**
- [x] **RLS hardening APPLIED to production** (2026-11-01 21:14, user-approved): ledger 190 → **191**, head `20261103100000`; post-verify all green — 0 tables with RLS off, 0 default-ACL API grants, anon surface = 10 tables SELECT-only with 0 TRUNCATE holders, `sync_queue`/`product_locations`/`sync_queue_cleanup_log`/`app_config` now 401 to anon (were 200 with data), `products.cost_price` carve-out enforced, public catalog + `is_signup_open()` intact, service_role untouched. Live traffic during the window moved customers 3,246 → 3,247 and orders 4,092 → 4,093 — Gate 2 needs a fresh extract per the ≤24 h rule
- [x] **New frontend deployed + smoke-verified** (2026-11-02 04:38–04:54 +06): linked the checkout to the existing Vercel project (`npx vercel link --project dokanos --yes` → `mujahidul1slams-projects/dokanos`; `.vercel/` is gitignored) and deployed with `npx vercel --prod --yes` ("Ready in 1m"). Live bundle swapped `index-DSV-o5nx.js` → **`index-CR_kWxJC.js`**. Full 132-chunk scan: zero `order_sources.is_default`/`sort_order` references (remaining hits are legitimate warehouses/locations/measurement columns); new shapes present (`legacy_order_channels`, `order_source_type`, `sync_direction`, `joined_via`, `business_onboarding_steps`, `brand_stores`, `courier_services`, `warehouses`, `payment_accounts`, `stock_transfers`, `origin_order_source_id`, dedicated OrderSources + legacyPool chunks); Signup chunk now uses `rpc/is_signup_open`. Live PostgREST probes: every new shape reaches the privilege layer (401 42501 to anon = intended posture), old shape still 400s. Browser smoke as the production account (Enveil Vincent): Dashboard ✅, Order Sources page (brand-scoped empty state + Legacy rows with real AGS Woo store / Enveil Vincent selling point + mapping column) ✅, Add Order dialog incl. new Order source section ✅, Settings new nav ✅, Warehouses page ✅
- [x] **Gate 2 — data migration APPLIED to production** (2026-11-02 06:02 +06, user-approved "Run it now"): [migrate-enveil-vincent.sql](../scripts/migrate-enveil-vincent.sql) (27,359 B, own `BEGIN;`…`COMMIT;` = one all-or-nothing transaction) applied via the Supabase Management API — HTTP 201, zero errors. Fresh pre-data rollback dumps captured first (`C:\Users\mujah\dokan-prod-backups\20261102-pre-data\`, sha256-verified: schema `8F7C57C2…`, data `BE5C6678…`). Rehearsal re-run on a minutes-old extract (3,249 customers / 4,095 orders / 5,329 order_items): **12/12 PASS** before the go-ahead
- [x] **Gate 3 — live audit matches the rehearsal** (2026-11-02 06:03 +06, read-only): all 23 checks match — 8 order sources (4 Vincent + 4 Enveil, all legacy-mapped), 1 warehouse, 2 courier services (both mapped), 225 products all attributed, customers 3,247 = 3,196 attributed + 51 pool, orders 4,095 = 4,047 attributed (3,238 bound + 809 inferred) + 48 pool + 0 unattributed + 0 inferable, 205 stock rows repointed / 0 legacy rows left, 0 wiped rows remaining, evidence cohort 0. Orders per source: Vincent Woo 1,772 / Enveil Woo 660 / Facebook-Instagram 798 / Showrooms 817 / Storefronts 0. Awaiting the user's sign-off checkbox below
- [x] Post-migration audit matches Task 8's expected counts; user signs off *(Gate 3 — **SIGNED OFF 2026-11-02 06:06 +06**; live audit all 23 checks matched the rehearsal)*

**Verification:**
- [x] Read-only readiness review complete (2026-11-01) — production preflight, migration scope, conflict scan, backup/PITR finding + restore-tested logical dump, deployed-frontend dependency crawl
- [x] Dry-run already validated (Task 8); live audit report produced and reviewed *(**DONE 2026-11-02 06:03 +06** — live audit 23/23 checks matched the rehearsal; user signed off at 06:06)*

**Dependencies:** Task 8 (script + dry-run), Checkpoints A–E
**Files likely touched:** `tasks/runbook-cutover.md` (new), execution of Task 8 script
**Estimated scope:** M

---

### Final checkpoint
- [x] Production tenant migrated, audit clean, all acceptance criteria met *(**COMPLETE 2026-11-02**: cutover Gates 1–3 signed off — schema chain 2026-11-01, data migration 06:02 +06 with a 23/23 live audit, RLS hardening applied 2026-11-01; Task 16's legacy drop applied 09:25 +06 with a 24/24 post-verify and a green UI smoke after the frontend redeploy. The Domain Revamp series Tasks 1–16 is fully executed; Task 17's runbook consumed end-to-end. **Key-model follow-up EXECUTED 2026-11-02** — `20261103140000_key_model_attribution.sql` backfilled `business_id` for all 4,095 orders / 3,247 customers deterministically to Enveil Vincent `de31fd60-a520-4d42-aef2-c72ededc4c09`, added the derivation triggers, rewrote orders/customers RLS to plain `business_id` tenancy, and made pool membership structural — see the key-model addendum in [wiki/legacy-pool-semantics.md](wiki/legacy-pool-semantics.md))*
