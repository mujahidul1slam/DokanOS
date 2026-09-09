# Codebase Concerns

**Analysis Date:** 2026-09-09

Scope: full repo. Stack context: React 18 + Vite SPA (~42k LOC in `src/`), 13 Supabase Edge Functions (~5.6k LOC in `supabase/functions/`), 134 SQL migrations, Supabase Postgres with RLS, GitHub Actions cron, Cloudflare Worker cron.

---

## Security Considerations

**CRITICAL — Unauthenticated debug endpoint exposing order data:**
- Risk: Anyone on the internet can dump the 5 most recent orders (names, phones, totals) and the last 5 webhook payloads (which include customer PII from WooCommerce).
- Files: `supabase/functions/get-orders/index.ts` (16 lines — no auth check of any kind), `supabase/config.toml` lines 14–16 (`[functions.get-orders] enabled = true`, `verify_jwt = false`).
- Current mitigation: None. The function creates a service-role client and returns JSON to every caller.
- Recommendations: Delete the function and its `config.toml` block, or gate it behind the `x-cron-secret` vault-token pattern used in `supabase/functions/woo-sync-all/index.ts:29-46`. This looks like leftover debug tooling.

**CRITICAL — Plaintext cron secret committed to git:**
- Risk: The `sync_worker_cron_token` vault secret value is hardcoded as a literal argument to `vault.create_secret(...)` in a tracked migration. Anyone with repo read access (or any future leak of the repo) can invoke `sync-worker`, `pathao-courier` (`track_all`), and `woo-sync-all` — all of which trigger service-role operations and paid Pathao API calls.
- Files: `supabase/migrations/20260901000000_scheduler_auth_and_courier_tokens.sql` lines 13–20 (literal redacted here), consumed via `get_sync_worker_cron_token()` in `supabase/functions/woo-sync-all/index.ts`, `supabase/functions/sync-worker/index.ts`, `supabase/functions/pathao-courier/index.ts:287`.
- Current mitigation: Vault storage at rest; but the migration file itself defeats it. Commit history contains the value permanently.
- Recommendations: Rotate the token (recreate the vault secret under a new name), stop embedding literals in migrations, inject it via `supabase secrets set` / manual SQL instead. Treat the committed value as compromised.

**HIGH — `.env` is tracked in git:**
- Risk: `.env` is committed at HEAD (keys: `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`) and `.gitignore` has no `.env` entry. Values are currently only publishable-key material (client-safe by Supabase design), but the pattern guarantees someone eventually commits a real secret; history already contains prior project credentials from the "new project migration" commit `de5dfaa`.
- Files: `.env`, `.gitignore` (no env rule), confirmed via `git ls-files`.
- Recommendations: Add `.env` to `.gitignore`, `git rm --cached .env`, ship a `.env.example`, and treat any historical secret-looking values as rotated.

**HIGH — Integration credentials readable by every authenticated user:**
- Risk: `pathao_integrations` SELECT policy is `USING (true)` for all authenticated users, and the table stores `client_secret` and `password` in plaintext columns. Any signed-in staff-level user (any tenant in a multi-business world) can read every merchant's Pathao API credentials. Same pattern for `stores`: the "Authenticated users can manage stores" policy is `USING (true) WITH CHECK (true)` for ALL — any authenticated user can read/modify every WooCommerce store row including `consumer_secret`.
- Files: `supabase/migrations/20260416133231_bd940bd4-0662-4972-b207-7b0864727b8f.sql` (pathao_integrations policies), `supabase/migrations/20260407071618_75b9cdbd-ffa1-48c1-bbce-54015ebc3c86.sql` lines ~14–25 (stores policy), `supabase/migrations/20260620172022_0874a733-3d87-4f27-9f1d-75b87a0061b7.sql` (partial hardening — products/anon only, did not touch stores/pathao_integrations SELECT).
- Current mitigation: Client UI hides the fields, but RLS is the actual boundary and it is open.
- Recommendations: Restrict SELECT on `pathao_integrations`/`stores` to admins (or move secrets to Supabase Vault with edge-function-only getters, as already done for cron tokens in `20260901000000_scheduler_auth_and_courier_tokens.sql`). The new `connectors` table (`supabase/migrations/20260904000100_multi_business_foundation.sql`) is the migration path — ensure its "Members can read" policy does not expose secret columns.

