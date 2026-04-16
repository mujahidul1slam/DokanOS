
CREATE TABLE public.pathao_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL DEFAULT 'Pathao Courier',
  client_id text NOT NULL,
  client_secret text NOT NULL,
  username text NOT NULL,
  password text NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.pathao_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pathao_integrations"
  ON public.pathao_integrations FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage pathao_integrations"
  ON public.pathao_integrations FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_pathao_integrations_updated_at
  BEFORE UPDATE ON public.pathao_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
