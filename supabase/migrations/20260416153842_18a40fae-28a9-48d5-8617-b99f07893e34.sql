
-- Function to permanently delete trashed orders older than 15 days
CREATE OR REPLACE FUNCTION public.purge_trashed_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete related data first
  DELETE FROM public.order_items WHERE order_id IN (
    SELECT id FROM public.orders WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '15 days'
  );
  DELETE FROM public.order_payments WHERE order_id IN (
    SELECT id FROM public.orders WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '15 days'
  );
  DELETE FROM public.order_timeline WHERE order_id IN (
    SELECT id FROM public.orders WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '15 days'
  );
  -- Delete the orders
  DELETE FROM public.orders WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '15 days';
END;
$$;

-- Schedule daily at 4 AM
SELECT cron.schedule(
  'purge-trashed-orders-daily',
  '0 4 * * *',
  $$SELECT public.purge_trashed_orders()$$
);
