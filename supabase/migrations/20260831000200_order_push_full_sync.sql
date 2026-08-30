-- Full-fidelity order push (Issues 1 & 2 from the sync audit).
--
-- WHAT CHANGED vs 20260830000200_auto_push_enqueue.sql:
--   1. The old trigger ONLY enqueued on status change, so customer-info /
--      discount / shipping / totals / notes edits in DokanOS never reached
--      WooCommerce. Now any tracked field change enqueues a push.
--   2. The old idempotency_key was `order_id || ':' || status` with
--      ON CONFLICT DO NOTHING — and completed rows are never deleted, so
--      once a key existed, ANY future transition to the same status was
--      silently dropped forever (e.g. delivered -> processing -> delivered
--      never re-pushed). The key now carries a minute-resolution timestamp,
--      so bursts coalesce but deliberate re-edits always re-push.
--   3. Echo guard: Woo-originated writes (woo-webhook and woo-sync) stamp
--      woo_updated_at on the order; a manual DokanOS edit never touches it.
--      If woo_updated_at changed in this UPDATE, the write came FROM Woo, so
--      do not push it back (that would echo-loop every 15-min sync).
--
-- The queue row is state-based ("push order X now") — the worker reads the
-- order fresh at push time, so multiple edits within the same minute
-- collapsing into one row loses nothing.

CREATE OR REPLACE FUNCTION public.auto_push_order_to_woo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  -- Only Woo-linked orders with a store can be pushed.
  IF NEW.woo_order_id IS NULL OR NEW.store_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Echo guard: a fresh woo_updated_at means this UPDATE came from a Woo
  -- import (webhook / woo-sync both stamp it). Never push those back.
  IF NEW.woo_updated_at IS DISTINCT FROM OLD.woo_updated_at THEN
    RETURN NEW;
  END IF;

  -- Enqueue when any field we mirror to WooCommerce actually changed.
  IF NOT (
       OLD.status            IS DISTINCT FROM NEW.status
    OR OLD.customer_name     IS DISTINCT FROM NEW.customer_name
    OR OLD.customer_phone    IS DISTINCT FROM NEW.customer_phone
    OR OLD.customer_address  IS DISTINCT FROM NEW.customer_address
    OR OLD.customer_city     IS DISTINCT FROM NEW.customer_city
    OR OLD.customer_email    IS DISTINCT FROM NEW.customer_email
    OR OLD.discount          IS DISTINCT FROM NEW.discount
    OR OLD.shipping_cost     IS DISTINCT FROM NEW.shipping_cost
    OR OLD.subtotal          IS DISTINCT FROM NEW.subtotal
    OR OLD.total             IS DISTINCT FROM NEW.total
    OR OLD.notes             IS DISTINCT FROM NEW.notes
    OR OLD.payment_status    IS DISTINCT FROM NEW.payment_status
  ) THEN
    RETURN NEW;
  END IF;

  v_key := 'push:' || NEW.id || ':' || coalesce(NEW.status, '')
           || ':' || to_char(now(), 'YYYYMMDDHH24MI');

  INSERT INTO public.sync_queue (store_id, order_id, action, payload, idempotency_key)
  VALUES (NEW.store_id, NEW.id, 'push_order',
          jsonb_build_object('status', NEW.status, 'source', 'trigger'),
          v_key)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_push_order_status ON public.orders;

CREATE TRIGGER trg_auto_push_order_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_push_order_to_woo();

-- ---------------------------------------------------------------------------
-- Deterministic enqueue for callers that change related rows (order_items)
-- rather than the order row itself. The order_items table has no push trigger
-- because woo-sync rebuilds items with DELETE+INSERT on every sync, which
-- would enqueue an echo push per synced order. UIs that edit items call this
-- explicitly instead.
-- Per-minute key coalesces rapid edits; ON CONFLICT keeps it idempotent.
-- ---------------------------------------------------------------------------
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
          jsonb_build_object('status', o.status, 'reason', p_reason),
          'push:' || o.id || ':' || coalesce(o.status, '')
          || ':' || to_char(now(), 'YYYYMMDDHH24MI'))
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_order_push(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_order_push(uuid, text) TO authenticated, service_role;