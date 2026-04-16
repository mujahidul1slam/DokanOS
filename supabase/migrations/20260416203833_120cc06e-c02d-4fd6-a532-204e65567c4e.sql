-- Track which Pathao integration each cached store belongs to
ALTER TABLE public.pathao_stores ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES public.pathao_integrations(id) ON DELETE CASCADE;

-- Track which Pathao integration was used to dispatch each order
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS pathao_integration_id uuid REFERENCES public.pathao_integrations(id) ON DELETE SET NULL;

-- Mapping: WooCommerce store -> Pathao integration + default pathao merchant store
CREATE TABLE IF NOT EXISTS public.pathao_store_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  woo_store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  pathao_integration_id uuid NOT NULL REFERENCES public.pathao_integrations(id) ON DELETE CASCADE,
  default_pathao_store_id integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (woo_store_id)
);

ALTER TABLE public.pathao_store_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pathao_store_links"
  ON public.pathao_store_links FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage pathao_store_links"
  ON public.pathao_store_links FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_pathao_store_links_updated_at
  BEFORE UPDATE ON public.pathao_store_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_pathao_stores_integration ON public.pathao_stores(integration_id);
CREATE INDEX IF NOT EXISTS idx_pathao_store_links_integration ON public.pathao_store_links(pathao_integration_id);