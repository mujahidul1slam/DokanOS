# PLAN-v3 — DokanOS Settings & Account Remediation (P0/P1/P2)

**Source of truth:** `DOKANOS-SETTINGS-AUDIT.md` (Sept 2026) · revised against `CRITIQUE-v2.md` (inherits all 27 CRITIQUE-v1 resolutions, re-verified by the round-2 critic — Part A: zero regressions)
**Stack:** Vite + React 18 + TS + shadcn/ui SPA · Supabase (Auth/Postgres+RLS/Edge Functions/Storage) · Vercel
**Status:** PLANNING ONLY — nothing in this document is implemented.
**Scope:** Audit recommendations P0-1, P1-2/3/4, P2-5/6/7. P3 items out of scope (§11).
**Verification note:** every SQL statement below was re-checked against the live migrations at v3 time: policy names swept across all 134 files in `supabase/migrations/`; helper signatures read from source (`20260412161413_*`, `20260420112330_*`, `20260904000100_*`); `user_business_access.role` confirmed `text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer'))` with `UNIQUE (user_id, business_id)` (20260904000100:44-53); `app_role` enum = `('admin','staff','viewer')` — no `'owner'` (platform roles only, 20260412161413:3); `businesses.slug UNIQUE NOT NULL` (23505 path). Function names `my_business_role` / `can_manage_business_access` / `business_has_other_owner` verified absent from all 134 migrations (no collision).

---

## Changes from v2 (every CRITIQUE-v2 finding → v3 resolution)

