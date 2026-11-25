-- Issue 48: WooCommerce connector identity, tenancy, lifecycle, and secret rotation.
-- The canonical channel binding is order_sources (selling_points was removed by the
-- domain contract migration). Secrets remain deployment-managed references.

ALTER TABLE public.woocommerce_connectors
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz,
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS secret_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS secret_rotation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_reason text,
  ADD COLUMN IF NOT EXISTS last_lifecycle_actor uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.woocommerce_connectors
  DROP CONSTRAINT IF EXISTS woocommerce_connectors_store_url_key;

-- Disabled/rolled-back rows are historical identities and may be reconnected;
-- every other lifecycle state retains the one active connector per canonical shop.
CREATE UNIQUE INDEX IF NOT EXISTS woocommerce_connectors_active_identity_key
  ON public.woocommerce_connectors (external_store_key)
  WHERE status NOT IN ('disabled', 'rolled_back');

CREATE OR REPLACE FUNCTION public.normalize_woocommerce_connector_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE parsed_url text;
BEGIN
  NEW.external_store_url := lower(regexp_replace(btrim(NEW.external_store_url), '/+$', ''));
  NEW.external_store_key := NEW.external_store_url;

  IF NEW.external_store_url !~ '^https://[^/[:space:]?#]+(/[^?#]*)?$'
     AND NEW.external_store_url !~ '^http://localhost([:/][^?#]*)?$'
     AND NEW.external_store_url !~ '^http://127\\.0\\.0\\.1([:/][^?#]*)?$' THEN
    RAISE EXCEPTION 'WooCommerce external store identity must be HTTPS (localhost is allowed for development)';
  END IF;
  IF NEW.external_store_url ~ '[?#]' OR NEW.external_store_url ~ '^https?://[^/]+@' THEN
    RAISE EXCEPTION 'WooCommerce external store identity cannot contain query, fragment, or credentials';
  END IF;
  IF NEW.credentials_ref !~ '^[A-Z][A-Z0-9_]{2,127}$'
     OR NEW.webhook_secret_ref !~ '^[A-Z][A-Z0-9_]{2,127}$' THEN
    RAISE EXCEPTION 'WooCommerce connector secrets must be managed secret references';
  END IF;
  IF NEW.webhook_secret_fingerprint IS NOT NULL
     AND NEW.webhook_secret_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'WooCommerce webhook secret fingerprint must be SHA-256 hex';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_woocommerce_connector_identity ON public.woocommerce_connectors;
CREATE TRIGGER normalize_woocommerce_connector_identity
  BEFORE INSERT OR UPDATE OF external_store_url, external_store_key, credentials_ref,
    webhook_secret_ref, webhook_secret_fingerprint
  ON public.woocommerce_connectors
  FOR EACH ROW EXECUTE FUNCTION public.normalize_woocommerce_connector_identity();

-- Keep the binding server-resolved on every write. order_sources is the canonical
-- replacement for the retired selling_points model.
CREATE OR REPLACE FUNCTION public.validate_woocommerce_connector_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE resolved_business uuid; bound_store uuid; source_brand uuid; source_type text;
BEGIN
  SELECT b.business_id, b.woo_store_id INTO resolved_business, bound_store
    FROM public.brands b WHERE b.id = NEW.brand_id AND b.is_active;
  SELECT os.brand_id, os.type::text INTO source_brand, source_type
    FROM public.order_sources os WHERE os.id = NEW.order_source_id;
  IF resolved_business IS NULL OR resolved_business <> NEW.business_id THEN
    RAISE EXCEPTION 'WooCommerce connector brand/business scope is invalid';
  END IF;
  IF bound_store IS NULL OR bound_store <> NEW.store_id THEN
    RAISE EXCEPTION 'WooCommerce connector store is not bound to the brand';
  END IF;
  IF source_brand IS NULL OR source_brand <> NEW.brand_id OR source_type <> 'woocommerce' THEN
    RAISE EXCEPTION 'WooCommerce connector requires the brand WooCommerce order source';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_woocommerce_connector_scope ON public.woocommerce_connectors;
CREATE TRIGGER validate_woocommerce_connector_scope
  BEFORE INSERT OR UPDATE OF business_id, brand_id, store_id, order_source_id
  ON public.woocommerce_connectors FOR EACH ROW
  EXECUTE FUNCTION public.validate_woocommerce_connector_scope();

