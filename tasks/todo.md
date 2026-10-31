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
- [ ] Tasks 1–3 tested, typechecked, built, UI-verified
- [ ] Review with human before Phase 2

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
- [ ] Fresh-DB migration clean; RLS green; review with human

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

**Description:** Per spec §7: write the data-migration script (id-based only) — collapse stores/selling_points/brand_stores/storefronts into order sources per the mapping table; map warehouses; attribute products/customers/orders + provenance; infer the 96 orders (73 V / 23 E) via customer phone/id; merge 2 customer duplicates; route 753 orders + 1,200 customers to the Legacy pool; delete 4 junk rows + 7 test businesses (incl. `13e888dc-…`) after severing the AGS→Enveil-store link. Produce an audit report (counts before/after per entity). **Do not execute against production.**

**Acceptance criteria:**
- [ ] Script runs idempotently against a restored backup/scratch DB and produces the audit report
- [ ] Audit shows: 4 order sources + warehouses per brand; 225 products, 2,022 customers, 3,297 attributed orders preserved; 753 + 1,200 in Legacy pool; 96 orders attributed
- [ ] No name-based lookups anywhere in the script

**Verification:**
- [ ] Dry-run on scratch DB; audit report reviewed with human (Checkpoint C)

**Dependencies:** Tasks 4, 5
**Files likely touched:** `supabase/migrations/*.sql` or `scripts/migrate-*.mjs`, `scripts/*audit*`
**Estimated scope:** M

---

### Checkpoint C
- [ ] New pages usable end-to-end; mapping dry-run audit reviewed with human

---

## Task 9: Courier services at business level

**Description:** Per spec §4: business-level **Courier services** page (providers: Pathao, Steadfast, RedX, eCourier). Existing `pathao_integrations`/`courier_integrations`/`connectors` courier rows are represented here (legacy ids mapped). Enable at fulfillment time (DispatchDialog/OrderDetailSheet consume the business-level services).

**Acceptance criteria:**
- [ ] Courier services CRUD at business level (credentials, provider)
- [ ] Dispatch flow selects a business-level courier service
- [ ] No per-brand courier duplication in UI

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass; manual dispatch flow works

**Dependencies:** Task 4
**Files likely touched:** new `src/pages/CourierServices.tsx` (or business settings tab), `src/components/orders/DispatchDialog.tsx`, `src/components/orders/OrderDetailSheet.tsx`, `src/lib/courier*.ts`, `src/App.tsx`
**Estimated scope:** M

---

## Task 10: Payment accounts + per-source method toggles

**Description:** Per spec §4: business-level **Payment accounts** (bKash/Nagad/Stripe/card credentials) + per-order-source accepted-method toggles (COD, bKash, card…). No separate integrations area.

**Acceptance criteria:**
- [ ] Payment accounts CRUD at business level
- [ ] Each order source has accepted-methods toggles; order creation reflects them
- [ ] Manual/cash always available for staff-entered orders

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass; manual: toggle methods per source, see them in order flow

**Dependencies:** Tasks 4, 6
**Files likely touched:** new `src/pages/PaymentAccounts.tsx` (or settings tab), `src/components/orders/AddOrderDialog.tsx`, `src/lib/payment*.ts`, `src/App.tsx`
**Estimated scope:** M

---

## Task 11: Retire `/integrations` + legacy StoresHub tabs

**Description:** Per spec §8: remove `/integrations` page and the legacy StoresHub tabs (Stores/Locations/Selling Points/Connectors/Product Sources/Customer Sources) now covered by Order Sources / Warehouses / Courier services / Payment accounts. Keep legacy tables untouched (contract is Task 16). Update tests.

**Acceptance criteria:**
- [ ] No integrations UI reachable; no StoresHub tabs referencing removed concepts
- [ ] Navigation points at Order Sources, Warehouses, business-settings pages
- [ ] Playwright account specs updated and passing

**Verification:**
- [ ] `npm run test:browser` (where env allows), `npm run typecheck`, `npm test` pass

**Dependencies:** Tasks 6, 7, 9, 10
**Files likely touched:** `src/pages/Integrations.tsx` (delete), `src/pages/StoresHub.tsx` (remove/replace), `src/App.tsx`, `tests/accounts/*.spec.ts`
**Estimated scope:** S

---

### Checkpoint D
- [ ] Integrations UI gone; couriers/payments usable; review with human

---

## Task 12: Roles ladder + invite role picker

**Description:** Per spec §5: rename role enum `owner/admin/member/viewer → Owner/Admin/Manager/Staff` (map owner→Owner, admin→Admin, member→Manager, viewer→Staff). Invitations carry the chosen role (picker in invite UI). Existing memberships mapped.

**Acceptance criteria:**
- [ ] Role ladder displays/behaves as Owner/Admin/Manager/Staff everywhere (members page, invites)
- [ ] Invite dialog has role picker; accepted invite grants that role
- [ ] Existing rows remapped by the enum rename migration

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass; manual invite with each role works

**Dependencies:** None (independent); touches `user_business_access`/`business_invitations`
**Files likely touched:** `supabase/migrations/*.sql`, `src/pages/BusinessMembers.tsx`, `src/components/*invite*`, `src/lib/roles*.ts`
**Estimated scope:** S

