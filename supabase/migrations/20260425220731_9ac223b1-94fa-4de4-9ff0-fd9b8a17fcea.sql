
-- Add manual prefix/suffix to invoice_settings (POS already there)
ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS manual_order_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manual_order_suffix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS woo_order_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS woo_order_suffix text NOT NULL DEFAULT '';

-- Per-store overrides for manual + woo number wrapping
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS manual_order_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manual_order_suffix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS woo_order_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS woo_order_suffix text NOT NULL DEFAULT '';

-- Generic order-number formatter. p_source ∈ ('pos','manual','woo')
CREATE OR REPLACE FUNCTION public.format_order_number(
  p_store_id uuid,
  p_source text,
  p_base text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text := '';
  v_suffix text := '';
  v_store_prefix text := '';
  v_store_suffix text := '';
BEGIN
  IF p_store_id IS NOT NULL THEN
    IF p_source = 'pos' THEN
      SELECT COALESCE(pos_order_prefix,''), COALESCE(pos_order_suffix,'')
        INTO v_store_prefix, v_store_suffix FROM stores WHERE id = p_store_id;
    ELSIF p_source = 'manual' THEN
      SELECT COALESCE(manual_order_prefix,''), COALESCE(manual_order_suffix,'')
        INTO v_store_prefix, v_store_suffix FROM stores WHERE id = p_store_id;
    ELSIF p_source = 'woo' OR p_source = 'online' THEN
      SELECT COALESCE(woo_order_prefix,''), COALESCE(woo_order_suffix,'')
        INTO v_store_prefix, v_store_suffix FROM stores WHERE id = p_store_id;
    END IF;
  END IF;

  v_prefix := v_store_prefix;
  v_suffix := v_store_suffix;

  IF (v_prefix = '' AND v_suffix = '') THEN
    IF p_source = 'pos' THEN
      SELECT COALESCE(pos_order_prefix,''), COALESCE(pos_order_suffix,'')
        INTO v_prefix, v_suffix FROM invoice_settings LIMIT 1;
    ELSIF p_source = 'manual' THEN
      SELECT COALESCE(manual_order_prefix,''), COALESCE(manual_order_suffix,'')
        INTO v_prefix, v_suffix FROM invoice_settings LIMIT 1;
    ELSIF p_source = 'woo' OR p_source = 'online' THEN
      SELECT COALESCE(woo_order_prefix,''), COALESCE(woo_order_suffix,'')
        INTO v_prefix, v_suffix FROM invoice_settings LIMIT 1;
    END IF;
  END IF;

  RETURN COALESCE(v_prefix,'') || COALESCE(p_base,'') || COALESCE(v_suffix,'');
END;
$$;

-- Update sequence-based generator to support source param. Keep backward compat default.
CREATE OR REPLACE FUNCTION public.generate_pos_order_number(
  p_store_id uuid DEFAULT NULL,
  p_source text DEFAULT 'pos'
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
  v_num text;
BEGIN
  v_seq := nextval('public.pos_order_number_seq');
  v_num := lpad(v_seq::text, 4, '0');
  RETURN public.format_order_number(p_store_id, p_source, v_num);
END;
$$;