**HIGH — XSS in HTML print builders (no escaping anywhere):**
- Risk: Customer-controlled strings (name, phone, address, notes, custom field labels/values from storefront checkout) are interpolated raw into HTML documents that get opened as popups/iframes. A customer name like `<img src=x onerror=...>` executes in the app's origin via the invoice preview iframe or print popup.
- Files: `src/lib/invoiceHtml.ts` (lines 63, 78–94, 121–122 interpolate `biz.business_name`, `cart.customer.*`, `cart.notes`, `f.label`, `f.value` raw), `src/lib/pickupSlipHtml.ts` (lines 98, 117–130 interpolate `order.customer_name`, `order.customer_address`, `order.special_instruction` raw). Neither file contains an `escapeHtml` helper. `src/lib/barcodeSvg.ts` is numeric-only (safe).
- Current mitigation: None.
- Recommendations: Add one shared `escapeHtml()` in `src/lib/` and wrap every `${}` user-data interpolation in both builders. Small diff, high value.

**MEDIUM — Public checkout has no rate limiting or bot protection:**
- Risk: `storefront-checkout` (`verify_jwt = false`, the only intended public write path besides `woo-webhook`) inserts customers/orders directly. Unlimited automated POSTs can spam orders/COD consignments, inflate `order_number` sequences, and pollute the customers table. Stock is checked but never decremented (see Missing Critical Features), so spam orders don't even consume inventory.
- Files: `supabase/functions/storefront-checkout/index.ts` (full flow: validate → customer upsert → order insert), `supabase/config.toml` lines 11–13.
- Recommendations: Add per-IP/per-phone rate limiting (Supabase edge runtime KV or a small `rate_limit` table), and a duplicate-order guard on (storefront, phone, cart hash, short window).

**MEDIUM — team-manage accepts arbitrary role values and has no last-admin protection:**
- Risk: `update_role`/`create_with_password` insert whatever `role` string the client sends (validated only by the `user_roles.role` column type at DB level — insertion of an invalid value fails late and generically). An admin can demote themselves as the last remaining admin, locking the org out of admin functions. Role checks are global (`user_roles.role = admin`), not business-scoped — fine pre-multi-business, a privilege boundary gap once multiple businesses share one login pool.
- Files: `supabase/functions/team-manage/index.ts` (no whitelist constant; `action === "update_role"` around line 174; `update({ role })` line 178).
- Recommendations: Add a `const ALLOWED_ROLES = ['admin','manager','staff']` guard, a "cannot demote last admin" check, and align with the new `business_members` role model in `supabase/migrations/20260904000100_multi_business_foundation.sql`.

**LOW — Woo webhook signature enforcement is conditional:**
- Risk: HMAC verification only runs when the store row has a `consumer_secret`; a store row created without one accepts unsigned payloads (spoofable order imports).
- Files: `supabase/functions/woo-webhook/index.ts:80-118` (`if (store.consumer_secret) { ...verify... } else { pass }` implied by structure).
- Recommendations: Log loudly and reject unsigned payloads once all stores have credentials; add an alert when a store lacks a secret.

---

## Tech Debt

