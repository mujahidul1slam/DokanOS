
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS fulfillment_type text NOT NULL DEFAULT 'walkin';

ALTER TABLE public.invoice_settings
ADD COLUMN IF NOT EXISTS shipping_presets jsonb NOT NULL DEFAULT '[80, 150]'::jsonb;
