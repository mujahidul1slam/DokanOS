# Storefront P0 Implementation Plan — V2

**Source:** STOREFRONT-AUDIT.md (2026-09-09) · **Revision:** Cycle 2 — resolves all 13 findings (H1–H4, M1–M6, L1–L3) from STOREFRONT-PLAN-V1-CRITIQUE.md · **Executor:** 1 senior full-stack dev · **Estimate:** 7.5–10 weeks
**Status:** Covers audit P0 items 1–6 only (see §12 Out of scope). V1 is retained at STOREFRONT-PLAN-V1.md for the audit trail.

---

## 1. Goal statement

**The storefronts deliverable after this plan executes:** a merchant can ship a real online store from DokanOS — homepage and content pages composed in an admin editor (sections, draft/publish, live preview), browsable collections, size/color variant purchasing end-to-end (product page → cart → checkout → `order_items`), per-page SEO (meta/OG/canonical, sitemap.xml, robots.txt, JSON-LD, stable product URLs), checkout behavior controlled by a per-storefront settings object, an oversell-safe, double-click-safe checkout (atomic place-order RPC + idempotency key), a working Track page behind phone verification — **and anonymous REST access to the orders family closed for good**.

Mapped to audit P0: §4.1 (builder) → Phase 1, §4.2 (collections) → Phase 2, §4.3 (variations) → Phase 3, §4.4 (SEO) → Phase 4, §4.5 (settings) → Phase 5, §4.6 (stock/idempotency) + §2.9.1/§2.9.3 → Phase 6.

**Non-goal guardrail:** we do NOT fork the POS pipeline. Storefront orders keep writing to the same `orders`/`order_items`/`order_timeline` tables via the `storefront-checkout` edge function (its write path moves into an atomic RPC in Phase 6, same tables).

---

## 2. Grounding facts (re-verified against source in cycle 2; corrections marked)

These constrain the design. Cycle-2 verification notes supersede V1 where they conflict.

