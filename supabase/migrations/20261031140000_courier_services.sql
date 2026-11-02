-- Task 9 (domain revamp, spec §4): business-level courier services.
--
-- One courier account per business (Pathao, Steadfast, RedX, eCourier…),
-- enabled at fulfillment time — no per-brand duplication. This is the expand
-- phase: the legacy courier rows (`pathao_integrations`, `courier_integrations`,
-- courier `connectors`) keep working; their ids land in legacy_* audit columns
-- when the mapping seeds this table (scripts/migrate-enveil-vincent.sql),
-- and the contract phase (Task 16) drops them.
--
-- `credentials` is provider-specific (for Pathao: client_id/client_secret/
-- username/password/environment/allowed_store_ids). Credentials are write-only
-- in the UI and are never echoed back in plaintext.

-- The provider registry: ensure the spec's named providers exist. The legacy
-- stack only ever seeded Pathao.
INSERT INTO public.courier_providers (code, name, is_active)
VALUES ('steadfast', 'Steadfast', true),
       ('redx', 'RedX', true),
       ('ecourier', 'eCourier', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.courier_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  provider text NOT NULL REFERENCES public.courier_providers (code),
  name text NOT NULL,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  legacy_pathao_integration_id uuid UNIQUE,
  legacy_courier_integration_id uuid UNIQUE,
  legacy_connector_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courier_services_business_name_key UNIQUE (business_id, name)
);

CREATE TRIGGER set_courier_services_updated_at
  BEFORE UPDATE ON public.courier_services
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

ALTER TABLE public.courier_services ENABLE ROW LEVEL SECURITY;

-- New local/cloud projects do not grant Data API table privileges implicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_services TO authenticated, service_role;
-- The provider registry backs the service picker.
GRANT SELECT ON public.courier_providers TO authenticated, service_role;

-- RLS is business-level (unlike brand children): any account member reads;
-- owner/admin/member write; viewers read-only; other businesses see nothing.
CREATE POLICY "Account members can read courier services"
  ON public.courier_services FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.business_id = courier_services.business_id
        AND membership.user_id = auth.uid()
    )
  );

CREATE POLICY "Account operators can write courier services"
  ON public.courier_services FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.business_id = courier_services.business_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.business_id = courier_services.business_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'member')
    )
  );
