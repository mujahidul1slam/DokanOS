
-- Order timeline / activity log
CREATE TABLE public.order_timeline (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.order_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous access to order_timeline" ON public.order_timeline FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage order_timeline" ON public.order_timeline FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_order_timeline_order_id ON public.order_timeline(order_id);

-- Order payments / manual transaction log
CREATE TABLE public.order_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  trx_id TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous access to order_payments" ON public.order_payments FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage order_payments" ON public.order_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_order_payments_order_id ON public.order_payments(order_id);
