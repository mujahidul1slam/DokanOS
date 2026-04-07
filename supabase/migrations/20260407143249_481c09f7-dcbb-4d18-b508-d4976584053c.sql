ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';

-- Backfill existing orders based on payment_method
UPDATE public.orders SET payment_status = 
  CASE 
    WHEN LOWER(payment_method) LIKE '%cod%' OR LOWER(payment_method) LIKE '%cash on delivery%' THEN 'cod'
    WHEN LOWER(payment_method) LIKE '%cash%' AND source = 'pos' THEN 'paid'
    WHEN status = 'completed' THEN 'paid'
    WHEN payment_method IS NOT NULL AND LOWER(payment_method) NOT LIKE '%cod%' AND LOWER(payment_method) NOT LIKE '%cash on delivery%' AND payment_method != '' THEN 'paid'
    ELSE 'unpaid'
  END;