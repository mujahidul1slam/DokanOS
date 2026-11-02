# Storefront Plan — Short Version

Full detail: STOREFRONT-PLAN-FINAL.md (V7, converged after 7 critic cycles). This is the readable version.

## The one-line summary

Turn storefronts from a demo into a deliverable in **6 phases, ~9–12 weeks**: page builder, collections, variants, SEO, settings, safe checkout.

## Build order

`P1 → P2 → P3 → P5 → P6 → P4` (strict dependency order; P2/P3 can parallelize behind P1 with a second dev)

## The 6 phases

### P1 — Page builder (4–5 wk) — the heavy lift
Merchants get drag-order homepage/custom pages built from 9 section types (hero, product grid, etc.), with draft → preview → publish.
**Done when:** rebuild the current homepage entirely from sections, publish, old hardcoded layout never runs.

### P2 — Collections (3.5–5.5 d)
Shop page gets collection tabs + `/collections/:slug` pages. Uses tables that already exist in the DB.
**Done when:** create a collection in admin, watch it render on the storefront.

### P3 — Variants (1–1.5 wk)
Size/color pickers on product pages; chosen variant flows cart → checkout → order. Server validates variant price + stock.
**Done when:** order a size-M shirt; `order_items` row carries the variation.

### P5 — Settings (3.5–5 d)
One Settings tab: payment methods on/off, min order, free-shipping threshold, announcement bar.
**Done when:** toggle a setting in admin → storefront behavior changes.

### P6 — Safe checkout (7.5–9.5 d) — the critical safety fix
One atomic RPC: stock reserved inside the same transaction as the order. Double-click can't double-order. Cancel restores stock. Track page stops leaking customer PII to anyone with an order number.
**Done when:** hammer checkout with concurrent requests on 1-unit stock → exactly one order wins; anon key can no longer read `orders`.

### P4 — SEO (5–7 d)
Stable product slugs, per-page meta/OG, JSON-LD, real `sitemap.xml` + valid `robots.txt` per storefront.
**Done when:** Google Search Console accepts the sitemap; product pages render unique titles/descriptions.

## Total

`44.5–59.5 workdays` ≈ **9–12 weeks single dev**, ~7–9 weeks with two devs (P2/P3 parallel).

## Security must-dos baked in

- Today, `orders` is readable+writable by the **public anon key** — P6 closes it.
- Checkout currently never decrements stock — P6 fixes it atomically.
- PII: Track page queries get order-number + phone verification.
- Hand edits appearing live: P1 ships draft/publish so nothing is live-first.

## Explicitly NOT in this plan

Payment gateways, customer accounts, reviews, blog, media library, theme marketplace, analytics events, coupons, abandoned cart — those are P1/P2 follow-ups after this plan lands. See STOREFRONT-AUDIT.md §3–4.

## Next action

Start P1: read STOREFRONT-PLAN-FINAL.md §4 (page-builder phase), then branch and write the two migrations in §4.1.
