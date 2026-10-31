# Implementation Plan: Domain Revamp (accounts / multi-business / brands / order sources)

## Overview

Implement [DOMAIN-REVAMP-SPEC.md](../DOMAIN-REVAMP-SPEC.md) (grill-agreed 2026-10-29, user-confirmed): collapse stores/selling points/brand_stores/storefronts/order-source-lookup into one per-brand **order sources** model, replace locations with **warehouses** + stock-holding order sources, move couriers/payments to business-level services, remove the integrations area, add confirm-password on signup, default-business selection, personal profile setup, an Owner/Admin/Manager/Staff role ladder, and a skippable/resumable business onboarding with storefront sub-onboarding. Migrate the single real tenant **Enveil Vincent** (`de31fd60-…`, brands Vincent `ca061912-…` + Enveil `3eb99fc9-…`) by UUID and wipe test data — **migration execution is gated on explicit user go-ahead**.

## Architecture Decisions

- **Expand → cutover → contract.** New schema lands *alongside* legacy tables (no drops until Task 16). Legacy ids preserved in `legacy_*` mapping columns for audit (spec §7).
- **One-shot migration in a short maintenance window** (single real tenant). Dry-run + audit report before execution; pre-migration backup is the rollback (spec §7).
- **Strictly by UUID.** Two businesses are named "Enveil Vincent"; `Enveil Woocommerce` `9d2cc780-…` (junk) vs `Enveil WooCommerce` `9a3fb6c0-…` (real) differ by one word. No name-based migration logic anywhere.
- **Order source types:** `woocommerce | storefront | showroom | physical_store | facebook | instagram | whatsapp | manual` (manual = user-named, no connection config). Connected vs manual is a property of the type, not a separate entity (spec §2).
- **Stock:** `product_locations` keeps per-location stock semantics; rows point at either a warehouse or a stock-holding order source (exactly one, CHECK constraint). Brand-wide visibility; per-source fulfillment preference + ship-from-store toggle; simple transfers in v1 (spec §3).
- **Provenance:** `products` and `customers` get `origin_order_source_id` + `origin_kind` (`woo_sync | csv | manual | pos | legacy`) so "where did this come from" is always answerable (Q22).
- **CSV import is an action**, not a table (spec §2).
- **Roles:** enum rename in place `owner/admin/member/viewer → Owner/Admin/Manager/Staff` (map: owner→Owner, admin→Admin, member→Manager, viewer→Staff), role picked on invite (spec §5).
- **Default business** controls post-login landing only; quick-create/search follow the *current* business; notifications merged across businesses, grouped (spec §5).
- **No feature flags** — the app is pre-launch except one tenant; new pages replace old ones per slice, legacy pages stay until the contract phase.

## Session handoff (2026-10-31, after Task 6)

