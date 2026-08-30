-- Product stock pushes through the durable queue (Issue 4).
--
-- WHY TRIGGERS: every current stock push is a fire-and-forget invoke from the
-- UI (POS sale, POS return, order return, bulk stock-status change) — any
-- single failure permanently drifts the store, and POS returns did not push
-- at all. Routing through sync_queue gives every stock change retry, backoff,
-- dead-letter, and circuit-breaker isolation for free.
--
-- ECHO GUARD: exactly like the order trigger, woo_updated_at is the
-- discriminator. Woo imports (woo-sync / woo-webhook / their variation
-- upserts) stamp it; local stock writes never do. So the 15-min product sync
-- cannot echo-push stock back to Woo.
--
-- VARIATION TRIGGER: a variation stock write enqueues the PARENT product's
-- push (pushStock pushes parent + all variations), keyed on the parent so
-- concurrent variation edits coalesce.

CREATE OR REPLACE FUNCTION public.auto_push_product_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product record;
  v_key text;
BEGIN
  SELECT id, store_id, woo_product_id INTO v_product
  FROM public.products WHERE id = NEW.id;
  IF NOT FOUND OR v_product.store_id IS NULL OR v_product.woo_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Echo guard: Woo-originated write, do not push back.
  IF NEW.woo_updated_at IS DISTINCT FROM OLD.woo_updated_at THEN
    RETURN NEW;
  END IF;

  -- Enqueue when stock-relevant fields changed.
  IF NOT (
       OLD.stock_quantity IS DISTINCT FROM NEW.stock_quantity
    OR OLD.stock_status   IS DISTINCT FROM NEW.stock_status
    OR OLD.manage_stock  IS DISTINCT FROM NEW.manage_stock
  ) THEN
    RETURN NEW;
  END IF;

  v_key := 'stock:' || NEW.id || ':' || to_char(now(), 'YYYYMMDDHH24MI');

  INSERT INTO public.sync_queue (store_id, action, payload, idempotency_key)
  VALUES (v_product.store_id, 'push_stock',
          jsonb_build_object('product_id', NEW.id, 'source', 'trigger'),
          v_key)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_push_product_stock ON public.products;

CREATE TRIGGER trg_auto_push_product_stock
  AFTER UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_push_product_stock();

-- Variation stock writes -> enqueue the parent product's stock push.
CREATE OR REPLACE FUNCTION public.auto_push_variation_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent record;
  v_key text;
BEGIN
  SELECT id, store_id, woo_product_id INTO v_parent
  FROM public.products WHERE id = NEW.product_id;
  IF NOT FOUND OR v_parent.store_id IS NULL OR v_parent.woo_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Echo guard: variation upserts from Woo stamp woo_updated_at.
  IF NEW.woo_updated_at IS DISTINCT FROM OLD.woo_updated_at THEN
    RETURN NEW;
  END IF;

  IF NOT (
       OLD.stock_quantity IS DISTINCT FROM NEW.stock_quantity
    OR OLD.stock_status   IS DISTINCT FROM NEW.stock_status
    OR OLD.manage_stock  IS DISTINCT FROM NEW.manage_stock
  ) THEN
    RETURN NEW;
  END IF;

  -- Key on the PARENT so concurrent variation edits coalesce into one push
  -- (pushStock covers every variation of the product anyway).
  v_key := 'stock:' || v_parent.id || ':' || to_char(now(), 'YYYYMMDDHH24MI');

  INSERT INTO public.sync_queue (store_id, action, payload, idempotency_key)
  VALUES (v_parent.store_id, 'push_stock',
          jsonb_build_object('product_id', v_parent.id, 'source', 'variation_trigger'),
          v_key)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_push_variation_stock ON public.product_variations;

CREATE TRIGGER trg_auto_push_variation_stock
  AFTER UPDATE ON public.product_variations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_push_variation_stock();

-- ---------------------------------------------------------------------------
-- Queue retention (audit + performance):
--   completed rows older than 7 days and dead_letter older than 30 days are
--   deleted by the sync-worker sweep. Without retention the claim query
--   scans an ever-growing dead mass and the idempotency index bloats — this
--   is also what made old per-status keys block re-pushes forever.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sync_queue_status_updated
  ON public.sync_queue (status, updated_at);

-- ---------------------------------------------------------------------------
-- Atomic orphan recovery for sync-worker. A worker flips rows to
-- "processing" before attempting them; if it dies mid-batch those rows are
-- stranded forever. This RPC resets every stale processing row in ONE
-- statement with per-row attempts (a client-side bulk .update() would
-- apply one row's attempt count to the whole chunk — wrong).
-- Retryable rows go back to "failed" with attempts+1 so a row that reliably
-- kills the worker still dead-letters after MAX_ATTEMPTS.
CREATE OR REPLACE FUNCTION public.recover_orphaned_sync_rows(
  p_stale_before timestamptz
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.sync_queue
  SET status = 'failed',
      attempts = attempts + 1,
      next_retry_at = now(),
      error_log = 'orphaned in ''processing'' by a worker run that never finished',
      updated_at = now()
  WHERE status = 'processing'
    AND updated_at < p_stale_before;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_orphaned_sync_rows(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_orphaned_sync_rows(timestamptz)
  TO service_role;