-- Secret rotation is an auditable two-secret grace window. The old reference is
-- retained only until expiry so in-flight webhook deliveries can finish.
CREATE OR REPLACE FUNCTION public.rotate_woocommerce_webhook_secret(
  p_connector_id uuid,
  p_new_secret_ref text,
  p_new_fingerprint text,
  p_grace_seconds integer DEFAULT 3600
)
RETURNS public.woocommerce_connectors
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.woocommerce_connectors; actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_business_access a
    WHERE a.business_id = (SELECT c.business_id FROM public.woocommerce_connectors c WHERE c.id = p_connector_id)
      AND a.user_id = actor AND a.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'owner or admin authorization required';
  END IF;
  IF p_new_secret_ref !~ '^[A-Z][A-Z0-9_]{2,127}$' OR p_new_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid managed webhook secret rotation';
  END IF;
  IF p_grace_seconds < 0 OR p_grace_seconds > 86400 THEN
    RAISE EXCEPTION 'webhook secret grace window is out of range';
  END IF;
  UPDATE public.woocommerce_connectors
  SET previous_webhook_secret_ref = webhook_secret_ref,
      previous_secret_expires_at = CASE WHEN p_grace_seconds = 0 THEN now() ELSE now() + make_interval(secs => p_grace_seconds) END,
      webhook_secret_ref = p_new_secret_ref,
      webhook_secret_fingerprint = p_new_fingerprint,
      secret_rotated_at = now(),
      secret_rotation_expires_at = CASE WHEN p_grace_seconds = 0 THEN now() ELSE now() + make_interval(secs => p_grace_seconds) END,
      last_lifecycle_actor = actor,
      updated_at = now()
  WHERE id = p_connector_id
  RETURNING * INTO row;
  IF row.id IS NULL THEN RAISE EXCEPTION 'connector not found'; END IF;
  RETURN row;
END;
$$;
REVOKE ALL ON FUNCTION public.rotate_woocommerce_webhook_secret(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_woocommerce_webhook_secret(uuid, text, text, integer) TO authenticated;

-- Only owner/admin may mutate connector identity and lifecycle. Members retain
-- read access through the existing policy.
DROP POLICY IF EXISTS "Woo connector operators can write" ON public.woocommerce_connectors;
CREATE POLICY "Woo connector owner admin can write"
  ON public.woocommerce_connectors FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_business_access a
    WHERE a.business_id = woocommerce_connectors.business_id
      AND a.user_id = auth.uid() AND a.role IN ('owner', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_business_access a
    WHERE a.business_id = woocommerce_connectors.business_id
      AND a.user_id = auth.uid() AND a.role IN ('owner', 'admin')
  ));

COMMENT ON COLUMN public.woocommerce_connectors.order_source_id IS 'Canonical WooCommerce order source; selling_points is retired.';
COMMENT ON INDEX public.woocommerce_connectors_active_identity_key IS 'Allows lifecycle-safe reconnect after disable/rollback while preventing active duplicate shops.';

-- Management RPCs are the only write path used by the owner/admin edge function.
-- They resolve authorization from auth.uid() and keep lifecycle transitions atomic;
-- callers cannot smuggle a tenant id or bypass the canonical order_source binding.
CREATE OR REPLACE FUNCTION public.create_woocommerce_connector(
  p_business_id uuid,
  p_brand_id uuid,
  p_store_id uuid,
  p_order_source_id uuid,
  p_external_store_url text,
  p_credentials_ref text,
  p_webhook_secret_ref text,
  p_webhook_secret_fingerprint text,
  p_expected_webhook_id bigint DEFAULT NULL,
  p_expected_webhook_topic text DEFAULT 'order.updated'
)
RETURNS public.woocommerce_connectors
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid(); created public.woocommerce_connectors;
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_business_access a
    WHERE a.business_id = p_business_id AND a.user_id = actor AND a.role IN ('owner', 'admin')
  ) THEN RAISE EXCEPTION 'owner or admin authorization required'; END IF;
  IF p_expected_webhook_topic NOT IN ('order.created', 'order.updated', 'order.deleted') THEN
    RAISE EXCEPTION 'unsupported webhook topic';
  END IF;
  INSERT INTO public.woocommerce_connectors (
    business_id, brand_id, store_id, order_source_id, external_store_url,
    external_store_key, credentials_ref, webhook_secret_ref,
    webhook_secret_fingerprint, expected_webhook_id, expected_webhook_topic,
    status, intake_enabled, outbound_enabled
  ) VALUES (
    p_business_id, p_brand_id, p_store_id, p_order_source_id, p_external_store_url,
    lower(trim(trailing '/' from btrim(p_external_store_url))), p_credentials_ref,
    p_webhook_secret_ref, p_webhook_secret_fingerprint, p_expected_webhook_id,
    p_expected_webhook_topic, 'disabled', false, false
  ) RETURNING * INTO created;
  RETURN created;
