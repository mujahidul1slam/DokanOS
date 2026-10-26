# PLAN-v2 — DokanOS Settings & Account Remediation (P0/P1/P2)

**Source of truth:** `DOKANOS-SETTINGS-AUDIT.md` (Sept 2026) · revised against `CRITIQUE-v1.md`
**Stack:** Vite + React 18 + TS + shadcn/ui SPA · Supabase (Auth/Postgres+RLS/Edge Functions/Storage) · Vercel
**Status:** PLANNING ONLY — nothing in this document is implemented.
**Scope:** Audit recommendations P0-1, P1-2/3/4, P2-5/6/7. P3 items out of scope (§11).

---

## Changes from v1 (every CRITIQUE-v1 finding → resolution)

| # | Severity | Finding (summary) | v2 resolution |
|---|---|---|---|
| 1 | BLOCKER | Rollback `.sql` sibling in `supabase/migrations/` executes as forward migration | **Fixed.** No rollback file in migrations dir, ever. Rollback SQL lives (a) as a comment block inside the forward migration and (b) mirrored at `.planning/rollbacks/*.md` (non-`.sql` extension, outside the migrations tree). §2.0. |
| 2 | MAJOR | Realtime risk built on false premise — `user_business_access` not in `supabase_realtime` publication | **Fixed.** New migration adds the table to the publication (§2.5); risk item rewritten (membership channel delivers zero events today); `REPLICA IDENTITY FULL` dropped from the remediation path; W1/W7 e2e expectations corrected. |
| 3 | MAJOR | W1b silently changes entitlement — any authenticated user can create/own businesses | **Fixed (option a).** RPC restricted to `has_role(auth.uid(),'admin')` — preserves today's semantics ("only account admins can provision"), still moves the insert server-side and atomic. Self-serve creation recorded as deferred product decision (§11.13). Error copy stays accurate (also resolves F25). |
| 4 | MAJOR | W8 misstates Supabase email-change semantics; contract #3 unimplementable | **Fixed.** Re-auth is an explicit client-side `signInWithPassword` step with its own error mapping; false "Supabase enforces re-auth" claim deleted; residual risk (session-token holder can still call `updateUser`) documented as UX-hardening, not security boundary. §5.6. |
| 5 | MAJOR | W6 promises route-level blocking impossible under `BrowserRouter` | **Fixed (option: drop the claim).** W6 scoped to in-page tab switching + mobile back + `beforeunload`. Router migration to `createBrowserRouter` is an explicit deferred item (§11.12); SPA route-navigation with a dirty tab is a documented gap, not a promise. |
| 6 | MAJOR | W0 harness: fabricated `--linked` flag, local-stack-vs-branch conflation, unproven 134-migration replay | **Fixed.** Local-stack vocabulary only (Docker Desktop on this Windows box); script is `supabase db reset` + runner that parses the DB URL from `supabase status`; new W0 step 0 "verify full-migration replay" with contingency (repair budget or schema-dump baseline); pgTAP dropped entirely (also resolves F27). §4. |
| 7 | MAJOR | "Members can write businesses" FOR ALL (member UPDATE/DELETE + cascade wipe) untouched | **Fixed.** New W1d: `businesses` writes restricted — UPDATE to platform admin or owner/admin of the business, DELETE to platform admin only; plus frontend role-gating in `BusinessAccountTab`. Exact SQL + rollback in §2.4. |
| 8 | MINOR | W2a AC unachievable (localStorage-null on existing profiles; `omnisync-` grep never 0) | **Fixed.** AC-1 scoped to the three retired keys in a fresh Playwright context; AC-4 grep scoped to exactly `omnisync-business-name\|omnisync-currency\|omnisync-timezone`. |
| 9 | MINOR | W2a/W2b ACs overlap incoherently (BusinessProfileTab still in `general` body after W2a) | **Fixed.** Relocation folded into W2a (one IA restructure); W2b is relabel + sync button only. W2a's AC is true at W2a time. |
| 10 | MINOR | W2d inventory off; `renderInvoice` doesn't exist; `dueCollection`/`orderTimeline` are persisted-content writers | **Fixed.** Numbers corrected (203/48 operator files; posReports 38/6) with canonical re-grep as the only source; real API names used (`buildInvoiceInnerHtml`, `buildPrintDocument`, …); `dueCollection`/`orderTimeline` reclassified — symbol frozen at write time, mixed-symbol history accepted and stated (§3.4). |
| 11 | MINOR | W2d AC-1 self-defeating (symbol map contains `৳`) | **Fixed.** Sweep AC excludes `src/lib/currency.ts`. |
| 12 | MINOR | W4 census query overcounts (catches localStorage-only `settings_general`) | **Fixed.** Census enumerates `settings_inventory`, `settings_preorder_categories` explicitly. |
| 13 | MINOR | W4 invents `has_permission_cached`; identical `has_permission` exists | **Fixed.** Uses `public.has_permission(auth.uid(), 'settings.manage'::app_permission)` (20260420112330:169); migration adds explicit REVOKE/GRANT for it rather than a duplicate function. |
| 14 | MINOR | W9 contradicts itself on flag storage / inert `req_mfa` helper | **Fixed.** Single design: no `app_settings` flag, no helper, no DB at all. Availability is client-side role-gated; enforcement remains a documented non-goal. |
| 15 | MINOR | W1b "RPC over edge function" argues from false premise (team-manage already holds service-role key) | **Fixed.** Rationale rewritten: single-transaction atomicity, no Deno deploy cycle, no new authenticated HTTP surface — no claim about service-role grants. |
| 16 | MINOR | W1 deploy window "before/after" ambiguous | **Fixed.** One unambiguous runbook, migration-first, six numbered steps (§2.6). |
| 17 | MINOR | TOCTOU race in `business_has_other_owner` (concurrent owner deletions → ownerless business) | **Fixed.** Helper rewritten as plpgsql VOLATILE taking `FOR UPDATE` row locks on other-owner rows; concurrent last-owner mutations deadlock-abort one side (acceptable, documented); platform-admin recovery remains the backstop. §2.1. |
| 18 | MINOR | RPC accepts unvalidated slug/currency/timezone | **Fixed.** Slug regex + length, currency allow-list, timezone allow-list validated inside the RPC with clean error codes. §2.3. |
| 19 | MINOR | E2e assumes unprovisioned infra (Docker local stack, mail catch-all, TOTP gen, fixtures) | **Fixed.** W0 enumerates prerequisites (Docker Desktop, local stack mail catcher, WebCrypto TOTP helper); ACs that go manual if the harness can't carry them are named (W8 confirmation, W9 challenge). §4, §5.6, §5.7. |
| 20 | NIT | UPDATE policy carries dead "no-op guard" | **Fixed.** Clause deleted (it was removed entirely, which also removes the `IS FALSE` construct of F21). |
| 21 | NIT | `user_id = auth.uid() IS FALSE` precedence-obscure | **Fixed.** Clause no longer exists; `IS DISTINCT FROM` used wherever the distinction is still expressed. |
| 22 | NIT | `otplib` devDep sits beside "no new heavyweight deps" | **Fixed.** No otplib — in-repo ~15-line WebCrypto TOTP test util (`src/test/totp.ts`, dev-only). |
| 23 | NIT | "snapshot" misnomer for plain expects | **Fixed.** "Existing assertions stay green." |
| 24 | NIT | `keywords` sketch uses array; real `TabDef.keywords` is `string` | **Fixed.** `keywords: "invoice header logo print brand"`. |
| 25 | NIT | Retained "only account admins" copy misleading post-W1b | **Moot.** With F3 resolved admin-only, the copy is accurate again; a neutral fallback is still added for unexpected errors. |
| 26 | NIT | Broken cross-reference "§2.1.3" | **Fixed.** v2 has no such reference; rollback rationale lives inline in §2.0. |
| 27 | NIT | `enable_pgtap.sql` has no application path | **Moot.** pgTAP dropped; harness is plain SQL `DO`-block assertions executed via the runner (§4). |

