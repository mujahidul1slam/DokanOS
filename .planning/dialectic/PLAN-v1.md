# PLAN-v1 — DokanOS Settings & Account Remediation (P0/P1/P2)

**Source of truth:** `DOKANOS-SETTINGS-AUDIT.md` (Sept 2026)
**Stack:** Vite + React 18 + TS + shadcn/ui SPA · Supabase (Auth/Postgres+RLS/Edge Functions/Storage) · Vercel
**Status:** PLANNING ONLY — nothing in this document is implemented.
**Scope:** Audit recommendations P0-1, P1-2/3/4, P2-5/6/7. P3 items (VAT, notifications, gateways) are explicitly out of scope (§12).

---

## 0. Guiding constraints (apply to every work item)

1. **Production, multi-user, existing data.** Every DB change must be additive-first, run behind `IF EXISTS`/`IF NOT EXISTS` guards where safe, carry a tested rollback, and never break a live session mid-request. Deploys are Vercel (SPA) + `supabase db push` / linked migration.
2. **Order of operations for any DB+frontend pair:** DB first (expand), then edge function, then frontend (contract), then tighten. The frontend must never ship a call that a policy has already learned to reject, and a policy must never ship a rejection the deployed frontend still relies on. The one exception is W1, where the policy is *tightening a hole* — there we stage the frontend change in the same release window (§2 sequencing).
3. **Migrations are append-only files** in `supabase/migrations/` (134 existing, timestamped `YYYYMMDDHHMMSS_name.sql`). We never edit historical migrations; we add new ones that `DROP POLICY IF EXISTS` then `CREATE` (the established house pattern, e.g. `20260904000100` lines 353–361).
4. **House RLS idiom:** `has_role(auth.uid(), 'admin'::app_role)` (SECURITY DEFINER, `20260412161413`), `is_business_member(business_id)` (SECURITY DEFINER, `20260904000100:56`), helper functions `REVOKE ... FROM PUBLIC, anon, authenticated` + targeted `GRANT EXECUTE`.
5. **Tests:** vitest (jsdom, `vitest.config.ts`, glob `src/**/*.{test,spec}.{ts,tsx}`) for units; Playwright (`playwright.config.ts` via lovable wrapper, `playwright-fixture.ts` exists) for e2e; **RLS tests via a new pgTAP-style SQL harness** (§4.4) executed against a local Postgres/Supabase branch — the repo has no DB test infra today (`test_db.ts` is a scratch Deno script), so we build a minimal one.
6. **No new heavyweight dependencies.** `react-hook-form`, `zod`, `@hookform/resolvers` are already in `package.json` (unused in settings).

---

## 1. Dependency graph & overall ordering

```
Phase 0 (prep, half day)
  W0  test harness (vitest RLS harness + fixtures + Playwright auth helpers)
        │
Phase 1 — P0 Security (days 1–3)          [SHIP TOGETHER AS RELEASE 1]
  W1a RLS: tighten user_business_access   ──┐
  W1b create_business_with_owner RPC        ├─ W1a→W1b→W1c strict order
  W1c frontend: CreateBusinessForm → RPC   ─┘
        │
Phase 2 — P1 Identity collapse (days 4–9)  [RELEASE 2]
  W2a General tab: retire business fields / redirect
  W2b BusinessProfileTab → relabel "Invoice & Print Header"
  W2c delete pages/Stores.tsx + import sweep
  W2d shared useCurrency (src/hooks) + de-hardcode ৳ (50 files)  ← largest fan-out
        │ (W2d should land before W5's dirty-guard work touches the same files where practical,
        │   but is not a hard blocker)
Phase 3 — P2 UX & parity (days 10–17)      [RELEASE 3]
  W3  /storefronts PermissionGuard            (independent)
  W4  app_settings staff-write tightening     (independent, DB-only)
  W5  react-hook-form + zod in settings tabs  (after W2a/W2b settle tab surfaces)
  W6  dirty-state guard on tab switch         (after W5 — needs per-tab form state)
  W7  User Access Dialog per-business scoping (after W1a — needs role columns trusted)
  W8  email change flow                       (independent)
  W9  TOTP 2FA (optional, behind flag)        (after W8 — shares re-auth dialog shell)
```

Critical path: **W0 → W1a → W1b → W1c → (W2d, W5, W6, W7)**. W2a/W2b/W2c/W3/W4/W8 are parallelizable after Release 1.

Effort legend: S ≤ 0.5d, M ≈ 1–2d, L ≈ 3–5d (single senior dev).

---

## 2. W1 — P0: Close the multi-tenant escalation hole

### 2.1 W1a: RLS — `user_business_access` cannot be self-granted

**Goal.** No authenticated user can insert/update/delete a `user_business_access` row unless they are (a) a platform `admin` (`user_roles.role='admin'`), or (b) an `owner`/`admin` **of the target business**, or (c) touching **their own row to leave** (DELETE only, or UPDATE that does not elevate role). Membership must never be acquired client-side.

**Root cause (verified).** `supabase/migrations/20260904000100_multi_business_foundation.sql:371-374` — policy `Users can write own access` `FOR ALL ... WITH CHECK (user_id = auth.uid() OR has_role(...))` — `WITH CHECK` validates only the row's `user_id`, not `business_id` or `role`.

**Files.**
- Create: `supabase/migrations/20260911000100_rls_tighten_user_business_access.sql` (forward)
- Create: `supabase/migrations/20260911000101_rls_rollback_user_business_access.sql.down.sql` (rollback reference; see §2.1.3 — kept as a sibling doc file since Supabase migration dirs are forward-only; the rollback SQL is also embedded as a comment block in the forward file)

**Forward SQL (exact):**

