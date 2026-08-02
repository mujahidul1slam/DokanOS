-- When order status changes, auto-call woo-push Edge Function
CREATE OR REPLACE FUNCTION public.auto_push_order_to_woo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when status actually changed and order is linked to WooCommerce
  IF NEW.woo_order_id IS NOT NULL 
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM net.http_post(
      url := 'https://kjmvbqlemdfddjrjtiik.supabase.co/functions/v1/woo-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqbXZicWxlbWRmZGRqcmp0aWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MzgxNjksImV4cCI6MjA5MTExNDE2OX0.7r2znKjCxnoJrHMxWFuK2PqJ6GO6LeF8MvFOI1Qhg7Y'
      ),
      body := jsonb_build_object('action', 'push_order', 'order_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_push_order_status ON public.orders;

CREATE TRIGGER trg_auto_push_order_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_push_order_to_woo();
