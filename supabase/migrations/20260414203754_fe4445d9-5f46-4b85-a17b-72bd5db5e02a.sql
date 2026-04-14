
-- Held/Parked carts
CREATE TABLE public.held_carts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  cart_data JSONB NOT NULL DEFAULT '{}',
  customer_name TEXT,
  customer_phone TEXT,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  held_by UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.held_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage held_carts"
  ON public.held_carts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- POS Returns / Refunds
CREATE TABLE public.pos_returns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  return_number TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  reason TEXT,
  refund_amount NUMERIC NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'cash',
  restock BOOLEAN NOT NULL DEFAULT true,
  processed_by UUID,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage pos_returns"
  ON public.pos_returns FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- POS Shifts
CREATE TABLE public.pos_shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  user_email TEXT,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  opening_float NUMERIC NOT NULL DEFAULT 0,
  closing_balance NUMERIC,
  expected_balance NUMERIC,
  total_sales NUMERIC NOT NULL DEFAULT 0,
  total_returns NUMERIC NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  cash_sales NUMERIC NOT NULL DEFAULT 0,
  card_sales NUMERIC NOT NULL DEFAULT 0,
  bkash_sales NUMERIC NOT NULL DEFAULT 0,
  bank_sales NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  closed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.pos_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage pos_shifts"
  ON public.pos_shifts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Add tax_amount to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;

-- Add per-item discount to order_items
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS discount NUMERIC DEFAULT 0;

-- Add salesperson & store to orders for POS tracking
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS salesperson_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS salesperson_name TEXT;
