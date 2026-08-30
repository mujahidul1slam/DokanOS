-- enqueue_order_push v2: item-edit enqueues must carry include_items so
-- woo-push knows it has to rebuild WooCommerce line_items. Status-only pushes
-- (reason 'trigger'/'manual') never touch Woo line items — that keeps the
-- 1000-row delivered-backlog and routine status pushes from mass-rewriting
-- line items, while honoring the "overwrite on item edits" decision.
CREATE OR REPLACE FUNCTION public.enqueue_order_push(
  p_order_id uuid,
  p_reason text DEFAULT 'manual'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND OR o.woo_order_id IS NULL OR o.store_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.sync_queue (store_id, order_id, action, payload, idempotency_key)
  VALUES (o.store_id, o.id, 'push_order',
          jsonb_build_object(
            'status', o.status,
            'reason', p_reason,
            'include_items', (p_reason = 'items_updated')
          ),
          'push:' || o.id || ':' || coalesce(o.status, '')
          || ':' || to_char(now(), 'YYYYMMDDHH24MI'))
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_order_push(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_order_push(uuid, text) TO authenticated, service_role;