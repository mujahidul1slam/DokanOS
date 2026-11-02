-- 20261103140000_key_model_attribution.sql
-- The key model: business_id becomes THE tenancy key for orders and customers.
--
-- Task 16 stamped only the legacy pool with business_id (the pool was the only
-- population whose business could not be derived from a binding). This
-- migration completes the key model for the two row-level tables:
--
--   §1  Backfill orders.business_id from the attribution bindings
--   §2  Backfill customers.business_id (+ repair the two cutover-window
--       manual customers that lack origin_order_source_id)
--   §3  Derivation triggers — business_id is re-derived from the bindings on
--       every INSERT and on every UPDATE that changes a binding
--   §4  RLS rewrite — the eight per-table policies collapse to five, keyed on
--       business_id tenancy instead of per-binding shapes
--   §5  Verification
--
-- Design decisions (recorded for the runbook):
--
-- * orders.source / customers.source / customers.origin_kind are NOT
--   constrained. The key model's whole point is that the tag stops being
--   load-bearing; a CHECK would make it load-bearing again. Vocabulary
--   (documented, not enforced):
--     orders.source:         online | pos | fb/ig | exchange | woocommerce | split | legacy migration
--     customers.source:      online | woo_sync | fb/ig | manual | pos | legacy migration
--     customers.origin_kind: woo_sync | manual | pos | legacy
--
-- * The derivation trigger is authoritative when the bindings resolve, and
--   falls back to the writer's active business context when they do not (a
--   POS order bound to a brand-unlinked local store has no derivable business
--   — the context fallback keeps that flow working without the client sending
--   business_id). service_role writers have no context, so an unbound
--   service_role insert stays business_id NULL = shared pool row (same
--   doctrine as Task 15; woo-sync / storefront-checkout always bind).
--
-- * Fail-closed INSERT: WITH CHECK requires business_id = the writer's active
--   context. The trigger stamps it from bindings or context first, so a
--   member can no longer create shared (NULL-business) rows.
--
-- * Foreign-binding protection: binding a row to ANOTHER business's source
--   re-derives business_id to that foreign business, which the WITH CHECK
--   (business_id = context) rejects. The per-binding multi-hop WITH CHECK
--   shapes become unnecessary — tenancy itself is the guard.
--
-- * Unbinding (clearing the bindings) keeps the stamped business_id — the row
--   stays tenanted and appears in the pool page as this business's
--   unattributed row. Only the trigger's INSERT branch can produce a NULL
--   business_id (shared row), and only for context-less (service_role)
--   writers.
--
-- * Ladder preservation under Postgres' independent-OR semantics: for UPDATE,
--   the permissive USING expressions are OR'd and the WITH CHECK expressions
--   are OR'd INDEPENDENTLY — so any staff-updateable unbound row plus any
--   policy whose WITH CHECK allows a bound result would let staff reassign.
--   The general update policy therefore restricts USING to BOUND rows
--   (business_id set AND at least one binding present); unbound rows are
--   updateable only through the ladder policy (owner/admin/manager). Staff
--   cannot edit unbound rows (e.g. POS local-store order corrections) —
--   accepted tradeoff; the reassignment ladder wins.
--
-- * Deletion is business-scoped for all rows (the old store-bound-only delete
--   was a binding-shape artifact, not a deliberate ladder).
--
-- * The legacy-pool tag ('legacy migration' / origin_kind 'legacy') survives
--   as DATA and provenance only. No policy references it after this
--   migration; the pool is structural: business_id set or shared, and every
--   attribution binding NULL.

-- ---------------------------------------------------------------------------
-- §1 — Backfill orders.business_id from the attribution bindings.
-- Source leg first (the strongest attribution), then the store leg for rows
-- the source leg cannot reach (POS orders bound only by store), then the
-- storefront leg. Production preflight verified 0 source-vs-store leg
-- disagreements and 0 stores bound to more than one brand, so each leg is
-- unambiguous.
-- ---------------------------------------------------------------------------

UPDATE public.orders o
SET business_id = br.business_id
FROM public.order_sources os
JOIN public.brands br ON br.id = os.brand_id
WHERE o.order_source_id = os.id
  AND o.business_id IS NULL;

