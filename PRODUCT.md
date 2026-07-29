# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Small to medium Bangladeshi e-commerce shop owners who sell online via WooCommerce and in-person through a built-in POS. They typically juggle separate tools — a WooCommerce admin panel, a courier dashboard (Pathao), standalone POS software, and spreadsheets for inventory — and need a single place to run the entire shop.

## Product Purpose
DokanOS is a shop operating system that unifies online and offline commerce operations. It replaces the fragmented daily workflow of managing WooCommerce orders, dispatching parcels through Pathao, running point-of-sale transactions, tracking inventory, and managing customers — all from one dashboard. Success means a shop owner can run their entire business from DokanOS without opening WooCommerce admin, the Pathao merchant panel, or a separate POS app.

## Positioning
All-in-one shop OS purpose-built for Bangladeshi e-commerce: deep WooCommerce sync (orders, products, customers, webhooks), native Pathao courier dispatch with city/zone/area auto-matching, built-in POS with cash/COD/online payment tracking, and measurement-based order workflows — in a single web app that works on desktop and mobile.

## Operating Context
- Operators work from desktop browsers at their shop/office and from mobile browsers on the go.
- Daily workflows: process new online orders → dispatch to Pathao → track shipments → manage returns/exchanges; ring up walk-in sales on POS; sync products and inventory with WooCommerce.
- Currency is Bangladeshi Taka (৳ / BDT). Courier integration is Pathao (Bangladeshi logistics). Location hierarchy follows Bangladesh's city → zone → area structure.
- Multi-store support: some operators manage multiple WooCommerce stores from a single DokanOS account.
- Team access with role-based permissions (owner, manager, staff).

## Capabilities and Constraints
- **WooCommerce Integration:** Full bidirectional sync — orders, products (with variations), categories, customers. Real-time webhook processing plus bulk sync.
- **Pathao Courier:** Bulk dispatch, auto-fill city/zone/area from customer address, tracking status sync, COD remittance handling.
- **POS:** Walk-in sales, barcode scanning, cash/card/mobile payments, due collection tracking.
- **Order Management:** Tabbed pipeline (New, Pre-Order, Payment Pending, Shipped, Delivered, Cancelled), detail sheets with timeline, exchange/return workflows, pickup slip printing.
- **Products:** Synced from WooCommerce with stock management, variations, categories, low-stock alerts.
- **Customers:** Global phone-based identity, alias resolution across stores, order history.
- **Analytics & Reports:** Revenue trends, source mix, payment method breakdown, top products, fulfillment funnel, POS cash reports.
- **Storefronts:** Headless storefront builder with checkout (COD and online payment).
- **Measurements:** Custom measurement groups and fields attached to order items (e.g., tailoring dimensions).
- **PWA:** Installable as a progressive web app on mobile and desktop.
- **Auth:** Supabase authentication with email/password, team invites, role-based access control.

## Evidence on Hand
- Live production deployment on Vercel, backed by Supabase (project `jiwndicvfkiltgageqwv`).
- Existing logo asset at `src/assets/dokanos-logo-stacked.png`.
- No formal brand guidelines, design tokens file, or DESIGN.md exist.
- No testimonials, case studies, or marketing copy are present in the codebase.

## Product Principles
1. **One place, zero tab-switching.** Every tool a shop owner needs lives inside DokanOS — they should never have to open another admin panel.
2. **Bangladesh-native by default.** Currency, courier, location hierarchy, and payment methods are built for the Bangladeshi market, not adapted from a global template.
3. **Online and offline are the same business.** POS sales and WooCommerce orders flow through the same pipeline, the same inventory, and the same customer records.
4. **Speed over ceremony.** Operators process dozens of orders daily; every interaction should minimize clicks and automate repetitive decisions (auto-fill addresses, auto-detect COD, bulk dispatch).
5. **Works on any screen.** Desktop-first but fully functional on mobile browsers and as an installed PWA.
