-- Task 10 (domain revamp, spec §4): business-level payment accounts +
-- per-order-source accepted payment methods.
--
-- Payment accounts (bKash, Nagad, Stripe, card…) hold business-level
-- credentials — one account per business, never per brand. This is the expand
-- phase: there are no legacy payment integration tables to collapse (payments
-- were free text on orders), so no legacy_* mapping columns are needed here.
--
-- Each order source toggles which payment methods it accepts (spec §4:
-- "COD for the showroom, gateways for the storefront, …"). Cash / manual is
-- always available for staff-entered orders regardless of these toggles
-- (enforced in the UI); the column constrains the stored value to known codes.
--
-- `credentials` is provider-specific and write-only in the UI (never echoed
-- back in plaintext).

-- The provider registry: the spec's named providers.
CREATE TABLE public.payment_providers (
  code text PRIMARY KEY,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

INSERT INTO public.payment_providers (code, name, is_active)
VALUES ('bkash', 'bKash', true),
       ('nagad', 'Nagad', true),
       ('stripe', 'Stripe', true),
       ('card', 'Card', true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  provider text NOT NULL REFERENCES public.payment_providers (code),
  name text NOT NULL,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_accounts_business_name_key UNIQUE (business_id, name)
);

CREATE TRIGGER set_payment_accounts_updated_at
  BEFORE UPDATE ON public.payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

ALTER TABLE public.payment_accounts ENABLE ROW LEVEL SECURITY;

-- New local/cloud projects do not grant Data API table privileges implicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_accounts TO authenticated, service_role;
-- The provider registry backs the account picker.
GRANT SELECT ON public.payment_providers TO authenticated, service_role;

-- RLS is business-level (mirrors courier_services): any account member reads;
-- owner/admin/member write; viewers read-only; other businesses see nothing.
CREATE POLICY "Account members can read payment accounts"
  ON public.payment_accounts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.business_id = payment_accounts.business_id
        AND membership.user_id = auth.uid()
    )
  );

CREATE POLICY "Account operators can write payment accounts"
  ON public.payment_accounts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.business_id = payment_accounts.business_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.business_id = payment_accounts.business_id
        AND membership.user_id = auth.uid()
        AND membership.role IN ('owner', 'admin', 'member')
    )
  );

-- Per-source accepted payment methods: a set of method codes (src/lib/
-- paymentAccounts.ts keeps the matching registry). Default is the universal
-- pair every staff-entered order can use; sources toggle the rest.
ALTER TABLE public.order_sources
  ADD COLUMN IF NOT EXISTS accepted_payment_methods jsonb NOT NULL DEFAULT '["cod","cash"]'::jsonb;

ALTER TABLE public.order_sources
  ADD CONSTRAINT order_sources_accepted_methods_shape CHECK (
    jsonb_typeof(accepted_payment_methods) = 'array'
    AND accepted_payment_methods <@ '["cod","cash","bkash","nagad","stripe","card"]'::jsonb
  );
