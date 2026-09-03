-- Fix courier connector backfill: the foundation's pathao loop cross-joined
-- and produced two rows pointing at ONE integration. Rebuild courier
-- connectors from pathao_store_links (woo_store_id ↔ pathao_integration_id)
-- which is the authoritative per-store mapping.

DELETE FROM public.connectors WHERE category = 'courier';

INSERT INTO public.connectors (business_id, brand_id, category, type, name, status, config)
SELECT v_biz.id, b.id, 'courier', 'pathao',
       'Pathao — ' || b.name,
       CASE WHEN pi.is_active THEN 'connected' ELSE 'disconnected' END,
       jsonb_build_object('integration_id', psl.pathao_integration_id)
FROM public.pathao_store_links psl
JOIN public.pathao_integrations pi ON pi.id = psl.pathao_integration_id
JOIN public.brands b ON b.woo_store_id = psl.woo_store_id
CROSS JOIN (SELECT id FROM public.businesses ORDER BY created_at LIMIT 1) v_biz
ON CONFLICT DO NOTHING;

-- Also clean the misleading connector name format on any pathao integration
-- that has NO store link (platform-wide integration): attach to business only.
INSERT INTO public.connectors (business_id, brand_id, category, type, name, status, config)
SELECT v_biz.id, NULL, 'courier', 'pathao', 'Pathao (platform)',
       CASE WHEN pi.is_active THEN 'connected' ELSE 'disconnected' END,
       jsonb_build_object('integration_id', pi.id)
FROM public.pathao_integrations pi
CROSS JOIN (SELECT id FROM public.businesses ORDER BY created_at LIMIT 1) v_biz
WHERE NOT EXISTS (
  SELECT 1 FROM public.connectors c
  WHERE c.category = 'courier' AND (c.config->>'integration_id')::uuid = pi.id
)
ON CONFLICT DO NOTHING;
