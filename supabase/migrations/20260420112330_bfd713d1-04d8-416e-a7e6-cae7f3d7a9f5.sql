-- ============================================================
-- Granular permissions system
-- ============================================================

-- 1. Permission enum (exhaustive list of action keys)
CREATE TYPE public.app_permission AS ENUM (
  -- Dashboard
  'dashboard.view',
  -- Orders
  'orders.view',
  'orders.create',
  'orders.edit',
  'orders.delete',
  'orders.change_status',
  'orders.dispatch',
  'orders.refund',
  'orders.log_payment',
  'orders.discount_large',
  -- Pre-orders
  'preorders.view',
  'preorders.manage',
  -- Customers
  'customers.view',
  'customers.edit',
  'customers.delete',
  -- Products
  'products.view',
  'products.create',
  'products.edit',
  'products.delete',
  'products.view_cost',
  'products.edit_cost',
  -- POS
  'pos.use',
  'pos.discount_large',
  'pos.refund',
  'pos.shift_close',
  -- Analytics
  'analytics.view',
  'analytics.view_revenue',
  -- Integrations
  'integrations.view',
  'integrations.manage',
  -- Stores
  'stores.view',
  'stores.manage',
  -- Settings
  'settings.view',
  'settings.manage',
  -- Team
  'team.view',
  'team.manage',
  -- Audit log
  'audit.view'
);

-- 2. Custom roles table
CREATE TABLE public.custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions app_permission[] NOT NULL DEFAULT '{}',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read custom_roles"
  ON public.custom_roles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage custom_roles"
  ON public.custom_roles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_custom_roles_updated
  BEFORE UPDATE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. User -> custom roles mapping (many-to-many)
CREATE TABLE public.user_custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  custom_role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, custom_role_id)
);

ALTER TABLE public.user_custom_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read user_custom_roles"
  ON public.user_custom_roles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage user_custom_roles"
  ON public.user_custom_roles FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. Per-user permission overrides (grant or revoke individual permissions)
CREATE TABLE public.user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  permission app_permission NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true, -- true = grant, false = revoke override
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, permission)
);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read user_permissions"
  ON public.user_permissions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage user_permissions"
  ON public.user_permissions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 5. User -> store access scoping
CREATE TABLE public.user_store_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, store_id)
);

ALTER TABLE public.user_store_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read user_store_access"
  ON public.user_store_access FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage user_store_access"
  ON public.user_store_access FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 6. Settings table for permission system config (large discount threshold etc.)
CREATE TABLE public.permission_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  large_discount_percent NUMERIC NOT NULL DEFAULT 10,
  large_discount_amount NUMERIC, -- optional flat threshold
  enforce_store_scoping BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.permission_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read permission_settings"
  ON public.permission_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage permission_settings"
  ON public.permission_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_permission_settings_updated
  BEFORE UPDATE ON public.permission_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.permission_settings (large_discount_percent) VALUES (10);

-- 7. Effective permission resolver
-- Combines: app_role preset + custom roles + user overrides
-- Admin always has all permissions.
CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission app_permission)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role app_role;
  v_override BOOLEAN;
  v_from_custom BOOLEAN;
  v_from_preset BOOLEAN;
BEGIN
  -- Admin always allowed
  IF has_role(_user_id, 'admin'::app_role) THEN
    RETURN true;
  END IF;

  -- Per-user override (revoke takes precedence even if granted elsewhere)
  SELECT granted INTO v_override
    FROM user_permissions
    WHERE user_id = _user_id AND permission = _permission
    LIMIT 1;
  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  -- Custom role grants
  SELECT EXISTS (
    SELECT 1
    FROM user_custom_roles ucr
    JOIN custom_roles cr ON cr.id = ucr.custom_role_id
    WHERE ucr.user_id = _user_id
      AND _permission = ANY(cr.permissions)
  ) INTO v_from_custom;
  IF v_from_custom THEN
    RETURN true;
  END IF;

  -- Preset role baseline
  SELECT role INTO v_role FROM user_roles WHERE user_id = _user_id LIMIT 1;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  v_from_preset := CASE
    WHEN v_role = 'staff' THEN _permission IN (
      'dashboard.view',
      'orders.view','orders.create','orders.edit','orders.change_status',
      'orders.dispatch','orders.log_payment',
      'preorders.view','preorders.manage',
      'customers.view','customers.edit',
      'products.view','products.create','products.edit',
      'pos.use','pos.shift_close',
      'integrations.view','stores.view'
    )
    WHEN v_role = 'viewer' THEN _permission IN (
      'dashboard.view','orders.view','customers.view','products.view'
    )
    ELSE false
  END;

  RETURN COALESCE(v_from_preset, false);
END;
$$;

-- 8. Store access checker (empty mapping = access to ALL stores for admin/staff)
CREATE OR REPLACE FUNCTION public.user_has_store_access(_user_id UUID, _store_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_enforce BOOLEAN;
BEGIN
  IF has_role(_user_id, 'admin'::app_role) THEN
    RETURN true;
  END IF;

  SELECT enforce_store_scoping INTO v_enforce FROM permission_settings LIMIT 1;
  IF NOT COALESCE(v_enforce, true) THEN
    RETURN true;
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_store_access WHERE user_id = _user_id;
  IF v_count = 0 THEN
    -- No restrictions assigned = access to all stores
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM user_store_access
    WHERE user_id = _user_id AND store_id = _store_id
  );
END;
$$;

-- 9. Get all effective permissions for a user (used by the frontend)
CREATE OR REPLACE FUNCTION public.get_user_permissions(_user_id UUID)
RETURNS app_permission[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perms app_permission[];
  p app_permission;
  v_result app_permission[] := '{}';
BEGIN
  -- Admin: return all enum values
  IF has_role(_user_id, 'admin'::app_role) THEN
    SELECT array_agg(unnest::app_permission) INTO v_perms
    FROM unnest(enum_range(NULL::app_permission));
    RETURN v_perms;
  END IF;

  FOR p IN SELECT unnest(enum_range(NULL::app_permission)) LOOP
    IF has_permission(_user_id, p) THEN
      v_result := array_append(v_result, p);
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

-- 10. Get user's accessible store ids ('{}'::uuid[] when unrestricted/all)
CREATE OR REPLACE FUNCTION public.get_user_store_ids(_user_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT array_agg(store_id) INTO v_ids FROM user_store_access WHERE user_id = _user_id;
  RETURN COALESCE(v_ids, '{}'::uuid[]);
END;
$$;

-- 11. Seed a few helpful custom roles
INSERT INTO public.custom_roles (name, description, permissions, is_system) VALUES
  ('Cashier', 'POS operator: can sell, hold carts, close own shift', ARRAY[
    'dashboard.view','pos.use','pos.shift_close','products.view','customers.view','customers.edit','orders.view','orders.create'
  ]::app_permission[], true),
  ('Order Manager', 'Manages full order lifecycle and dispatch', ARRAY[
    'dashboard.view','orders.view','orders.create','orders.edit','orders.change_status','orders.dispatch','orders.log_payment','orders.refund',
    'preorders.view','preorders.manage','customers.view','customers.edit','products.view','stores.view','integrations.view'
  ]::app_permission[], true),
  ('Inventory Manager', 'Full product and stock control', ARRAY[
    'dashboard.view','products.view','products.create','products.edit','products.delete','products.view_cost','products.edit_cost','stores.view'
  ]::app_permission[], true);
