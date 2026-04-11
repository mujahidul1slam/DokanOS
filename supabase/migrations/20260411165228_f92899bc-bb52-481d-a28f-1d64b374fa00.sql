
-- Pathao location cache tables
CREATE TABLE public.pathao_cities (
  city_id integer PRIMARY KEY,
  city_name text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pathao_zones (
  zone_id integer PRIMARY KEY,
  zone_name text NOT NULL,
  city_id integer NOT NULL REFERENCES public.pathao_cities(city_id),
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pathao_areas (
  area_id integer PRIMARY KEY,
  area_name text NOT NULL,
  zone_id integer NOT NULL REFERENCES public.pathao_zones(zone_id),
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Pathao merchant stores cache
CREATE TABLE public.pathao_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pathao_store_id integer NOT NULL UNIQUE,
  store_name text NOT NULL,
  store_address text,
  city_id integer,
  zone_id integer,
  hub_id integer,
  is_active boolean DEFAULT true,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Add Pathao dispatch columns to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pathao_recipient_city integer,
  ADD COLUMN IF NOT EXISTS pathao_recipient_zone integer,
  ADD COLUMN IF NOT EXISTS pathao_recipient_area integer,
  ADD COLUMN IF NOT EXISTS delivery_type integer DEFAULT 48,
  ADD COLUMN IF NOT EXISTS item_type integer DEFAULT 2,
  ADD COLUMN IF NOT EXISTS item_weight numeric DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS item_qty integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amount_to_collect numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS special_instruction text,
  ADD COLUMN IF NOT EXISTS pathao_store_id integer;

-- RLS for all pathao tables (public access, no auth needed)
ALTER TABLE public.pathao_cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access to pathao_cities" ON public.pathao_cities FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.pathao_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access to pathao_zones" ON public.pathao_zones FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.pathao_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access to pathao_areas" ON public.pathao_areas FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.pathao_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access to pathao_stores" ON public.pathao_stores FOR ALL USING (true) WITH CHECK (true);