| # | Severity | Finding (summary) | v3 resolution |
|---|---|---|---|
| 1 | BLOCKER | W1a's last-owner guard unreachable — `can_manage_business_access` short-circuits the guarded disjunct; sole owner could self-delete; AC-6/AC-7 unimplementable | **Fixed.** DELETE policy restructured into three disjoint branches (§2.1): (1) platform admin unconditional; (2) self-leave = own row **and** `business_has_other_owner`; (3) manager removes **another** member's row (`user_id IS DISTINCT FROM auth.uid()`), guarded when the target is the last owner. The manager branch can no longer reach self rows, so the guard is load-bearing. Battery asserts the exact triple from the critique (sole-owner self-delete denied; owner deletes another's row allowed; owner self-delete with second owner allowed). §2.1. |
| 2 | BLOCKER | W1d's `CREATE POLICY "Members can read businesses"` collides with existing policy (20260904000100:355) → 42710 aborts Release-1 mid-runbook | **Fixed.** W1d forward SQL no longer touches SELECT at all: `DROP POLICY IF EXISTS "Members can write businesses"` + CREATE only the three write policies (§2.2). The existing `"Members can read businesses"` (:355-357) already grants the target read posture verbatim. Rollback mirrors touch exactly three policies. |
| 3 | MAJOR | Zero-owner invariant enforced on one path only: PostgREST UPDATE self-demotion and manager delete/demote of the last owner all bypass it | **Fixed.** Last-owner guard moved to the **USING side** of the UPDATE policy — `role IS DISTINCT FROM 'owner' OR business_has_other_owner(business_id, user_id)` inside the manager disjunct (§2.1). Rationale: per PG docs, USING filters **existing** rows and WITH CHECK checks **new** rows; since `role` is the only mutable column (identity columns locked by trigger), "UPDATE touches a last-owner row" ≡ "UPDATE demotes the last owner" — expressible entirely on the existing-row side, with no reliance on `OLD`-alias references inside `WITH CHECK`. DELETE manager branch carries the equivalent guard on the target row. Battery adds: sole-owner self-demotion denied; business-admin delete/demote of sole owner denied; co-owner cases allowed; platform-admin exemption asserted as documented behavior. §2.1 AC-11..14. |
| 4 | MINOR | W1c AC-4 unachievable: generated `src/integrations/supabase/types.ts` contains `user_business_access` | **Fixed.** AC-4 rewritten as a writer-sweep: `rg '\.from\("user_business_access"\)' src/ -l` → only `useBusinessContext.tsx`; generated `types.ts` never matches `.from(` (§2.4). |
| 5 | MINOR | W1a silently widened SELECT: managers would gain read on all membership rows — undocumented, unneeded | **Fixed (option: drop the widening).** SELECT policy left byte-identical to today's `"Users can read own access"` (own rows OR platform admin, 20260904000100:368-370). Managers get member lists via W7's SECURITY DEFINER `get_member_access` RPC. Side benefit asserted in battery (AC-15): managers cannot SELECT other members' rows, so the realtime channel carries no other-member events to them. §2.1. |
| 6 | MINOR | §11.9 premise false: repo HAS three GitHub Actions workflows | **Fixed.** Reworded: three **scheduled worker** workflows exist (`pathao-tracking.yml`, `sync-worker.yml`, `woo-sync-all.yml`); **no PR-gating CI** — harness stays local-only (§11.9). |
| 7 | MINOR | W9 names nonexistent `@supabase/supramab-js`; mislabels supabase-js version as "gotrue-js 2.101.1" | **Fixed.** "MFA via `@supabase/supabase-js` ^2.101.1 (`auth.mfa` namespace: enroll/challenge/verify/unenroll)" (§5.7). §12 assumption re-pinned to the installed supabase-js. `input-otp` already installed (^1.4.2) — no new dependency for the Login OTP step. |
| 8 | MINOR | W0 harness contradictions: denial tests would abort transactions and fail the runner; fixture-user creation unspecified | **Fixed.** §4.2 fully specified: **Shape A** (denial) = statement wrapped in a nested plpgsql `BEGIN … EXCEPTION WHEN <expected_errcode> THEN NULL; END;` block inside `DO $$ … $$` — the subtransaction absorbs the expected 42501/23514/23505 so it never escapes to the runner; a statement that *should* have failed but didn't raises `FAIL` (P0001) and aborts the run. **Shape B** (allow) = statement under `SET LOCAL ROLE` + `COMMIT`, then a connection-owner verification `DO` block + cleanup. Fixture users: direct `auth.users` INSERT recipe with fixed UUIDs (`ON CONFLICT (id) DO NOTHING`), documented interaction with the house `on_auth_user_created` trigger (20260412161413:140-143 — first inserted fixture receives an `'admin'` `user_roles` row; runner deletes + re-seeds `user_roles` after all fixture inserts, making the matrix deterministic). No admin API, no mail, no `[auth]` config dependence — config.toml verified to carry no `[auth]` overrides. |
| 9 | MINOR | R3 migrations would apply on any teammate's first `db push` after merge, bypassing W4's census gate | **Fixed.** Release buckets redefined as **merge discipline** (§6 ordering rules): a tightening migration file enters `main` only after its gate has passed — for W4 that means the corrected census has been run against prod and override decisions made, **pre-merge**, not pre-deploy. Until then the file lives on its feature branch. Stated in W4 (§5.2) and §10 hard edges. |
| 10 | MINOR | R1 "Days 1–4" contradicts W0's own contingency (1–2d + ≤2d) + W1 2.5–3d | **Fixed.** R1 days corrected to **4–7** (§6), consistent with §8's effort table. |
| 11 | NIT | §0.4 attributed a REVOKE/GRANT sweep to house helpers that mostly lack one | **Fixed with corrected facts.** v3 verification: `is_business_member` **does** carry `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO authenticated` (20260904000100, immediately after its body); `has_role` (20260412161413) and `has_permission` (20260420112330) carry **none** (rely on default PUBLIC EXECUTE). §0.4 reworded: REVOKE-then-GRANT is our idiom for **new** helpers; W4's `REVOKE ALL ON FUNCTION has_permission …` is a **net tightening** (anon loses default EXECUTE; verified no anon-context callers) and is described as such (§5.2). |
| 12 | NIT | W6 referenced a nonexistent `handleTabChange` chokepoint | **Fixed.** Sweep confirms three raw `setActiveTab` call sites: `SettingsPage.tsx:245` (`setActiveTab(null)` — mobile back), `:303` (mobile list), `:356` (desktop list), plus `:114` (initial auto-select, not user-facing, stays direct). W6 now **creates** `handleTabChange(next: string \| null)` and unifies all three user-facing call sites through it (§5.4); the mobile back path cannot be missed. |
| 13 | NIT | W7 rollback under-counts (2 vs 3 functions); W1b timezone list truncated vs UI; §2.1 old-bundle risk overstated | **Fixed.** (a) W7 rollback mirror = **three** `DROP FUNCTION`s (get_member_access, set_member_business_role, get_my_managed_businesses) (§5.5). (b) W1b timezone allow-list now the **full 8 values** of `BusinessAccountTab.TIMEZONES` (:22-31) and the SQL keeps its "exact" label honestly (§2.3). (c) §2.1 risk reworded: an old cached **admin** bundle's two-step create still passes both new `WITH CHECK`s (admin satisfies every guard); only staff fail — exactly as they fail today (§2.1 risks). |
| V1 | — (found during v3 verification) | v2's W1a carried a **second latent 42710**: it `CREATE`s `"Users can read own access"` without dropping the existing policy of that name (20260904000100:368) | **Eliminated by construction.** v3's W1a never re-creates the SELECT policy (Finding 5 resolution); forward SQL drops exactly one policy (`"Users can write own access"`) and creates exactly three new, collision-checked names (§2.1). Standing rule added to §2.0: every `CREATE POLICY` name must be `DROP … IF EXISTS`'d first or proven absent across all 134 migrations. |
| V2 | — | Cascade-census correction: `businesses` has **9** `business_id ON DELETE CASCADE` children — the 8 named in v2 plus `user_business_access` itself | §2.2 goal text updated (deleting a business also wipes membership rows). No SQL impact. |
| V3 | — | `app_role` enum has no `'owner'` member (platform roles: admin/staff/viewer); `uba.role` is `text` with its own CHECK | Helpers typed accordingly (`my_business_role RETURNS text`); §2.1 policy logic compares `uba.role` against string literals only — `has_role(…, 'owner')` is impossible and never used. |
| V4 | — | `on_auth_user_created` trigger side effect quantified for the fixture recipe | Documented in §4.2 (deterministic re-seed of `user_roles` after fixture inserts). |
| V5 | — | W6's mobile-back target is `setActiveTab(null)` (returns to the drill-down list), not a tab id | `handleTabChange(next: string \| null)` signature covers it; guard fires on back-navigation too (§5.4). |

---

## 0. Guiding constraints (apply to every work item)

1. **Production, multi-user, existing data.** Every DB change is additive-first, idempotent (`DROP POLICY IF EXISTS` + `CREATE`, `IF NOT EXISTS` guards, publication-membership check via `pg_publication_tables`), carries a tested rollback, and never breaks a live session mid-request. Deploys: Vercel (SPA) + `supabase db push`.
2. **Old JS bundles are in the wild.** A cached SPA may call endpoints/policies that no longer permit its writes for days after a deploy. Rules we follow: (a) migrations land **before** the frontend that depends on them (expand-first — new RPCs exist before the UI calls them); (b) a tightening migration may break an old bundle's write with a 42501 toast only if the write is rare and non-destructive (audited per item — see the corrected W1a risk wording, §2.1); (c) frontend gating ships in the same release as the tightening it accompanies.
3. **Migrations are append-only** files in `supabase/migrations/` (134 existing, `YYYYMMDDHHMMSS_*.sql` — older files carry hash suffixes; cite by timestamp prefix). Historical migrations are never edited. **No rollback artifacts are ever placed in `supabase/migrations/`** — the Supabase CLI executes every `*.sql` there as a forward migration. Rollback SQL lives in comment blocks inside the forward file and mirrored at `.planning/rollbacks/<migration>.md` (CRITIQUE-v1 F1).
4. **Policy-name discipline (new in v3).** Policy names are per-table and `CREATE POLICY` has no `IF NOT EXISTS`. Every `CREATE POLICY` in this plan either follows a `DROP POLICY IF EXISTS` of the same name or uses a name proven absent from all 134 migrations (v3 sweep: the only existing policies on `businesses`/`user_business_access` are the four foundation policies — `"Members can read businesses"` :355, `"Members can write businesses"` :358, `"Users can read own access"` :368, `"Users can write own access"` :371; `"Admins manage access"` was DROPped by the foundation itself and does not exist). v2 violated this twice (Findings 2 and V1); v3 cannot repeat it.
5. **House RLS idiom:** `has_role(auth.uid(),'admin'::app_role)` (20260412161413:37-48 — SECURITY DEFINER STABLE, no REVOKE/GRANT, default PUBLIC EXECUTE), `is_business_member(business_id)` (20260904000100:56-67 — SECURITY DEFINER STABLE **with** `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO authenticated`), `has_permission(user, perm)` (20260420112330:169 — SECURITY DEFINER STABLE, no REVOKE/GRANT). New helpers introduced by this plan follow the REVOKE-then-GRANT idiom; where we REVOKE an existing helper (W4's `has_permission`) that is a **behavior change** (anon loses default EXECUTE), verified safe (no anon callers) and labeled a tightening, not "normalization".
6. **Tests:** vitest (jsdom, existing config/glob) for units; Playwright for e2e; RLS assertions via a **plain-SQL harness** (no pgTAP) executed against the **local Supabase stack** (Docker Desktop prerequisite on this Windows box) — §4, with fully specified positive/negative assertion shapes (CRITIQUE-v2 #8). Vocabulary note: the local CLI gives a *local stack*, not platform "branches".
7. **Deps:** `react-hook-form`, `zod`, `@hookform/resolvers`, `input-otp` already installed. New dev-only additions: `pg` (harness runner DB client). No `otplib` (in-repo WebCrypto TOTP helper instead).
8. **Router fact (verified):** `src/App.tsx:3,164` uses plain `<BrowserRouter>` + `<Routes>`. `useBlocker` requires a data router and **cannot be used** in this app today. Nothing in this plan depends on it (§11.12).
9. **Release buckets are merge discipline (new in v3).** A migration file merged to `main` will be applied by the next `supabase db push` from anyone, for any reason. Tightening migrations therefore merge only after their gate passes (census, audits) — see §6.

---

## 1. Dependency graph & ordering

```
Phase 0 (prep, 1–2 days, +≤2d replay contingency)
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
Phase 3 — P2 UX & parity [RELEASE 3, merge-gated per §0.9/§6]
  W3  /storefronts PermissionGuard          (independent)
  W4  app_settings staff-write tightening    (independent, DB-only, census-gated at MERGE time)
  W5  react-hook-form + zod in settings tabs
  W6  dirty-state guard (created handleTabChange chokepoint + beforeunload; NO route-level claim, F5)
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
- Every rollback mirror lists exactly the objects its forward file created/dropped — no more, no less (v2's W1d mirror wrongly included the read policy; fixed here).

### 2.1 W1a: RLS — `user_business_access` cannot be self-granted

**Goal.** No authenticated user can insert/update/delete a `user_business_access` row unless:
(a) they are a platform `admin` (unconditional — the recovery backstop), or
(b) they **manage** the target business (`owner`/`admin` of it) and the operation does not create or destroy the last owner, or
(c) they are deleting **their own row to leave**, which is denied only when they are the last owner.
Membership is never acquired client-side. The business retains ≥1 owner through every non-platform-admin path.

**Root cause (verified).** `20260904000100:371-374` — policy `Users can write own access` `FOR ALL … USING/WITH CHECK (user_id = auth.uid() OR has_role(...))` validates only the row's `user_id`: any authenticated user can insert themselves as `owner` on any business, and can update/delete their own row anywhere.

**Why the v2 shape was wrong (CRITIQUE-v2 #1, #3).** v2's DELETE put `business_has_other_owner` in a disjunct after `can_manage_business_access(...)` — for an owner, the manager check is TRUE, the OR short-circuits, and the guard is unreachable; the same FOR ALL-style manager branch also allowed a business-admin to delete/demote the sole owner, and the UPDATE `WITH CHECK` allowed owner self-demotion. v3 restructures so guards sit on the only paths that can reach them.

**Guard placement rationale (PG docs, CREATE POLICY).** *"Existing table rows are checked against the expression specified in `USING`, while new rows that would be created via `INSERT` or `UPDATE` are checked against the expression specified in `WITH CHECK`."* Since `role` is the only mutable column of this table (identity columns are trigger-locked below), an UPDATE "demotes an owner" **iff** the existing row has `role = 'owner'` and the mutation is not a pure no-op — a condition fully expressible on the USING (existing-row) side. v3 deliberately does **not** reference `OLD` inside `WITH CHECK` (a construct the house has never used); the USING side makes the guard exact with documented semantics only. Consequence (accepted, documented): a non-admin cannot update **any** column of the last owner's row, including a meaningless `owner→owner` no-op; platform admins are exempt (first disjunct).

**Files.**
- Create: `supabase/migrations/20260911000100_rls_tighten_user_business_access.sql`
- Create: `.planning/rollbacks/20260911000100_rls_tighten_user_business_access.md` (mirror only)

**Forward SQL (exact):**

```sql
-- ============================================================================
-- P0 fix: user_business_access write policies. Replaces "Users can write own
-- access" (FOR ALL, self OR admin) which let any authenticated user self-grant
-- owner on ANY business. House idiom: DROP POLICY IF EXISTS + CREATE.
-- The SELECT policy "Users can read own access" (20260904000100:368-370) is
-- deliberately left untouched: its logic (own rows OR platform admin) is the
-- exact target posture (CRITIQUE-v2 #5: no manager widening), and re-CREATEing
-- that name would raise 42710 (duplicate_object).
-- ============================================================================

-- Caller's role in a business (NULL when not a member). SECURITY DEFINER so
-- policies on user_business_access can read it without recursion. uba.role is
-- text CHECK (owner/admin/member/viewer) with UNIQUE (user_id, business_id)
-- (20260904000100:44-53), hence RETURNS text and exactly one row.
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
-- VOLATILE (not STABLE): SELECT ... FOR UPDATE takes row locks — the F17
-- TOCTOU fix. Two concurrent last-owner mutations serialize; one side
-- deadlock-aborts (40P01) instead of both committing an ownerless business.
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

-- The ONLY policy dropped (the write hole, 20260904000100:371-374).
DROP POLICY IF EXISTS "Users can write own access" ON public.user_business_access;

-- INSERT: managers may add members/viewers; only business-owners or platform
-- admins may add owner/admin rows (symmetric with the UPDATE elevation rule —
-- a uba-'admin' cannot manufacture an owner, matching what UPDATE allows).
CREATE POLICY "Managers can add members" ON public.user_business_access
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      can_manage_business_access(business_id, auth.uid())
      AND (
        role NOT IN ('owner', 'admin')
        OR public.my_business_role(business_id, auth.uid()) = 'owner'
      )
    )
  );

-- UPDATE. USING (existing row): a manager may touch a row unless it is the
-- LAST owner's row — because role is the only mutable column, any mutation of
-- a last-owner row by a non-admin is a demotion in effect. WITH CHECK (new
-- row): elevation to owner/admin requires the caller to be an owner of that
-- business or a platform admin. Platform admins bypass both guards (first
-- disjunct) — the documented recovery backstop.
CREATE POLICY "Managers can update member roles" ON public.user_business_access
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      can_manage_business_access(business_id, auth.uid())
      AND (
        role IS DISTINCT FROM 'owner'
        OR public.business_has_other_owner(business_id, user_id)
      )
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      can_manage_business_access(business_id, auth.uid())
      AND (
        role NOT IN ('owner', 'admin')
        OR public.my_business_role(business_id, auth.uid()) = 'owner'
      )
    )
  );