1. **`products.stock_quantity` is an aggregate.** `sync_product_stock_from_locations` (`20260904000400`) recomputes `products.stock_quantity = SUM(product_locations.stock_quantity)` on every locations write, **summing ALL rows for the product_id — parent rows (`variation_id IS NULL`) AND variation rows together**. A direct `products.stock_quantity` write is overwritten by the next locations write.
2. **Woo stock-push triggers exist.** `trg_auto_push_product_stock` / `trg_auto_push_variation_stock` (`20260831000500`) enqueue `sync_queue` rows (`push_stock`, `idempotency_key LIKE 'stock:%'`, `ON CONFLICT (idempotency_key) DO NOTHING`) guarded by `woo_updated_at` echo checks. Storefront decrements propagate to Woo; the `ON CONFLICT` dedup means tests must assert "a stock-push row exists per affected product/variation", not exactly-N rows.
3. **`order_items` has no `variation_id` column** (DDL `20260407071618`). POS passes variations via `product_name` string concat (`"${name} - ${variationLabel}"`, `AddOrderDialog.tsx:844`). We add a real column, keep the label-in-name convention.
4. **`cart.ts` already carries `variation_id?`/`variation_label?`** — declared, never populated; merges by `(product_id, variation_id)`. Additive only.
5. **Variation attribute parsing exists in 3 places** (`AddOrderDialog.tsx:96`, `pos/VariationModal.tsx:24`, `MeasurementSlipPrint.tsx`). Extract one shared helper.
6. **[CORRECTED — H1] The anon policy on `orders` is ALIVE in the live DB.** `20260407074308` created `FOR ALL TO anon USING(true) WITH CHECK(true)` on orders, order_items, customers (and siblings on order_payments, order_timeline, product_variations per `20260408191701`). `20260412170009` attempted to drop all of them, but live-DB ground truth (orchestrator-verified, cycle 1): **orders anon access is OPEN** — Track.tsx works today *and* every order (name, phone, address, totals) is enumerable by order number via anon REST. Assume the sibling policies on `order_items`, `order_payments`, `order_timeline`, `customers`, `product_variations` survived too. Phase 6 must drop them (§9.1) — this is the plan's **deliberate exception #1** to expand-only (§10.3).
7. **`orders.source` CHECK is GONE; `'online'` is ambiguous.** [H3] The CHECK `source IN ('online','pos')` (`20260407071618:83`) was **dropped** by `20260415171221` (no re-add found in any migration). The checkout fn writes `source:"online"` (`storefront-checkout/index.ts:122`) — but so does Woo sync (`woo-sync/index.ts:653`), and `SourceBadge` renders `'online'` as "WooCommerce". Therefore `source` cannot discriminate storefront orders; Phase 6 adds a nullable **`orders.storefront_id`** marker instead.
8. **Storefront RLS is role-based, not business-scoped** (`20260516201928`): public SELECT gated on `is_active`, writes via `has_role(auth.uid(),'staff'|'admin')`. New storefront tables follow this pattern. Business-scoping retrofit is audit P2 #19 — out of scope (§12).
9. **[NEW] `storefront_pages` ALREADY EXISTS** (`20260516201928` §5): columns `(id, storefront_id, slug, title, body_md, is_active, created_at, updated_at)`, `UNIQUE(storefront_id, slug)`, public SELECT policy `is_active = true OR has_role(...)`, staff/admin writes. It is a **dead table** — zero app/runtime references (only generated types). Phase 1 EXPANDS this table (add columns, tighten the public policy), it does not CREATE it. A `CREATE TABLE storefront_pages` migration would fail on deploy.
10. **`storefront_collections` + junction `storefront_collection_products` fully exist** with RLS (public read, staff/admin write; junction `product_id` has NO FK; `(collection_id, product_id)` UNIQUE). Phase 2 needs zero new tables.
11. **Storefront runtime is anon-key** (`lib/catalog.ts`, `lib/brand.ts`); anon SELECT on `products` exists via `20260619164824` (`is_active=true`). No equivalent anon policy on `product_variations` exists in migrations — Phase 3 adds one (needed; the fn is the only current variation reader).
12. **[M4] `invoice_settings` is anon-denied.** RLS enabled (`20260412172337`) with authenticated-SELECT + admin-manage policies only. Shipping rate columns `shipping_inside_dhaka` / `shipping_outside_dhaka` (defaults 80/150) were added by `20260429001709`. The checkout fn (service role) reads them (`index.ts:83-85`); the anon storefront client cannot — which is why `Checkout.tsx` hard-codes 80/150.
13. **[M2] Three `stock_status` vocabularies.** `product_variations.stock_status` / `products.stock_status` default `'in_stock'` (DokanOS style, `20260408191701`); `product_locations.stock_status` CHECKs `'instock'/'outofstock'/'onbackorder'` (Woo style, `20260904000100`). Storefront availability must NOT gate on `stock_status` — gate on `manage_stock && stock_quantity` only.
14. **[L3] `product_locations.variation_id` is nullable, NULL-keyed for parent rows.** The unique index expression COALESCEs to a zero-uuid, but no sentinel value is ever written — rows on disk are NULL. Decrement predicates must use `variation_id IS NULL` / `variation_id = :v`, never a zero-uuid match.
15. **[M3] The `/storefronts` admin route has NO PermissionGuard** (`App.tsx:102` — every neighbor route has one; storefronts is the bare exception). The `app_permission` enum (verified full list: dashboard/orders/preorders/customers/products/pos/analytics/integrations/stores/settings/team/audit + `orders.attach_courier`) has **no `storefronts.view` value** — it must be added.
16. **[L2] The storefront product route is `/product/:slug`** (`StorefrontApp.tsx:34`), not `/products/:slug`. Sitemap/canonical/links must be built from a single route-helper module.
17. **Product slugs are read-time** (`slugify(name)+id.slice(0,6)`, `lib/catalog.ts:19-26`), no `products.slug` column.
18. **`storefront-checkout`** (161 lines, CORS `*`): validates price/stock from `products` only, computes shipping from `invoice_settings`, upserts `customers` (`source:'online'`), calls `generate_pos_order_number` (`p_source:'online'`), inserts `orders` (`source:'online'`, status pending) + `order_items` + `order_timeline`. No decrement, no idempotency. `generate-storefront-content` checks admin role (verified) — no fix needed.
19. **[M5] V1's sequencing self-contradiction is resolved:** single-dev order is pinned to **1 → 2 → 3 → 5 → 6 → 4** (§11); the "5 before 6" rationale and the ordering now agree.
20. **Repo conventions:** timestamp-named SQL migrations incl. `verify_*` assertion files; vitest (`npm run test`), eslint (`npm run lint`); no `typecheck` script (add one in Phase 1); `@playwright/test` present, no e2e suite — verification is unit + scripted + manual-checklist. `vercel.json` currently holds a single catch-all rewrite (`/(.*) → /index.html`); `public/robots.txt` is static, allow-all. PG15 (ALTER TYPE ADD VALUE usable in-transaction).

---

## 3. Phase overview

| # | Phase | Audit P0 | Effort | New/changed DB objects |
|---|---|---|---|---|
| 1 | Section-based page builder | #1 | 4–5 wk | expand existing `storefront_pages`; NEW `storefront_page_sections`; `storefronts.nav`; enum value `storefronts.view` |
| 2 | Collections wired up | #2 | 3–5 d | (none — tables exist; one index) |
| 3 | Product variations end-to-end | #3 | 1–1.5 wk | `order_items.variation_id`; anon SELECT policy on `product_variations` |
| 4 | SEO foundation | #4 | 5–7 d | `products.slug` (+ trigger + backfill + unique index); fns `storefront-sitemap`, `storefront-robots` |
| 5 | Storefront settings object | #5 | 3.5–5 d | `storefronts.settings`; fn `storefront-shipping-quote` |
| 6 | Atomic checkout, idempotency, Track, PII closure | #6 + §2.9.1/2.9.3 | 6–8 d | `orders.idempotency_key`, `orders.storefront_id`, `orders.stock_restored_at`; RPCs `storefront_place_order`, `storefront_restore_stock`; fn `storefront-track-order`; **DROP anon FOR ALL policies on orders family** |

