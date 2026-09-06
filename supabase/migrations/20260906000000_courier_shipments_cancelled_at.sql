-- Revamp: Support multiple courier entries with soft-delete (cancellation)
ALTER TABLE public.courier_shipments 
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz DEFAULT NULL;

-- Index for querying shipments per order with cancelled_at filtering
CREATE INDEX IF NOT EXISTS idx_courier_shipments_order_cancelled 
  ON public.courier_shipments (order_id, cancelled_at);