UPDATE public.orders o
SET business_id = br.business_id
FROM public.stores s
JOIN public.brands br ON br.woo_store_id = s.id
WHERE o.store_id = s.id
  AND o.business_id IS NULL;

UPDATE public.orders o
SET business_id = br.business_id
FROM public.storefronts sf
JOIN public.stores s ON s.id = sf.store_id
JOIN public.brands br ON br.woo_store_id = s.id
WHERE o.storefront_id = sf.id
  AND o.business_id IS NULL;

-- ---------------------------------------------------------------------------
-- §2 — Backfill customers.business_id from the attribution bindings, and
-- repair the cutover-window manual customers (store-bound but missing
-- origin_order_source_id; the cutover preserved store ids, so
-- order_sources.legacy_store_id matches the live store id directly).
-- ---------------------------------------------------------------------------

UPDATE public.customers c
SET business_id = br.business_id
FROM public.order_sources os
JOIN public.brands br ON br.id = os.brand_id
WHERE c.origin_order_source_id = os.id
  AND c.business_id IS NULL;

UPDATE public.customers c
SET business_id = br.business_id
FROM public.stores s
JOIN public.brands br ON br.woo_store_id = s.id
WHERE c.store_id = s.id
  AND c.business_id IS NULL;

UPDATE public.customers c
SET origin_order_source_id = os.id
FROM public.order_sources os
WHERE c.source = 'manual'
  AND c.origin_kind = 'manual'
  AND c.origin_order_source_id IS NULL
  AND c.store_id IS NOT NULL
  AND os.legacy_store_id = c.store_id;

UPDATE public.customers c
SET business_id = br.business_id
FROM public.order_sources os
JOIN public.brands br ON br.id = os.brand_id
WHERE c.origin_order_source_id = os.id
  AND c.business_id IS NULL;

-- ---------------------------------------------------------------------------
-- §3 — Derivation triggers.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.derive_order_business_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_business uuid;
BEGIN
  IF NEW.order_source_id IS NOT NULL THEN
    SELECT br.business_id INTO v_business
    FROM public.order_sources os
    JOIN public.brands br ON br.id = os.brand_id
    WHERE os.id = NEW.order_source_id;
  END IF;

  IF v_business IS NULL AND NEW.store_id IS NOT NULL THEN
    SELECT br.business_id INTO v_business
    FROM public.stores s
    JOIN public.brands br ON br.woo_store_id = s.id
    WHERE s.id = NEW.store_id;
  END IF;

  IF v_business IS NULL AND NEW.storefront_id IS NOT NULL THEN
    SELECT br.business_id INTO v_business
    FROM public.storefronts sf
    JOIN public.stores s ON s.id = sf.store_id
    JOIN public.brands br ON br.woo_store_id = s.id
    WHERE sf.id = NEW.storefront_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_business IS NOT NULL THEN
      NEW.business_id := v_business;
    ELSE
      -- No derivable binding: fall back to the writer's active business
      -- context (POS local-store flow). Context-less writers (service_role)
      -- stay NULL = shared pool row, per the Task 15 doctrine.
      NEW.business_id := COALESCE(NEW.business_id, public.current_business_context());
    END IF;
  ELSIF
       NEW.order_source_id IS DISTINCT FROM OLD.order_source_id
    OR NEW.store_id        IS DISTINCT FROM OLD.store_id
    OR NEW.storefront_id   IS DISTINCT FROM OLD.storefront_id
  THEN
    -- A binding changed: re-derive when possible. A foreign binding flips
    -- business_id to the foreign business, which the policies' WITH CHECK
    -- (business_id = context) rejects. Clearing the bindings keeps the
    -- stamped value — the row stays tenanted and unattributed.
    IF v_business IS NOT NULL THEN
      NEW.business_id := v_business;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.derive_customer_business_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_business uuid;