END;
$$;
REVOKE ALL ON FUNCTION public.create_woocommerce_connector(uuid, uuid, uuid, uuid, text, text, text, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_woocommerce_connector(uuid, uuid, uuid, uuid, text, text, text, text, bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_woocommerce_connector(
  p_connector_id uuid,
  p_external_store_url text DEFAULT NULL,
  p_credentials_ref text DEFAULT NULL,
  p_expected_webhook_id bigint DEFAULT NULL,
  p_expected_webhook_topic text DEFAULT NULL
)
RETURNS public.woocommerce_connectors
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid(); updated public.woocommerce_connectors;
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_business_access a
    JOIN public.woocommerce_connectors c ON c.business_id = a.business_id
    WHERE c.id = p_connector_id AND a.user_id = actor AND a.role IN ('owner', 'admin')
  ) THEN RAISE EXCEPTION 'owner or admin authorization required'; END IF;
  IF p_expected_webhook_topic IS NOT NULL AND p_expected_webhook_topic NOT IN ('order.created', 'order.updated', 'order.deleted') THEN
    RAISE EXCEPTION 'unsupported webhook topic';
  END IF;
  UPDATE public.woocommerce_connectors
  SET external_store_url = COALESCE(p_external_store_url, external_store_url),
      external_store_key = COALESCE(p_external_store_url, external_store_url),
      credentials_ref = COALESCE(p_credentials_ref, credentials_ref),
      expected_webhook_id = COALESCE(p_expected_webhook_id, expected_webhook_id),
      expected_webhook_topic = COALESCE(p_expected_webhook_topic, expected_webhook_topic),
      last_lifecycle_actor = actor
  WHERE id = p_connector_id
  RETURNING * INTO updated;
  IF updated.id IS NULL THEN RAISE EXCEPTION 'connector not found'; END IF;
  RETURN updated;
END;
$$;
REVOKE ALL ON FUNCTION public.update_woocommerce_connector(uuid, text, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_woocommerce_connector(uuid, text, text, bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_woocommerce_connector(
  p_connector_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS public.woocommerce_connectors
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid(); current public.woocommerce_connectors; changed public.woocommerce_connectors; next_status text;
BEGIN
  SELECT c.* INTO current FROM public.woocommerce_connectors c
  WHERE c.id = p_connector_id
    AND EXISTS (SELECT 1 FROM public.user_business_access a WHERE a.business_id = c.business_id AND a.user_id = actor AND a.role IN ('owner', 'admin'))
  FOR UPDATE;
  IF current.id IS NULL THEN RAISE EXCEPTION 'connector not found or unauthorized'; END IF;
  IF p_action = 'disable' AND current.status <> 'rolled_back' THEN next_status := 'disabled';
  ELSIF p_action = 'pause' AND current.status IN ('healthy', 'degraded') THEN next_status := 'paused';
  ELSIF p_action = 'quarantine' AND current.status IN ('healthy', 'degraded', 'paused') THEN next_status := 'quarantined';
  ELSIF p_action = 'rollback' AND current.status = 'quarantined' THEN next_status := 'rolled_back';
  ELSIF p_action = 'resume' AND current.status IN ('disabled', 'paused', 'degraded') THEN next_status := 'healthy';
  ELSE RAISE EXCEPTION 'invalid connector lifecycle transition'; END IF;
  UPDATE public.woocommerce_connectors
  SET status = next_status,
      intake_enabled = next_status = 'healthy',
      outbound_enabled = next_status = 'healthy',
      disabled_at = CASE WHEN next_status = 'disabled' THEN now() ELSE disabled_at END,
      quarantined_at = CASE WHEN next_status = 'quarantined' THEN now() ELSE quarantined_at END,
      rolled_back_at = CASE WHEN next_status = 'rolled_back' THEN now() ELSE rolled_back_at END,
      lifecycle_reason = NULLIF(btrim(p_reason), ''),
      last_lifecycle_actor = actor
  WHERE id = current.id RETURNING * INTO changed;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.transition_woocommerce_connector(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_woocommerce_connector(uuid, text, text) TO authenticated;

COMMIT;
