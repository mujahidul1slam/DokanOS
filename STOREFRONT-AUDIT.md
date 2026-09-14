# DokanOS Storefronts Feature — Full Audit

**Date:** 2026-09-09
**Scope:** Everything between "storefront exists" and "a merchant can deliver a real online store to customers": runtime app, admin editor, data model, checkout, theming, pages, SEO, domains, analytics, and competitive positioning.

**Verdict:** The current storefronts feature is a solid **v0 vertical slice** — a single hard-coded page set with 4 fixed layout skins, a curated product list, and a working COD/bKash/Nagad checkout that writes into the same `orders` pipeline as POS. As a deliverable, it is roughly at the level of a "link-in-bio + order form". It is **not** yet a website builder an e-commerce platform can ship to users. Below is the element-by-element audit, competitive comparison, and a prioritized roadmap.

---

## 1. What exists today (inventory)

### 1.1 Runtime (src/storefront/)

| Element | State |
|---|---|
| `StorefrontApp.tsx` | 10 lazy-loaded routes: Home, Shop, Product, Cart, Checkout, CheckoutSuccess, Track, About, Contact, Policies. Routes are hard-coded — no custom pages exist. |
| `BrandContext.tsx` | Loads storefront row, sets `data-brand`/`data-theme` attrs, accent color CSS vars, `document.title`, favicon. Only title + favicon are managed — no meta description, OG, canonical. |
| `lib/brand.ts` | Slug cache (5-min TTL), custom domain matching from `social.custom_domains`, `fmtCurrency`. |
| `lib/theme.ts` | Converts `accent_hex` → HSL CSS vars, with lightness-delta safety vs dark themes. **This is the entire theming system.** |
| `lib/catalog.ts` | Product list/lookup; slug generated at read time (`name-id6`), not stored. |
| `lib/cart.ts` | localStorage cart per brand, event-based sync. No server cart, no cross-device. |
| `themes/storefront.css` | 4 theme blocks (`editorial`, `cinematic`, `minimal`, `warm`) + legacy `enveil`/`vincent`. |
| Pages | All fixed layout; Home has 4 layout variants selected by theme string. |

### 1.2 Admin (src/pages/StorefrontsPage.tsx, 765 lines)

Tabs: **Brand profile** (name, slug, theme preset, accent hex, hero title/subtitle/image, logo, favicon, currency, store link, AI-generate button), **Social & policies** (IG/FB/TikTok/WhatsApp, 3 markdown policies), **Domains** (custom_domains list, CNAME instructions), **Products** (search-add, reorder, feature, badge).

### 1.3 Data model

- `storefronts` — one row per store; branding + hero + policies JSONB + currency. No settings beyond that.
- `storefront_products` — curation (position, is_featured, badge).
- `storefront_collections` — **exists in DB and generated types but is referenced by zero UI/runtime code. Dead table.**
- `storefront_orders` — **does not exist**; storefront orders write directly to `orders` (good) but there is no per-storefront storefront settings object at all.

### 1.4 Checkout edge function (`storefront-checkout`)

Validates payload → server-side price/stock check → Pathao city/zone/area capture → shipping from `invoice_settings` (inside/outside Dhaka flat rates) → `orders` + `order_items` + `order_timeline` rows → order number via RPC. Payment: COD, or bKash/Nagad manual trx-entry pending verification. No stock decrement on order, no coupons, no logged-in customers.

### 1.5 SEO/Discovery surface

- `robots.txt` exists (allow-all, incl. Googlebot/Bingbot/Twitterbot/Facebookhit).
- Client-rendered SPA — no per-page meta, no sitemap.xml, no JSON-LD, no canonical, no OG images beyond global defaults in `index.html` (3 files touch `og:` — all global).

### 1.6 Analytics

- Dashboard `Analytics.tsx` exists for the operator (POS/overall). **Zero storefront-side analytics: no page views, no product views, no add-to-cart, no conversion funnel, no GA/Meta Pixel hooks.**

---

## 2. Gap analysis — element by element

Severity legend: **C** = Critical for a deliverable, **H** = High, **M** = Medium, **L** = Low/nice-to-have.

### 2.1 Theming & customization