BEGIN
  IF NEW.origin_order_source_id IS NOT NULL THEN
    SELECT br.business_id INTO v_business
    FROM public.order_sources os
    JOIN public.brands br ON br.id = os.brand_id
    WHERE os.id = NEW.origin_order_source_id;
  END IF;

  IF v_business IS NULL AND NEW.store_id IS NOT NULL THEN
    SELECT br.business_id INTO v_business
    FROM public.stores s
    JOIN public.brands br ON br.woo_store_id = s.id
    WHERE s.id = NEW.store_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_business IS NOT NULL THEN
      NEW.business_id := v_business;
    ELSE
      NEW.business_id := COALESCE(NEW.business_id, public.current_business_context());
    END IF;
  ELSIF
       NEW.origin_order_source_id IS DISTINCT FROM OLD.origin_order_source_id
    OR NEW.store_id               IS DISTINCT FROM OLD.store_id
  THEN
    IF v_business IS NOT NULL THEN
      NEW.business_id := v_business;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_derive_business_id ON public.orders;
CREATE TRIGGER trg_orders_derive_business_id
  BEFORE INSERT OR UPDATE OF order_source_id, store_id, storefront_id
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_order_business_id();

DROP TRIGGER IF EXISTS trg_customers_derive_business_id ON public.customers;
CREATE TRIGGER trg_customers_derive_business_id
  BEFORE INSERT OR UPDATE OF origin_order_source_id, store_id
  ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_customer_business_id();

-- ---------------------------------------------------------------------------
-- §4 — RLS rewrite: the eight per-table policies collapse to five, keyed on
-- business_id tenancy. Drop ALL existing policies first (robust against name
-- drift), then recreate the final set.
-- ---------------------------------------------------------------------------

DO $drop$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.orders', r.policyname);
  END LOOP;

  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'customers'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.customers', r.policyname);
  END LOOP;
END;
$drop$;

-- (1) Unified read: own business's rows, plus shared (NULL-business) rows.
CREATE POLICY "Account members can read orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    (business_id IS NULL OR business_id = public.current_business_context())
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  );

-- (2) Fail-closed insert: the trigger stamps business_id from the bindings or
-- the writer's context before this check runs; a member can no longer create
-- shared rows.
CREATE POLICY "Account members can insert orders"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id = public.current_business_context()
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  );

-- (3) Update, BOUND rows only. The bound restriction is load-bearing: under
-- Postgres' independent-OR policy semantics, letting staff touch unbound rows
-- through this policy would let them reassign (any WITH CHECK that allows a
-- bound result is OR'd with the others). Unbound rows are ladder-only.
CREATE POLICY "Account members can update orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    business_id = public.current_business_context()
    AND (store_id IS NOT NULL OR storefront_id IS NOT NULL OR order_source_id IS NOT NULL)
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  )
  WITH CHECK (
    business_id = public.current_business_context()
    AND (store_id IS NOT NULL OR storefront_id IS NOT NULL OR order_source_id IS NOT NULL)
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  );

-- (4) Delete: business-scoped for all rows of the writer's business.
CREATE POLICY "Account members can delete orders"
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (
    business_id = public.current_business_context()
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  );

-- (5) The pool ladder: unattributed rows are read by everyone (policy 1) but
-- updated only by owner/admin/manager — either kept unattributed or bound to
-- this business (the trigger re-derives business_id; a foreign binding is
-- rejected by the bound branch's business_id = context).
CREATE POLICY "Legacy pool operators can reassign orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    (business_id IS NULL OR business_id = public.current_business_context())
    AND store_id IS NULL AND storefront_id IS NULL AND order_source_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])
    )
  )
  WITH CHECK (
    (store_id IS NULL AND storefront_id IS NULL AND order_source_id IS NULL
      AND (business_id IS NULL OR business_id = public.current_business_context()))
    OR
    (business_id = public.current_business_context()
      AND EXISTS (
        SELECT 1
        FROM public.user_business_access membership
        JOIN public.businesses business ON business.id = membership.business_id
        WHERE membership.user_id = auth.uid()
          AND membership.business_id = public.current_business_context()
          AND business.is_active
      ))
  );

-- customers: the same five policies with origin_order_source_id in place of
-- order_source_id and no storefront leg.
CREATE POLICY "Account members can read customers"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    (business_id IS NULL OR business_id = public.current_business_context())
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  );

CREATE POLICY "Account members can insert customers"
  ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    business_id = public.current_business_context()
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  );

CREATE POLICY "Account members can update customers"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (
    business_id = public.current_business_context()
    AND (store_id IS NOT NULL OR origin_order_source_id IS NOT NULL)
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  )
  WITH CHECK (
    business_id = public.current_business_context()
    AND (store_id IS NOT NULL OR origin_order_source_id IS NOT NULL)
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  );