- **Done: Tasks 1–6, all verified and committed.** See [todo.md](todo.md) for evidence per task. Task 6 commits: page + dialog + legacy mapping `295d28b`; order attribution (AddOrderDialog/POS/read side) + per-source order counts + settings-tab re-wire, then this doc update.
- **Next: Task 7** (Warehouses settings + transfers + fulfillment preference). Start from `tasks/todo.md`, not from memory. It replaces the StoresHub "Locations" tab; `order_sources` already carries `is_stock_holding`/`ship_from_store`/`fulfillment_preference` and `warehouses`/`stock_transfers` exist (Task 5 schema).
- **Task 6 design decisions (user-confirmed):** (1) legacy rows stay readable on the page via a read-only "not yet migrated" section with spec §7 mapping labels until Task 8 collapses them; (2) "old `source` text no longer written" scoped to `orders.source` in AddOrderDialog — **POS keeps `source='pos'`** (POS reports + dashboard `pos` filters still read it) but both flows now write `orders.order_source_id`; POS reports/dashboard move to the new model at the contract phase (Task 16) when `orders.source` is dropped. Walk-ins (AddOrderDialog fulfillment=walkin, and all POS sales) auto-attach to the brand's showroom/physical-store source (`pickWalkInSource`).
- **Task 6 gotchas:** orders list/detail/customer-history selects now join `order_source:order_sources(name, type)`; `orders.source` and `customers.source` are NOT NULL with insert defaults, so "not written" means the column default fills it. The settings → Order Sources tab is now a pointer panel; `legacy_order_channels` has **zero UI consumers** left (drop it at Task 16). The legacy StoresHub `/stores` page is unchanged and routable (Task 11 retires its tabs).
- **Schema state:** unchanged by Task 6 (no migrations). Local ledger head `20261031113000` (183 migrations).
- **Local stack:** Docker + Supabase at `127.0.0.1:54321`. Dev server: `npm run dev -- --port 8080 --strictPort --host 127.0.0.1` (use the IP, not `localhost`). Vite's watcher **crashes with `EBUSY` on atomic file saves** (`.File.tsx.*.tmpdir`) — the dev server dies and must be restarted; prefer editing while it is stopped. `npm run test:rls` (`supabase db reset`) wipes seeded fixtures — the `landing.*@example.com` fixtures are gone after Task 5's RLS run; Task 6 used fresh fixtures (`task6.verify@example.com` / `Task6Verify-2026!`, business "Task 6 Verify Co", brand "Task 6 Brand" incl. legacy rows + one product for order flows).
- **Pre-existing, not ours:** `account-lifecycle-rehearsal.spec.ts` has 2 failing signup-form tests (also fail on clean `HEAD`); `ProfileSettingsTab.tsx` MFA handlers use `catch (err: any)` + one hook-deps warning; big legacy order/POS files carry `no-explicit-any` lint debt (142 problems at HEAD on the touched files, 140 after Task 6). **Foreign changes appeared in the worktree mid-session** (another actor deleted `src/test/signupConfiguration.test.tsx`, `signupGate.test.ts`, `supabase/functions/_shared/signup-*`, `signup-event`, and 2 signup migrations + 2 signup RLS tests) — untouched by Task 6 work and NOT included in its commits.
- **User-gated, not executed:** the production catch-up batch (**19 files** — 16 pending + drift repair + the two Phase-1 migrations) in [audit/production-migration-plan.md](audit/production-migration-plan.md). Production signup is fail-closed until it runs.
- Verify changed behavior in the running frontend (`dsh_browser_*`) per AGENTS.md; Playwright via `PLAYWRIGHT_CHANNEL=chrome npx playwright test --config playwright.accounts.config.ts <spec>`. RLS battery: `npm run test:rls` (22/22 green at Task 5; note the foreign signup-test deletions change that file count).

## Task List (ordered index; full cards in [todo.md](todo.md))

### Phase 1 — Personal account surfaces (independent of the revamp)
- [x] Task 1: Confirm-password on signup *(XS)* — committed `6dac1fc`; typecheck/vitest/eslint/build/Playwright (14/14, system Chrome) green
- [x] Task 2: Default business selection + auto-select + fallback *(M)* — migration `20261030180000`; landing resolver unit-tested; verified in UI, DB, and Playwright
- [x] Task 3: Post-verification personal profile setup screen *(M)* — migration `20261030200000`; live skip/save/re-login verified in running UI

**Checkpoint A** — tests/typecheck/build green; UI verified in running frontend; review with human.

### Phase 2 — Schema foundation (expand)
- [x] Task 4: Unified `order_sources` + provenance columns + RLS/types *(M)* — migration `20261031090000`; legacy lookup renamed to `legacy_order_channels` (2 consumers patched); RLS battery 20/20 green
- [x] Task 5: Warehouses & stock model schema (stock holders, transfers) *(M)* — migration `20261031113000`; exactly-one-holder CHECK on `product_locations`; RLS battery 22/22 green

