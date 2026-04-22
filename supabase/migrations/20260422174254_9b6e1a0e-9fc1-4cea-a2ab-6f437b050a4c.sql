
-- Size preset measurements: defines standard values for size labels (S, M, L, XL...)
-- scoped to a measurement group. Optional product_id allows per-product overrides
-- of the same group + size combo.
CREATE TABLE public.measurement_size_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.measurement_groups(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  size_label TEXT NOT NULL,
  -- values: [{ name: "Chest", value: "40" }, ...] matching the group's fields
  values JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique per (group, product, size_label). NULL product_id = group default.
CREATE UNIQUE INDEX measurement_size_presets_group_product_size_uidx
  ON public.measurement_size_presets (group_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(size_label));

CREATE INDEX measurement_size_presets_group_idx ON public.measurement_size_presets(group_id);
CREATE INDEX measurement_size_presets_product_idx ON public.measurement_size_presets(product_id);

ALTER TABLE public.measurement_size_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read measurement_size_presets"
  ON public.measurement_size_presets FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff and admin can insert measurement_size_presets"
  ON public.measurement_size_presets FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can update measurement_size_presets"
  ON public.measurement_size_presets FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE POLICY "Staff and admin can delete measurement_size_presets"
  ON public.measurement_size_presets FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER update_measurement_size_presets_updated_at
  BEFORE UPDATE ON public.measurement_size_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