-- DELETE: three disjoint branches (CRITIQUE-v2 #1 restructure):
--   1. platform admin — unconditional (recovery backstop);
--   2. self-service leave — own row, only while another owner exists
--      (for non-owner members this is trivially true: the invariant
--      guarantees an owner who is not them);
--   3. manager removal of ANOTHER member's row — denied only when the target
--      is the last owner. Self rows are excluded here (user_id IS DISTINCT
--      FROM auth.uid()) so this branch can never bypass branch 2's guard.
CREATE POLICY "Members can leave; managers can remove" ON public.user_business_access
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      user_id = auth.uid()
      AND public.business_has_other_owner(business_id, auth.uid())
    )
    OR (
      can_manage_business_access(business_id, auth.uid())
      AND user_id IS DISTINCT FROM auth.uid()
      AND (
        role IS DISTINCT FROM 'owner'
        OR public.business_has_other_owner(business_id, user_id)
      )
    )
  );
COMMIT;
```

**Post-migration capability matrix (the mental simulation required by the dialectic):**

| Actor | INSERT | UPDATE | DELETE own row | DELETE others' rows |
|---|---|---|---|---|
| Platform admin | any | any | yes | yes (backstop exemption) |
| Business `owner`, sole | any role except… (may add owner/admin/member/viewer) | **own row: denied** (last-owner guard); other rows: yes (elevation allowed) | **denied** (last-owner lockout) | yes for member/viewer rows and co-owner rows |
| Business `owner`, co-owner | any role | full manage incl. demote/delete co-owner (other owner remains) | allowed (other owner exists) | allowed unless target is last owner (impossible while caller is owner) |
| Business `admin` (uba) | member/viewer rows only — `owner` row insert **denied** (elevation rule) | member/viewer rows; elevation to owner/admin **denied**; last-owner row **denied** | allowed (an owner exists ≠ them) | allowed except the last owner's row |
| `member`/`viewer` | none | none (USING fails) | allowed (leave; an owner exists ≠ them) | none |
| Outsider | none | none | none | none |

**Rollback (embedded comment block + `.planning/rollbacks/` mirror):**

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_uba_immutable ON public.user_business_access;
DROP FUNCTION IF EXISTS public.user_business_access_immutable();
DROP POLICY IF EXISTS "Managers can add members" ON public.user_business_access;
DROP POLICY IF EXISTS "Managers can update member roles" ON public.user_business_access;
DROP POLICY IF EXISTS "Members can leave; managers can remove" ON public.user_business_access;
-- restore the original write policy verbatim (20260904000100:371-374)
CREATE POLICY "Users can write own access" ON public.user_business_access
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
COMMIT;
-- ("Users can read own access" was never touched — it still stands, unchanged.
--  Helpers are left in place: harmless orphans that W7's RPCs reuse.)
```

**Acceptance criteria (RLS battery, §4).** Executed as different simulated users via `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims`; denials use the Shape-A pattern (expected SQLSTATE absorbed in-transaction):

1. Viewer of business A inserts own row as `owner` on arbitrary business B → **denied** (42501).
2. Viewer of A inserts own row as `owner` on A (own business, not manager) → **denied**.
3. Owner of A inserts `{U2, A, 'member'}` → allowed (Shape B verify). Owner inserts `{U2, B_other, 'owner'}` → **denied**.
4. Platform admin inserts any row → allowed.
5. **(new, elevation symmetry)** Business-admin of A inserts `{U3, A, 'member'}` → allowed; `{U3, A, 'owner'}` → **denied**.
6. **(Finding 1)** Sole owner deletes own row → **denied** (last-owner lockout).
7. Owner deletes own row while a second owner exists → allowed. Owner deletes another member's row → allowed. Business-admin deletes another member's row → allowed.
8. **(Finding 3)** Business-admin deletes the **sole owner's** row → **denied**; business-admin demotes the sole owner (`owner→member`) → **denied**.
9. **(Finding 3)** Sole owner self-demotes via UPDATE (`owner→member`) → **denied** (USING guard).
10. Owner demotes a co-owner (two owners present) → allowed; business-admin demotes a co-owner (two owners present) → allowed; business-admin updates member `viewer→owner` → **denied**; owner updates same → allowed.
11. UPDATE changing `user_id` or `business_id` → trigger `check_violation` (23514).
12. **(documented exemption)** Platform admin deletes/demotes the sole owner → **allowed** (asserted as the backstop behavior, so a future "fix" that silently removes the exemption is caught).
13. Concurrent double last-owner mutation (two sessions, manual harness step: both sole owners self-delete/self-demote simultaneously) → at most one commits; other aborts (40P01 or lock wait) → business retains ≥1 owner.
14. Plain member SELECT own rows + `useBusinessContext.refresh()` read path → identical results pre/post (regression).
15. **(Finding 5, narrowing asserted)** Business-admin cannot SELECT another member's `user_business_access` row (member lists come only via W7's RPC).

**Risks.**
- *Old cached bundles:* an **admin's** old-bundle two-step create still passes both new `WITH CHECK`s (admin satisfies `has_role` on both tables) — unchanged behavior. A **staff's** old-bundle create fails at `businesses` INSERT — exactly as it fails today (the foundation's FOR ALL `WITH CHECK` already required `has_role OR is_business_member(new_id)`, necessarily false on insert). The only *new* 42501 surface is a member/viewer saving business details (W1d's scope) — rare, non-destructive, self-heals on refresh, gated same-release (§0.2).
- *Realtime membership channel:* **today it silently delivers zero events** — `user_business_access` was never added to the `supabase_realtime` publication (only `stores`/`orders`/`courier_shipments` — `20260903000500:6-8`, re-verified: no other PUBLICATION statement in any migration). The existing subscription in `useBusinessContext.tsx:92-105` is already dead; no RLS change can make it worse. Fixed additively by §2.5. `REPLICA IDENTITY FULL` is **not** part of the remediation.
- *Pre-existing ownerless businesses* (if any rogue historical state exists): guards assume the invariant holds; the §2.6 step-1 audit detects violations before push, and platform-admin paths can always repair.

**Effort:** M.

### 2.2 W1d: RLS — `businesses` writes owner/admin-only (CRITIQUE-v1 F7, CRITIQUE-v2 #2)

