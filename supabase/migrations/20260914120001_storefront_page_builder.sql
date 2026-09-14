-- ============================================================================
-- Storefront Phase 1 (P0 #1): section-based page builder.
--
-- EXPANDS the EXISTING public.storefront_pages table (created by
-- 20260516201928 — a live table with zero app readers, fact 9); a CREATE TABLE
-- here would fail on deploy. Adds type/status/seo/published_snapshot/
-- published_at, the one-home-per-storefront partial unique index, the new
-- storefront_page_sections working-copy table (staff/admin-only RLS, H4: NO
-- anon policy at all — the runtime reads published_snapshot only), the M12
-- set_updated_at() triggers on BOTH page tables, storefronts.nav, the
-- `storefronts.view` permission enum value (ADD VALUE only — the grant that
-- COMPARES the new value lives in 20260914120002_storefront_permission_
-- grants.sql because PG12+ forbids comparing a newly-added enum value in the
-- same transaction, L5), and the draft backfill (home/about/policies per
-- storefront; nothing auto-publishes → zero visual change on deploy).
--
-- Re-runs safely: every CREATE TABLE/INDEX carries IF NOT EXISTS; triggers use
-- the own-name DROP IF EXISTS + CREATE idiom (repo precedent 20260614043218);
-- every new policy is preceded by a DROP POLICY IF EXISTS of the same name
-- (PostgreSQL has no CREATE POLICY IF NOT EXISTS — the §9.1/M14 idiom).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Expand storefront_pages (fact 9: table already exists)
-- ---------------------------------------------------------------------------
ALTER TABLE public.storefront_pages
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'custom'
    CHECK (type IN ('home','custom')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published')),
  ADD COLUMN IF NOT EXISTS seo jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {title, description, og_image_url}
  ADD COLUMN IF NOT EXISTS published_snapshot jsonb,                 -- [{type,position,is_visible,props}]; NULL while draft-only
  ADD COLUMN IF NOT EXISTS published_at timestamptz;
-- body_md / is_active remain (legacy columns, unused by v1 code)

-- L10: partial unique index → exactly one home page per storefront.
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_pages_one_home
  ON public.storefront_pages(storefront_id) WHERE type = 'home';

-- ---------------------------------------------------------------------------
-- 2. storefront_page_sections — the working copy (staff/admin only, H4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.storefront_page_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.storefront_pages(id) ON DELETE CASCADE,
  type text NOT NULL,                        -- validated against the registry in app code
  position integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_sections_page ON public.storefront_page_sections(page_id, position);   -- L10

ALTER TABLE public.storefront_page_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff and admin can read storefront_page_sections" ON public.storefront_page_sections;
CREATE POLICY "Staff and admin can read storefront_page_sections"
  ON public.storefront_page_sections FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

DROP POLICY IF EXISTS "Staff and admin can insert storefront_page_sections" ON public.storefront_page_sections;
CREATE POLICY "Staff and admin can insert storefront_page_sections"
  ON public.storefront_page_sections FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

DROP POLICY IF EXISTS "Staff and admin can update storefront_page_sections" ON public.storefront_page_sections;
CREATE POLICY "Staff and admin can update storefront_page_sections"
  ON public.storefront_page_sections FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

DROP POLICY IF EXISTS "Staff and admin can delete storefront_page_sections" ON public.storefront_page_sections;
CREATE POLICY "Staff and admin can delete storefront_page_sections"
  ON public.storefront_page_sections FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
-- Deliberately NO anon/public policy (H4): anon never needs the sections table —
-- the runtime reads published_snapshot on the storefront_pages row, so draft
-- edits of a published page are never anon-readable.

-- ---------------------------------------------------------------------------
-- 3. M12: the updated_at auto-update mechanism (clobber detection §4.4).
--    Without it, updated_at keeps its insert-time value forever, the
--    WHERE updated_at = <base> save predicate always matches, and conflict
--    detection can never fire.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_storefront_page_sections_set_updated_at
  ON public.storefront_page_sections;
CREATE TRIGGER trg_storefront_page_sections_set_updated_at
  BEFORE UPDATE ON public.storefront_page_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- storefront_pages pre-exists (fact 9) and ALREADY has a BEFORE UPDATE bump —
-- update_storefront_pages_updated_at (20260516201928 lines 153–155, executing
-- update_updated_at_column from 20260407071618) — so page-level clobber
-- detection was already functional pre-plan (N1). Creating our own (duplicate)
-- pages trigger is harmless — both set now(), transaction-stable — but
-- unnecessary; the DROP IF EXISTS of OUR OWN trigger name + re-CREATE is kept
-- purely as the standard migration idempotency idiom on a self-owned object
-- (not a policy drop; not an exception to expand-only). The verify file
-- records the pre-existing trigger's presence.
DROP TRIGGER IF EXISTS trg_storefront_pages_set_updated_at ON public.storefront_pages;
CREATE TRIGGER trg_storefront_pages_set_updated_at
  BEFORE UPDATE ON public.storefront_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. storefronts.nav (jsonb) — covered by the existing storefronts policies
-- ---------------------------------------------------------------------------
ALTER TABLE public.storefronts ADD COLUMN IF NOT EXISTS nav jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 5. Permission enum (M3) — ADD VALUE only (L5): the new value is NOT compared
--    anywhere in this migration. The grant lives in
--    20260914120002_storefront_permission_grants.sql.
-- ---------------------------------------------------------------------------
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'storefronts.view';

-- ---------------------------------------------------------------------------
-- 6. Backfill — drafts only, nothing auto-publishes. Runtime keeps the legacy
--    components for storefronts without a published home → zero visual change.
-- ---------------------------------------------------------------------------
-- home / about / policies page drafts (ON CONFLICT guards pre-existing rows in
-- the previously-dead table):
INSERT INTO public.storefront_pages (storefront_id, slug, title, body_md, is_active, type, status, seo)
SELECT s.id, 'home', 'Home', '', true, 'home', 'draft', '{}'::jsonb
FROM public.storefronts s
ON CONFLICT (storefront_id, slug) DO NOTHING;

INSERT INTO public.storefront_pages (storefront_id, slug, title, body_md, is_active, type, status, seo)
SELECT s.id, 'about', 'About', COALESCE(s.about_md, ''), true, 'custom', 'draft', '{}'::jsonb
FROM public.storefronts s
ON CONFLICT (storefront_id, slug) DO NOTHING;

INSERT INTO public.storefront_pages (storefront_id, slug, title, body_md, is_active, type, status, seo)
SELECT s.id, 'policies', 'Policies', '', true, 'custom', 'draft', '{}'::jsonb
FROM public.storefronts s
ON CONFLICT (storefront_id, slug) DO NOTHING;

-- home sections: hero (props from the legacy hero fields) + featured-products.
INSERT INTO public.storefront_page_sections (page_id, type, position, is_visible, props)
SELECT p.id, 'hero', 0, true,
  jsonb_build_object(
    'title',     COALESCE(s.hero_title, ''),
    'subtitle',  COALESCE(s.hero_subtitle, ''),
    'image_url', COALESCE(s.hero_image_url, ''),
    'align', 'center',
    'overlay', 30)
FROM public.storefront_pages p
JOIN public.storefronts s ON s.id = p.storefront_id
WHERE p.type = 'home' AND p.slug = 'home'
  AND NOT EXISTS (SELECT 1 FROM public.storefront_page_sections x WHERE x.page_id = p.id AND x.type = 'hero');

INSERT INTO public.storefront_page_sections (page_id, type, position, is_visible, props)
SELECT p.id, 'featured-products', 1, true,
  jsonb_build_object('title', 'Featured', 'limit', 8, 'columns', 4)
FROM public.storefront_pages p
WHERE p.type = 'home' AND p.slug = 'home'
  AND NOT EXISTS (SELECT 1 FROM public.storefront_page_sections x WHERE x.page_id = p.id AND x.type = 'featured-products');

-- about: one rich-text section from about_md.
INSERT INTO public.storefront_page_sections (page_id, type, position, is_visible, props)
SELECT p.id, 'rich-text', 0, true,
  jsonb_build_object('title', 'About', 'markdown', COALESCE(s.about_md, ''))
FROM public.storefront_pages p
JOIN public.storefronts s ON s.id = p.storefront_id
WHERE p.slug = 'about'
  AND NOT EXISTS (SELECT 1 FROM public.storefront_page_sections x WHERE x.page_id = p.id AND x.type = 'rich-text');

-- policies: one rich-text section per non-empty legacy policy (idempotent —
-- guarded per section title, so a re-run never duplicates).
INSERT INTO public.storefront_page_sections (page_id, type, position, is_visible, props)
SELECT p.id, 'rich-text',
       CASE k.key WHEN 'shipping' THEN 0 WHEN 'returns' THEN 1 ELSE 2 END,
       true,
  jsonb_build_object(
    'title', CASE k.key WHEN 'shipping' THEN 'Shipping' WHEN 'returns' THEN 'Returns & exchanges' ELSE 'Privacy' END,
    'markdown', k.value)
FROM public.storefronts s
CROSS JOIN LATERAL (
  SELECT key, value FROM jsonb_each_text(COALESCE(s.policies, '{}'::jsonb))
  WHERE key IN ('shipping','returns','privacy') AND COALESCE(value, '') <> ''
) k
JOIN public.storefront_pages p ON p.storefront_id = s.id AND p.slug = 'policies'
WHERE NOT EXISTS (
  SELECT 1 FROM public.storefront_page_sections x
  WHERE x.page_id = p.id
    AND x.type = 'rich-text'
    AND x.props->>'title' = CASE k.key WHEN 'shipping' THEN 'Shipping' WHEN 'returns' THEN 'Returns & exchanges' ELSE 'Privacy' END
);

-- nav default (matches today's hard-coded nav in StorefrontLayout.tsx):
UPDATE public.storefronts
SET nav = '[{"label":"Shop","href":"/shop"},{"label":"About","href":"/about"},{"label":"Track","href":"/track"},{"label":"Contact","href":"/contact"}]'::jsonb
WHERE nav = '[]'::jsonb;




