-- Phase 3: route status changes THROUGH the durable queue instead of firing a
-- direct, un-retried net.http_post to woo-push.
--
-- Each status change enqueues a sync_queue row keyed by
--   idempotency_key = order_id || ':' || new_status
-- The unique partial index (idx_sync_queue_idempotency) guarantees the exact
-- same status push can never enter the queue twice, killing duplicate loads.
-- The worker claims, retries with backoff, and dead-letters after MAX_ATTEMPTS.
--
-- Edge Function invoke uses the service-role key so the worker can flush the
-- queue on its 5-minute cron; the breaker (Phase 4) keeps offline stores quiet.

CREATE OR REPLACE FUNCTION public.auto_push_order_to_woo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  -- Only fire when status actually changed and order is linked to WooCommerce.
  IF NEW.woo_order_id IS NOT NULL
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.store_id IS NOT NULL THEN

    v_key := NEW.id || ':' || NEW.status;

    INSERT INTO public.sync_queue (store_id, order_id, action, payload, idempotency_key)
    VALUES (NEW.store_id, NEW.id, 'push_order', jsonb_build_object('status', NEW.status), v_key)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_push_order_status ON public.orders;

CREATE TRIGGER trg_auto_push_order_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_push_order_to_woo();