**Goal.** After W1a, a legitimately-invited `viewer`/`member` could still UPDATE the `businesses` row and **DELETE** it — cascade-wiping brands, locations, selling_points, connectors, product_sources, customer_sources, suppliers, purchase_orders **and `user_business_access` itself** (9 `business_id ON DELETE CASCADE` children total, `20260904000100`). Close it.

**Files.**
- Create: `supabase/migrations/20260911000120_rls_tighten_businesses.sql`
- Create: `.planning/rollbacks/20260911000120_rls_tighten_businesses.md`

**Forward SQL (exact):**

```sql
-- ============================================================================
-- P0 fix: "Members can write businesses" (FOR ALL, any member) let ANY member
-- — including viewer — UPDATE and cascade-DELETE the businesses row.
-- CRITIQUE-v2 #2: the SELECT policy "Members can read businesses"
-- (20260904000100:355-357) already grants member-wide read and is NOT touched
-- here — CREATEing that name again would raise 42710 and abort this migration
-- mid-runbook. Only the FOR ALL write policy is dropped and replaced by three
-- explicit write policies. Depends on W1a's can_manage_business_access
-- (20260911000100) — runbook order …00100 → …00120.
-- ============================================================================
BEGIN;
DROP POLICY IF EXISTS "Members can write businesses" ON public.businesses;

-- Direct INSERT: platform admin only (new businesses have no members yet, so
-- is_business_member(new_id) is necessarily false — this matches today's
-- effective behavior through the old FOR ALL's WITH CHECK).
-- The W1b RPC path is SECURITY DEFINER and unaffected.
CREATE POLICY "Admins can insert businesses" ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- UPDATE: platform admin or owner/admin-of-business. USING == WITH CHECK by
-- design (the row cannot move between businesses; id is its identity).
CREATE POLICY "Owners can update businesses" ON public.businesses
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)
         OR can_manage_business_access(id, auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role)
              OR can_manage_business_access(id, auth.uid()));

-- Business deletion cascade-wipes 9 child tables incl. memberships:
-- platform admin only.
CREATE POLICY "Admins can delete businesses" ON public.businesses
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
COMMIT;
```

**Rollback (embedded):** `DROP POLICY IF EXISTS` the **three** policies above; re-create `Members can write businesses` FOR ALL verbatim (`20260904000100:358-361`):

```sql
CREATE POLICY "Members can write businesses" ON public.businesses
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id));
```

(The read policy `"Members can read businesses"` appears in neither the forward file nor the rollback — it is never dropped.)

**Frontend consequence (same release).** `BusinessAccountTab.handleSave` (`BusinessAccountTab.tsx:107-145`) currently lets any member save. Modify `src/components/settings/BusinessAccountTab.tsx`: derive `myRole` for the active business from `useBusinessContext`'s own access rows (own-row SELECT stays readable); when `myRole` is `member`/`viewer` (and caller not platform admin): fields read-only, SaveButton disabled, hint "Business details are managed by the business owner or an admin." Old cached bundles: a member saving post-migration gets a 42501 toast — rare, non-destructive, accepted per §0.2.

**Acceptance criteria (RLS battery + e2e).**
1. Member of A UPDATE businesses A → **denied**; owner of A → allowed; platform admin → allowed.
2. Member or owner DELETE businesses A → **denied**; platform admin → allowed.
3. Any member SELECT businesses A → unchanged (regression; read policy untouched).
4. Owner edits name/currency via Business Account tab e2e → persists + audit log row.
5. Viewer e2e: fields disabled, no save button, hint visible.

**Effort:** M (0.5 SQL + 0.5 frontend gating).

### 2.3 W1b: `create_business_with_owner` RPC — admin-only, validated (CRITIQUE-v1 F3/F15/F18)

**Goal.** Business creation moves server-side and atomic (business + founder-owner row in one transaction) while **preserving today's entitlement**: only platform admins create businesses (current `businesses` INSERT effectively admin-only — `is_business_member(new_id)` is necessarily false on insert; the UI copy at `BusinessAccountTab.tsx:298` states the product's semantics). Self-serve creation is a separate, signed-off product decision (§11.13), not something smuggled into a security fix.

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
  -- Full allow-list = BusinessAccountTab.TIMEZONES (:22-31), verbatim — the
  -- first future caller passing a UI-listed zone cannot be surprised.
  IF p_timezone NOT IN (
    'Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai',
    'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'
  ) THEN
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

**Why RPC over edge function (F15):** single-transaction atomicity on the DB (business+access commit or roll back together — the partial failure state the current two-step flow toasts about), no Deno deploy cycle, no new authenticated HTTP surface. (`team-manage` already runs a service-role client, so privilege was never the differentiator.)

**Rollback (embedded):** `DROP FUNCTION IF EXISTS public.create_business_with_owner(text, text, text, text, text);`

**Acceptance criteria.**
1. Platform admin calls RPC → business + owner row created atomically; pre-seeded slug collision → `23505` propagates, **no** orphan access row (connection-owner count in harness, Shape B).
2. Non-admin authenticated call → clean `42501 'Admin access required'`.
3. Anon call → denied.
4. Empty name, bad slug (`"My Slug!!"`), bad currency (`XYZ`), bad timezone (`Mars/Olympus`) → clean `23502`/`23514` errors, no partial writes.

**Effort:** S.

### 2.4 W1c: Frontend — `CreateBusinessForm` uses the RPC

**Goal.** Replace the two-step client-side insert (`BusinessAccountTab.tsx:288+`) with one `supabase.rpc("create_business_with_owner", ...)` call.

**Files.** Modify `src/components/settings/BusinessAccountTab.tsx` (only `CreateBusinessForm`, lines 269–325).

**Changes.**
- `handleCreate`: keep client-side slugify + validation; call the RPC with `{ p_name, p_slug }`; map `23505` → "That slug is already taken"; map `42501 'Admin access required'` → the existing copy "only account admins can provision new businesses" (**now accurate** — F25); any other error → neutral "Could not create the business — please try again".
- Delete the dead second `supabase.auth.getUser()` round-trip.
- On success: `logChange("business_account", data.id, null, {...}, undefined, { action: "create" })` + `await refresh()` exactly as today.