| Gap | Sev | Notes |
|---|---|---|
| No theme registry/marketplace — exactly 4 hand-built layouts baked into `Home.tsx` | **C** | Themes are code, not data. Adding a 5th theme = editing a page component. Shopify/Wix ship 100+ themes. |
| No theme **options** (fonts, spacing, radius, button styles, layout toggles) | **C** | Only `accent_hex` exists. Shopify themes expose dozens of settings per theme via `settings_schema.json`. |
| No custom CSS per storefront | H | Escape hatch for power users; every competitor has it (Wix CSS, Shopify Liquid, BigCommerce themes). |
| No logo sizing/position, no header layout options, no footer layout options | H | Header/footer are fixed in `StorefrontLayout.tsx`. |
| No theme preview — operators can't see a theme before switching live | H | A/B risk: switching theme rewrites the whole homepage with no preview. |
| `accent_hex` lightness safety is clever but operators have no color picker with contrast guidance | M | Raw hex input only. |
| No dark/light mode toggle independent of theme | M | "cinematic" = dark is conflated with layout. |
| Favicon is applied per storefront but no social/share image (og:image) | M | Managed nowhere. |

### 2.2 Pages & content management

| Gap | Sev | Notes |
|---|---|---|
| **No custom pages at all** — no `storefront_pages` table, no page editor | **C** | Routes are hard-coded. Every platform competitor (even Dukaan) has custom pages. |
| No page editing with components/sections/blocks | **C** | The core "website builder" capability is absent: no draggable/stackable sections (hero, featured grid, banner, rich text, gallery, testimonials, FAQ, video, collection grid, countdown). |
| No homepage composer — Home layout is frozen per theme | **C** | Shopify = sections; Wix = sections + ADI; BigCommerce = Page Builder; WooCommerce = Gutenberg blocks/Gutenberg-based. |
| No navigation manager — nav links are hard-coded in layout | **H** | Can't add "Sale", "Lookbook", "Size guide" links; can't link custom pages even if they existed. |
| About/Contact/Policies are singletons, not pages | M | Contact is a static form without configurable fields (no map, phone-only fallback). |
| No blog/lookbook/newsletter content type | M | Traffic driver every competitor treats as table stakes. |
| No media library — logo/hero images are raw URL inputs | **H** | Operators paste URLs; no upload, no crop, no alt text management. Compare: every platform has a full DAM. |
| No localization/i18n of storefront content | M | Single-language only. |

### 2.3 Merchandising & catalog

| Gap | Sev | Notes |
|---|---|---|
| `storefront_collections` is dead — Shop page is a single flat grid, no filters, no search, no sort, no pagination, no category browsing | **C** | The single biggest UX gap after pages. Shopify collections/facets, Wix category pages, Woo product categories all exist here as a designed table that was never wired up. |
| No product variations (size/color) on storefront — `products` catalog has `product_variations` and POS presumably uses them, but Product page has no variant picker and checkout passes no `variation_id` | **C** | Fashion storefronts without size/color are not sellable. `cart.ts` even has `variation_id?` fields — declared but never populated. |
| No price formatting nuance: no compare-at/sale price, no discounts | H | `ProductCard`/Product page render `price` only. |
| No product reviews/ratings | M | Table stakes on all platforms. |
| No inventory display thresholds ("only 3 left"), no backorder UX | M | Only binary in/out-of-stock. |
| No related products / "you may also like" | M | Zero cross-sell surface. |
| Product slug is derived at read-time, not a stable stored slug | M | Renaming a product changes its URL — SEO-hostile. |

### 2.4 Commerce & checkout

