# SIGNUP-DISCOVERY — Task 0.1 + 0.2 deliverable (execution started)

> Feeds SIGNUP-PLAN.md §1 (replaces ASSUMED items) and gates Tasks 1.1+.
> Method: direct migration/source reads (156 migrations, src/, node_modules/@supabase/auth-js types).

## 1. Table inventory — hard-required columns (no default) per provisioning target

| Table | HARD REQUIRED (must supply in INSERT) | DEFAULTED (safe to omit) | UNIQUE constraints |
|---|---|---|---|
| `businesses` | name, slug | currency, timezone, is_active(true), created_at, updated_at | slug UNIQUE |
| `brands` | business_id, name, slug | is_active, timestamps | slug UNIQUE + (business_id, name) |
| `locations` | business_id, name | type (has default), is_default, is_active, timestamps | — |
| `stores` | name, url | id, created_at, updated_at, sync_failures, status('disconnected' per r2/r6 verification) | — |
| `storefronts` | name, store_id, slug | accent/theme/social/policies/currency/nav/settings/is_active, timestamps | slug UNIQUE (r4-verified) |
| `connectors` | business_id, name | category, status, config, is_active, timestamps | idx(category,type) — non-unique index |
| `selling_points` | business_id, brand_id, name, type | is_active, is_default, config, timestamps | idx only |
| `product_sources` | business_id, name, type | status, sync_direction, is_active, timestamps | idx(business_id) |
| `customer_sources` | business_id, name, type | status, config, sync_direction, is_active, timestamps | idx(business_id) |
| `user_store_access` | user_id, store_id | created_at | UNIQUE(user_id, store_id) |
| `user_permissions` | user_id, permission (app_permission) | created_at | **UNIQUE(user_id, permission)** → `ON CONFLICT DO NOTHING` idempotent re-grant confirmed (r14) |
| `invitations` | email | role, created_at | no UNIQUE(email) — synthetic audit rows safe (r12) |
| `profiles` | (user_id via trigger w/ CASCADE) | — | — |

## 2. Permission system (Task 0.2 decision record)

**`app_permission` enum (30 values, 20260420112330):**
dashboard.view, orders.view, orders.create, orders.edit, orders.delete, orders.change_status, orders.dispatch, orders.refund, orders.log_payment, orders.discount_large, preorders.view, preorders.manage, customers.view, customers.edit, customers.delete, products.view, products.create, products.edit, products.delete, products.view_cost, products.edit_cost, pos.use, pos.discount_large, pos.refund, pos.shift_close, analytics.view, analytics.view_revenue, integrations.view, integrations.manage, stores.view, stores.manage, settings.view, settings.manage, team.view, team.manage, audit.view.

**Keys used by UI (`permission=` props, 10):** analytics.view, customers.view, dashboard.view, integrations.view, orders.view, pos.use, products.view, settings.view, storefronts.view, team.view.

**Policy-referenced permission keys (global-scope RLS):** `settings.manage` — VERIFIED called by app_settings policies (20260911000400:20/24/26; `has_permission` REVOKE PUBLIC + GRANT authenticated at :11–12). (An earlier scripted grep missed this due to the `'...'::app_permission` cast; direct read settles it.)

**DECISION (Task 0.2) — owner bundle = these 31 global `user_permissions` rows (idempotent, ON CONFLICT DO NOTHING):**
dashboard.view, orders.view, orders.create, orders.edit, orders.delete, orders.change_status, orders.dispatch, orders.refund, orders.log_payment, orders.discount_large, preorders.view, preorders.manage, customers.view, customers.edit, customers.delete, products.view, products.create, products.edit, products.delete, products.view_cost, products.edit_cost, pos.use, pos.discount_large, pos.refund, pos.shift_close, analytics.view, analytics.view_revenue, integrations.view, stores.view, settings.view, team.view, audit.view.

