# Storefront P0 Implementation Plan — V7

**Source:** STOREFRONT-AUDIT.md (2026-09-09) · **Revision:** Cycle 7 — resolves both cycle-6 findings (M14 — each surviving §9.1 pathao re-create guarded by a preceding `DROP POLICY IF EXISTS` (the §4.1 idiom), so `checkout_atomic_idempotency.sql` applies on a fresh `db reset` and re-runs instead of erroring `policy … already exists` on the names `20260412170009`'s own tail created; M15 — the `"Anyone can read pathao_stores"` re-create deleted, preserving `20260620172022`'s deliberate "pathao_stores: remove public read" tightening, with the §9.6/§10.1 assertions and fact 6 / §10.3 / §14.5 aligned to the amended scope) from STOREFRONT-PLAN-V6-CRITIQUE.md, retaining every cycle-1/2/3/4/5/6 resolution · **Executor:** 1 senior full-stack dev · **Estimate:** 44.5–59.5 workdays ≈ **8.9–11.9 weeks** — the exact sequential single-dev sum of the phase efforts (§3; M11 discipline retained)
**Status:** Covers audit P0 items 1–6 only (see §12 Out of scope). V1 (STOREFRONT-PLAN-V1.md), V2 (STOREFRONT-PLAN-V2.md), V3 (STOREFRONT-PLAN-V3.md), V4 (STOREFRONT-PLAN-V4.md), V5 (STOREFRONT-PLAN-V5.md), and V6 (STOREFRONT-PLAN-V6.md) are retained for the audit trail.

---

## 1. Goal statement

**The storefronts deliverable after this plan executes:** a merchant can ship a real online store from DokanOS — homepage and content pages composed in an admin editor (sections, draft/publish, live preview), browsable collections, size/color variant purchasing end-to-end (product page → cart → checkout → `order_items`), per-page SEO (meta/OG/canonical, sitemap.xml, robots.txt, JSON-LD, stable product URLs), checkout behavior controlled by a per-storefront settings object, an oversell-safe, double-click-safe checkout (atomic place-order RPC + idempotency key), a working Track page behind phone verification — **and anonymous REST access to every anon-`FOR ALL` policy of the failed `20260412170009` drop closed for good — all ten tables across four migrations (fact 6): the orders family's PII read hole plus the anon-writable `products`/`stores`/`categories`/`product_categories` survivors of the same failed drop, plus the never-ran pathao tighten (H1, completed by H5/H7)**.

Mapped to audit P0: §4.1 (builder) → Phase 1, §4.2 (collections) → Phase 2, §4.3 (variations) → Phase 3, §4.4 (SEO) → Phase 4, §4.5 (settings) → Phase 5, §4.6 (stock/idempotency) + §2.9.1/§2.9.3 → Phase 6.

**Non-goal guardrail:** we do NOT fork the POS pipeline. Storefront orders keep writing to the same `orders`/`order_items`/`order_timeline` tables via the `storefront-checkout` edge function (its write path moves into an atomic RPC in Phase 6, same tables).

---

## 2. Grounding facts (re-verified across cycles 1–6; corrections marked)

These constrain the design. Cycle-6 corrections supersede earlier versions where they conflict.

