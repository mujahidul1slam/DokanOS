
-- 1. Add per-store customer-sync flag
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS customers_synced_at timestamptz;

-- 2. Customer aliases history table (multi name/email/address per phone)
CREATE TABLE IF NOT EXISTS public.customer_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('name','email','address')),
  value text NOT NULL,
  source_store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_alias_value
  ON public.customer_aliases (customer_id, type, lower(value));
CREATE INDEX IF NOT EXISTS idx_customer_alias_customer ON public.customer_aliases(customer_id);

ALTER TABLE public.customer_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read customer_aliases"
  ON public.customer_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff and admin can insert customer_aliases"
  ON public.customer_aliases FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'staff'::app_role));
CREATE POLICY "Staff and admin can update customer_aliases"
  ON public.customer_aliases FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'staff'::app_role));
CREATE POLICY "Staff and admin can delete customer_aliases"
  ON public.customer_aliases FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'staff'::app_role));

-- 3. One-time merge: same phone across all stores = one customer
DO $$
DECLARE
  rec RECORD;
  keeper_id uuid;
  dup_id uuid;
BEGIN
  FOR rec IN
    SELECT phone
    FROM public.customers
    WHERE phone IS NOT NULL AND phone <> ''
    GROUP BY phone
    HAVING COUNT(*) > 1
  LOOP
    -- Pick the oldest as keeper
    SELECT id INTO keeper_id
    FROM public.customers
    WHERE phone = rec.phone
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    -- Capture aliases from EVERY duplicate (including keeper) before deletion
    FOR dup_id IN
      SELECT id FROM public.customers WHERE phone = rec.phone
    LOOP
      INSERT INTO public.customer_aliases (customer_id, type, value, source_store_id)
      SELECT keeper_id, 'name', c.name, c.store_id
      FROM public.customers c WHERE c.id = dup_id AND c.name IS NOT NULL AND c.name <> ''
      ON CONFLICT DO NOTHING;

      INSERT INTO public.customer_aliases (customer_id, type, value, source_store_id)
      SELECT keeper_id, 'email', c.email, c.store_id
      FROM public.customers c WHERE c.id = dup_id AND c.email IS NOT NULL AND c.email <> ''
      ON CONFLICT DO NOTHING;

      INSERT INTO public.customer_aliases (customer_id, type, value, source_store_id)
      SELECT keeper_id, 'address',
        COALESCE(c.address,'') ||
        CASE WHEN c.city IS NOT NULL AND c.city <> '' THEN ', ' || c.city ELSE '' END,
        c.store_id
      FROM public.customers c
      WHERE c.id = dup_id
        AND ((c.address IS NOT NULL AND c.address <> '') OR (c.city IS NOT NULL AND c.city <> ''))
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- Re-point orders to the keeper
    UPDATE public.orders SET customer_id = keeper_id
    WHERE customer_id IN (SELECT id FROM public.customers WHERE phone = rec.phone AND id <> keeper_id);

    -- Delete duplicates
    DELETE FROM public.customers WHERE phone = rec.phone AND id <> keeper_id;
  END LOOP;
END $$;

-- 4. Seed aliases for surviving (non-merged) rows so every customer has its current info captured
INSERT INTO public.customer_aliases (customer_id, type, value, source_store_id)
SELECT c.id, 'name', c.name, c.store_id
FROM public.customers c
WHERE c.name IS NOT NULL AND c.name <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.customer_aliases (customer_id, type, value, source_store_id)
SELECT c.id, 'email', c.email, c.store_id
FROM public.customers c
WHERE c.email IS NOT NULL AND c.email <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.customer_aliases (customer_id, type, value, source_store_id)
SELECT c.id, 'address',
  COALESCE(c.address,'') ||
  CASE WHEN c.city IS NOT NULL AND c.city <> '' THEN ', ' || c.city ELSE '' END,
  c.store_id
FROM public.customers c
WHERE (c.address IS NOT NULL AND c.address <> '') OR (c.city IS NOT NULL AND c.city <> '')
ON CONFLICT DO NOTHING;

-- 5. Replace per-store phone uniqueness with global phone uniqueness
DROP INDEX IF EXISTS public.uq_customers_phone_per_store;
CREATE UNIQUE INDEX uq_customers_phone_global
  ON public.customers (phone)
  WHERE phone IS NOT NULL AND phone <> '';
