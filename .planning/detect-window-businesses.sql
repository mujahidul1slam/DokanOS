-- ============================================================================
-- R0 — Window-business detection report (CONTEXT.md D-05..D-08)
-- PASTE into Supabase Dashboard > SQL Editor. Run each block separately.
-- READ-ONLY BY DESIGN: every statement is a SELECT. No data is changed by this
-- file; the operator reviews the evidence below and acts manually, outside
-- this file, only on businesses they have personally confirmed.
--
-- Matches ONLY the old auto-template shape that provisioning created before
-- the Release-1 remediation (businesses signed up during the broken window).
-- ALL of the following must hold for a business to be reported:
--   * exactly one store, url = 'https://<business-slug>.<storefront_domain>',
--     status 'disconnected'
--   * exactly one brand, linked to that store (woo_store_id set)
--   * exactly one location named 'Main' (showroom, is_default)
--   * exactly one storefront carrying the business slug (may be published)
--   * selling-point types all within {showroom_pos, woocommerce, facebook,
--     dokanos_storefront}; count 3 or 4; the 3 unconditional types present
--     (facebook was conditional on legacy data, hence 3 or 4)
--   * exactly one connector: category channel / type woocommerce / disconnected
--   * exactly one product source (WooCommerce catalog / two_way / disconnected)
--   * exactly one customer source (WooCommerce customers / import / disconnected)
--   * exactly one owner user_business_access row; exactly one user_store_access
--   * zero real data: no orders, no products, no customers for the business's
--     stores
-- July-backfilled businesses (real data, extra brands, different shapes) never
-- match. Evidence columns follow CONTEXT.md D-07.
-- ============================================================================

