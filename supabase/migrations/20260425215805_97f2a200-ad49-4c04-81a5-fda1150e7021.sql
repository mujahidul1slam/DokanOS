-- Add prefix/suffix columns on stores for POS order numbering
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS pos_order_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pos_order_suffix text NOT NULL DEFAULT '';

-- Global default prefix/suffix (used when order has no store) on invoice_settings
ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS pos_order_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pos_order_suffix text NOT NULL DEFAULT '';

-- Sequence for POS / manual order numbering, starts at 3000
CREATE SEQUENCE IF NOT EXISTS public.pos_order_number_seq START WITH 3000 INCREMENT BY 1 MINVALUE 3000;

-- Function that returns prefix + 4-digit (or longer) number + suffix for a store
CREATE OR REPLACE FUNCTION public.generate_pos_order_number(p_store_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
  v_prefix text := '';
  v_suffix text := '';
  v_num text;
BEGIN
  v_seq := nextval('public.pos_order_number_seq');

  IF p_store_id IS NOT NULL THEN
    SELECT COALESCE(pos_order_prefix, ''), COALESCE(pos_order_suffix, '')
      INTO v_prefix, v_suffix
    FROM public.stores WHERE id = p_store_id;
  END IF;

  IF (v_prefix IS NULL OR v_prefix = '') AND (v_suffix IS NULL OR v_suffix = '') THEN
    SELECT COALESCE(pos_order_prefix, ''), COALESCE(pos_order_suffix, '')
      INTO v_prefix, v_suffix
    FROM public.invoice_settings LIMIT 1;
  END IF;

  v_prefix := COALESCE(v_prefix, '');
  v_suffix := COALESCE(v_suffix, '');

  -- Pad to 4 digits minimum; will grow naturally beyond 9999
  v_num := lpad(v_seq::text, 4, '0');

  RETURN v_prefix || v_num || v_suffix;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_pos_order_number(uuid) TO authenticated;