---

## Task 13: Business onboarding — shell + profile + brand + order sources

**Description:** Per spec §6a: new onboarding wizard (fresh code — old `src/components/onboarding/` is retired): skippable at any step, resumable (persistent checklist), re-runnable from settings. Steps in order: business profile → first brand (explicit name + optional logo) → connect order sources. Invited members never see it (Task 3 covers their profile setup).

**Acceptance criteria:**
- [ ] Onboarding runs after business creation; skip at any point; progress persisted (resumable)
- [ ] Checklist re-runnable from settings
- [ ] First-brand step is explicit (no ghost brand); logo optional
- [ ] Order-source step offers WooCommerce/Storefront/Facebook/WhatsApp/Showroom/Manual

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass; manual: create business → onboarding → skip mid-way → resume → re-run from settings

**Dependencies:** Tasks 4, 6 (order sources exist), Task 3 (invited-member path)
**Files likely touched:** new `src/components/onboarding/*` (fresh), `src/App.tsx`, `src/pages/AccountSelection.tsx`, `supabase/migrations/*.sql` (checklist state), `src/lib/onboarding*.ts`
**Estimated scope:** M

---

## Task 14: Onboarding — warehouses, product import, storefront sub-onboarding

**Description:** Per spec §6a continued: onboarding steps 4–6: warehouses → product import (Woo push import, CSV action, manual) → optional storefront creation launching the storefront sub-onboarding (name/slug, theme, payments, publish). Same storefront sub-onboarding runs whenever a storefront is created later.

**Acceptance criteria:**
- [ ] Warehouse step creates brand warehouses
- [ ] Product import: WooCommerce import (from connected source), CSV import (action), manual add
- [ ] Storefront step runs only if storefront chosen; identical sub-onboarding reachable from "create storefront" anytime
- [ ] Onboarding remains skippable/resumable through these steps

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass; manual: full onboarding incl. CSV import + storefront creation

**Dependencies:** Task 13
**Files likely touched:** `src/components/onboarding/*`, `src/components/storefront/*`, `src/lib/import*.ts`, `src/App.tsx`
**Estimated scope:** M

---

## Task 15: Legacy / unattributed pool UI

**Description:** Per spec §7: business-level "Legacy / unattributed" pool listing orders/customers tagged `legacy migration` (753 orders + 1,200 customers after cutover). Reassign to a brand from the UI (sets brand + provenance). Visible in reports context.

**Acceptance criteria:**
- [ ] Pool page/section at business level with counts and filters
- [ ] Reassign action moves an item to a chosen brand with provenance `legacy`
- [ ] Pool is empty-checkable (before/after migration states both render fine)

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass; manual reassignment works on seeded data

**Dependencies:** Task 4 (provenance columns), Task 8 (data shape)
**Files likely touched:** new `src/pages/LegacyPool.tsx` (or component), `src/lib/legacy*.ts`, `src/App.tsx`
**Estimated scope:** S

---

### Checkpoint E
- [ ] Onboarding end-to-end + re-run verified; Legacy pool works; review with human

---

## Task 16: Contract — drop legacy, delete orphaned code

**Description:** Per spec §7/§8: after cutover audit passes — drop legacy tables/columns (`stores`, `selling_points`, `brand_stores`, old `order_sources` lookup, `locations` remnants, `connectors`, `product_sources`, `customer_sources`, `orders.source`, etc.), delete orphaned code (old `src/components/onboarding/` Step1–4, `src/pages/Dispatch.tsx`, `mockData` legacy bits). Keep `legacy_*` mapping columns on new rows.

**Acceptance criteria:**
- [ ] Legacy tables/columns dropped via migration; app builds and tests pass without them
- [ ] Orphaned components/pages deleted
- [ ] `legacy_*` mapping columns retained on order sources / stock holders

**Verification:**
- [ ] `npm run typecheck`, `npm test`, `npm run build` pass; `npm run test:rls` pass

**Dependencies:** Task 17 (cutover must precede drop) — run after successful cutover
**Files likely touched:** `supabase/migrations/*.sql`, deleted `src/components/onboarding/*`, `src/pages/Dispatch.tsx`, affected imports
**Estimated scope:** M

---

## Task 17: Cutover runbook + execute migration (USER-GATED)

**Description:** Per spec §7: prepare the runbook (backup → maintenance window → run Task 8 script → audit → verify → enable new UI) and **execute only on explicit user go-ahead**. Real tenant: Enveil Vincent `de31fd60-…`. Wipe test data per Q24/Q27 (by UUID, sever AGS→Enveil-store link first).

**Acceptance criteria:**
- [ ] Runbook documents exact steps, rollback (backup), and verification queries
- [ ] User explicitly approves execution before any production write
- [ ] Post-migration audit matches Task 8's expected counts; user signs off

**Verification:**
- [ ] Dry-run already validated (Task 8); live audit report produced and reviewed

**Dependencies:** Task 8 (script + dry-run), Checkpoints A–E
**Files likely touched:** `tasks/runbook-cutover.md` (new), execution of Task 8 script
**Estimated scope:** M

---

### Final checkpoint
- [ ] Production tenant migrated, audit clean, all acceptance criteria met
