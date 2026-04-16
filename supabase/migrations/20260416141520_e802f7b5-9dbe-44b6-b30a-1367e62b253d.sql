ALTER TABLE public.pathao_integrations 
ADD COLUMN allowed_store_ids jsonb NOT NULL DEFAULT '[]'::jsonb;