-- 1. Detector — one row per matching business (expect: zero rows on a clean
--    post-remediation database; rows only for window businesses)
SELECT b.id AS business_id,
         b.name,
         b.slug,
         b.created_at,
         (SELECT u.email FROM public.user_business_access a
           JOIN auth.users u ON u.id = a.user_id
          WHERE a.business_id = b.id AND a.role = 'owner'
          LIMIT 1) AS owner_email,
         (SELECT s.url FROM public.brands br
           JOIN public.stores s ON s.id = br.woo_store_id
          WHERE br.business_id = b.id LIMIT 1) AS placeholder_store_url,
         (SELECT sf.is_active FROM public.storefronts sf
           JOIN public.brands br ON sf.store_id = br.woo_store_id
          WHERE br.business_id = b.id LIMIT 1) AS storefront_published,
         (SELECT string_agg(DISTINCT sp.type, ', ') FROM public.selling_points sp
          WHERE sp.business_id = b.id) AS selling_point_types,
         (SELECT count(*) FROM public.stores s
           JOIN public.brands br ON br.woo_store_id = s.id
          WHERE br.business_id = b.id) AS stores_n,
         (SELECT count(*) FROM public.locations l
          WHERE l.business_id = b.id) AS locations_n,
         (SELECT count(*) FROM public.storefronts sf
           JOIN public.brands br ON sf.store_id = br.woo_store_id
          WHERE br.business_id = b.id) AS storefronts_n,
         (SELECT count(*) FROM public.selling_points sp
          WHERE sp.business_id = b.id) AS selling_points_n,
         (SELECT count(*) FROM public.connectors c
          WHERE c.business_id = b.id) AS connectors_n,
         (SELECT count(*) FROM public.product_sources ps
          WHERE ps.business_id = b.id) AS product_sources_n,
         (SELECT count(*) FROM public.customer_sources cs
          WHERE cs.business_id = b.id) AS customer_sources_n,
         (SELECT count(*) FROM public.user_store_access usa
           JOIN public.brands br ON usa.store_id = br.woo_store_id
          WHERE br.business_id = b.id) AS user_store_access_n,
         (SELECT count(*) FROM public.user_business_access a
          WHERE a.business_id = b.id) AS uba_rows_n,
         (SELECT count(*) FROM public.orders o
           JOIN public.brands br ON o.store_id = br.woo_store_id
          WHERE br.business_id = b.id) AS orders_n,
         (SELECT count(*) FROM public.products p
           JOIN public.brands br ON p.store_id = br.woo_store_id
          WHERE br.business_id = b.id) AS products_n,
         (SELECT count(*) FROM public.customers c
           JOIN public.brands br ON c.store_id = br.woo_store_id
          WHERE br.business_id = b.id) AS customers_n
  FROM public.businesses b
  WHERE
    -- exactly one store, placeholder url derived from the business slug, disconnected
    (SELECT count(*) FROM public.stores s
      JOIN public.brands br ON br.woo_store_id = s.id
     WHERE br.business_id = b.id) = 1
    AND (SELECT s.url FROM public.brands br
          JOIN public.stores s ON s.id = br.woo_store_id
         WHERE br.business_id = b.id LIMIT 1)
        = 'https://' || b.slug || '.' ||
          (SELECT ac.value FROM public.app_config ac WHERE ac.key = 'storefront_domain')
    AND (SELECT s.status FROM public.brands br
          JOIN public.stores s ON s.id = br.woo_store_id
         WHERE br.business_id = b.id LIMIT 1) = 'disconnected'
    -- exactly one brand, linked to a store
    AND (SELECT count(*) FROM public.brands br
          WHERE br.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.brands br
                 WHERE br.business_id = b.id AND br.woo_store_id IS NOT NULL)
    -- exactly one Main showroom location
    AND (SELECT count(*) FROM public.locations l
          WHERE l.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.locations l
                 WHERE l.business_id = b.id AND l.name = 'Main'
                   AND l.type = 'showroom' AND l.is_default)
    -- exactly one storefront carrying the business slug
    AND (SELECT count(*) FROM public.storefronts sf
          JOIN public.brands br ON sf.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.storefronts sf
                 JOIN public.brands br ON sf.store_id = br.woo_store_id
                WHERE br.business_id = b.id AND sf.slug = b.slug)
    -- selling points: 3 or 4, template types only, the 3 unconditional types present
    AND (SELECT count(*) FROM public.selling_points sp
          WHERE sp.business_id = b.id) IN (3, 4)
    AND NOT EXISTS (SELECT 1 FROM public.selling_points sp
                     WHERE sp.business_id = b.id
                       AND sp.type NOT IN ('showroom_pos', 'woocommerce', 'facebook', 'dokanos_storefront'))
    AND EXISTS (SELECT 1 FROM public.selling_points sp
                 WHERE sp.business_id = b.id AND sp.type = 'showroom_pos')
    AND EXISTS (SELECT 1 FROM public.selling_points sp
                 WHERE sp.business_id = b.id AND sp.type = 'woocommerce')
    AND EXISTS (SELECT 1 FROM public.selling_points sp
                 WHERE sp.business_id = b.id AND sp.type = 'dokanos_storefront')
    -- exactly one channel/woocommerce disconnected connector
    AND (SELECT count(*) FROM public.connectors c
          WHERE c.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.connectors c
                 WHERE c.business_id = b.id AND c.category = 'channel'
                   AND c.type = 'woocommerce' AND c.status = 'disconnected')
    -- exactly one template product source
    AND (SELECT count(*) FROM public.product_sources ps
          WHERE ps.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.product_sources ps
                 WHERE ps.business_id = b.id AND ps.name = 'WooCommerce catalog'
                   AND ps.type = 'woocommerce' AND ps.status = 'disconnected'
                   AND ps.sync_direction = 'two_way')
    -- exactly one template customer source
    AND (SELECT count(*) FROM public.customer_sources cs
          WHERE cs.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.customer_sources cs
                 WHERE cs.business_id = b.id AND cs.name = 'WooCommerce customers'
                   AND cs.type = 'woocommerce' AND cs.status = 'disconnected'
                   AND cs.sync_direction = 'import')
    -- exactly one owner UBA row; exactly one user_store_access row
    AND (SELECT count(*) FROM public.user_business_access a
          WHERE a.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.user_business_access a
                 WHERE a.business_id = b.id AND a.role = 'owner')
    AND (SELECT count(*) FROM public.user_store_access usa
          JOIN public.brands br ON usa.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 1
    -- zero real data anywhere
    AND (SELECT count(*) FROM public.orders o
          JOIN public.brands br ON o.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 0
    AND (SELECT count(*) FROM public.products p
          JOIN public.brands br ON p.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 0
    AND (SELECT count(*) FROM public.customers c
          JOIN public.brands br ON c.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 0
ORDER BY b.created_at;

-- 2. Empty-case summary (expect the literal '0 businesses matched' when the
--    detector above found nothing). Same match predicate as block 1.
SELECT CASE WHEN COUNT(*) = 0 THEN '0 businesses matched'
            ELSE COUNT(*) || ' businesses matched - review the block 1 rows'
       END AS summary
FROM (
  SELECT b.id
  FROM public.businesses b
  WHERE
    (SELECT count(*) FROM public.stores s
      JOIN public.brands br ON br.woo_store_id = s.id
     WHERE br.business_id = b.id) = 1
    AND (SELECT s.url FROM public.brands br
          JOIN public.stores s ON s.id = br.woo_store_id
         WHERE br.business_id = b.id LIMIT 1)
        = 'https://' || b.slug || '.' ||
          (SELECT ac.value FROM public.app_config ac WHERE ac.key = 'storefront_domain')
    AND (SELECT s.status FROM public.brands br
          JOIN public.stores s ON s.id = br.woo_store_id
         WHERE br.business_id = b.id LIMIT 1) = 'disconnected'
    AND (SELECT count(*) FROM public.brands br
          WHERE br.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.brands br
                 WHERE br.business_id = b.id AND br.woo_store_id IS NOT NULL)
    AND (SELECT count(*) FROM public.locations l
          WHERE l.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.locations l
                 WHERE l.business_id = b.id AND l.name = 'Main'
                   AND l.type = 'showroom' AND l.is_default)
    AND (SELECT count(*) FROM public.storefronts sf
          JOIN public.brands br ON sf.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.storefronts sf
                 JOIN public.brands br ON sf.store_id = br.woo_store_id
                WHERE br.business_id = b.id AND sf.slug = b.slug)
    AND (SELECT count(*) FROM public.selling_points sp
          WHERE sp.business_id = b.id) IN (3, 4)
    AND NOT EXISTS (SELECT 1 FROM public.selling_points sp
                     WHERE sp.business_id = b.id
                       AND sp.type NOT IN ('showroom_pos', 'woocommerce', 'facebook', 'dokanos_storefront'))
    AND EXISTS (SELECT 1 FROM public.selling_points sp
                 WHERE sp.business_id = b.id AND sp.type = 'showroom_pos')
    AND EXISTS (SELECT 1 FROM public.selling_points sp
                 WHERE sp.business_id = b.id AND sp.type = 'woocommerce')
    AND EXISTS (SELECT 1 FROM public.selling_points sp
                 WHERE sp.business_id = b.id AND sp.type = 'dokanos_storefront')
    AND (SELECT count(*) FROM public.connectors c
          WHERE c.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.connectors c
                 WHERE c.business_id = b.id AND c.category = 'channel'
                   AND c.type = 'woocommerce' AND c.status = 'disconnected')
    AND (SELECT count(*) FROM public.product_sources ps
          WHERE ps.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.product_sources ps
                 WHERE ps.business_id = b.id AND ps.name = 'WooCommerce catalog'
                   AND ps.type = 'woocommerce' AND ps.status = 'disconnected'
                   AND ps.sync_direction = 'two_way')
    AND (SELECT count(*) FROM public.customer_sources cs
          WHERE cs.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.customer_sources cs
                 WHERE cs.business_id = b.id AND cs.name = 'WooCommerce customers'
                   AND cs.type = 'woocommerce' AND cs.status = 'disconnected'
                   AND cs.sync_direction = 'import')
    AND (SELECT count(*) FROM public.user_business_access a
          WHERE a.business_id = b.id) = 1
    AND EXISTS (SELECT 1 FROM public.user_business_access a
                 WHERE a.business_id = b.id AND a.role = 'owner')
    AND (SELECT count(*) FROM public.user_store_access usa
          JOIN public.brands br ON usa.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 1
    AND (SELECT count(*) FROM public.orders o
          JOIN public.brands br ON o.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 0
    AND (SELECT count(*) FROM public.products p
          JOIN public.brands br ON p.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 0
    AND (SELECT count(*) FROM public.customers c
          JOIN public.brands br ON c.store_id = br.woo_store_id
         WHERE br.business_id = b.id) = 0
) m;