| Gap | Sev | Notes |
|---|---|---|
| No stock decrement on order placement (checkout validates stock but doesn't reserve/decrement) | **C** | Oversell race; POS and storefront will fight over the same `stock_quantity`. |
| Cart is localStorage-only — no cross-device, no server cart, no abandoned-cart capture | H | Guest-only checkout; no customer accounts at all. |
| No guest checkout email requirement (email optional), no OTP/phone verification | H | Fake orders are trivial (name+phone+address only). BD market tolerates it, but order-quality tooling (OTP) is standard in Dukaan/ShopUp. |
| No coupons/discounts/promotions on storefront | H | `invoice_settings` shipping exists; nothing else. |
| Shipping is Dhaka-vs-not flat rate only; Pathao city data exists but no zone-based rates, no free-shipping threshold, no weight-based rates | H | Checkout.tsx even hard-codes 80/150 mirror logic client-side. |
| bKash/Nagad = manual trx-entry + pending verification; no payment gateway integration (SSLCommerz, bKash PGW, PortWallet) | H | Workable MVP, but a real gateway is the #1 request of any BD merchant. |
| No taxes/VAT handling on storefront lines | M | |
| No order-email/SMS notifications to customer (order timeline row exists; no comms) | H | Order confirmation is just a success page. |
| No per-storefront checkout settings (enable/disable methods, min order, instructions, terms checkbox) | H | The `storefronts` table simply has no settings JSONB. |

### 2.5 Domain, hosting & delivery

| Gap | Sev | Notes |
|---|---|---|
| Custom domains are stored but DNS is manual (CNAME to dokanos.vercel.app + operator adds domain in Vercel project) | H | No automated domain provisioning, no domain status/health check, no SSL state. (Supabase/Vercel APIs can automate this.) |
| Subdomain matching exists but the whole storefront is one SPA — no SSR/SSG per storefront | H | See SEO. |
| No storefront-level caching/CDN strategy beyond Vercel defaults | M | |

### 2.6 SEO & discoverability

| Gap | Sev | Notes |
|---|---|---|
| No per-page `<title>`, meta description, OG tags, canonical URLs | **C** | `BrandContext` sets `document.title` once from hero_title; product pages never update title/meta. |
| No sitemap.xml per storefront | H | robots.txt allows everything but there's no sitemap to consume. |
| No structured data (Product, Organization, BreadcrumbList JSON-LD) | H | 0 hits repo-wide. Rich results impossible. |
| Client-rendered only — social scrapers and first-paint SEO get an empty shell | H | Even with OG tags fixed, CSR-only product pages underperform. Consider prerender/SSG per storefront. |
| Unstable product URLs (read-time slugify) | M | See 2.3. |

### 2.7 Analytics & growth

| Gap | Sev | Notes |
|---|---|---|
| No storefront analytics (views, visitors, funnel, conversion) | **C** | Operators are flying blind on the channel that faces customers. |
| No event pipeline (page_view, product_view, add_to_cart, begin_checkout, purchase) | **C** | Foundation for both analytics and retargeting. |
| No integrations: GA4, Meta Pixel, TikTok Pixel | H | Standard on every competitor; zero hooks exist. |
| No abandoned-cart capture/simulation | M | Follows from no server cart. |
| No email/SMS marketing capture (newsletter) | M | |

### 2.8 Admin/ops experience

| Gap | Sev | Notes |
|---|---|---|
| Editor is a single 765-line page with 4 tabs; no visual preview; no draft/publish workflow | H | No way to stage changes — every save is live. Compare: every platform has draft themes, preview URLs, and scheduled publish. |
| No storefront-level order/inbox view (orders visible only in the global Orders page filtered by store) | M | |
| Multi-storefront RLS is role-based (staff/admin) not business-scoped — every staff member can edit every storefront across businesses | H | `storefronts` policies predate the businesses/brands multi-tenant migration; `brands` table got scoped, `storefronts` did not. |
| `storefront_collections` UI absent despite table + types existing | M | Wire it up (see roadmap). |
| No storefront analytics tab | M | Follows from 2.7. |

### 2.9 Security & correctness findings (bonus)

1. **Track page leaks orders to anon:** `Track.tsx` queries `orders` by order number with the anon key; migration `20260415001620` restricted orders to authenticated... but Track works, meaning either an anon SELECT policy still exists or it silently returns null. Verify: if anon SELECT was re-granted for Track, every order number is enumerable (`orders` SELECT to anon exposes customer PII by order number). Should move behind an edge function with order-number + phone verification.
2. **storefront-checkout CORS `*`** — fine for a public API, but add per-storefront rate limiting (currently none: order spam/DoS possible against the `orders` table).
3. **No idempotency key on checkout** — double-click can double-order. Edge function should accept a client-generated `idempotency_key` and dedupe.
4. **Storefront mutations use client-side Supabase session** — acceptable given staff-role RLS, but the `generate-storefront-content` AI button posts storefront context to an edge function; confirm it checks the caller's role (not verified in this audit).

---

## 3. Competitive comparison

Scale: how far the current feature is from each platform's merchant-facing storefront offer.

| Capability | DokanOS today | Shopify | Wix | BigCommerce | WooCommerce | Dukaan (BD) |
|---|---|---|---|---|---|---|
| Themes | 4 fixed layouts | 100+ themes, robust marketplace, full theme editor | 500+ templates + ADI builder | Stencil themes + marketplace | Thousands of themes | ~10 templates |
| Theme options/settings | accent color only | Deep settings schema per theme, sections everywhere | Design system panel, per-element styling | Theme editor + Page Builder | Customizer + plugin ecosystem | Basic color/logo/layout |
| Custom pages | None | Unlimited + templates | Unlimited | Unlimited | Unlimited | Unlimited |
| Page builder/components | None | Sections & blocks (drag-reorder homepage) | ADI + drag-drop editor | Page Builder (widgets) | Gutenberg blocks | Simple block editor |
| Navigation manager | Hard-coded | Full (menus, dropdowns, megamenus) | Full | Full | Full | Basic |
| Collections/categories | Dead table | Automated + manual collections, smart rules | Category pages + filters | Faceted search built-in | Categories/tags/attributes | Categories |
| Product variations | Absent on storefront | Up to 100 options + 3D/media | Full | Full (modifiers/options) | Full | Basic variants |
| SEO | Title/favicon only | Full meta + sitemap + structured data + blog | Full | Full | Full (Yoast ecosystem) | Basic meta |
| Analytics | None storefront-side | Full + GA integration | Full (Wix Analytics) | Full | Plugin ecosystem | Basic dashboard |
| Customer accounts | None | Full | Full | Full | Full | Basic (OTP) |
| Payments | COD + manual bKash/Nagad | 100+ gateways | 50+ | 65+ | Region-dependent | bKash/Nagad/COD + gateways |
| Cart | localStorage | Server cart, abandoned-cart emails | Server cart | Server cart | Server cart | Server cart |
| Domains | Manual CNAME notes | Automated + SSL | Automated + SSL | Automated | Self-host | Automated |
| Inventory sync | Shared `products` table, no reserve | Shared + reserve | Shared | Shared | Shared + reserve | Shared |
| Draft/preview/publish | Live-save only | Draft themes, preview links, schedule | Draft + preview | Draft + preview | Draft + preview | Live |

**Positioning read:** DokanOS's unique angle — storefronts sharing the **same inventory, orders, and fulfillment pipeline as POS/Woo** — is genuinely differentiated and better than Dukaan's siloed approach. The gap is that everything merchants see and touch (themes, pages, content, SEO, analytics) is at the level of a weekend demo, not a platform. Close the "website builder" gap (sections, pages, theme options) and the differentiation starts to sell itself.

---

## 4. What needs to change — prioritized roadmap

### P0 — before charging any merchant for "a website"

1. **Section-based page builder (the big one).** New tables: `storefront_pages` (id, storefront_id, slug, title, type[home|custom|system], status, seo jsonb, created/updated) and `storefront_page_sections` (id, page_id, type, position, is_visible, props jsonb). Ship a v1 component library of 8-10 section types: hero, featured-products, product-grid, collection-grid, rich-text, image-banner, gallery, testimonials, FAQ, contact-form, newsletter. Home becomes a page composed of sections; About/Policies move to pages; keep system pages (shop/product/cart/checkout/track) as templates with editable header/footer.
   - Admin: page list (create/duplicate/delete), section list with add/reorder/hide, per-section prop forms, per-page SEO fields. A live preview iframe (`/storefront/:slug?preview=draft`) with draft/publish columns is the minimum viable editor.
2. **Wire up collections.** The table exists. Admin: manage collections (manual products; automated rules like `badge contains "new"` or category-match later). Runtime: Shop page gets collection tabs/filters, a `/collections/:slug` page, Home gets a collection-grid section.
3. **Product variations on storefront.** Product page variant picker (size/color from `product_variations`), pass `variation_id` through cart → checkout → `order_items`; edge function validates variation stock/price. Without this, fashion retail is not deliverable.
4. **SEO foundation.** Per-page/per-product `<title>`+meta description+OG+canonical (manageable per page in the builder), `sitemap.xml` per storefront (edge function or prerender), Product/Organization JSON-LD, stable stored product slugs (add `slug` column with uniqueness + backfill).
5. **Storefront settings object.** `storefronts.settings jsonb` covering: checkout methods enabled, min order, order instructions, free-shipping threshold, tax-inclusive flag, social/meta pixels IDs, announcement bar. Admin gets a Settings tab rendering this schema.
6. **Stock decrement + idempotency on checkout** (RPC: atomic validate-and-decrement inside a transaction; dedupe by idempotency key; restore stock on cancel).

### P1 — first release of "storefronts as a product"

7. **Theme system v2: themes as data.** `storefront_themes` registry (built-in presets + per-storefront overrides) with a settings schema per theme (fonts from a curated list, radius/spacing scale, button style, header/footer layout variants, dark-mode toggle). Upgrade `Home` section components to consume theme settings. Theme picker with live preview.
8. **Media library.** Supabase Storage bucket per business; upload/crop/alt-text; replace all raw-URL inputs (logo, hero, section images, og:image).
9. **Server-side analytics events.** `storefront_events` table (session_id, storefront_id, event_type, product_id, payload, created_at) written via a lightweight edge function (batched from client); dashboard tab with views → add-to-cart → checkout → purchase funnel, top products, referrers. Pixel integrations (GA4/Meta/TikTok) keyed off the same event pipeline.
10. **Shipping zones & methods.** Zone-based rates table (Pathao city/zone aware), free-shipping threshold from settings, remove the hard-coded 80/150 from Checkout.tsx client side.
11. **Customer notifications.** Order-confirmation SMS (operator's gateway) + email hooks; optional OTP on checkout phone to cut fake orders.
12. **Track-page security fix.** Move order lookup behind an edge function requiring order number + phone match; re-check anon SELECT policy on `orders`.
13. **Draft/publish workflow** for pages and storefront branding (draft jsonb columns + preview route + publish action).

### P2 — parity and polish

14. Payment gateway integration (SSLCommerz/bKash PGW) with the settings object controlling which methods render.
15. Customer accounts (OTP login) + server cart + cross-device persistence + abandoned-cart list.
16. Related-products, sale/compare-at pricing, reviews.
17. Blog/lookbook content type.
18. Automated custom-domain provisioning (Vercel domain API + DNS verification status chips in the Domains tab).
19. Multi-tenant RLS fix: scope `storefronts` policies to `business_id` via the `brands`/business membership model (mirror the pattern from the businesses migration).
20. Per-storefront rate limiting on `storefront-checkout` (Upstash or edge-function counter).
21. i18n of storefront content (bn/en) — strong BD-market differentiator vs Dukaan.

### Keep (already good)

- Single `orders`/`order_items`/`order_timeline` pipeline shared with POS — do not fork it.
- Server-side price/stock validation + store-linked product gating in the edge function.
- The accent-color HSL safety logic and the 4 visual layouts — these become the first 4 built-in themes in the v2 registry.
- `generate-storefront-content` AI seeding — genuinely ahead of Dukaan/Shopify here; keep and extend to section copy.
- Domain alias matching in `detectBrandAsync`.

---

## 5. Effort estimate (rough, single senior full-stack dev)

| Workstream | Size |
|---|---|
| Pages + sections builder (schema, runtime, admin, preview) | 3–5 weeks |
| Collections wiring | 3–5 days |
| Variations on storefront + checkout | 1–2 weeks |
| SEO foundation (meta/sitemap/JSON-LD/slugs) | 1 week |
| Settings object + admin tab | 3–4 days |
| Stock/idempotency fix | 2–3 days |
| Themes-as-data v2 | 2–3 weeks (after builder) |
| Media library | 1 week |
| Analytics events + dashboard | 1–2 weeks |
| Shipping zones | 4–5 days |

**Total to a credible "storefronts deliverable": ~10–14 weeks.** The page/section builder is the critical path; everything else can parallelize behind it.

---

*Audit artifacts: recon indexed in session knowledge base (StorefrontsPage, StorefrontLayout, Home/Shop/Product/Checkout/Track pages, catalog/cart/brand/theme libs, storefront migrations DDL, storefront-checkout function, robots.txt, RLS policy scan).*