CREATE POLICY "Account members can delete customers"
  ON public.customers
  FOR DELETE
  TO authenticated
  USING (
    business_id = public.current_business_context()
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
  );

CREATE POLICY "Legacy pool operators can reassign customers"
  ON public.customers
  FOR UPDATE
  TO authenticated
  USING (
    (business_id IS NULL OR business_id = public.current_business_context())
    AND store_id IS NULL AND origin_order_source_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      JOIN public.businesses business ON business.id = membership.business_id
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND business.is_active
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_business_access membership
      WHERE membership.user_id = auth.uid()
        AND membership.business_id = public.current_business_context()
        AND membership.role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])
    )
  )
  WITH CHECK (
    (store_id IS NULL AND origin_order_source_id IS NULL
      AND (business_id IS NULL OR business_id = public.current_business_context()))
    OR
    (business_id = public.current_business_context()
      AND EXISTS (
        SELECT 1
        FROM public.user_business_access membership
        JOIN public.businesses business ON business.id = membership.business_id
        WHERE membership.user_id = auth.uid()
          AND membership.business_id = public.current_business_context()
          AND business.is_active
      ))
  );

-- ---------------------------------------------------------------------------
-- §5 — Verification.
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  v_unstamped_orders bigint;
  v_unstamped_customers bigint;
  v_trigger_count int;
  v_policy_count int;
  v_tag_policies int;
  v_repaired int;
BEGIN
  -- Every bound row must be stamped.
  SELECT count(*) INTO v_unstamped_orders FROM public.orders
  WHERE business_id IS NULL
    AND (order_source_id IS NOT NULL OR store_id IS NOT NULL OR storefront_id IS NOT NULL);
  IF v_unstamped_orders <> 0 THEN
    RAISE EXCEPTION 'key model: % bound orders left unstamped', v_unstamped_orders;
  END IF;

  SELECT count(*) INTO v_unstamped_customers FROM public.customers
  WHERE business_id IS NULL
    AND (origin_order_source_id IS NOT NULL OR store_id IS NOT NULL);
  IF v_unstamped_customers <> 0 THEN
    RAISE EXCEPTION 'key model: % bound customers left unstamped', v_unstamped_customers;
  END IF;

  -- Both derivation triggers exist and are enabled.
  SELECT count(*) INTO v_trigger_count FROM pg_trigger
  WHERE tgrelid IN ('public.orders'::regclass, 'public.customers'::regclass)
    AND tgname IN ('trg_orders_derive_business_id', 'trg_customers_derive_business_id')
    AND NOT tgisinternal;
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION 'key model: expected 2 derivation triggers, found %', v_trigger_count;
  END IF;

  -- Exactly five policies per table.
  SELECT count(*) INTO v_policy_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'orders';
  IF v_policy_count <> 5 THEN
    RAISE EXCEPTION 'key model: expected 5 orders policies, found %', v_policy_count;
  END IF;

  SELECT count(*) INTO v_policy_count FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'customers';
  IF v_policy_count <> 5 THEN
    RAISE EXCEPTION 'key model: expected 5 customers policies, found %', v_policy_count;
  END IF;

  -- The tag is retired from RLS: no policy may reference the pool tag.
  SELECT count(*) INTO v_tag_policies FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('orders', 'customers')
    AND (qual LIKE '%legacy migration%' OR with_check LIKE '%legacy migration%');
  IF v_tag_policies <> 0 THEN
    RAISE EXCEPTION 'key model: % policies still reference the pool tag', v_tag_policies;
  END IF;

  -- The cutover-window manual customers are repaired (0 expected locally; the
  -- production count is reported, not asserted).
  SELECT count(*) INTO v_repaired FROM public.customers
  WHERE source = 'manual' AND origin_kind = 'manual'
    AND origin_order_source_id IS NULL AND store_id IS NOT NULL;

  RAISE NOTICE 'key model: unstamped bound orders %, unstamped bound customers %, triggers %, policies 5+5, tag refs in policies %, manual customers still missing origin source %',
    v_unstamped_orders, v_unstamped_customers, v_trigger_count, v_tag_policies, v_repaired;
END;
$verify$;