---

## 0. Guiding constraints (apply to every work item)

1. **Production, multi-user, existing data.** Every DB change is additive-first, idempotent (`DROP POLICY IF EXISTS` + `CREATE`, `IF NOT EXISTS` guards, publication-membership check via `pg_publication_tables`), carries a tested rollback, and never breaks a live session mid-request. Deploys: Vercel (SPA) + `supabase db push`.
2. **Old JS bundles are in the wild.** A cached SPA may call endpoints/policies that no longer permit its writes for days after a deploy. Rules we follow: (a) migrations land **before** the frontend that depends on them (expand-first — new RPCs exist before the UI calls them); (b) a tightening migration may break an old bundle's write with a 42501 toast only if the write is rare and non-destructive (audited per item); (c) frontend gating ships in the same release as the tightening it accompanies.
3. **Migrations are append-only** files in `supabase/migrations/` (134 existing, `YYYYMMDDHHMMSS_name.sql`). Historical migrations are never edited. **No rollback artifacts are ever placed in `supabase/migrations/`** — the Supabase CLI executes every `*.sql` there as a forward migration. Rollback SQL lives in comment blocks inside the forward file and mirrored at `.planning/rollbacks/<migration>.md` (CRITIQUE F1).
4. **House RLS idiom:** `has_role(auth.uid(),'admin'::app_role)` (20260412161413), `is_business_member(business_id)` (20260904000100), `has_permission(user, perm)` (20260420112330:169 — **reuse, don't duplicate**); helpers are `SECURITY DEFINER SET search_path = public` with `REVOKE ALL FROM PUBLIC, anon, authenticated` + targeted `GRANT EXECUTE TO authenticated`.
5. **Tests:** vitest (jsdom, existing config/glob) for units; Playwright for e2e; RLS assertions via a **plain-SQL harness** (no pgTAP) executed against the **local Supabase stack** (Docker Desktop prerequisite on this Windows box) — §4. Vocabulary note: the local CLI gives a *local stack*, not platform "branches"; this plan uses local-stack language throughout.
6. **Deps:** `react-hook-form`, `zod`, `@hookform/resolvers` already installed. New dev-only additions: `pg` (harness runner DB client). No `otplib` (in-repo WebCrypto TOTP helper instead).
7. **Router fact (verified):** `src/App.tsx:3,164` uses plain `<BrowserRouter>` + `<Routes>`. `useBlocker` requires a data router and **cannot be used** in this app today. Nothing in this plan depends on it (§11.12).

---

## 1. Dependency graph & ordering

```
Phase 0 (prep, 1–2 days)
  W0  test harness (replay verification → SQL RLS battery → Playwright local-stack fixtures)
        │
Phase 1 — P0 Security [RELEASE 1, single window, migration-first runbook §2.6]
  W1a RLS: user_business_access cannot be self-granted ──┐
  W1d RLS: businesses writes owner/admin-only (F7)       ├─ same migration batch + same Vercel release
  RT  Realtime: publication membership (F2)               │
  W1b RPC: create_business_with_owner (admin-only, F3)    │
  W1c frontend: CreateBusinessForm → RPC                  ┘
        │
Phase 2 — P1 Identity collapse [RELEASE 2, frontend-only]
  W2a General tab slim-down + BusinessProfileTab → own "printheader" tab (folded, F9)
  W2b Print Header relabel + "Sync from Business Account" button
  W2c delete pages/Stores.tsx
  W2d shared useCurrency + de-hardcode ৳ (203 occurrences / 48 operator files)
        │
Phase 3 — P2 UX & parity [RELEASE 3]
  W3  /storefronts PermissionGuard          (independent)
  W4  app_settings staff-write tightening    (independent, DB-only, census-gated)
  W5  react-hook-form + zod in settings tabs
  W6  dirty-state guard (tab switch + beforeunload; NO route-level claim, F5)
  W7  User Access Dialog per-business scoping (after W1a helpers + RT)
  W8  email change flow (correct semantics, F4)
  W9  TOTP 2FA (single design, F14; after W8 — shares re-auth pattern)
```

Critical path: **W0 → W1a → W1b → W1c → (W2d, W5, W6, W7)**. W1d/RT travel with W1a in Release 1. W2a/W2b/W2c/W3/W4/W8 parallelizable after Release 1.

Effort: S ≤ 0.5d · M ≈ 1–2d · L ≈ 3–5d.

---

## 2. W1 — P0: Close the multi-tenant escalation hole (Release 1)

### 2.0 Rollback storage policy (applies to every migration below)

- Forward files: `supabase/migrations/<ts>_<name>.sql`.
- Rollback SQL: embedded as a `/* ROLLBACK ... */` comment block at the end of the forward file, mirrored verbatim at `.planning/rollbacks/<ts>_<name>.md`.
- **Never** a `*.sql` file inside `supabase/migrations/` (F1). The repo has zero `.down.sql` files today; we keep it that way.
- Rollbacks are for broken deploys only. The W1a/W1d rollbacks re-open critical holes — running them requires the incident owner's explicit call plus reverting the matching frontend release in the same action.

### 2.1 W1a: RLS — `user_business_access` cannot be self-granted

**Goal.** No authenticated user can insert/update/delete a `user_business_access` row unless they are (a) platform `admin`, or (b) `owner`/`admin` **of the target business**, or (c) deleting **their own row to leave** (with last-owner protection). Membership is never acquired client-side.

**Root cause (verified).** `20260904000100:371-374` — policy `Users can write own access` `FOR ALL … WITH CHECK (user_id = auth.uid() OR has_role(...))` validates only the row's `user_id`.

**Files.**
- Create: `supabase/migrations/20260911000100_rls_tighten_user_business_access.sql`
- Create: `.planning/rollbacks/20260911000100_rls_tighten_user_business_access.md` (mirror only)

**Forward SQL (exact):**

```sql
-- ============================================================================
-- P0 fix: user_business_access write policies. Replaces "Users can write own
-- access" (FOR ALL, self OR admin) which let any authenticated user self-grant
-- owner on ANY business. House idiom: DROP POLICY IF EXISTS + CREATE.
-- ============================================================================

-- Caller's role in a business (NULL when not a member). SECURITY DEFINER so
-- policies on user_business_access can read it without recursion.
CREATE OR REPLACE FUNCTION public.my_business_role(p_business_id uuid, p_user uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.role FROM public.user_business_access a
  WHERE a.business_id = p_business_id AND a.user_id = p_user;
$$;
REVOKE ALL ON FUNCTION public.my_business_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_business_role(uuid, uuid) TO authenticated;

-- Can caller manage memberships of this business?
CREATE OR REPLACE FUNCTION public.can_manage_business_access(p_business_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(p_user, 'admin'::app_role)
      OR public.my_business_role(p_business_id, p_user) IN ('owner', 'admin');
$$;
REVOKE ALL ON FUNCTION public.can_manage_business_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_business_access(uuid, uuid) TO authenticated;

-- Business has at least one other owner besides p_user — WITH row lock.
-- VOLATILE (not STABLE): SELECT ... FOR UPDATE takes row locks, which is the
-- F17 TOCTOU fix — two concurrent last-owner mutations serialize; one side
-- deadlock-aborts instead of both committing an ownerless business.
CREATE OR REPLACE FUNCTION public.business_has_other_owner(p_business_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.user_business_access
   WHERE business_id = p_business_id
     AND role = 'owner'
     AND user_id IS DISTINCT FROM p_user
     FOR UPDATE;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.business_has_other_owner(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_has_other_owner(uuid, uuid) TO authenticated;

-- Immutable identity columns: user_id/business_id may never change via UPDATE.
CREATE OR REPLACE FUNCTION public.user_business_access_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'user_business_access user_id/business_id are immutable; delete and re-insert'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_uba_immutable ON public.user_business_access;
CREATE TRIGGER trg_uba_immutable BEFORE UPDATE ON public.user_business_access
  FOR EACH ROW EXECUTE FUNCTION public.user_business_access_immutable();

BEGIN;
ALTER TABLE public.user_business_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can write own access" ON public.user_business_access;
DROP POLICY IF EXISTS "Admins manage access" ON public.user_business_access;

CREATE POLICY "Users can read own access" ON public.user_business_access
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR can_manage_business_access(business_id, auth.uid())
  );

CREATE POLICY "Owners can add members" ON public.user_business_access
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR can_manage_business_access(business_id, auth.uid())
  );

-- Role elevation to owner/admin requires the caller to be an owner of that
-- business or a platform admin (F20: the v1 "no-op guard" clause is deleted).
CREATE POLICY "Owners can update member roles" ON public.user_business_access
  FOR UPDATE TO authenticated
  USING (can_manage_business_access(business_id, auth.uid()))
  WITH CHECK (
    can_manage_business_access(business_id, auth.uid())
    AND (
      role NOT IN ('owner', 'admin')
      OR public.my_business_role(business_id, auth.uid()) = 'owner'
      OR has_role(auth.uid(), 'admin'::app_role)
    )
  );

CREATE POLICY "Members can leave; owners can remove" ON public.user_business_access
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR can_manage_business_access(business_id, auth.uid())
    OR (user_id = auth.uid() AND business_has_other_owner(business_id, auth.uid()))
  );
COMMIT;
```

**Rollback (embedded comment block + `.planning/rollbacks/` mirror):**

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_uba_immutable ON public.user_business_access;
DROP FUNCTION IF EXISTS public.user_business_access_immutable();
DROP POLICY IF EXISTS "Users can read own access" ON public.user_business_access;
DROP POLICY IF EXISTS "Owners can add members" ON public.user_business_access;
DROP POLICY IF EXISTS "Owners can update member roles" ON public.user_business_access;
DROP POLICY IF EXISTS "Members can leave; owners can remove" ON public.user_business_access;
-- restore originals verbatim (20260904000100:365-374)
CREATE POLICY "Users can read own access" ON public.user_business_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can write own access" ON public.user_business_access
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
COMMIT;
-- (helpers left in place; harmless orphans)
```

**Acceptance criteria (RLS battery, §4).** Executed as different simulated users via `SET LOCAL role authenticated` + `SET LOCAL request.jwt.claims`:
1. Viewer of business A inserts own row as `owner` on arbitrary business B → **denied**.
2. Viewer of A inserts own row as `owner` on A (own business, not manager) → **denied**.
3. Owner of A inserts `{U2, A, 'member'}` → allowed. `{U2, B_other, 'owner'}` → denied.
4. Platform admin inserts any row → allowed.
5. Member deletes own row (other owners exist) → allowed.
6. Sole owner deletes own row → denied (last-owner lockout).
7. Concurrent double last-owner delete (two sessions, manual harness step) → at most one commits; other aborts (deadlock or lock wait) → business retains ≥1 owner.
8. Business-admin updates member `viewer`→`owner` → denied; owner updates same → allowed; either updates `owner`→`member` → allowed for owner.
9. UPDATE changing `user_id` or `business_id` → trigger `check_violation`.
10. Plain member SELECT own rows + `useBusinessContext.refresh()` read path → identical results pre/post (regression).

**Risks.**
- *In-flight membership writes during deploy fail with 42501* — only current client-side writer is `CreateBusinessForm`, replaced by W1c in the same release (§2.6). Old cached bundles that still attempt the client-side insert see an error toast; acceptable (rare, non-destructive, self-heals on refresh).
- *Realtime membership channel:* **today it silently delivers zero events** — `user_business_access` was never added to the `supabase_realtime` publication (only `stores`/`orders`/`courier_shipments` — `20260903000500:6-8`). The existing subscription in `useBusinessContext.tsx:94-105` is already dead; no RLS change can make it worse. Fixed additively by §2.5; e2e asserts events flow *after* that migration. `REPLICA IDENTITY FULL` is **not** part of the remediation (wrong lever — it changes WAL payload shape, not publication membership).

**Effort:** M.

### 2.2 W1d: RLS — `businesses` writes owner/admin-only (CRITIQUE F7)

**Goal.** After W1a, a legitimately-invited `viewer`/`member` could still UPDATE the `businesses` row and **DELETE** it (cascade-wiping brands, locations, selling_points, connectors, product_sources, customer_sources, suppliers, purchase_orders — 8 `ON DELETE CASCADE` children, `20260904000100:77-275`). Close it.

**Files.**
- Create: `supabase/migrations/20260911000120_rls_tighten_businesses.sql`
- Create: `.planning/rollbacks/20260911000120_rls_tighten_businesses.md`

**Forward SQL (exact):**

```sql
-- ============================================================================
-- P0 fix: "Members can write businesses" (FOR ALL, any member) let ANY member
-- — including viewer — UPDATE and cascade-DELETE the businesses row.
-- SELECT stays member-wide; UPDATE owner/admin-of-business; DELETE admin-only.
-- ============================================================================
BEGIN;
DROP POLICY IF EXISTS "Members can write businesses" ON public.businesses;

CREATE POLICY "Members can read businesses" ON public.businesses
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id));

