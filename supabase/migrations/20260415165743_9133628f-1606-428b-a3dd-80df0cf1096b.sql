
CREATE TABLE public.order_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.order_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read order_sources" ON public.order_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff and admin can insert order_sources" ON public.order_sources FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Staff and admin can update order_sources" ON public.order_sources FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
CREATE POLICY "Admin can delete order_sources" ON public.order_sources FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.order_sources (name, is_default, sort_order) VALUES
  ('online', true, 1),
  ('pos', true, 2),
  ('phone', false, 3),
  ('social', false, 4),
  ('wholesale', false, 5);