```sql
-- ============================================================================
-- P0 fix: user_business_access write policies.
-- Replaces "Users can write own access" (FOR ALL, self OR admin) which let any
-- authenticated user self-grant owner on ANY business.
-- House idiom: DROP POLICY IF EXISTS + CREATE (see 20260904000100:365-374).
-- ============================================================================

-- Helper: caller's role in a business (NULL when not a member). SECURITY DEFINER
-- so policies on user_business_access can read it without recursion.
CREATE OR REPLACE FUNCTION public.my_business_role(p_business_id uuid, p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.role FROM public.user_business_access a
  WHERE a.business_id = p_business_id AND a.user_id = p_user;
$$;
REVOKE ALL ON FUNCTION public.my_business_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_business_role(uuid, uuid) TO authenticated;

-- Helper: can caller manage memberships of this business?
CREATE OR REPLACE FUNCTION public.can_manage_business_access(p_business_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user, 'admin'::app_role)
     OR public.my_business_role(p_business_id, p_user) IN ('owner', 'admin');
$$;
REVOKE ALL ON FUNCTION public.can_manage_business_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_business_access(uuid, uuid) TO authenticated;

-- Helper: business has at least one other owner besides p_user.
-- Blocks the last-owner-lockout and self-demotion of the only owner.
CREATE OR REPLACE FUNCTION public.business_has_other_owner(p_business_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_business_access
    WHERE business_id = p_business_id
      AND role = 'owner'
      AND user_id <> p_user
  );
$$;
REVOKE ALL ON FUNCTION public.business_has_other_owner(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_has_other_owner(uuid, uuid) TO authenticated;

BEGIN;
ALTER TABLE public.user_business_access ENABLE ROW LEVEL SECURITY;

-- Drop the vulnerable FOR ALL policy (and any stragglers).
DROP POLICY IF EXISTS "Users can write own access" ON public.user_business_access;
DROP POLICY IF EXISTS "Admins manage access" ON public.user_business_access;

-- SELECT: own rows, rows of businesses you can manage, platform admins see all.
-- (Members need to see co-members for team UIs — handled by W7 RPC, not raw SELECT.)
CREATE POLICY "Users can read own access" ON public.user_business_access
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR can_manage_business_access(business_id, auth.uid())
  );

-- INSERT: admin, or owner/admin of the TARGET business. The inserting row's
-- user_id may be anyone (that's the point — inviting people).
CREATE POLICY "Owners can add members" ON public.user_business_access
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR can_manage_business_access(business_id, auth.uid())
  );

-- UPDATE: managers only; never allow changing user_id or business_id
-- (relocate-member = delete+insert); role elevation to owner/admin requires
-- caller to be admin or an owner of that business.
CREATE POLICY "Owners can update member roles" ON public.user_business_access
  FOR UPDATE TO authenticated
  USING (can_manage_business_access(business_id, auth.uid()))
  WITH CHECK (
    can_manage_business_access(business_id, auth.uid())
    AND (user_id = auth.uid() IS FALSE OR role IN ('owner','admin','member','viewer'))  -- no-op guard
    AND (
      role NOT IN ('owner','admin')                    -- downgrade to member/viewer: any manager
      OR public.my_business_role(business_id, auth.uid()) = 'owner'
      OR has_role(auth.uid(), 'admin'::app_role)       -- only owners/platform-admins create owners/admins
    )
  );

-- DELETE: own row (leave business — but never the last owner),
-- or manager of that business.
CREATE POLICY "Members can leave; owners can remove" ON public.user_business_access
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR can_manage_business_access(business_id, auth.uid())
    OR (user_id = auth.uid() AND business_has_other_owner(business_id, auth.uid()))
  );

COMMIT;
```

Notes:
- `WITH CHECK` on UPDATE references the *new* row; `USING` the old. `can_manage_business_access` uses old `business_id`; since we forbid moving rows (enforced by the WITH CHECK not covering a changed business_id — Postgres re-evaluates USING for moved rows too; DELETE+INSERT is the only path to "move"), the invariant holds. We deliberately do **not** try to block column-level changes beyond role-elevation, because the UPDATE policy's USING must pass for the old row and WITH CHECK for the new one; a `user_id` change would fail USING (old business_id is managed but old user row belongs to someone else — no: USING only checks manager status, so a manager could theoretically rewrite user_id. To close that, add a trigger below.)
- **Guard trigger** (belt-and-braces against row "relocation"):

```sql
-- Immutable identity columns: user_id/business_id may never change via UPDATE.
CREATE OR REPLACE FUNCTION public.user_business_access_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.business_id <> OLD.business_id THEN
    RAISE EXCEPTION 'user_business_access user_id/business_id are immutable; delete and re-insert'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_uba_immutable ON public.user_business_access;
CREATE TRIGGER trg_uba_immutable BEFORE UPDATE ON public.user_business_access
  FOR EACH ROW EXECUTE FUNCTION public.user_business_access_immutable();
```

**Rollback (exact):**

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_uba_immutable ON public.user_business_access;
DROP FUNCTION IF EXISTS public.user_business_access_immutable();
DROP POLICY IF EXISTS "Users can read own access" ON public.user_business_access;
DROP POLICY IF EXISTS "Owners can add members" ON public.user_business_access;
DROP POLICY IF EXISTS "Owners can update member roles" ON public.user_business_access;
DROP POLICY IF EXISTS "Members can leave; owners can remove" ON public.user_business_access;
-- restore original vulnerable policy verbatim (20260904000100:368-374)
CREATE POLICY "Users can read own access" ON public.user_business_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can write own access" ON public.user_business_access
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
COMMIT;
-- (leave helper functions in place; they are harmless orphans on rollback)
```

**Rollback is documented but effectively never acceptable** — it reopens the critical hole. Rollback path is for a broken deploy (e.g. helper function regression breaking all membership reads), with the compensating control of immediately reverting the frontend release too.

**Acceptance criteria (testable).**
1. `viewer`-role user U1 (member of business A) executes `insert into user_business_access (user_id: U1, business_id: B_arbitrary, role:'owner')` via anon-key client → **42501 RLS violation**.
2. U1 inserts row for itself with role `owner` on business A where its role is `viewer` → **denied** (not a manager of A).
3. Owner O of business A inserts `{user_id: U2, business_id: A, role:'member'}` → **allowed**.
4. Owner O of A inserts `{U2, B_other, 'owner'}` → **denied** (O doesn't manage B_other).
5. Platform admin inserts any row → allowed.
6. Member M deletes own row (other owners exist) → allowed (leave).
7. Sole owner attempts DELETE own row → **denied** (last-owner lockout).
8. Manager updates member role `viewer`→`admin` → allowed only if caller is owner (per CHECK) — an `admin`(business) elevating to `owner` is denied; `owner` elevating to `owner` allowed.
9. UPDATE attempting to change `user_id` → trigger error `check_violation`.
10. `useBusinessContext.refresh()` (SELECT own + join businesses) still returns identical results for a normal member (no regression).

**Deployment sequencing (multi-user prod).**
- This is a **tighten** migration: existing rows are untouched; only future writes change. Sessions with in-flight membership mutations during the deploy window will fail with RLS errors — acceptable (self-service membership mutations are not a user flow today except CreateBusinessForm — see W1c) — **but W1c must deploy in the same release window** because the current `CreateBusinessForm` inserts its own owner row and would break for fresh installs the moment W1a lands. Concretely: deploy W1a+W1b+W1c in one Vercel release; run the migration immediately before/after the Vercel deploy (order: migration first, then frontend — the new frontend calls the RPC which works under both old and new policies; the old frontend's client-side insert breaks under the new policy, so minimize the gap to minutes).
- Pre-deploy check (run in prod SQL editor, read-only): `select count(*) from user_business_access where role='owner' and user_id not in (select user_id from user_roles where role='admin');` → sanity-list members with owner on businesses; if any look tampered, investigate **before** deploying (the hole may already have been used).

### 2.2 W1b: Server-side business creation — `create_business_with_owner` RPC

**Goal.** Fresh-install "create first business" works without any client-side membership insert, atomically, and cannot be used to create a business you'd then own without entitlement (creating a business inherently makes you its owner — the entitlement is: any authenticated user may create a *new* business; they just cannot attach themselves to *existing* ones. This matches the product model where businesses are operator-created orgs).

**Files.**
- Create: `supabase/migrations/20260911000200_create_business_with_owner.sql`

**SQL (exact):**

```sql
-- Atomic business + founder-owner row. SECURITY DEFINER so the caller needs
-- no direct INSERT rights on user_business_access (W1a removed them).
CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_name text,
  p_slug text,
  p_logo_url text DEFAULT NULL,
  p_currency text DEFAULT 'BDT',
  p_timezone text DEFAULT 'Asia/Dhaka'
)
RETURNS public.businesses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_business public.businesses;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'business name is required' USING ERRCODE = '23502';
  END IF;
  IF p_slug IS NULL OR p_slug = '' THEN
    RAISE EXCEPTION 'slug is required' USING ERRCODE = '23502';
  END IF;

  INSERT INTO public.businesses (name, slug, logo_url, currency, timezone)
  VALUES (btrim(p_name), p_slug, p_logo_url, p_currency, p_timezone)
  RETURNING * INTO v_business;

  INSERT INTO public.user_business_access (user_id, business_id, role)
  VALUES (v_user, v_business.id, 'owner');

  RETURN v_business;
