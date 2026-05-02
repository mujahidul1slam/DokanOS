ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS parent_order_id uuid NULL,
  ADD COLUMN IF NOT EXISTS is_exchange boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_parent_order_id ON public.orders(parent_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_is_exchange ON public.orders(is_exchange) WHERE is_exchange = true;