1. **`products.stock_quantity` is an aggregate.** `sync_product_stock_from_locations` (`20260904000400`) recomputes `products.stock_quantity = SUM(product_locations.stock_quantity)` on every locations write, **summing ALL rows for the product_id — parent rows (`variation_id IS NULL`) AND variation rows together**. A direct `products.stock_quantity` write is overwritten by the next locations write. **[M13] Consequence, now explicit: for any product that HAS location rows, a decrement must land IN those rows — a products-direct decrement on such a product is erased by the next recompute, silently resurrecting the sold qty and reopening the oversell window (§9.1 step 3).**
2. **Woo stock-push triggers exist.** `trg_auto_push_product_stock` / `trg_auto_push_variation_stock` (`20260831000500`) enqueue `sync_queue` rows (`push_stock`, `idempotency_key LIKE 'stock:%'`, `ON CONFLICT (idempotency_key) DO NOTHING`) guarded by `woo_updated_at` echo checks. Storefront decrements propagate to Woo; the `ON CONFLICT` dedup means tests must assert "a stock-push row exists per affected product/variation", not exactly-N rows. **The same triggers fire on restore-path increments (M10 — acknowledged in §9.1).**
3. **`order_items` has no `variation_id` column** (DDL `20260407071618`). POS passes variations via `product_name` string concat (`"${name} - ${variationLabel}"`, `AddOrderDialog.tsx:844`). We add a real column, keep the label-in-name convention.
4. **`cart.ts` already carries `variation_id?`/`variation_label?`** — declared, never populated; merges by `(product_id, variation_id)`. Additive only.
5. **Variation attribute parsing exists in 3 places** (`AddOrderDialog.tsx:96`, `pos/VariationModal.tsx:24`, `MeasurementSlipPrint.tsx`). Extract one shared helper.
6. **[H5] The anon `FOR ALL` batch is ALIVE in the live DB — on ALL TEN tables it covered, created by FOUR migrations.** `20260407074308` created `FOR ALL TO anon USING(true) WITH CHECK(true)` policies on **orders, order_items, customers, products, stores — exactly five** (verified by file scan; the file never mentions order_payments/order_timeline/product_variations). The same-shaped anon `FOR ALL` policies on the other five tables came from three more migrations: **`20260407150827`** (order_timeline, order_payments), **`20260408191701`** (product_variations), **`20260408205133`** (categories, product_categories) — **[H7, correcting V5's "all eight from `20260407074308` itself" attribution]**. `20260412170009` attempted to drop **all TEN** anon policies — plus dropping the four `pathao_*` `FOR ALL TO public` policies and re-creating them SELECT-only for anon with authenticated manage — but live-DB ground truth (orchestrator-verified, cycle 1): **orders anon access is OPEN** — Track.tsx works today *and* every order (name, phone, address, totals) is enumerable by order number via anon REST. The assume-the-siblings-survived logic therefore extends to the **full set**: if the `products`/`stores` `FOR ALL` policies survived the same failed drop, anon REST can **write** product rows (price tampering, deletion) and stores rows — a strictly larger hole than the orders-family read leak; the same shape on `categories`/`product_categories` additionally lets anon REST create/rename/delete category rows and rewrite product↔category mappings (read throughout POS/admin: AppSidebar, POS, CategoriesTab, Orders, measurements, preOrderSettings); and under the plan's own rollback premise the pathao tighten never ran either, leaving pathao_* publicly writable until Phase 6 re-runs it as amended by `20260620172022` (M15 — `pathao_stores`' public read is NOT restored; §9.1). (Counter-evidence, noted for fairness: the intentional SELECT-only products policy `20260619164824` suggests the products drop may have succeeded — but a P0 security closure must not rest on inference.) Phase 6 re-runs **all ten anon drops + the pathao tighten as amended by `20260620172022` (M15)** idempotently (§9.1) — the plan's **deliberate exception #1** to expand-only (§10.3). The differently-named `20260619164824` SELECT policy survives.
7. **`orders.source` CHECK is GONE; `'online'` is ambiguous.** The CHECK `source IN ('online','pos')` (`20260407071618:83`) was **dropped** by `20260415171221` (no re-add found in any migration). The checkout fn writes `source:"online"` (`storefront-checkout/index.ts:122`) — but so does Woo sync (`woo-sync/index.ts:653`), and `SourceBadge` renders `'online'` as "WooCommerce". Therefore `source` cannot discriminate storefront orders; Phase 6 adds a nullable **`orders.storefront_id`** marker instead.
8. **Storefront RLS is role-based, not business-scoped** (`20260516201928`): public SELECT gated on `is_active`, writes via `has_role(auth.uid(),'staff'|'admin')`. New storefront tables follow this pattern. Business-scoping retrofit is audit P2 #19 — out of scope (§12).
9. **`storefront_pages` ALREADY EXISTS** (`20260516201928` §5): columns `(id, storefront_id, slug, title, body_md, is_active, created_at, updated_at)`, `UNIQUE(storefront_id, slug)`, public SELECT policy `is_active = true OR has_role(...)`, staff/admin writes. It is a **dead table** — zero app/runtime references (only generated types). Phase 1 EXPANDS this table (add columns, tighten the public policy), it does not CREATE it. A `CREATE TABLE storefront_pages` migration would fail on deploy. **[N1, correcting V4's false M12 amendment] `20260516201928` lines 153–155 ALREADY establish `update_storefront_pages_updated_at` — `BEFORE UPDATE ON public.storefront_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` (which sets `NEW.updated_at = now()`, defined in `20260407071618`); no migration drops it. Page-level `updated_at` was therefore never insert-frozen. The [M12] gap was real ONLY for the new `storefront_page_sections` table, which Phase 1 creates and where Phase 1 adds the trigger (§4.1).**
10. **`storefront_collections` + junction `storefront_collection_products` fully exist** with RLS (public read, staff/admin write; junction `product_id` has NO FK; `(collection_id, product_id)` UNIQUE). **[N2, correcting V4's false L9 amendment] The `position` columns DO exist on BOTH tables — `20260516201928` defines `position integer NOT NULL DEFAULT 0` on `storefront_collections` (line 85) and on the junction (line 112); no migration drops either.** No app/runtime code has ever read or written them (only generated types mention them), so live rows are almost certainly all at the default 0. Phase 2's migration therefore adds NO columns — it creates the ordering index and runs a **non-destructive backfill that only renumbers rows still at the default (`position = 0`)**, preserving any curated positions from the reorder UI (§5.2); the verify file records the live pre-flight answer as confirmation, not discovery. Phase 2 still needs zero new tables and zero new columns.
11. **Storefront runtime is anon-key** (`lib/catalog.ts`, `lib/brand.ts`); anon SELECT on `products` exists via `20260619164824` (`is_active=true`). No equivalent anon policy on `product_variations` exists in migrations — Phase 3 adds one (needed; the fn is the only current variation reader), **gated on `EXISTS (products … is_active)` to match the `20260619164824` precedent (L7)** — a bare `USING (true)` would expose variation rows (including price) of inactive/draft products via direct REST.
12. **`invoice_settings` is anon-denied.** RLS enabled (`20260412172337`) with authenticated-SELECT + admin-manage policies only. Shipping rate columns `shipping_inside_dhaka` / `shipping_outside_dhaka` (defaults 80/150) were added by `20260429001709`. The checkout fn (service role) reads them (`index.ts:83-85`); the anon storefront client cannot — which is why `Checkout.tsx` hard-codes 80/150.
13. **Three `stock_status` vocabularies.** `product_variations.stock_status` / `products.stock_status` default `'in_stock'` (DokanOS style, `20260408191701`); `product_locations.stock_status` CHECKs `'instock'/'outofstock'/'onbackorder'` (Woo style, `20260904000100`). Storefront availability must NOT gate on `stock_status` — gate on `manage_stock && stock_quantity` only.
14. **`product_locations.variation_id` is nullable, NULL-keyed for parent rows.** The unique index expression COALESCEs to a zero-uuid, but no sentinel value is ever written — rows on disk are NULL. Decrement predicates must use `variation_id IS NULL` / `variation_id = :v`, never a zero-uuid match.
15. **The `/storefronts` admin route has NO PermissionGuard** (`App.tsx:102` — every neighbor route has one; storefronts is the bare exception). The `app_permission` enum (verified full list: dashboard/orders/preorders/customers/products/pos/analytics/integrations/stores/settings/team/audit + `orders.attach_courier`) has **no `storefronts.view` value** — it must be added.
16. **The storefront product route is `/product/:slug`** (`StorefrontApp.tsx:34`), not `/products/:slug`. Sitemap/canonical/links must be built from a single route-helper module.
17. **Product slugs are read-time** (`slugify(name)+id.slice(0,6)`, `lib/catalog.ts:19-26`), no `products.slug` column.
18. **`storefront-checkout`** (161 lines, CORS `*`): validates price/stock from `products` only, computes shipping from `invoice_settings`, upserts `customers` (`source:'online'`), calls `generate_pos_order_number` (`p_source:'online'`), inserts `orders` (`source:'online'`, status pending) + `order_items` + `order_timeline`. No decrement, no idempotency. `generate-storefront-content` checks admin role (verified) — no fix needed.
19. **V1's sequencing self-contradiction is resolved:** single-dev order is pinned to **1 → 2 → 3 → 5 → 6 → 4** (§11); the "5 before 6" rationale and the ordering now agree.
20. **Repo conventions:** timestamp-named SQL migrations incl. `verify_*` assertion files; vitest (`npm run test`), eslint (`npm run lint`); no `typecheck` script (add one in Phase 1); `@playwright/test` present, no e2e suite — verification is unit + scripted + manual-checklist. `vercel.json` currently holds a single catch-all rewrite (`/(.*) → /index.html`); `public/robots.txt` is static, allow-all. **[L5] PG15 enum nuance:** `ALTER TYPE … ADD VALUE` is allowed inside a transaction (PG12+), but **comparing the new value in the same transaction** (equality, range, array containment) raises `unsafe use of new value` — the permission grant is therefore split across two migrations (§4.1).
21. **[L8] `orders.order_number` uniqueness is UNESTABLISHED.** No migration in the repo creates a unique constraint or index on `orders.order_number`, and no prior-cycle fact ever asserted one. Order numbers are business identifiers minted by `generate_pos_order_number` — they *should* be unique, but nothing enforces it. Consequences: (a) the M7 handler's motivating case — an order_number collision under different idempotency keys — cannot currently raise 23505 at all; a colliding insert commits silently and duplicate order numbers are created; (b) the M7 scripted probe (§9.6) is unbuildable without a constraint to collide. Phase 6 therefore adds `uq_orders_order_number`, self-guarded by a duplicate pre-check that halts loudly (§9.1) — never silently weakened to a partial index.
22. **[H6] PG EXECUTE semantics for SECURITY DEFINER functions:** `service_role` bypasses **RLS, not EXECUTE privileges**. A SECURITY DEFINER function still requires the *calling* role to hold EXECUTE at call time; Supabase's `service_role` is not the function owner and holds no default EXECUTE grant on newly created functions once `REVOKE FROM PUBLIC` has run. New RPCs therefore carry explicit `GRANT EXECUTE … TO service_role` after their REVOKEs (§9.1), and the admin app never calls either RPC directly — all RPC invocation goes through service-role edge fns (§9.3).

---

## 3. Phase overview

| # | Phase | Audit P0 | Effort | New/changed DB objects |
|---|---|---|---|---|
| 1 | Section-based page builder | #1 | 4–5 wk | expand existing `storefront_pages`; NEW `storefront_page_sections`; **`set_updated_at()` BEFORE UPDATE triggers on both page tables (M12 — the pages one a harmless duplicate of the pre-existing `20260516201928` bump, N1)**; `storefronts.nav`; enum value `storefronts.view` + system-role grant in **two separate migrations (L5)** |
| 2 | Collections wired up | #2 | 3.5–5.5 d | **one index + non-destructive default-only junction backfill (`position` columns already exist since `20260516201928` — N2)** — zero new tables, zero new columns; `src/storefront/lib/routes.ts` hoisted here from Phase 4 (L4) |
| 3 | Product variations end-to-end | #3 | 1–1.5 wk | `order_items.variation_id`; anon SELECT policy on `product_variations` — **active-product-gated (L7)** |
| 4 | SEO foundation | #4 | 5–7 d | `products.slug` (+ trigger + backfill + unique index); fns `storefront-sitemap`, `storefront-robots` |
| 5 | Storefront settings object | #5 | 3.5–5 d | `storefronts.settings`; fn `storefront-shipping-quote` |
| 6 | Atomic checkout, idempotency, Track, PII closure | #6 + §2.9.1/2.9.3 | 7.5–9.5 d | `orders.idempotency_key`, `orders.storefront_id`, `orders.stock_restored_at`, **`uq_orders_order_number` (L8)**, `order_items.stock_ledger` (M10); RPCs `storefront_place_order`, `storefront_restore_stock` — **EXECUTE granted to `service_role` only (H6)**; fns `storefront-track-order`, **`storefront-restore-stock` (H6)**; **DROP anon FOR ALL policies on all ten tables of the failed `20260412170009` drop — the four-migration anon batch (fact 6): orders family + products + stores + categories + product_categories — plus the pathao_* tighten (H5/H7)** |

**Single-dev sequential sum (M11 discipline):** 44.5–59.5 workdays = **8.9–11.9 weeks** at 5 d/wk (P1 20–25 d + P2 3.5–5.5 d + P3 5–7.5 d + P4 5–7 d + P5 3.5–5 d + P6 7.5–9.5 d). No overlap is claimed for the single-dev order; the two-dev split in §11 is where overlap lives.

Critical path: **Phase 1** (pages/sections substrate). Phases 2+3 independent; 5 before 6 (checkout write path extracted once, with settings already honored); 6 after 3 (RPC consumes `variation_id`); 4 last (sitemap needs pages + collections + stable slugs). Single-dev order: **1 → 2 → 3 → 5 → 6 → 4** (§11). The route helper ships in Phase 2 (its first consumer) and Phase 4 adopts it everywhere (L4).

---

## 4. Phase 1 — Section-based page builder

**Goal:** Pages and homepage are data (rows + sections), edited in the admin with a per-section prop form, reorder/hide, live draft preview, publish action, behind a real permission gate. Existing storefronts render unchanged until an operator publishes a home page.

### 4.1 DB (two migrations + verify: `storefront_page_builder.sql`, `storefront_permission_grants.sql`, `verify_storefront_page_builder.sql`)

**Expand the EXISTING `storefront_pages` table (fact 9) — do not CREATE it:**

```sql
ALTER TABLE public.storefront_pages
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'custom'
    CHECK (type IN ('home','custom')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published')),
  ADD COLUMN IF NOT EXISTS seo jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {title, description, og_image_url}
  ADD COLUMN IF NOT EXISTS published_snapshot jsonb,                   -- [{type,position,is_visible,props}]; NULL while draft-only
  ADD COLUMN IF NOT EXISTS published_at timestamptz;
-- body_md / is_active remain (legacy columns, unused by v1 code)
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_pages_one_home   -- L10
  ON public.storefront_pages(storefront_id) WHERE type = 'home';

CREATE TABLE IF NOT EXISTS public.storefront_page_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.storefront_pages(id) ON DELETE CASCADE,
  type text NOT NULL,                        -- validated against registry in app code
  position integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_sections_page ON public.storefront_page_sections(page_id, position);   -- L10

-- M12: the updated_at auto-update mechanism. Without this, updated_at keeps its
-- insert-time value forever, the WHERE updated_at = <base> save predicate (§4.4)
-- always matches, and clobber detection can never fire (cycle-3 finding).
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_storefront_page_sections_set_updated_at
  ON public.storefront_page_sections;
CREATE TRIGGER trg_storefront_page_sections_set_updated_at
  BEFORE UPDATE ON public.storefront_page_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
-- storefront_pages pre-exists (fact 9) and ALREADY has a BEFORE UPDATE bump —
-- update_storefront_pages_updated_at (20260516201928 lines 153–155, executing
-- update_updated_at_column from 20260407071618) — so page-level clobber
-- detection was already functional pre-plan (N1). Creating our own (duplicate)
-- pages trigger is harmless — both set now(), transaction-stable — but
-- unnecessary; the DROP IF EXISTS of OUR OWN trigger name + re-CREATE is kept
-- purely as the standard migration idempotency idiom on a self-owned object
-- (not a policy drop; not an exception to expand-only). The verify file records
-- the pre-existing trigger's presence.
DROP TRIGGER IF EXISTS trg_storefront_pages_set_updated_at ON public.storefront_pages;
CREATE TRIGGER trg_storefront_pages_set_updated_at
  BEFORE UPDATE ON public.storefront_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.storefronts ADD COLUMN IF NOT EXISTS nav jsonb NOT NULL DEFAULT '[]'::jsonb;
```

**RLS:**
- `storefront_page_sections` — **staff/admin only** (H4). `TO authenticated` policies using `has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')` for SELECT/INSERT/UPDATE/DELETE. **NO anon/public policy at all.** The runtime reads published content from `published_snapshot` jsonb on the `storefront_pages` row — anon never needs the sections table; the working copy (draft edits of a published page) must not be anon-readable.
- `storefront_pages` — **tighten the existing public policy** (H4 extension; deliberate exception #2, §10.3): DROP `Public can read storefront_pages`, CREATE `Public can read published storefront pages` `FOR SELECT TO anon, authenticated USING (status = 'published' AND EXISTS (SELECT 1 FROM public.storefronts s WHERE s.id = storefront_id AND s.is_active))`. Staff keep full access via a `TO authenticated` has_role policy (the old policy's `OR has_role(...)` arm is replaced by explicit staff policies). The old `is_active = true OR ...` policy would leak drafts (every new page defaults `is_active=true, status='draft'`). Table is dead in code (verified) — the tighten is safe.
- `storefronts.nav` — covered by existing `storefronts` policies.

**Permission enum (M3) — split across the two migrations (L5).** PG12+ permits `ALTER TYPE … ADD VALUE` inside a transaction, but any same-transaction **comparison** of the new value (equality, range, array containment) raises `unsafe use of new value`. The ADD VALUE and the grant stay in separate migrations so the idempotency guard is legal:

```sql
-- Migration 1: storefront_page_builder.sql (schema above, plus:)
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'storefronts.view';
-- ADD VALUE only; the new value is NOT compared anywhere in this migration.
```

```sql
-- Migration 2: storefront_permission_grants.sql (separate transaction; may compare freely)
UPDATE public.role_permissions SET permissions = array_append(permissions, 'storefronts.view')
WHERE is_system = true
  AND permissions @> ARRAY['stores.view']::app_permission[]
  AND NOT permissions @> ARRAY['storefronts.view']::app_permission[];
```

(Admins get every enum value automatically via `get_user_permissions` → `enum_range`; the UPDATE grants it to system roles that already manage stores. Both migrations re-run safely — migration 1's CREATE TABLE/INDEX/UNIQUE INDEX statements all carry IF NOT EXISTS [L10].)

**Backfill (migration 1):** for every storefront insert `ON CONFLICT (storefront_id, slug) DO NOTHING` (guards pre-existing rows in the dead table):
- `home` page (type home, draft): `hero` section (props from `hero_title`/`hero_subtitle`/`hero_image_url`), `featured-products` (title "Featured", limit 8).
- `about` page (draft, one `rich-text` from `about_md`), `policies` page (draft, `rich-text` sections from `policies` jsonb).
- `nav` default `[Shop /shop, About /about, Track /track, Contact /contact]` (matches today's hard-coded nav).

Nothing auto-publishes. Runtime keeps legacy components for storefronts without a published page → **zero visual change on deploy**.

### 4.2 Section component registry (v1: 9 types)

- `src/storefront/sections/registry.ts` — `{ [type]: { component, defaultProps, validate(props): string[], adminFields: FieldDef[] } }`; `adminFields` is a declarative form schema (text/textarea/number/toggle/select/strings-list/image-url/list-of-objects) so ONE generic prop-form serves all types. `validate` runs on admin save; renderer is defensively no-op-safe.
- `src/storefront/sections/{Hero,FeaturedProducts,ProductGrid,CollectionGrid,RichText,ImageBanner,Gallery,Testimonials,Faq}.tsx`
- `src/storefront/sections/SectionRenderer.tsx` — switch on type; unknown type/bad props → render nothing (forward-compat, logged).

Props contracts (validated in app code; `props` stays free-form jsonb):

| type | props |
|---|---|
| `hero` | `title, subtitle, image_url, cta_label?, cta_href?, align(left\|center), overlay(0–100)` |
| `featured-products` | `title, limit(1–12, def 8), columns(2–4, def 4)` |
| `product-grid` | `title, product_ids: uuid[], columns` |
| `collection-grid` | `title, collection_ids: uuid[], columns` — renders empty state until Phase 2 |
| `rich-text` | `title?, markdown` (reuse `lib/md.tsx`) |
| `image-banner` | `image_url, href?, height(s\|m\|l), overlay` |
| `gallery` | `title?, images: [{url, alt?}]` |
| `testimonials` | `title?, items: [{quote, author, role?}]` |
| `faq` | `title?, items: [{q, a}]` |

Audit P0 #1 also names `contact-form` and `newsletter` — deferred **with rationale in §12** (M6), not silently dropped. The registry doc lists them as "deferred types" for discoverability.

### 4.3 Runtime

- `src/storefront/lib/pages.ts` — `getPublishedPage(storefrontId, slug)` → `{ page, sections }` reading ONLY `storefront_pages` (sections parsed from `published_snapshot`; never queries the sections table with the anon client). `listPublishedPages(storefrontId)` for nav/sitemap.
- `Home.tsx`: published `home` → render `<SectionRenderer>` over snapshot; else existing 4-theme layout (`getLayoutStyle` stays as fallback).
- `About.tsx`/`Policies.tsx`: published `about`/`policies` page → its sections; else legacy content.
- `StorefrontApp.tsx`: route `${basePath}/pages/:slug` (published only → 404 view when null). `StorefrontLayout.tsx`: render `storefronts.nav` when non-empty, else current hard-coded nav.
- **Preview route (M3):** `/storefronts/preview/:slug/:pageSlug` inside the **authenticated** routes block of `App.tsx`, wrapped in `<PermissionGuard permission="storefronts.view">`, rendering `StorefrontApp` with brand override + draft mode (reads working-copy sections via the authenticated staff client — RLS permits staff; anon-key fetch of a draft returns nothing). The main `/storefronts` route gains the same guard (§4.4).
- **Phase-1 card links (stated explicitly):** `ProductGrid`/`FeaturedProducts` card links use inline route literals matching `StorefrontApp.tsx:34` (`/product/:slug`); Phase 2 replaces them with `routes.ts` imports when that module ships (L4-approved pattern — Phase 1 never blocks on a later-phase module).

### 4.4 Admin UI

Refactor first (no behavior change): split `StorefrontsPage.tsx` (818 lines) tabs into `src/components/storefront-admin/{BrandProfileTab,SocialPoliciesTab,DomainsTab,ProductsTab}.tsx`; shell ~150 lines. Then:
- **Route guard (M3):** `App.tsx` — `<Route path="/storefronts" element={<PermissionGuard permission="storefronts.view"><StorefrontsPage /></PermissionGuard>} />` + the preview route (§4.3). This is a first-class task, not a footnote: the admin surface (incl. draft previews) gets a real permission gate alongside RLS.
- `PagesTab.tsx`: page list per storefront (create with title+slug+type, duplicate, delete, status badge, publish/unpublish), section editor (ordered list, add via type picker, reorder, visible-toggle, delete; generic prop form from `adminFields`), per-page SEO fields (stored now in `seo`, surfaced fully in Phase 4), nav editor (label+href rows).
- Publish action: copy visible sorted sections into `published_snapshot`, set `status='published', published_at=now()` in one update. Live-preview iframe (`/storefronts/preview/:slug/:pageSlug`) above the editor.
- **Save clobber detection (M12 — now actually functional):** section/page saves are last-write-wins *after a detected conflict*; every save sends the row's `updated_at` it was based on and the update matches `WHERE id = ? AND updated_at = <base>` — zero rows updated → conflict toast prompting reload. This works **because** `updated_at` advances on every write to both tables: the pages table has had a BEFORE UPDATE bump since `20260516201928` (fact 9, N1), and §4.1's `set_updated_at()` trigger supplies it on `storefront_page_sections` (V3's version was dead as specified **for the sections table**: no trigger existed on it, `updated_at` kept its insert-time value, and the stale-base predicate always matched). The trigger is the mechanism; the WHERE predicate is the check. Detects clobbers; does not resolve them (v1 accepts this, stated in §13 risk 6).
- Update the `Storefront` TS interface (`BrandContext.tsx` / `brand.ts` / `StorefrontsPage.tsx`) with `nav`; regenerate `src/integrations/supabase/types.ts` after the migration.

### 4.5 Migration/rollout

Expand-only for schema (columns on existing dead table + new sections table + enum value + **the M12 triggers**, created via `CREATE OR REPLACE`/own-name `DROP IF EXISTS` idioms — not policy changes); the two policy changes (sections table gets no public policy; pages public policy tightened) are contract-tightening on **tables with zero live readers** — owned as exceptions in §10.3. The two-migration enum split (L5) deploys in order; migration 2 is a no-op re-run. Backfill creates drafts only; runtime legacy fallback = built-in rollback (unpublish or app revert).

### 4.6 Verification

- `verify_storefront_page_builder.sql`: `storefront_pages` has new columns; `storefront_page_sections` exists with RLS enabled and **policy count = 4 (staff-only), zero policies containing `TO anon`**; `storefront_pages` public policy requires `status='published'`; enum contains `storefronts.view`; **migration 2 check: every system role holding `stores.view` also holds `storefronts.view`**; backfilled `home` drafts = storefront count (ON CONFLICT guard can legitimately undershoot if the dead table already held a `(storefront_id,'home')` row — the assertion surfaces it); no published pages; `uq_storefront_pages_one_home` enforced (insert second home → fails). **M12: both `set_updated_at` triggers exist (pg_trigger check); scripted stale-base check — `UPDATE storefront_page_sections SET … WHERE id = X AND updated_at = <an older timestamp>` reports 0 rows affected, and the same UPDATE with the current `updated_at` reports 1.**
- Vitest: registry completeness; `validate()` table-driven rejection per type; slug rules; `pages.ts` snapshot→sections mapping; clobber-detection mapping (zero-rows-updated result → conflict state surfaced + reload prompt — the DB-level zero-rows guarantee is the scripted check above).
- Manual: create→preview→publish a home page; **anon-key REST GET on a section row of a published page returns empty (H4)**; anon-key GET on a draft page row returns empty; storefront domain shows new home; second storefront shows legacy layout; `/pages/:slug` 404s unknown; a non-admin authenticated user without `storefronts.view` sees the guard's access-denied fallback on `/storefronts` (M3); admin/staff can preview drafts; **two-tab clobber: tab A saves a section, tab B (stale base) saves → conflict toast, not a silent clobber (M12)**.
- `npm run lint` + new `npm run typecheck` (`tsc --noEmit` script added here).

**Effort:** 4–5 weeks (schema+runtime 1 wk, admin editor+preview+guard 1.5–2 wk, registry+polish+tests 1 wk, buffer — the M12 triggers + stale-base script absorb within the buffer).

---

## 5. Phase 2 — Wire up collections

**Goal:** Shop browsable by collection; collections managed in admin; the `collection-grid` section becomes functional. Zero new tables.

### 5.1 Route helper FIRST (hoisted from Phase 4 — L4)

The pinned single-dev order (1 → 2 → 3 → 5 → 6 → 4) means Phase 2 executes **three phases before** V2's Phase-4 `routes.ts` — a literal executor would hit a missing module or silently inline a divergent constant. The module's creation lives here (it is tiny and Phase 2 is its first consumer); Phase 4 merely adopts it everywhere:

- `src/storefront/lib/routes.ts` — single source of truth: `productUrl(slug) → ${base}/product/:slug` (**actual route shape, `StorefrontApp.tsx:34`**), `collectionUrl(slug)`, `pageUrl(slug)`, `shopUrl()`. All Link components and canonicals use constants mirrored from this module; the Phase 4 parity test asserts the sitemap fn matches it (§7.5).
- Vitest here in Phase 2: route-shape constants match the `StorefrontApp.tsx` route table (fixture).

### 5.2 DB (migration `storefront_collections_position.sql` + verify — N2)

One migration. **Fact 10 establishes the tables, RLS, the `(collection_id, product_id)` UNIQUE junction key — AND `position integer NOT NULL DEFAULT 0` on BOTH tables (`20260516201928` lines 85 and 112); no migration drops either column.** The migration therefore adds no columns — it runs a **non-destructive backfill** that only touches rows still at the default, plus the ordering index. The executor's pre-flight column check records the live answer in the verify file as **confirmation** of fact 10 (not discovery):

```sql
-- N2: position columns EXIST on both tables since 20260516201928 (fact 10),
-- defaulted 0, never managed by any UI (live rows expected all-default). This
-- migration adds NO columns.
--
-- Junction backfill — NON-DESTRUCTIVE: renumber only rows still at the
-- DEFAULT (position = 0), preserving any curated positions (from the §5.4
-- reorder UI or operator SQL). Within a collection, rows still at the
-- default get a deterministic uuid order; rows already curated keep their
-- value untouched. Idempotent in EVERY state — curated or not — because a
-- re-run only ever matches position = 0 rows, and a renumbered row never
-- returns to 0.
WITH ordered AS (
  SELECT collection_id, product_id,
         row_number() OVER (PARTITION BY collection_id ORDER BY product_id) - 1 AS rn
  FROM public.storefront_collection_products
  WHERE position = 0
)
UPDATE public.storefront_collection_products scp
SET position = ordered.rn
FROM ordered
WHERE scp.collection_id = ordered.collection_id
  AND scp.product_id = ordered.product_id
  AND scp.position = 0;

-- Collections rows keep position=0 initially; listCollections (§5.3) orders by
-- (position, title) so the pre-reorder state is stable and deterministic.
CREATE INDEX IF NOT EXISTS idx_scp_collection_pos
  ON public.storefront_collection_products(collection_id, position);
```

### 5.3 Runtime

- `src/storefront/lib/collections.ts` — `listCollections(storefrontId)` (active, ordered by `position, title`), `getCollectionWithProducts(storefrontId, slug)` (junction products joined via existing `catalog.ts` mapping, respecting `is_active`, ordered by junction `position`; junction rows whose `product_id` no longer exists are filtered at render — junction has no FK, real FK is a contract-phase item).
- `Shop.tsx`: horizontal collection tab strip (All + active collections), client-side filter over loaded products. No faceting (P1).
- `StorefrontApp.tsx`: route `${basePath}/collections/:slug`; new `src/storefront/pages/Collection.tsx` (header from collection row + grid reusing `ProductCard`).
- `CollectionGrid` section: active collections as cards linking via `collectionUrl()` from the §5.1 helper (no inline constants). Phase-1 section card links adopt `routes.ts` here (replacing the §4.3 inline literals).
- SEO stub: collection title = `${title} — ${storefront.name}` (Phase 4 wires full meta).

### 5.4 Admin

`CollectionsTab.tsx`: list (title, slug, active, position, product count), create/edit dialog, delete (cascade clears junction), inline product picker (search like ProductsTab; add/remove/reorder via `position` — the columns that exist since `20260516201928`, fact 10).

### 5.5 Verification

- Verify migration: `position` columns exist on both tables (pre-flight **confirms** fact 10 — `20260516201928` established them; the file records the observed live values, expected all-default 0); junction backfill **non-destructive and idempotent in every state** — rows still at `position = 0` are renumbered deterministically, rows with curated positions are untouched, and a re-run changes nothing **including after curation via the reorder UI** (N2); index exists; policies unchanged; dead-table status resolved.
- Vitest: collection-filter helpers; §5.1 route-shape fixtures.
- Manual: create collection with 3 products → Shop tab; `/collections/:slug` renders; `collection-grid` on published home renders cards linking to the correct `/collections/:slug` URLs; deleting a catalog product doesn't break the tab (filtered at render); reorder persists across reload.

**Effort:** 3.5–5.5 days (routes.ts + position columns/backfill; Phase 4's 5–7 d is the post-hoist net figure — the routes.ts move-out is already baked into it, no arithmetic tension).

---

## 6. Phase 3 — Product variations on storefront + checkout

**Goal:** Customer picks size/color on the product page; the chosen variation's price/stock flows cart → `storefront-checkout` → `order_items`, validated server-side.

### 6.1 DB (migration + verify)

- `ALTER TABLE public.order_items ADD COLUMN variation_id uuid REFERENCES public.product_variations(id) ON DELETE SET NULL;` (nullable, expand-only).
- `CREATE POLICY "Public can read product variations" ON public.product_variations FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_variations.product_id AND p.is_active));` — **[L7] gated on the parent product's `is_active`, matching the `20260619164824` products-policy precedent.** A bare `USING (true)` would expose variation rows — including price — of inactive/draft products via direct REST; the storefront UI's join-through-products gating is client-side and too weak a guarantee for a policy decision made implicitly. Required because the storefront runtime is anon-key and no anon policy on this table exists anywhere in migrations (fact 11). Runtime cost is one indexed probe per row; acceptable for a catalog-scale table.
- Verify file also runs an **informational** query (M2): `SELECT stock_status, count(*) FROM product_variations GROUP BY 1` — documents the live vocabulary distribution; it does NOT gate anything (availability logic ignores `stock_status` per fact 13).

### 6.2 Shared variation helper

Extract `parseVariationAttributes` into `src/lib/variations.ts` (canonical version; refactor `AddOrderDialog`, `pos/VariationModal`, `MeasurementSlipPrint` imports — mechanical, behavior-preserving). Output: `Array<{name: string, option: string}>`.

### 6.3 Runtime

- `lib/catalog.ts`: `getStorefrontProduct` also fetches variations (`id, name, price, manage_stock, stock_quantity, attributes`).
- `Product.tsx`: attribute option buttons (group variations by parsed attributes); **availability gate: `manage_stock && stock_quantity <= 0` — `stock_status` is deliberately NOT consulted (M2/fact 13)**; price display switches to selected variation's `price` (mirror POS: `price`, not `sale_price` — `AddOrderDialog.tsx:145`); "Add to cart" requires full selection when variations exist.
- `Cart.tsx`: render `variation_label` under name. `Checkout.tsx`: pass `variation_id` + `variation_label` per item.

### 6.4 Edge function `storefront-checkout` (rewrite 1 of 3)

- Payload items gain `variation_id?`.
- When present: fetch variation, verify `variation.product_id === product_id` (else 400), use `variation.price` for line totals, validate `variation.manage_stock → variation.stock_quantity >= qty` in addition to the product-level check (manage_stock-gated only; no `stock_status` term).
- **When absent, the item is a legitimate product-level sale** (the aggregate inventory model supports it): the product-level `manage_stock → stock_quantity >= qty` check applies, and Phase 6's cross-key FIFO rule (§9.1 step 3, M13) keeps the decrement ledger-coherent — a crafted payload omitting `variation_id` on a variations-cataloged product cannot reopen an oversell window.
- `order_items` insert: `product_id`, `variation_id`, `product_name = variationLabel ? "${name} - ${label}" : name` (POS convention, fact 3), `unit_price` = effective price.
- Stock decrement NOT added here — Phase 6 (validation-only until then, same race window as today).

### 6.5 Deploy order (explicit, per cycle-1 quality note)

**Migration first, fn second, app third.** The fn writes `order_items.variation_id` before the column exists → every insert errors. This ordering is a hard checklist item, mirrored from §9.5's discipline.

### 6.6 Verification

- Verify migration: column + FK + policy applied (assert the policy expression contains the `products.is_active` EXISTS gate — L7); stock_status distribution query present.
- Vitest: `lib/variations.ts` parsing (fixtures copied from the three current implementations: string, array-of-objects, array-of-arrays); cart merge by `(product_id, variation_id)`.
- Manual: pick size/color → price/stock update; add to cart (label shown); checkout; fn rejects qty > variation stock; fn rejects cross-product `variation_id` (400); **deactivate a product → its variations no longer readable via anon REST (L7), active products' variations still readable**; Orders UI shows "Kurta - Size: L"; product without variations unchanged.
- `supabase functions serve` + crafted payloads.

**Effort:** 1–1.5 weeks.

---

## 7. Phase 4 — SEO foundation

**Goal:** Per-page meta; stable product URLs; per-storefront `sitemap.xml` + spec-valid `robots.txt`; Product/Organization/Breadcrumb JSON-LD. (CSR-only remains — prerendering out of scope, §12.)

### 7.1 Route helper — adopted, not created (L4)

`src/storefront/lib/routes.ts` was **created in Phase 2** (its first consumer). Phase 4 adopts it everywhere: sitemap fn URL builders, canonicals, breadcrumbs, JSON-LD, all Link components — no inline route constants anywhere. A fixture test asserts parity (§7.5).

### 7.2 DB (migration `product_slug.sql` + verify)

- `ALTER TABLE public.products ADD COLUMN slug text;` → backfill with the exact read-time formula (lowercase, `[^a-z0-9]+`→`-`, trim, ≤60 chars, append `id.slice(0,6)`; empty name → `id.slice(0,8)`), dedupe `-2`,`-3` → `CREATE UNIQUE INDEX uq_products_slug ON public.products(slug);` (index, not constraint — trigger enforces future inserts).
- `BEFORE INSERT ... WHEN NEW.slug IS NULL` trigger `set_product_slug()` (same formula + collision loop) so Woo imports and POS-created products get slugs. Renames never touch slug.
- `catalog.ts`: prefer stored `slug`, keep read-time fallback (verify asserts zero NULL slugs).

### 7.3 Runtime meta + JSON-LD

- `src/storefront/lib/seo.ts` — `usePageMeta({title, description, canonicalPath, ogImageUrl?, ogType})` (no new dependency; keyed upsert/remove of `<title>`, description, `og:*`, canonical, twitter card).
- Wire per route: Home/custom pages from `storefront_pages.seo`; Shop/About/Policies/Contact defaults; Collection from collection title/description; **Product: title `${name} — ${storefront.name}`, description = `short_description` (fallback trimmed `description`), canonical via `productUrl(stored slug)`, og:image = `image_url`**.
- `src/storefront/lib/jsonld.tsx` — `OrganizationJsonLd` (all pages), `ProductJsonLd` (Product page; `offers` from effective price, `priceCurrency: storefronts.currency`, **availability derived from the same manage_stock-gated predicate as §6.3 — not from `stock_status` (M2)**), `BreadcrumbListJsonLd` (Product: Home › Shop › Product; Collection: Home › Collection) — breadcrumbs use §7.1 URLs.

### 7.4 Sitemap + robots — delivery corrected (M4)

- Fn `storefront-sitemap` (`supabase/functions/storefront-sitemap/index.ts`): resolve storefront by `?slug=` **or the `x-forwarded-host` header (fallback when Host is rewritten to the supabase host — Vercel external rewrites preserve the original host only in `x-forwarded-host`)**; mirror `lib/brand.ts` matching (slug subdomain / `social.custom_domains`); query published pages, active collections, active products; emit XML with home, `/shop`, `/pages/:slug`, `/collections/:slug`, `/product/:slug` (lastmod from `updated_at`), all URLs via the §7.1 constants.
- **Fn `storefront-robots`** (tiny): emits `robots.txt` per storefront host with an **absolute** `Sitemap: https://<host>/sitemap.xml` — the robots spec requires an absolute URL; a relative directive in the static `public/robots.txt` would be silently ignored by Google/Bing, so v1 does not ship one.
- **`vercel.json` — ordering matters (rewrites evaluate in order):**
```json
{ "rewrites": [
    { "source": "/sitemap.xml", "destination": "https://<supabase-ref>.supabase.co/functions/v1/storefront-sitemap" },
    { "source": "/robots.txt",  "destination": "https://<supabase-ref>.supabase.co/functions/v1/storefront-robots" },
    { "source": "/(.*)", "destination": "/index.html" }
] }
```
  (sitemap/robots BEFORE the existing catch-all; on the main dokanos domain without storefront context the fns return a minimal 404-shape response — per-storefront sitemaps live on storefront hosts/`?slug=`; a main-domain index sitemap is a follow-up.)
- Remove nothing from `public/robots.txt` (static file remains for direct hits that bypass rewrites on localhost; it simply carries no Sitemap directive).

### 7.5 Verification

- Verify migration: zero NULL `products.slug`, zero duplicates pre-index, index exists, trigger fires on test insert.
- **Vitest (L2): sitemap/canonical URL-shape parity** — the fn's URL builders (as fixture data) must match `routes.ts` outputs for a corpus of slugs; canonical `href` in `usePageMeta` tests derives from `productUrl`.
- Manual: rename product → URL unchanged; fetch `/sitemap.xml` AND `/robots.txt` on a custom-domain storefront → valid XML / robots with absolute Sitemap; view-source on product page → meta/OG/canonical + 3 JSON-LD blocks; Rich Results test post-deploy.
- Vitest: slug formula parity (SQL backfill vs TS property test); `usePageMeta` DOM effect (jsdom).

**Effort:** 5–7 days (post-hoist scope: slug backfill + sitemap/robots + meta/JSON-LD; routes.ts ships in Phase 2).

---

## 8. Phase 5 — Storefront settings object

**Goal:** Per-storefront checkout/UX behavior is data, editable in a Settings tab, honored by runtime + `storefront-checkout`.

### 8.1 DB (migration + verify)

`ALTER TABLE public.storefronts ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb;` — **this is the whole migration.** No `invoice_settings` policy is added (rejected: `invoice_settings` is operator-config with no anon business being readable; the anon shipping display problem is solved server-side instead — §8.2). Schema (hand validator in `src/lib/storefrontSettings.ts`; repo has no zod):

```jsonc
{
  "checkout": { "methods": { "cod": true, "bkash": true, "nagad": true },   // ≥1 must stay true
                "min_order_amount": 0, "order_instructions": "", "terms_checkbox_text": "" },
  "shipping":  { "free_threshold": 0 },                                     // 0 = off
  "tax":       { "inclusive": false },                                      // display flag only in v1
  "announcement": { "enabled": false, "text": "", "href": "" },
  "pixels":    { "ga4": "", "meta": "", "tiktok": "" }                      // stored now, loaded in P1 analytics (§12)
}
```

Defaults reproduce today's behavior exactly (`{}` = current flat-rate COD/bKash/Nagad, no threshold, no announcement).

### 8.2 Shipping quote — new public fn (M1 resolution)

`supabase/functions/storefront-shipping-quote/index.ts`: POST `{storefront_slug, city_id?}` → resolves the storefront, reads `invoice_settings.shipping_inside_dhaka/shipping_outside_dhaka` + the storefront's `settings.shipping.free_threshold` (service role), returns `{inside_dhaka, outside_dhaka, free_threshold, currency}`. CORS `*` (public commerce surface, same posture as `storefront-checkout`). This deletes the client-side 80/150 hard-code **without** opening `invoice_settings` to anon (it stays default-deny — fact 12) and without shipping rates through the order-time fn only. Future zone rates (P1 #10) extend this one fn.
- `Checkout.tsx`: fetch the quote when city changes; shipping line = quote for selected city; "Free" when subtotal ≥ threshold.
- `lib/settings.ts`: `mergeSettings(raw)` defaults-merge (single source for fn + client).

### 8.3 Runtime

- `BrandContext` exposes `settings` merged with defaults (row loads via `select *` — add to the `Storefront` TS interface).
- `Checkout.tsx`: render only enabled methods; block submit below `min_order_amount` (inline error); `order_instructions`; optional terms checkbox; threshold logic from §8.2.
- `StorefrontLayout.tsx`: announcement bar when enabled.
- `storefront-checkout` (rewrite 2 of 3): read settings server-side; enforce enabled-methods (disabled method → 400) and `min_order_amount`; apply `free_threshold` in total computation; use `lib/settings.ts` merge (shared shape with client).

### 8.4 Admin

`SettingsTab.tsx`: grouped form of the schema (toggles, numbers, texts, announcement, pixel IDs); validation before save (≥1 method, min_order ≥ 0); single `storefronts.update`.

### 8.5 Verification

- Verify migration: column exists, all rows `{}`.
- Vitest: defaults-merge (`{} → today's behavior`); validation rules; quote-response mapping.
- Manual: disable bKash → option gone; min order 500 → 300-taka cart blocked; threshold 1000 → 1200-taka cart shows Free and **fn total matches**; announcement renders/hides; shipping display updates when `invoice_settings` rates change **without redeploying** (proves the mirror is gone); settings save round-trips.

**Effort:** 3.5–5 days.

---

## 9. Phase 6 — Atomic checkout, idempotency, Track fix, PII closure

**Goal:** Checkout is oversell-safe and double-click-safe with **no cross-call race window at all** (H2); cancel restores stock exactly once, replaying the recorded decrement shape (M10); Track works via phone-verified edge fn; **anon REST on the entire `20260407074308` batch is closed** (H1, completed by H5 — orders family read leak + `products`/`stores` anon-writable survivors).

### 9.1 DB (migration `checkout_atomic_idempotency.sql` + verify)

```sql
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_idempotency_key
  ON public.orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS storefront_id uuid REFERENCES public.storefronts(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stock_restored_at timestamptz;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS stock_ledger jsonb;  -- decrement journal (M10), see below

-- L8: no inspected migration establishes uniqueness on orders.order_number (fact 21),
-- yet the M7 handler AND its probe need a second unique constraint the insert can face.
-- Self-guarding pre-check: duplicate order numbers BLOCK the index with a loud, named
-- error for the operator to dedupe — never silently weakened to a partial index.
-- NULL order_numbers (if any) are unaffected (unique indexes ignore NULLs).
DO $$
DECLARE dup_groups int;
BEGIN
  SELECT count(*) INTO dup_groups
  FROM (SELECT order_number FROM public.orders
        WHERE order_number IS NOT NULL
        GROUP BY 1 HAVING count(*) > 1) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'uq_orders_order_number blocked: % duplicate order_number groups exist — dedupe before deploying this migration', dup_groups;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_order_number ON public.orders(order_number);

-- H1/H5/H7: close the PII + anon-write holes — the plan's deliberate exception #1 to
-- expand-only (§10.3). The anon FOR ALL policies were created by FOUR migrations (fact 6):
-- 20260407074308 (orders, order_items, customers, products, stores — exactly five),
-- 20260407150827 (order_timeline, order_payments), 20260408191701 (product_variations),
-- 20260408205133 (categories, product_categories). The failed 20260412170009 attempted
-- to drop ALL TEN of them — plus the pathao_* tighten — and at least the orders one failed
-- (live-DB verified); under the plan's rollback premise NO statement of that migration
-- took effect. Re-run ALL TEN drops idempotently (harmless where already gone):
--  * product anon READ is preserved separately by 20260619164824's differently-named
--    SELECT-only (is_active) policy, which is NOT dropped;
--  * product_variations anon read is re-granted SELECT-only by Phase 3's policy, which
--    has a different name and is NOT dropped;
--  * categories/product_categories end with ZERO anon policies — the storefront runtime
--    never reads categories (verified: zero category references under src/storefront);
--    POS/admin read them as authenticated sessions. If a future anon need appears, add
--    a named SELECT-only policy as a deliberate decision (H7).
DROP POLICY IF EXISTS "Allow anonymous access to orders"             ON public.orders;
DROP POLICY IF EXISTS "Allow anonymous access to order_items"        ON public.order_items;
DROP POLICY IF EXISTS "Allow anonymous access to order_payments"     ON public.order_payments;
DROP POLICY IF EXISTS "Allow anonymous access to order_timeline"     ON public.order_timeline;
DROP POLICY IF EXISTS "Allow anonymous access to customers"          ON public.customers;
DROP POLICY IF EXISTS "Allow anonymous access to product_variations" ON public.product_variations;
DROP POLICY IF EXISTS "Allow anonymous access to products"           ON public.products;             -- H5
DROP POLICY IF EXISTS "Allow anonymous access to stores"             ON public.stores;               -- H5
DROP POLICY IF EXISTS "Allow anonymous access to categories"         ON public.categories;           -- H7
DROP POLICY IF EXISTS "Allow anonymous access to product_categories" ON public.product_categories;   -- H7
-- pathao_* tighten (H7): "public read-only by design" was FALSE as a live-state claim —
-- the same failed 20260412170009 carried this tighten and none of it ran; the live pathao_*
-- tables still carry their FOR ALL TO public "Public access" policies. Re-run, idempotently
-- (every re-create guarded — M14):
DROP POLICY IF EXISTS "Public access to pathao_cities" ON public.pathao_cities;
DROP POLICY IF EXISTS "Public access to pathao_zones"  ON public.pathao_zones;
DROP POLICY IF EXISTS "Public access to pathao_areas"  ON public.pathao_areas;
DROP POLICY IF EXISTS "Public access to pathao_stores" ON public.pathao_stores;
-- M14: every re-create below is preceded by a DROP POLICY IF EXISTS of the SAME name —
-- the §4.1 self-owned-object idiom (repo precedent 20260614043218; PostgreSQL has no
-- CREATE POLICY IF NOT EXISTS). 20260412170009's own tail already created every one of
-- these names, so a plain CREATE POLICY errors on a fresh `db reset` (timestamp order
-- replays the April tail first) and on any re-run. On live the guards are no-ops and
-- the creates ARE the tighten; on fresh the drop+create is a byte-identical re-create.
DROP POLICY IF EXISTS "Anyone can read pathao_cities" ON public.pathao_cities;
CREATE POLICY "Anyone can read pathao_cities" ON public.pathao_cities FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated can manage pathao_cities" ON public.pathao_cities;
CREATE POLICY "Authenticated can manage pathao_cities" ON public.pathao_cities FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can read pathao_zones" ON public.pathao_zones;
CREATE POLICY "Anyone can read pathao_zones" ON public.pathao_zones FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated can manage pathao_zones" ON public.pathao_zones;
CREATE POLICY "Authenticated can manage pathao_zones" ON public.pathao_zones FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anyone can read pathao_areas" ON public.pathao_areas;
CREATE POLICY "Anyone can read pathao_areas" ON public.pathao_areas FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated can manage pathao_areas" ON public.pathao_areas;
CREATE POLICY "Authenticated can manage pathao_areas" ON public.pathao_areas FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- M15: "Anyone can read pathao_stores" is deliberately NOT re-created — the April tail's
-- read policy was superseded by 20260620172022 ("pathao_stores: remove public read", a
-- deliberate tightening). Re-running the April tail verbatim would reverse that recorded
-- decision; pathao_stores (courier store mappings) ends with ZERO anon policies,
-- authenticated-manage-only — no storefront need exists for public read (the shipping
-- quote is service-role, §8.2; zero pathao references in src/storefront).
DROP POLICY IF EXISTS "Authenticated can manage pathao_stores" ON public.pathao_stores;
CREATE POLICY "Authenticated can manage pathao_stores" ON public.pathao_stores FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- NOTE: Phase 3's "Public can read product variations" is intentionally NOT dropped/re-created
-- here — its name differs from the 20260408191701 policy above, so the drop is a no-op for it
-- and it survives as the SELECT-only anon read (M9).
```

**Restore journal (M10):** `storefront_place_order` records, per order item, the exact decrement shape it performed — `order_items.stock_ledger jsonb`: `{case: 'A'|'B', product_id, variation_id?, location_decrements: [{location_row_id (pk), qty}], products_direct_qty}` — as written by the RPC, in the same transaction. The restore replays **this recorded shape**, not a re-derivation from current world state (below). `location_decrements` may legitimately contain **cross-key rows** — variation-keyed rows decremented for a non-variation item (the M13 fallback, below) and parent rows decremented for a variation item (V3's fallback) — the row-id list is the replay contract; row keys do not matter to the restore.

**Atomic place-order RPC (H2 — replaces the two-step reserve+insert design; M7/M8-hardened; M13-coherent):**

```sql
CREATE OR REPLACE FUNCTION public.storefront_place_order(p_payload jsonb)
RETURNS jsonb  -- {order_id, order_number, deduped}
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- p_payload: {idempotency_key, storefront_id, store_id, customer fields (name, phone, address,
--   upsert target for customers), order fields (number, source='online', status, payment_*,
--   totals, shipping_cost, pathao fields),
--   items: [{product_id, variation_id?, quantity, unit_price, product_name, line_total}]}
-- 0. UPSERT the customer row (L6) — inside the transaction, so a failed validation
--    rolls the upsert back too; no ghost customers from 400s.
-- 1. INSERT the orders row (idempotency_key, storefront_id) FIRST.
--    Unique partial index serializes same-key races: the loser blocks on the in-flight
--    insert, gets 23505 after commit → EXCEPTION block:
--      a) GET STACKED DIAGNOSTICS CONSTRAINT_NAME; verify it IS
--         'uq_orders_idempotency_key' (M7). Any other unique violation — now including a
--         GENUINE order_number collision, detectable because §9.1 guarantees
--         uq_orders_order_number exists (L8) — is RE-RAISED with the original SQLSTATE
--         (23505) and the constraint name appended to the message. Never classified
--         as a dedupe.
--      b) SELECT the committed row BY idempotency_key. If no row is found, RE-RAISE
--         (M7) — a 23505 that is not a same-key commit is an error, never a dedupe.
--      c) Only then RETURN {order_id, order_number, deduped:true}. NO stock was
--         touched by the loser.
-- 2. Per item, SELECT products (and product_variations when variation_id) FOR UPDATE:
--    validate manage_stock → stock_quantity >= qty (P0001 with item name on failure).
--    ROLLBACK on any failure discards the step-0 customer upsert and the step-1 order
--    row — no partial state, no compensation call, no cross-call window (deletes V1
--    §13 risk 2 entirely).
-- 3. Decrement — coverage is SELF-CHECKING (M8) and RECOMPUTE-STABLE (M13); two cases
--    (facts 1, 14 — predicates are NULL-based, never zero-uuid):
--    CASE A rows exist in product_locations:
--      variation item  → decrement rows WHERE product_id = p AND variation_id = v
--                        (FIFO by created_at); if their SUM < qty, fall back to parent
--                        rows (variation_id IS NULL) to cover the remainder. The
--                        fallback is capped: if variation rows + parent rows together
--                        still cannot cover qty → RAISE P0001 (never silently
--                        under-decrement).
--      non-variation item → decrement parent-keyed rows (product_id = p AND
--                        variation_id IS NULL) FIFO by created_at; if their SUM < qty,
--                        fall back to the product's VARIATION-KEYED rows FIFO to cover
--                        the remainder — the exact mirror of the variation item's
--                        fallback to parent rows (M13). Rationale: this product HAS
--                        location rows, so a products-direct decrement would be
--                        erased by the next locations-write recompute (fact 1),
--                        silently resurrecting the sold qty — the oversell window
--                        this phase exists to close. Cross-key rows keep the
--                        decrement inside the ledger the recompute reads. Capped:
--                        if ALL rows for the product (parent + variation-keyed)
--                        together cannot cover qty → RAISE P0001 (the M8 no-silent-
--                        no-op guarantee is preserved; V3's products-direct
--                        fall-through for location-bearing products is DELETED).
--      Negative-stock guard (M8): every location UPDATE carries
--      `AND stock_quantity >= <take>` and the loop asserts rows-affected × qty taken
--      ≥ qty requested; anything short → RAISE P0001. No row ever goes below zero.
--    CASE B zero location rows for the product → UPDATE products SET stock_quantity =
--      stock_quantity - qty. (Stable while no rows exist — no locations write can
--      occur for a product with none; the rows-added-later divergence is owned by
--      the restore rules below, M10.)
--    Always, when variation_id → UPDATE product_variations SET stock_quantity =
--      stock_quantity - qty (guarded `>= 0`, P0001 on short).
--    The sync trigger recomputes products.stock_quantity from ALL location rows
--    (parent+variation both feed the aggregate — decrementing any keyed row lowers
--    the aggregate by the same qty; do NOT also write a products-direct term for the
--    same qty = no double count). Cross-key fallback decrements are location-row
--    writes: they count toward the aggregate exactly once via the trigger.
-- 4. Per item, WRITE the stock_ledger journal entry recording the exact shape just
--    performed (case, per-location-row quantities incl. any cross-key rows, or
--    products-direct qty). Then INSERT order_items (+ variation_id, + stock_ledger)
--    and the order_timeline row.
-- 5. RETURN {order_id, order_number, deduped:false}.
-- Every decrement/increment path fires the woo auto_push_* triggers — decrements
-- AND (via storefront_restore_stock) increments; both desired and echo-guarded (M10).
$$;

CREATE OR REPLACE FUNCTION public.storefront_restore_stock(p_order_id uuid) RETURNS void
  -- locks the orders row; no-op + notice when stock_restored_at IS NOT NULL;
  -- sets stock_restored_at = now() in the same transaction; restores ONLY when
  -- storefront_id IS NOT NULL (H3 discriminator — see 9.3) and status transitioned
  -- from a decrementing lifecycle. REPLAYS order_items.stock_ledger (M10) — the
  -- recorded per-location-row quantities and/or products-direct qty — instead of
  -- re-deriving the decrement from current state:
  --   * recorded location row still exists → increment it by the recorded qty;
  --   * recorded location row no longer exists (deleted since placement) → increment
  --     products.stock_quantity directly by the recorded qty and RAISE NOTICE a
  --     drift warning (auditor can diff); the aggregate stays correct either way —
  --     if locations were deleted, the sync trigger already recomputed the aggregate
  --     without them, so the direct increment is the only correct target;
  --   * CASE B recorded (products-direct) but location rows were ADDED since
  --     placement → the sync trigger has already recomputed the aggregate from
  --     locations (erasing the Case-B decrement), so the restore ALSO goes
  --     products-direct — the recorded shape is the contract, not current world state;
  --     net-zero holds in every combination. RAISE NOTICE a drift marker here TOO
  --     (symmetric with the deleted-row branch) so both divergence shapes surface.
  --  Restore increments fire the woo auto_push_* triggers too (M10 — acknowledged;
  --  desired: Woo stock should follow restores).
$$;

-- H6 (fact 22): service_role bypasses RLS, NOT EXECUTE privileges. A SECURITY DEFINER
-- function still requires the CALLING role to hold EXECUTE; after the REVOKEs, only
-- the owner retains it. The explicit GRANTs are what make the fns callable at runtime.
-- Callers: storefront-checkout (place) and storefront-restore-stock (restore) — both
-- service-role edge fns. The admin app NEVER calls either RPC directly (§9.3).
REVOKE ALL ON FUNCTION public.storefront_place_order(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_place_order(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.storefront_restore_stock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_restore_stock(uuid) TO service_role;
```

Note on `orders.source` (H3): the CHECK constraint was already dropped (`20260415171221`), so `'storefront'` would not error — but it must NOT be used anyway: Woo sync also writes `'online'` (`woo-sync/index.ts:653`), making source values ambiguous. The fn keeps `source='online'` (Orders-UI/`SourceBadge` compatibility preserved) and the RPC stamps **`storefront_id`** as the storefront-order discriminator. The V1 parenthetical "if it already writes a distinct source, keep it" is deleted — it was the bug.

### 9.2 Edge function `storefront-checkout` (rewrite 3 of 3 — final shape)

- Accept `idempotency_key` (client `crypto.randomUUID()`, persisted per cart in localStorage until success — `Checkout.tsx`).
- Flow: validate payload (Phase 3 variation checks + Phase 5 settings) → fetch products/variations, validate prices, compute shipping from `invoice_settings` + settings (all read-only, service role) → generate order number (as today) → **single RPC call `storefront_place_order`** with the assembled payload, **customer fields included (L6 — the RPC upserts the customer inside the transaction; the fn no longer upserts it before the RPC, so a 400 rolls the whole attempt back and no ghost customer rows are minted)** → map RPC result.
  - `deduped:true` → 200 with the original order_id/order_number.
  - RPC P0001 (out of stock) → 400 with the item message. No partial state is possible — the customer upsert, order insert, and the decrements share one transaction.
  - **RPC re-raise carrying `uq_orders_order_number` (L8):** a genuine order-number collision under different keys (two concurrent mints). The fn regenerates the order number via `generate_pos_order_number` and retries the RPC **once** (bounded; idempotency_key unchanged — the rolled-back attempt committed nothing); a second collision → 409 retryable error. All other re-raises → 500 with the RPC message.
- No compensation logic, no 23505 catch in the fn beyond the L8 retry (same-key dedupe is handled inside the RPC), no accepted-mitigation comments. The edge fn never decrements stock itself.

### 9.3 Cancel-restores-stock wiring (H3 discriminator; H6 caller)

`OrderDetailSheet.tsx` cancel path: when `order.storefront_id IS NOT NULL` (**not** `source === 'storefront'` — V1's condition was dead code), after status update to `cancelled`, call the new **`storefront-restore-stock` edge fn** — POST `{order_id}`, platform-JWT-verified, staff/admin role-checked inside the fn, which invokes `storefront_restore_stock` with the service role. **H6 resolution choice, stated inline:** the critic offered (a) `GRANT EXECUTE TO authenticated` plus an in-RPC `has_role` guard, or (b) a tiny service-role edge fn. **Option (b) is chosen as technically safer** — it keeps the EXECUTE surface at `service_role` only (one caller class, identical to the checkout path), never exposes a SECURITY DEFINER function to every authenticated user, and puts role enforcement where it can also log/audit. V3's design (direct authenticated client call) was uncallable by construction: the REVOKE stripped EXECUTE from the exact role making the call. Toast "Inventory restored". Bulk cancel: same call per order; failures reported, not fatal (restore is idempotent via `stock_restored_at`). POS `ReturnDialog` restock untouched. `SourceBadge` optionally gains a "Storefront" badge keyed on `storefront_id` (small polish, not required).

### 9.4 Track page fix (audit §2.9.1 / H1)

- New `supabase/functions/storefront-track-order/index.ts`: POST `{order_number, phone}` (phone now REQUIRED) → normalize phone (strip non-digits; match exact OR last-6) → service-role SELECT of `order_number,status,tracking_status,payment_status,total,created_at,consignment_id,customer_phone` by order_number → phone mismatch → `{error:"Order not found"}` (404-shape, no oracle) → return the limited fields only.
- `Track.tsx`: add phone input; replace the anon-key `orders` query with the edge call. **Deploy sequencing within the phase (same release window): migration (§9.1) → fns (`storefront-checkout`, `storefront-track-order`, `storefront-restore-stock`) → app.** Old Track breaks the moment the anon policy drops — the app deploy in the same window replaces it; do not stage the migration days ahead.

### 9.5 Migration/rollout

Expand-only columns/indexes/RPCs/journal/unique index + the one owned exception (§10.3): the **ten-table** H1/H5 policy drops + pathao tighten (H7) and nothing else — Phase 1's pages-policy tighten already shipped in Phase 1. **Highest-risk phase.** Rollback: revert fn + app; RPCs/columns inert without the fn; the anon policy drops are NOT auto-reverted (restoring anon-writable products/stores or an anon PII hole is not a rollback we want — if the Track fn must revert, re-add a minimal anon SELECT policy as a deliberate decision, documented). Emergency switch = repoint checkout to previous fn version (Supabase fn versioning); stock drift corrected via Woo resync (locations remain the source of truth in Case A).

### 9.6 Verification

- Verify migration: columns/indexes/RPCs/journal column exist; **`uq_orders_order_number` exists (L8)**; **`information_schema.routine_privileges` shows EXECUTE on both RPCs for `service_role` and NO EXECUTE for PUBLIC/anon/authenticated (H6)**; **`pg_policies` shows zero `TO anon` policies on EVERY table of the drop list — orders, order_items, order_payments, order_timeline, customers, products, stores, categories, product_categories (H7 — the full ten-table set, not just the first eight); `product_variations` has exactly the SELECT-only Phase 3 policy (active-product-gated); `products` has exactly the `20260619164824` SELECT-only policy; `pathao_cities`/`pathao_zones`/`pathao_areas` each have exactly their SELECT-only + authenticated-manage pair, `pathao_stores` has exactly its authenticated-manage policy and ZERO anon policies (M15 — the `20260620172022` "pathao_stores: remove public read" decision is preserved; its public read is NOT re-created), and zero `FOR ALL TO public` policies remain on any of the four (H5/H7 — these assertions are only now complete)**.
- RPC fixtures (both ledgers): place an order on a Case-B product and a Case-A product with locations (parent rows and variation rows); assert `products.stock_quantity` equals the location SUM, variation rows decremented, order_items carry `variation_id` and a populated `stock_ledger`, `storefront_id` set, `sync_queue` contains a stock-push row per affected product/variation (fact 2 dedup).
- **M8 fixtures:** non-variation item on a product whose location rows are ALL variation-keyed → order succeeds AND `products.stock_quantity` drops by qty **AND the variation-keyed location rows carry the decrement** (cross-key FIFO — M13: assert `products.stock_quantity` equals the location-row SUM *after a subsequent locations write* fires, proving the decrement survives the recompute); variation item needing more than variation rows + parent rows hold → P0001, order rolled back; concurrent decrement cannot push any location row below zero.
- **M13 fixture (explicit):** place the cross-key order above → perform an unrelated locations write on the same product (a variation-keyed row edit) → assert `products.stock_quantity` still reflects the sale (SUM of rows includes the decremented rows). V3's products-direct fall-through would have failed this by design.
- **M10 fixtures:** place (Case A, per-location rows recorded) → cancel → each recorded location row incremented by exactly its recorded qty; delete a recorded location row → cancel → products-direct increment + drift notice; Case B place → add location rows → cancel → products-direct restore, net stock unchanged (+ drift notice, symmetric).
- **Race test (L1 — genuinely concurrent, not sequential):** new `scripts/idempotency-race-test.mjs` — Node, `Promise.all` two POSTs to `storefront-checkout` with the SAME idempotency_key: assert BOTH 200, identical order_number, exactly one order row, stock decremented exactly once. Second scenario: same key, stock=1, qty=1, both fired concurrently → both 200 deduped (the loser never reached stock because the winner's insert serializes it). Third: two DIFFERENT keys, stock=1 → one 200, one 400 out-of-stock. (V1's serial `for i in 1..2: curl` verified retries, not races — this script replaces it.)
- **M7 scripted probe (L8-grounded):** two different-key requests carrying the SAME pre-generated order number → the second insert hits `uq_orders_order_number` (which §9.1 now guarantees exists) → the RPC re-raises (23505 + constraint name in message), the fn retries once with a fresh number → both orders commit with distinct numbers; the response is never `deduped:true` with a null order_id. (Without the constraint this probe was unbuildable — fact 21.)
- **Ghost-customer check (L6):** submit an out-of-stock cart → 400 → assert no new/updated `customers` row for that phone.
- Cancel flow: cancel a storefront order (storefront_id set) → stock restored exactly once (second cancel no-op, `stock_restored_at` set); **the restore went through `storefront-restore-stock` as a staff/admin session (H6 — the fn's role check passes for staff, rejects a roleless JWT)**; POS order cancel does NOT restore; order with `storefront_id IS NULL` never restores.
- Track: wrong phone → not-found (no oracle); right phone → status rendered; **anon-key REST SELECT on `orders`/`order_items`/`customers` returns empty/error; anon-key REST SELECT on `products` STILL returns active rows (H5 — the closure must not have broken the catalog) and anon-key UPDATE on `products`/`stores` is rejected (H1/H5 end-to-end)**.
- **H6 negative check:** direct anon/authenticated REST call to either RPC (via PostgREST) → permission denied; both fns' service-role calls → succeed.

**Effort:** 7.5–9.5 days (V3's 7–9 + 0.5 d for the L8 unique index/pre-check + the H6 restore fn and grants — the plan's single most intricate object stays the RPC).

---

## 10. Cross-cutting concerns

### 10.1 RLS — every new/changed object

| Object | Public (anon) | Staff/Admin |
|---|---|---|
| `storefront_pages` (existing, expanded) | SELECT **tightened**: `status='published' AND storefront is_active` (exception #2) | ALL via has_role policies |
| `storefront_page_sections` | **NONE — no public policy at all** (H4; runtime reads `published_snapshot`; drafts+working copies invisible to anon) | ALL via has_role policies |
| `storefronts.nav`, `storefronts.settings` | covered by existing `storefronts` SELECT (is_active gate) | covered by existing UPDATE policy |
| `order_items.variation_id`, `order_items.stock_ledger` | follows `order_items` (no anon after Phase 6 drop — H1/H5) | unchanged |
| `product_variations` | SELECT gated `EXISTS (parent product is_active)` (Phase 3 — L7; **not** `USING (true)`; not dropped in Phase 6, different name) | existing |
| `products.slug` | follows `products` (20260619 policy unaffected — it is NOT in the H5 drop list) | existing |
| `orders.idempotency_key/.storefront_id/.stock_restored_at` | no new policy; anon has NONE (H1 drop) | existing |
| orders family (orders, order_items, order_payments, order_timeline, customers) | **H1: FOR ALL anon policies dropped** (exception #1) | unchanged |
| **`products`, `stores` (H5); `categories`, `product_categories` (H7)** | **FOR ALL anon policies dropped** (exception #1); `products` keeps its separately-named SELECT-only 20260619 policy; `stores`/`categories`/`product_categories` end with zero anon policies (storefront runtime never reads categories — §9.1) | unchanged |
| **`pathao_cities`/`pathao_zones`/`pathao_areas`/`pathao_stores` (H7; M15)** | tighten re-run **as amended by `20260620172022`**: cities/zones/areas get anon SELECT-only + authenticated manage replacing the live `FOR ALL TO public` policies (the never-ran 20260412170009 tighten); `pathao_stores` gets authenticated manage only — **zero anon policies**, its public read is NOT re-created (the June "remove public read" decision preserved, M15) | unchanged |
| **`orders.order_number` uniqueness (L8)** | unique index `uq_orders_order_number` (self-guarded duplicate pre-check) | — |
| RPCs `storefront_place_order`/`storefront_restore_stock` | **no EXECUTE for PUBLIC/anon/authenticated; EXECUTE granted to `service_role` explicitly (H6)** — invoked only by the `storefront-checkout` and `storefront-restore-stock` fns (both service role); the admin app calls the restore fn, never the RPC directly | via the role-checked restore fn |

New policies copy the `20260516201928` style verbatim (`has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'staff'::app_role)`). Business-scoping retrofit (P2 #19) remains out of scope — first item of the follow-up.

### 10.2 Permissions wiring (M3 corrected)

- `/storefronts` and `/storefronts/preview/:slug/:pageSlug` sit behind `<PermissionGuard permission="storefronts.view">` (new enum value, Phase 1 migration 1; system-role grants, Phase 1 migration 2 — L5 split). Previously `/storefronts` was the one admin route with NO guard (`App.tsx:102`) — V1's "already sit behind PermissionGuard" claim was false.
- Preview route additionally requires an authenticated session (it lives in the authenticated routes block; draft reads go through the staff client — RLS is the server-side enforcement).
- Edge fns `storefront-checkout`/`-sitemap`/`-robots`/`-shipping-quote`/`-track-order` are public CORS `*` by design (public commerce surface); **`storefront-restore-stock` is NOT CORS-open: it verifies the platform JWT and checks staff/admin roles inside the fn (H6)** — admin-only mutation surface. Per-storefront rate limiting is P2 #20 (§12). `generate-storefront-content` role check already correct (fact 18).

### 10.3 Rollback strategy + owned exceptions to expand-only

This plan is expand-only **except two deliberate, named exceptions** (no smuggling):
1. **H1/H5/H7 (Phase 6):** DROP the anon `FOR ALL` policies from the failed `20260412170009` drop — **all ten tables of the four-migration anon batch (fact 6): orders, order_items, order_payments, order_timeline, customers, product_variations, products, stores, categories, product_categories — plus re-running that migration's pathao_* tighten **as amended by `20260620172022` (M15): cities/zones/areas anon SELECT-only + authenticated manage; `pathao_stores` authenticated manage only — its public read is not re-created**. Justification: audit §2.9.1 critical PII finding on the orders family plus the strictly larger anon-WRITE hole on `products`/`stores`/`categories`/`product_categories` if those drops failed the same way (live DB shows orders' did; the anon category hole is the same failed drop, same policy name — H7); the Track edge fn is the replacement access path for orders; the intentional 20260619 SELECT-only products policy and Phase 3's SELECT-only variations policy are differently named and survive; the storefront runtime never reads categories via anon. V2's factual basis ("already dropped") was wrong.
2. **H4-adjacent (Phase 1):** DROP/re-CREATE the dead `storefront_pages` public SELECT policy (published-only). Justification: the existing `is_active` policy would leak drafts; the table has zero live readers.

`orders.source` needs NO constraint change (the CHECK was already dropped by `20260415171221` — verified; H3 resolved via the `storefront_id` column instead). The M12 `set_updated_at` triggers are self-owned objects created with standard idempotency idioms (`CREATE` / own-name `DROP IF EXISTS` + re-CREATE) — not an exception. The L8 `uq_orders_order_number` is a pure add (unique index + loud self-guard).

Per-phase rollback:
1. **Builder:** unpublish page / app revert; legacy components never deleted in-plan.
2. **Collections:** app revert only (additive columns + index + routes.ts harmless).
3. **Variations:** app + fn revert; column inert. **Deploy order: migration → fn → app** (fn writes the column).
4. **SEO:** app revert; slug column/trigger harmless; remove the two rewrites if misbehaving.
5. **Settings:** app + fn revert; `{}` defaults = old behavior.
6. **Atomic/PII:** fn versioning rollback (§9.5); schema inert without fn; anon drops NOT auto-reverted (§9.5).

---

## 11. Sequencing rationale (contradiction removed — M5)

- **Phase 1 first** — critical path and substrate: `seo` columns (Phase 4), `collection-grid` (Phase 2), announcement layout (Phase 5), page URLs (sitemap).
- **Phases 2 and 3** independent; 2 admin-heavy, 3 runtime/fn-heavy — parallelize cleanly behind 1 with a second dev. Phase 2 also ships `routes.ts` (L4) so no later phase ever references a module that does not exist.
- **Phase 5 before 6** — both rewrite `storefront-checkout`; settings land first so Phase 6 extracts the write path into the atomic RPC **once**, with settings already enforced. (V1's single-dev order ended `…6 → 4 → 5`, contradicting this — fixed.)
- **Phase 6 after 3** — the place-order RPC validates/decrements `product_variations`.
- **Phase 4 last** — sitemap enumerates pages + collections + stable-slugged products; JSON-LD wants variation-aware price and the manage_stock availability predicate; sequencing keeps SEO testable end-to-end in one phase.
- **Single-dev order: `1 → 2 → 3 → 5 → 6 → 4`.** (Two-dev split: dev A runs 1 → 4; dev B runs 2 → 3 → 5 → 6 after 1 lands.) Effort totals (§3) are stated as the sequential single-dev sum; any two-dev overlap shortens calendar time, not the sum (M11).

---

## 12. Out of scope (audit P1/P2 — do NOT pull into this plan)

Theme system v2 (P1 #7), media library (P1 #8), analytics events + dashboards + pixel *loading* (P1 #9 — Phase 5 only stores IDs), shipping zones (P1 #10 — Phase 5 adds only the threshold + quote fn), customer notifications/SMS/OTP (P1 #11), draft/publish for *branding* (P1 #13 — pages only), payment gateways (P2 #14), customer accounts/server cart (P2 #15), related products/reviews/sale-price UI (P2 #16), blog (P2 #17), automated domain provisioning (P2 #18), business-scoped RLS retrofit (P2 #19), per-storefront rate limiting (P2 #20), i18n (P2 #21), SSR/prerendering, POS-side stock reservation, Shop pagination/facets.

**P0 sub-items deferred with rationale (M6 — acknowledged, not silently dropped):**
- **`contact-form` section:** requires an anon-writable messages table + moderation inbox + anti-spam; shipping a section that discards submissions is worse than deferring. The Contact template (storefront email/phone) remains. Deferred to the follow-up with notifications (P1 #11).
- **`newsletter` section:** no capture backend exists until the analytics event pipeline (P1 #9); storing emails without a consent/compliance story is premature. Deferred with analytics.
- **Editable header/footer for system pages:** nav is editable in Phase 1; header/footer layout variants belong to themes-as-data (P1 #7), where every competitor puts them.

**Deferred contracts:** dropping legacy Home layouts, FK on `storefront_collection_products.product_id`, narrowing checkout CORS.

---

## 13. Known risks (accepted, with mitigation)

1. **Two-ledger stock drift** (`product_variations.stock_quantity` vs `product_locations` variation rows): Phase 6 decrements both coherently (§9.1 step 3) and the restore replays the recorded ledger (§9.1 M10); verify fixtures assert ledger equality; POS direct-write drift is pre-existing and tracked as follow-up.
2. **~~Reserve-then-insert compensation gap~~ — deleted (H2).** The atomic `storefront_place_order` RPC has no cross-call window; the V1 "accepted mitigation" comment and this risk are gone by construction.
3. **Section props are free-form jsonb** — validated in app code only; renderer is defensive (unknown type/bad props render nothing, logged).
4. **Sitemap on shared main domain** — v1 serves per-storefront hosts/`?slug=`; main-domain index sitemap is a follow-up. `x-forwarded-host` is client-spoofable when hitting the supabase host directly — it only selects which public storefront's sitemap is served; documented, accepted.
5. **Backfilled draft home pages** don't perfectly reproduce the 4 theme layouts — intentional; operators publish when satisfied; legacy fallback preserves status quo.
6. **Section editing is last-write-wins** (no real-time collaboration) — accepted for v1; **clobber detection is real** (M12): the `set_updated_at` triggers advance the stamp on every write, saves compare base `updated_at` via the WHERE predicate, and a conflict toast prompts reload. No merge UI.
7. **Track deploys in a same-window release with the anon policy drop** — a deliberately tight sequencing (§9.4); the alternative (staged migration) leaves Track broken for the gap.
8. **Restore-path ledger drift is bounded, not impossible (M10):** the journal makes every restore replay the recorded decrement shape, but if an operator manually rewrote location rows between place and cancel, the per-location distribution may still skew (aggregate stays exact). Drift notices on BOTH divergence branches (§9.1) + the §9.6 M10 fixtures document the boundary; accepted.
9. **`product_variations` anon policy adds an EXISTS probe per row (L7)** — catalog-scale cost, no measurable latency expected; if it ever shows in profiling, a `storefront_product_variations` view or denormalized `is_active` on the variation row is the follow-up. Accepted.
10. **`uq_orders_order_number` may halt on live duplicates (L8)** — the DO-block pre-check makes the halt loud and named with a dedupe count; if duplicates exist, the operator resolves them before the migration proceeds (a silent partial index was rejected as a self-weakening contract). Accepted.
11. **Cross-key fallback decrements (M13) borrow stock across variation keys** — a non-variation sale may consume variation-keyed location rows (and vice versa for variation items via parent rows), which the aggregate model already treats as one pool (`SUM` over all rows). The journal records the exact rows; the restore replays them; the §9.6 recompute-survival fixture proves the ledger stays coherent. Accepted as the cost of recompute-stability.

---

## 14. Change logs

### 14.1 Cycle 2 → V2 (retained from V2 for the audit trail)

| Finding | Resolution in V2 |
|---|---|
| **H1** | §2 fact 6 corrected: anon `orders` policy is LIVE. §9.1 adds the drop migration (orders family, idempotent `DROP POLICY IF EXISTS`) + re-created SELECT-only `product_variations` policy; owned as expand-only exception #1 (§10.3); §9.6 asserts zero `TO anon` policies on the orders family; Track fn + phone input shipped as the replacement path in the same release window (§9.4). |
| **H2** | Two-step reserve+insert design deleted. §9.1 introduces `storefront_place_order` RPC: order-row insert (unique idempotency index serializes same-key races) + stock validation + decrement + items + timeline in ONE transaction; §9.2 edge fn makes a single RPC call; §13 risk 2 removed as structurally impossible. |
| **H3** | Verified the CHECK was already dropped (`20260415171221`) and that Woo sync also writes `'online'` — so source can't discriminate. Resolution = option 2: new `orders.storefront_id` column; fn keeps `source='online'`; §9.3 restore wiring keys on `storefront_id IS NOT NULL`; the "keep distinct source" parenthetical deleted; no constraint migration needed (documented in §9.1 note + §10.3). |
| **H4** | `storefront_page_sections` gets NO public policy at all (staff/admin only); runtime reads `published_snapshot` only. Extended: discovered `storefront_pages` already exists with an `is_active` public policy that would leak drafts — tightened to published-only (§4.1), owned as exception #2; §4.6 asserts policy counts and adds anon-REST-on-section check. |
| **M1** | No `invoice_settings` anon policy. §8.2 adds public `storefront-shipping-quote` edge fn (service role reads rates + threshold); `Checkout.tsx` consumes it; client 80/150 hard-code deleted; Phase 5 migration stays pure-expand. |
| **M2** | Availability logic (§6.3) and JSON-LD availability (§7.3) gate exclusively on `manage_stock && stock_quantity`; `stock_status` never consulted; §6.1 verify includes informational live-distribution query. |
| **M3** | §10.2 corrected: `/storefronts` had NO guard. §4.1 adds `storefronts.view` enum value + system-role grants; §4.3/§4.4 wrap `/storefronts` and the preview route in `PermissionGuard`; preview requires authenticated session; §4.6 tests the guard with a non-privileged user. |
| **M4** | §7.4: fn reads `x-forwarded-host` (fallback `?slug=`); vercel.json shown with sitemap/robots rewrites ordered BEFORE the catch-all; new `storefront-robots` fn emits an absolute per-host `Sitemap:` URL (static relative directive never ships). |
| **M5** | §3 and §11 now agree: single-dev order pinned to `1 → 2 → 3 → 5 → 6 → 4`; the contradictory `…6 → 4 → 5` bullet is gone; Phase 6 re-estimated 6–8 d. |
| **M6** | §12 gains explicit deferred-P0 entries with one-line rationales: `contact-form` (no submission backend until P1 #11), `newsletter` (no capture backend until P1 #9), editable header/footer (P1 #7 theme system). Registry doc lists them as deferred types. |
| **L1** | §9.6 replaces serial curls with `scripts/idempotency-race-test.mjs` — `Promise.all` concurrent same-key requests (both 200, one order, one decrement), stock=1 qty=1 same-key case, and different-keys stock=1 case. |
| **L2** | §7.1 adds `src/storefront/lib/routes.ts` as the single URL source (`/product/:slug` — actual route, V1's `/products/:slug` corrected); sitemap fn + canonicals + breadcrumbs all derive from it; §7.5 vitest asserts fn/TS parity. |
| **L3** | §9.1 step 3 predicates written NULL-based (`variation_id IS NULL` / `= :v`), zero-uuid coalesce removed; variation-row decrement behavior specified against the aggregate's product_id-only SUM (no parent+variation double count); fixtures assert the aggregate. |

Additional cycle-2 corrections beyond the 13 findings (both verified that cycle): Phase 1 migrates an **existing** `storefront_pages` table (V1 would have failed on deploy), and Phase 3 carries an explicit migration→fn→app deploy order (cycle-1 quality note).

### 14.2 Cycle 3 → V3 (retained for the audit trail)

| Finding | Resolution in V3 |
|---|---|
| **H5** | Drop list extended to **all eight `20260407074308` tables**: §2 fact 6 corrected (attribution to `20260408191701` removed; products/stores added with the anon-write consequence stated), §9.1 adds `DROP POLICY IF EXISTS … ON products/stores`, §9.6 asserts zero `TO anon` on products/stores AND that the 2020619 SELECT-only products policy survives + anon UPDATE on products/stores is rejected, §10.1/§10.3 exception #1 covers eight tables, §1 goal line says so. *(Attribution corrected in V6 by H7 — the batch spans four migrations and ten tables; see fact 6.)* |
| **M7** | §9.1 step 1 exception contract constrained: `GET STACKED DIAGNOSTICS CONSTRAINT_NAME` must equal `uq_orders_idempotency_key` (else re-raise — e.g. order_number collisions under different keys); by-key SELECT must find a row (else re-raise); only then `deduped:true`. §9.6 adds the M7 scripted probe (forced order_number collision → error, never dedupe). |
| **M8** | §9.1 step 3 made self-checking: zero-row non-variation decrement falls through to the Case-B products-direct decrement; FIFO fallback capped — variation rows + parent rows short of qty → P0001; every location UPDATE guarded `stock_quantity >= take` (no negative rows); §9.6 M8 fixtures cover all three shapes. *(Superseded in V4: the products-direct fall-through on location-bearing products reopened a recompute-erase hole — M13 below.)* |
| **M9** | Phase 6 no longer re-creates the variations policy: the `20260407074308`-name drop is a genuine no-op against Phase 3's differently-named policy, which simply persists; the self-contradictory drop-then-recreate block deleted; §9.6 assertion unchanged (exactly the SELECT-only policy). |
| **M10** | `order_items.stock_ledger` journal added (§9.1): place-order records the exact decrement shape per item in-transaction; restore **replays the recorded shape** with explicit rules for deleted location rows (products-direct + drift notice) and post-place location additions (aggregate-safe products-direct); §9.1 acknowledges restore-path woo pushes; §13 risk 8 states the bounded drift; §9.6 M10 fixtures cover all three divergence cases. |
| **M11** | Effort arithmetic fixed everywhere: §3 shows the phase-by-phase sum; header estimate matches; Phase 6 re-estimated 7–9 d (M8/M10/M7/L6/H5 work added); §11 states totals are sequential single-dev sums, overlap only via the two-dev split. |
| **L4** | `routes.ts` hoisted from Phase 4 into §5.1 (Phase 2, its first consumer) with route-shape vitest there; §7.1 retitled "adopted, not created"; §3 table and §11 sequencing note updated — no phase consumes a module that ships later. |
| **L5** | PG15 claim qualified (fact 20) and the permission work split into two migrations (§4.1): `storefront_page_builder.sql` does ADD VALUE only; `storefront_permission_grants.sql` does the grant UPDATE with the previously-illegal `AND NOT permissions @> ARRAY['storefronts.view']` guard, now legal in its own transaction; §4.6 verifies the grant. |
| **L6** | Customer upsert moved INTO `storefront_place_order` (§9.1 step 0, payload carries customer fields; §9.2 flow updated — fn no longer upserts before the RPC); a 400 rolls the upsert back with everything else; §9.6 adds the ghost-customer check. |
| **L7** | §6.1 policy now `USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variations.product_id AND p.is_active))` — matching the 2020619 products precedent; fact 11 and §10.1 updated; §6.6 adds the deactivate-product anon-REST check; §13 risk 9 acknowledges the EXISTS cost. |

### 14.3 Cycle 4 → V4 (retained for the audit trail; factual corrections applied in V5 marked)

| Finding | Resolution in V4 |
|---|---|
| **H6** | RPC grants fixed at §9.1: after the REVOKEs, explicit `GRANT EXECUTE ON FUNCTION … TO service_role` for both RPCs; new fact 22 (service_role bypasses RLS, not EXECUTE); the false "bypasses grants" parenthetical deleted. Restore caller re-routed: §9.3 wires `OrderDetailSheet` cancel through the new `storefront-restore-stock` edge fn (JWT-verified, staff/admin role-checked inside, invokes the RPC service-role) — the critic's option (b) over (a), chosen as safer: EXECUTE surface stays `service_role`-only and the SECURITY DEFINER fn is never exposed to all authenticated users. §10.1/§10.2 updated; §9.6 adds the `routine_privileges` verify + anon/authenticated REST-denied negative check + staff-through-fn positive check. |
| **M12** | §4.1 DDL gains `set_updated_at()` BEFORE UPDATE triggers on `storefront_page_sections` AND `storefront_pages` (V3 had no bump mechanism on the **sections** table — there `updated_at` was insert-frozen and clobber detection dead; the pages table already had a bump since `20260516201928` — see N1); §4.4 rewritten to name the trigger as the mechanism behind the stale-base WHERE predicate; §4.6 adds pg_trigger presence check + scripted stale-base zero-rows/current-base one-row check + two-tab clobber manual test; §13 risk 6 updated ("real", not aspirational). |
| **M13** | Option (a) chosen — ledger-coherent cross-key FIFO: §9.1 step 3's non-variation fall-through to products-direct **deleted** for location-bearing products; when parent-keyed rows cannot cover the qty, the RPC decrements the product's variation-keyed rows FIFO (mirror of the variation item's parent-row fallback), capped with P0001 when all rows combined are short; rationale stated inline (fact 1 recompute would erase a products-direct decrement on a product with rows). §6.4 notes the fn-level missing-`variation_id` path is safe because of this. Journal explicitly records cross-key rows (§9.1 M10 note). §9.6 gains the explicit recompute-survival fixture (locations write fires → aggregate still reflects the sale); §13 risk 11 documents the cross-key borrowing. |
| **L8** | New fact 21 (order_number uniqueness unestablished by any migration); §9.1 adds self-guarded `uq_orders_order_number` (loud DO-block duplicate pre-check halts with a count — never a silent partial index); §9.1 step 1a re-raise now names the constraint (L8-guaranteed to be raisable); §9.2 gains the bounded order-number-collision retry (regenerate + retry once → 409 on second); §9.6 probe re-grounded on the guaranteed constraint; §10.1 row + §13 risk 10 added. |
| **L9** | New fact-10 amendment (position column established on NEITHER table); §5.2 migration extended: `ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0` on junction + `storefront_collections`, deterministic idempotent junction backfill, then the index — deploy-safe whichever state the live DB is in (same class as V1's `CREATE TABLE` failure, closed); §5.3/§5.4 reorder UX grounded on the columns; §5.5 verify records the pre-flight answer + backfill idempotency; Phase 2 effort re-ranged 3.5–5.5 d (reflected in §3's sum 44.5–59.5 d = 8.9–11.9 wk and the header). *(The L9 fact amendment was false — corrected in V5 by N2.)* |

**Effort delta (cycle 4):** Phase 2 3–5 → 3.5–5.5 d (L9 columns + backfill); Phase 6 7–9 → 7.5–9.5 d (L8 index + pre-check, H6 restore fn + grants); Phase 1 unchanged 4–5 wk (M12 triggers absorbed in buffer). New sequential sum 44.5–59.5 workdays = **8.9–11.9 weeks**, carried identically in the header and §3. All V3 resolutions (H5; M7–M11; L4–L7) and both cycle-1 partials (H1, H2) remain intact — the five V4 changes are additive to, not rewrites of, the cycle-3 state.

### 14.4 Cycle 5 → V5 (retained for the audit trail — 3 findings from STOREFRONT-PLAN-V4-CRITIQUE.md: 0 HIGH, 1 MEDIUM, 2 LOW)

| Finding | Resolution in V5 |
|---|---|
| **N2 (MEDIUM)** | §2 fact 10 corrected: the `position` columns DO exist on both `storefront_collections` (`20260516201928` line 85) and the junction `storefront_collection_products` (line 112); no migration drops them (V4's [L9] amendment was false). §5.2 rewritten: destructive `ADD COLUMN IF NOT EXISTS position` + unconditional uuid-order backfill (`WHERE scp.position <> ordered.rn`, which rewrote curated positions) **deleted**; replaced with a NON-DESTRUCTIVE backfill — `WITH ordered AS (… WHERE position = 0) UPDATE … WHERE scp.position = 0` — renumbering only rows still at the default and preserving curated positions from the reorder UI; §3 Phase-2 row, §5.4, and §5.5 updated — §5.5's idempotency claim now holds in every state (re-run changes nothing, including after curation); pre-flight reframed as confirming fact 10, not discovering it; §14.3 L9 row annotated "(corrected in V5 by N2)". |
| **N1 (LOW)** | §2 fact 9 corrected: `20260516201928` lines 153–155 ALREADY create `update_storefront_pages_updated_at` (`BEFORE UPDATE … EXECUTE FUNCTION public.update_updated_at_column()`, defined in `20260407071618`; no migration drops it) — page-level clobber detection was always functional; V4's [M12] "insert-frozen" claim was false **for the pages table** and the M12 gap was real ONLY for the new `storefront_page_sections` table. §4.1 comment rewritten: the duplicate pages trigger is harmless (both set `now()`, transaction-stable) but unnecessary; kept via the `DROP TRIGGER IF EXISTS` + CREATE idiom on the self-owned object, with the verify file recording the pre-existing trigger. §4.4 parenthetical and §14.3 M12 row corrected to attribute the insert-frozen state to the sections table only. |
| **N3 (LOW)** | §4.1: `DROP TRIGGER IF EXISTS trg_storefront_page_sections_set_updated_at ON public.storefront_page_sections;` added before its CREATE TRIGGER, matching the pages-trigger idiom stated three lines below — `storefront_page_builder.sql` now re-runs safely, as §4.1 claims ("Both migrations re-run safely"). |

**Effort delta (cycle 5):** none — all three fixes are factual corrections and one-line DDL idiom changes absorbed within existing phase efforts; the sequential sum stays 44.5–59.5 workdays = **8.9–11.9 weeks**, unchanged in the header and §3. All cycle-1/2/3/4 resolutions remain intact — the three V5 changes are surgical corrections, not rewrites.

### 14.5 Cycle 6 → V6 (retained for the audit trail — 2 findings from STOREFRONT-PLAN-V5-CRITIQUE.md: 1 HIGH, 0 MEDIUM, 1 LOW)

| Finding | Resolution in V6 |
|---|---|
| **H7 (HIGH)** | §2 fact 6 corrected: the anon `FOR ALL` policies come from FOUR migrations, not one — `20260407074308` created exactly five (orders, order_items, customers, products, stores); `20260407150827` added order_timeline/order_payments; `20260408191701` product_variations; `20260408205133` categories/product_categories; the failed `20260412170009` attempted drops on ALL TEN tables plus the pathao_* tighten. §9.1's closure extended from eight to the full ten-table drop set (categories + product_categories added; zero-anon exclusion owned with rationale — storefront runtime never reads categories) and the pathao tighten re-run, with the false "pathao tables are separately public read-only by design" comment replaced by the actual live state (the tighten never ran; pathao_* still carry `FOR ALL TO public` policies until this migration). §9.6's zero-anon assertion extended to every table in the drop list + a pathao pair check (SELECT-only + authenticated manage, zero `FOR ALL TO public` remains). §1 goal, §3 Phase-6 row, §9.5, §10.1 (H7 row + new pathao row), §10.3 exception #1, and §14.3's H5 row annotation aligned to the corrected attribution. *(Pathao scope amended in V7 — M14: the surviving re-creates are guarded `DROP POLICY IF EXISTS`; M15: `20260620172022`'s "pathao_stores: remove public read" is preserved and the `pathao_stores` read policy is not re-created.)* |
| **L10 (LOW)** | §4.1: `IF NOT EXISTS` added to the three non-idempotent statements of `storefront_page_builder.sql` — `CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_pages_one_home`, `CREATE TABLE IF NOT EXISTS public.storefront_page_sections`, `CREATE INDEX IF NOT EXISTS idx_sp_sections_page` — making the "Both migrations re-run safely" claim genuinely true for migration 1, not just the trigger instance N3 fixed (re-run previously errored at the unique index, "already exists", before reaching the triggers). |

**Effort delta (cycle 6):** none — both fixes are factual corrections and DDL idiom changes absorbed within existing phase efforts; the sequential sum stays 44.5–59.5 workdays = **8.9–11.9 weeks**, unchanged in the header and §3. All cycle-1/2/3/4/5 resolutions remain intact — the two V6 changes are surgical corrections, not rewrites.

### 14.6 Cycle 7 → V7 (this revision — 2 findings from STOREFRONT-PLAN-V6-CRITIQUE.md: 0 HIGH, 2 MEDIUM, 0 LOW)

| Finding | Resolution in V7 |
|---|---|
| **M14 (MEDIUM)** | §9.1: each of the seven surviving pathao re-creates now carries a preceding `DROP POLICY IF EXISTS "<same name>" ON public.<same table>;` — the §4.1 self-owned-object idiom (repo precedent `20260614043218`; PostgreSQL has no `CREATE POLICY IF NOT EXISTS`). `20260412170009`'s own tail already created all eight policy names, so the plain `CREATE POLICY` statements errored with `policy … already exists` on any fresh `db reset` (timestamp order replays the April tail first) and on any re-run — the migration could not apply to a fresh database at all, breaking the dev/CI substrate every §9.6 fixture runs on and falsifying the block's own "Re-run, idempotently:" claim. On live the guards are no-ops and the creates ARE the tighten; on fresh the drop+create is a byte-identical re-create. The ten anon-policy drops were already `IF EXISTS` and needed no change. |
| **M15 (MEDIUM)** | §9.1: the `"Anyone can read pathao_stores"` re-create is DELETED — `20260620172022` ("pathao_stores: remove public read", later than the April tighten) deliberately dropped that policy, and re-creating it would reverse that recorded decision in both reachable states (fresh chain: undoes the June drop outright; live: re-grants a public read the chain's latest state says should not exist). The guarded `"Authenticated can manage pathao_stores"` create is kept (live needs it — the April tighten never ran there); `pathao_stores` (courier store mappings) ends with ZERO anon policies, authenticated-manage-only — no storefront need exists for public read (the shipping quote is service-role, §8.2; zero pathao references under `src/storefront`). §9.6's pair assertion rewritten (cities/zones/areas = SELECT-only + authenticated-manage pair; `pathao_stores` = authenticated manage only, zero anon policies); §10.1's pathao row, fact 6's pathao sentences, §10.3 exception #1, and §14.5's H7 row aligned to the amended scope. The inline M9 note and the guarded re-create idiom are unchanged. |

**Effort delta (cycle 7):** none — both fixes are guard lines, one deleted create, and assertion wording absorbed inside Phase 6's existing 7.5–9.5 d; the sequential sum stays 44.5–59.5 workdays = **8.9–11.9 weeks**, unchanged in the header and §3. All cycle-1/2/3/4/5/6 resolutions remain intact — the two V7 changes are surgical corrections, not rewrites.

