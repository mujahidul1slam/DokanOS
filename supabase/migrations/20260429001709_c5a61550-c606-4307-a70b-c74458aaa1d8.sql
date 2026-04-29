ALTER TABLE public.invoice_settings
ADD COLUMN IF NOT EXISTS shipping_inside_dhaka numeric NOT NULL DEFAULT 80,
ADD COLUMN IF NOT EXISTS shipping_outside_dhaka numeric NOT NULL DEFAULT 150;