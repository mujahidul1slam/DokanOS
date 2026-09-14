# Storefront P0 Implementation Plan — V1

**Source:** STOREFRONT-AUDIT.md (2026-09-09) · **Executor:** 1 senior full-stack dev · **Estimate:** 7–9.5 weeks
**Status:** Draft for adversarial review. This plan covers audit P0 items 1–6 only (see §9 Out of scope).

---

## 1. Goal statement

**The storefronts deliverable after this plan executes:** a merchant can ship a real online store from DokanOS — one whose homepage and content pages they compose themselves in an admin editor (sections, draft/publish, live preview), with browsable collections, size/color variant purchasing end-to-end (product page → cart → checkout → `order_items`), correct per-page SEO (meta/OG/canonical, sitemap.xml, JSON-LD, stable product URLs), checkout behavior controlled by a per-storefront settings object, and an oversell-safe, double-click-safe checkout (atomic stock decrement + idempotency key) plus a working, non-leaky order tracking page.

Mapped to audit P0: §4.1 (builder) → Phase 1, §4.2 (collections) → Phase 2, §4.3 (variations) → Phase 3, §4.4 (SEO) → Phase 4, §4.5 (settings) → Phase 5, §4.6 (stock/idempotency) + security findings §2.9.1/§2.9.3 (Track anon access, checkout idempotency) → Phase 6.

**Non-goal guardrail:** we do NOT fork the POS pipeline. Storefront orders keep writing to the same `orders`/`order_items`/`order_timeline` tables via the same `storefront-checkout` edge function.

---

## 2. Grounding facts (verified against source, not re-audited)

These constrain the design; the critic should check conclusions against these, not re-derive them:

1. **`products.stock_quantity` is an aggregate.** Migration `20260904000400` added trigger `sync_product_stock_from_locations` that recomputes `products.stock_quantity = SUM(product_locations.stock_quantity)` on every `product_locations` write. A direct `products.stock_quantity` write is silently **overwritten** by the next locations write. Any stock RPC must handle both products-with-locations and products-without.
2. **Woo stock-push triggers exist.** `trg_auto_push_product_stock` / `trg_auto_push_variation_stock` (`20260831000500`) enqueue Woo syncs when `products`/`product_variations` stock changes (echo-guarded by `woo_updated_at`). A storefront decrement will therefore propagate to Woo automatically — desired, but tests must assert it fires exactly once.
3. **`order_items` has no `variation_id` column.** POS passes variations via `product_name` string concat (`"${name} - ${variationLabel}"`, `src/components/orders/AddOrderDialog.tsx:844`). We add a real column but keep the label-in-name convention for Orders-UI compatibility.
4. **`cart.ts` already carries `variation_id?`/`variation_label?`** — declared, never populated. Cart changes are additive.
5. **Variation attribute parsing exists in 3 places** (`AddOrderDialog.tsx:96`, `pos/VariationModal.tsx:24`, `MeasurementSlipPrint.tsx`) with slightly different logic. Extract one shared helper.
6. **Track page is currently broken, not leaking.** The anon policy on `orders` (`20260407074308`) was dropped in `20260412170009`; only "Authenticated can read orders" (`20260415001620`) remains. `Track.tsx` queries `orders` with the anon key → returns null silently. Fix = restore the feature via a phone-verified edge function, not just close a hole.
7. **Storefront RLS pattern is role-based, not business-scoped**: public SELECT gated on `is_active`, writes via `has_role(auth.uid(),'staff'|'admin')` (migration `20260516201928`). New storefront tables follow this same pattern. Business-scoping retrofit (`storefronts` has no `business_id`) is audit P2 #19 — explicitly out of scope (§9).
8. **`storefront_collections` + junction `storefront_collection_products` fully exist** with RLS (public read, staff/admin write) — Phase 2 needs zero new tables.
9. **Storefront runtime reads `products` via anon key** (`lib/catalog.ts`) and works, so an anon-read path for products exists in the live DB (policy history is ambiguous in migrations — Phase 3 must verify `product_variations` anon read and add it if absent).
10. **Product slugs are read-time** (`slugify(name)+id.slice(0,6)`, `lib/catalog.ts`), no `products.slug` column.
11. **`storefront-checkout` runs on the service role**, validates price/stock from `products` only (no variation price/stock), computes shipping from `invoice_settings` (80/150 defaults), no decrement, no idempotency, CORS `*`. `generate-storefront-content` does check admin role (verified) — no fix needed there.
12. **Repo conventions:** timestamp-named SQL migrations incl. `verify_*` assertion migrations; vitest (`npm run test`), eslint (`npm run lint`); no `typecheck` script (add one); `@playwright/test` present but no e2e suite — verification below is unit + manual-checklist.
13. **`Checkout.tsx` mirrors shipping logic client-side** (80/150 hard-coded, line-level), payment methods hard-coded, no min-order.
14. **Admin editor** = single `src/pages/StorefrontsPage.tsx` (818 lines, 4 tabs), live-save only.

