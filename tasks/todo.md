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
- [ ] ProfileSettingsTab has Default business selector (per-user persisted choice)
- [ ] Post-login landing uses the default; single-business users never see a picker
- [ ] Fallbacks: dead default → sole/first remaining business; none → create/join screen
- [ ] Quick-create/search follow the *current* business, not the default

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass
- [ ] Manual in UI: set default, re-login, lands there; single-business account auto-lands

**Dependencies:** None (uses existing `active_business_context` infra)
**Files likely touched:** `src/components/settings/ProfileSettingsTab.tsx`, `src/pages/AccountSelection.tsx`, `src/App.tsx`, a migration for `profiles.default_business_id`, `src/lib/*` context helpers
**Estimated scope:** M

---

## Task 3: Post-verification personal profile setup screen

**Description:** Per spec §5/§6b: after email verification, show a skippable "Set up your profile" screen (photo, name, phone) before any business screen. Completable later from settings. Verified email stays the only hard gate.

**Acceptance criteria:**
- [ ] New screen appears after `/auth/confirm`, before business flow; skippable in one click
- [ ] Fields: avatar upload, full name, phone; saved to `profiles`
- [ ] Skip lands on the business flow; re-entry possible from settings

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass
- [ ] Manual: signup → verify → setup screen → skip and complete paths both work

**Dependencies:** None
**Files likely touched:** new `src/pages/ProfileSetup.tsx` (or component), `src/pages/AuthConfirm.tsx`, `src/App.tsx`, `src/components/settings/ProfileSettingsTab.tsx`
**Estimated scope:** M

---

### Checkpoint A
- [ ] Tasks 1–3 tested, typechecked, built, UI-verified
- [ ] Review with human before Phase 2

---

## Task 4: Unified `order_sources` + provenance + RLS/types

**Description:** Per spec §2: create the per-brand `order_sources` table (type enum `woocommerce|storefront|showroom|physical_store|facebook|instagram|whatsapp|manual`, name, config jsonb, connection/sync config, legacy_* mapping columns, `is_stock_holding` default by type). Add provenance columns to `products`/`customers` (`origin_order_source_id`, `origin_kind`). `orders.order_source_id` column (nullable for now). RLS per brand; regenerate Supabase types.

**Acceptance criteria:**
- [ ] `order_sources` exists with UQ(brand_id, name), type enum, legacy_* audit columns
- [ ] `products.origin_order_source_id` + `origin_kind`; `customers.origin_order_source_id` + `origin_kind`
- [ ] `orders.order_source_id` nullable FK added (no backfill yet — Task 8)
- [ ] RLS isolates by business membership; RLS tests pass

**Verification:**
- [ ] `npm run test:rls` (or targeted SQL tests) pass; `npm run typecheck` passes after type regen

**Dependencies:** None (expand phase; no drops)
**Files likely touched:** `supabase/migrations/*.sql` (new), `src/integrations/supabase/types.ts` (generated), `supabase/tests/rls/*.sql`
**Estimated scope:** M

---

## Task 5: Warehouses & stock model schema

**Description:** Per spec §3: `warehouses` table (brand_id, name, address/contact, is_default). Stock holders = warehouses + stock-holding order sources: `product_locations` gets `warehouse_id`/`stock_holder_order_source_id` (exactly one via CHECK) alongside existing `location_id` (kept until contract). `order_sources.fulfillment_preference` (ordered id list jsonb) + `ship_from_store` boolean. `stock_transfers` table (from/to stock holder, items, quantities, status).

**Acceptance criteria:**
- [ ] `warehouses` CRUD-able at brand level (schema + RLS)
- [ ] `product_locations` rows can point at warehouse OR stock-holding order source (CHECK exactly one)
- [ ] `order_sources` has `is_stock_holding`, `ship_from_store`, `fulfillment_preference`
- [ ] `stock_transfers` table with RLS

**Verification:**
- [ ] Migrations apply on fresh local DB; RLS tests pass; `npm run typecheck` passes

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
- [ ] Per-brand list of order sources with type badges, connection/sync status
- [ ] Create manual source (user-named), create connected source (Woo/storefront config inline)
- [ ] New orders attribute to an order source (`orders.order_source_id`); old `source` text no longer written
- [ ] Legacy rows still readable via mapping (no data loss on the page)

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass; manual end-to-end create source → create order → appears under source

**Dependencies:** Tasks 4, 5
**Files likely touched:** `src/pages/StoresHub.tsx` (split/replace), new `src/pages/OrderSources.tsx`, `src/components/orders/AddOrderDialog.tsx`, `src/lib/*` source helpers, `src/App.tsx`
**Estimated scope:** M

---

## Task 7: Warehouses settings + transfers + fulfillment

**Description:** Per spec §3: brand-level **Warehouses** settings (replaces Locations tab). Stock view per warehouse + stock-holding source (from `product_locations`). Simple transfers (from → to, items, qty) with stock moves. Per-source fulfillment preference + ship-from-store toggle.

**Acceptance criteria:**
- [ ] Warehouses CRUD at brand level; showrooms appear as stock holders (order sources with `is_stock_holding`)
- [ ] Transfer creates `stock_transfers` row and moves `product_locations` quantities
- [ ] Fulfillment preference + ship-from-store editable per order source

**Verification:**
- [ ] `npm run typecheck`, `npm test` pass; manual transfer moves stock correctly

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