**EXCLUDED from the owner bundle (and why):**
- `settings.manage` — verified global-scope policy key (would grant platform settings writes).
- `integrations.manage`, `stores.manage` — platform-level powers, not business-scoped.
- `team.manage` — the invite power; legacy invites mint GLOBAL `staff` roles. Self-serve owners must not mint platform-wide staff (plan constraint: never global roles from the self-serve path). Business-local member management via UBA (`set_member_business_role`) is the v2 direction; the `/welcome` "invite" nudge is amended accordingly (MFA + publish nudge instead).

**Plus per-store access:** exactly 1 `user_store_access` row (the provisioned store) — full store access via the access row; fail-open zero-rows semantics mitigated by the post-insert assertion + Task 1.6b policies.

## 3. EXISTING multi-business machinery (major find — §3.2 reshaped around it)

The "Multi-business restructure Phase 1" is **already built and live**:
- **`src/hooks/useBusinessContext.tsx` (179 lines)** — `BusinessContextProvider`: `active`, `businesses`, `brands`, `activeBrand`, `myRole`, `setActive`, `setActiveBrand`, `refresh`. Persists `dokanos-active-business-id` (+ per-business brand key). Reads own `user_business_access` rows joined to `businesses` (RLS own-rows — verified intact in r14). Graceful fresh-install fallback (empty list → legacy `invoice_settings` profiles).
- **Sidebar switcher is LIVE** (`AppSidebar.tsx:92–105`): top-left; prefers real businesses over legacy profiles; same UI shape (name + logo + switcher). **User ask #1 (see active business + switch) is already delivered by existing code.**
- **`BusinessAccountTab.tsx` → `CreateBusinessForm` (fresh-install path)**: calls `create_business_with_owner` RPC directly from the client (name+slug; handles 23505/42501); fresh-install only (zero businesses); platform-admin gated (42501). **Businesses created this way get business+UBA ONLY — no brand/location/store/storefront/parity rows.**
- **`src/lib/slug.ts`** — `slugify()`: lowercase/hyphenated, truncates to 48 chars (fits the RPC's 2–60 rule). Reuse; keep the `store-<4 random>` fallback for empty results.
- `BusinessProfileTab` — legacy profile tab alongside.

**Remaining REAL work for the user's ask:**
1. `create_additional_business` RPC (non-admin gates: confirmed + ≥1 UBA row) with the FULL provisioning transaction body (business+brand+location+store+storefront(inactive)+parity rows+UBA('owner')+bundle+store-access row) — the existing fresh-install path is minimal and admin-gated; noted divergence (existing admin path unchanged).
2. `create-business` edge fn (verify_jwt, kill switch, own-Turnstile, rate caps) — the existing form calls the RPC directly with no captcha; acceptable for platform admins (trusted), not for self-serve owners.
3. Switcher wiring: "Create new business" action reachable for existing members + role badges (expose `rolesByBusiness` from context) + storefront-admin switching behavior.

## 4. `stores` consumers (21 files; §10.11 guard targets)

Filtered (status/business filter present — likely safe): StoreHealthGrid, GlobalSyncIndicator, CategoriesTab, ProductDetailSheet(2), ProductList(2), Integrations(3), StoresHub.
**Unfiltered (guard/waiver needed):** PathaoStoreLinks, WooCommerceDetail, AddOrderDialog, MeasurementsTab, PreOrderCategoriesDialog, PreOrdersSettingsTab, storefront-admin/shared, UserAccessDialog, **useStoresList** (drives store pickers), **Customers(2)**, **Orders**, **POS**, PosReports, **StorefrontsPage** (maybeSingle over whole set).

## 5. Task 1.6a join inventory (RLS policy matrix inputs)

- Operational tables carry nullable `store_id … ON DELETE SET NULL`; leaf tables (order_items, order_payments, order_timeline, product_variations) have no store_id (parent-join scoping; parent-FK indexes to verify).
- Store→business link = `brands.woo_store_id` (nullable, NON-unique) → 1.6a decides UNIQUE-partial index; alternative assert path via transaction-owned selling_points storefront link.
- `has_role(auth.uid…)` appears **217×** in migrations — confirms Task 1.6's ~8-day estimate.
- `businesses.is_active` DEFAULT true — business active from birth; storefront starts `is_active=false` per plan.

## 6. Auth-user fields (auth-js types verified)

`invited_at` ✓, `last_sign_in_at` ✓, `email_confirmed_at` ✓, `app_metadata.provider` ✓ — all present in `@supabase/auth-js` `User` type; GoTrue semantics verified in critique rounds 5–8.

## 7. Still unverifiable statically

- Repeat-signup metadata-overwrite behavior (pinned GoTrue version behavior) — **no longer gate-critical** (nonce rides the provision request body). Staging test in §10.8 covers it incidentally.
- Deployed GoTrue version's exact `/invite` + `/resend` semantics — staging smoke (§10.5/§10.6).

## 8. Execution status (Tasks 0.1–1.2)

- **Task 0.1 — DONE.** This document.
- **Task 0.2 — DONE.** §2 decision record (31-key bundle + 4 exclusions).
- **Task 1.1 — DONE + VERIFIED.** `supabase/migrations/20260925120000_signup_support_tables.sql` (5 tables, RLS, seeds with `signup_open=false`, `get_my_businesses()`, `verify_signup_tables()`). Applied against the real `supabase/postgres:17.6.1.147` image with full Supabase schemas; verify returns `{"seeds":5,"status":"ok","tables":5,"rls_enabled":true,"get_my_businesses":true}`.
- **Task 1.2 — DONE + VERIFIED.** `supabase/migrations/20260925120100_signup_provision_fns.sql` (trigger patch, `canonical_email`, `signup_create_business_core`, `provision_owner_business`, `create_additional_business`, `get_auth_signup_state`, `verify_signup_fns()`). Verify returns `{"fns":5,"status":"ok","trigger_patched":true}`.
- **Verification method**: the CLI's `supabase start`/`db reset` path **segfaults on this machine's fresh WSL2** (exit 139; culprit container isolated to `storage-api` + the CLI's init runner; independent of the migrations). Worked around by bootstrapping a manual Postgres container on the project's volume: postgres image init → storage-api migrations (extracted from `storage-api:v1.67.15`, 60 files; one grant statement patched for the image-bootstrap cycle) → GoTrue migrations (rendered from `gotrue:v2.194.0` templates, 70 files) → **all 157 project migrations in order, zero failures**.
- **Caveat**: this proves migration correctness, not CLI parity. `npm run test:rls` (CLI-driven) remains blocked until the WSL2/Docker storage-api segfault is resolved; the manual container serves as the working DB in the meantime.

## 9. Bootstrap recipe (repeatable, `.tmp/bootstrap-full.ps1`)

Clean-slate order that produced SUCCESS (157/157 + both verify fns):
1. `docker rm -f sbdb` + `docker volume rm supabase_db_jiwndicvfkiltgageqwv`
2. `docker run` postgres image with the volume + read-only mounts of `supabase/migrations`, `.tmp/storagemig`, `.tmp/authmig-rendered`
3. Wait for `init process complete`
4. `search_path=storage` ← apply `storagemig/vector_store/0001-init.sql`, then tenant migrations in **numeric** order (60 files)
5. Apply `authmig-rendered/*.up.sql` as `supabase_auth_admin` over TCP (70 files)
6. Apply project migrations in filename order with `search_path=public,storage,auth` (157 files) — **`public` must be first**, or unqualified `CREATE FUNCTION` lands in the wrong schema
7. `SELECT public.verify_signup_tables()` / `verify_signup_fns()`

- Repeat-signup metadata-overwrite behavior (pinned GoTrue version behavior) — **no longer gate-critical** (nonce rides the provision request body). Staging test in §10.8 covers it incidentally.
- Deployed GoTrue version's exact `/invite` + `/resend` semantics — staging smoke (§10.5/§10.6).
