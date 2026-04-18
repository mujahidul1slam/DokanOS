DO $$
DECLARE
  rec RECORD;
  keeper uuid;
BEGIN
  FOR rec IN
    SELECT public.normalize_bd_phone(phone) AS np, array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM public.customers
    WHERE public.normalize_bd_phone(phone) IS NOT NULL
    GROUP BY public.normalize_bd_phone(phone)
    HAVING COUNT(*) > 1
  LOOP
    keeper := rec.ids[1];

    -- Re-point orders to keeper
    UPDATE public.orders
      SET customer_id = keeper
      WHERE customer_id = ANY(rec.ids) AND customer_id <> keeper;

    -- Pre-delete aliases on the to-be-merged sources that already exist on the keeper (to avoid unique-index violation)
    DELETE FROM public.customer_aliases src
      USING public.customer_aliases dst
      WHERE src.customer_id = ANY(rec.ids)
        AND src.customer_id <> keeper
        AND dst.customer_id = keeper
        AND dst.type = src.type
        AND lower(dst.value) = lower(src.value);

    -- Now safely re-point remaining aliases
    UPDATE public.customer_aliases
      SET customer_id = keeper
      WHERE customer_id = ANY(rec.ids) AND customer_id <> keeper;

    -- Delete duplicate customer rows
    DELETE FROM public.customers
      WHERE id = ANY(rec.ids) AND id <> keeper;
  END LOOP;

  -- Normalize phone values
  UPDATE public.customers
    SET phone = public.normalize_bd_phone(phone)
    WHERE phone IS NOT NULL AND phone <> public.normalize_bd_phone(phone);

  UPDATE public.orders
    SET customer_phone = public.normalize_bd_phone(customer_phone)
    WHERE customer_phone IS NOT NULL AND customer_phone <> public.normalize_bd_phone(customer_phone);

  -- Final alias dedupe pass
  DELETE FROM public.customer_aliases a
    USING public.customer_aliases b
    WHERE a.id > b.id
      AND a.customer_id = b.customer_id
      AND a.type = b.type
      AND lower(a.value) = lower(b.value);
END $$;