**TypeScript strictness disabled repo-wide:**
- Issue: `"strict": false`, `"noImplicitAny": false`, `noUnusedLocals/Parameters: false` in `tsconfig.app.json`; `@typescript-eslint/no-unused-vars: off` in `eslint.config.js`.
- Files: `tsconfig.app.json`, `eslint.config.js`
- Impact: 349 explicit `any`/`as any` casts across 62 files in `src/` (worst: `src/components/settings/MeasurementsTab.tsx` 37, `src/components/orders/AddOrderDialog.tsx` 24, `src/components/products/ProductDetailSheet.tsx` 21, `src/pages/Orders.tsx` 20). Type errors in refactors surface at runtime, not compile time.
- Fix approach: Enable `strict` incrementally per directory (Vite builds don't block on it via `vite build` since tsc isn't in the build script — but get `tsc --noEmit` into CI first). Convert hotspots opportunistically; the generated `src/integrations/supabase/types.ts` already provides strong DB types that most `any`s duplicate.

**God components / god functions:**
- Issue: Single files owning entire feature verticals with local state, data fetching, and rendering combined.
- Files: `src/components/orders/OrderDetailSheet.tsx` (2102 lines), `src/components/orders/AddOrderDialog.tsx` (1304), `supabase/functions/pathao-courier/index.ts` (1259 — 11 `case` actions: get_cities, get_zones, get_areas, get_stores, get_price, create_order, create_bulk, track_order, track_all, attach_parcel, delete_courier_entry), `src/pages/Orders.tsx` (932), `src/pages/Dispatch.tsx` (925), `src/components/pos/CartPanel.tsx` (886).
- Impact: High merge-conflict surface, no isolated testability, every tweak re-renders/re-reads the whole file.
- Fix approach: For `pathao-courier`, extract action handlers into modules under `supabase/functions/pathao-courier/actions/` (the `_shared/` + `adapters/` pattern already exists). For the React sheets, extract data hooks into `src/hooks/`.

**Dual/triple lockfiles and mixed package managers:**
- Issue: `bun.lock`, `bun.lockb`, AND `package-lock.json` all tracked; no CI to enforce either.
- Files: `bun.lock`, `bun.lockb`, `package-lock.json`
- Impact: Dependency drift between contributors; nondeterministic installs.
- Fix approach: Pick one (bun, given `bun.lock`), delete the others, and enforce in CI.

