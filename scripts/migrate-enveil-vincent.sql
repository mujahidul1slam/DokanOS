-- ===========================================================================
-- Task 8 (spec §7): Enveil Vincent mapping migration — collapse the legacy
-- store/selling-point/storefront/location model into the unified order
-- sources + warehouses model, attribute products/customers/orders with
-- provenance, route the legacy pool, and wipe test/junk data.
--
-- ⚠ DRY-RUN TOOLING. This script has been executed against a SCRATCH database
--   only (tasks/audit/task8-dry-run-report.md). Executing it against
--   production is Task 17 and is gated on explicit user go-ahead.
--
-- ✅ EXECUTED IN PRODUCTION 2026-11-02 06:02 +06 (runbook Gate 2, user-gated),
--    audited live at Gate 3 (23/23 checks, tasks/audit/task17-readiness-report.md).
--    This file is now the HISTORICAL RECORD of what ran: it reads the legacy
--    contract tables (locations, selling_points, connectors, product_sources,
--    customer_sources) and the orders.selling_point_id column, which the Task 16
--    contract migration (supabase/migrations/20261103120000_task16_contract_drop.sql)
--    dropped afterwards. It can only be re-run against the PRE-Task-16 schema —
--    never against a database that already has 20261103120000 applied.
--
-- STRICTLY id-based: every target row is a UUID literal resolved from a
-- read-only production inventory (scripts/task8-extract-prod.mjs). There is
-- not a single name-based lookup anywhere in this file (spec §7 name traps:
-- two businesses are named "Enveil Vincent", and the selling points
-- 9d2cc780-… ("Enveil Woocommerce", junk) and 9a3fb6c0-… ("Enveil
-- WooCommerce", real) differ by one word).
--
-- Preconditions (production order):
--   1. the 19-file catch-up batch (tasks/audit/production-migration-plan.md)
--   2. Tasks 4–5 schema (unified order_sources, warehouses, stock model)
--   3. THIS script
--   4. audit review (Checkpoint C) before any legacy table is dropped (Task 16)
--
-- Idempotent: a marker guard refuses to apply twice (the transaction aborts
-- with "task8: mapping already applied" and mutates nothing).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.order_sources WHERE legacy_store_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'task8: mapping already applied (order_sources.legacy_* populated)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses WHERE id = 'de31fd60-a520-4d42-aef2-c72ededc4c09'
  ) THEN
    RAISE EXCEPTION 'task8: real tenant business de31fd60-… not found';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Sever the AGS → real-Enveil-store link FIRST (spec §7 warning): the test
--    storefront "AGS" points at the REAL Enveil store 4f3e88d1-… and must be
--    gone before any test-data deletion can touch stores.
-- ---------------------------------------------------------------------------
DELETE FROM public.storefront_pages WHERE storefront_id = 'a8ff5e33-986a-413e-a774-03ee49727fe9';
DELETE FROM public.storefronts WHERE id = 'a8ff5e33-986a-413e-a774-03ee49727fe9';

-- ---------------------------------------------------------------------------
-- 2. Create the mapped order sources — 4 per brand (spec §7 row mapping).
--    Woo config (URL + API keys) and storefront slugs are COPIED FROM the
--    legacy rows at runtime so credentials never appear in this file.
--    Product/customer sync registries are absorbed as audit ids in config.
-- ---------------------------------------------------------------------------

-- Vincent · WooCommerce  (store 1e69bece + SP ee56658a + connector 97a2980a)
INSERT INTO public.order_sources (
  id, brand_id, name, type, config, sync_direction, is_stock_holding,
  ship_from_store, fulfillment_preference,
  legacy_store_id, legacy_selling_point_id, legacy_connector_id
)
SELECT
  '2590e589-d158-4582-bc00-0446949d5433', 'ca061912-27a6-4eb5-a859-b77e9a347a30',
  'Vincent WooCommerce', 'woocommerce',
  jsonb_build_object(
    'url', s.url, 'consumer_key', s.consumer_key, 'consumer_secret', s.consumer_secret,
    'legacy_product_source_id', '3952f197-0ed1-4d6e-be92-dd4d6638383e',
    'legacy_customer_source_id', 'f45a537c-2024-4b73-844d-f961d688f5d0'
  ),
  'import', false, false,
  '["5c35187b-0079-49e1-a500-1c26e449d7f5","7e2687c4-5f42-49cd-bae7-0b583bd8a95f"]'::jsonb,
  '1e69bece-51f8-414c-ab8b-341702e008f5', 'ee56658a-12f3-4a9f-a6c4-f8c93daccb5b',
  '97a2980a-13af-4bc6-bc52-27670d2918c0'
FROM public.stores s WHERE s.id = '1e69bece-51f8-414c-ab8b-341702e008f5';

-- Vincent · Storefront  (storefront f6ee0470 + SP 27329597)
INSERT INTO public.order_sources (
  id, brand_id, name, type, config, sync_direction, is_stock_holding,
  ship_from_store, fulfillment_preference, legacy_storefront_id, legacy_selling_point_id
)
SELECT
  'c5376c7f-f9ae-44f8-8990-8e88e3ac419e', 'ca061912-27a6-4eb5-a859-b77e9a347a30',
  'Vincent Storefront', 'storefront',
  jsonb_build_object('slug', sf.slug),
  NULL, false, false,
  '["5c35187b-0079-49e1-a500-1c26e449d7f5","7e2687c4-5f42-49cd-bae7-0b583bd8a95f"]'::jsonb,
  'f6ee0470-36d5-40d7-9744-7a1b9d05944b', '27329597-561a-48e0-a80d-c0739e858741'
FROM public.storefronts sf WHERE sf.id = 'f6ee0470-36d5-40d7-9744-7a1b9d05944b';

-- Vincent · Showroom (location 183cc956 "Main" + SP 6bbf6ef1 showroom_pos)
INSERT INTO public.order_sources (
  id, brand_id, name, type, config, sync_direction, is_stock_holding,
  ship_from_store, fulfillment_preference, legacy_location_id, legacy_selling_point_id
)
VALUES (
  '7e2687c4-5f42-49cd-bae7-0b583bd8a95f', 'ca061912-27a6-4eb5-a859-b77e9a347a30',
  'Main Showroom', 'showroom', '{}'::jsonb, NULL, true, true,
  '["5c35187b-0079-49e1-a500-1c26e449d7f5"]'::jsonb,
  '183cc956-cdcd-401f-b604-a0707976f339', '6bbf6ef1-cc28-4a2f-8a0c-a6f663724b2b'
);

-- Vincent · Facebook / Instagram  (SP ea8e11ca)
INSERT INTO public.order_sources (
  id, brand_id, name, type, config, sync_direction, is_stock_holding,
  ship_from_store, fulfillment_preference, legacy_selling_point_id
)
VALUES (
  'b259adc8-67e2-406b-8f69-8fb84a737cfb', 'ca061912-27a6-4eb5-a859-b77e9a347a30',
  'Facebook / Instagram', 'facebook', '{}'::jsonb, NULL, false, false,
  '["5c35187b-0079-49e1-a500-1c26e449d7f5","7e2687c4-5f42-49cd-bae7-0b583bd8a95f"]'::jsonb,
  'ea8e11ca-0f22-42ea-aa91-f7d6c6f676fe'
);

-- Enveil · WooCommerce  (store 4f3e88d1 + SP 9a3fb6c0 [the REAL one] + connector fcea5e94)
INSERT INTO public.order_sources (
  id, brand_id, name, type, config, sync_direction, is_stock_holding,
  ship_from_store, fulfillment_preference,
  legacy_store_id, legacy_selling_point_id, legacy_connector_id
)
SELECT
  'ea160683-a303-4616-bda5-2d51cbf4f204', '3eb99fc9-7826-4890-ace0-78af0dfdf972',
  'Enveil WooCommerce', 'woocommerce',
  jsonb_build_object(
    'url', s.url, 'consumer_key', s.consumer_key, 'consumer_secret', s.consumer_secret,
    'legacy_product_source_id', '06e83840-e680-492c-af81-cfa45c9dad81',
    'legacy_customer_source_id', 'c279de21-b58e-4cf5-b8ee-b7bbc2e1057c'
  ),
  'import', false, false,
  '["748bb49a-8f5c-4c6e-a998-ef432b76f39a"]'::jsonb,
  '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd', '9a3fb6c0-0f01-439e-ab0a-5763373f7a05',
  'fcea5e94-66b3-4d4d-beed-b79a96ea60e5'
FROM public.stores s WHERE s.id = '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd';

-- Enveil · Storefront  (storefront fd570563 + SP d064cb98)
INSERT INTO public.order_sources (
  id, brand_id, name, type, config, sync_direction, is_stock_holding,
  ship_from_store, fulfillment_preference, legacy_storefront_id, legacy_selling_point_id
)
SELECT
  '81cb426c-06be-4790-a64c-6b59ae184a50', '3eb99fc9-7826-4890-ace0-78af0dfdf972',
  'Enveil Storefront', 'storefront',
  jsonb_build_object('slug', sf.slug),
  NULL, false, false,
  '["748bb49a-8f5c-4c6e-a998-ef432b76f39a"]'::jsonb,
  'fd570563-1534-4345-8944-39c5ef3924ff', 'd064cb98-3331-4c51-9440-017783f38dee'
FROM public.storefronts sf WHERE sf.id = 'fd570563-1534-4345-8944-39c5ef3924ff';

-- Enveil · Showroom (location 72dd1d66 "Main" + SP 349c86b1 showroom_pos)
INSERT INTO public.order_sources (
  id, brand_id, name, type, config, sync_direction, is_stock_holding,
  ship_from_store, fulfillment_preference, legacy_location_id, legacy_selling_point_id
)
VALUES (
  '748bb49a-8f5c-4c6e-a998-ef432b76f39a', '3eb99fc9-7826-4890-ace0-78af0dfdf972',
  'Main Showroom', 'showroom', '{}'::jsonb, NULL, true, true,
  '[]'::jsonb,
  '72dd1d66-caf2-4305-b669-4576ff0ab908', '349c86b1-cc19-4aa5-a362-409995910f96'
);

-- Enveil · Facebook / Instagram  (SP 3fff2122)
INSERT INTO public.order_sources (
  id, brand_id, name, type, config, sync_direction, is_stock_holding,
  ship_from_store, fulfillment_preference, legacy_selling_point_id
)
VALUES (
  '60741e62-1fee-4750-8882-27a144c997cb', '3eb99fc9-7826-4890-ace0-78af0dfdf972',
  'Facebook / Instagram', 'facebook', '{}'::jsonb, NULL, false, false,
  '["748bb49a-8f5c-4c6e-a998-ef432b76f39a"]'::jsonb,
  '3fff2122-9eb9-4ed9-ac24-82e6fd7a44fa'
);

-- ---------------------------------------------------------------------------
-- 2b. Courier services (Task 9, spec §4): the legacy Pathao accounts become
--     business-level courier services. Credentials are COPIED FROM the legacy
--     rows at runtime (never in this file); the per-brand courier connector is
--     paired through its config.integration_id id link — no name lookups.
-- ---------------------------------------------------------------------------
INSERT INTO public.courier_services (
  id, business_id, provider, name, credentials, is_active,
  legacy_pathao_integration_id, legacy_connector_id
)
SELECT
  CASE p.id
    WHEN '1931698d-3d31-421f-9c80-129792541b9d' THEN 'dc85e597-0269-4779-8fab-8aa698f1476f'::uuid
    WHEN '094b56e4-da50-4f1c-a804-a94ac4c0eb54' THEN 'b25408b6-ebbd-4396-a1e4-ddbe2bf38048'::uuid
  END,
  'de31fd60-a520-4d42-aef2-c72ededc4c09',
  'pathao', p.name,
  jsonb_build_object(
    'client_id', p.client_id, 'client_secret', p.client_secret,
    'username', p.username, 'password', p.password,
    'environment', p.environment, 'allowed_store_ids', p.allowed_store_ids
  ),
  p.is_active, p.id,
  (SELECT c.id FROM public.connectors c
   WHERE c.category = 'courier' AND c.config->>'integration_id' = p.id::text
   LIMIT 1)
FROM public.pathao_integrations p
WHERE p.id IN ('1931698d-3d31-421f-9c80-129792541b9d', '094b56e4-da50-4f1c-a804-a94ac4c0eb54');

-- ---------------------------------------------------------------------------
-- 3. Warehouse mapping: locations "Warehouse" (Vincent, 42cceea7) → warehouses.
--    (Enveil has no warehouse location — spec §7: "no warehouse yet — fine".)
-- ---------------------------------------------------------------------------
INSERT INTO public.warehouses (id, brand_id, name, is_default, address, city, zone, area)
SELECT
  '5c35187b-0079-49e1-a500-1c26e449d7f5', l.brand_id, l.name, l.is_default,
  l.address, l.city, l.zone, l.area
FROM public.locations l WHERE l.id = '42cceea7-5393-4d3a-b3cd-d303b0a121c6';

-- ---------------------------------------------------------------------------
-- 4. Stock: product_locations rows stay put physically — they repoint from the
--    legacy location to the mapped stock holder (spec §3/§7). Trigger
--    product_locations_stock_sync keeps products.stock_quantity aggregated.
-- ---------------------------------------------------------------------------
UPDATE public.product_locations
SET stock_holder_order_source_id = CASE location_id
      WHEN '183cc956-cdcd-401f-b604-a0707976f339' THEN '7e2687c4-5f42-49cd-bae7-0b583bd8a95f'::uuid
      WHEN '72dd1d66-caf2-4305-b669-4576ff0ab908' THEN '748bb49a-8f5c-4c6e-a998-ef432b76f39a'::uuid
    END,
    location_id = NULL
WHERE location_id IN ('183cc956-cdcd-401f-b604-a0707976f339', '72dd1d66-caf2-4305-b669-4576ff0ab908');

UPDATE public.product_locations
SET warehouse_id = '5c35187b-0079-49e1-a500-1c26e449d7f5'::uuid, location_id = NULL
WHERE location_id = '42cceea7-5393-4d3a-b3cd-d303b0a121c6';

-- ---------------------------------------------------------------------------
-- 5. Provenance: products (all woo-synced per brand).
-- ---------------------------------------------------------------------------
UPDATE public.products
SET origin_order_source_id = CASE store_id
      WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN '2590e589-d158-4582-bc00-0446949d5433'::uuid
      WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN 'ea160683-a303-4616-bda5-2d51cbf4f204'::uuid
    END,
    origin_kind = 'woo_sync'
WHERE store_id IN ('1e69bece-51f8-414c-ab8b-341702e008f5', '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd');

-- ---------------------------------------------------------------------------
-- 6. Customer duplicates (the two audited phone/alias matches) — merged into
--    the brand customer BEFORE attribution. Review item RESOLVED (human
--    sign-off 2026-11-01): one further strict email-alias duplicate
--    (1a689ee5-… → 4d0d1b7d-…) stays in the pool — deliberately NOT merged
--    (see tasks/audit/task8-dry-run-report.md).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE task8_merges (dup_id uuid PRIMARY KEY, keep_id uuid NOT NULL);
INSERT INTO task8_merges (dup_id, keep_id) VALUES
  ('c4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111'),
  ('c7777777-7777-7777-7777-777777777777', 'c1111111-1111-1111-1111-111111111111');

UPDATE public.orders o SET customer_id = m.keep_id
FROM task8_merges m WHERE o.customer_id = m.dup_id;

-- Aliases merge with de-duplication: a (type, value) the target already has is
-- not copied twice (uq_customer_alias_value); the rest move over, the
-- duplicates' leftovers are dropped with the row.
UPDATE public.customer_aliases a SET customer_id = m.keep_id
FROM task8_merges m
WHERE a.customer_id = m.dup_id
  AND NOT EXISTS (
    SELECT 1 FROM public.customer_aliases k
    WHERE k.customer_id = m.keep_id AND k.type = a.type AND k.value = a.value
  );
DELETE FROM public.customer_aliases a USING task8_merges m WHERE a.customer_id = m.dup_id;

DELETE FROM public.customers c USING task8_merges m WHERE c.id = m.dup_id;

-- ---------------------------------------------------------------------------
-- 7. Provenance: store-bound customers → their brand's channel source.
--    how: online→woo_sync, pos→pos, fb/ig→manual, else→manual (no source).
-- ---------------------------------------------------------------------------
UPDATE public.customers
SET origin_order_source_id = CASE
      WHEN source = 'pos' THEN CASE store_id
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN '7e2687c4-5f42-49cd-bae7-0b583bd8a95f'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN '748bb49a-8f5c-4c6e-a998-ef432b76f39a'::uuid
      END
      WHEN source = 'fb/ig' THEN CASE store_id
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN 'b259adc8-67e2-406b-8f69-8fb84a737cfb'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN '60741e62-1fee-4750-8882-27a144c997cb'::uuid
      END
      WHEN source = 'online' OR woo_customer_id IS NOT NULL THEN CASE store_id
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN '2590e589-d158-4582-bc00-0446949d5433'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN 'ea160683-a303-4616-bda5-2d51cbf4f204'::uuid
      END
      ELSE NULL
    END,
    origin_kind = CASE
      WHEN source = 'online' OR woo_customer_id IS NOT NULL THEN 'woo_sync'
      WHEN source = 'pos' THEN 'pos'
      ELSE 'manual'
    END
WHERE store_id IN ('1e69bece-51f8-414c-ab8b-341702e008f5', '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd');

-- ---------------------------------------------------------------------------
-- 8. Orders: store-bound → mapped source of their store/channel.
--    online/woocommerce/woo-id → WooCommerce; fb/ig → Facebook; everything
--    else on the counter (exchange/split/…) → the showroom source.
-- ---------------------------------------------------------------------------
UPDATE public.orders
SET order_source_id = CASE
      WHEN source IN ('online', 'woocommerce') OR woo_order_id IS NOT NULL THEN CASE store_id
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN '2590e589-d158-4582-bc00-0446949d5433'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN 'ea160683-a303-4616-bda5-2d51cbf4f204'::uuid
      END
      WHEN source = 'fb/ig' THEN CASE store_id
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN 'b259adc8-67e2-406b-8f69-8fb84a737cfb'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN '60741e62-1fee-4750-8882-27a144c997cb'::uuid
      END
      ELSE CASE store_id
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN '7e2687c4-5f42-49cd-bae7-0b583bd8a95f'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN '748bb49a-8f5c-4c6e-a998-ef432b76f39a'::uuid
      END
    END
WHERE store_id IN ('1e69bece-51f8-414c-ab8b-341702e008f5', '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd')
  AND order_source_id IS NULL;

-- ---------------------------------------------------------------------------
-- 8b. Customers: unattributed → brand via their connected orders' products
--     (human ruling 2026-11-01, Checkpoint C verdict 2). Evidence per
--     connected order = the order's own store/channel binding UNION the
--     store/brand of the products in its items. A customer touching exactly
--     one brand binds there; a customer with products/orders from BOTH brands
--     binds to the first one (deterministic tie-break: the brand of the
--     customer's earliest connected order, then brand UUID order).
--     Connected = orders.customer_id = customer.id, or the order has no
--     customer_id and the phones match (id wins, like step 9).
--     Binding mirrors step 7 exactly (transitional store_id + channel source).
--     Runs before step 9 so the customers' still-unattributed orders then
--     follow their customer — the script's existing inference semantics.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE task8_customer_brand (customer_id uuid PRIMARY KEY, brand_store uuid NOT NULL);

WITH ev AS (
  SELECT c.id AS customer_id, o.created_at, x.brand_store
  FROM public.customers c
  JOIN public.orders o
    ON (o.customer_id = c.id
        OR (o.customer_id IS NULL AND c.phone IS NOT NULL AND o.customer_phone = c.phone))
  CROSS JOIN LATERAL (
    SELECT DISTINCT y.brand_store
    FROM (
      SELECT o.store_id AS brand_store
      WHERE o.store_id IN ('1e69bece-51f8-414c-ab8b-341702e008f5', '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd')
      UNION
      SELECT CASE o.order_source_id
          WHEN '2590e589-d158-4582-bc00-0446949d5433' THEN '1e69bece-51f8-414c-ab8b-341702e008f5'::uuid
          WHEN '7e2687c4-5f42-49cd-bae7-0b583bd8a95f' THEN '1e69bece-51f8-414c-ab8b-341702e008f5'::uuid
          WHEN 'b259adc8-67e2-406b-8f69-8fb84a737cfb' THEN '1e69bece-51f8-414c-ab8b-341702e008f5'::uuid
          WHEN 'ea160683-a303-4616-bda5-2d51cbf4f204' THEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd'::uuid
          WHEN '748bb49a-8f5c-4c6e-a998-ef432b76f39a' THEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd'::uuid
          WHEN '60741e62-1fee-4750-8882-27a144c997cb' THEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd'::uuid
        END
      UNION
      SELECT p.store_id
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = o.id
        AND p.store_id IN ('1e69bece-51f8-414c-ab8b-341702e008f5', '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd')
    ) y
    WHERE y.brand_store IS NOT NULL
  ) x
  WHERE c.store_id IS NULL AND c.origin_order_source_id IS NULL
)
INSERT INTO task8_customer_brand (customer_id, brand_store)
SELECT DISTINCT ON (customer_id) customer_id, brand_store
FROM ev
ORDER BY customer_id, created_at ASC, brand_store ASC;

UPDATE public.customers c
SET store_id = cb.brand_store,
    origin_order_source_id = CASE
      WHEN c.source = 'pos' THEN CASE cb.brand_store
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN '7e2687c4-5f42-49cd-bae7-0b583bd8a95f'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN '748bb49a-8f5c-4c6e-a998-ef432b76f39a'::uuid
      END
      WHEN c.source = 'fb/ig' THEN CASE cb.brand_store
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN 'b259adc8-67e2-406b-8f69-8fb84a737cfb'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN '60741e62-1fee-4750-8882-27a144c997cb'::uuid
      END
      WHEN c.source = 'online' OR c.woo_customer_id IS NOT NULL THEN CASE cb.brand_store
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN '2590e589-d158-4582-bc00-0446949d5433'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN 'ea160683-a303-4616-bda5-2d51cbf4f204'::uuid
      END
      ELSE NULL
    END,
    origin_kind = CASE
      WHEN c.source = 'online' OR c.woo_customer_id IS NOT NULL THEN 'woo_sync'
      WHEN c.source = 'pos' THEN 'pos'
      ELSE 'manual'
    END
FROM task8_customer_brand cb
WHERE c.id = cb.customer_id AND c.store_id IS NULL AND c.origin_order_source_id IS NULL;

-- ---------------------------------------------------------------------------
-- 9. Orders: unattributed → infer brand via customer id/phone match
--    (exactly one store-bound customer on that phone; id match wins), then
--    attribute by channel. Channel text: pos/exchange → showroom, fb/ig →
--    Facebook. Everything unmatched goes to the Legacy pool (step 10).
-- ---------------------------------------------------------------------------
WITH resolved AS (
  SELECT o.id AS order_id,
         COALESCE(c_by_id.store_id, CASE WHEN ph.n = 1 THEN ph.store_id END) AS store_id
  FROM public.orders o
  LEFT JOIN public.customers c_by_id
    ON c_by_id.id = o.customer_id AND c_by_id.store_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, min(c.store_id::text)::uuid AS store_id
    FROM public.customers c
    WHERE c.store_id IS NOT NULL
      AND o.customer_phone IS NOT NULL
      AND c.phone = o.customer_phone
  ) ph ON TRUE
  WHERE o.store_id IS NULL AND o.selling_point_id IS NULL AND o.storefront_id IS NULL
    AND o.order_source_id IS NULL
)
UPDATE public.orders o
SET order_source_id = CASE
      WHEN o.source = 'fb/ig' THEN CASE r.store_id
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN 'b259adc8-67e2-406b-8f69-8fb84a737cfb'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN '60741e62-1fee-4750-8882-27a144c997cb'::uuid
      END
      ELSE CASE r.store_id
        WHEN '1e69bece-51f8-414c-ab8b-341702e008f5' THEN '7e2687c4-5f42-49cd-bae7-0b583bd8a95f'::uuid
        WHEN '4f3e88d1-c592-48d9-ba0d-aa50a12e82fd' THEN '748bb49a-8f5c-4c6e-a998-ef432b76f39a'::uuid
      END
    END
FROM resolved r
WHERE r.order_id = o.id AND r.store_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 10. Legacy pool (spec §7 / Task 15): remaining unattributed customers and
--     orders are tagged `legacy migration` (business-level pool, reassignable
--     from the UI later). customers additionally get origin_kind 'legacy'.
--     After 8b this is the residual pool: rows with NO brand evidence.
--     Note: this replaces the free-text channel on pool rows (pos/fb-ig/…);
--     they are by definition the rows nobody could attribute.
-- ---------------------------------------------------------------------------
UPDATE public.orders
SET source = 'legacy migration'
WHERE store_id IS NULL AND selling_point_id IS NULL AND storefront_id IS NULL
  AND order_source_id IS NULL;

UPDATE public.customers
SET source = 'legacy migration', origin_kind = 'legacy', origin_order_source_id = NULL
WHERE store_id IS NULL AND origin_order_source_id IS NULL;

-- ---------------------------------------------------------------------------
-- 11. Junk rows inside the real business (spec §7: 4 rows + 2 pages).
-- ---------------------------------------------------------------------------
DELETE FROM public.storefront_pages WHERE storefront_id = '94cd65c5-fbb0-4ff5-a60a-c5e33e325728';
DELETE FROM public.storefronts WHERE id = '94cd65c5-fbb0-4ff5-a60a-c5e33e325728';
DELETE FROM public.selling_points WHERE id IN (
  '7df6baea-b2b1-4db0-90f0-b2ee853e86b6',   -- "Badda Showroom"   (no location, zero children)
  '9d2cc780-0e2a-44c8-a4dc-afef2eec4267'    -- "Enveil Woocommerce" junk (≠ real 9a3fb6c0-…)
);
DELETE FROM public.brands WHERE id = 'd56f8d28-0a28-4f57-894d-8f85c27e8dfa';  -- "safsdfsafsd"

-- ---------------------------------------------------------------------------
-- 12. Test data wipe (spec §7): 7 test businesses, 6 test brands/stores,
--     7 storefronts (incl. the AGS link from step 1), 4 locations,
--     14 selling points, 1 connector, 7 access rows. Children first.
--     (Pathao courier connectors 43c2b501/2a01ee63 stay — Task 9.)
-- ---------------------------------------------------------------------------
DELETE FROM public.storefront_pages WHERE storefront_id IN (
  '92d6a911-2814-4515-9bf2-9aab2d633988', 'c58e16f8-e795-4ab6-b876-635e2ccc40aa',
  '7118742f-38c6-4910-a2e6-90b91fdd5091', 'bdae070b-b7de-41cd-8cbb-0690701dc71f',
  '81ad0a94-1740-49b8-a107-4822801e2c2b', 'da25adff-1d2d-4b26-90fe-d30e182d3a58'
);
DELETE FROM public.storefronts WHERE id IN (
  '92d6a911-2814-4515-9bf2-9aab2d633988', 'c58e16f8-e795-4ab6-b876-635e2ccc40aa',
  '7118742f-38c6-4910-a2e6-90b91fdd5091', 'bdae070b-b7de-41cd-8cbb-0690701dc71f',
  '81ad0a94-1740-49b8-a107-4822801e2c2b', 'da25adff-1d2d-4b26-90fe-d30e182d3a58'
);
DELETE FROM public.selling_points WHERE id IN (
  '91346569-e413-4cdd-bf2a-4779173f1873', 'c9f7d9eb-bc39-4895-8afb-e40bc40f368e',
  '17e2c65f-e16d-454d-b471-e2c1f7306341', '03a1b54f-91d3-4223-9e9f-708fcfa6b6b9',
  '1ae91ae9-0094-49e7-a464-f0ce9f4454c3', '7bb347bc-5879-4dfa-acc7-b90c1c8abd3e',
  '88cd4268-3db7-45da-b4da-7c8f525a7338', '1d975562-d26f-4d88-8ed3-6f86b728d9a1',
  '2b43c765-aaf9-4df4-98df-3254ac44015f', '373ca8b0-3228-4c78-b875-751d55e5d753',
  '62969b2d-1f27-43d0-a3a8-89002cc604c4', 'c8c5e1c3-88c5-4132-8913-4b44e5a942e6',
  'bc50cb45-a05e-469e-a411-63e8047dffd2', '3aa97b8b-7808-46ec-8011-0a52f3f722d6'
);
DELETE FROM public.connectors WHERE id = '9f777dc7-43cd-44b3-9260-d85d5f9d9332';
DELETE FROM public.product_sources WHERE id = '11b92544-a404-4e06-b5a6-900a8e18a60c';
DELETE FROM public.customer_sources WHERE id = 'b6896fa5-83f0-45c1-89aa-310ad4a94ebb';
DELETE FROM public.locations WHERE id IN (
  'e904dd1d-46d6-4e58-a86f-597bc84c679f', '38bb0bad-93cc-4499-bc68-8de797d6f534',
  'b704d7c8-0892-4635-904d-92cb545ad93b', '28699735-7e02-4689-b822-f10d91b0191d'
);
DELETE FROM public.brands WHERE id IN (
  '1d94b3d2-c517-4655-9efe-d3af1d1eb938', 'ff084a3e-cab7-425f-b6ef-e61f4c9e8e62',
  '872aadb0-0ca9-40fe-8e6d-3701cedb8195', '6e4bb44a-a90c-4753-b823-cb95408c491f',
  '7de0f344-8e87-4605-9bb5-3c6185c33456', 'c485c69d-0c30-48cf-86ec-b02514eb7b51'
);
DELETE FROM public.stores WHERE id IN (
  '5c7f6e65-34f7-4f99-a55d-84c89fb39319', 'a598be22-d671-4b5f-8062-f9372a8db19b',
  '4c3b201c-f8bf-4348-9f65-4a97970d02e2', '0765f6c9-c724-4f7d-bdd6-8f0d4d22a7f5',
  'f2380624-53fd-4297-9a4e-90df17fc5f6c', 'a30b5aca-7bf6-4a88-acea-2261c976cc58'
);
DELETE FROM public.user_business_access WHERE business_id IN (
  'e36ec825-2bb7-42e4-8b96-53a969054064', 'e621f647-b7a1-4138-a3f8-8ced122fa556',
  '13e888dc-db75-47cf-94c4-012bc1d5f669', '51fe2209-6db1-44ce-861e-c48dec6d5128',
  '38bc6846-8cc3-403d-9691-4a0d744c39b7', 'f72ddfe3-09f1-4913-b2cf-02aecd89b99a',
  'c75866f9-d930-44a6-ada7-c9d70bbbefd6'
);
DELETE FROM public.businesses WHERE id IN (
  'e36ec825-2bb7-42e4-8b96-53a969054064', 'e621f647-b7a1-4138-a3f8-8ced122fa556',
  '13e888dc-db75-47cf-94c4-012bc1d5f669', '51fe2209-6db1-44ce-861e-c48dec6d5128',
  '38bc6846-8cc3-403d-9691-4a0d744c39b7', 'f72ddfe3-09f1-4913-b2cf-02aecd89b99a',
  'c75866f9-d930-44a6-ada7-c9d70bbbefd6'
);

COMMIT;