Critical path: **Phase 1** (pages/sections substrate). Phases 2+3 independent; 5 before 6 (checkout write path extracted once, with settings already honored); 6 after 3 (RPC consumes `variation_id`); 4 last (sitemap needs pages + collections + stable slugs). Single-dev order: **1 → 2 → 3 → 5 → 6 → 4** (§11).

---

## 4. Phase 1 — Section-based page builder

**Goal:** Pages and homepage are data (rows + sections), edited in the admin with a per-section prop form, reorder/hide, live draft preview, publish action, behind a real permission gate. Existing storefronts render unchanged until an operator publishes a home page.

### 4.1 DB (migration `storefront_page_builder.sql` + `verify_storefront_page_builder.sql`)

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
CREATE UNIQUE INDEX uq_storefront_pages_one_home
  ON public.storefront_pages(storefront_id) WHERE type = 'home';

CREATE TABLE public.storefront_page_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.storefront_pages(id) ON DELETE CASCADE,
  type text NOT NULL,                        -- validated against registry in app code
  position integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sp_sections_page ON public.storefront_page_sections(page_id, position);

ALTER TABLE public.storefronts ADD COLUMN IF NOT EXISTS nav jsonb NOT NULL DEFAULT '[]'::jsonb;
```

**RLS:**
- `storefront_page_sections` — **staff/admin only** (H4). `TO authenticated` policies using `has_role(auth.uid(),'admin') OR has_role(auth.uid(),'staff')` for SELECT/INSERT/UPDATE/DELETE. **NO anon/public policy at all.** The runtime reads published content from `published_snapshot` jsonb on the `storefront_pages` row — anon never needs the sections table; the working copy (draft edits of a published page) must not be anon-readable.
- `storefront_pages` — **tighten the existing public policy** (H4 extension; deliberate exception #2, §10.3): DROP `Public can read storefront_pages`, CREATE `Public can read published storefront pages` `FOR SELECT TO anon, authenticated USING (status = 'published' AND EXISTS (SELECT 1 FROM public.storefronts s WHERE s.id = storefront_id AND s.is_active))`. Staff keep full access via a `TO authenticated` has_role policy (the old policy's `OR has_role(...)` arm is replaced by explicit staff policies). The old `is_active = true OR ...` policy would leak drafts (every new page defaults `is_active=true, status='draft'`). Table is dead in code (verified) — the tighten is safe.
- `storefronts.nav` — covered by existing `storefronts` policies.

**Permission enum (M3, same migration):**

```sql
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'storefronts.view';
UPDATE public.role_permissions SET permissions = array_append(permissions, 'storefronts.view')
WHERE is_system = true AND permissions @> ARRAY['stores.view']::app_permission[];
```
(Admins get every enum value automatically via `get_user_permissions` → `enum_range`; the UPDATE grants it to system roles that already manage stores. PG15 allows ADD VALUE + use in one transaction.)

**Backfill (same migration):** for every storefront insert `ON CONFLICT (storefront_id, slug) DO NOTHING` (guards pre-existing rows in the dead table):
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

### 4.4 Admin UI

Refactor first (no behavior change): split `StorefrontsPage.tsx` (818 lines) tabs into `src/components/storefront-admin/{BrandProfileTab,SocialPoliciesTab,DomainsTab,ProductsTab}.tsx`; shell ~150 lines. Then:
- **Route guard (M3):** `App.tsx` — `<Route path="/storefronts" element={<PermissionGuard permission="storefronts.view"><StorefrontsPage /></PermissionGuard>} />` + the preview route (§4.3). This is a first-class task, not a footnote: the admin surface (incl. draft previews) gets a real permission gate alongside RLS.
- `PagesTab.tsx`: page list per storefront (create with title+slug+type, duplicate, delete, status badge, publish/unpublish), section editor (ordered list, add via type picker, reorder, visible-toggle, delete; generic prop form from `adminFields`), per-page SEO fields (stored now in `seo`, surfaced fully in Phase 4), nav editor (label+href rows).
- Publish action: copy visible sorted sections into `published_snapshot`, set `status='published', published_at=now()` in one update. Live-preview iframe (`/storefronts/preview/:slug/:pageSlug`) above the editor.
- **Save clobber detection (§13):** section/page saves are last-write-wins; every save sends the row's `updated_at` it was based on and the update matches `WHERE id = ? AND updated_at = <base>` — zero-rows-updated → conflict toast prompting reload. Detects clobbers; does not resolve them (v1 accepts this, stated in §13).
- Update the `Storefront` TS interface (`BrandContext.tsx` / `brand.ts` / `StorefrontsPage.tsx`) with `nav`; regenerate `src/integrations/supabase/types.ts` after the migration.

### 4.5 Migration/rollout

Expand-only for schema (columns on existing dead table + new sections table + enum value); the two policy changes (sections table gets no public policy; pages public policy tightened) are contract-tightening on **tables with zero live readers** — owned as exceptions in §10.3. Backfill creates drafts only; runtime legacy fallback = built-in rollback (unpublish or app revert).

### 4.6 Verification

- `verify_storefront_page_builder.sql`: `storefront_pages` has new columns; `storefront_page_sections` exists with RLS enabled and **policy count = 4 (staff-only), zero policies containing `TO anon`**; `storefront_pages` public policy requires `status='published'`; enum contains `storefronts.view`; backfilled `home` drafts = storefront count; no published pages; `uq_storefront_pages_one_home` enforced (insert second home → fails).
- Vitest: registry completeness; `validate()` table-driven rejection per type; slug rules; `pages.ts` snapshot→sections mapping; clobber-detection reducer.
- Manual: create→preview→publish a home page; **anon-key REST GET on a section row of a published page returns empty (H4)**; anon-key GET on a draft page row returns empty; storefront domain shows new home; second storefront shows legacy layout; `/pages/:slug` 404s unknown; a non-admin authenticated user without `storefronts.view` sees the guard's access-denied fallback on `/storefronts` (M3); admin/staff can preview drafts.
- `npm run lint` + new `npm run typecheck` (`tsc --noEmit` script added here).

**Effort:** 4–5 weeks (schema+runtime 1 wk, admin editor+preview+guard 1.5–2 wk, registry+polish+tests 1 wk, buffer).

---

## 5. Phase 2 — Wire up collections

**Goal:** Shop browsable by collection; collections managed in admin; the `collection-grid` section becomes functional. Zero new tables.

### 5.1 DB
One migration: `CREATE INDEX idx_scp_collection_pos ON public.storefront_collection_products(collection_id, position);` + verify file. (Tables, RLS, junction all exist — fact 10.)

### 5.2 Runtime
- `src/storefront/lib/collections.ts` — `listCollections(storefrontId)` (active, ordered), `getCollectionWithProducts(storefrontId, slug)` (junction products joined via existing `catalog.ts` mapping, respecting `is_active`; junction rows whose `product_id` no longer exists are filtered at render — junction has no FK, real FK is a contract-phase item).
- `Shop.tsx`: horizontal collection tab strip (All + active collections), client-side filter over loaded products. No faceting (P1).
- `StorefrontApp.tsx`: route `${basePath}/collections/:slug`; new `src/storefront/pages/Collection.tsx` (header from collection row + grid reusing `ProductCard`).
- `CollectionGrid` section: active collections as cards linking `/collections/:slug` (via the §7.1 route helper).
- SEO stub: collection title = `${title} — ${storefront.name}` (Phase 4 wires full meta).

### 5.3 Admin
`CollectionsTab.tsx`: list (title, slug, active, position, product count), create/edit dialog, delete (cascade clears junction), inline product picker (search like ProductsTab; add/remove/reorder via position).

### 5.4 Verification
- Verify migration: index exists, policies unchanged, dead-table status resolved.
- Manual: create collection with 3 products → Shop tab; `/collections/:slug` renders; `collection-grid` on published home renders cards; deleting a catalog product doesn't break the tab (filtered at render).
- Vitest: collection-filter helpers.

**Effort:** 3–5 days.

---

## 6. Phase 3 — Product variations on storefront + checkout

**Goal:** Customer picks size/color on the product page; the chosen variation's price/stock flows cart → `storefront-checkout` → `order_items`, validated server-side.

### 6.1 DB (migration + verify)
- `ALTER TABLE public.order_items ADD COLUMN variation_id uuid REFERENCES public.product_variations(id) ON DELETE SET NULL;` (nullable, expand-only).
- `CREATE POLICY "Public can read product variations" ON public.product_variations FOR SELECT TO anon, authenticated USING (true);` — **required** (fact 11: no anon policy exists anywhere in migrations; storefront runtime is anon-key; per-row `is_active`-style gating is impossible here and unnecessary — variation rows carry no sensitive data, product-activeness is enforced by joining through `products` in `catalog.ts`).
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
- `order_items` insert: `product_id`, `variation_id`, `product_name = variationLabel ? "${name} - ${label}" : name` (POS convention, fact 3), `unit_price` = effective price.
- Stock decrement NOT added here — Phase 6 (validation-only until then, same race window as today).

### 6.5 Deploy order (explicit, per cycle-1 quality note)
**Migration first, fn second, app third.** The fn writes `order_items.variation_id` before the column exists → every insert errors. This ordering is a hard checklist item, mirrored from §9.5's discipline.

### 6.6 Verification
- Verify migration: column + FK + policy applied; stock_status distribution query present.
- Vitest: `lib/variations.ts` parsing (fixtures copied from the three current implementations: string, array-of-objects, array-of-arrays); cart merge by `(product_id, variation_id)`.
- Manual: pick size/color → price/stock update; add to cart (label shown); checkout; fn rejects qty > variation stock; fn rejects cross-product `variation_id` (400); Orders UI shows "Kurta - Size: L"; product without variations unchanged.
- `supabase functions serve` + crafted payloads.

**Effort:** 1–1.5 weeks.

---

## 7. Phase 4 — SEO foundation

**Goal:** Per-page meta; stable product URLs; per-storefront `sitemap.xml` + spec-valid `robots.txt`; Product/Organization/Breadcrumb JSON-LD. (CSR-only remains — prerendering out of scope, §12.)

### 7.1 Route helper first (L2)
New `src/storefront/lib/routes.ts` — single source of truth: `productUrl(slug) → ${base}/product/:slug` (**actual route shape, `StorefrontApp.tsx:34` — V1's `/products/:slug` was wrong**), `collectionUrl(slug)`, `pageUrl(slug)`, `shopUrl()`. All Link components, canonicals, and the sitemap fn use constants mirrored from this module; a fixture test asserts parity (§7.5).

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

**Effort:** 5–7 days.

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

**Goal:** Checkout is oversell-safe and double-click-safe with **no cross-call race window at all** (H2); cancel restores stock exactly once; Track works via phone-verified edge fn; **anon REST on the orders family is closed** (H1).

### 9.1 DB (migration `checkout_atomic_idempotency.sql` + verify)
```sql
ALTER TABLE public.orders ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX uq_orders_idempotency_key
  ON public.orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.orders ADD COLUMN storefront_id uuid REFERENCES public.storefronts(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN stock_restored_at timestamptz;

-- H1: close the PII hole — the plan's deliberate exception #1 to expand-only (§10.3).
-- 20260412170009 attempted these drops; live DB still has the orders policy open, so re-run
-- idempotently and verify. Product anon read is NOT affected (20260619164824 grants
-- SELECT on active products separately); pathao tables are separately public read-only by design.
DROP POLICY IF EXISTS "Allow anonymous access to orders"            ON public.orders;
DROP POLICY IF EXISTS "Allow anonymous access to order_items"        ON public.order_items;
DROP POLICY IF EXISTS "Allow anonymous access to order_payments"     ON public.order_payments;
DROP POLICY IF EXISTS "Allow anonymous access to order_timeline"     ON public.order_timeline;
DROP POLICY IF EXISTS "Allow anonymous access to customers"          ON public.customers;
DROP POLICY IF EXISTS "Allow anonymous access to product_variations" ON public.product_variations;
-- (product_variations is immediately re-granted SELECT-only below — Phase 3 already added it;
--  drop-then-recreate keeps this migration self-contained if Phase 3's policy naming differs)
CREATE POLICY "Public can read product variations" ON public.product_variations
  FOR SELECT TO anon, authenticated USING (true);
```

**Atomic place-order RPC (H2 — replaces the two-step reserve+insert design):**
```sql
CREATE OR REPLACE FUNCTION public.storefront_place_order(p_payload jsonb)
RETURNS jsonb  -- {order_id, order_number, deduped}
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- p_payload: {idempotency_key, storefront_id, store_id, customer_id, order fields (number,
--   source='online', status, payment_*, totals, shipping_cost, pathao fields),
--   items: [{product_id, variation_id?, quantity, unit_price, product_name, line_total}]}
-- 1. INSERT the orders row (idempotency_key, storefront_id) FIRST.
--    Unique partial index serializes same-key races: the loser blocks on the in-flight
--    insert, gets 23505 after commit → exception block SELECTs the committed row by key
--    → RETURN {order_id, order_number, deduped:true}. NO stock was touched by the loser.
-- 2. Per item, SELECT products (and product_variations when variation_id) FOR UPDATE:
--    validate manage_stock → stock_quantity >= qty (P0001 with item name on failure).
--    ROLLBACK on any failure discards the step-1 order row — no partial state, no
--    compensation call, no cross-call window (deletes V1 §13 risk 2 entirely).
-- 3. Decrement, two cases (facts 1, 14 — predicates are NULL-based, never zero-uuid):
--    CASE A rows exist in product_locations:
--      variation item  → decrement rows WHERE product_id = p AND variation_id = v  (FIFO by created_at);
--                        if their SUM < qty, fall back to parent rows (variation_id IS NULL) to cover the remainder;
--      non-variation item → decrement rows WHERE product_id = p AND variation_id IS NULL.
--      The sync trigger recomputes products.stock_quantity from ALL rows (parent+variation
--      both feed the aggregate — decrementing variation-keyed rows lowers the product
--      aggregate by the same qty; do NOT also touch parent rows for the same qty = no double count).
--    CASE B zero location rows for the product → UPDATE products SET stock_quantity = stock_quantity - qty.
--    Always, when variation_id → UPDATE product_variations SET stock_quantity = stock_quantity - qty.
--    (Every decrement path fires the woo auto_push_* triggers — desired, echo-guarded.)
-- 4. INSERT order_items (+ variation_id) and the order_timeline row.
-- 5. RETURN {order_id, order_number, deduped:false}.
$$;

CREATE OR REPLACE FUNCTION public.storefront_restore_stock(p_order_id uuid) RETURNS void
  -- locks the orders row; no-op + notice when stock_restored_at IS NOT NULL;
  -- sets stock_restored_at = now() in the same transaction; restores ONLY when
  -- storefront_id IS NOT NULL (H3 discriminator — see 9.3) and status transitioned
  -- from a decrementing lifecycle; reverse of §9.1 step-3 with the same NULL-keyed
  -- location predicates and products-leadger recompute via the sync trigger.
```
Both RPCs: `REVOKE ... FROM PUBLIC, anon, authenticated;` (defense in depth — the edge fn runs service role and bypasses grants).

Note on `orders.source` (H3): the CHECK constraint was already dropped (`20260415171221`), so `'storefront'` would not error — but it must NOT be used anyway: Woo sync also writes `'online'` (`woo-sync/index.ts:653`), making source values ambiguous. The fn keeps `source='online'` (Orders-UI/`SourceBadge` compatibility preserved) and the RPC stamps **`storefront_id`** as the storefront-order discriminator. The V1 parenthetical "if it already writes a distinct source, keep it" is deleted — it was the bug.

### 9.2 Edge function `storefront-checkout` (rewrite 3 of 3 — final shape)
- Accept `idempotency_key` (client `crypto.randomUUID()`, persisted per cart in localStorage until success — `Checkout.tsx`).
- Flow: validate payload (Phase 3 variation checks + Phase 5 settings) → fetch products/variations, validate prices, compute shipping from `invoice_settings` + settings (all read-only, service role) → upsert customer (as today) → generate order number (as today) → **single RPC call `storefront_place_order`** with the assembled payload → map RPC result.
  - `deduped:true` → 200 with the original order_id/order_number.
  - RPC P0001 (out of stock) → 400 with the item message. No partial state is possible — the order insert and the decrements share one transaction.
- No compensation logic, no 23505 catch in the fn (handled inside the RPC), no accepted-mitigation comments. The edge fn never decrements stock itself.

### 9.3 Cancel-restores-stock wiring (H3 discriminator)
`OrderDetailSheet.tsx` cancel path: when `order.storefront_id IS NOT NULL` (**not** `source === 'storefront'` — V1's condition was dead code), after status update to `cancelled`, call `storefront_restore_stock(order_id)`; toast "Inventory restored". Bulk cancel: same call per order; failures reported, not fatal (restore is idempotent via `stock_restored_at`). POS `ReturnDialog` restock untouched. `SourceBadge` optionally gains a "Storefront" badge keyed on `storefront_id` (small polish, not required).

### 9.4 Track page fix (audit §2.9.1 / H1)
- New `supabase/functions/storefront-track-order/index.ts`: POST `{order_number, phone}` (phone now REQUIRED) → normalize phone (strip non-digits; match exact OR last-6) → service-role SELECT of `order_number,status,tracking_status,payment_status,total,created_at,consignment_id,customer_phone` by order_number → phone mismatch → `{error:"Order not found"}` (404-shape, no oracle) → return the limited fields only.
- `Track.tsx`: add phone input; replace the anon-key `orders` query with the edge call. **Deploy sequencing within the phase (same release window): migration (§9.1 policy drops) → fns (`storefront-checkout`, `storefront-track-order`) → app.** Old Track breaks the moment the anon policy drops — the app deploy in the same window replaces it; do not stage the migration days ahead.

### 9.5 Migration/rollout
Expand-only columns/indexes/RPCs + the two owned exceptions (§10.3): H1 policy drops (orders family) and nothing else — Phase 1's pages-policy tighten already shipped in Phase 1. **Highest-risk phase.** Rollback: revert fn + app; RPCs/columns inert without the fn; the anon policy drops are NOT auto-reverted (restoring an anon PII hole is not a rollback we want — if the Track fn must revert, re-add a minimal anon SELECT policy as a deliberate decision, documented). Emergency switch = repoint checkout to previous fn version (Supabase fn versioning); stock drift corrected via Woo resync (locations remain the source of truth in Case A).

### 9.6 Verification
- Verify migration: columns/indexes/RPCs exist; **`pg_policies` shows zero `TO anon` policies on orders, order_items, order_payments, order_timeline, customers; `product_variations` has exactly the SELECT-only public policy** (H1 — this assertion is only now meaningful).
- RPC fixtures (both ledgers): place an order on a Case-B product and a Case-A product with locations (parent rows and variation rows); assert `products.stock_quantity` equals the location SUM, variation rows decremented, order_items carry `variation_id`, `storefront_id` set, `sync_queue` contains a stock-push row per affected product/variation (fact 2 dedup).
- **Race test (L1 — genuinely concurrent, not sequential):** new `scripts/idempotency-race-test.mjs` — Node, `Promise.all` two POSTs to `storefront-checkout` with the SAME idempotency_key: assert BOTH 200, identical order_number, exactly one order row, stock decremented exactly once. Second scenario: same key, stock=1, qty=1, both fired concurrently → both 200 deduped (the loser never reached stock because the winner's insert serializes it). Third: two DIFFERENT keys, stock=1 → one 200, one 400 out-of-stock. (V1's serial `for i in 1..2: curl` verified retries, not races — this script replaces it.)
- Cancel flow: cancel a storefront order (storefront_id set) → stock restored exactly once (second cancel no-op, `stock_restored_at` set); POS order cancel does NOT restore; order with `storefront_id IS NULL` never restores.
- Track: wrong phone → not-found (no oracle); right phone → status rendered; **anon-key REST SELECT on `orders`/`order_items`/`customers` returns empty/error** (H1 end-to-end).

**Effort:** 6–8 days (re-estimated from V1's 4–6 per cycle-1 quality note: H1 drops + verify, H2 atomic RPC, H3 discriminator now land here).

---

## 10. Cross-cutting concerns

### 10.1 RLS — every new/changed object
| Object | Public (anon) | Staff/Admin |
|---|---|---|
| `storefront_pages` (existing, expanded) | SELECT **tightened**: `status='published' AND storefront is_active` (exception #2) | ALL via has_role policies |
| `storefront_page_sections` | **NONE — no public policy at all** (H4; runtime reads `published_snapshot`; drafts+working copies invisible to anon) | ALL via has_role policies |
| `storefronts.nav`, `storefronts.settings` | covered by existing `storefronts` SELECT (is_active gate) | covered by existing UPDATE policy |
| `order_items.variation_id` | follows `order_items` (no anon after Phase 6 drop — H1) | unchanged |
| `product_variations` | SELECT `USING (true)` (Phase 3; re-asserted in Phase 6 drop/re-create) | existing |
| `products.slug` | follows `products` (20260619 policy unaffected) | existing |
| `orders.idempotency_key/.storefront_id/.stock_restored_at` | no new policy; anon has NONE (H1 drop) | existing |
| orders family (orders, order_items, order_payments, order_timeline, customers) | **H1: FOR ALL anon policies dropped** (exception #1) | unchanged |
| RPCs `storefront_place_order`/`storefront_restore_stock` | no execute for PUBLIC/anon/authenticated (service-role fn only) | — |

New policies copy the `20260516201928` style verbatim (`has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'staff'::app_role)`). Business-scoping retrofit (P2 #19) remains out of scope — first item of the follow-up.

### 10.2 Permissions wiring (M3 corrected)
- `/storefronts` and `/storefronts/preview/:slug/:pageSlug` sit behind `<PermissionGuard permission="storefronts.view">` (new enum value, Phase 1 migration). Previously `/storefronts` was the one admin route with NO guard (`App.tsx:102`) — V1's "already sit behind PermissionGuard" claim was false.
- Preview route additionally requires an authenticated session (it lives in the authenticated routes block; draft reads go through the staff client — RLS is the server-side enforcement).
- Edge fns `storefront-checkout`/`-sitemap`/`-robots`/`-shipping-quote`/`-track-order` are public CORS `*` by design (public commerce surface); per-storefront rate limiting is P2 #20 (§12). `generate-storefront-content` role check already correct (fact 18).

### 10.3 Rollback strategy + owned exceptions to expand-only
This plan is expand-only **except two deliberate, named exceptions** (no smuggling):
1. **H1 (Phase 6):** DROP the anon `FOR ALL` policies on orders, order_items, order_payments, order_timeline, customers (and drop/re-create the product_variations SELECT). Justification: audit §2.9.1 critical PII finding; the Track edge fn is the replacement access path; V1's factual basis ("already dropped") was wrong.
2. **H4-adjacent (Phase 1):** DROP/re-CREATE the dead `storefront_pages` public SELECT policy (published-only). Justification: the existing `is_active` policy would leak drafts; the table has zero live readers.

`orders.source` needs NO constraint change (the CHECK was already dropped by `20260415171221` — verified; H3 resolved via the `storefront_id` column instead).

Per-phase rollback:
1. **Builder:** unpublish page / app revert; legacy components never deleted in-plan.
2. **Collections:** app revert only (additive index).
3. **Variations:** app + fn revert; column inert. **Deploy order: migration → fn → app** (fn writes the column).
4. **SEO:** app revert; slug column/trigger harmless; remove the two rewrites if misbehaving.
5. **Settings:** app + fn revert; `{}` defaults = old behavior.
6. **Atomic/PII:** fn versioning rollback (§9.5); schema inert without fn; anon drops NOT auto-reverted (§9.5).

---

## 11. Sequencing rationale (contradiction removed — M5)

- **Phase 1 first** — critical path and substrate: `seo` columns (Phase 4), `collection-grid` (Phase 2), announcement layout (Phase 5), page URLs (sitemap).
- **Phases 2 and 3** independent; 2 admin-heavy, 3 runtime/fn-heavy — parallelize cleanly behind 1 with a second dev.
- **Phase 5 before 6** — both rewrite `storefront-checkout`; settings land first so Phase 6 extracts the write path into the atomic RPC **once**, with settings already enforced. (V1's single-dev order ended `…6 → 4 → 5`, contradicting this — fixed.)
- **Phase 6 after 3** — the place-order RPC validates/decrements `product_variations`.
- **Phase 4 last** — sitemap enumerates pages + collections + stable-slugged products; JSON-LD wants variation-aware price and the manage_stock availability predicate; sequencing keeps SEO testable end-to-end in one phase.
- **Single-dev order: `1 → 2 → 3 → 5 → 6 → 4`.** (Two-dev split: dev A runs 1 → 4; dev B runs 2 → 3 → 5 → 6 after 1 lands.)

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

1. **Two-ledger stock drift** (`product_variations.stock_quantity` vs `product_locations` variation rows): Phase 6 decrements both coherently (§9.1 step 3); verify fixtures assert ledger equality; POS direct-write drift is pre-existing and tracked as follow-up.
2. **~~Reserve-then-insert compensation gap~~ — deleted (H2).** The atomic `storefront_place_order` RPC has no cross-call window; the V1 "accepted mitigation" comment and this risk are gone by construction.
3. **Section props are free-form jsonb** — validated in app code only; renderer is defensive (unknown type/bad props render nothing, logged).
4. **Sitemap on shared main domain** — v1 serves per-storefront hosts/`?slug=`; main-domain index sitemap is a follow-up. `x-forwarded-host` is client-spoofable when hitting the supabase host directly — it only selects which public storefront's sitemap is served; documented, accepted.
5. **Backfilled draft home pages** don't perfectly reproduce the 4 theme layouts — intentional; operators publish when satisfied; legacy fallback preserves status quo.
6. **Section editing is last-write-wins** (no real-time collaboration) — accepted for v1; saves compare `updated_at` and surface a conflict toast on clobber (§4.4). No merge UI.
7. **Track deploys in a same-window release with the anon policy drop** — a deliberately tight sequencing (§9.4); the alternative (staged migration) leaves Track broken for the gap.

---

## 14. Cycle 2 change log (finding → change)

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
| **M5** | §3 and §11 now agree: single-dev order pinned to `1 → 2 → 3 → 5 → 6 → 4`; the contradictory `…6 → 4 → 5` bullet is gone; Phase 6 re-estimated 6–8 d (total 7.5–10 wk). |
| **M6** | §12 gains explicit deferred-P0 entries with one-line rationales: `contact-form` (no submission backend until P1 #11), `newsletter` (no capture backend until P1 #9), editable header/footer (P1 #7 theme system). Registry doc lists them as deferred types. |
| **L1** | §9.6 replaces serial curls with `scripts/idempotency-race-test.mjs` — `Promise.all` concurrent same-key requests (both 200, one order, one decrement), stock=1 qty=1 same-key case, and different-keys stock=1 case. |
| **L2** | §7.1 adds `src/storefront/lib/routes.ts` as the single URL source (`/product/:slug` — actual route, V1's `/products/:slug` corrected); sitemap fn + canonicals + breadcrumbs all derive from it; §7.5 vitest asserts fn/TS parity. |
| **L3** | §9.1 step 3 predicates written NULL-based (`variation_id IS NULL` / `= :v`), zero-uuid coalesce removed; variation-row decrement behavior specified against the aggregate's product_id-only SUM (no parent+variation double count); fixtures assert the aggregate. |

Additional cycle-2 corrections beyond the 13 findings (both verified this cycle): Phase 1 migrates an **existing** `storefront_pages` table (V1 would have failed on deploy), and Phase 3 carries an explicit migration→fn→app deploy order (cycle-1 quality note).
