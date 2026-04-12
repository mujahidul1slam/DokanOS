
-- Invoice template settings (singleton row pattern)
CREATE TABLE public.invoice_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL DEFAULT 'OmniSync',
  tagline text DEFAULT '',
  address text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  logo_url text DEFAULT '',
  footer_text text DEFAULT 'Thank you for shopping with us!',
  terms_text text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read invoice settings"
  ON public.invoice_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage invoice settings"
  ON public.invoice_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_invoice_settings_updated_at
  BEFORE UPDATE ON public.invoice_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed a default row
INSERT INTO public.invoice_settings (business_name) VALUES ('OmniSync');

-- Storage bucket for invoice assets (logos)
INSERT INTO storage.buckets (id, name, public) VALUES ('invoice-assets', 'invoice-assets', true);

CREATE POLICY "Public can view invoice assets"
  ON storage.objects FOR SELECT USING (bucket_id = 'invoice-assets');

CREATE POLICY "Authenticated users can upload invoice assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoice-assets');

CREATE POLICY "Authenticated users can update invoice assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'invoice-assets');

CREATE POLICY "Authenticated users can delete invoice assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'invoice-assets');