---

## 3. Phase overview

| # | Phase | Audit P0 | Effort | New/changed DB objects |
|---|---|---|---|---|
| 1 | Section-based page builder | #1 | 3.5–5 wk | `storefront_pages`, `storefront_page_sections`, `storefronts.nav` |
| 2 | Collections wired up | #2 | 3–5 d | (none — tables exist; one index) |
| 3 | Product variations end-to-end | #3 | 1–1.5 wk | `order_items.variation_id`; anon policy on `product_variations` |
| 4 | SEO foundation | #4 | 4–6 d | `products.slug` (+ trigger + backfill); `storefront-sitemap` fn |
| 5 | Storefront settings object | #5 | 3–4 d | `storefronts.settings` |
| 6 | Stock decrement + idempotency + Track fix | #6 + §2.9.1/2.9.3 | 4–6 d | `orders.idempotency_key`, `orders.stock_restored_at`, RPCs `storefront_reserve_stock`/`storefront_restore_stock`; `storefront-track-order` fn |

Critical path: **Phase 1** (everything lands on pages/sections). Phases 2+3 are independent of each other; 6 must follow 3 (RPC consumes `variation_id`); 4 must follow 1–3 (sitemap/JSON-LD need pages, collections, stable slugs); 5 is small and independent but is sequenced before 6 so `storefront-checkout` is rewritten once.

---

## 4. Phase 1 — Section-based page builder

**Goal:** Pages and homepage are data (rows + sections), edited in the admin with a per-section prop form, reorder/hide, live draft preview, and a publish action. Existing storefronts render unchanged until an operator publishes a home page.

### 4.1 DB (migration `storefront_pages.sql` + `verify_storefront_pages.sql`)

```sql
CREATE TABLE public.storefront_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id uuid NOT NULL REFERENCES public.storefronts(id) ON DELETE CASCADE,
  slug text NOT NULL,                       -- 'home', 'about', 'size-guide', ...
  title text NOT NULL,
  type text NOT NULL DEFAULT 'custom'
    CHECK (type IN ('home','custom')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {title, description, og_image_url}
  published_snapshot jsonb,                 -- array of {type,position,is_visible,props}; NULL while draft-only
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storefront_id, slug)               -- exactly ONE 'home' row per storefront (enforced by partial unique index below)
);
CREATE UNIQUE INDEX uq_storefront_pages_one_home
  ON public.storefront_pages(storefront_id) WHERE type = 'home';
-- sections = working copy (draft)
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
ALTER TABLE public.storefronts ADD COLUMN nav jsonb NOT NULL DEFAULT '[]'::jsonb;  -- [{label, href, position}]
```

**RLS (mirror the `storefronts` pattern, fact 7):**
- `storefront_pages` SELECT to `anon, authenticated`: `status = 'published' AND EXISTS (SELECT 1 FROM public.storefronts s WHERE s.id = storefront_id AND s.is_active)`; PLUS a staff policy: `has_role(auth.uid(),'staff'|'admin')` full access (INSERT/UPDATE/DELETE `TO authenticated` with `WITH CHECK`). Drafts are unreadable to anon — preview relies on the staff session.
- `storefront_page_sections` same split: public read only via published parent page (`EXISTS (... p JOIN storefronts s ... p.status='published' AND s.is_active)`), staff/admin write.
- `storefronts.nav` covered by existing `storefronts` policies.

**Backfill (same migration, expand-only):** for every storefront insert:
- `home` page, status `draft`, sections: `hero` (props from `hero_title`/`hero_subtitle`/`hero_image_url`), `featured-products` (title "Featured", limit 8).
- `about` page (draft, one `rich-text` section from `about_md`), `policies` page (draft, `rich-text` sections from `policies` jsonb keys: shipping/returns/privacy — render policy markdown stacked).
- `nav` default: `[Shop /shop, About /about, Track /track, Contact /contact]` — matches today's hard-coded nav (`StorefrontLayout.tsx`).

Nothing auto-publishes. Runtime keeps legacy components for storefronts without a published page → **zero visual change on deploy**.

### 4.2 Section component registry (v1: 9 types)

New files:
- `src/storefront/sections/registry.ts` — `{ [type]: { component, defaultProps, validate(props): string[] , adminFields: FieldDef[] } }`. `adminFields` is a declarative form schema (text/textarea/number/toggle/select/strings-list/image-url/list-of-objects) so ONE generic prop-form component serves all types. `validate` runs on save (admin) and is defensive no-op-safe at render.
- `src/storefront/sections/{Hero,FeaturedProducts,ProductGrid,CollectionGrid,RichText,ImageBanner,Gallery,Testimonials,Faq}.tsx`
- `src/storefront/sections/SectionRenderer.tsx` — switch on type, render with theme CSS vars; unknown type → render nothing (forward-compat).

