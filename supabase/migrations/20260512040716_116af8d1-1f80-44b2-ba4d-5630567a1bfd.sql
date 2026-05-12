ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pickup_slip_printed_at timestamptz,
  ADD COLUMN IF NOT EXISTS measurement_slip_printed_at timestamptz;