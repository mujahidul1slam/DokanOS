-- Measurement groups: named sets of fields (e.g., "Pant Measurements")
CREATE TABLE public.measurement_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  display_format text NOT NULL DEFAULT 'label_value', -- 'label_value' | 'dash_separated'
  unit text NOT NULL DEFAULT 'in',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.measurement_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.measurement_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_measurement_fields_group ON public.measurement_fields(group_id);

-- Assignments: a group can be attached to a product OR a category (one of the two must be set)
CREATE TABLE public.measurement_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.measurement_groups(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT measurement_assignment_target CHECK (
    (product_id IS NOT NULL AND category_id IS NULL) OR
    (product_id IS NULL AND category_id IS NOT NULL)
  )
);
CREATE INDEX idx_measurement_assignments_group ON public.measurement_assignments(group_id);
CREATE INDEX idx_measurement_assignments_product ON public.measurement_assignments(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_measurement_assignments_category ON public.measurement_assignments(category_id) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX uq_assignment_product_group ON public.measurement_assignments(product_id, group_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX uq_assignment_category_group ON public.measurement_assignments(category_id, group_id) WHERE category_id IS NOT NULL;

-- Captured measurements per order item (POS or Woo)
CREATE TABLE public.order_item_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  display_format text NOT NULL DEFAULT 'label_value',
  unit text NOT NULL DEFAULT 'in',
  values jsonb NOT NULL DEFAULT '{}'::jsonb, -- ordered: [{name, value}] preferred, or {name: value}
  source text NOT NULL DEFAULT 'pos', -- 'pos' | 'woo'
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_measurements_order ON public.order_item_measurements(order_id);
CREATE INDEX idx_order_measurements_item ON public.order_item_measurements(order_item_id);

-- Add slip template + global toggle to invoice_settings
ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS measurement_slip_template jsonb NOT NULL DEFAULT '{
    "title": "MEASUREMENT SLIP",
    "show_order_number": true,
    "show_order_date": true,
    "show_customer_name": true,
    "show_customer_phone": true,
    "show_product_name": true,
    "show_product_sku": false,
    "show_notes": true,
    "footer_text": "",
    "default_format": "label_value",
    "print_format": "thermal"
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS pos_custom_measurements_enabled boolean NOT NULL DEFAULT true;

-- updated_at triggers
CREATE TRIGGER set_measurement_groups_updated_at
  BEFORE UPDATE ON public.measurement_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.measurement_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_measurements ENABLE ROW LEVEL SECURITY;

-- Policies (read for all authenticated, write for staff/admin)
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['measurement_groups','measurement_fields','measurement_assignments','order_item_measurements']) LOOP
    EXECUTE format('CREATE POLICY "Authenticated can read %1$s" ON public.%1$s FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "Staff and admin can insert %1$s" ON public.%1$s FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''staff''::app_role))', t);
    EXECUTE format('CREATE POLICY "Staff and admin can update %1$s" ON public.%1$s FOR UPDATE TO authenticated USING (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''staff''::app_role))', t);
    EXECUTE format('CREATE POLICY "Staff and admin can delete %1$s" ON public.%1$s FOR DELETE TO authenticated USING (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''staff''::app_role))', t);
  END LOOP;
END $$;