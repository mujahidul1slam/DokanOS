# Native Storefronts: Enveil & Vincent

Two brand storefronts served from this app via host/path routing, fully wired into the existing dashboard (products, categories, orders, Pathao).

## 1. Routing & host model

- New `src/storefront/BrandRouter.tsx` runs before `AppRoutes`. Detects brand from `window.location.hostname` (`enveil.*`, `vincent.*`) or `?brand=enveil|vincent`, otherwise serves dashboard.
- Brand routes (per brand, under `/storefront/:brand/*` and the brand root):
  - `/` home
  - `/shop`, `/shop/:categorySlug`
  - `/product/:slug`
  - `/cart`, `/checkout`, `/checkout/success/:orderNumber`
  - `/track`, `/about`, `/contact`, `/policy/:slug`
- `BrandContext` exposes brand config, theme tokens, currency.
- `StorefrontLayout` wraps every storefront page with brand nav + footer + theme via `data-brand` attr.

## 2. Design system

- Tokens layered in `index.css` via `[data-brand="enveil"]` and `[data-brand="vincent"]` blocks. All HSL.
- **Enveil — Editorial Magazine**: warm `#814037` accent, ivory/cream surfaces, Cormorant Garamond display + Inter body, frosted-glass cards, large serif hero left + featured product right, editorial grid.
- **Vincent — Dark Cinematic**: pure black/white, kinetic display type (Archivo Black + Inter), liquid-glass capsules, full-screen black hero, scroll-reveal product films.
- Shared components in `src/storefront/components/`: `GlassPanel`, `LiquidBackdrop`, `BrandButton`, `ProductCard`, `PriceTag`, `QuantityStepper`, `SizeSelector`, `MiniCart`, `Marquee`, `RevealOnScroll`. All consume tokens — no hard-coded colors.
- Framer Motion for hero animation + scroll reveals.

## 3. Catalog (manual curation)

New tables (migration):
- `storefronts` — slug, name, store_id, accent_hex, hero_title/subtitle/image, logo, favicon, about_md, contact, social jsonb, policies jsonb, currency (BDT), is_active.
- `storefront_products` — storefront_id, product_id, position, is_featured, badge, hero_collection, added_at.
- `storefront_collections` + `storefront_collection_products`.
- `storefront_pages` — slug, title, body_md.

RLS: public `SELECT` for active storefronts/products/collections/pages; admin+staff write. Indexes on (storefront_id, position) and (storefront_id, product_id).

Seed Enveil + Vincent rows pointing at their respective stores.

## 4. Cart & checkout

- Cart in `localStorage`, namespaced per brand (`cart:enveil`, `cart:vincent`).
- Single-page glass checkout: name, phone, address, Pathao city/zone/area cascading dropdowns (reuses `pathao_cities/zones/areas`).
- Payment: **Cash on Delivery** (default) or **bKash / Nagad — manual** (optional TrxID + sender number).
- New edge function `storefront-checkout` (verify_jwt=false, CORS, zod validation):
  1. Validates payload + verifies product IDs are active/in-stock from `products`/`product_variations`.
  2. Recomputes subtotal/shipping/total server-side (shipping from `invoice_settings`).
  3. Upserts `customers` row (`source='online'`, store_id from storefront).
  4. Inserts `orders` row: `source='online'`, `fulfillment_type='delivery'`, `status='pending'`, `payment_status='unpaid'` (COD) or `'pending_verification'` (manual bKash), Pathao IDs, `amount_to_collect`, snapshot customer fields, `payment_meta` with TrxID/sender if provided.
  5. Inserts `order_items` + `order_timeline` entry.
  6. Returns `order_number` for success page.
- Orders appear in existing dashboard immediately (already RLS-readable to authenticated).

## 5. Dashboard additions

- New sidebar group "Storefronts" with Enveil/Vincent sub-pages.
- `StorefrontEditor` page per brand: brand profile fields, hero, about, contact, policies, social, logo upload.
- Curation tab: search existing products → add to storefront, reorder (drag), toggle featured, set badge.
- Collections tab: create collections, assign products.
- Pages tab: edit `storefront_pages` (about, shipping, returns, terms).
- "View live" button opens `/storefront/<brand>/` in new tab.
- Orders page gets a `source='online'` + storefront filter chip.

## 6. SEO / PWA / hosting

- Per-brand `<title>`, meta description, OG image, canonical, JSON-LD `Product` + `Organization`.
- Lazy-load entire storefront bundle (`React.lazy`) so dashboard isn't bloated.
- Sitemap + robots via edge functions `storefront-sitemap`, `storefront-robots` (verify_jwt=false).
- Custom domains added later in Lovable hosting; `BrandRouter` already detects by hostname.

## 7. Out of scope (v1)

Online payment gateway (SSLCommerz/bKash API), customer accounts, email/SMS confirmations, multi-currency, i18n.

## Files / edge functions / migrations

```text
src/storefront/
  BrandRouter.tsx, BrandContext.tsx, StorefrontLayout.tsx
  themes/enveil.css, themes/vincent.css
  pages/{Home,Shop,Product,Cart,Checkout,Success,Track,About,Contact,Policy}.tsx
  components/{GlassPanel,LiquidBackdrop,BrandButton,ProductCard,...}.tsx
  lib/{cart.ts, catalog.ts, checkout.ts, brand.ts, seo.ts}
src/pages/admin/storefronts/{StorefrontList,StorefrontEditor}.tsx
supabase/functions/{storefront-checkout,storefront-sitemap,storefront-robots}/index.ts
Migration: 5 tables + RLS + indexes + seed
```

Approve to start building.