**Acceptance criteria.**
1. Admin e2e (local stack, seeded fixture): Settings → Business Account → create "Test Biz" → switcher shows it, one owner row for the admin, toast success.
2. Duplicate slug → friendly 23505 toast, no business row.
3. Staff (non-admin) e2e: attempt create → "only account admins…" message; **no** client-side `user_business_access` write attempted.
4. **(CRITIQUE-v2 #4)** Writer-sweep AC (achievable): `rg '\.from\("user_business_access"\)' src/ -l` → only `src/hooks/useBusinessContext.tsx`. The generated `src/integrations/supabase/types.ts` mentions the table name but never `.from(`, so it cannot false-positive; it is regenerated by `supabase gen types` and is never hand-edited.

**Effort:** S.

### 2.5 RT: Realtime publication membership (CRITIQUE-v1 F2)

**Goal.** The `useBusinessContext` membership subscription (`useBusinessContext.tsx:92-105`) currently delivers **zero events** — the table was never added to `supabase_realtime` (re-verified: only `20260903000500:6-8` touches publications across all 134 migrations). Add it so membership changes propagate live.

**Files.** Create: `supabase/migrations/20260911000110_realtime_user_business_access.sql` (no rollback needed — additive; mirror notes the `DROP … FROM PUBLICATION` inverse at `.planning/rollbacks/`).

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
- Realtime respects the SELECT policy: users see own-row events; with W1a's narrowed SELECT (Finding 5 resolution) managers do **not** receive other members' membership events — expected and fine for this channel (W7's affected member gets their own row's event).
- No `REPLICA IDENTITY` change: the table's events of interest are INSERT/UPDATE. DELETE visibility for non-managers is not a requirement.
- W7's `set_member_business_role` will now actually propagate to the affected member's client.

**Acceptance criteria.**
1. Harness: after all migrations, `select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='user_business_access'` = 1; running the migration twice does not error (idempotency).
2. E2e (local stack, §4): member client's `useBusinessContext` receives a membership INSERT event **on their own row** within 5s of the harness inserting it via SQL — fails on main today, which is the bug being fixed.

**Effort:** S (0.25d).

### 2.6 Release 1 runbook (unambiguous, F16)

1. **Pre-deploy audit (prod SQL editor, read-only):**
   `select business_id, user_id, role from user_business_access where role='owner' and user_id not in (select user_id from user_roles where role='admin');`
   Investigate anything suspicious (possible prior abuse of the hole) before proceeding. Gate: reviewed, rogue rows removed if any. Also check for pre-existing ownerless businesses (guards assume the invariant): `select b.id from businesses b where not exists (select 1 from user_business_access a where a.business_id=b.id and a.role='owner');`
2. **Policy-name pre-flight (new, v3):** confirm in prod that the four policy names v3 creates (`"Managers can add members"`, `"Managers can update member roles"`, `"Members can leave; managers can remove"`, `"Admins can insert businesses"`, `"Owners can update businesses"`, `"Admins can delete businesses"` — six, on the two tables) do not already exist: `select tablename, policyname from pg_policies where tablename in ('businesses','user_business_access');` — belt-and-braces against drift between this repo and prod.
3. **Push migrations** in order: `…00100` (uba policies) → `…00110` (publication) → `…00120` (businesses) → `…00130` (RPC). `supabase db push`, migration **first** — every new RPC/policy the frontend depends on exists before any bundle references it; the tightened policies break only the old bundles' rare writes (accepted §0.2, with the corrected admin/staff analysis in §2.1 risks).
4. **Verify in SQL editor:** run the RLS battery's prod-safe spot-checks (a SELECT-policy read as a normal member; one `create_business_with_owner` attempt as admin on a throwaway slug, then delete it).
5. **Vercel promote** the Release-1 frontend (W1c + W1d gating).
6. **Post-deploy smoke (prod, admin account):** create a throwaway business via the form → switcher + owner row verified → delete it (admin DELETE now the only path — also smoke-tests W1d).
7. **Rollback (if broken):** run the embedded rollback blocks from `.planning/rollbacks/*.md` via SQL editor **and** Vercel-rollback the frontend in the same action. Never introduce a rollback file into `supabase/migrations/` (F1).

**Release-1 testing summary.** RLS battery: W1a AC-1..15 + concurrency step, W1d AC-1..3, W1b AC-1..4, RT AC-1 (§4). Vitest: `slugify` + RPC-error-mapping helper (`src/lib/businessHelpers.ts`, new). Playwright (local stack): admin create-business happy path, duplicate slug, staff-denied, viewer read-only gating, realtime own-row membership event (RT AC-2).

**Release-1 risks.**
- Rogue historical rows from prior exploitation → step 1 gate + manual cleanup.
- Pre-existing ownerless businesses → step 1 second query + admin repair (insert an owner row) before push.
- Realtime publication add slightly increases WAL volume → negligible (small table).
- `FOR UPDATE` guard may deadlock-abort a genuinely concurrent double-owner-exit → one user sees a transient error, retries; platform admin can always repair membership (documented; accepted, F17).

---

## 3. Phase 2 — P1: Collapse business identity (Release 2, frontend-only)

### 3.1 W2a: General tab slim-down + Print Header relocation (folded, F8/F9)

**Goal.** Kill the lying `omnisync-*` localStorage surface (`SettingsPage.tsx:117-134`), keep the General tab as theme + PWA install only, **and in the same work item** move `BusinessProfileTab` out of the `general` case-branch (`SettingsPage.tsx:181`) into its own `printheader` tab — one IA restructure, W2a's AC true at W2a time.

**Files.**
- Modify `src/pages/SettingsPage.tsx`: remove state lines 117–120 + `handleSaveGeneral` 122–134; General card keeps theme + `InstallAppButton`; add compact "Business basics" redirect card (name/currency/timezone rows reading **live** values from `useBusinessContext().active`, one Button → `handleTabChange("account")` — W6's chokepoint once it exists, `setActiveTab("account")` until then); add `printheader` TabDef `{ id: "printheader", label: "Print Header", icon: Printer, description: "Business name/logo/contact on invoices", keywords: "invoice header logo print brand" }` (single string — real `TabDef` shape, F24); move `<BusinessProfileTab />` from `general` branch to `printheader` branch; mirror both branches in the mobile drill-down path.

**Acceptance criteria.**
1. Fresh Playwright context (F8): visit Settings, interact with General → `omnisync-business-name`, `omnisync-currency`, `omnisync-timezone` all remain `null`.
2. General tab renders theme + install + redirect card only (no Business Profile card — moved in this item).
3. Redirect card click → `account` tab, desktop + mobile.
4. Settings search "currency" → Business Account hit; General not matched.
5. `rg "omnisync-business-name|omnisync-currency|omnisync-timezone" src/` → 0 (scoped to the three retired keys only — other `omnisync-*` keys like `omnisync-global-stock` are untouched and remain legitimate).

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
- **Persisted-content writers (reclassified, F10):** `src/lib/dueCollection.ts:60,62` and `src/lib/orderTimeline.ts:58,66` write **rows to the DB**. Decision: symbol is **frozen at write time** — historical rows keep whatever symbol they were written with; new rows use the active business symbol. Mixed-symbol history is accepted and stated; no backfill migration (§11.5 family).
- Replacement pattern: `const { fmt } = useCurrency();` → `{fmt(x)}`; codemod regex gets ~80%; string literals manual. Storefront (`src/storefront/**`) keeps its own `storefronts.currency`-bound hook — untouched (§11.3).
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

## 4. W0 — Test harness (local stack; CRITIQUE-v1 F6/F19/F27, CRITIQUE-v2 #8)

**Goal.** Minimal, runnable test additions: (a) SQL RLS battery, (b) Playwright auth+seed fixtures against the **local Supabase stack**. No pgTAP. No platform "branches" — the local CLI's local stack (Docker Desktop prerequisite on this Windows dev box) is the environment, full stop.

### 4.1 Step 0 — migration replay verification (F6)

`supabase start && supabase db reset` on a fresh local DB replays all 134 + new migrations. **This has never been demonstrated in this repo** (lovable-era + hand-written migrations embed live-data backfills, e.g. `20260904000100` DO block lines 447–612). W0 begins by running it and recording the result:
- **Clean replay:** harness proceeds; replay becomes a standing regression check on every `db reset`.
- **Replay fails anywhere:** choose (i) budget up to 2 days to repair/`IF EXISTS`-guard the offending historical migration **in a new migration file or config** (never editing history — if in-place repair is impossible, fall back to (ii)); or (ii) **schema-dump baseline**: `supabase db dump` (schema-only, from the linked prod after its next successful push) restored into the local DB as the harness baseline. Harness then tests policies against a schema-equivalent DB; the replay defect is recorded as tracked debt. The RLS battery is runnable either way; only its baseline provenance changes.

### 4.2 RLS battery — plain SQL, no pgTAP (F27), mechanics fully specified (CRITIQUE-v2 #8)

**Files.**
- Create `supabase/tests/rls/_harness.md` — documents the two assertion shapes (below) verbatim for copy-paste; no macros exist in plain SQL, so each test file uses the literal pattern.
- Create `supabase/tests/rls/user_business_access_test.sql` (§2.1 AC-1..15 + concurrency-step script), `businesses_test.sql` (§2.2 AC-1..3), `create_business_with_owner_test.sql` (§2.3), `realtime_test.sql` (§2.5 AC-1), `app_settings_test.sql` (W4), `member_access_rpc_test.sql` (W7).
- Create `scripts/run-rls-tests.mjs` — Node runner (see runner spec below).
- `package.json`: `"test:rls": "supabase db reset && node scripts/run-rls-tests.mjs"` (no fabricated flags; reset applies migrations, runner seeds + asserts).

**Assertion Shape A — denial (expected SQLSTATE must never escape to the runner).** The nested plpgsql block creates a subtransaction (implicit savepoint): the expected error is absorbed and the outer transaction stays healthy; a statement that unexpectedly *succeeds* raises `FAIL` (P0001), which is not caught and aborts the run:

```sql
-- W1a AC-6: sole owner deletes own row → denied (42501)
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<OWNER_A_UUID>","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    DELETE FROM public.user_business_access
     WHERE business_id = '<BIZ_A_UUID>' AND user_id = '<OWNER_A_UUID>';
    RAISE EXCEPTION 'FAIL: W1a-AC6 sole-owner self-delete unexpectedly succeeded'
      USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- 42501: RLS denial — expected
  END;
END $$;
ROLLBACK;
```

Expected-errcode table: RLS/policy denials and RPC 42501 → `insufficient_privilege`; identity-mutation trigger → `check_violation`; unique slug → `unique_violation`. A *different* unexpected errcode is not caught → runner fails the file (correct).

**Assertion Shape B — allow (statement + post-commit verification as connection owner).** The fixture actor's own-row SELECT cannot see other members' rows, so "it worked" is verified after `COMMIT` as the connection's owner role (sees all rows), then cleaned up:

```sql
-- W1a AC-7a: owner deletes own row while second owner exists → allowed
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<OWNER_A_UUID>","role":"authenticated"}';
DELETE FROM public.user_business_access
 WHERE business_id = '<BIZ_A_UUID>' AND user_id = '<OWNER_A_UUID>';
COMMIT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access
              WHERE business_id = '<BIZ_A_UUID>' AND user_id = '<OWNER_A_UUID>')
  THEN RAISE EXCEPTION 'FAIL: W1a-AC7a delete did not persist' USING ERRCODE = 'P0001'; END IF;
END $$;
-- cleanup (Shape B tests deliberately persist; runner restores the fixture matrix)
INSERT INTO public.user_business_access (user_id, business_id, role)
VALUES ('<OWNER_A_UUID>', '<BIZ_A_UUID>', 'owner');
```

**Runner spec (`scripts/run-rls-tests.mjs`).**
1. Shell `supabase status` (local stack), extract the DB URL via `/postgres(?:ql)?:\/\/\S+/`; fail fast if absent (Docker not running).
2. Connect with `pg` (**new devDependency**, dev-only) as the connection owner.
3. **Seed fixtures** (fixed UUIDs, `ON CONFLICT`-idempotent, wiped by the next `db reset`):
   - `auth.users` insert recipe per fixture user (fixed UUIDs `ADMIN`, `OWNER_A`, `OWNER_A2`, `UBA_ADMIN_A`, `MEMBER_A`, `VIEWER_A`, `OWNER_B`, `OUTSIDER`):
     ```sql
     INSERT INTO auth.users
       (id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     VALUES
       ('<UUID>', 'authenticated', 'authenticated', '<name>@dokanos.test',
        'local-fixture-password-never-used-for-login', now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
     ON CONFLICT (id) DO NOTHING;
     ```
     Column list matches the local GoTrue schema's NOT NULLs as reviewed; W0 implementer verifies against the replayed local schema and extends if the local stack's GoTrue version requires more columns. Passwords are never exercised (tests `SET LOCAL ROLE` directly), so no crypt/pgcrypto needed and no `[auth]` config dependence (verified: `supabase/config.toml` carries no `[auth]` overrides).
   - **House-trigger interaction (documented):** `on_auth_user_created` → `handle_new_user` (20260412161413:140-143) fires per insert; fixture emails match no invitation, and the first-inserted fixture trips the first-user branch and receives a `'admin'` `user_roles` row (:129-133). The runner therefore, **after** all `auth.users` inserts: `DELETE FROM public.user_roles WHERE user_id IN (<all fixture uuids>);` then inserts the intended matrix explicitly (`user_roles(user_id, role)` — table def 20260412161413:17-22 — and `user_business_access` rows for A: OWNER_A/OWNER_A2 `owner`, UBA_ADMIN_A `admin`, MEMBER_A `member`, VIEWER_A `viewer`; B: OWNER_B `owner`). Deterministic regardless of insert order or prior partial runs.
4. Execute each `supabase/tests/rls/*.sql` in filename order as a multi-statement batch; **fail on the first uncaught SQLSTATE error** (Shape A guarantees expected errors never escape); print `PASS/FAIL <file>` summary; exit non-zero on any failure.
5. The concurrency step (W1a AC-13) ships as a documented two-session psql script the implementer runs once per battery run (cannot be expressed in the single-connection runner); its checklist lives in `supabase/tests/rls/_harness.md`.

### 4.3 Playwright (local stack) — prerequisites & honest scope (F19)

**Prerequisites, enumerated:** Docker Desktop running the local stack; `supabase status` healthy; `bun run dev` serving the app with env vars pointed at the **local** Supabase URL/anon key (Playwright `webServer` passes them); local stack's built-in mail catcher (InBucket/Mailpit on `:54324`) for W8. If any prerequisite is unavailable on a given day, the affected e2e specs degrade to **manual runbooks** — named per item below, not silently dropped.

**Files.** Extend `playwright-fixture.ts` (exists): `authedPage(userKey)` fixture — signs up/signs-in a seeded fixture user against the local stack, stores storageState; role/business seeding happens in the RLS runner seed (shared fixture UUIDs). Add `webServer` (`bun run dev`) + `use.baseURL`. **Assumption to verify in implementation (critique could not):** whether the `lovable-agent-playwright-config` wrapper passes `webServer`/`baseURL` through — if not, replace the wrapper with a direct Playwright config (small, isolated change; no product code touched).

**ACs that become manual if the harness can't carry them:** W8 email-confirmation click-through (manual runbook), W9 TOTP challenge e2e (manual runbook with the WebCrypto helper). RLS battery is never manual — it is the Release-1 gate.

**Effort:** M–L (1–2d, plus up to 2d replay contingency from §4.1).

---

## 5. Phase 3 — P2 items (Release 3)

### 5.1 W3: `PermissionGuard` on `/storefronts`

Wrap the route like its siblings: `src/App.tsx:102` → `<Route path="/storefronts" element={<PermissionGuard permission="integrations.view"><StorefrontsPage /></PermissionGuard>} />`; align the sidebar entry's roles (`AppSidebar.tsx:36-69`) to `integrations.view`. Reuses the existing permission (no `ALTER TYPE` — §11.4). AC: viewer → `DefaultFallback` "Access denied" (PermissionGuard.tsx:17-24), admin → full page, diff = 1 line + sidebar array. **Effort:** S.

### 5.2 W4: Tighten `app_settings` writes

**Goal.** `20260429165344` policies let any `staff` INSERT/UPDATE `app_settings` (global stock, preorder categories) bypassing `settings.manage`. Tighten to `settings.manage` holders or platform admin — using the **existing** `public.has_permission(_user_id uuid, _permission app_permission)` SECURITY DEFINER function (20260420112330:169, verified signature), not a new helper (F13).

**Merge-gate (CRITIQUE-v2 #9 — the gate is at MERGE time, not deploy time).** Migrations are append-only files in a shared repo: once `20260911000400_rls_tighten_app_settings.sql` lands on `main`, the next `supabase db push` from anyone applies it. Therefore: the corrected census (below) is run against prod **before the file is merged**; overrides granted or the item deferred **before merge**; the file lives on its feature branch until the gate passes. `supabase db push` of an ungated tightening from `main` is a runbook violation (§0.9, §6, §10).

**Files.**
- Create: `supabase/migrations/20260911000400_rls_tighten_app_settings.sql` (+ `.planning/rollbacks/` mirror)
- Create: `supabase/tests/rls/app_settings_test.sql` (battery)

```sql
BEGIN;
-- Tightening, not normalization (CRITIQUE-v2 #11): has_permission
-- (20260420112330:169) carries NO explicit grants and so grants EXECUTE to
-- PUBLIC by default — anon included. After this statement, anon loses
-- EXECUTE (verified safe: no anon-context callers; every caller is an
-- authenticated-role RLS policy).
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
-- SELECT policy ("Authenticated can read app_settings", 20260429165344:11) and
-- DELETE policy ("Admin can delete app_settings", :22) unchanged.
COMMIT;
```

**Census (pre-MERGE, prod, corrected per F12):** `select distinct user_id from audit_log where action in ('settings_inventory','settings_preorder_categories') and created_at > now() - interval '90 days';` — only these two actions write `app_settings` (`settings_general` is localStorage-only and must not be counted). If non-admin writers exist: grant `settings.manage` overrides first, or defer W4 with notice.

**Rollback:** DROP the two new policies; re-create the two originals verbatim from `20260429165344:14-21`. (The `has_permission` REVOKE/GRANT is left in place on rollback — it is a hardening with no behavior regression for authenticated users; noted in the mirror.)

**AC (battery + e2e).** Staff without `settings.manage` update → 42501 (Shape A); staff WITH override → allowed (Shape B); admin → allowed; any-authenticated SELECT unchanged; admin inventory-toggle e2e green. Old-bundle staff writes toast-fail post-migration (rare, census-verified, accepted). **Effort:** S.

### 5.3 W5: Inline validation — react-hook-form + zod across settings tabs

Unchanged from v1 in substance. Scope order: (1) `BusinessAccountTab.tsx` (name 1–100, slug regex `^[a-z0-9]+(-[a-z0-9]+)*$` 2–60, currency enum+passthrough, timezone enum, email, BD-friendly phone), (2) `CreateBusinessForm`, (3) `ProfileSettingsTab.tsx` (name 2–100, password min-8 letter+digit, confirm `refine`), (4) `BrandSettingsTab.tsx`, (5) `InvoiceSettingsTab`/`PosSettingsTab`/`OrdersSettingsTab`/`MeasurementsTab` (`z.coerce.number()` ranges), (6) `OrderSourcesTab`/`PreOrderCategoriesDialog` (name required).

Pattern: shared `src/lib/settingsSchemas.ts` (+ SLUG/BD_PHONE regexes, `src/test/settingsSchemas.test.ts`); per-tab `useForm` + `zodResolver`, `mode:"onBlur"`; **RHF owns validation + field errors only — save flows (audit logging, 23505 mapping, toasts) untouched**; `form.formState.isDirty` becomes the single dirtiness source (drives SaveButton disabled + W6). Server errors stay toasts. 3 incremental PRs. AC: inline `<p role="alert">` on blur; valid-input behavior unchanged (existing flows green); schema table tests. **Effort:** M–L (2–3d).

### 5.4 W6: Dirty-state guard — scoped honestly (F5), chokepoint created (CRITIQUE-v2 #12)

**Goal.** Switching settings tabs (or closing/reloading) with unsaved edits prompts Discard/Stay instead of silent loss.

**Scope (explicit):** in-page tab switch (desktop + mobile drill-down back path, both via a **newly created** `handleTabChange`) + `beforeunload` (close/reload). **NOT in scope:** SPA route navigation away from `/settings` — `useBlocker` requires a data router and this app uses `<BrowserRouter>` (App.tsx:164); the router migration is deliberately deferred (§11.12). A dirty-tab user who navigates to `/orders` loses edits silently — **documented gap**, visible in the tab-UI only.

**Current-file fact (verified, CRITIQUE-v2 #12):** there is no `handleTabChange` today — three raw `setActiveTab` call sites exist: `SettingsPage.tsx:245` (`setActiveTab(null)`, mobile back), `:303` (mobile list), `:356` (desktop list). `:114` (initial auto-select of the first tab) is not a user action and stays direct.

**Design.** Create `handleTabChange(next: string | null)` in `SettingsPage.tsx` and route **all three** user-facing call sites (:245, :303, :356) through it. `SettingsFormContext` provides `registerDirty(tabId, isDirty)`; RHF tabs report `formState.isDirty`; immediate-save tabs register `false`. `handleTabChange(next)` → if dirty, shadcn `AlertDialog` "You have unsaved changes — Discard / Stay". `beforeunload` listener active while any tab dirty. Save success → `reset(savedValues)` clears dirty. Mobile back-button path (`setActiveTab(null)`) routes through the same guard — the `null` case is explicitly handled, so the mobile path cannot be missed. Files: `src/pages/SettingsPage.tsx`, W5-converted tabs, `src/hooks/useSettingsDirty.ts` (+ unit test).

**AC.** (1) Playwright: edit Business Name → click Orders tab → dialog; Discard switches (edits gone, no toast-lie); Stay keeps edits. (2) Clean switch across 5 tab hops → dialog count 0. (3) After save → immediate switch, no dialog. (4) Dirty + mobile back → dialog (the :245 path — regression-pinned because the v2 design text missed it). (5) Dirty + reload attempt → `beforeunload` dialog (Playwright `page.on('dialog')`). Route-level blocking removed (F5). **Effort:** M (1–1.5d). Depends: W5.

### 5.5 W7: User Access Dialog — per-business scoping

Unchanged in substance from v1; corrections: role changes now actually propagate (RT §2.5 made the publication fix). Design: RPC `get_member_access(p_user, p_business)` → `(business_role, store_ids, effective_perms)`, RPC `set_member_business_role(p_user, p_business, p_role)`, plus `get_my_managed_businesses()` — **three** SECURITY DEFINER RPCs, `REVOKE`/`GRANT` house pattern, internal `can_manage_business_access` assertion, role allow-list, last-owner protection via `business_has_other_owner` (lock-protected, F17) — **the RPC guards mirror the W1a RLS guards exactly** (elevation + last-owner), so PostgREST-direct and RPC paths enforce one policy. Server-side audit insert (fallback client-side `logChange` if the `audit_log` insert policy blocks definer writes — verify in harness). Platform permissions/stores tabs remain platform-global (§11.1). Dialog availability gated by `can_manage_business_access` for the active business (surfaced via `get_my_managed_businesses()`). Member **lists** come from `get_member_access` — direct SELECT of other members' rows is neither needed nor permitted (§2.1 AC-15).

**Files.** Create `supabase/migrations/20260911000500_business_member_access_rpcs.sql` (+ rollback mirror = **three** `DROP FUNCTION`s — `get_member_access`, `set_member_business_role`, `get_my_managed_businesses`); modify `src/components/team/UserAccessDialog.tsx` (new "Business Access" first tab), `src/pages/TeamManagement.tsx` (pass active business, gate button).

**AC.** (1) Owner of A opens dialog for member M → badge "A: viewer"; change to `member` → persists + audit row + **the affected member's client reflects the change within 5s via realtime** (their own row's event; refresh-fallback assertion if the local stack's realtime is flaky). (2) Non-manager staff → Business Access tab read-only. (3) Harness: `set_member_business_role` as non-manager → RPC raises. (4) Sole-owner self-demotion → RPC error "cannot demote the last owner" (harness) — same outcome as the RLS path (AC-9). (5) Existing tabs e2e regression green. **Effort:** M–L (2d). Depends: W1a helpers, RT.

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

### 5.7 W9: Optional TOTP 2FA — one design, no contradictions (F14, F19, F22, CRITIQUE-v2 #7)

**Goal.** My Profile → 2FA section: enroll (QR + verify), challenge on next sign-in, disable-with-re-auth. Supabase Auth MFA via **`@supabase/supabase-js` ^2.101.1 (installed — `auth.mfa` namespace: `auth.mfa.enroll/.challenge/.verify/.unenroll`)**; `signInWithPassword` returns `mfa_required` → Login.tsx grows a 6-digit `input-otp` step (`input-otp` **already installed**, ^1.4.2 — no new dependency).

**Single design (F14):** **no `app_settings` flag, no `req_mfa` helper, no DB at all.** Enrollment is offered client-side to users holding platform `admin` or `team.manage` (small audience, low support burden); enforcement (RLS/JWT `amr`) remains a documented non-goal (§11.6).

**TOTP in tests (F22):** in-repo `src/test/totp.ts` — ~15-line WebCrypto HMAC-SHA1 RFC-6238 generator, dev-only, no `otplib`.

**Files.** Modify `src/components/settings/ProfileSettingsTab.tsx` (2FA card: AAL via `getAuthenticatorAssuranceLevel`, enroll dialog with QR `svg`, factor list, disable with `signInWithPassword` re-auth → `unenroll`); modify `src/pages/Login.tsx` (step 2 on `mfa_required`: input-otp → `challenge` + `verify` → AAL2 redirect); create `src/lib/mfa.ts` (`hasMfaPending` error-parse + thin wrappers) + `src/test/mfa.test.ts` + `src/test/totp.ts`.

**AC.** (1) Unit: `parseMfaError` extracts factor id from `mfa_required` shape; non-MFA errors pass through. (2) E2e on local stack (TOTP via the WebCrypto helper): enroll → sign out → sign in → code step → AAL2 (`getAuthenticatorAssuranceLevel` assert in fixture); **manual runbook fallback if the harness can't drive it** (F19). (3) Disable requires password; wrong password → inline error. (4) Non-enrolled user: zero login UI change. Assumption to verify at implementation: supabase-js ^2.101.1 exposes `mfa_factor_id` on the `mfa_required` sign-in error (critique could not inspect `node_modules`; unit test pins the shape we parse).

**Effort:** L (3d). Depends: W8 (re-auth pattern + profile section layout).

---

## 6. Rollout timeline (3 releases)

| Release | Contents | Migrations | Days | Gate |
|---|---|---|---|---|
| **R1 (P0)** | W0 harness + W1a + RT + W1d + W1b + W1c | `…00100` `…00110` `…00120` `…00130` | **4–7** (CRITIQUE-v2 #10) | Migration replay verified (§4.1); RLS battery green; prod rogue-owner + ownerless-business audits run & clean; policy-name pre-flight clean (§2.6 step 2); runbook §2.6 followed; smoke green |
| **R2 (P1)** | W2a + W2b + W2c + W2d | none | 4–10 | Screenshot zero-delta for BDT; scoped `৳`-sweep = 0 (F11 exemption); scoped `omnisync-` grep = 0 |
| **R3 (P2)** | W3, W4, W5, W6, W7, W8, W9 | `20260911000400` (app_settings) `20260911000500` (member RPCs) | 11–20 | **W4 census passed pre-MERGE (§5.2)**; W9 role-gated; W8 toggle verified |

Ordering rules: DB expand (RPC/publication) → frontend contract → tighten, all within R1's runbook; W5→W6; W1a→W7; W2d lands before W5/W6 touch the same files (rebase churn); every release tolerates old bundles per §0.2. **Merge discipline (CRITIQUE-v2 #9):** a Release-3 migration file is merged to `main` only inside its own release window, after its gate has passed — no file sits on `main` waiting for a later "deploy day", because any `db push` applies what `main` holds.

## 7. Testing matrix (summary)

| Item | vitest | RLS battery (SQL) | Playwright (local stack) |
|---|---|---|---|
| W0 | — | harness itself | fixtures smoke |
| W1a | — | 15 assertions + concurrency step | — |
| W1d | — | 3 assertions | viewer read-only, owner save (2) |
| RT | — | idempotency + membership | own-row realtime event (1) |
| W1b/W1c | slugify/error-map | 4 assertions | admin create + dup-slug + staff-denied (3) |
| W2a | — | — | fresh-context no-write + redirect (2) |
| W2b | — | — | sync button (1) |
| W2c | build/tsc | — | — |
| W2d | currency table + parameterized invoiceHtml | — | BDT screenshot ×2, USD switch ×1 |
| W3 | — | — | viewer denied / admin ok (2) |
| W4 | — | 4 assertions | admin inventory toggle regression (1) |
| W5 | settingsSchemas (~30 cases) | — | inline error on blur ×2 |
| W6 | useSettingsDirty | — | discard/stay/clean/mobile-back/beforeunload (5) |
| W7 | — | 4 assertions | role change + realtime + non-manager gate (2) |
| W8 | wrong-pass handler | — | happy + wrong-pass (2); confirmation = e2e-or-manual |
| W9 | mfa error-parse + totp util | — | enroll→challenge→AAL2 (1) or manual runbook |

## 8. Effort summary

| Item | Size | Days |
|---|---|---|
| W0 harness (incl. replay contingency ±2d) | M–L | 1–2 (+≤2) |
| W1 P0 security (a+d+RT+b+c) | M–L | 3–3.5 (battery grew to 15 assertions) |
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
| **Total** | | **~19–21 dev-days** (single senior dev, ~4 calendar weeks with review) |

## 9. Risk register

1. **Historical migrations don't replay from zero** (likely — lovable-era backfills). Mitigation: W0 step 0 makes it the first gate, with the schema-dump baseline fallback (§4.1) so the RLS battery ships regardless.
2. **W1 tightening breaks an untraced writer.** Mitigation: `grep` of compiled bundle for `user_business_access`/`businesses` client writes + `audit_log` write-source census pre-deploy + battery regression (W1a AC-14).
3. **Old cached bundles hit tightened policies.** Mitigation: same-release frontend gating (W1d), corrected per-actor analysis (§2.1 risks: admin bundles unaffected, staff bundles fail today as they fail post-migration), error toasts accepted for rare writes (§0.2), runbook smoke.
4. **Realtime visibility under narrowed SELECT policy.** Mitigation: own rows stay readable (`user_id = auth.uid()` term in the untouched SELECT policy); RT e2e asserts own-row delivery post-`…00110`.
5. **W2d 48-file fan-out.** Mitigation: 5 area PRs + BDT screenshot zero-delta gate.
6. **W4 locks real staff writers out.** Mitigation: corrected 90-day census run **pre-merge** (only `settings_inventory` + `settings_preorder_categories`); overrides or defer.
7. **W8/W9 harness prerequisites (mail catcher, TOTP).** Mitigation: named manual fallbacks (§4.3), unit coverage never manual.
8. **TOCTOU last-owner race.** Mitigation: `FOR UPDATE` helper on the now-reachable guard paths (§2.1); deadlock-abort of one side accepted (40P01); platform-admin repair runbook.
9. **Playwright wrapper extensibility unverified.** Mitigation: replace with direct config if `webServer`/`baseURL` don't pass through (isolated change).
10. **auth.users fixture recipe drifts with local GoTrue schema** (column NOT NULLs). Mitigation: W0 implementer verifies against the replayed local schema; fixtures are reset-wiped and idempotent, so recipe fixes are cheap.
11. **Policy drift between repo and prod** (a policy name existing in prod but not in migrations). Mitigation: runbook §2.6 step-2 `pg_policies` pre-flight before R1 push.

## 10. Hard edges (what must precede what)

- W0 (incl. replay verification) → everything testable.
- W1a → W1b → W1c, **one release window, one runbook** (§2.6); W1d + RT travel with them (migration order …00100 → …00110 → …00120 → …00130 — W1d depends on W1a's `can_manage_business_access`).
- W1a → W7 (helpers); RT → W7-realtime AC.
- W2a before W2b (relocation then relabel; W2a's AC is true at W2a time — F9).
- W2d before W5/W6 (same files; avoid rebase churn).
- W5 → W6 (isDirty source). W8 → W9 (re-auth pattern).
- W3, W4, W8 fully independent. **W4's census precedes W4's MERGE, not merely its deploy** (§5.2, CRITIQUE-v2 #9).

## 11. Deliberately NOT doing in this plan

1. Per-business permission semantics (the ~40 granular permissions stay platform-global; W7 delivers role-per-business only).
2. Auto-migration of `invoice_settings` copy into `businesses`; sidebar legacy fallback (`AppSidebar.tsx:92-101`) stays until business-count-zero users are extinct.
3. Storefront currency unification (`src/storefront/lib/useCurrency.ts` + `storefronts.currency` stays per-storefront).
4. New `storefronts.view` permission enum (reuse `integrations.view`).
5. Backfill of persisted ৳-strings in `dueCollection`/`orderTimeline` history (symbol frozen at write time — §3.4).
6. Forced MFA enforcement (RLS/JWT `amr` layer) — enrollment + login challenge only.
7. 2FA recovery/backup codes — admin unenroll runbook instead.
8. P3 items: VAT/tax, notification center, bKash/Nagad/SSLCommerz gateways, Bangla i18n, billing, webhooks UI, invite expiry, UserAccessDialog atomic wipe-and-reinsert rework.
9. CI pipeline — **no PR-gating CI exists**; the repo's three GitHub Actions workflows (`pathao-tracking.yml`, `sync-worker.yml`, `woo-sync-all.yml`) are scheduled worker jobs, not PR gates (CRITIQUE-v2 #6). The harness runs locally; CI integration is separate infra work.
10. `team-manage` edge function changes — server-side moves use SECURITY DEFINER RPCs.
11. Editing historical migrations — append-only files per house convention (replay repairs go in new files or the baseline-dump fallback, §4.1).
12. **Router migration to `createBrowserRouter`** (would enable route-level dirty blocking). Deferred: whole-app routing regression risk for a settings-only benefit; W6 ships in-page + `beforeunload` and documents the SPA-navigation gap (F5). Revisit if more blocker use-cases appear.
13. **Self-serve business creation** (any authenticated user creates/owns businesses). Deferred as an explicit product decision requiring sign-off + spam controls (cap per user, rate limit, updated copy) — NOT hidden inside the W1 security fix (F3). W1b preserves current admin-only semantics.
14. LocalStorage cleanup/migration for inert `omnisync-*` keys (beyond the three retired keys, which are simply no longer written).
15. **Manager SELECT on other members' `user_business_access` rows** — deliberately withheld (CRITIQUE-v2 #5). Member lists flow exclusively through W7's SECURITY DEFINER `get_member_access` RPC; the SELECT policy keeps today's own-rows-or-admin shape, so managers also receive no other-member realtime events.

## 12. Assumptions (with verification owner)

- Local Supabase stack (Docker Desktop) is available on this Windows dev box; `supabase status` exposes the local DB URL (W0 runner parses it). *(verify: W0 implementer)*
- 134-migration replay: unproven; W0 step 0 verifies with a stated contingency — not assumed clean (F6).
- Local `auth.users` insert recipe matches the replayed local GoTrue schema's NOT NULLs; the `on_auth_user_created` trigger's first-user branch is neutralized by the runner's `user_roles` re-seed (§4.2). *(verify: W0 implementer)*
- "Secure email change" toggle state and TOTP MFA plan availability: dashboard-only; verified as rollout checklist items (R3), with the single-confirm degradation path coded (W8).
- Local stack mail catcher API usable for the W8 confirmation e2e; else manual runbook (§4.3). *(verify: W0 implementer)*
- **`@supabase/supabase-js` ^2.101.1** (installed) exposes `mfa_factor_id` on the `mfa_required` sign-in error; unit test pins the parsed shape (W9). *(verify: W9 implementer)*
- `lovable-agent-playwright-config` passes `webServer`/`baseURL` through; else direct config replacement (§4.3). *(verify: W0 implementer)*
- `audit_log` insert permits definer-path writes for W7's server-side audit; else client-side `logChange` fallback (W7). *(verify: W7 implementer, harness test)*
- Prod deploy = Vercel preview → production; migrations applied via `supabase db push` **before** the Vercel promote for tighten+expand releases alike (runbook §2.6).
- Prod policy state matches the repo's migration history (checked via the §2.6 step-2 `pg_policies` pre-flight; drift stops the runbook before push). *(verify: release captain, R1 step 2)*
