CREATE OR REPLACE FUNCTION public.normalize_bd_phone(_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE p text;
BEGIN
  IF _phone IS NULL THEN RETURN NULL; END IF;
  p := regexp_replace(_phone, '[^0-9]', '', 'g');
  IF p = '' THEN RETURN NULL; END IF;
  IF p LIKE '880%' AND length(p) >= 13 THEN p := substring(p from 4); END IF;
  IF length(p) = 10 AND substring(p from 1 for 1) = '1' THEN p := '0' || p; END IF;
  RETURN p;
END;
$$;

DO $$
DECLARE
  rec RECORD;
  keeper_id uuid;
  dupe_ids uuid[];
BEGIN
  FOR rec IN
    SELECT public.normalize_bd_phone(phone) AS np, array_agg(id ORDER BY created_at ASC) AS ids
    FROM public.customers
    WHERE phone IS NOT NULL AND phone <> ''
    GROUP BY public.normalize_bd_phone(phone)
    HAVING COUNT(*) > 1
  LOOP
    keeper_id := rec.ids[1];
    dupe_ids := rec.ids[2:array_length(rec.ids,1)];

    -- Delete dupe aliases that already exist on the keeper (avoid unique violation)
    DELETE FROM public.customer_aliases ca
    WHERE ca.customer_id = ANY(dupe_ids)
      AND EXISTS (
        SELECT 1 FROM public.customer_aliases kc
        WHERE kc.customer_id = keeper_id
          AND kc.type = ca.type
          AND lower(kc.value) = lower(ca.value)
      );

    -- Move remaining aliases & orders to keeper
    UPDATE public.customer_aliases SET customer_id = keeper_id WHERE customer_id = ANY(dupe_ids);
    UPDATE public.orders SET customer_id = keeper_id WHERE customer_id = ANY(dupe_ids);

    DELETE FROM public.customers WHERE id = ANY(dupe_ids);
  END LOOP;
END $$;

UPDATE public.customers SET phone = public.normalize_bd_phone(phone)
WHERE phone IS NOT NULL AND phone <> public.normalize_bd_phone(phone);

UPDATE public.orders SET customer_phone = public.normalize_bd_phone(customer_phone)
WHERE customer_phone IS NOT NULL AND customer_phone <> public.normalize_bd_phone(customer_phone);

DELETE FROM public.customer_aliases a
USING public.customer_aliases b
WHERE a.ctid < b.ctid
  AND a.customer_id = b.customer_id
  AND a.type = b.type
  AND lower(a.value) = lower(b.value);