
-- Add soft-delete column
ALTER TABLE public.orders ADD COLUMN deleted_at timestamptz DEFAULT NULL;

-- Index for efficient filtering
CREATE INDEX idx_orders_deleted_at ON public.orders (deleted_at) WHERE deleted_at IS NOT NULL;