**Repo junk committed:**
- Issue: 3.2 MB binary backup zip tracked in git, an architecture doodle, a stray `~/` directory containing `gstack`, and a runnable debug script at root.
- Files: `dokanos_260729.backup.zip` (3.2 MB, tracked), `sync-architecture.html`, `~/gstack`, `test_db.ts` (edge-runtime script taking URL+key as argv — doesn't run under Node, dead weight in a Vite repo)
- Impact: Clone size, confusion, risk of backup zip containing old credentials being shared.
- Fix approach: `git rm` the zip/html/test_db.ts/`~/`; add backup artifacts to `.gitignore`. Inspect the zip for secrets before purging history.

**Planning/ledger documents live at repo root:**
- Issue: `MULTI-BUSINESS-PLAN.md` and `REVAMP-PLAN.md` (long-lived work ledgers) sit at root and drift from reality; `.planning/` also exists.
- Files: `MULTI-BUSINESS-PLAN.md`, `REVAMP-PLAN.md`
- Impact: Two sources of truth for roadmap state.
- Fix approach: Move into `.planning/` or fold into `CHANGELOG.md` once multi-business phases complete.

**Console noise in production code:**
- Issue: 19 `console.log/debug/error/warn` calls in `src/` (15 files), e.g. `src/lib/orderTimeline.ts`, `src/components/orders/OrderDetailSheet.tsx`, `src/hooks/useTheme.tsx`. Edge functions use console intentionally (structured logging) — fine.
- Files: see list above
- Impact: Minor; inconsistent client-side observability.
- Fix approach: Leave errors, strip debug logs; no logger framework needed yet.

**Note on XXX markers:** The 8 grep hits for `XXX` (`src/components/orders/AddOrderDialog.tsx:1119`, `src/storefront/pages/Checkout.tsx:106-121`, etc.) are phone-number placeholder text ("01XXXXXXXXX"), not debt markers. No real TODO/FIXME debt markers exist in tracked source — debt tracking happens via the plan ledgers instead.

---

## Known Bugs

**Storefront checkout never decrements stock:**
- Symptoms: Placing a storefront order checks `stock_quantity < it.quantity` at validation time (`supabase/functions/storefront-checkout/index.ts:71-73`) but no stock update/RPC is ever called on success — inventory does not move.
- Files: `supabase/functions/storefront-checkout/index.ts`
- Trigger: Any managed-stock product sold via a storefront; oversells are possible (two buyers both pass the check) and POS/stock views never reflect the sale.
- Workaround: Manual stock edits in the dashboard; POS orders decrement correctly elsewhere.
- Fix approach: Reuse the same stock-adjustment RPC used by POS order creation inside the checkout function after the order insert, so the existing `auto_push_product_stock` trigger (`supabase/migrations/20260831000500_product_stock_triggers.sql`) pushes the change to Woo automatically.

**Legacy multi-business migrations leave dead schema:**
- Symptoms: `storefront_orders` was referenced in plan documents but no table/policy exists in any migration; `courier_agnostic_core` tables (`courier_shipments`, `courier_integrations`) have grant-based protection but no RLS policies, unlike the older policy-based tables — two protection idioms coexist.
- Files: `supabase/migrations/20260902000000_courier_agnostic_core.sql` (grants only), `supabase/migrations/20260904000100_multi_business_foundation.sql` (policy loops for a specific table list)
- Trigger: N/A — structural.
- Workaround: Grants happen to be tighter than policies here; risk is future contributors "fixing" the inconsistency in the wrong direction (adding `USING (true)` policies).
- Fix approach: Standardize on grants-for-machine-tables (service_role-only) and document the idiom; verify `courier_shipments` SELECT grant to authenticated doesn't leak other tenants' shipment rows once multi-business data lands (it currently has no business_id scoping policy).

---

## Performance Bottlenecks

**Unbounded table reads in core pages:**
- Problem: Orders, Dispatch, Analytics, Dashboard load entire tables with no `.range()`/`.limit()` pagination; Customers uses `.range()` once.
- Files: `src/pages/Orders.tsx` (7 selects, 0 limits), `src/pages/Dispatch.tsx` (8/0), `src/hooks/useDashboardData.ts` (6/0), `src/pages/Analytics.tsx` (4/0), `src/pages/Customers.tsx` (3 selects, 1 range)
- Cause: Supabase JS default fetch-all; fine at hundreds of rows, degrades linearly with order volume.
- Improvement path: Paginate Orders/Dispatch with `.range()` keyed to the existing tab filters, and move dashboard aggregates into SQL views/RPCs (pattern exists: `supabase/migrations/20260904000400_location_stock_aggregate.sql`).

**Sync fan-out scale ceiling (mitigated, documented):**
- Problem: `woo-sync-all` triggers one edge-function invocation per connected store; platform throttle at ~30 invokes/45s.
- Files: `supabase/functions/woo-sync-all/index.ts` (FANOUT_CONCURRENCY=50 pool, skip-if-fresh 10 min, retry/backoff — already implemented)
- Impact: Bounded for now; revisit if store count exceeds ~100.
- Improvement path: Direct in-process sync per store instead of self-invocation, or a queue consumed by one worker.

---

## Fragile Areas

**DokanOS ↔ WooCommerce two-way sync loop:**
- Files: `supabase/functions/woo-sync/index.ts` (953 lines), `supabase/functions/woo-webhook/index.ts` (616), `supabase/functions/woo-push/index.ts` (617), `supabase/migrations/20260831000200_order_push_full_sync.sql` (echo guard via `woo_updated_at` stamping), `supabase/migrations/20260831000500_product_stock_triggers.sql`
- Why fragile: Bidirectional triggers (local change → enqueue push → Woo → webhook → import → skip-if-stamped) — any new write path that forgets to stamp `woo_updated_at` resurrects the echo loop; any new Woo field mirrored locally must be added to importer, pusher, AND the trigger column list in lockstep. Historical bugs (double COD on retry, dropped re-pushes, sale-price round-trip destruction) all lived here.
- Safe modification: Always run both sides (import + push) for a field change; test with the `sync_queue` dead-letter path; never write to `orders`/`products` from edge functions without stamping.
- Test coverage: None on the edge functions (see gaps below); only `src/test/tabFilters.test.ts` covers status mapping adjacency.

**The 134-migration linear chain:**
- Files: `supabase/migrations/` (oldest `20260407071618_*.sql` → newest `20260906000000_courier_shipments_cancelled_at.sql`), including one-off harness migrations (`20260904000300_drop_mb_oracles.sql`, `20260904000600_drop_stock_agg_harness.sql`) and a policy-hardening relay across `20260620172022_*` + `20260623184244_*` + `20260901000000_*`.
- Why fragile: Policies get dropped/recreated across many files; a fresh `supabase db reset` is the only full-schema test, and there is no CI running it.
- Safe modification: After adding any migration, run a full local reset + smoke login before pushing; keep the "enable RLS + grants" idiom per the newest migrations.

**Generated Supabase types:**
- Files: `src/integrations/supabase/types.ts` (3497 lines, auto-generated; `src/integrations/supabase/client.ts` marked "Do not edit")
- Why fragile: Drifts from DB schema until regenerated; hand-edits get overwritten.
- Safe modification: Regenerate via Supabase CLI after every schema migration.

**Multi-business transition (in flight):**
- Files: `supabase/migrations/20260904000100_multi_business_foundation.sql` (brands/locations/connectors + dynamic RLS loop), `src/hooks/useBusinessContext.tsx` (new business/brand context with legacy `invoice_settings` fallback), `MULTI-BUSINESS-PLAN.md` (phase ledger)
- Why fragile: Dual sources of truth — legacy `stores`/`invoice_settings` vs new `businesses`/`brands`/`connectors` — coexist with graceful-fallback UI. Mid-transition edits to either side can strand the other.
- Safe modification: Read both sides through `useBusinessContext` rather than querying legacy tables directly from new code.

---

## Scaling Limits

**RLS policy count and `USING (true)` legacy:**
- Current capacity: ~44 tables with policies; 100 historical `USING (true)`/`WITH CHECK (true)` policy statements across migrations, most superseded by the `20260620172022` hardening.
- Limit: Per-tenant filtering on the old tables is absent — RLS is binary (authenticated or admin), not per-business. The multi-business foundation's `is_business_member(business_id)` loop only covers its 8 new tables + 3 explicit ones.
- Scaling path: Extend the `has_role(...) OR is_business_member(business_id)` pattern (see `supabase/migrations/20260904000100_multi_business_foundation.sql` lines 342–430) to legacy tables (`orders`, `products`, `customers`, `stores`) as data is backfilled with `business_id`.

**Dashboard/page memory at volume:**
- Current capacity: Comfortable to low thousands of orders.
- Limit: Full-table client fetches (see Performance Bottlenecks) — ~50–100k rows will stall the Orders page and dashboard.
- Scaling path: Pagination + aggregate RPCs, before multi-business backfill multiplies row counts.

---

## Dependencies at Risk

**lucide-react ^1.7.0 (pinned unusual major):**
- Risk: Version line diverges from the widely-documented 0.x line; icon renames between majors are common.
- Impact: Tree of ~200+ icon imports across `src/components/`.
- Migration plan: Verify against the installed lockfile before any icon-name refactor; no action needed now.

**jsdom ^20 (dev, vitest environment):**
- Risk: Aging major (current line much newer) with known DOM-compat gaps for newer React 18 features.
- Impact: Only affects `src/test/*` (2 real test files) today.
- Migration plan: Bump alongside vitest when the test suite grows.

**Mixed npm/bun ecosystem:**
- Risk: See Tech Debt — three lockfiles, no enforced manager.
- Impact: `npm install` vs `bun install` produce different resolution trees.
- Migration plan: Standardize on bun; delete `package-lock.json` + `bun.lockb` (legacy binary) and document in README.

---

## Missing Critical Features

**No CI pipeline for quality gates:**
- Problem: `.github/workflows/` contains only cron schedulers (`pathao-tracking.yml`, `sync-worker.yml`, `woo-sync-all.yml`). Nothing runs lint, `tsc --noEmit`, vitest, or a build on push/PR; nothing runs `supabase db reset` against the migration chain.
- Blocks: Confidence that any change (especially migrations) leaves the app and schema deployable.
- Fix approach: One `ci.yml` with `npm/bun install → lint → tsc → vitest run → vite build`, plus a Supabase-local migration-apply job.

**Near-total absence of tests:**
- Problem: 2 real test files (`src/test/tabFilters.test.ts`, `src/test/invoiceHtml.test.ts`) + 1 scaffold (`src/test/example.test.ts`) for ~42k LOC of frontend and ~5.6k LOC of edge functions. A stale worktree copy exists under `.claude/worktrees/print-pipeline-fixes/src/test/` (should be ignored/deleted).
- Blocks: Every sync/permission/checkout change ships unverified.
- Fix approach: Prioritize (1) `_shared/woo-mapping.ts` status/price mapping unit tests, (2) `storefront-checkout` flow test with a mocked supabase client, (3) HTML-builder escaping tests once the XSS fix lands (they double as regression guards).

**Edge-function shared error/logging convention:**
- Problem: Each of the 13 functions hand-rolls CORS headers, auth checks, and error JSON shapes; `get-orders` shows what happens when one is forgotten (see Critical security item).
- Blocks: Safe addition of new functions.
- Fix approach: Extract shared `corsHeaders`, `requireCronOrService(req, sb)`, and `json()` helpers into `supabase/functions/_shared/` (the directory already exists with `woo-mapping.ts`, `courier-adapter.ts`) and route all functions through them.

---

## Test Coverage Gaps

**Edge functions (highest risk):**
- What's not tested: Auth gates, echo-guard stamping, signature verification (`woo-webhook`), stock/idempotency logic (`pathao-courier` create_order skip-if-consignment-exists), queue draining (`sync-worker`).
- Files: `supabase/functions/**` (all 13)
- Risk: Money-path bugs (double COD, missed pushes) regress silently — these bugs existed before per the changelog.
- Priority: High

**Permission model (`src/components/PermissionGuard.tsx`, `src/hooks/usePermissions.tsx`):**
- What's not tested: Route gating per role, custom-role permission resolution (`user_custom_roles`, `user_permissions` tables).
- Files: `src/components/PermissionGuard.tsx`, `src/hooks/usePermissions.tsx`, `src/App.tsx` route table
- Risk: A refactor can silently expose pages to unauthorized roles.
- Priority: High

**HTML print builders:**
- What's not tested: Only positive-path geometry is covered (`src/test/invoiceHtml.test.ts`); no test asserts escaping of hostile customer strings.
- Files: `src/lib/invoiceHtml.ts`, `src/lib/pickupSlipHtml.ts`
- Risk: XSS regression goes unnoticed.
- Priority: Medium (becomes High once the escaping fix lands — add the test in the same diff)

**Sync mapping (`supabase/functions/_shared/woo-mapping.ts`):**
- What's not tested: Woo status → DokanOS status/payment-status mapping is only exercised indirectly via `src/test/tabFilters.test.ts` (which tests the local filter side, not the mapping module itself).
- Files: `supabase/functions/_shared/woo-mapping.ts`
- Risk: A Woo API status rename silently drops orders into unknown state.
- Priority: Medium

**POS money math (cart totals, exchanges, returns):**
- What's not tested: `src/components/pos/CartPanel.tsx` (886 lines) totals, `src/components/orders/ExchangeDialog.tsx` (618) exchange deltas, POS returns flow.
- Files: see above
- Risk: Rounding/discount regressions hit revenue directly.
- Priority: Medium

---

*Concerns audit: 2026-09-09*