END $$;
-- Critical: prevent the definer from being abused to bypass policies for OTHER
-- users. auth.uid() pins ownership to the caller.
REVOKE ALL ON FUNCTION public.create_business_with_owner(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text, text, text, text, text) TO authenticated;
```

**Duplicate-slug behavior:** the `INSERT ... businesses` raises `23505` (unique slug) which propagates to the client; the frontend already maps 23505 to friendly copy (keep that mapping at the RPC-error layer — PostgREST surfaces `code` in the error body).

**Why RPC over edge function:** edge functions require a deploy cycle and a service-role secret handshake; an RPC keeps the transaction atomic on the DB (business+access in one txn — the edge function path can't do a single-statement atomic insert without also being granted service role, and a partial failure there is exactly the "business created but linking failed" state the current code toasts about at `BusinessAccountTab.tsx:313-317`). Audit log insertion remains client-side (`logChange` after success) as today.

**Rollback:**
```sql
DROP FUNCTION IF EXISTS public.create_business_with_owner(text, text, text, text, text);
```

**Acceptance criteria.**
1. Fresh authenticated staff user with zero businesses calls the RPC → business row created **and** owner access row created, in one call; failure of either rolls back both (test: pre-create slug collision → no orphan access row; verify via service-role count).
2. Unauthenticated (anon) call → denied.
3. RPC with empty name / empty slug → clean error, no partial writes.
4. The returned row is a full `businesses` record the frontend can feed into `refresh()`.

### 2.3 W1c: Frontend — `CreateBusinessForm` uses the RPC

**Goal.** `src/components/settings/BusinessAccountTab.tsx` `CreateBusinessForm` (lines 269–325) replaces its two-step client-side insert (`businesses.insert` then `user_business_access.insert`, lines 288–317) with one `supabase.rpc("create_business_with_owner", ...)` call.

**Files.** Modify `src/components/settings/BusinessAccountTab.tsx` (only `CreateBusinessForm`; the `handleSave` update path at lines 100–140 is untouched).

**Changes (component level).**
- Replace `handleCreate` body: validate name/slug client-side as today, call `supabase.rpc("create_business_with_owner", { p_name, p_slug })`, map `23505` → "That slug is already taken by another business", then `logChange("business_account", data.id, null, {...}, undefined, { action: "create" })` and `await refresh()` exactly as now (lines 319–321).
- Remove the now-dead `supabase.auth.getUser()` second round-trip (old lines 302–307).
- The "only account admins can provision new businesses" error copy stays as the generic failure fallback (it becomes near-unreachable — any authenticated user can now create a new business legitimately).

**Acceptance criteria.**
1. Fresh-install e2e (Playwright, seeded empty-DB branch): Settings → Business Account → create "Test Biz" → sidebar switcher shows it, `user_business_access` has one owner row for the session user, toast success.
2. Duplicate slug attempt → friendly 23505 toast, no business row (verify via list).
3. `grep -r "user_business_access" src/` after W1c returns only `useBusinessContext.tsx` (read path) — no client-side writes remain.

**Edge function changes:** none for W1. (Deliberate decision: `team-manage` does NOT gain membership writes in this plan; see W7 and §12.)

**Testing.**
- RLS harness (W0): assertions AC-1..AC-9 in §2.1, AC in §2.2 — run as pgTAP-style `SELECT ok(...)` battery against a Supabase branch restored with all migrations; part of CI as `bun run test:rls` (§4.4).
- Vitest: unit-test a small `slugify` + error-mapping helper extracted from `CreateBusinessForm` (new `src/lib/businessHelpers.ts`) — pure functions, no DOM.
- Playwright: fresh-install create-business flow + duplicate-slug flow (2 specs, needs seeded "no businesses" auth user fixture).

**Effort:** W1a M · W1b S · W1c S. **Total: M (2 days incl. tests).**

**Risks & mitigations.**
- *Realtime membership channel breaks:* `useBusinessContext` subscribes to `user_business_access` postgres_changes; policy tightening can affect realtime RLS visibility. Mitigation: realtime already enabled on the table (`20260903000500_enable_realtime.sql`); verify channel events still fire for own-row changes in the e2e run; if not, add `ALTER TABLE ... REPLICA IDENTITY FULL` (it's a small table).
- *Existing prod rows created via the hole:* deploy-time audit query (§2.1 sequencing) surfaces them; remediation is manual owner review + delete rogue rows via SQL editor before the tightening ships — the tightening prevents recurrence but does not clean history. Add to rollout checklist as a gate.
- *Policy mis-breaks team flows:* the only current writers are CreateBusinessForm and SQL console; W7 later adds an RPC for membership management. Risk low; covered by AC-10 regression check.

---

## 3. Phase 2 — P1: Collapse business identity

### 3.1 W2a: General tab — retire business fields

**Goal.** Kill the lying surface: `SettingsPage.tsx:118-131` (`omnisync-business-name`, `omnisync-currency`, `omnisync-timezone` localStorage + `handleSaveGeneral` "Settings saved" toast). The "general" tab keeps only device-local concerns: theme (already `useTheme`, `dokanos-liquid-theme`) and PWA install (`InstallAppButton`, line 178). Business name/currency/timezone edits are **redirected** to the Business Account tab.

**Files.** Modify `src/pages/SettingsPage.tsx` (remove state lines 117–120, `handleSaveGeneral` 122–134, the General Settings card fields 157–180 keep theme+install only; update tab def line 65 label/keywords: "Appearance & App — theme, install" and remove "currency, timezone, name" keywords so search no longer surfaces it for those queries; add a compact "Business basics" pointer card linking to `account` tab).

**Component-level changes.**
- New small component `SettingsRedirectCard` (inline in SettingsPage or `src/components/settings/SettingsSection.tsx` sibling) rendering: "Business name, currency & timezone now live in Business Account →" with a `onClick={() => setActiveTab("account")}` Button. One card, three rows (name, currency, timezone) each with current **live** value read from `useBusinessContext().active` (not localStorage).
- Audit: `logChange("settings_general", ...)` disappears (nothing persists). No new log needed for a read-only pointer.
- Mobile drill-down path (line 240+) needs the same case-branch edit for `general`.

**Acceptance criteria.**
1. Tab renders theme toggle + InstallAppButton + redirect card; zero localStorage writes to `omnisync-*` keys occur on the page (Playwright assert: `localStorage.getItem('omnisync-currency') === null` after visiting and interacting).
2. Clicking "Business basics" card switches to `account` tab (desktop + mobile).
3. Settings search for "currency" lands on Business Account tab keyword hit (General not matched).
4. Existing users' stale `omnisync-*` keys are ignored app-wide (verify `grep -r "omnisync-" src/` → 0 after W2d lands its currency half; SettingsPage keys removed here).

**Migration/rollout.** Pure frontend; ships in Release 2. No DB change. Stale localStorage keys left in place (harmless) — cleanup removed deliberately (see §11, decided: no migration code for browser storage).

**Effort:** S.

### 3.2 W2b: BusinessProfileTab → explicit "Invoice & Print Header"

**Goal.** The third identity source (`invoice_settings` row via `BusinessProfileTab`, consumed by invoices + legacy sidebar fallback) stays as the **print-header** copy, explicitly labeled, and no longer implies it's "the business profile".

**Files.** Modify `src/components/settings/BusinessProfileTab.tsx` (retitle SettingsSection to "Invoice & Print Header", description: "Name, logo and contact block printed on invoices and pickup slips. This is print copy — your business account details live in Business Account."); modify `src/pages/SettingsPage.tsx` tab metadata (group "Documents & Sources" — move/alias: keep the tab under Account group but relabel id `general`'s child or restructure: simplest correct IA = BusinessProfileTab moves from General-tab body (line 181) to the `invoice` tab area as a second `SettingsSection` above the invoice print controls, or stays its own tab relabeled "Print Header"). **Decision: make it its own tab `printheader` under "Documents & Sources", remove from `general` case-branch.**

**Component-level changes.**
- Tab def: `{ id: "printheader", label: "Print Header", icon: Printer, description: "Business name/logo/contact on invoices", keywords: ["invoice", "header", "logo", "print", "brand"] }`.
- `BusinessProfileTab` internals unchanged (same `invoice_settings` read/write, same audit diffs) except: prefill helper — a small "Sync from Business Account" button that copies `businesses.name/logo_url/address/phone/email` → draft fields (one-way, explicit, toasted). This resolves the three-logo-copies confusion without a risky auto-migration of data.
- `src/components/AppSidebar.tsx:92-101` legacy `invoice_settings` fallback stays **as-is** this plan (see §11) — it only fires when zero businesses exist, which post-W1b is a shrinking population.

**Acceptance criteria.**
1. Settings search "print header"/"invoice logo" → new tab; old "Business Profile" label no longer presented under General.
2. "Sync from Business Account" fills all five draft fields from `useBusinessContext().active`; save persists to `invoice_settings`; audit log diff present.
3. Invoice render paths (`src/lib/invoiceHtml.ts`, `pickupSlipHtml.ts` consumers of `invoice_settings.business_name`) unaffected — vitest snapshot on `invoiceHtml.test.ts` still green (no behavior change, pure UI relabel).

**Effort:** S–M (mostly metadata + one button).

### 3.3 W2c: Delete dead `pages/Stores.tsx`

**Goal.** Remove 306 lines of dead code (audit §2.1; verified: no `import` of `pages/Stores` exists anywhere in `src/` — App.tsx imports `StoresHub` at line 37).

**Files.** Delete `src/pages/Stores.tsx`. Sweep (already verified zero imports, but re-run): `grep -rn "pages/Stores\b" src/`.

**Acceptance criteria.**
1. `bun run build` (Vite) succeeds; `tsc -b` clean — no dangling types.
2. Route `/stores` unaffected (serves `StoresHub`).
3. `git diff --stat` shows exactly one deletion.

**Effort:** S (0.25d).

### 3.4 W2d: Single currency source — shared `useCurrency` + de-hardcode ৳

**Goal.** Exactly one currency pipeline for the operator app: `businesses.currency` (per active business) → one hook `src/hooks/useCurrency.ts` (new — the existing `src/storefront/lib/useCurrency.ts` is storefront-scoped, bound to storefront brand, and stays separate; see §11) → formatted output everywhere. The ~50 files / 207 hardcoded `৳` occurrences (full inventory: 50 files listed in audit spot-check — largest: `OrderDetailSheet.tsx` 35, `ShiftDialog.tsx` 16, `CartPanel.tsx` 19, `posReports/*` 45 across 6 files) stop being literals.

**Design.**
- `src/lib/currency.ts` (pure, testable):
  ```ts
  export const CURRENCY_SYMBOL: Record<string, string> = { BDT: "৳", USD: "$", EUR: "€", GBP: "£", INR: "₹", MYR: "RM", SAR: "﷼", AED: "د.إ" };
  export function symbolFor(code: string): string { return CURRENCY_SYMBOL[code] ?? code; }
  export function fmtAmount(n: number, code: string): string { ...Intl.NumberFormat("en-US", {maximumFractionDigits:2})... }
  ```
- `src/hooks/useCurrency.ts`:
  ```ts
  export function useCurrency() {
    const { active } = useBusinessContext();
    const code = active?.currency || "BDT";
    return useMemo(() => ({
      code, symbol: symbolFor(code),
      fmt: (n: number) => `${symbolFor(code)}${fmtAmount(n, code)}`,
      fmtPlain: (n: number) => fmtAmount(n, code),
    }), [code]);
  }
  ```
  Fallback when no business (fresh install / loading): BDT — matches every current literal.
- **Print documents** (`src/lib/invoiceHtml.ts`, `pickupSlipHtml.ts`, `dueCollection.ts`, `orderTimeline.ts`, and `InvoiceSettingsTab.tsx` defaults like shipping presets "80/150 ৳"): these take currency as an **explicit parameter** (they render off-React or need business currency at generation time) — signature change `renderInvoice(order, settings, currency: string)`; callers pass `active.currency`. Unit tests updated accordingly (existing `src/test/invoiceHtml.test.ts` has 3 `৳` assertions — parameterize).
- **Replacement pattern** per file: `const { fmt } = useCurrency();` then `৳ {x}` → `{fmt(x)}`, `"৳"` string concat → `fmt`/`symbol`. Pure-template contexts inside `.map()` closures capture once. For components far from a business context (storefront pages keep their own hook — untouched), no change.
- Codemod-assisted but hand-reviewed: a one-off codemod (simple regex `\u09F3` adjacent to `{`) gets us 80%; the remainder (string literals like `"৳ 500 min"`, placeholders, column headers, `Intl`-adjacent logic) are manual. Full-file inventory diff review in the PR (must show 207 → 0 in operator app; storefront `src/storefront/**` and `src/test/invoiceHtml.test.ts` literals allowed to remain where they assert BDT default behavior).

**Files.** Create `src/lib/currency.ts`, `src/hooks/useCurrency.ts`; create `src/hooks/__tests__/useCurrency.test.ts`; modify all 50 files in the inventory above (exact list = the audit's grep output; canonical re-grep at implementation time: `rg -l "৳" src/ --glob '!src/storefront/**'`).

**Acceptance criteria.**
1. `rg "৳" src/ --glob '!src/storefront/**' --glob '!*.test.*'` → 0 matches (test files may keep BDT-default assertions).
2. Create business with currency USD → POS cart totals, Order detail sheet, Analytics KPIs, POS reports ledger all render `$`.
3. Switch active business (sidebar switcher) between BDT and USD businesses → all money surfaces re-render with correct symbol without reload (useBusinessContext already propagates).
4. Existing BDT business → renders identical to pre-change (screenshot-diff e2e on OrderDetailSheet + CartPanel happy path; zero visual delta expected).
5. Vitest: `symbolFor`/`fmtAmount` table tests (8 currencies + passthrough fallback for legacy codes like the `+ passthrough` Select behavior in BusinessAccountTab:221-227).

**Risks & mitigations.**
- *Largest fan-out of the plan (50 files).* Mitigation: mechanical pattern + screenshot e2e on the 4 highest-density files; PRs split by area (orders / pos / posReports / analytics+dashboard / lib+settings — 5 PRs) so review is tractable.
- *`useCurrency` in non-hook contexts* (`dueCollection.ts`, `orderTimeline.ts`, `invoiceHtml.ts` are plain libs): parameter injection, NOT hook import — prevents illegal hook usage.
- *Storefront divergence:* storefront keeps `storefront.currency` (per-storefront column, public-facing) — deliberate; documented §11.
- *Performance:* `useMemo` per component; trivial.

**Effort:** M (2 days: 0.5 codemod+hook, 1 file sweep in 5 PRs, 0.5 tests/e2e).

**Migration/rollout (Phase 2 as a whole):** pure frontend Release 2; no DB change; no session impact. Ship behind normal Vercel preview → prod. The `businesses.currency` column and its 8-value select already exist (foundation migration line 27; `BusinessAccountTab.tsx:21,219-227`) — **no schema work needed**, which is why this is M and not L.

---

## 4. W0 — Test harness (prerequisite, detailed here because everything depends on it)

**Goal.** Minimal, CI-runnable test additions for (a) RLS policy assertions, (b) Playwright auth+seed fixtures. No attempt to retrofit tests onto the whole app.

### 4.1 Files
- Create `supabase/tests/rls/_helpers.sql` — pgTAP-less assertion helpers (`assert_denied`, `assert_allowed` implemented as plpgsql DO blocks using `SET LOCAL role` / `supabase.test_helpers` if available; portable fallback: run as three throwaway users via `SET request.jwt.claims` emulation using `supabase` local CLI's `test config`).
- Create `supabase/tests/rls/user_business_access_test.sql` — the §2.1 AC battery.
- Create `supabase/tests/rls/app_settings_test.sql` — W4 battery.
- Create `package.json` scripts: `"test:rls": "supabase db reset --linked false && supabase test db"` (or `pg_prove` when pgTAP is enabled on the branch — Supabase supports enabling pgTAP extension; use `CREATE EXTENSION pgtap;` in a dev-only migration `supabase/tests/enable_pgtap.sql` applied by the harness, never in prod migrations).
- Create `playwright-fixture` additions in `playwright-fixture.ts` (exists): `authedUser(role, { businesses })` helper creating a user via `supabase.auth.signUp` against a **local Supabase branch** (not prod), seeding `user_roles` / `user_business_access` via service-role client. Playwright config already wraps a lovable base config — extend `use: { baseURL }` to point at `bun run dev` server, add `webServer` entry.

### 4.2 What already exists (do not duplicate)
- vitest: 3 spec files (`src/test/example.test.ts`, `invoiceHtml.test.ts`, `tabFilters.test.ts`), jsdom env, `src/test/setup.ts` — we only add new specs under `src/**`.
- Playwright: config + root fixture file, no `e2e/` specs yet — we create `e2e/` (first real specs in this repo, kept small and RBAC-scoped).

### 4.3 CI note
Vercel has no CI in this repo (no GitHub Actions dir). Running the harness locally is the plan's bar; wiring CI is §11-out-of-scope. RLS harness must be **idempotent** (`supabase db reset` → all 134+new migrations → run assertions → expect green).

**Effort:** M (1 day).

---

## 5. Phase 3 — P2 items

### 5.1 W3: `PermissionGuard` on `/storefronts`

**Goal.** Wrap the route exactly like its siblings (App.tsx:91-101 pattern). Storefronts management is an integrations-adjacent surface; audit §2.1 says viewer currently sees management UI.

**Files.** Modify `src/App.tsx:102` → `<Route path="/storefronts" element={<PermissionGuard permission="integrations.view"><StorefrontsPage /></PermissionGuard>} />`. Modify `src/components/AppSidebar.tsx:36-69` roles array for the storefronts entry to match `integrations.view` (verify entry exists; if sidebar item uses a `roles` prop keyed to app_role, align it).

**Decision (defensible): reuse `integrations.view`** rather than minting a new `storefronts.view` enum value — adding an enum value requires `ALTER TYPE ... ADD VALUE` (non-transactional, bootstraps carefully in replica) + permission-group UI updates + admin default-role implications. The audit itself groups storefronts under "Integrations & Stores" permissions. Cheap, reversible; if product later wants finer control, that's a P3 follow-up.

**Acceptance criteria.**
1. Viewer user navigating `/storefronts` sees the standard `DefaultFallback` "Access denied" (PermissionGuard.tsx:17-24), no fetch waterfall from StorefrontsPage.
2. Admin still sees full page (e2e both roles).
3. No other route's guard changed (diff = 1 line + sidebar roles array).

**Effort:** S (0.25d). **Rollout:** frontend-only, Release 3. Zero DB change.

### 5.2 W4: Tighten `app_settings` writes (secondary finding, §6 audit)

**Goal.** `20260429165344` policies let ANY `staff` INSERT/UPDATE `app_settings` — global stock, preorder categories bypass `settings.manage`. Tighten UPDATE/INSERT to `settings.manage`-holding users or platform admin.

**Design decision:** permission checks inside RLS must use the RPC `get_user_permissions` — but it's array-returning and SECURITY DEFINER; the cheapest safe check is a new helper mirroring `has_role`:

```sql
CREATE OR REPLACE FUNCTION public.has_permission_cached(p_user uuid, p_perm app_permission)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_perm = ANY(public.get_user_permissions(p_user));
$$;
```
(Call it `..._cached` aspirationally; actual caching is out of scope.)

**Files.** Create `supabase/migrations/20260911000300_rls_tighten_app_settings.sql`:

```sql
DROP POLICY IF EXISTS "Staff and admin can insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Staff and admin can update app_settings" ON public.app_settings;
CREATE POLICY "Settings managers can insert app_settings" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
              OR public.has_permission_cached(auth.uid(), 'settings.manage'::app_permission));
CREATE POLICY "Settings managers can update app_settings" ON public.app_settings
  FOR UPDATE TO authenticated
  USING    (public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_permission_cached(auth.uid(), 'settings.manage'::app_permission))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_permission_cached(auth.uid(), 'settings.manage'::app_permission));
-- SELECT policy ("Authenticated can read") unchanged.
```

**Rollback:** re-create the two dropped policies verbatim (from `20260429165344`).

**Risk — break inventory/preorders for staff today:** the Inventory tab (`setGlobalStockEnabled`, `stockSettings.ts`) and Pre-Orders tab write `app_settings`. If current staff users *routinely* flip these, tightening could 403 them. Mitigation: pre-deploy query (prod SQL editor): `select distinct user_id from audit_log where action like 'settings%' and ...` — list distinct writers of app_settings in last 90 days from `audit_log` (actions `settings_general` etc.); if non-admin writers exist, either grant them `settings.manage` override rows first or defer W4 to Release 3 after communicating. This is why W4 is sequenced late despite being small.

**Acceptance criteria.**
1. Staff user (no `settings.manage`) update `app_settings` → 42501.
2. Staff user WITH `settings.manage` override → allowed.
3. Admin → allowed. SELECT by any authenticated → unchanged.
4. Inventory toggle e2e as admin → green (regression).

**Effort:** S. RLS-harness battery `app_settings_test.sql`.

### 5.3 W5: Inline validation — react-hook-form + zod across settings tabs

**Goal.** Replace save-time toast validation with per-field inline errors in the settings surfaces, using already-installed `react-hook-form`, `zod`, `@hookform/resolvers`.

**Scope (concrete, priority order):**
1. `BusinessAccountTab.tsx` — zod schema: name (1–100, required), slug (`/^[a-z0-9]+(-[a-z0-9]+)*$/, 2–60`, required), currency enum (8 + passthrough regex), timezone enum, email (`z.string().email().or(z.literal(""))`), phone (optional `+`-digits regex, BD-friendly `01XXXXXXXXX` accepted), address optional. RHF `mode: "onBlur"`.
2. `CreateBusinessForm` (same file) — name + slug schemas.
3. `ProfileSettingsTab.tsx` — full name (2–100), email display (disabled — skip), new password (min 8 + complexity: letter+digit), confirm (`refine` match).
4. `BrandSettingsTab.tsx` — name, slug per-brand schema.
5. `InvoiceSettingsTab.tsx` / `PosSettingsTab` / `OrdersSettingsTab` / `MeasurementsTab` — numeric fields (margins, dimensions mm) `z.coerce.number().min(0).max(...)`.
6. `OrderSourcesTab`, `PreOrderCategoriesDialog` — light: name required.

**Pattern (house style, one example to replicate):**
```tsx
const schema = z.object({ name: z.string().min(1, "Business name is required").max(100), ... });
type Draft = z.infer<typeof schema>;
const form = useForm<Draft>({ resolver: zodResolver(schema), defaultValues, mode: "onBlur" });
// existing draft→save flow retained: handleSubmit wraps existing handleSave,
// dirty tracking switches from manual original/draft compare to form.formState.isDirty
// (drives BOTH the SaveButton disabled state and W6 guard).
```
Migration path per tab: keep existing `useState` draft architecture where forms are simple; adopt RHF only where it replaces manual compare cleanly. **Deliberate constraint: do NOT rewrite the save flows** (audit-logging, 23505 mapping, toasts on success stay untouched) — RHF owns *validation + field errors* only. This bounds blast radius per tab.

**Files.** Modify the 10 files above (exact list). Create `src/lib/settingsSchemas.ts` (shared zod schemas + `BD_PHONE` regex + `SLUG` regex) and `src/test/settingsSchemas.test.ts`.

**Acceptance criteria.**
1. Each tab: blur an invalid field → inline `<p role="alert">` under field; save button disabled until valid (or click shows error focus — pick disable pattern to match existing SaveButton disabled-while-saving idiom).
2. Duplicate slug still surfaces the DB 23505 toast (server errors remain toast-level — only *field* validation is inline; server uniqueness is not client-guessable, acceptable as toast).
3. Vitest: schema table tests — invalid name/slug/phone/email cases assert `success: false` + `issues[0].path`.
4. Zero behavior change on valid input (existing e2e flows stay green).

**Effort:** M–L (2–3d across 10 tabs, incremental PRs: 3 PRs — account+profile+brands / invoice+pos+orders+measurements / sources+preorders).

### 5.4 W6: Dirty-state guard on settings tab switch

**Goal.** Switching tabs (or navigating away) with unsaved edits prompts Discard/Keep-editing instead of silent loss (audit §7 cross-cutting: "No unsaved-changes guard"; only BusinessAccountTab partially survives).

**Design.**
- `SettingsPage.tsx` owns `activeTab`; introduce a `dirtyByTab` registry: each tab component reports dirtiness upward OR (chosen) — lift via a context `SettingsFormContext` providing `registerDirty(tabId, isDirty: boolean)`. RHF tabs write `form.formState.isDirty`; non-RHF tabs (audit log, order sources list ops are immediate-save) register `false`.
- Intercept: `handleTabChange(next)` → if `dirtyByTab[current]` show shadcn `AlertDialog` ("You have unsaved changes — Discard / Stay"). Also `beforeunload` listener when any tab dirty (crash/close protection) and a `useBlocker`-equivalent (react-router v6 `useNavigate` + `useLocation` — v6.30 has stable `useBlocker`) for in-app route navigation.
- Mobile drill-down (line 240+) back-button path goes through the same `handleTabChange`.

**Files.** Modify `src/pages/SettingsPage.tsx` (guard + registry + dialog), each W5-converted tab (register isDirty), `src/components/settings/SettingsSection.tsx` (no change needed — SaveButton already receives `disabled`), create `src/hooks/useSettingsDirty.ts` (registry hook) + unit test.

**Acceptance criteria.**
1. Playwright: edit Business Name → click Orders tab → dialog appears; "Discard" switches tab (edits lost, no toast-lie); "Stay" keeps focus and edits.
2. Same flow via browser back / URL nav to /orders → blocked (route-level).
3. Clean switch (no edits) → no dialog (assert dialog count 0 across 5 tab hops).
4. After save, tab switch is immediate (isDirty resets on successful save — verify RHF `reset` called with saved values).

**Effort:** M (1–1.5d). Depends on W5 (uses formState.isDirty; manual-dirty tabs fallback supported but goal is RHF-first).

### 5.5 W7: User Access Dialog — per-business scoping

**Goal.** The dialog (audit §3.3: permissions are platform-global; gap: per-business) gains business awareness: show the target member's `user_business_access.role` for the **active business**, allow owners/admins of that business to change that role, and gate the dialog's *availability* per active business.

**Design decisions (each defensible):**
1. **Read path:** add RPC `get_member_access(p_user uuid, p_business uuid)` returning `(business_role text, store_ids uuid[], effective_perms text[])` — SECURITY DEFINER, `REVOKE`/`GRANT EXECUTE` to authenticated, internally asserts `can_manage_business_access(p_business, auth.uid())` and raises otherwise. The dialog header shows a `Badge` with the business role next to the platform role.
2. **Write path:** new RPC `set_member_business_role(p_user uuid, p_business uuid, p_role text)` with same manager assertion + role CHECK + last-owner-lockout check (reuse `business_has_other_owner`), and audit-log insert server-side (`audit_log` via the function — the table is admin-readable; insert policy permitting service/definer writes needs verifying, else log client-side after success as house style). Wipe-and-reinsert stays for the OTHER tabs (platform perms/stores) — untouched this plan.
3. **What does NOT change:** the ~40 granular permissions, custom roles, and store-access tabs remain platform-global (that's the current product's semantics; changing *permission semantics* to per-business is a P3-scale rework — see §11). This item delivers *role display + role management + business context*, which is what the audit actually asks for ("scope the dialog per active business using `user_business_access.role`").
4. **Dialog availability:** `TeamManagement.tsx` opens the dialog only when the opener (per active business) has `can_manage_business_access` — surfaced via a `get_my_managed_businesses()` RPC returning business ids the caller manages; dialog "Business Access" tab shows a member-of list with roles, editable for managed businesses.

**Files.**
- Create `supabase/migrations/20260911000400_business_member_access_rpcs.sql` (both RPCs + grants; rollback = `DROP FUNCTION` x2).
- Modify `src/components/team/UserAccessDialog.tsx` (new "Business Access" first tab; fetch via `.rpc("get_member_access", ...)`; role change calls `.rpc("set_member_business_role", ...)`; keep 4 existing tabs).
- Modify `src/pages/TeamManagement.tsx` (pass `activeBusiness` from `useBusinessContext`; gate dialog button).

**SQL sketch (exact in implementation, shape fixed):** as above; both functions `SECURITY DEFINER SET search_path = public`, parameter validation (`p_role IN ('owner','admin','member','viewer')` via CHECK-style raise), and English error strings matching existing error surface (`"Admin access required"` style).

**Acceptance criteria.**
1. Owner of business A opens dialog for member M (platform staff, business role `viewer` in A) → sees badge "A: viewer"; changes to `member` → persists (`user_business_access` row updated; audit entry exists).
2. Non-manager staff opens dialog → Business Access tab read-only (no role select rendered) OR dialog not offered for that business — assert via e2e for staff with team.view but no manage rights.
3. Attempting `set_member_business_role` as non-manager via SQL console (as that user) → RPC raises (RLS-harness assertion).
4. Last-owner protection: sole owner demoting self → RPC error "cannot demote the last owner" (harness assertion).
5. Existing tabs (roles/overrides/stores) e2e regression green.

**Effort:** M–L (2d: 0.5 SQL, 1 UI, 0.5 tests). Depends on W1a helpers (can_manage_business_access, business_has_other_owner).

### 5.6 W8: Email change flow

**Goal.** Settings › My Profile gains "Change email": current-password re-auth → `supabase.auth.updateUser({ email })` → double-opt-in semantics per Supabase default (`Secure email change` enabled = confirmation to BOTH old and new address; session keeps old email until `EMAIL_CONFIRMED` event).

**Files.**
- Modify `src/components/settings/ProfileSettingsTab.tsx` (RHF subform from W5: new email `z.string().email()`, current password required; disabled Input showing `user.email`; success state UI: "Confirmation sent to both addresses" banner; `onAuthStateChange` `USER_UPDATED`/re-fetch updates the display).
- No DB migration. No edge function.
- Vercel/Supabase config note: verify in Supabase dashboard that "Secure email change" is ON (default) — rollout checklist item, not code.

**Behavior contract (testable).**
1. Valid password + new email → toast "Check both inboxes"; profile still shows old email.
2. Confirm link in NEW email clicked (Playwright can't read prod email — harness: use local Supabase with Mailosaur-style catch-all OR assert on `auth.getSession().user.email` after admin `updateUserById` simulating confirmation in the e2e branch) → session email updates, banner clears.
3. Wrong current password → `updateUser` returns `AuthApiError` (401/400) → inline error under password field (Supabase enforces recent-password re-auth for email change when secure change is on; if the project has it OFF, the flow degrades to single-confirm — same code path, documented).
4. Email already in use → Supabase error surfaced as toast (user_exists mapping).
5. Audit: `logChange("profile_email", ...)` with redacted values (emails are PII; log only domain? — log old→new hashed prefix; decision: log masked `a***@domain`).

**Effort:** M (1d incl. e2e plumbing for the confirmation stub).

### 5.7 W9: Optional TOTP 2FA

**Goal.** My Profile → "Two-factor authentication" section: enroll (QR + recovery codes), challenge on next sign-in, disable-with-password. Supabase Auth MFA (TOTP) is supported by `@supabase/supabase-js` 2.101 (already installed): `supabase.auth.mfa.enroll`, `.challenge`, `.verify`, `.unenroll`, `auth.signInWithPassword` returns `error: mfa_required` + `mfa_factor_id` → Login.tsx grows a code-entry step.

**Design decisions.**
1. **Flag-gated rollout:** default OFF, enabled per-project via `app_settings` row `key='totp_enabled'` (value jsonb) — but enforcement is client-side only (Supabase community tier has no server-enforced "require MFA" toggle; **server enforcement gap is documented**: RLS can factor `auth.jwt() -> 'amr'` claims for a hard requirement — we implement the RFS-lite variant: a `req_mfa` helper used by NO policies initially, shipped inert; turning enforcement on is a later, separate decision). This is honestly scoped: UI + enrollment + login challenge now; forced-enforcement later.
2. Enrollment gating: only offer when user has platform `admin` OR `team.manage` (ops leads) initially — small surface, big security win, low support burden.
3. Recovery codes: Supabase TOTP doesn't issue them; we do NOT build backup-code infra in this plan (§11) — if TOTP device is lost, admin resets via `supabase.auth.admin.unenroll` (documented runbook line in the plan).

**Files.**
- Modify `src/components/settings/ProfileSettingsTab.tsx` (2FA card: status via `mfa.getAuthenticatorAssuranceLevel`, enroll dialog with `svg` QR, verify-first-factor, factor list, disable with password re-auth → `mfa.unenroll`).
- Modify `src/pages/Login.tsx` (step 2: if `mfa_required`, show 6-digit `input-otp` (dependency present) → `mfa.challenge` + `mfa.verify`; AAL2 redirect to app).
- Create `src/lib/mfa.ts` (thin wrappers + `hasMfaPending` parse of the sign-in error) + `src/test/mfa.test.ts` (error-parse unit tests; enrollment is e2e/manual).
- DB: none. (No `app_settings` even for the flag — the flag lives client-side per user's choice; the earlier `totp_enabled` idea is downgraded: enrollment is *available* to the gated roles; whether a user enrolls is their choice. Simplest honest scope.)

**Acceptance criteria.**
1. Unit: `parseMfaError` on `mfa_required` shape extracts factor id; non-MFA errors pass through.
2. E2E (local branch): enroll → sign out → sign in with password → code step appears → valid TOTP (harness generates via `otpauth://` secret using a TOTP impl in test, e.g. `otplib` devDependency in Playwright fixture only) → dashboard.
3. Disable flow requires password; wrong password → inline error.
4. Non-enrolled user: zero UI changes on login (no step 2), profile shows "Not enabled".
5. `amr` level after verify = `aal2` (assert via `getAuthenticatorAssuranceLevel` in fixture).

**Effort:** L (3d: 1 API surface + enroll UI, 1 login challenge flow + input-otp, 1 e2e harness with TOTP generation).

**Risks.** Support burden (locked-out users) → runbook + admin unenroll path documented in plan; flag-limited audience. JWT/RLS not enforced (documented gap — not silently claimed as complete enforcement).

---

## 6. Rollout timeline (3 releases)

| Release | Contents | DB migrations | Days | Gate |
|---|---|---|---|---|
| **R1 (P0)** | W0 harness + W1a + W1b + W1c | `20260911000100` (RLS tighten) · `20260911000200` (RPC) | 1–3 | RLS battery green on branch; prod rogue-owner audit query run & clean; migration + frontend deploy in same window |
| **R2 (P1)** | W2a + W2b + W2c + W2d | none | 4–9 | screenshot e2e zero-delta for BDT; `rg ৳` = 0 outside storefront/tests |
| **R3 (P2)** | W3, W4, W5, W6, W7, W8, W9 | `20260911000300` (app_settings) · `20260911000400` (member RPCs) | 10–17 | W4 preceded by 90-day audit_log writer check; W9 behind role-gated availability |

Sequencing rules honored: DB expand → frontend contract → tighten (W1); W5 before W6; W1a before W7; R2/R3 items are independently shippable so R3 can slip without blocking P1 value.

---

## 7. Testing matrix (summary)

| Item | vitest unit | RLS harness (pgTAP-style) | Playwright e2e |
|---|---|---|---|
| W1a | — | 10 assertions §2.1 | — |
| W1b/W1c | slugify/error-map | 4 assertions | fresh-install create + dup-slug (2) |
| W2a | — | — | no-write assert + redirect nav (2) |
| W2b | snapshot invoiceHtml (existing) | — | sync-from-account button (1) |
| W2c | build/tsc only | — | — |
| W2d | currency table (new) + updated invoiceHtml | — | BDT screenshot-delta ×2, USD switch ×1 |
| W3 | — | — | viewer denied / admin ok (2) |
| W4 | — | 4 assertions | inventory toggle admin regression (1) |
| W5 | settingsSchemas (new, ~30 cases) | — | inline error on blur ×2 |
| W6 | useSettingsDirty registry | — | discard/stay/clean-switch (3) |
| W7 | — | 3 assertions | role change + non-manager gate (2) |
| W8 | email schema (in W5 set) | — | change-email happy + wrong-pass (2) |
| W9 | mfa error-parse | — | enroll → sign-in challenge → AAL2 (1 big) |

All RLS tests run on a local Supabase branch (`supabase db reset` applies all 134+new migrations — **this also validates that every historical migration replays cleanly**, a free regression check the repo currently lacks).

---

## 8. Effort summary

| Item | Size | Days |
|---|---|---|
| W0 harness | M | 1 |
| W1 P0 security | M | 2 |
| W2a general tab | S | 0.5 |
| W2b print header | S–M | 0.5–1 |
| W2c delete Stores | S | 0.25 |
| W2d currency | M | 2 |
| W3 storefronts guard | S | 0.25 |
| W4 app_settings | S | 0.5 |
| W5 RHF+zod | M–L | 2.5 |
| W6 dirty guard | M | 1.5 |
| W7 business scoping | M–L | 2 |
| W8 email change | M | 1 |
| W9 TOTP | L | 3 |
| **Total** | | **~17.5 dev-days** (1 senior, ~3.5 calendar weeks with review) |

---

## 9. Risk register (top risks, cross-cutting)

1. **W1a policy regression breaks legit flows** (e.g. a team flow we didn't trace writes `user_business_access`). Mitigation: pre-deploy prod write-source audit (`audit_log` + grep of compiled bundle for `user_business_access` writes), 10-assertion harness, same-window rollback SQL.
2. **Realtime channel visibility changes under tightened RLS** (Supabase realtime respects SELECT policy). Mitigation: explicit e2e assertion on the membership realtime refresh (`useBusinessContext.tsx:92-105`); if broken, `REPLICA IDENTITY FULL` + policy re-check.
3. **W2d fan-out regression** (50 files, money display). Mitigation: 5 area-scoped PRs, screenshot e2e on 4 highest-density surfaces, BDT zero-delta gate.
4. **W4 locks staff out of inventory toggle they use today.** Mitigation: 90-day `audit_log` writer census before shipping; grant overrides or defer.
5. **W9 support burden / lockouts.** Mitigation: admin unenroll runbook, gated audience, no forced enforcement.
6. **Policy/PG version nuance:** `ALTER TYPE ADD VALUE` avoided (W3 decision) for exactly this; `DROP POLICY IF EXISTS` idempotency matches house style; helper functions all `SET search_path` per Supabase security guidance (SECURITY DEFINER search_path hardening).

---

## 10. What must be done before what (restated hard edges)

- W0 → everything testable.
- W1a → W1b (RPC exists so W1c never needs the hole) → W1c (frontend stops client-side insert) — **single release window**.
- W1a → W7 (helpers reused).
- W2a before W2b (IA restructure once, not twice).
- W2d independent but before R3 freeze (its file sweep touches files W5/W6 will edit; land it first to avoid rebase churn).
- W5 → W6 (isDirty source).
- W8 → W9 (share re-auth dialog shell + section layout).
- W3, W4, W8 fully independent.

---

## 11. What we deliberately do NOT do in this plan

1. **No per-business permission semantics** (the ~40 granular permissions stay platform-global). Real per-business permissions = new `business_id` dimension on `user_permissions`/`custom_roles` + resolver rewrite + UI rework — a P3-scale project. W7 delivers role-per-business only.
2. **No automatic migration of `invoice_settings` business copy into `businesses`.** The "Sync from Business Account" one-way button + relabel achieves clarity without a destructive data move; the legacy sidebar fallback (`AppSidebar.tsx:92-101`) is left until business-count-zero users are extinct (post-W1b every fresh install creates a business immediately, so the fallback population only shrinks).
3. **No removal of the storefront's own currency** (`src/storefront/lib/useCurrency.ts` + `storefronts.currency` column): public storefront pricing is per-storefront by design; we only unify the operator app.
4. **No new `storefronts.view` permission enum value** — reuse `integrations.view` (avoids ALTER TYPE + admin-role-default implications).
5. **No localStorage data migration/cleanup for `omnisync-*` keys** — they become inert; browser-storage migration code would outlive its value.
6. **No forced MFA enforcement at the RLS/JWT (`amr` claim) layer** — W9 ships enrollment + login challenge; enforcement is a separate later decision with its own escape-hatchet design.
7. **No recovery/backup codes for 2FA** — admin unenroll runbook instead.
8. **No P3 items:** VAT/tax settings, notification center, bKash/Nagad/SSLCommerz gateway config, Bangla i18n, billing, webhooks UI, invite expiry, atomic wipe-and-reinsert rework in UserAccessDialog (noted non-atomic by audit — tolerated this plan).
9. **No CI pipeline setup** (no GH Actions in repo) — harness is locally-run; CI is a separate infra task.
10. **No team-manage edge function changes** — all server-side moves go through SECURITY DEFINER RPCs (atomic, no service-role secret handling in Deno for these paths, no CORS surface).
11. **No editing of historical migrations** — all fixes are new timestamped files, per house convention.

---

## 12. Assumptions

- Supabase project is on a plan/config where local CLI + branches are available for the harness; pgTAP can be enabled in dev DBs (`CREATE EXTENSION pgtap`) but **prod migrations never reference pgtap**.
- "Secure email change" + TOTP MFA are enabled in the Auth settings (dashboard toggles; checklist items, not code).
- `audit_log` insert remains client-driven for settings actions (house pattern; unchanged).
- Prod deploy = Vercel preview → production; migrations applied via Supabase dashboard/CLI before the Vercel promote for tighten-migrations, after for expand-only.