Props contracts (validated by `validate`, enforced only in app code — `props` stays free-form jsonb):

| type | props |
|---|---|
| `hero` | `title, subtitle, image_url, cta_label?, cta_href?, align(left\|center), overlay(0–100)` |
| `featured-products` | `title, limit(1–12, def 8), columns(2–4, def 4)` — renders `storefront_products` where `is_featured` |
| `product-grid` | `title, product_ids: uuid[], columns` |
| `collection-grid` | `title, collection_ids: uuid[], columns` — **renders "no collections yet" empty state until Phase 2** |
| `rich-text` | `title?, markdown` (reuse `lib/md.tsx`) |
| `image-banner` | `image_url, href?, height(s\|m\|l), overlay` |
| `gallery` | `title?, images: [{url, alt?}]` |
| `testimonials` | `title?, items: [{quote, author, role?}]` |
| `faq` | `title?, items: [{q, a}]` |

### 4.3 Runtime changes

- `src/storefront/lib/pages.ts` — `getPublishedPage(storefrontId, slug)` → `{ page, sections }` reading `storefront_pages` + `storefront_page_sections` via the published snapshot (single query on `storefront_pages`; sections come from `published_snapshot` jsonb). `listPublishedPages(storefrontId)` for nav/sitemap.
- `Home.tsx`: if a published `home` page exists → render `<SectionRenderer>` over its snapshot; else render existing 4-theme layout (keep `getLayoutStyle` — Phase 1 does not delete it; it becomes the fallback and future theme seed).
- `About.tsx` / `Policies.tsx`: if a published page with slug `about`/`policies` exists → render its sections; else legacy content.
- `StorefrontApp.tsx`: add route `${basePath}/pages/:slug` for custom pages (published only — fetch returns null → 404 view). `StorefrontLayout.tsx`: render `storefronts.nav` when non-empty, else current hard-coded nav.
- Preview entry: new authenticated-only route in `src/App.tsx` — `/storefronts/preview/:slug/:pageSlug` renders `StorefrontApp` with brand override + `?preview=draft` mode (reads working-copy sections, not snapshot). Gate with existing auth guard + `has_role` client check (server-side enforcement is the RLS policy — anon/anon-key fetch of a draft returns nothing).

### 4.4 Admin UI

Refactor first (no behavior change): split `StorefrontsPage.tsx` tabs into `src/components/storefront-admin/{BrandProfileTab,SocialPoliciesTab,DomainsTab,ProductsTab}.tsx`; `StorefrontsPage.tsx` becomes the shell (~150 lines). Then add `PagesTab.tsx`:
- Page list per storefront: create (title + slug + type), duplicate, delete, status badge (Draft/Published), publish/unpublish buttons.
- Section editor: ordered list with add (type picker), up/down reorder, visible-toggle, delete; selecting a section renders the generic prop form from `adminFields`.
- Per-page SEO fields (title/description/og_image_url) — stored now in `seo`, surfaced fully in Phase 4.
- Nav editor: simple label+href rows.
- Publish action: copy visible sections (sorted, with type/props) into `published_snapshot`, set `status='published', published_at=now()` in one update; live-preview iframe above the editor (`/storefronts/preview/:slug/:pageSlug`).

### 4.5 Migration/rollout notes

Expand-only (new tables + nullable-default column); backfill creates drafts only; runtime legacy fallback = built-in rollback (unpublish or app revert). Publish power sits with operators, so a bad home page is their click away from revert (unpublish → legacy home renders). Contract steps (drop legacy components) deferred until every active storefront has a published home — tracked as a follow-up, not in this plan.

### 4.6 Verification

- `verify_storefront_pages.sql`: asserts tables exist, RLS enabled, policy count per table ≥ 3, backfilled row counts (`home` drafts = storefront count; `about`/`policies` same), no published pages.
- Vitest: registry completeness (every type has component+validate+adminFields), `validate()` rejects bad props per type (table-driven test), slug rules; `lib/pages.ts` pure helpers (snapshot→sections mapping).
- Manual: create→preview→publish a home page on a dev storefront; anon-key REST GET on a draft page id returns empty; storefront domain shows new home; second storefront without published home shows legacy layout; `/pages/:slug` 404 for unknown; custom page reachable via nav link.
- `npm run lint` + new `npm run typecheck` (`tsc --noEmit`, added in this phase).

**Effort:** 3.5–5 weeks (schema+runtime 1 wk, admin editor + preview 1.5–2 wk, registry+polish+tests 1 wk, buffer).

---

## 5. Phase 2 — Wire up collections

**Goal:** Shop is browsable by collection; collections are managed in admin; the Phase-1 `collection-grid` section becomes functional. Zero new tables.

### 5.1 DB
One migration: `CREATE INDEX idx_scp_collection_pos ON public.storefront_collection_products(collection_id, position);` + verify file. (Tables, RLS, junction all exist — fact 8.) No column changes.

