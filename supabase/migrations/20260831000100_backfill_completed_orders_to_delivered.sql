-- Migration: Backfill legacy 'completed' order status to 'delivered'
-- In DokanOS, fulfilled/terminal orders are represented by status 'delivered'.

UPDATE public.orders
SET status = 'delivered', updated_at = now()
WHERE status = 'completed';