**Checkpoint B** — migrations apply cleanly on a fresh local DB; RLS tests pass.

### Phase 3 — Core UI on the new model
- [x] Task 6: Order Sources page per brand (incl. manual sources, order attribution) *(M)* — `/order-sources` + dialog + legacy read-only mapping; AddOrderDialog/POS attribute `orders.order_source_id` (walk-ins → showroom source); committed `295d28b` + follow-up
- [ ] Task 7: Warehouses settings + transfers + fulfillment preference *(M)*
- [ ] Task 8: Enveil Vincent mapping migration + audit report — **dry-run only** *(M)*

**Checkpoint C** — new pages usable end-to-end against seeded data; mapping dry-run report reviewed with human.

### Phase 4 — Business services
- [ ] Task 9: Courier services at business level (Pathao configs move in) *(M)*
- [ ] Task 10: Payment accounts + per-source method toggles *(M)*
- [ ] Task 11: Retire `/integrations` + legacy StoresHub tabs *(S)*

**Checkpoint D** — no integrations UI anywhere; couriers/payments usable from business settings.

### Phase 5 — Roles, onboarding, legacy pool
- [ ] Task 12: Roles ladder + invite role picker *(S)*
- [ ] Task 13: Business onboarding — shell, skip/resume/re-run, profile + brand + order-source steps *(M)*
- [ ] Task 14: Onboarding — warehouses, product import (Woo/CSV), storefront sub-onboarding hook *(M)*
- [ ] Task 15: Legacy / unattributed pool UI (business level) *(S)*

**Checkpoint E** — full onboarding runs end-to-end and re-runs from settings; invited members see only profile setup.

### Phase 6 — Contract & cutover
- [ ] Task 16: Contract: drop legacy tables/columns, delete orphaned onboarding + Dispatch.tsx *(M)*
- [ ] Task 17: Cutover runbook + **execute migration with user go-ahead** *(M)*

**Final checkpoint** — production tenant migrated, audit clean, all acceptance criteria met.

## Infrastructure (done 2026-10-30, outside the 17 tasks)

- **Dev/test default to the isolated local stack.** Tracked `.env.development` overrides the production values in `.env` for `npm run dev` / `build:dev`; `npm run build` and the two scripts that read `.env` (`check-catalog.mjs`, `verify-live-deployment.mjs`) keep production values untouched — `.env` stays tracked for that reason.
- Local Supabase via Docker (`supabase start`, `supabase db reset --local`): 179 migrations incl. the drift repair below; ledger head `20261030090000`.
- **Production catch-up batch documented** in [audit/production-migration-plan.md](audit/production-migration-plan.md): 16 pending migrations (signup is fail-closed on prod until applied — `is_signup_open()` missing) + repair migration `20261030090000_repair_audit_drift.sql` (`orders.payment_meta` exists only on prod yet the checkout RPCs insert it, so fresh builds broke at checkout; `webhook_events` nullability converged). Execution is user-gated.
- Playwright runs via `PLAYWRIGHT_CHANNEL=chrome` (bundled Chromium download stalls in this environment).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Migration damages the one real tenant | High | Backup first; dry-run + audit report; strict UUIDs; user-gated execution; keep legacy tables until audit passes |
| Name-collision deletes wrong row | High | All migration/deletes by UUID only; two "Enveil Vincent" rows + near-identical selling-point names exist |
| Big UI rewiring (StoresHub 7 tabs) breaks flows | Med | Replace per slice; legacy pages stay routable until Task 11/16; browser tests updated per slice |
| Dirty worktree (pre-existing uncommitted changes incl. modified test specs) | Med | Never mix our edits with others' in one commit; ask user before committing over foreign changes |
| Woo stores currently `status=error` | Low | Migration does not depend on sync health; flag separately to user |

## Open Questions

- None blocking. The production catch-up batch awaits user go-ahead ([audit/production-migration-plan.md](audit/production-migration-plan.md)).