-- Direct INSERT: platform admin only (new businesses have no members yet).
-- Admin RPC path (W1b) is SECURITY DEFINER and unaffected.
CREATE POLICY "Admins can insert businesses" ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Owners can update businesses" ON public.businesses
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)
         OR can_manage_business_access(id, auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role)
              OR can_manage_business_access(id, auth.uid()));

-- Business deletion cascade-wipes 8 child tables: platform admin only.
CREATE POLICY "Admins can delete businesses" ON public.businesses
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
COMMIT;
```

**Rollback (embedded):** `DROP POLICY` the four above; re-create `Members can write businesses` FOR ALL verbatim (`20260904000100:358-361`).

**Frontend consequence (same release).** `BusinessAccountTab.handleSave` (`BusinessAccountTab.tsx:107-140`) currently lets any member save. Modify `src/components/settings/BusinessAccountTab.tsx`: derive `myRole` for the active business from `useBusinessContext`'s own access rows (own-row SELECT stays readable); when `myRole` is `member`/`viewer` (and caller not platform admin): fields read-only, SaveButton disabled, hint "Business details are managed by the business owner or an admin." Old cached bundles: a member saving post-migration gets a 42501 toast — rare, non-destructive, accepted per §0.2.

**Acceptance criteria (RLS battery + e2e).**
1. Member of A UPDATE businesses A → **denied**; owner of A → allowed; platform admin → allowed.
2. Member or owner DELETE businesses A → **denied**; platform admin → allowed.
3. Any member SELECT businesses A → unchanged (regression).
4. Owner edits name/currency via Business Account tab e2e → persists + audit log row.
5. Viewer e2e: fields disabled, no save button, hint visible.

**Effort:** M (0.5 SQL + 0.5 frontend gating).

### 2.3 W1b: `create_business_with_owner` RPC — admin-only, validated (CRITIQUE F3, F15, F18)

**Goal.** Business creation moves server-side and atomic (business + founder-owner row in one transaction) while **preserving today's entitlement**: only platform admins create businesses (current `businesses` INSERT policy already blocks non-admins — `is_business_member(new_id)` is necessarily false on insert; the UI copy "only account admins can provision new businesses" at `BusinessAccountTab.tsx:298` states the product's semantics). Self-serve creation is a separate, signed-off product decision (§11.13), not something smuggled into a security fix.

**Files.**
- Create: `supabase/migrations/20260911000130_create_business_with_owner.sql`
- Create: `.planning/rollbacks/20260911000130_create_business_with_owner.md`

**Forward SQL (exact):**

```sql
-- Atomic business + founder-owner row. SECURITY DEFINER so the caller needs
-- no direct INSERT rights on user_business_access (removed by W1a) — and no
-- direct businesses INSERT right (admin-only since W1d).
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
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_role(v_user, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'business name is required' USING ERRCODE = '23502';
  END IF;
  -- F18: server-side validation — the RPC is callable by any authenticated
  -- client directly; never trust the frontend slugifier.
  IF p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(p_slug) < 2 OR length(p_slug) > 60 THEN
    RAISE EXCEPTION 'slug must be 2-60 chars: lowercase letters, digits, single dashes'
      USING ERRCODE = '23514';
  END IF;
  IF p_currency NOT IN ('BDT','USD','EUR','GBP','INR','MYR','SAR','AED') THEN
    RAISE EXCEPTION 'unsupported currency: %', p_currency USING ERRCODE = '23514';
  END IF;
  IF p_timezone NOT IN ('Asia/Dhaka', 'UTC') THEN  -- full list mirrors BusinessAccountTab TIMEZONES at implementation
    RAISE EXCEPTION 'unsupported timezone: %', p_timezone USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.businesses (name, slug, logo_url, currency, timezone)
  VALUES (btrim(p_name), p_slug, p_logo_url, p_currency, p_timezone)
  RETURNING * INTO v_business;

  INSERT INTO public.user_business_access (user_id, business_id, role)
  VALUES (v_user, v_business.id, 'owner');

  RETURN v_business;
END $$;
REVOKE ALL ON FUNCTION public.create_business_with_owner(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(text, text, text, text, text) TO authenticated;
```

**Why RPC over edge function (F15, corrected):** single-transaction atomicity on the DB (business+access commit or roll back together — the partial failure state the current two-step flow toasts about at `BusinessAccountTab.tsx:313-317`), no Deno deploy cycle, no new authenticated HTTP surface. (`team-manage` already runs a service-role client, so privilege was never the differentiator.)

**Rollback (embedded):** `DROP FUNCTION IF EXISTS public.create_business_with_owner(text, text, text, text, text);`

**Acceptance criteria.**
1. Platform admin calls RPC → business + owner row created atomically; pre-seeded slug collision → `23505` propagates, **no** orphan access row (service-role count in harness).
2. Non-admin authenticated call → clean `42501 'Admin access required'`.
3. Anon call → denied.
4. Empty name, bad slug (`"My Slug!!"`), bad currency (`XYZ`) → clean `23502`/`23514` errors, no partial writes.

**Effort:** S.

### 2.4 W1c: Frontend — `CreateBusinessForm` uses the RPC

**Goal.** Replace the two-step client-side insert (`BusinessAccountTab.tsx:288-317`) with one `supabase.rpc("create_business_with_owner", ...)` call.

**Files.** Modify `src/components/settings/BusinessAccountTab.tsx` (only `CreateBusinessForm`, lines 269–325).

**Changes.**
- `handleCreate`: keep client-side slugify + validation; call the RPC with `{ p_name, p_slug }`; map `23505` → "That slug is already taken"; map `42501 'Admin access required'` → the existing copy "only account admins can provision new businesses" (**now accurate** — F25); any other error → neutral "Could not create the business — please try again" (new generic fallback).
- Delete the dead second `supabase.auth.getUser()` round-trip (old lines 302–307).
- On success: `logChange("business_account", data.id, null, {...}, undefined, { action: "create" })` + `await refresh()` exactly as today (lines 319–321).

**Acceptance criteria.**
1. Admin e2e (local stack, seeded fixture): Settings → Business Account → create "Test Biz" → switcher shows it, one owner row for the admin, toast success.
2. Duplicate slug → friendly 23505 toast, no business row.
3. Staff (non-admin) e2e: attempt create → "only account admins…" message; **no** client-side `user_business_access` write attempted.
4. `grep -r "user_business_access" src/` → only `useBusinessContext.tsx` (read path).

**Effort:** S.

### 2.5 RT: Realtime publication membership (CRITIQUE F2)

**Goal.** The `useBusinessContext` membership subscription (`useBusinessContext.tsx:94-105`) currently delivers **zero events** — the table was never added to `supabase_realtime`. Add it so membership changes (own-row inserts via invite RPCs later, W7 role changes) propagate live.

**Files.** Create: `supabase/migrations/20260911000110_realtime_user_business_access.sql` (no rollback needed — additive; mirror notes the `DROP ... FROM PUBLICATION` inverse at `.planning/rollbacks/`).

**Forward SQL (exact):**

```sql
-- user_business_access was never in the realtime publication; the frontend's
-- postgres_changes subscription on it has silently delivered nothing. Additive,
-- idempotent (ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_business_access'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_business_access';
  END IF;
END $$;
```

**Notes.**
- Realtime respects the SELECT policy: users see own-row events and events for rows they can read (managers); others are filtered — expected and fine for this channel.
- No `REPLICA IDENTITY` change: the table's events of interest are INSERT/UPDATE (new row is delivered). DELETE visibility for non-managers is not a requirement.
- W7's `set_member_business_role` will now actually propagate to the affected member's client (v1 claimed this without the publication fix).

**Acceptance criteria.**
1. Harness: after all migrations, `select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='user_business_access'` = 1; running the migration twice does not error (idempotency).
2. E2e (local stack, §4): member client's `useBusinessContext` receives a membership INSERT event within 5s of the harness inserting the row via SQL — **this assertion only becomes runnable after this migration; it fails on main today, which is the bug being fixed**.

**Effort:** S (0.25d).

### 2.6 Release 1 runbook (unambiguous, F16)

1. **Pre-deploy audit (prod SQL editor, read-only):**
   `select business_id, user_id, role from user_business_access where role='owner' and user_id not in (select user_id from user_roles where role='admin');`
   Investigate anything suspicious (possible prior abuse of the hole) before proceeding. Gate: reviewed, rogue rows removed if any.
2. **Push migrations** in order: `…00100` (uba policies) → `…00110` (publication) → `…00120` (businesses) → `…00130` (RPC). `supabase db push`, migration **first** — every new RPC/policy the frontend depends on exists before any bundle references it; the tightened policies break only the old bundle's rare client-side writes (42501 toast, accepted §0.2).
3. **Verify in SQL editor:** run the RLS battery's prod-safe spot-checks (a SELECT-policy read as a normal member; one `create_business_with_owner` attempt as admin on a throwaway slug, then delete it).
4. **Vercel promote** the Release-1 frontend (W1c + W1d gating).
5. **Post-deploy smoke (prod, admin account):** create a throwaway business via the form → switcher + owner row verified → delete it (admin DELETE now the only path — also smoke-tests W1d).
6. **Rollback (if broken):** run the embedded rollback blocks from `.planning/rollbacks/*.md` via SQL editor **and** Vercel-rollback the frontend in the same action. Never introduce a rollback file into `supabase/migrations/` (F1).

**Release-1 testing summary.** RLS battery: W1a AC-1..10 + W1d AC-1..3 + W1b AC-1..4 + RT AC-1 (§4). Vitest: `slugify` + RPC-error-mapping helper (`src/lib/businessHelpers.ts`, new). Playwright (local stack): admin create-business happy path, duplicate slug, staff-denied, viewer read-only gating, realtime membership event (RT AC-2).

**Release-1 risks.**
- Rogue historical rows from prior exploitation → step 1 gate + manual cleanup.
- Realtime publication add slightly increases WAL volume → negligible (small table).
- `FOR UPDATE` helper may deadlock-abort a genuinely concurrent double-owner-exit → one user sees a transient error, retries; platform admin can always repair membership (documented; accepted, F17).

---

## 3. Phase 2 — P1: Collapse business identity (Release 2, frontend-only)

### 3.1 W2a: General tab slim-down + Print Header relocation (folded, F8/F9)

**Goal.** Kill the lying `omnisync-*` localStorage surface (`SettingsPage.tsx:117-134`), keep the General tab as theme + PWA install only, **and in the same work item** move `BusinessProfileTab` out of the `general` case-branch (`SettingsPage.tsx:181`) into its own `printheader` tab — one IA restructure, W2a's AC true at W2a time.

**Files.**
- Modify `src/pages/SettingsPage.tsx`: remove state lines 117–120 + `handleSaveGeneral` 122–134; General card keeps theme + `InstallAppButton`; add compact "Business basics" redirect card (name/currency/timezone rows reading **live** values from `useBusinessContext().active`, one Button → `setActiveTab("account")`); add `printheader` TabDef `{ id: "printheader", label: "Print Header", icon: Printer, description: "Business name/logo/contact on invoices", keywords: "invoice header logo print brand" }` (single string — real `TabDef` shape, F24); move `<BusinessProfileTab />` from `general` branch to `printheader` branch; mirror both branches in the mobile drill-down path (line 240+).

**Acceptance criteria.**
1. Fresh Playwright context (F8): visit Settings, interact with General → `omnisync-business-name`, `omnisync-currency`, `omnisync-timezone` all remain `null`.
2. General tab renders theme + install + redirect card only (no Business Profile card — moved in this item).
3. Redirect card click → `account` tab, desktop + mobile.
4. Settings search "currency" → Business Account hit; General not matched.
5. `rg "omnisync-business-name|omnisync-currency|omnisync-timezone" src/` → 0 (scoped to the three retired keys only, F8 — other `omnisync-*` keys like `omnisync-global-stock` are untouched and remain legitimate).

**Effort:** M (0.5–1d).

### 3.2 W2b: Print Header relabel + "Sync from Business Account"

**Goal.** `BusinessProfileTab` explicitly becomes print copy — labeled "Invoice & Print Header" — with a one-way explicit sync button; resolves the three-copies-of-truth confusion without risky data migration.

**Files.** Modify `src/components/settings/BusinessProfileTab.tsx`: retitle inner `SettingsSection` to "Invoice & Print Header" with description "Name, logo and contact block printed on invoices and pickup slips. This is print copy — your business account details live in Business Account."; add "Sync from Business Account" Button copying `businesses.name/logo_url/address/phone/email` → draft fields (one-way, explicit, toasted); same `invoice_settings` read/write + audit diffs otherwise.

**Acceptance criteria.**
1. Search "print header"/"invoice logo" → `printheader` tab.
2. Sync button fills all five draft fields from `useBusinessContext().active`; save persists to `invoice_settings`; audit diff present.
3. Existing `src/test/invoiceHtml.test.ts` assertions stay green (F23: plain expects, not snapshots; no behavior change).

**Effort:** S. Sidebar legacy fallback (`AppSidebar.tsx:92-101`) untouched this plan (§11.2).

### 3.3 W2c: Delete dead `pages/Stores.tsx`

306 lines of dead code; verified zero imports of `pages/Stores` (App.tsx imports `StoresHub`). Delete `src/pages/Stores.tsx`; re-run `rg -n "pages/Stores\b" src/` → 0; `bun run build` + `tsc -b` clean; `/stores` route unaffected. **Effort:** S (0.25d).

### 3.4 W2d: Single currency source — shared `useCurrency` + de-hardcode ৳

**Goal.** One currency pipeline for the operator app: `businesses.currency` → `src/hooks/useCurrency.ts` → formatted output. Verified inventory at critique time: **203 `৳` occurrences across 48 operator-app files** (posReports: 38 across 6 files; largest single files: `OrderDetailSheet.tsx` 35, `CartPanel.tsx` 19, `ShiftDialog.tsx` 16; plus 3 in `src/test/invoiceHtml.test.ts` and 1 storefront file — out of scope). **The canonical source is the re-grep at implementation time:** `rg -c "৳" src/ --glob '!src/storefront/**'` — numbers above are the review-time snapshot, not a contract (F10).

**Design.**
- `src/lib/currency.ts` (pure): `CURRENCY_SYMBOL` map (BDT ৳, USD $, EUR €, GBP £, INR ₹, MYR RM, SAR ﷼, AED د.إ), `symbolFor(code)`, `fmtAmount(n, code)` via `Intl.NumberFormat`.
- `src/hooks/useCurrency.ts`: derives `code` from `useBusinessContext().active?.currency ?? "BDT"`; returns `{ code, symbol, fmt, fmtPlain }`; `useMemo` on `code`. No-business fallback = BDT, matching every current literal.
- **Print/HTML builders — real API names (F10):** `src/lib/invoiceHtml.ts` `buildInvoiceInnerHtml(data, tpl, biz, date)` (line 41), `buildInvoiceCss`, `buildInvoicePrintDocument`; `src/lib/pickupSlipHtml.ts` `buildPrintDocument`. Add an explicit `currency: string` parameter (do not hook-import — these run off-React); callers pass `active.currency`. Existing `invoiceHtml.test.ts` `৳` assertions parameterized (BDT default stays asserted).
- **Persisted-content writers (reclassified, F10):** `src/lib/dueCollection.ts:60,62` (payment descriptions) and `src/lib/orderTimeline.ts:58,66` (timeline strings) write **rows to the DB**, they are not print documents. Decision: symbol is **frozen at write time** — historical rows keep whatever symbol they were written with (`৳…`); new rows use the active business symbol (`$…`). Mixed-symbol history is accepted and stated; no backfill migration (§11.5 family).
- Replacement pattern: `const { fmt } = useCurrency();` → `{fmt(x)}`; codemod regex gets ~80% (``৳` adjacent to `{`); string literals ("৳ 500 min", placeholders, column headers) manual. Storefront (`src/storefront/**`) keeps its own `storefronts.currency`-bound hook — untouched (§11.3).
- PR slicing: 5 area PRs (orders / pos / posReports / analytics+dashboard / lib+settings).

**Acceptance criteria.**
1. `rg "৳" src/ --glob '!src/storefront/**' --glob '!*.test.*' --glob '!src/lib/currency.ts'` → **0** (symbol map itself exempt — F11).
2. USD business: POS cart totals, OrderDetailSheet, Analytics KPIs, POS reports ledger render `$`.
3. Switch active business BDT↔USD → all money surfaces re-render without reload.
4. BDT business renders byte-identical to pre-change (screenshot-diff e2e on OrderDetailSheet + CartPanel happy paths, zero delta).
5. Vitest: `symbolFor`/`fmtAmount` table tests (8 currencies + legacy-code passthrough matching the BusinessAccountTab select passthrough).

**Risks.** 48-file fan-out → area PRs + screenshot gate; non-hook lib misuse → parameter injection only; persisted-string history → frozen-at-write decision above (explicit, not accidental).

**Effort:** M (2d).

---

## 4. W0 — Test harness (local stack; CRITIQUE F6, F19, F27)

**Goal.** Minimal, runnable test additions: (a) SQL RLS battery, (b) Playwright auth+seed fixtures against the **local Supabase stack**. No pgTAP. No platform "branches" — the local CLI's local stack (Docker Desktop prerequisite on this Windows dev box) is the environment, full stop.

### 4.1 Step 0 — migration replay verification (new, F6)

`supabase start && supabase db reset` on a fresh local DB replays all 134 + new migrations. **This has never been demonstrated in this repo** (lovable-era + hand-written migrations embed live-data backfills, e.g. `20260904000100` DO block lines 447–612). W0 begins by running it and recording the result:
- **Clean replay:** harness proceeds; replay becomes a standing regression check on every `db reset`.
- **Replay fails anywhere:** choose (i) budget up to 2 days to repair/`IF EXISTS`-guard the offending historical migration **in a new migration file or config** (never editing history — if in-place repair is impossible, fall back to (ii)); or (ii) **schema-dump baseline**: `supabase db dump` (schema-only, from the linked prod after its next successful push) restored into the local DB as the harness baseline. Harness then tests policies against a schema-equivalent DB; the replay defect is recorded as tracked debt. The RLS battery is runnable either way; only its baseline provenance changes.

### 4.2 RLS battery — plain SQL, no pgTAP (F27)

**Files.**
- Create `supabase/tests/rls/_session.sql` — helper pattern: each test wraps its body as
  ```sql
  BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims TO '{"sub":"<fixture-user-uuid>","role":"authenticated"}';
  -- statements; assertion:
  DO $$ BEGIN
    IF NOT <expected> THEN RAISE EXCEPTION 'FAIL: <test name>'; END IF;
  END $$;
  ROLLBACK;
  ```
  (auth.uid() reads `request.jwt.claims`; this is the standard local RLS-testing technique — no pgTAP, no extension enable step, no undefined application path.)
- Create `supabase/tests/rls/user_business_access_test.sql` (§2.1 AC-1..10), `businesses_test.sql` (§2.2 AC-1..3), `create_business_with_owner_test.sql` (§2.3), `realtime_test.sql` (§2.5 AC-1), `app_settings_test.sql` (W4), `member_access_rpc_test.sql` (W7).
- Create `scripts/run-rls-tests.mjs` — Node runner: shells `supabase status`, extracts the `postgres://…` connection string, connects with `pg` (**new devDependency**, small, dev-only), executes each test file in filename order, fails on the first SQLSTATE error, prints `PASS/FAIL <file>` summary. Exit code non-zero on any failure.
- `package.json`: `"test:rls": "supabase db reset && node scripts/run-rls-tests.mjs"` (no fabricated flags; reset applies migrations, runner applies nothing).

Fixture users (fixed UUIDs) + their `user_roles`/`user_business_access` rows are seeded by the runner itself before tests (idempotent `INSERT ... ON CONFLICT DO NOTHING` against the local DB), so the battery is self-contained.

### 4.3 Playwright (local stack) — prerequisites & honest scope (F19)

**Prerequisites, enumerated:** Docker Desktop running the local stack; `supabase status` healthy; `bun run dev` serving the app with env vars pointed at the **local** Supabase URL/anon key (Playwright `webServer` passes them); local stack's built-in mail catcher (InBucket/Mailpit on `:54324`) for W8. If any prerequisite is unavailable on a given day, the affected e2e specs degrade to **manual runbooks** — named per item below, not silently dropped.

**Files.** Extend `playwright-fixture.ts` (exists): `authedPage(userKey)` fixture — signs up/signs-in a seeded fixture user against the local stack, stores storageState; role/business seeding happens in the RLS runner seed (shared fixture UUIDs). Add `webServer` (`bun run dev`) + `use.baseURL`. **Assumption to verify in implementation (critique could not):** whether the `lovable-agent-playwright-config` wrapper passes `webServer`/`baseURL` through — if not, replace the wrapper with a direct Playwright config (small, isolated change; no product code touched).

**ACs that become manual if the harness can't carry them:** W8 email-confirmation click-through (manual runbook: read catcher inbox, click, verify session email), W9 TOTP challenge e2e (manual runbook with the WebCrypto helper). RLS battery is never manual — it is the Release-1 gate.

**Effort:** M–L (1–2d, plus up to 2d replay contingency from §4.1).

---

## 5. Phase 3 — P2 items (Release 3)

### 5.1 W3: `PermissionGuard` on `/storefronts`

Wrap the route like its siblings: `src/App.tsx:102` → `<Route path="/storefronts" element={<PermissionGuard permission="integrations.view"><StorefrontsPage /></PermissionGuard>} />`; align the sidebar entry's roles (`AppSidebar.tsx:36-69`) to `integrations.view`. Reuses the existing permission (no `ALTER TYPE` — §11.4). AC: viewer → `DefaultFallback` "Access denied" (PermissionGuard.tsx:17-24), admin → full page, diff = 1 line + sidebar array. **Effort:** S.

### 5.2 W4: Tighten `app_settings` writes

**Goal.** `20260429165344` policies let any `staff` INSERT/UPDATE `app_settings` (global stock, preorder categories) bypassing `settings.manage`. Tighten to `settings.manage` holders or platform admin — using the **existing** `public.has_permission(_user_id uuid, _permission app_permission)` SECURITY DEFINER function (`20260420112330:169`), not a new helper (F13).

**Files.**
- Create: `supabase/migrations/20260911000400_rls_tighten_app_settings.sql` (+ `.planning/rollbacks/` mirror)
- Create: `supabase/tests/rls/app_settings_test.sql` (battery)

```sql
BEGIN;
-- Explicit grant-state normalization for the existing helper (F13): its
-- EXECUTE grants were never swept; policies depend on authenticated EXECUTE.
REVOKE ALL ON FUNCTION public.has_permission(uuid, app_permission) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, app_permission) TO authenticated;

DROP POLICY IF EXISTS "Staff and admin can insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Staff and admin can update app_settings" ON public.app_settings;

CREATE POLICY "Settings managers can insert app_settings" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
              OR public.has_permission(auth.uid(), 'settings.manage'::app_permission));
CREATE POLICY "Settings managers can update app_settings" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_permission(auth.uid(), 'settings.manage'::app_permission))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
              OR public.has_permission(auth.uid(), 'settings.manage'::app_permission));
-- SELECT policy ("Authenticated can read") unchanged.
COMMIT;
```

**Census (pre-deploy, prod, corrected per F12):** `select distinct user_id from audit_log where action in ('settings_inventory','settings_preorder_categories') and created_at > now() - interval '90 days';` — only these two actions write `app_settings` (`settings_general` is localStorage-only and must not be counted). If non-admin writers exist: grant `settings.manage` overrides first, or defer W4 with notice.

**Rollback:** DROP the two new policies; re-create the two originals verbatim from `20260429165344`.

**AC (battery + e2e).** Staff without `settings.manage` update → 42501; staff WITH override → allowed; admin → allowed; any-authenticated SELECT unchanged; admin inventory-toggle e2e green. Old-bundle staff writes toast-fail post-migration (rare, census-verified, accepted). **Effort:** S.

### 5.3 W5: Inline validation — react-hook-form + zod across settings tabs

Unchanged from v1 in substance. Scope order: (1) `BusinessAccountTab.tsx` (name 1–100, slug regex `^[a-z0-9]+(-[a-z0-9]+)*$` 2–60, currency enum+passthrough, timezone enum, email, BD-friendly phone), (2) `CreateBusinessForm`, (3) `ProfileSettingsTab.tsx` (name 2–100, password min-8 letter+digit, confirm `refine`), (4) `BrandSettingsTab.tsx`, (5) `InvoiceSettingsTab`/`PosSettingsTab`/`OrdersSettingsTab`/`MeasurementsTab` (`z.coerce.number()` ranges), (6) `OrderSourcesTab`/`PreOrderCategoriesDialog` (name required).

Pattern: shared `src/lib/settingsSchemas.ts` (`+ SLUG/BD_PHONE` regexes, `src/test/settingsSchemas.test.ts`); per-tab `useForm` + `zodResolver`, `mode:"onBlur"`; **RHF owns validation + field errors only — save flows (audit logging, 23505 mapping, toasts) untouched**; `form.formState.isDirty` becomes the single dirtiness source (drives SaveButton disabled + W6). Server errors stay toasts. 3 incremental PRs. AC: inline `<p role="alert">` on blur; valid-input behavior unchanged (existing flows green); schema table tests. **Effort:** M–L (2–3d).

### 5.4 W6: Dirty-state guard — scoped honestly (F5)

**Goal.** Switching settings tabs (or closing/reloading) with unsaved edits prompts Discard/Stay instead of silent loss.

**Scope (explicit):** in-page tab switch (desktop + mobile drill-down back path, both via `handleTabChange`) + `beforeunload` (close/reload). **NOT in scope:** SPA route navigation away from `/settings` — `useBlocker` requires a data router and this app uses `<BrowserRouter>` (App.tsx:164); the router migration is deliberately deferred (§11.12). A dirty-tab user who navigates to `/orders` loses edits silently — **documented gap**, visible in the tab-UI only.

**Design.** `SettingsFormContext` providing `registerDirty(tabId, isDirty)`; RHF tabs report `formState.isDirty`; immediate-save tabs register `false`. `handleTabChange(next)` → if dirty, shadcn `AlertDialog` "You have unsaved changes — Discard / Stay". `beforeunload` listener active while any tab dirty. Save success → `reset(savedValues)` clears dirty. Mobile back-button path routes through the same guard. Files: `src/pages/SettingsPage.tsx`, W5-converted tabs, `src/hooks/useSettingsDirty.ts` (+ unit test).

**AC.** (1) Playwright: edit Business Name → click Orders tab → dialog; Discard switches (edits gone, no toast-lie); Stay keeps edits. (2) Clean switch across 5 tab hops → dialog count 0. (3) After save → immediate switch, no dialog. (4) Dirty + reload attempt → `beforeunload` dialog (Playwright `page.on('dialog')`). ~~Route-level blocking~~ removed (F5). **Effort:** M (1–1.5d). Depends: W5.

### 5.5 W7: User Access Dialog — per-business scoping

Unchanged in substance from v1; corrections: role changes now actually propagate (RT §2.5 made the publication fix — v1 assumed it). Design: RPC `get_member_access(p_user, p_business)` → `(business_role, store_ids, effective_perms)`, RPC `set_member_business_role(p_user, p_business, p_role)` — both SECURITY DEFINER, `REVOKE`/`GRANT` house pattern, internal `can_manage_business_access` assertion, role allow-list, last-owner protection via `business_has_other_owner` (now lock-protected, F17), audit insert server-side (fallback client-side `logChange` if the `audit_log` insert policy blocks definer writes — verify in harness). Platform permissions/stores tabs remain platform-global (§11.1). Dialog availability gated by `can_manage_business_access` for the active business (surfaced via `get_my_managed_businesses()` RPC).

**Files.** Create `supabase/migrations/20260911000500_business_member_access_rpcs.sql` (+ rollback mirror = two `DROP FUNCTION`s); modify `src/components/team/UserAccessDialog.tsx` (new "Business Access" first tab), `src/pages/TeamManagement.tsx` (pass active business, gate button).

**AC.** (1) Owner of A opens dialog for member M → badge "A: viewer"; change to `member` → persists + audit row + **the affected member's client reflects the change within 5s via realtime** (works because of §2.5; refresh-fallback assertion if the local stack's realtime is flaky). (2) Non-manager staff → Business Access tab read-only. (3) Harness: `set_member_business_role` as non-manager → RPC raises. (4) Sole-owner self-demotion → RPC error "cannot demote the last owner" (harness). (5) Existing tabs e2e regression green. **Effort:** M–L (2d). Depends: W1a helpers, RT.

### 5.6 W8: Email change flow — correct Supabase semantics (F4)

**Goal.** My Profile → "Change email": explicit client-side re-auth → `updateUser({ email })` → double-opt-in per project config.

**Corrected behavior contract:**
- `supabase.auth.updateUser({ email })` takes **no password and performs no verification**; the dashboard "Secure email change" toggle only controls whether **both** addresses receive confirmation emails vs. only the new one. The re-auth below is therefore a **client-side UX hardening step, not a security boundary** — any holder of the live session token could still call `updateUser`. Residual risk documented, accepted.
- Step 1 (re-auth, explicit): `supabase.auth.signInWithPassword({ email: currentEmail, password })`. Wrong password → its own error → inline "Current password is incorrect" under the password field (**this is contract #3, now implementable — the failure belongs to `signInWithPassword`, not `updateUser`**).
- Step 2: `updateUser({ email: newEmail })` → toast "Check both inboxes" (verify the dashboard toggle at rollout — if OFF, single-confirm semantics; same code path, banner copy adapts).
- Confirmation: e2e on the local stack reads the built-in mail catcher (:54324) API and clicks the confirm link; **if the catcher's API shape is unusable, this AC becomes a manual runbook** (stated up front, F19). Session email updates on `USER_UPDATED`.
- Email-in-use error → toast. Audit: `logChange("profile_email", …)` with masked `a***@domain` values (PII).

**Files.** Modify `src/components/settings/ProfileSettingsTab.tsx` (RHF subform from W5: new email + current password; disabled display of current email; success banner; `onAuthStateChange` refresh). No DB migration, no edge function.

**AC.** (1) Happy: valid password+email → toast; profile still shows old email until confirmation. (2) Confirmation (e2e-or-manual as scoped) → session email updates, banner clears. (3) Wrong current password → inline error (vitest unit on the handler with mocked client + Playwright). (4) Email-in-use → toast. (5) Audit row masked. **Effort:** M (1d).

### 5.7 W9: Optional TOTP 2FA — one design, no contradictions (F14, F19, F22)

**Goal.** My Profile → 2FA section: enroll (QR + verify), challenge on next sign-in, disable-with-re-auth. Supabase Auth MFA via `@supabase/supramab-js` — `auth.mfa.enroll/.challenge/.verify/.unenroll`; `signInWithPassword` returns `mfa_required` → Login.tsx grows a 6-digit `input-otp` step.

**Single design (F14):** **no `app_settings` flag, no `req_mfa` helper, no DB at all.** Enrollment is offered client-side to users holding platform `admin` or `team.manage` (small audience, low support burden); enforcement (RLS/JWT `amr`) remains a documented non-goal (§11.6).

**TOTP in tests (F22):** in-repo `src/test/totp.ts` — ~15-line WebCrypto HMAC-SHA1 RFC-6238 generator, dev-only, no `otplib`.

**Files.** Modify `src/components/settings/ProfileSettingsTab.tsx` (2FA card: AAL via `getAuthenticatorAssuranceLevel`, enroll dialog with QR `svg`, factor list, disable with `signInWithPassword` re-auth → `unenroll`); modify `src/pages/Login.tsx` (step 2 on `mfa_required`: input-otp → `challenge` + `verify` → AAL2 redirect); create `src/lib/mfa.ts` (`hasMfaPending` error-parse + thin wrappers) + `src/test/mfa.test.ts` + `src/test/totp.ts`.

**AC.** (1) Unit: `parseMfaError` extracts factor id from `mfa_required` shape; non-MFA errors pass through. (2) E2e on local stack (TOTP via the WebCrypto helper): enroll → sign out → sign in → code step → AAL2 (`getAuthenticatorAssuranceLevel` assert in fixture); **manual runbook fallback if the harness can't drive it** (F19). (3) Disable requires password; wrong password → inline error. (4) Non-enrolled user: zero login UI change. Assumption to verify at implementation: gotrue-js 2.101.1 exposes `mfa_factor_id` on the sign-in error (critique could not verify — unit test pins the shape we parse).

**Effort:** L (3d). Depends: W8 (re-auth pattern + profile section layout).

---

## 6. Rollout timeline (3 releases)

| Release | Contents | Migrations | Days | Gate |
|---|---|---|---|---|
| **R1 (P0)** | W0 harness + W1a + RT + W1d + W1b + W1c | `…00100` `…00110` `…00120` `…00130` | 1–4 | Migration replay verified (§4.1); RLS battery green; prod rogue-owner audit run & clean; runbook §2.6 followed; smoke green |
| **R2 (P1)** | W2a + W2b + W2c + W2d | none | 4–10 | Screenshot zero-delta for BDT; scoped `৳`-sweep = 0 (F11 exemption); scoped `omnisync-` grep = 0 |
| **R3 (P2)** | W3, W4, W5, W6, W7, W8, W9 | `20260911000400` (app_settings) `20260911000500` (member RPCs) | 11–20 | W4 preceded by corrected census; W9 role-gated; W8 toggle verified |

Ordering rules: DB expand (RPC/publication) → frontend contract → tighten, all within R1's runbook; W5→W6; W1a→W7; W2d lands before W5/W6 touch the same files (rebase churn); every release tolerates old bundles per §0.2.

## 7. Testing matrix (summary)

| Item | vitest | RLS battery (SQL) | Playwright (local stack) |
|---|---|---|---|
| W0 | — | harness itself | fixtures smoke |
| W1a | — | 10 assertions + concurrency step | — |
| W1d | — | 3 assertions | viewer read-only, owner save (2) |
| RT | — | idempotency + membership | realtime event (1) |
| W1b/W1c | slugify/error-map | 4 assertions | admin create + dup-slug + staff-denied (3) |
| W2a | — | — | fresh-context no-write + redirect (2) |
| W2b | — | — | sync button (1) |
| W2c | build/tsc | — | — |
| W2d | currency table + parameterized invoiceHtml | — | BDT screenshot ×2, USD switch ×1 |
| W3 | — | — | viewer denied / admin ok (2) |
| W4 | — | 4 assertions | admin inventory toggle regression (1) |
| W5 | settingsSchemas (~30 cases) | — | inline error on blur ×2 |
| W6 | useSettingsDirty | — | discard/stay/clean/beforeunload (4) |
| W7 | — | 4 assertions | role change + realtime + non-manager gate (2) |
| W8 | wrong-pass handler | — | happy + wrong-pass (2); confirmation = e2e-or-manual |
| W9 | mfa error-parse + totp util | — | enroll→challenge→AAL2 (1) or manual runbook |

## 8. Effort summary

| Item | Size | Days |
|---|---|---|
| W0 harness (incl. replay contingency ±2d) | M–L | 1–2 (+≤2) |
| W1 P0 security (a+d+RT+b+c) | M–L | 2.5–3 |
| W2a general+relocation | M | 0.5–1 |
| W2b print header | S | 0.5 |
| W2c delete Stores | S | 0.25 |
| W2d currency | M | 2 |
| W3 storefronts guard | S | 0.25 |
| W4 app_settings | S | 0.5 |
| W5 RHF+zod | M–L | 2.5 |
| W6 dirty guard | M | 1.5 |
| W7 business scoping | M–L | 2 |
| W8 email change | M | 1 |
| W9 TOTP | L | 3 |
| **Total** | | **~18.5–20.5 dev-days** (single senior dev, ~4 calendar weeks with review) |

## 9. Risk register

1. **Historical migrations don't replay from zero** (likely — lovable-era backfills). Mitigation: W0 step 0 makes it the first gate, with the schema-dump baseline fallback (§4.1) so the RLS battery ships regardless.
2. **W1 tightening breaks an untraced writer.** Mitigation: `grep` of compiled bundle for `user_business_access`/`businesses` client writes + `audit_log` write-source census pre-deploy + battery AC-10 regression.
3. **Old cached bundles hit tightened policies.** Mitigation: same-release frontend gating (W1d), error toasts accepted for rare writes (§0.2), runsheet smoke.
4. **Realtime visibility under tightened SELECT policy.** Mitigation: own rows stay readable (policy includes `user_id = auth.uid()`); RT e2e asserts delivery post-`…00110`.
5. **W2d 48-file fan-out.** Mitigation: 5 area PRs + BDT screenshot zero-delta gate.
6. **W4 locks real staff writers out.** Mitigation: corrected 90-day census (only `settings_inventory` + `settings_preorder_categories`); overrides or defer.
7. **W8/W9 harness prerequisites (mail catcher, TOTP).** Mitigation: named manual fallbacks (§4.3), unit coverage never manual.
8. **TOCTOU last-owner race.** Mitigation: `FOR UPDATE` helper (§2.1); deadlock-abort of one side accepted; platform-admin repair runbook.
9. **Playwright wrapper extensibility unverified.** Mitigation: replace with direct config if `webServer`/`baseURL` don't pass through (isolated change).

## 10. Hard edges (what must precede what)

- W0 (incl. replay verification) → everything testable.
- W1a → W1b → W1c, **one release window, one runbook** (§2.6); W1d + RT travel with them.
- W1a → W7 (helpers); RT → W7-realtime AC.
- W2a before W2b (relocation then relabel; W2a's AC is true at W2a time — F9).
- W2d before W5/W6 (same files; avoid rebase churn).
- W5 → W6 (isDirty source). W8 → W9 (re-auth pattern).
- W3, W4, W8 fully independent. Census precedes W4 ship.

## 11. Deliberately NOT doing in this plan

1. Per-business permission semantics (the ~40 granular permissions stay platform-global; W7 delivers role-per-business only).
2. Auto-migration of `invoice_settings` copy into `businesses`; sidebar legacy fallback (`AppSidebar.tsx:92-101`) stays until business-count-zero users are extinct.
3. Storefront currency unification (`src/storefront/lib/useCurrency.ts` + `storefronts.currency` stays per-storefront).
4. New `storefronts.view` permission enum (reuse `integrations.view`).
5. Backfill of persisted ৳-strings in `dueCollection`/`orderTimeline` history (symbol frozen at write time — §3.4).
6. Forced MFA enforcement (RLS/JWT `amr` layer) — enrollment + login challenge only.
7. 2FA recovery/backup codes — admin unenroll runbook instead.
8. P3 items: VAT/tax, notification center, bKash/Nagad/SSLCommerz gateways, Bangla i18n, billing, webhooks UI, invite expiry, UserAccessDialog atomic wipe-and-reinsert rework.
9. CI pipeline (no GH Actions in repo) — harness runs locally; CI is separate infra work.
10. `team-manage` edge function changes — server-side moves use SECURITY DEFINER RPCs.
11. Editing historical migrations — append-only files per house convention (replay repairs go in new files or the baseline-dump fallback, §4.1).
12. **Router migration to `createBrowserRouter`** (would enable route-level dirty blocking). Deferred: whole-app routing regression risk for a settings-only benefit; W6 ships in-page + `beforeunload` and documents the SPA-navigation gap (F5). Revisit if more blocker use-cases appear.
13. **Self-serve business creation** (any authenticated user creates/owns businesses). Deferred as an explicit product decision requiring sign-off + spam controls (cap per user, rate limit, updated copy) — NOT hidden inside the W1 security fix (F3). W1b preserves current admin-only semantics.
14. LocalStorage cleanup/migration for inert `omnisync-*` keys (beyond the three retired keys, which are simply no longer written).

## 12. Assumptions (with verification owner)

- Local Supabase stack (Docker Desktop) is available on this Windows dev box; `supabase status` exposes the local DB URL (W0 runner parses it). *(verify: W0 implementer)*
- 134-migration replay: unproven; W0 step 0 verifies with a stated contingency — not assumed clean (F6).
- "Secure email change" toggle state and TOTP MFA plan availability: dashboard-only; verified as rollout checklist items (R3), with the single-confirm degradation path coded (W8).
- Local stack mail catcher API usable for the W8 confirmation e2e; else manual runbook (§4.3). *(verify: W0 implementer)*
- gotrue-js 2.101.1 exposes `mfa_factor_id` on `mfa_required`; unit test pins the parsed shape (W9). *(verify: W9 implementer)*
- `lovable-agent-playwright-config` passes `webServer`/`baseURL` through; else direct config replacement (§4.3). *(verify: W0 implementer)*
- `audit_log` insert permits definer-path writes for W7's server-side audit; else client-side `logChange` fallback (W7). *(verify: W7 implementer, harness test)*
- Prod deploy = Vercel preview → production; migrations applied via `supabase db push` **before** the Vercel promote for tighten+expand releases alike (runbook §2.6).
