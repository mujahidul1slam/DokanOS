-- TEMPORARY verification oracle (revamp 1.4): reads recent webhook_events
-- (RLS-blocked for anon by design) and cleans up the synthetic order injected
-- by .tmp/sig-3way-test.cjs (woo_order_id 999999999, customer "Sig Test").
-- Push -> invoke via PostgREST -> then push the drop migration (see ledger
-- pattern 20260831000380...392).

CREATE OR REPLACE FUNCTION public.verify_webhook_signatures()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent jsonb;
  deleted_order text;
  deleted_customer text;
BEGIN
  -- 1. Clean the synthetic 3-way-test order (and its items/timeline via FK cascade).
  DELETE FROM public.orders WHERE woo_order_id = 999999999 AND store_id IN (
    SELECT id FROM public.stores WHERE url LIKE '%vincentdhaka.com%'
  );
  IF FOUND THEN
    deleted_order := 'yes';
  ELSE
    deleted_order := 'not_found';
  END IF;

  -- 2. Clean the synthetic customer.
  DELETE FROM public.customers WHERE email = 'sig@test.local' OR phone = '01700000000';
  IF FOUND THEN
    deleted_customer := 'yes';
  ELSE
    deleted_customer := 'not_found';
  END IF;

  -- 3. Return the last 10 webhook deliveries for inspection.
  SELECT jsonb_agg(jsonb_build_object(
    'delivery_id', delivery_id,
    'topic', topic,
    'woo_id', woo_id,
    'status_code', status_code,
    'error', error,
    'created_at', created_at
  ) ORDER BY created_at DESC)
  INTO recent
  FROM (SELECT * FROM public.webhook_events ORDER BY created_at DESC LIMIT 10) t;

  RETURN jsonb_build_object(
    'deleted_test_order', deleted_order,
    'deleted_test_customer', deleted_customer,
    'recent_events', COALESCE(recent, '[]'::jsonb)
  );
END;
$$;

-- Temporarily callable by anon so PostgREST can invoke it from .tmp scripts.
REVOKE ALL ON FUNCTION public.verify_webhook_signatures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_webhook_signatures() TO anon, authenticated, service_role;