### 5.2 Runtime
- `src/storefront/lib/collections.ts` — `listCollections(storefrontId)` (active, ordered), `getCollectionWithProducts(storefrontId, slug)` (collection + junction products joined to `products` via existing `lib/catalog.ts` mapping, respecting `is_active`).
- `Shop.tsx`: horizontal collection tab strip (All + each active collection; derived from `listCollections`), filter client-side over the already-loaded product list; keep search box if present (it currently has none — do not add faceting; that's P1).
- `StorefrontApp.tsx`: route `${basePath}/collections/:slug`.
- New page `src/storefront/pages/Collection.tsx`: header (title/description/image_url from the collection row) + product grid reusing `ProductCard`.
- `CollectionGrid` section component: fetch active collections, render cards linking `/collections/:slug`; empty-state renders nothing (`is_visible`-style behavior stays; empty state hidden).
- SEO stub: collection page title = `${title} — ${storefront.name}` via Phase 4 hook (title-only until then, consistent with today).

### 5.3 Admin
`CollectionsTab.tsx` (manual curation only): list (title, slug, active, position, product count), create/edit dialog (title, slug auto-slugified, description, image_url, position, is_active), delete (cascade clears junction), inline product picker (search products like ProductsTab does, add/remove, reorder via position).

### 5.4 Migration/rollout
Additive index only. Junction/product-count queries are anon-readable already (public policies). No rollout risk; rollback = app revert.

### 5.5 Verification
- Verify migration: index exists, policies unchanged, dead-table status resolved (SELECT count works).
- Manual: create collection with 3 products → Shop shows tab; `/collections/:slug` renders grid; `collection-grid` section on published home renders cards; deleting a product from catalog doesn't orphan the junction (FK is on product_id? — junction `product_id` has NO FK (fact: DDL shows bare uuid) → add a cleanup note: tab filters to existing products at render; a real FK is a contract-phase item).
- Vitest: slugify/collection-filter pure helpers.

**Effort:** 3–5 days.

---

## 6. Phase 3 — Product variations on storefront + checkout

**Goal:** A customer can pick size/color on the product page, and the chosen variation's price/stock flows through cart → `storefront-checkout` → `order_items`, validated server-side.

### 6.1 DB (migration + verify)
- `ALTER TABLE public.order_items ADD COLUMN variation_id uuid REFERENCES public.product_variations(id) ON DELETE SET NULL;` (nullable, expand-only).
- Verify live DB for an anon-read policy on `product_variations`; if absent, add: `CREATE POLICY "Public can read product variations" ON public.product_variations FOR SELECT TO anon, authenticated USING (true);` (storefront runtime is anon; product read already works this way — fact 9). If a narrower policy exists, leave it.

### 6.2 Shared variation helper
Extract `parseVariationAttributes` into `src/lib/variations.ts` (one canonical version; refactor `AddOrderDialog`, `pos/VariationModal`, `MeasurementSlipPrint` imports to it — mechanical, keeps behavior). Output shape: `Array<{name: string, option: string}>`.

### 6.3 Runtime
- `lib/catalog.ts`: `getStorefrontProduct` also fetches variations (`id, name, price, regular_price, sale_price, stock_quantity, stock_status, manage_stock, attributes`) for the product.
- `Product.tsx`: attribute option buttons per attribute name (group variations by parsed attributes; disable combination with no matching variation or `stock_status='outofstock'`/`manage_stock && stock_quantity<=0`); price display switches to selected variation's `price`; "Add to cart" requires a full selection when variations exist.
- `Cart.tsx`: render `variation_label` under name (cart model already carries it — fact 4).
- `Checkout.tsx`: pass `variation_id` + `variation_label` per item in the fetch body.

### 6.4 Edge function `storefront-checkout` (first rewrite of three)
- Payload items gain `variation_id?`.
- When `variation_id` present: fetch the variation, verify `variation.product_id === product_id`, use `variation.price` for line totals (mirror POS: `price`, not sale_price — consistent with `AddOrderDialog.tsx:145`), validate `variation.manage_stock && variation.stock_quantity >= qty` in addition to product-level check.
- `order_items` insert: `product_id`, `variation_id`, `product_name = variationLabel ? "${name} - ${label}" : name` (matches POS convention, fact 3), `unit_price` = effective price.
- Stock decrement still NOT added here — Phase 6 (validation-only remains until then, same race window as today; sequencing keeps RPC in one place).

### 6.5 Migration/rollout
Expand-only column + possibly one SELECT policy. `Orders`/POS UI reads `order_items` by existing columns — no breakage; `variation_id` is additive. Rollback: app revert; column stays.

### 6.6 Verification
- Verify migration: column exists + FK + (policy applied).
- Vitest: `lib/variations.ts` parsing against real-world attribute shapes (string, array of objects, array of arrays — table-driven with fixtures copied from the three current implementations); cart add-with-variation merge logic (`product_id+variation_id` keying already implemented — test it).
- Manual: storefront product with variations → pick size/color → price/stock update; add to cart (label shown); checkout; edge fn rejects qty > variation stock with clear error; Orders UI shows "Kurta - Size: L" style names; product without variations unchanged.
- `supabase functions serve storefront-checkout` + curl with a crafted payload (variation_id of another product → 400 mismatch).

**Effort:** 1–1.5 weeks.

---

## 7. Phase 4 — SEO foundation

**Goal:** Every storefront page has manageable per-page meta; product URLs are stable; `sitemap.xml` per storefront; Product/Organization/Breadcrumb JSON-LD. (CSR-only rendering remains — prerendering is out of scope, flagged in §9.)

### 7.1 DB (migration `product_slug.sql` + verify)
- `ALTER TABLE public.products ADD COLUMN slug text;` → backfill with the exact read-time formula (lowercase, `[^a-z0-9]+`→`-`, trim, ≤60 chars, append `id.slice(0,6)`; empty name → `id.slice(0,8)`), dedupe collisions with `-2`,`-3` suffixes → then `CREATE UNIQUE INDEX uq_products_slug ON public.products(slug);` (unique index, not constraint — keeps future inserts enforceable via trigger).
- `BEFORE INSERT ... WHEN NEW.slug IS NULL` trigger `set_product_slug()` (same formula + collision loop) so Woo imports and POS-created products get slugs automatically. Renames never touch slug (stability is the point).
- `catalog.ts`: prefer stored `slug`, keep read-time fallback for any pre-backfill straggler (belt-and-braces; verify file asserts zero NULL slugs).

### 7.2 Runtime
- `src/storefront/lib/seo.ts` — `usePageMeta({title, description, canonicalPath, ogImageUrl?, ogType})` hook (no new dependency; manages `<title>`, `meta[name=description]`, `meta[property="og:*"]`, `link[rel=canonical]`, twitter card, keyed upsert/remove). Brand default = storefront name/hero; per-page overrides.
- Wire per route: Home/custom pages from `storefront_pages.seo` (fields from Phase 1 admin); Shop/About/Policies/Contact sensible defaults; `Collection.tsx` from collection title/description; **Product page: title `${name} — ${storefront.name}`, description = `short_description` (fallback `description` trimmed 160 chars), canonical from stored slug, og:image = `image_url`**.
- `src/storefront/lib/jsonld.tsx` — components injecting `<script type="application/ld+json">`: `OrganizationJsonLd` (all pages, from storefront), `ProductJsonLd` (Product page: name, image, `offers` {price, priceCurrency: `storefronts.currency`, availability: in/out of stock}), `BreadcrumbListJsonLd` (Product: Home › Shop › Product; Collection: Home › Collection).

### 7.3 Sitemap — edge function `storefront-sitemap`
- New `supabase/functions/storefront-sitemap/index.ts`: resolve storefront by `?slug=` or Host header (mirror `lib/brand.ts` matching: slug subdomain / `social.custom_domains` — implement server-side, service role); query published pages, active collections, active storefront products (slug + updated_at); emit XML (home, /shop, /pages/:slug, /collections/:slug, /products/:slug — lastmod from updated_at).
- `vercel.json`: add rewrite `{ "source": "/sitemap.xml", "destination": "https://<supabase-ref>.supabase.co/functions/v1/storefront-sitemap" }` (external rewrite passes Host through; on the main dokanos domain without slug context the fn returns a minimal index or 404 — document: per-storefront sitemaps live on storefront hosts/`?slug=`).
- `public/robots.txt`: append `Sitemap: /sitemap.xml` (relative resolves per-host — accepted v1 behavior).

### 7.4 Migration/rollout
Backfill + index + trigger are additive; unique index creation after dedupe (verify file asserts zero dupes/NULLs first, then index in same migration). Woo-sync product upserts must not clobber slug (they don't set it; trigger only fires on NULL). Rollback: app revert + index is harmless.

### 7.5 Verification
- Verify migration: zero NULL `products.slug`, zero duplicates (pre-index assertion), index exists, trigger fires on test insert.
- Manual: rename a product → URL unchanged; fetch `/sitemap.xml` on a custom-domain storefront → valid XML incl. new product URL; view-source on product page → title/description/OG/canonical + 3 JSON-LD blocks; Google Rich Results test on a deployed URL (post-deploy checklist item).
- Vitest: slug formula parity (backfill SQL vs TS `slugify` — property test on a name corpus), `usePageMeta` DOM effect (jsdom).

**Effort:** 4–6 days.

---

## 8. Phase 5 — Storefront settings object

**Goal:** Per-storefront checkout/UX behavior is data, editable in a Settings tab, honored by runtime + `storefront-checkout`.

### 8.1 DB (migration + verify)
`ALTER TABLE public.storefronts ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb;`
Schema (validated in app code via a zod-free hand validator in `src/lib/storefrontSettings.ts` — repo has no zod; hand-rolled shape check + defaults, unit-tested):

```jsonc
{
  "checkout": { "methods": { "cod": true, "bkash": true, "nagad": true },   // at least one must stay true
                "min_order_amount": 0, "order_instructions": "", "terms_checkbox_text": "" },
  "shipping":  { "free_threshold": 0 },                                     // 0 = off
  "tax":       { "inclusive": false },                                      // display flag only in v1
  "announcement": { "enabled": false, "text": "", "href": "" },
  "pixels":    { "ga4": "", "meta": "", "tiktok": "" }                      // stored now, loaded in P1 analytics (§9)
}
```
Defaults reproduce today's behavior exactly (empty settings = current flat-rate COD/bKash/Nagad, no threshold, no announcement).

### 8.2 Runtime
- `BrandContext` already loads the full storefront row → expose `settings` (merged with defaults).
- `Checkout.tsx`: render only enabled methods; block submit below `min_order_amount` with inline error; show `order_instructions` above payment; optional terms checkbox before Place Order; `free_threshold` replaces shipping line with "Free" when subtotal ≥ threshold (rates themselves stay from `invoice_settings` — zones are P1); remove the hard-coded 80/150 mirror by using the same server logic response (fetch rate via a tiny read of `invoice_settings` through the existing client — v1 keeps the mirror but sourced from settings+invoice data, single source in `lib/settings.ts`).
- `StorefrontLayout.tsx`: announcement bar above header when enabled.
- `storefront-checkout` (second rewrite): read storefront settings server-side; enforce `min_order_amount` and enabled-methods (reject disabled method with 400); apply `free_threshold` to shipping in total computation.

### 8.3 Admin
`SettingsTab.tsx`: grouped form rendering the schema above (methods toggles, numbers, texts, announcement, pixel IDs); validation before save (≥1 method enabled, min_order ≥ 0); save = single `storefronts.update` (existing save() pattern extended — fact 14).

### 8.4 Migration/rollout
Additive column with safe default; every consumer must treat `{}` as defaults (unit-tested). Rollback: app revert.

### 8.5 Verification
- Verify migration: column exists, all rows default.
- Vitest: defaults-merge (`{} → today's behavior`), validation rules (all-methods-off rejected).
- Manual: disable bKash → option disappears on storefront; set min order 500 → 300-taka cart blocked with message; threshold 1000 → 1200-taka cart shows Free shipping and edge-fn total matches; announcement bar renders + hides; settings save round-trips.

**Effort:** 3–4 days.

---

## 9. Phase 6 — Stock decrement, idempotency, Track fix

**Goal:** Checkout is oversell-safe and double-click-safe; stock flows (incl. Woo sync push) are correct per the aggregate model; cancel restores stock exactly once; Track works again without anon `orders` access.

### 9.1 DB (migration `checkout_stock_idempotency.sql` + verify)
```sql
ALTER TABLE public.orders ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX uq_orders_idempotency_key ON public.orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.orders ADD COLUMN stock_restored_at timestamptz;   -- idempotent restore guard

CREATE OR REPLACE FUNCTION public.storefront_reserve_stock(p_items jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  -- per item {product_id, variation_id?, quantity}:
  -- 1. SELECT ... FOR UPDATE on products row (and product_variations row when variation_id)
  -- 2. Validate: product.manage_stock → products.stock_quantity >= qty;
  --    variation → variation.manage_stock → variation.stock_quantity >= qty; else RAISE
  --    (out-of-stock/insufficient errors bubble as SQLSTATE P0001 with item name)
  -- 3. Decrement, two cases (fact 1):
  --    CASE A: product_locations rows exist for (product_id, coalesce(variation_id, zero-uuid))
  --            → decrement location rows FIFO (created_at) enough to cover qty;
  --              trigger sync_product_stock_from_locations recomputes products.stock_quantity.
  --              DO NOT write products.stock_quantity directly (would double-count).
  --    CASE B: no location rows → UPDATE products SET stock_quantity = stock_quantity - qty.
  --    Always, when variation: UPDATE product_variations SET stock_quantity = stock_quantity - qty.
  --    (Both decrement paths fire the auto_push_*_woo triggers exactly once — desired.)
CREATE OR REPLACE FUNCTION public.storefront_restore_stock(p_order_id uuid) RETURNS void
  -- reverse of the above, reading order_items (product_id, variation_id, quantity);
  -- locks the orders row, no-op + RAISE notice when stock_restored_at IS NOT NULL;
  -- sets stock_restored_at = now() in the same transaction; restores ONLY when
  -- order.source = 'storefront' AND previous status was a decrementing lifecycle
  -- (i.e., the checkout decremented) — see 9.3 wiring.
```
Exact SQL in the migration; both RPCs `REVOKE ... FROM PUBLIC/anon/authenticated; GRANT EXECUTE ... TO authenticated` (service-role edge fn bypasses grants — but keep grants tight for defense in depth).

### 9.2 Edge function `storefront-checkout` (third rewrite)
- Accept `idempotency_key` (client `crypto.randomUUID()`, persisted per cart in localStorage until success — `Checkout.tsx`).
- Flow: (validate payload as today incl. Phase 3 variation checks + Phase 5 settings) → if `idempotency_key` present, SELECT existing `orders` row by key → return `{order_id, order_number, deduped: true}` (200) and stop. → Call RPC `storefront_reserve_stock` (single transaction: all items validated+decremented atomically or nothing). → On RPC error → 400 with the item message, **no partial state**. → Insert order with `idempotency_key`, `source='storefront'` (verify current source value in the fn; if it already writes a distinct source, keep it) → order_items/timeline as today. Race window on the unique index: catch 23505 on insert → SELECT by key → return deduped 200. (Reserve-then-insert can leave decremented stock with no order if insert fails; order: insert order row first without committing? Edge fn has no transaction across calls — accepted v1 mitigation: on insert failure after successful reserve, immediately call `storefront_restore_stock`-style compensation for the in-memory items; document in code comment.)
- Note: POS orders do not decrement on creation (verified — fact 2 area), so POS-vs-storefront oversell races are reduced to the same validation both share; full reservation for POS is out of scope (§9 out-of-scope).

### 9.3 Cancel-restores-stock wiring
`src/components/orders/OrderDetailSheet.tsx` cancel path: when `order.source === 'storefront'`, after status update to `cancelled`, call `storefront_restore_stock(order_id)`; success toast "Inventory restored". (Bulk cancel: same call per order, sequential; failures reported, not fatal to the status change — restore RPC is idempotent via `stock_restored_at`.) POS `ReturnDialog` restock behavior untouched.

### 9.4 Track page fix (audit §2.9.1)
- New `supabase/functions/storefront-track-order/index.ts`: POST `{order_number, phone}` → normalize phone (strip non-digits; match exact OR last-6) → service-role SELECT of `order_number,status,tracking_status,payment_status,total,created_at,consignment_id,customer_phone` by order_number → verify phone match else 404-shaped `{error:"Order not found"}` → return the limited fields (never customer PII beyond what the customer themselves entered).
- `Track.tsx`: add phone input (required), replace the anon-key `orders` query with the edge call; keep timeline/status UI. Anon REST on `orders` stays fully closed (fact 6).

### 9.5 Migration/rollout
Expand-only columns + RPCs; unique partial index is safe with NULLs. **Highest-risk phase** — deploy order: migration → edge fn deploy (`supabase functions deploy storefront-checkout storefront-track-order`) → app. Rollback: revert fn + app; RPCs/columns inert. If a bad decrement pattern emerges, emergency switch = repoint checkout to previous fn version (Supabase fn versioning) — stock drift during window corrected by Woo resync (locations remain source of truth in Case A).

### 9.6 Verification
- Verify migration: columns/indexes/RPCs exist; execute reserve on a fixture product (Case B) and a fixture with locations (Case A) asserting both ledgers move and `products.stock_quantity` equals aggregate.
- Concurrency script (manual, `ctx`-style or bash): `for i in 1..2: curl storefront-checkout same idempotency_key` → one order, both responses 200 identical order_number; two different keys, stock=1 → second gets 400 out-of-stock; product & variation stock now 0.
- Woo echo: after checkout, `sync_queue` contains exactly one stock-push row per affected product/variation with no `woo_updated_at` stamp (echo guard, fact 2).
- Cancel flow: cancel a storefront order in Orders UI → stock restored exactly once (cancel twice → second is a no-op, `stock_restored_at` set); POS order cancel does NOT restore (no decrement happened).
- Track: wrong phone → not-found; right phone → status rendered; anon key REST select on `orders` still rejected.

**Effort:** 4–6 days.

---

## 10. Cross-cutting concerns

### 10.1 RLS — every new/changed object
| Object | Public (anon) | Staff/Admin |
|---|---|---|
| `storefront_pages` | SELECT: `status='published' AND storefront is_active` | ALL via `has_role('staff'\|'admin')` |
| `storefront_page_sections` | SELECT via published parent | ALL via `has_role` |
| `storefronts.nav`, `storefronts.settings` | covered by existing `storefronts` SELECT (is_active gate) | covered by existing UPDATE policy |
| `order_items.variation_id` | no new policy (follows `order_items`) | unchanged |
| `product_variations` | SELECT granted only if absent in live DB (verify first) | existing |
| `products.slug` | follows `products` | existing |
| `orders.idempotency_key`, `.stock_restored_at` | no new policy (anon has none — fact 6) | existing |
| RPCs `storefront_reserve_stock`/`storefront_restore_stock` | no execute for PUBLIC/anon; execute authenticated (edge fn uses service role) | — |

New policies copy the `20260516201928` storefront migration style verbatim (`has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'staff'::app_role)`), staying consistent with the existing role-based model (fact 7). The business-scoping retrofit (audit P2 #19) is deliberately NOT mixed in — doing it would require `storefronts.business_id` plumbing that out-grows P0; flagged as first item of the follow-up.

### 10.2 Permissions wiring
Admin routes already sit behind `PermissionGuard`; new tabs are inside `StorefrontsPage` — no new permission keys required. Verify the storefronts route's guard permission string covers the new tabs (single page → single permission; no change expected). Edge functions: `storefront-checkout`/`storefront-sitemap`/`storefront-track-order` are public CORS `*` by design (public commerce surface); the only authenticated-role-checked fn (`generate-storefront-content`) is already correct (fact 11).

### 10.3 Rollback strategy per phase (summary)
1. **Builder:** unpublish page / app revert; legacy components never deleted in-plan.
2. **Collections:** app revert only (additive index).
3. **Variations:** app + fn revert; column inert.
4. **SEO:** app revert; slug column/trigger harmless; remove rewrite if sitemap misbehaves.
5. **Settings:** app + fn revert; `{}` defaults = old behavior.
6. **Stock/Idempotency:** fn versioning rollback (§9.5); schema inert without fn; drift correction via Woo resync / locations aggregate.
Global rule: **expand-only in this plan** — no drops; any contract step (dropping legacy Home layouts, FK on junction `product_id`, narrowing CORS) is a separate follow-up release after soak.

---

## 11. Sequencing rationale

- **Phase 1 first** — it is the critical path and the substrate: page rows carry `seo` (Phase 4), the `collection-grid` section ships inside it (Phase 2 activates it), the announcement bar renders in its layout (Phase 5), and `storefront_pages` URLs feed the sitemap.
- **Phases 2 and 3** are mutually independent; 2 is smallest-value-risk first, 3 unblocks 6. With a second dev, 2 (admin-heavy) and 3 (runtime/fn-heavy) parallelize cleanly behind 1.
- **Phase 6 after 3** — the reserve RPC validates/decrements `product_variations`; doing it earlier would ship it product-only and rewrite it days later.
- **Phase 4 after 1–3** — sitemap enumerates pages + collections + (stable-slugged) products; JSON-LD product schema wants variation-aware price. Slug backfill is independent and could technically land any time; sequencing it here keeps SEO testable end-to-end in one phase.
- **Phase 5 before 6** — both rewrite `storefront-checkout`; landing settings first means Phase 6 rewrites the write-path once, with settings already honored.
- Single-dev order: **1 → 2 → 3 → 6 → 4 → 5** (risk-reduction: close the oversell race as early as possible after variations) with 4/5 swappable as breather work.

---

## 12. Out of scope (audit P1/P2 — do NOT pull into this plan)

Theme system v2 (P1 #7), media library (P1 #8), analytics events + dashboards + pixel *loading* (P1 #9 — Phase 5 only stores IDs), shipping zones (P1 #10 — Phase 5 only adds the threshold), customer notifications/SMS/OTP (P1 #11), draft/publish for *branding* (P1 #13 — pages only, in Phase 1), payment gateways (P2 #14), customer accounts/server cart (P2 #15), related products/reviews/sale-price UI (P2 #16), blog (P2 #17), automated domain provisioning (P2 #18), **business-scoped RLS retrofit for storefronts (P2 #19)**, per-storefront rate limiting (P2 #20), i18n (P2 #21), SSR/prerendering, POS-side stock reservation, storefront-specific pagination/facets on Shop. Also deferred contracts: dropping legacy Home layouts, FK on `storefront_collection_products.product_id`, narrowing checkout CORS.

---

## 13. Known risks (accepted, with mitigation)

1. **Two-ledger stock drift** (`product_variations.stock_quantity` vs `product_locations` rows keyed by variation) — Phase 6 decrements both; verify file asserts equality on fixtures; POS direct-write drift is pre-existing (fact 2/§9.3) and tracked as follow-up.
2. **Reserve-then-insert compensation gap** in the edge fn (no cross-call transaction) — §9.2 compensation call + code comment; unique idempotency index makes the realistic failure window tiny.
3. **Section props are free-form jsonb** — validated in app code only; a hand-crafted staff API write could inject bad props → renderer is defensive (unknown type/bad props render nothing, logged).
4. **Sitemap on shared main domain** — v1 serves per-storefront hosts/`?slug=`; main-domain index sitemap is a follow-up.
5. **Backfilled draft home pages** don't perfectly reproduce the 4 theme layouts — intentional; operators publish when satisfied, legacy fallback preserves status quo meanwhile.
