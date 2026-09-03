# DokanOS Multi-Business Restructure — Plan & Ledger

> **Purpose:** Implement the full hierarchy the user specified:
>
> **User Profile → Organization/Business Account → Brand → { Locations,
> Stores, Connectors (WooCommerce **and couriers**) }**
>
> Decisions locked in by the user (2026-09-04):
> 1. Keep `stores` = channel (Woo connector). Hierarchy goes ABOVE it.
> 2. Selling Points and Channels: MERGED into one list per brand
>    ("selling points" with a `type`), including POS-as-location.
> 3. True multi-tenancy: one login can belong to multiple business accounts.
> 4. PHASED plan (no big-bang).
> 5. POS is location/showroom-based.
> 6. **Couriers are connectors too** (Pathao = first courier connector; the
>    Phase-2 courier-agnostic core from REVAMP-PLAN is the adapter layer).
>
> Anything requiring human input is parked in §6 (executed LAST, if at all).

---

## 1. Target model

```
profiles (user)
  └── user_business_access ──→ businesses (org / tenant)
                                 ├── business_members (role per business)
                                 ├── brands (e.g. "Enveil", "Vincent")
                                 │     ├── locations (warehouse | showroom | store)
                                 │     │     └── product_locations (stock per location)
                                 │     ├── selling_points (channel-ish: POS showroom,
                                 │     │     Woo store link, storefront, FB/IG, ...)
                                 │     ├── connectors (woo, pathao, future shopify/
                                 │     │     steadfast; config blob + status)
                                 │     ├── product_sources  (where catalog comes from)
                                 │     └── customer_sources (where customers come from)
                                 └── (later) suppliers / purchase orders
```

Key rules:
- `stores` (Woo) stays exactly as-is — it IS the Woo connector's channel
  record. New `connectors` rows reference it (`config->>'store_id'`), rather
  than moving 8 tables' worth of FKs.
- All new tables carry `business_id` (+ brand/location scope where relevant).
- RLS v1: business-scoped via `user_business_access` membership for NEW
  tables; existing tables keep current policies (true multi-tenant RLS
  tightening is §6 — needs human sign-off because a bug = tenant leak).

## 2. Live-data facts driving the backfill (verified 2026-09-04)

- 2 Woo stores: Enveil (4f3e…82fd), Vincent (1e69…08f5).
- 1 `invoice_settings` row: "Enveil Vincent" (global profile hack).
- 2 storefronts, each `store_id`-linked to its store; 2 pathao_integrations
  (one per store); POS shifts already store_id-scoped.
- 3 profiles, 2 admin user_roles, 0 user_store_access rows.
- order_sources: woocommerce / pos / fb-ig (global, 3 rows).

## 3. Phases

- **Phase 0 — Foundation (schema + backfill).** businesses,
  user_business_access, brands, locations, selling_points, connectors,
  product_sources, customer_sources (+ suppliers/purchase_orders schema in
  same migration to freeze FK contracts). Backfill: one business
  "Enveil Vincent" (from invoice_settings), owner = every admin; two brands
  (Enveil, Vincent); one location per brand (Main, type=showroom, default);
  selling points: POS per brand + Woo (channel-linked) + FB/IG;
  connectors: 2 woo + 2 pathao; sources registries seeded. Verify via oracle,
  then drop oracle. Commit.
- **Phase 1 — Context + switcher.** `useBusinessContext` (businesses table,
  supersedes invoice_settings-based useBusinessProfile for identity; the
  invoice_settings row remains the default business profile until Phase 7 of
  the original plan splits it). Sidebar: business switcher lists businesses
  from DB (falls back to legacy profile rows if no businesses exist yet).
  Brand context: `useBrandContext` with per-brand filter for storefront
  links. Tests/build/lint. Commit.
- **Phase 2 — Stores hub.** /stores gains a hub layout: business header,
  brand cards (from brands table), each brand card links to Locations /
  Selling Points / Connectors / Sources tabs (new lightweight CRUD dialogs on
  the new tables) + the existing Woo store config + sync buttons (preserved
  1:1). Commit.
- **Phase 3 — Warehouses/locations + stock scoping.** product_locations
  (backfilled from products.stock_quantity × default location), warehouse_id
  on orders (default = brand's default location), stock adjustments write
  per-location. Minimal UI: location picker in order detail + low-stock per
  location in products page. Commit.
- **Phase 4 (schema already in 0; UI later)** — selling-point-scoped POS:
  POS opens against a selling point (location-bound); pos_shifts gains
  selling_point_id (nullable, backfilled from store_id).
- **Defer to §6 (human input):** RLS tightening matrix, custom-domain
  mapping per storefront, invoice_settings split per business/brand
  (original Phase 7), suppliers/purchase-orders UI, product/customer source
  import pipelines (Excel), storefront-builder phases (separate plan that
  follows this one).

## 4. Decisions & tradeoffs (recorded)

- `stores` NOT renamed: sync infra (sync_queue.store_id FK, triggers,
  woo-push, pathao_store_links) is deeply coupled; connectors reference
  stores instead. Terminology documented here.
- One business seeded from the single invoice_settings row ("Enveil
  Vincent") — matches how the shop actually operates today (one company,
  two brands). Brand-per-store matches storefronts 1:1.
- connectors table is provider-agnostic (type + config jsonb + status +
  last_sync_at) and supersedes nothing: pathao_integrations keeps working;
  the connector row links to it via config.
- locations vs selling points: kept SEPARATE (warehouse = stock source;
  selling point = demand channel), per the industry takeaways. Selling
  points reference a location (POS/showroom types need a physical place).
- products.stock_quantity remains the aggregate read model;
  product_locations becomes the write model (Phase 3) — sum maintained by
  trigger.

## 5. Status ledger

- 2026-09-04: Plan written. Recon done (recon oracle …000010, to be dropped
  with Phase 0's drop migration).

## 6. HUMAN-INPUT PARKING LOT (execute last)

1. CF Worker deploy (from previous revamp) — user does in dashboard.
2. Alert webhook secret — user provides URL.
3. Confirm business name/brand mapping ("Enveil Vincent" business with two
   brands Enveil+Vincent) — plan assumes yes; changing later = 3 UPDATEs.
4. RLS tightening sign-off for true tenant isolation on core tables.
5. Custom-domain → storefront mapping strategy (Vercel rewrite vs CF).
6. invoice_settings split (per-business defaults + per-store overrides).
