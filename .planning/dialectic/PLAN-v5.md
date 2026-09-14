# PLAN-v5 — DokanOS Settings & Account Remediation (P0/P1/P2)

**Source of truth:** `DOKANOS-SETTINGS-AUDIT.md` (Sept 2026) · revised against `CRITIQUE-v4.md` (inherits all 27 CRITIQUE-v1, 13 CRITIQUE-v2, and 4 CRITIQUE-v3 resolutions — CRITIQUE-v4 Part A re-verified zero regressions on the v4 SQL and re-confirmed the v3-generation policy/rollback text; that SQL carries into v5 **byte-identical**: no policy, migration, rollback, or frontend text changed in v5 — every v4 finding lives in the verification layer, the test fixtures, or prose)
**Stack:** Vite + React 18 + TS + shadcn/ui SPA · Supabase (Auth/Postgres+RLS/Edge Functions/Storage) · Vercel
**Status:** PLANNING ONLY — nothing in this document is implemented.
**Scope:** Audit recommendations P0-1, P1-2/3/4, P2-5/6/7. P3 items out of scope (§11).
**v4/v5 verification note:** every SQL statement was re-checked against the live migrations at v3 time (policy-name sweep across all 134 files in `supabase/migrations/`; helper signatures read from source; `user_business_access.role` = `text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer'))` with `UNIQUE (user_id, business_id)` (20260904000100:44-53); `app_role` enum = `('admin','staff','viewer')`; `businesses.slug UNIQUE NOT NULL`). At v4 time the critique's evidence was independently re-verified against the repo: `SettingsPage.tsx` has exactly the four `setActiveTab` sites claimed (:100 decl, :114 auto-select, :245, :303, :356) and no `handleTabChange`; `BusinessAccountTab.handleSave` (:107-147) is a bare `.update({...}).eq("id", active.id)` destructuring only `{ error }` — no `.select()`, no count; the only src writers of `user_business_access` are `BusinessAccountTab.tsx:308` (INSERT) and `useBusinessContext.tsx:72` (SELECT) — **no client UPDATE/DELETE of that table exists in any bundle, old or new**. At v5 time no repo fact underlying the plan changed (the round-4 critique's spot-checks — policy-name census, fixture/allow-list verbatim matches, publication statements, writer census — all stand); v5's edits are confined to §4.2's Shape A′/Shape A templates, the battery fixtures, AC wording, the §7 shape counts, and the W2d snapshot numbers.

---

## Changes from v4 (every CRITIQUE-v4 finding → v5 resolution)

| # | Severity | Finding (summary) | v5 resolution |
|---|---|---|---|
| 1 | MAJOR | Shape A′'s survival assertion is **existence-only**, so UPDATE-shaped A′ assertions (W1a AC-8b, AC-9, W1d AC-1a, W4 staff-UPDATE) **false-PASS a wrongly-allowing policy** — a wrong-allow updates the row in place (it still exists, only values change), no P0001 is ever raised, and the R1 "battery green" gate clears a migration carrying the exact v2-class last-owner bug | **Fixed — the rowcount assert is now a mandatory part of the A′ shape, in every A′ test.** §4.2's Shape A′ is redesigned: inside the actor's block, **immediately after** the denied UPDATE/DELETE, `GET DIAGNOSTICS v_rc = ROW_COUNT; IF v_rc <> 0 THEN RAISE EXCEPTION 'FAIL: … was mutable/deletable (rowcount %)' USING ERRCODE='P0001';` — a wrongly-allowing policy affects ≥1 row and fails right there. The owner-side assert is strengthened for UPDATE-shaped tests to pin the guarded **value** (`role = 'owner'` / `businesses.name = <fixture constant>`), folded into the survival `NOT EXISTS`. The "**Optional** belt-and-braces" wording is deleted. Two verbatim templates are shown in §4.2 and carried in `_harness.md` — **A′-UPDATE** (rowcount + value-pinned survival) and **A′-DELETE** (rowcount + survival; survival alone would discriminate for DELETE since wrong-allow ⇒ row gone, but the rowcount assert is kept for one uniform copy-paste shape). Applied to **every** A′ assertion: W1a AC-6, 8a, 8b, 9; W1d AC-1a, 2a; W4 staff-UPDATE. The runner-spec invariant (§4.2 step 4) is restated: on a correct implementation A′ raises nothing; a P0001 `FAIL:` from A′ is always a real policy bug — the v4 template violated this for UPDATE-shaped tests, v5 restores it. §6's R1 gate and §2.6's R1 testing summary cite the strengthened shape. A one-time **negative control** at W0 (§4.2 self-check) re-introduces the v2 bug (drop the USING last-owner guard) and proves AC-9 now FAILs with `row was mutable` — the exact false-PASS scenario is demonstrably closed. |
| 2 | MINOR | `EXCEPTION WHEN OTHERS` in Shape A′ converts harness defects (typo'd column 42703, undefined table 42P01, syntax 42601) into passes — A′ was the only shape with a silent failure mode | **Fixed.** The A′ handler is narrowed to `EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN RAISE;` — 42501 is the only class both denial-mode worlds can legitimately produce (silent-skip denials raise nothing; grants-revoked and buggy WITH CHECK denials raise 42501), so nothing is lost and every harness defect now fails the file loudly like every other shape. The v4 rationale paragraph ("blanket `WHEN OTHERS` is safe because the survival assertion carries all the discriminating power") is **withdrawn** — it held only if the absorbed statement was the intended one — and replaced (§4.2). Step-0.5 note added: the probe stays a manual step; if ever scripted into the runner it gets the same narrowed handler. |
| 3 | MINOR | `businesses_test.sql`'s admin-DELETE (W1d AC-2b "allowed (persists)") cascade-destroys BIZ_A + its 5 seeded uba rows, and the runner's filename-order execution makes the flagship `user_business_access_test.sql` its downstream victim | **Fixed — throwaway-business option.** W1d AC-2b now deletes **`BIZ_THROWAWAY`** (fixed UUID, slug `harness-throwaway-a`), created by the connection owner at the top of `businesses_test.sql` (minimal columns per the replayed schema, W0-verified; `ON CONFLICT DO NOTHING` for rerun idempotency). **BIZ_A is never deleted by any battery statement.** §4.2's runner spec states the filename-order dependency explicitly (`app_settings` < `businesses` < `create_business_with_owner` < `member_access_rpc` < `realtime` < `user_business_access`) and the structural rule it enforces: an earlier file must never destroy or mutate a shared fixture a later file relies on; every persisting statement carries its paired cleanup or targets a fixture-neutral throwaway. |
| 4 | MINOR | AC-11's actor is unspecified — a **sole owner's** identity-mutation UPDATE of their own row is USING-invisible (0 rows), the trigger never fires, and Shape A's `FAIL` false-fails a correct implementation | **Fixed.** AC-11 names the actor: **OWNER_A2 (co-owner of A)** UPDATEs OWNER_A's row `SET user_id = '<SPARE_A_UUID>'` → trigger `check_violation` (23514). Visibility traced: OWNER_A2's USING passes (`can_manage_business_access` true as owner; `business_has_other_owner(A, OWNER_A)` true via OWNER_A2), so the row reaches the BEFORE UPDATE trigger, which fires before any constraint or WITH CHECK. SPARE_A is the mutation target (no uba row → no unique-pair ambiguity). Platform admin is the named alternative if the fixture matrix ever changes. |
| 5 | NIT | The `user_roles` seed matrix is referenced but never enumerated — a wrongly-seeded platform admin would flip multiple denials into silent false FAILs | **Fixed.** §4.2's fixture section now enumerates it: `ADMIN → 'admin'`; **every other fixture** (OWNER_A, OWNER_A2, UBA_ADMIN_A, MEMBER_A, VIEWER_A, OWNER_B, OUTSIDER, SPARE_A, SPARE_B) `→ 'staff'` — nothing else. Why stated: W1a/W1d's first disjuncts are `has_role(auth.uid(),'admin')`; if OWNER_A (or any non-ADMIN fixture, e.g. left over from `handle_new_user`'s first-user branch) held a platform-admin row, AC-1/2/3b/5b and W1d AC-1a/2a silently become **allowed** → false FAILs. The runner's post-seed `DELETE FROM user_roles … + explicit re-insert` makes this deterministic. |
| 6 | NIT | Shape A's verbatim template catches only `insufficient_privilege`, but scripted groups expect other classes (AC-11 → 23514; W1b AC-4 → 23502/23514); AC-2 has a hidden WITH-CHECK-before-constraint ordering dependency worth a footnote | **Fixed.** The Shape A template's handler is now errcode-parameterized: `EXCEPTION WHEN SQLSTATE '<expected>' THEN NULL; WHEN OTHERS THEN RAISE;` (named forms `insufficient_privilege`/`check_violation`/… allowed), with the expected-errcode table carrying the SQLSTATE per test. AC-2 footnote added (§2.1 AC-2): the `{VIEWER_A, A, 'owner'}` insert surfaces **42501, not 23505**, only because Postgres evaluates RLS WITH CHECK **before** constraint insertion — the `(VIEWER_A, A)` pair already exists; never "fix" a hypothetical 23505 into the fixture. |
| 7 | NIT | AC-14's "`useBusinessContext.refresh()` read path" is not executable inside a SQL battery; the §7 matrix miscounts Shape A (A×5 listed, but AC-11 is also A → 6) and the B listing is inconsistent | **Fixed.** AC-14 is now pure SQL (MEMBER_A's own-row count = 1, Shape-B-style verify); the `refresh()` read-path assertion moved to the Playwright layer and is absorbed into RT AC-2's e2e (§2.5). §7's W1a row recounted and made self-consistent: **A×6** (1, 2, 3b, 5b, 10c, 11) · **A′×4** (6, 8a, 8b, 9) · **B×8 groups / 11 asserts** (3a, 4, 5a, 7a–c, 10a, 10b, 10d, 12a–b) + B-style verify (14) · **C×1** (15) + manual concurrency step (13). W1d and W4 rows updated for the strengthened A′ and the throwaway. |
| 8 | NIT | W2d's snapshot numbers off by one file/one occurrence (actual: 204 `৳` in 49 operator files; storefront 0, not 1) | **Fixed.** Snapshot corrected everywhere (§1 graph, §3.4, §9 risk 5): **204 `৳` occurrences in 49 operator-app files** (largest: OrderDetailSheet 35, CartPanel 19, ShiftDialog 16; plus 3 in `src/test/invoiceHtml.test.ts`; storefront: **0** — the exemption is structural, not count-based). The implementation-time re-grep remains the canonical contract, as before. |

**Non-finding fold-ins (from CRITIQUE-v4's "assumptions I could NOT verify"):** #10 — explicit `BEGIN; … COMMIT;` inside forward migration files is novel for this repo and redundant under the CLI's own transaction wrapping → added to W0's checklist (§4.1): push one forward file locally, and if transaction warnings appear, strip the explicit blocks from the four new forward files before R1 (plan-authored text; never migration history). #11 — PostgREST's 0-row UPDATE response shape under `return=representation` → now an explicit assumption (§12) pinned by the W1d 0-row-guard vitest + e2e.

**Carried forward unchanged:** all CRITIQUE-v1 (F1–F27), CRITIQUE-v2 (#1–#13), and CRITIQUE-v3 (#1–#4 + NITs) resolutions. CRITIQUE-v4 Part C's verification stands for v5 unmodified: policy-name census airtight (zero 42710 surface), USING/WITH CHECK guard placement correct and correctly argued, W1a/W1d rollbacks verbatim-correct, deployment realism and old-bundle analysis sound, audit-completeness mapping complete, effort arithmetic and release windows unchanged, fixture viability (SPARE_A/B, `handle_new_user` neutralization) intact. **No policy, migration, rollback, or frontend SQL/TS text changed in v5.**

## 0. Guiding constraints (apply to every work item)

1. **Production, multi-user, existing data.** Every DB change is additive-first, idempotent (`DROP POLICY IF EXISTS` + `CREATE`, `IF NOT EXISTS` guards, publication-membership check via `pg_publication_tables`), carries a tested rollback, and never breaks a live session mid-request. Deploys: Vercel (SPA) + `supabase db push`.
2. **Old JS bundles are in the wild — two distinct failure modes, not one (corrected in v4, CRITIQUE-v3 #2).** A cached SPA may call policies that no longer permit its writes for days after a deploy. How a tightening surfaces depends on its **mechanism**:
   - **INSERT-class tightening (WITH CHECK):** the write raises `42501` → the client sees `error` → error toast. Rare, non-destructive, self-heals on refresh. This is the only class the old §0.2(b) "42501 toast" rule described.
   - **UPDATE-class tightening (USING):** the write **silently affects 0 rows** — the client sees `error: null`, and naively-written save paths fall through to a success toast and a false audit row while nothing persisted. **Fake success, materially worse than a toast.** Mitigations per item: same-release frontend gating (§0.2(c)), a 0-row detection guard in the new bundle's save path (W1d), and a census proving the exposed writer population ≈ 0 (W4).
   - (c) Frontend gating ships in the same release as the tightening it accompanies.
3. **Migrations are append-only** files in `supabase/migrations/` (134 existing, `YYYYMMDDHHMMSS_*.sql` — older files carry hash suffixes; cite by timestamp prefix). Historical migrations are never edited. **No rollback artifacts are ever placed in `supabase/migrations/`** — the Supabase CLI executes every `*.sql` there as a forward migration. Rollback SQL lives in comment blocks inside the forward file and mirrored at `.planning/rollbacks/<migration>.md` (CRITIQUE-v1 F1).
4. **Policy-name discipline (from v3).** Policy names are per-table and `CREATE POLICY` has no `IF NOT EXISTS`. Every `CREATE POLICY` in this plan either follows a `DROP POLICY IF EXISTS` of the same name or uses a name proven absent from all 134 migrations (v3 sweep: the only existing policies on `businesses`/`user_business_access` are the four foundation policies — `"Members can read businesses"` :355, `"Members can write businesses"` :358, `"Users can read own access"` :368, `"Users can write own access"` :371; `"Admins manage access"` was DROPped by the foundation itself and does not exist). All six new policy names and eight new function names re-confirmed absent by the round-3 critic's census.
5. **House RLS idiom:** `has_role(auth.uid(),'admin'::app_role)` (20260412161413:37-48 — SECURITY DEFINER STABLE, no REVOKE/GRANT, default PUBLIC EXECUTE), `is_business_member(business_id)` (20260904000100:56-67 — SECURITY DEFINER STABLE **with** `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO authenticated`), `has_permission(user, perm)` (20260420112330:169 — SECURITY DEFINER STABLE, no REVOKE/GRANT). New helpers introduced by this plan follow the REVOKE-then-GRANT idiom (including the W1a trigger function — every new function carries `SET search_path`); where we REVOKE an existing helper (W4's `has_permission`) that is a **behavior change** (anon loses default EXECUTE), verified safe (no anon callers) and labeled a tightening, not "normalization".
6. **Tests:** vitest (jsdom, existing config/glob) for units; Playwright for e2e; RLS assertions via a **plain-SQL harness** (no pgTAP) executed against the **local Supabase stack** (Docker Desktop prerequisite on this Windows box) — §4, with the four assertion shapes (A / A′ / B / C) fully specified and matched to the correct Postgres denial semantics (CRITIQUE-v3 #1; A′ strengthened in v5 — mandatory in-block rowcount assert, CRITIQUE-v4 #1). Vocabulary note: the local CLI gives a *local stack*, not platform "branches".
7. **Deps:** `react-hook-form`, `zod`, `@hookform/resolvers`, `input-otp` already installed. New dev-only additions: `pg` (harness runner DB client). No `otplib` (in-repo WebCrypto TOTP helper instead).
8. **Router fact (verified):** `src/App.tsx:3,164` uses plain `<BrowserRouter>` + `<Routes>`. `useBlocker` requires a data router and **cannot be used** in this app today. Nothing in this plan depends on it (§11.12).
9. **Release buckets are merge discipline (from v3).** A migration file merged to `main` will be applied by the next `supabase db push` from anyone, for any reason. Tightening migrations therefore merge only after their gate passes (census, audits) — see §6.

---

## 1. Dependency graph & ordering

```
Phase 0 (prep, 1–2 days, +≤2d replay contingency)
  W0  test harness (replay verification → denial-mode calibration → SQL RLS battery → Playwright local-stack fixtures)
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
  W2d shared useCurrency + de-hardcode ৳ (204 occurrences / 49 operator files)
        │
Phase 3 — P2 UX & parity [RELEASE 3, merge-gated per §0.9/§6]
  W3  /storefronts PermissionGuard          (independent)
  W4  app_settings staff-write tightening    (independent, DB-only, census-gated at MERGE time)
  W5  react-hook-form + zod in settings tabs
  W6  dirty-state guard (handleTabChange chokepoint unifies FOUR user-facing sites incl. W2a's redirect card + beforeunload; NO route-level claim, F5)
  W7  User Access Dialog per-business scoping (after W1a helpers + RT)
  W8  email change flow (correct semantics, F4)
  W9  TOTP 2FA (single design, F14; after W8 — shares re-auth pattern)
```

Critical path: **W0 → W1a → W1b → W1c → (W2d, W5, W6, W7)**. W1d/RT travel with W1a in Release 1. W2a/W2b/W2c/W3/W4/W8 parallelizable after Release 1.

Effort: S ≤ 0.5d · M ≈ 1–2d · L ≈ 3–5d.

## 2. W1 — P0: Close the multi-tenant escalation hole (Release 1)

### 2.0 Rollback storage policy (applies to every migration below)

- Forward files: `supabase/migrations/<ts>_<name>.sql`.
- Rollback SQL: embedded as a `/* ROLLBACK ... */` comment block at the end of the forward file, mirrored verbatim at `.planning/rollbacks/<ts>_<name>.md`.
- **Never** a `*.sql` file inside `supabase/migrations/` (F1). The repo has zero `.down.sql` files today; we keep it that way.
- Rollbacks are for broken deploys only. The W1a/W1d rollbacks re-open critical holes — running them requires the incident owner's explicit call plus reverting the matching frontend release in the same action.
- Every rollback mirror lists exactly the objects its forward file created/dropped — no more, no less.

### 2.1 W1a: RLS — `user_business_access` cannot be self-granted

**Goal.** No authenticated user can insert/update/delete a `user_business_access` row unless:
(a) they are a platform `admin` (unconditional — the recovery backstop), or
(b) they **manage** the target business (`owner`/`admin` of it) and the operation does not create or destroy the last owner, or
(c) they are deleting **their own row to leave**, which is denied only when they are the last owner.
Membership is never acquired client-side. The business retains ≥1 owner through every non-platform-admin path.

**Root cause (verified).** `20260904000100:371-374` — policy `Users can write own access` `FOR ALL … USING/WITH CHECK (user_id = auth.uid() OR has_role(...))` validates only the row's `user_id`: any authenticated user can insert themselves as `owner` on any business, and can update/delete their own row anywhere.

**Why the v2 shape was wrong (CRITIQUE-v2 #1, #3).** v2's DELETE put `business_has_other_owner` in a disjunct after `can_manage_business_access(...)` — for an owner, the manager check is TRUE, the OR short-circuits, and the guard is unreachable; the same FOR ALL-style manager branch also allowed a business-admin to delete/demote the sole owner, and the UPDATE `WITH CHECK` allowed owner self-demotion. v3 restructured so guards sit on the only paths that can reach them; CRITIQUE-v3 Part A hand-traced all five actor classes and confirmed the restructure correct. v4/v5 change nothing in the policy logic.

**Guard placement rationale (PG docs, CREATE POLICY).** *"Existing table rows are checked against the expression specified in `USING`, while new rows that would be created via `INSERT` or `UPDATE` are checked against the expression specified in `WITH CHECK`."* Since `role` is the only mutable column of this table (identity columns are trigger-locked below), an UPDATE "demotes an owner" **iff** the existing row has `role = 'owner'` and the mutation is not a pure no-op — a condition fully expressible on the USING (existing-row) side. Deliberately no `OLD` references inside `WITH CHECK`. Consequence (accepted, documented): a non-admin cannot update **any** column of the last owner's row, including a meaningless `owner→owner` no-op; platform admins are exempt (first disjunct).

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
-- NIT-8c: SET search_path added — every new helper carries it, per §0.5.
CREATE OR REPLACE FUNCTION public.user_business_access_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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
| `member`/`viewer` | none | none (USING filter → 0 rows) | allowed (leave; an owner exists ≠ them) | none |
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

**Acceptance criteria (RLS battery, §4 — shapes per §4.2's corrected denial model; every Shape A′ in its strengthened v5 form with the mandatory in-block rowcount assert, CRITIQUE-v4 #1).** Executed as different simulated users via `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims`:

1. **(Shape A — WITH CHECK raises)** Viewer of business A inserts own row as `owner` on arbitrary business B → **denied** (42501).
2. **(Shape A)** Viewer of A inserts own row as `owner` on A (own business, not manager) → **denied** (42501). *Footnote (CRITIQUE-v4 #6): the `(VIEWER_A, A)` pair already exists in the fixture matrix; this surfaces **42501, not 23505**, only because Postgres evaluates RLS WITH CHECK **before** constraint insertion — never "fix" a hypothetical 23505 into the fixture.*
3. **(Shape B / Shape A)** Owner of A inserts `{SPARE_A, A, 'member'}` → allowed (Shape B verify + paired cleanup). Owner inserts `{SPARE_A, B_other, 'owner'}` → **denied** (42501; persists nothing, so SPARE_A stays free).
4. **(Shape B)** Platform admin inserts any row → allowed.
5. **(elevation symmetry; Shape B / Shape A)** Business-admin of A inserts `{SPARE_B, A, 'member'}` → allowed (cleanup); `{SPARE_B, A, 'owner'}` → **denied** (42501).
6. **(Shape A′-DELETE — template verbatim, strengthened per CRITIQUE-v4 #1)** Sole owner deletes own row → **denied** (last-owner lockout): in-block rowcount asserted `= 0` (a wrongly-allowing policy raises `FAIL: … was deletable (rowcount N)` right there) and the row **survives** owner-side; no 42501 is expected or required.
7. **(Shape B ×3 — 7a/7b/7c)** Owner deletes own row while a second owner exists → allowed (7a). Owner deletes another member's row → allowed (7b). Business-admin deletes another member's row → allowed (7c). Each carries its paired cleanup.
8. **(Shape A′ ×2 — 8a DELETE / 8b UPDATE, strengthened)** Business-admin deletes the **sole owner's** row → **denied** (DELETE USING branch-3 guard false → rowcount asserted 0, row survives owner-side) (8a); business-admin demotes the sole owner (`owner→member`) → **denied** (UPDATE USING guard false → rowcount asserted 0, row survives with `role='owner'` pinned) (8b).
9. **(Shape A′-UPDATE — template verbatim; the v2 Finding-3 headline case)** Sole owner self-demotes via UPDATE (`owner→member`) → **denied** (USING guard → in-block rowcount asserted 0 — a wrongly-allowing policy affects 1 row and raises `FAIL: … was mutable (rowcount 1)` exactly where v4's existence-only template would have false-PASSed — and the row survives with `role='owner'` pinned owner-side).
10. **(Shape B ×3 / Shape A ×1 — 10a–10d)** Owner demotes a co-owner (two owners present) → allowed (10a); business-admin demotes a co-owner (two owners present) → allowed (10b); business-admin updates member `viewer→owner` → **denied** (42501 — UPDATE **WITH CHECK** elevation violation genuinely raises) (10c); owner updates same → allowed (10d).
11. **(Shape A — trigger, 23514; actor named per CRITIQUE-v4 #4)** **OWNER_A2 (co-owner of A)** UPDATEs OWNER_A's row `SET user_id = '<SPARE_A_UUID>'` → trigger `check_violation`. Visibility trace: OWNER_A2's USING passes (manager of A; `business_has_other_owner(A, OWNER_A)` true via OWNER_A2), so the row reaches the BEFORE UPDATE trigger, which fires before any constraint or WITH CHECK; SPARE_A holds no uba row, so the mutation target has no unique-pair ambiguity. (Platform admin is the named substitute actor if the fixture matrix ever changes. A **sole owner** cannot reach the trigger — the USING filter hides their own row first — so the obvious sole-owner choice would false-fail a correct implementation.)
12. **(Shape B — documented exemption, 12a/12b)** Platform admin deletes the sole owner's row → allowed (12a); platform admin demotes the sole owner → allowed (12b) (asserted as the backstop behavior, so a future "fix" that silently removes the exemption is caught; each with its paired restore of the owner row).
13. **(manual two-session step, reworded per NIT-7)** Concurrent last-owner exit: two **co-owners** (OWNER_A, OWNER_A2) of business A concurrently self-delete (and, in a second run, self-demote) → at most one commits; the other either deadlock-aborts (40P01) **or** silently affects 0 rows after the first commits (READ COMMITTED re-evaluates USING against the committed state) → business retains ≥1 owner. Checklist lives in `_harness.md`.
14. **(SELECT regression — pure SQL, CRITIQUE-v4 #7)** Plain member own-row read: `SELECT count(*)` under MEMBER_A for their own row → **1**, identical pre/post (Shape-B-style verification as connection owner). (The React `useBusinessContext.refresh()` read path is asserted in the Playwright layer — absorbed into RT AC-2's e2e — a SQL battery cannot execute a hook.)
15. **(Shape C — SELECT narrowing, CRITIQUE-v3 #1)** Business-admin cannot SELECT another member's `user_business_access` row: `SELECT count(*)` under UBA_ADMIN_A for MEMBER_A's row → **0**; positive control: the same count under MEMBER_A for their own row → 1. (Member lists come only via W7's RPC.)

**Risks (corrected per CRITIQUE-v3 #2).**
- *No old-bundle failure surface from W1a itself (re-verified at v4):* the only client code touching `user_business_access` in any bundle is `BusinessAccountTab.tsx:308` (INSERT, admin two-step create) and `useBusinessContext.tsx:72` (SELECT) — **no client UPDATE/DELETE of this table exists**. An **admin's** old-bundle two-step create still passes both new `WITH CHECK`s (admin satisfies `has_role` on both tables) — unchanged behavior; a **staff's** old-bundle create fails at `businesses` INSERT — exactly as it fails today (the foundation's FOR ALL `WITH CHECK` already required `has_role OR is_business_member(new_id)`, necessarily false on insert). W1a therefore introduces **no new user-visible error surface**; the *new* old-bundle-visible tightening is W1d's (§2.2, with its corrected fake-success analysis and 0-row guard).
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

**Frontend consequence (same release; corrected per CRITIQUE-v3 #2).** `BusinessAccountTab.handleSave` (`BusinessAccountTab.tsx:107-147`) currently lets any member save **and** is a bare `.update({...}).eq("id", active.id)` destructuring only `{ error }` — under the tightened UPDATE policy a member's write is a **silent 0-row no-op** (`error: null`), which today's code would follow with a success toast and a false `business_account` audit row. Two changes to `src/components/settings/BusinessAccountTab.tsx`:
1. **Gating (primary):** derive `myRole` for the active business from `useBusinessContext`'s own access rows (own-row SELECT stays readable); when `myRole` is `member`/`viewer` (and caller not platform admin): fields read-only, SaveButton disabled, hint "Business details are managed by the business owner or an admin."
2. **0-row guard (defense-in-depth, new in v4):** change the update call to `.update({...}).eq("id", active.id).select("id")`; when `!error && (!data || data.length === 0)` → `toast.error("Your changes could not be saved — you may not have permission to edit this business.")`, **no** `logChange`, **no** success toast, early return. This also covers genuine concurrent races (row deleted mid-edit). Verified by a small vitest on the extracted save helper with a mocked client returning `{ data: [] }` and `{ error: null }`.
Old cached bundles: a member saving post-migration gets **silent fake success** (success toast, nothing persisted, false audit row) — rare (members editing business details), non-destructive, self-heals on reload, accepted per §0.2's UPDATE-class rule with the same-release gating as the primary mitigation and the new-bundle 0-row guard as defense-in-depth.

**Acceptance criteria (RLS battery + e2e — shapes per §4.2; every Shape A′ in its strengthened v5 form, CRITIQUE-v4 #1).**
1. **(Shape A′-UPDATE / Shape B / Shape B — 1a/1b/1c)** Member of A UPDATE businesses A (`SET name = …`) → **denied** (1a: in-block rowcount asserted 0 — a wrongly-allowing policy raises `FAIL: … was mutable`; owner-side survival assert pins `businesses.name = 'Biz A Fixture'` — bare existence cannot discriminate an UPDATE-shaped denial); owner of A → allowed (persists) (1b); platform admin → allowed (persists) (1c).
2. **(Shape A′-DELETE / Shape B — 2a/2b)** Member or owner DELETE businesses A → **denied** (2a: rowcount asserted 0, row survives, and the owner-side assert re-counts business A's five seeded uba rows = 5 — the 9 cascade children untouched); platform admin DELETEs **`BIZ_THROWAWAY`** (2b: allowed, persists — CRITIQUE-v4 #3: deleting `BIZ_A` here would cascade-wipe the 5 seeded uba rows for A and destroy the flagship `user_business_access_test.sql`, which the runner executes later in filename order; the throwaway (fixed UUID, slug `harness-throwaway-a`) is created by the connection owner at the top of `businesses_test.sql` — minimal columns per the replayed schema, W0-verified; `ON CONFLICT (slug) DO NOTHING` for rerun idempotency — and deliberately never restored).
3. Any member SELECT businesses A → unchanged (regression; read policy untouched).
4. Owner edits name/currency via Business Account tab e2e → persists + audit log row.
5. Viewer e2e: fields disabled, no save button, hint visible.
6. New-bundle 0-row guard vitest: mocked client `{ data: [], error: null }` → error toast, no audit call, no success toast.

**Effort:** M (0.5 SQL + 0.5 frontend gating + guard).

### 2.3 W1b: `create_business_with_owner` RPC — admin-only, validated (CRITIQUE-v1 F3/F15/F18; NIT-8a/8b fixed)

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
  v_name text := btrim(p_name);   -- NIT-8b: normalize once; all checks + INSERT use v_name
  v_business public.businesses;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_role(v_user, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'business name is required' USING ERRCODE = '23502';
  END IF;
  -- NIT-8a: match W5's client-side cap — the RPC is the authoritative path.
  IF length(v_name) > 100 THEN
    RAISE EXCEPTION 'business name must be 100 characters or fewer' USING ERRCODE = '23514';
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
  VALUES (v_name, p_slug, p_logo_url, p_currency, p_timezone)
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

**Acceptance criteria.** (All are function-body `RAISE`s → exception-visible → Shape A applies.)
1. Platform admin calls RPC → business + owner row created atomically; pre-seeded slug collision → `23505` propagates, **no** orphan access row (connection-owner count in harness, Shape B).
2. Non-admin authenticated call → clean `42501 'Admin access required'`.
3. Anon call → denied.
4. Empty name, over-long name (101 chars), bad slug (`"My Slug!!"`), bad currency (`XYZ`), bad timezone (`Mars/Olympus`) → clean `23502`/`23514` errors, no partial writes. (Per CRITIQUE-v4 #6: the empty-name sub-case pins `23502`; the other four pin `23514` — each sub-case is its own Shape-A assertion with its own expected SQLSTATE.)

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
2. E2e (local stack, §4): member client's `useBusinessContext` receives a membership INSERT event **on their own row** within 5s of the harness inserting it via SQL — fails on main today, which is the bug being fixed. *(This e2e also carries the W1a AC-14 `useBusinessContext.refresh()` read-path assertion, moved here per CRITIQUE-v4 #7 — a React hook cannot execute inside the SQL battery.)*

**Effort:** S (0.25d).

### 2.6 Release 1 runbook (unambiguous, F16)

1. **Pre-deploy audit (prod SQL editor, read-only):**
   `select business_id, user_id, role from user_business_access where role='owner' and user_id not in (select user_id from user_roles where role='admin');`
   Investigate anything suspicious (possible prior abuse of the hole) before proceeding. Gate: reviewed, rogue rows removed if any. Also check for pre-existing ownerless businesses (guards assume the invariant): `select b.id from businesses b where not exists (select 1 from user_business_access a where a.business_id=b.id and a.role='owner');`
2. **Policy-name pre-flight:** confirm in prod that the **six** policy names v5 creates (`"Managers can add members"`, `"Managers can update member roles"`, `"Members can leave; managers can remove"` on `user_business_access`; `"Admins can insert businesses"`, `"Owners can update businesses"`, `"Admins can delete businesses"` on `businesses` — six, on the two tables) do not already exist: `select tablename, policyname from pg_policies where tablename in ('businesses','user_business_access');` — belt-and-braces against drift between this repo and prod.
3. **Push migrations** in order: `…00100` (uba policies) → `…00110` (publication) → `…00120` (businesses) → `…00130` (RPC). `supabase db push`, migration **first** — every new RPC/policy the frontend depends on exists before any bundle references it; the tightened policies break only the old bundles' rare writes (INSERT-class toasts per §0.2; UPDATE-class fake success mitigated per §2.2).
4. **Verify in SQL editor:** run the RLS battery's prod-safe spot-checks (a SELECT-policy read as a normal member; one `create_business_with_owner` attempt as admin on a throwaway slug, then delete it). **Plus the hosted-parity calibration (CRITIQUE-v3 #1):** as a normal member, attempt one policy-denied UPDATE (e.g. `update businesses set name=name where id='<any biz>'`) and record whether it is a **silent 0-row skip** (expected, standard Supabase default grants) or a `permission denied` error — matching the local calibration record (§4.2 step 0.5). Either mode is handled by the battery's shapes — and the A′ shape additionally proves **non-mutation** via the mandatory in-block rowcount assert, not merely persistence (CRITIQUE-v4 #1); the record closes the assumptions list.
5. **Vercel promote** the Release-1 frontend (W1c + W1d gating + 0-row guard).
6. **Post-deploy smoke (prod, admin account):** create a throwaway business via the form → switcher + owner row verified → delete it (admin DELETE now the only path — also smoke-tests W1d).
7. **Rollback (if broken):** run the embedded rollback blocks from `.planning/rollbacks/*.md` via SQL editor **and** Vercel-rollback the frontend in the same action. Never introduce a rollback file into `supabase/migrations/` (F1).

**Release-1 testing summary.** RLS battery: W1a AC-1..15 + concurrency step, W1d AC-1..3, W1b AC-1..4, RT AC-1 (§4, shapes A/A′/B/C — every A′ in its **strengthened v5 form**: mandatory in-block rowcount assert + owner-side survival/value assert, CRITIQUE-v4 #1). Vitest: `slugify` + RPC-error-mapping helper (`src/lib/businessHelpers.ts`, new) + W1d 0-row guard. Playwright (local stack): admin create-business happy path, duplicate slug, staff-denied, viewer read-only gating, realtime own-row membership event (RT AC-2).

**Release-1 risks.**
- Rogue historical rows from prior exploitation → step 1 gate + manual cleanup.
- Pre-existing ownerless businesses → step 1 second query + admin repair (insert an owner row) before push.
- Realtime publication add slightly increases WAL volume → negligible (small table).
- `FOR UPDATE` guard may deadlock-abort a genuinely concurrent double-owner-exit → one user sees a transient error, retries; platform admin can always repair membership (documented; accepted, F17).

## 3. Phase 2 — P1: Collapse business identity (Release 2, frontend-only)

### 3.1 W2a: General tab slim-down + Print Header relocation (folded, F8/F9)

**Goal.** Kill the lying `omnisync-*` localStorage surface (`SettingsPage.tsx:117-134`), keep the General tab as theme + PWA install only, **and in the same work item** move `BusinessProfileTab` out of the `general` case-branch (`SettingsPage.tsx:181`) into its own `printheader` tab — one IA restructure, W2a's AC true at W2a time.

**Files.**
- Modify `src/pages/SettingsPage.tsx`: remove state lines 117–120 + `handleSaveGeneral` 122–134; General card keeps theme + `InstallAppButton`; add compact "Business basics" redirect card (name/currency/timezone rows reading **live** values from `useBusinessContext().active`, one Button → `handleTabChange("account")` — W6's chokepoint once it exists, `setActiveTab("account")` until then; **this call site is item 4 of W6's unification inventory**, §5.4, CRITIQUE-v3 #4); add `printheader` TabDef `{ id: "printheader", label: "Print Header", icon: Printer, description: "Business name/logo/contact on invoices", keywords: "invoice header logo print brand" }` (single string — real `TabDef` shape, F24); move `<BusinessProfileTab />` from `general` branch to `printheader` branch; mirror both branches in the mobile drill-down path.

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

**Goal.** One currency pipeline for the operator app: `businesses.currency` → `src/hooks/useCurrency.ts` → formatted output. Verified inventory, re-counted at round 4 (CRITIQUE-v4 #8): **204 `৳` occurrences across 49 operator-app files** (largest single files: `OrderDetailSheet.tsx` 35, `CartPanel.tsx` 19, `ShiftDialog.tsx` 16; plus 3 in `src/test/invoiceHtml.test.ts`; **storefront: 0** — the exemption is structural, not count-based). **The canonical source is the re-grep at implementation time:** `rg -c "৳" src/ --glob '!src/storefront/**'` — numbers above are the review-time snapshot, not a contract (F10).

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

**Risks.** 49-file fan-out → area PRs + screenshot gate; non-hook lib misuse → parameter injection only; persisted-string history → frozen-at-write decision above (explicit, not accidental).

**Effort:** M (2d).

## 4. W0 — Test harness (local stack; CRITIQUE-v1 F6/F19/F27, CRITIQUE-v2 #8, CRITIQUE-v3 #1/#2/#3, CRITIQUE-v4 #1–#7)

**Goal.** Minimal, runnable test additions: (a) SQL RLS battery, (b) Playwright auth+seed fixtures against the **local Supabase stack**. No pgTAP. No platform "branches" — the local CLI's local stack (Docker Desktop prerequisite on this Windows dev box) is the environment, full stop.

### 4.1 Step 0 — migration replay verification (F6)

`supabase start && supabase db reset` on a fresh local DB replays all 134 + new migrations. **This has never been demonstrated in this repo** (lovable-era + hand-written migrations embed live-data backfills, e.g. `20260904000100` DO block lines 447–612). W0 begins by running it and recording the result:
- **Clean replay:** harness proceeds; replay becomes a standing regression check on every `db reset`.
- **Replay fails anywhere:** choose (i) budget up to 2 days to repair/`IF EXISTS`-guard the offending historical migration **in a new migration file or config** (never editing history — if in-place repair is impossible, fall back to (ii)); or (ii) **schema-dump baseline**: `supabase db dump` (schema-only, from the linked prod after its next successful push) restored into the local DB as the harness baseline. Harness then tests policies against a schema-equivalent DB; the replay defect is recorded as tracked debt. The RLS battery is runnable either way; only its baseline provenance changes.
- **Explicit `BEGIN; … COMMIT;` in forward files (CRITIQUE-v4 unverified-assumption #10):** zero of the 134 existing migrations use a top-level `BEGIN;` and the Supabase CLI wraps each migration in its own transaction, so the plan-authored explicit blocks are at best redundant. During W0's first local push of one new forward file: if the CLI emits "transaction in progress" warnings, strip the explicit `BEGIN;`/`COMMIT;` lines from the four new forward files (`…00100`, `…00110`, `…00120`, `…00130`) before R1 — these are plan-authored text, never migration history, so stripping them is a plan edit, not a history edit.

### 4.2 RLS battery — plain SQL, no pgTAP (F27); mechanics fully specified against the CORRECT Postgres denial semantics (CRITIQUE-v2 #8, CRITIQUE-v3 #1, CRITIQUE-v4 #1/#2)

**Denial-semantics foundation (the v4 correction; A′ strengthened in v5, CRITIQUE-v4 #1).** Per `CREATE POLICY` docs: rows failing a **USING** expression (UPDATE/DELETE existing-row check, SELECT filter) are simply **not visible** — the statement affects **0 rows** and no error is raised. `42501 new row violates row-level security policy` is raised **only** by a failed **WITH CHECK** (INSERT, and UPDATE's new-row check), or an explicit `RAISE` (function bodies). Additionally (CRITIQUE-v3's unverified-assumption #1): no `REVOKE`/`ALTER DEFAULT PRIVILEGES` statements exist in any of the 134 migrations, so the standard Supabase default grant of ALL to `authenticated` is presumed in force and USING-side denials are silent skips — but the local bootstrap's behavior is confirmed empirically, not presumed (step 0.5). **Every assertion below is therefore keyed to the invariant it proves (persistence, rowcount, error class), not to a guessed error code for invisibility denials.** v5 strengthening: Shape A′ now carries a **mandatory in-block `GET DIAGNOSTICS` rowcount assert** on every USING-side UPDATE/DELETE test — bare persistence cannot discriminate an UPDATE-shaped denial from a wrongly-allowed update (a wrong-allow updates the row in place; the row still exists, only its values changed).

**Files.**
- Create `supabase/tests/rls/_harness.md` — documents the four assertion shapes (below) verbatim for copy-paste (no macros exist in plain SQL, so each test file uses the literal pattern) + the step-0.5 calibration record + the step-0.6 negative-control record + the AC-13 two-session checklist.
- Create `supabase/tests/rls/user_business_access_test.sql` (§2.1 AC-1..15 + concurrency-step script), `businesses_test.sql` (§2.2 AC-1..3, incl. the in-file `BIZ_THROWAWAY` creation), `create_business_with_owner_test.sql` (§2.3), `realtime_test.sql` (§2.5 AC-1), `app_settings_test.sql` (W4), `member_access_rpc_test.sql` (W7).
- Create `scripts/run-rls-tests.mjs` — Node runner (see runner spec below).
- `package.json`: `"test:rls": "supabase db reset && node scripts/run-rls-tests.mjs"` (no fabricated flags; reset applies migrations, runner seeds + asserts).

**Step 0.5 — denial-mode calibration (CRITIQUE-v3 #1 + unverified-assumption #1).** After `db reset`, before any test file is written: run one probe as an actor with zero visibility and record the outcome in `_harness.md`:

```sql
-- Probe: OUTSIDER (no membership anywhere) UPDATEs a business it cannot see.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<OUTSIDER_UUID>","role":"authenticated"}';
UPDATE public.businesses SET name = name WHERE id = '<BIZ_A_UUID>';
ROLLBACK;
```

Observed outcomes: **(a)** no error, 0 rows affected → silent-skip world (standard Supabase default grants — expected); **(b)** `42501 permission denied` → error world (grants revoked somewhere). Shape A′ below is **correct in either world** — and in v5 it additionally proves **non-mutation** via the mandatory in-block rowcount assert, not merely persistence (CRITIQUE-v4 #1). The record exists so future readers know which mode to expect and so a surprise mode change is noticed. The R1 runbook's step-4 spot-check repeats the calibration against hosted prod. The probe is a **manual** step; if it is ever scripted into the runner, it must get the same narrowed `WHEN insufficient_privilege THEN NULL; WHEN OTHERS THEN RAISE;` handler as Shape A′ (CRITIQUE-v4 #2).

**Assertion Shape A — denial-by-exception (WITH CHECK / RPC raise / trigger).** Used **only** where the expected denial genuinely raises: INSERT WITH CHECK violations, UPDATE WITH CHECK (elevation) violations, RPC body `RAISE`s, trigger `check_violation`, unique violations. The nested plpgsql block creates a subtransaction (implicit savepoint): the expected error is absorbed and the outer transaction stays healthy; a statement that unexpectedly *succeeds* raises `FAIL` (P0001), which is not caught and aborts the run. **The expected SQLSTATE is a per-assertion parameter of the handler (CRITIQUE-v4 #6)** — the template below shows the parameterized form:

```sql
-- W1a AC-2: viewer of A inserts own row as owner on A → INSERT WITH CHECK → 42501.
-- <expected> is per-assertion: AC-11 → '23514' (check_violation); W1b AC-4 →
-- '23502' (empty name) or '23514' (slug/currency/timezone) per sub-case — see
-- the expected-errcode table. Named condition forms (insufficient_privilege,
-- check_violation, …) are allowed in place of SQLSTATE literals; any OTHER
-- errcode escapes the handler and fails the file (correct).
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<VIEWER_A_UUID>","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_business_access (user_id, business_id, role)
    VALUES ('<VIEWER_A_UUID>', '<BIZ_A_UUID>', 'owner');
    RAISE EXCEPTION 'FAIL: W1a-AC2 viewer self-insert unexpectedly succeeded'
      USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;  -- insufficient_privilege: WITH CHECK denial — expected
  END;
END $$;
ROLLBACK;
```

**Expected-errcode table (corrected — exception shapes only).** INSERT/UPDATE **WITH CHECK** policy denials and RPC `RAISE … ERRCODE '42501'` → `insufficient_privilege` (42501); identity-mutation trigger → `check_violation` (23514); RPC validation raises → `not_null_violation` (23502)/`check_violation` (23514) as raised; unique slug → `unique_violation` (23505). The Shape-A handler pins exactly one expected SQLSTATE per assertion (template above); a *different* unexpected errcode is not caught → runner fails the file (correct). **USING-side UPDATE/DELETE denials and SELECT narrowing never appear in this table — they never raise (standard grants) and are asserted by Shapes A′/C.**

**Assertion Shape A′ — deny-by-invisibility (USING-side UPDATE/DELETE), strengthened in v5 (CRITIQUE-v4 #1/#2).** The denied statement runs under the actor's role with errors absorbed (silent skip is the expected manifestation on default grants; a privilege error is an acceptable alternative denial — the invariant is **non-mutation**, not the error surface). **Two mandatory discriminators, both part of the shape — never optional:**

1. **In-block rowcount assert** — immediately after the absorbed statement, inside the actor's block: `GET DIAGNOSTICS v_rc = ROW_COUNT; IF v_rc <> 0 THEN RAISE EXCEPTION 'FAIL: …' USING ERRCODE = 'P0001'; END IF;`. This is the **only** discriminator that catches a **wrongly-allowing policy on UPDATE-shaped tests**: a wrong-allow updates the row **in place** — the row still exists, only its values changed — so bare existence cannot distinguish denial from wrong-allow; only `rowcount = 0` fails it, right where it happens.
2. **Owner-side survival assert** (after `RESET ROLE`, connection owner, same transaction) — **value-pinned for UPDATE-shaped tests** (`role = 'owner'` / `businesses.name = '<fixture constant>'` / `app_settings.value = '<original>'`), plain existence for DELETE-shaped tests (for DELETE a wrong-allow removes the row, so existence alone discriminates; the rowcount assert is still included so every A′ test shares one copy-paste shape).

**Template A′-UPDATE (verbatim — W1a AC-9, the v2 Finding-3 headline case):**

```sql
-- Sole owner self-demotes (owner→member) → denied by USING invisibility.
-- Correct implementation: 0 rows affected, row survives with role='owner'.
-- No 42501 expected. A wrongly-allowing policy affects 1 row → P0001 HERE.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<OWNER_A_UUID>","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    UPDATE public.user_business_access SET role = 'member'
     WHERE business_id = '<BIZ_A_UUID>' AND user_id = '<OWNER_A_UUID>';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- error-world denial (grants revoked): 42501 — expected
    WHEN OTHERS THEN RAISE;                 -- harness defects (42703/42P01/42601/…) must fail loudly
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;         -- MANDATORY discriminator (CRITIQUE-v4 #1)
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1a-AC9 sole-owner row was mutable (rowcount %)', v_rc
      USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;  -- back to connection owner (sees all rows), same transaction
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id = '<BIZ_A_UUID>'
                    AND user_id    = '<OWNER_A_UUID>'
                    AND role       = 'owner') THEN        -- value-pinned survival
    RAISE EXCEPTION 'FAIL: W1a-AC9 sole-owner row missing or demoted'
      USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;
```

**Template A′-DELETE (verbatim — W1a AC-6):**

```sql
-- Sole owner deletes own row → denied by USING invisibility.
-- For DELETE, survival alone would discriminate (wrong-allow ⇒ row gone ⇒
-- FAIL), but the rowcount assert is kept so every A′ test shares one shape.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<OWNER_A_UUID>","role":"authenticated"}';
DO $$
DECLARE v_rc bigint;
BEGIN
  BEGIN
    DELETE FROM public.user_business_access
     WHERE business_id = '<BIZ_A_UUID>' AND user_id = '<OWNER_A_UUID>';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- error-world denial: 42501 — expected
    WHEN OTHERS THEN RAISE;                 -- harness defects must fail loudly
  END;
  GET DIAGNOSTICS v_rc = ROW_COUNT;         -- MANDATORY, uniform across all A′ tests
  IF v_rc <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1a-AC6 sole-owner row was deletable (rowcount %)', v_rc
      USING ERRCODE = 'P0001';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_business_access
                  WHERE business_id = '<BIZ_A_UUID>' AND user_id = '<OWNER_A_UUID>') THEN
    RAISE EXCEPTION 'FAIL: W1a-AC6 sole-owner row did not survive' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;
```

**Rationale (rewritten in v5 — v4's "blanket `WHEN OTHERS` is safe" paragraph is withdrawn, CRITIQUE-v4 #2).** Shape A′ asserts the invariant — the mutation did not happen — regardless of which mechanism denied it (silent skip on default grants, or a caught 42501 if grants were ever revoked). The two mandatory discriminators, in order: (1) the **in-block rowcount** assert fails a wrongly-allowing policy immediately (on UPDATE-shaped tests this is the only discriminator that works — see above); (2) the **owner-side survival** assert catches a wrong-allow that somehow slipped past (1) and, value-pinned, catches a wrong-allow with a `WHERE` that matched 0 rows on a first pass. The exception handler is **narrowed** to `WHEN insufficient_privilege THEN NULL` with `WHEN OTHERS THEN RAISE` — both error-world denial modes raise 42501, so nothing legitimate is lost, and v4's blanket absorb (which converted harness defects — 42703 undefined column, 42P01 undefined table, 42601 syntax — into silent passes) is gone: every harness defect now fails the file loudly, like every other shape. Nothing else can legitimately raise inside an A′ block: silent-skip denials raise nothing, and `trg_uba_immutable` is UPDATE-only while no A′ path touches identity columns.

**Mandatory in EVERY Shape A′ test** — no exceptions, no "optional" variants (v4's `Optional belt-and-braces` wording is deleted): W1a **AC-6** (A′-DELETE, template verbatim), **AC-8a** (A′-DELETE pattern, actor UBA_ADMIN_A, target OWNER_A's row), **AC-8b** (A′-UPDATE pattern, survival pins `role = 'owner'`), **AC-9** (A′-UPDATE, template verbatim — the headline case); W1d **AC-1a** (A′-UPDATE on `businesses SET name = …`, survival pins `businesses.name = 'Biz A Fixture'`), **AC-2a** (A′-DELETE on `businesses`, survival = existence + the five uba children re-counted); W4 **staff-UPDATE** (A′-UPDATE on `app_settings`, survival pins the settings `value = '<original>'`).

**Step 0.6 — battery self-check: negative control (one-time, CRITIQUE-v4 #1 closure proof).** Before trusting a green run, prove the battery fails in the dangerous direction. On the local stack, as the connection owner, re-introduce the v2-class bug — drop the USING last-owner guard:

```sql
DROP POLICY "Managers can update member roles" ON public.user_business_access;
CREATE POLICY "Managers can update member roles" ON public.user_business_access
  FOR UPDATE TO authenticated
  USING (can_manage_business_access(business_id, auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role)
              OR (can_manage_business_access(business_id, auth.uid())
                  AND (role NOT IN ('owner','admin')
                       OR my_business_role(business_id, auth.uid()) = 'owner')));
```

Re-run the battery. **Expected:** W1a AC-9 fails with `FAIL: W1a-AC9 sole-owner row was mutable (rowcount 1)` — the sole owner's self-demote now commits, and v4's existence-only template would have PASSed exactly this broken policy — W1a AC-8b fails likewise, and the runner exits non-zero. Then restore the correct state (`supabase db reset`) and confirm green. Record both outcomes in `_harness.md`. This demonstrates that the exact false-PASS scenario CRITIQUE-v4 Finding 1 identified is closed: the R1 gate can no longer clear a migration carrying the v2-class last-owner bug.

**Assertion Shape B — allow (statement + post-statement verification as connection owner).** The fixture actor's own-row SELECT cannot see other members' rows, so "it worked" is verified as the connection's owner role (sees all rows), then the fixture matrix is restored by the assertion's **paired cleanup**:

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
-- paired cleanup (Shape B tests deliberately persist; every one restores the
-- fixture matrix so assertions stay order-independent):
INSERT INTO public.user_business_access (user_id, business_id, role)
VALUES ('<OWNER_A_UUID>', '<BIZ_A_UUID>', 'owner');
```

**Assertion Shape C — SELECT narrowing (row-filter denials).** A SELECT denial is a **0-row result**, not an exception. Assert the count under the actor's role; keep an own-row positive control adjacent:

```sql
-- W1a AC-15: business-admin cannot SELECT another member's row.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<UBA_ADMIN_A_UUID>","role":"authenticated"}';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.user_business_access
   WHERE business_id = '<BIZ_A_UUID>' AND user_id = '<MEMBER_A_UUID>';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: W1a-AC15 manager saw another member''s row' USING ERRCODE = 'P0001';
  END IF;
END $$;
ROLLBACK;
-- positive control (runner runs adjacent, Shape-B verification): the same
-- count as MEMBER_A for their own row = 1.
```

**Fixture users (CRITIQUE-v3 #3 fix) and seed matrix (fully enumerated, CRITIQUE-v4 #5).** Fixed UUIDs, `ON CONFLICT (id) DO NOTHING`, wiped by the next `db reset`: `ADMIN`, `OWNER_A`, `OWNER_A2`, `UBA_ADMIN_A`, `MEMBER_A`, `VIEWER_A`, `OWNER_B`, `OUTSIDER`, **`SPARE_A`, `SPARE_B`** (new). **Seeded `user_roles` — enumerated, no inference:** `ADMIN → 'admin'`; **every other fixture** (OWNER_A, OWNER_A2, UBA_ADMIN_A, MEMBER_A, VIEWER_A, OWNER_B, OUTSIDER, SPARE_A, SPARE_B) `→ 'staff'` — and nothing else. Why stated: W1a/W1d's first disjuncts are `has_role(auth.uid(),'admin')`; if OWNER_A — or any non-ADMIN fixture, e.g. a row left over from `handle_new_user`'s first-user branch — held a platform-admin row, AC-1/2/3b/5b and W1d AC-1a/2a silently become **allowed** → false FAILs. The runner's post-seed `DELETE FROM public.user_roles … + explicit re-insert` (runner step 3) makes this deterministic. Seeded `businesses`: `BIZ_A` (fixed UUID, `name = 'Biz A Fixture'`) and `B_other` (fixed UUID, `name = 'Biz B Fixture'`) — the two name constants are what W1d AC-1a's value-pinned A′ survival assert pins; **`BIZ_THROWAWAY` (slug `harness-throwaway-a`) is NOT seeded here** — `businesses_test.sql` creates it in-file at the top as connection owner (CRITIQUE-v4 #3) and W1d AC-2b deletes it. Seeded `user_business_access`: A — OWNER_A/OWNER_A2 `owner`, UBA_ADMIN_A `admin`, MEMBER_A `member`, VIEWER_A `viewer`; B — OWNER_B `owner`. **`SPARE_A`/`SPARE_B` get `auth.users` rows (FK satisfied) but NO seeded `user_business_access` rows** — they exist solely as INSERT targets for the allow-INSERT assertions (W1a AC-3a pins `{SPARE_A, A, 'member'}`; AC-5a pins `{SPARE_B, A, 'member'}`; AC-3b's denial reuses SPARE_A against `B_other` and persists nothing). They are never actors. Without them, every candidate in-matrix target already holds a row (`23505` on the unique pair) or doesn't exist (`23503` on the FK) — the exact trap CRITIQUE-v3 Finding 3 identified. **`BIZ_A` is never deleted by any battery statement** (CRITIQUE-v4 #3).

**Runner spec (`scripts/run-rls-tests.mjs`).**
1. Shell `supabase status` (local stack), extract the DB URL via `/postgres(?:ql)?:\/\/\S+/`; fail fast if absent (Docker not running).
2. Connect with `pg` (**new devDependency**, dev-only) as the connection owner.
3. **Seed fixtures** (fixed UUIDs, `ON CONFLICT`-idempotent, wiped by the next `db reset`):
   - `auth.users` insert recipe per fixture user (all **ten** UUIDs incl. `SPARE_A`/`SPARE_B`):
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
   - **House-trigger interaction (documented):** `on_auth_user_created` → `handle_new_user` (20260412161413:140-143) fires per insert; fixture emails match no invitation, and the first-inserted fixture trips the first-user branch and receives a `'admin'` `user_roles` row (:129-133). The runner therefore, **after** all `auth.users` inserts: `DELETE FROM public.user_roles WHERE user_id IN (<all fixture uuids>);` then inserts the intended matrix explicitly (`user_roles(user_id, role)` — table def 20260412161413:17-22 — and the `user_business_access` rows listed above; SPARE_A/SPARE_B deliberately absent from the uba seed). Deterministic regardless of insert order or prior partial runs.
   - `businesses` rows: `BIZ_A` + `B_other` (fixed UUIDs, names `'Biz A Fixture'`/`'Biz B Fixture'`, unique slugs) — seeded here so every test file sees them; `BIZ_THROWAWAY` is created in-file by `businesses_test.sql`, not here (CRITIQUE-v4 #3).
4. Execute each `supabase/tests/rls/*.sql` in **filename order** (`app_settings_test` < `businesses_test` < `create_business_with_owner_test` < `member_access_rpc_test` < `realtime_test` < `user_business_access_test`) as a multi-statement batch; **fail on the first uncaught SQLSTATE error** (Shapes A guarantee expected errors never escape; Shapes A′/C never raise on a correct implementation — a P0001 from them is always a real policy bug; v5 note: for UPDATE-shaped A′ this invariant holds only because the rowcount assert is mandatory — v4's existence-only template silently PASSED the v2-class wrong-allow, which is exactly what the step-0.6 negative control now proves fixed); print `PASS/FAIL <file>` summary; exit non-zero on any failure. **Filename-order dependency (CRITIQUE-v4 #3), stated explicitly:** the flagship `user_business_access_test.sql` runs **last**; the structural rule this imposes is that an earlier file must never destroy or mutate a shared fixture a later file relies on — every persisting statement carries its paired cleanup or targets a fixture-neutral throwaway (W1d AC-2b deletes `BIZ_THROWAWAY`, never `BIZ_A`).
5. The concurrency step (W1a AC-13) ships as a documented two-session psql script the implementer runs once per battery run (cannot be expressed in the single-connection runner); its checklist lives in `supabase/tests/rls/_harness.md`.

### 4.3 Playwright (local stack) — prerequisites & honest scope (F19)

**Prerequisites, enumerated:** Docker Desktop running the local stack; `supabase status` healthy; `bun run dev` serving the app with env vars pointed at the **local** Supabase URL/anon key (Playwright `webServer` passes them); local stack's built-in mail catcher (InBucket/Mailpit on `:54324`) for W8. If any prerequisite is unavailable on a given day, the affected e2e specs degrade to **manual runbooks** — named per item below, not silently dropped.

**Files.** Extend `playwright-fixture.ts` (exists): `authedPage(userKey)` fixture — signs up/signs-in a seeded fixture user against the local stack, stores storageState; role/business seeding happens in the RLS runner seed (shared fixture UUIDs). Add `webServer` (`bun run dev`) + `use.baseURL`. **Assumption to verify in implementation (critique could not):** whether the `lovable-agent-playwright-config` wrapper passes `webServer`/`baseURL` through — if not, replace the wrapper with a direct Playwright config (small, isolated change; no product code touched).

**ACs that become manual if the harness can't carry them:** W8 email-confirmation click-through (manual runbook), W9 TOTP challenge e2e (manual runbook with the WebCrypto helper). RLS battery is never manual — it is the Release-1 gate.

**Effort:** M–L (1–2d, plus up to 2d replay contingency from §4.1).

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

**AC (battery + e2e — shapes per §4.2; the staff-UPDATE is A′ in its strengthened v5 form, CRITIQUE-v4 #1).** Staff without `settings.manage` INSERT → **42501 (Shape A** — WITH CHECK genuinely raises**)**; staff without override UPDATE → **denied (Shape A′-UPDATE, strengthened)** — in-block rowcount asserted `= 0` (a wrongly-allowing policy raises `FAIL: app_settings row was mutable (rowcount N)`) and the owner-side survival assert pins the settings **value unchanged** (`value = '<original>'`; a wrong-allow updates the row in place, so bare existence cannot discriminate); staff WITH override → INSERT/UPDATE allowed (Shape B); admin → allowed; any-authenticated SELECT unchanged; admin inventory-toggle e2e green. **Old-bundle failure mode (corrected):** stale staff bundles' INSERTs toast-fail post-migration (42501 — WITH CHECK raises); their UPDATEs are **silent no-ops with a success toast** (fake success, §0.2 UPDATE-class rule) — the 90-day census drives the exposed population to ≈ 0, so both are accepted as rare; no frontend change ships with W4 (it is DB-only by design; the settings UI's own writers are admin/override paths).

**Effort:** S.

### 5.3 W5: Inline validation — react-hook-form + zod across settings tabs

Unchanged from v1 in substance. Scope order: (1) `BusinessAccountTab.tsx` (name 1–100, slug regex `^[a-z0-9]+(-[a-z0-9]+)*$` 2–60, currency enum+passthrough, timezone enum, email, BD-friendly phone), (2) `CreateBusinessForm`, (3) `ProfileSettingsTab.tsx` (name 2–100, password min-8 letter+digit, confirm `refine`), (4) `BrandSettingsTab.tsx`, (5) `InvoiceSettingsTab`/`PosSettingsTab`/`OrdersSettingsTab`/`MeasurementsTab` (`z.coerce.number()` ranges), (6) `OrderSourcesTab`/`PreOrderCategoriesDialog` (name required).

Pattern: shared `src/lib/settingsSchemas.ts` (+ SLUG/BD_PHONE regexes, `src/test/settingsSchemas.test.ts`); per-tab `useForm` + `zodResolver`, `mode:"onBlur"`; **RHF owns validation + field errors only — save flows (audit logging, 23505 mapping, toasts) untouched**; `form.formState.isDirty` becomes the single dirtiness source (drives SaveButton disabled + W6). Server errors stay toasts. 3 incremental PRs. AC: inline `<p role="alert">` on blur; valid-input behavior unchanged (existing flows green); schema table tests. **Effort:** M–L (2–3d).

### 5.4 W6: Dirty-state guard — scoped honestly (F5), chokepoint created; inventory corrected for W2a's fourth site (CRITIQUE-v2 #12, CRITIQUE-v3 #4)

**Goal.** Switching settings tabs (or closing/reloading) with unsaved edits prompts Discard/Stay instead of silent loss.

**Scope (explicit):** in-page tab switch (desktop + mobile drill-down back path, both via a **newly created** `handleTabChange`) + `beforeunload` (close/reload). **NOT in scope:** SPA route navigation away from `/settings` — `useBlocker` requires a data router and this app uses `<BrowserRouter>` (App.tsx:164); the router migration is deliberately deferred (§11.12). A dirty-tab user who navigates to `/orders` loses edits silently — **documented gap**, visible in the tab-UI only.

**Call-site inventory (v4-corrected; re-verified at v4 against `SettingsPage.tsx`).** There is no `handleTabChange` today. Raw `setActiveTab` call sites: `:100` (declaration), `:114` (initial auto-select of the first tab — not a user action, stays direct), `:245` (`setActiveTab(null)`, mobile back), `:303` (mobile list), `:356` (desktop list). **Plus one planned site:** W2a (Release 2, earlier than W6) adds the General-tab "Business basics" redirect card whose button calls `setActiveTab("account")` at W2a time — a **fourth user-facing site** that the v3 inventory missed and exactly the kind that needs guarding (a user with dirty Business Account edits clicking the redirect card would silently discard them).

**Design.** Create `handleTabChange(next: string | null)` in `SettingsPage.tsx` and route **all four** user-facing call sites through it: `:245`, `:303`, `:356`, **and W2a's redirect card**. The redirect card's call is switched from raw `setActiveTab("account")` to `handleTabChange("account")` in the W6 diff (one line; W2a's own AC is unaffected). **Re-sweep rule:** at W6 time, re-run `rg "setActiveTab" src/pages/SettingsPage.tsx` — every user-facing hit (i.e., everything except the `:100` declaration and the `:114` auto-select) must route through the chokepoint; **the sweep is the inventory, not this prose list**. `SettingsFormContext` provides `registerDirty(tabId, isDirty)`; RHF tabs report `formState.isDirty`; immediate-save tabs register `false`. `handleTabChange(next)` → if dirty, shadcn `AlertDialog` "You have unsaved changes — Discard / Stay". `beforeunload` listener active while any tab dirty. Save success → `reset(savedValues)` clears dirty. Mobile back-button path (`setActiveTab(null)`) routes through the same guard — the `null` case is explicitly handled, so the mobile path cannot be missed. Files: `src/pages/SettingsPage.tsx`, W5-converted tabs, W2a's redirect-card call site, `src/hooks/useSettingsDirty.ts` (+ unit test).

**AC.** (1) Playwright: edit Business Name → click Orders tab → dialog; Discard switches (edits gone, no toast-lie); Stay keeps edits. (2) Clean switch across 5 tab hops → dialog count 0. (3) After save → immediate switch, no dialog. (4) Dirty + mobile back → dialog (the :245 path — regression-pinned because the v2 design text missed it). (5) Dirty + General-tab redirect-card click → dialog (the fourth site, CRITIQUE-v3 #4). (6) Dirty + reload attempt → `beforeunload` dialog (Playwright `page.on('dialog')`). Route-level blocking removed (F5). **Effort:** M (1–1.5d). Depends: W5, W2a.

### 5.5 W7: User Access Dialog — per-business scoping

Unchanged in substance from v1; corrections: role changes now actually propagate (RT §2.5 made the publication fix). Design: RPC `get_member_access(p_user, p_business)` → `(business_role, store_ids, effective_perms)`, RPC `set_member_business_role(p_user, p_business, p_role)`, plus `get_my_managed_businesses()` — **three** SECURITY DEFINER RPCs, `REVOKE`/`GRANT` house pattern, internal `can_manage_business_access` assertion, role allow-list, last-owner protection via `business_has_other_owner` (lock-protected, F17) — **the RPC guards mirror the W1a RLS guards exactly** (elevation + last-owner), so PostgREST-direct and RPC paths enforce one policy. Server-side audit insert (fallback client-side `logChange` if the `audit_log` insert policy blocks definer writes — verify in harness). Platform permissions/stores tabs remain platform-global (§11.1). Dialog availability gated by `can_manage_business_access` for the active business (surfaced via `get_my_managed_businesses()`). Member **lists** come from `get_member_access` — direct SELECT of other members' rows is neither needed nor permitted (§2.1 AC-15).

**Files.** Create `supabase/migrations/20260911000500_business_member_access_rpcs.sql` (+ rollback mirror = **three** `DROP FUNCTION`s — `get_member_access`, `set_member_business_role`, `get_my_managed_businesses`); modify `src/components/team/UserAccessDialog.tsx` (new "Business Access" first tab), `src/pages/TeamManagement.tsx` (pass active business, gate button).

**AC.** (1) Owner of A opens dialog for member M → badge "A: viewer"; change to `member` → persists + audit row + **the affected member's client reflects the change within 5s via realtime** (their own row's event; refresh-fallback assertion if the local stack's realtime is flaky). (2) Non-manager staff → Business Access tab read-only. (3) Harness: `set_member_business_role` as non-manager → RPC **raises** (Shape A — function-body RAISE, exception-visible). (4) Sole-owner self-demotion → RPC error "cannot demote the last owner" (harness, Shape A) — same outcome as the RLS path (AC-9, Shape A′). (5) Existing tabs e2e regression green. **Effort:** M–L (2d). Depends: W1a helpers, RT.

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

## 6. Rollout timeline (3 releases)

| Release | Contents | Migrations | Days | Gate |
|---|---|---|---|---|
| **R1 (P0)** | W0 harness + W1a + RT + W1d + W1b + W1c | `…00100` `…00110` `…00120` `…00130` | **4–8** (CRITIQUE-v3 #6: covers W0's ≤2d replay contingency + W1's 3–3.5d worst case) | Migration replay verified (§4.1); **RLS battery green — shapes A/A′/B/C per §4.2, with every A′ in its strengthened v5 form (mandatory in-block rowcount assert + owner-side survival/value assert on every USING-side denial, CRITIQUE-v4 #1)**; battery negative-control self-check passed (§4.2 step 0.6); denial-mode calibration recorded (§4.2 step 0.5); prod rogue-owner + ownerless-business audits run & clean; policy-name pre-flight clean (§2.6 step 2); hosted-parity calibration recorded (§2.6 step 4); runbook §2.6 followed; smoke green |
| **R2 (P1)** | W2a + W2b + W2c + W2d | none | 4–10 | Screenshot zero-delta for BDT; scoped `৳`-sweep = 0 (F11 exemption); scoped `omnisync-` grep = 0 |
| **R3 (P2)** | W3, W4, W5, W6, W7, W8, W9 | `20260911000400` (app_settings) `20260911000500` (member RPCs) | 11–20 | **W4 census passed pre-MERGE (§5.2)**; W9 role-gated; W8 toggle verified |

Ordering rules: DB expand (RPC/publication) → frontend contract → tighten, all within R1's runbook; W5→W6; W1a→W7; W2d lands before W5/W6 touch the same files (rebase churn); every release tolerates old bundles per §0.2 (INSERT-class toasts / UPDATE-class fake success, each item's exposure analyzed). **Merge discipline (CRITIQUE-v2 #9):** a Release-3 migration file is merged to `main` only inside its own release window, after its gate has passed — no file sits on `main` waiting for a later "deploy day", because any `db push` applies what `main` holds.

## 7. Testing matrix (summary)

| Item | vitest | RLS battery (SQL — shapes) | Playwright (local stack) |
|---|---|---|---|
| W0 | — | harness itself: step-0 replay + step-0.5 calibration + step-0.6 negative-control self-check | fixtures smoke |
| W1a | — | 15 assertions: **A×6** (1, 2, 3b, 5b, 10c, 11) · **A′×4** (6, 8a, 8b, 9 — strengthened form) · **B×8 groups / 11 asserts** (3a, 4, 5a, 7a–c, 10a, 10b, 10d, 12a–b) + B-style verify (14) · **C×1** (15) + manual concurrency step (13) | — |
| W1d | 0-row guard (mocked client) | 3 assertions: **A′×2** (1a, 2a — strengthened form) · **B×3** (1b, 1c, 2b — 2b on the throwaway) | viewer read-only, owner save (2) |
| RT | — | idempotency + membership | own-row realtime event (1) |
| W1b/W1c | slugify/error-map | 4 assertions (A — all RPC raises) | admin create + dup-slug + staff-denied (3) |
| W2a | — | — | fresh-context no-write + redirect (2) |
| W2b | — | — | sync button (1) |
| W2c | build/tsc | — | — |
| W2d | currency table + parameterized invoiceHtml | — | BDT screenshot ×2, USD switch ×1 |
| W3 | — | — | viewer denied / admin ok (2) |
| W4 | — | 4 assertions: **A** (staff INSERT) · **A′-UPDATE** (staff UPDATE — strengthened form, value-pinned) · **B×2** | admin inventory toggle regression (1) |
| W5 | settingsSchemas (~30 cases) | — | inline error on blur ×2 |
| W6 | useSettingsDirty | — | discard/stay/clean/mobile-back/redirect-card/beforeunload (6) |
| W7 | — | 4 assertions (A — RPC raises; AC-4 outcome mirrors RLS AC-9's A′ but via RPC error) | role change + realtime + non-manager gate (2) |
| W8 | wrong-pass handler | — | happy + wrong-pass (2); confirmation = e2e-or-manual |
| W9 | mfa error-parse + totp util | — | enroll→challenge→AAL2 (1) or manual runbook |

## 8. Effort summary

| Item | Size | Days |
|---|---|---|
| W0 harness (incl. replay contingency ±2d, calibration, negative control) | M–L | 1–2 (+≤2) |
| W1 P0 security (a+d+RT+b+c) | M–L | 3–3.5 (battery 15 assertions across 4 shapes + 0-row guard) |
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
3. **Old cached bundles hit tightened policies — two modes (corrected, CRITIQUE-v3 #2).** INSERT-class tightenings surface 42501 toasts (rare writes, accepted §0.2). UPDATE-class tightenings (W1d save) surface **silent fake success** for stale bundles; mitigations: same-release gating (primary), new-bundle 0-row guard (defense-in-depth, §2.2), per-actor analysis (§2.1 risks — no client uba UPDATE/DELETE exists in any bundle), runbook smoke. No "self-healing toast" claim is made anywhere for UPDATE-class tightenings.
4. **Realtime visibility under narrowed SELECT policy.** Mitigation: own rows stay readable (`user_id = auth.uid()` term in the untouched SELECT policy); RT e2e asserts own-row delivery post-`…00110`.
5. **W2d 49-file fan-out** (CRITIQUE-v4 #8 corrected count). Mitigation: 5 area PRs + BDT screenshot zero-delta gate.
6. **W4 locks real staff writers out.** Mitigation: corrected 90-day census run **pre-merge** (only `settings_inventory` + `settings_preorder_categories`); overrides or defer.
7. **W8/W9 harness prerequisites (mail catcher, TOTP).** Mitigation: named manual fallbacks (§4.3), unit coverage never manual.
8. **TOCTOU last-owner race.** Mitigation: `FOR UPDATE` helper on the now-reachable guard paths (§2.1); deadlock-abort of one side accepted (40P01); platform-admin repair runbook.
9. **Playwright wrapper extensibility unverified.** Mitigation: replace with direct config if `webServer`/`baseURL` don't pass through (isolated change).
10. **auth.users fixture recipe drifts with local GoTrue schema** (column NOT NULLs). Mitigation: W0 implementer verifies against the replayed local schema; fixtures are reset-wiped and idempotent, so recipe fixes are cheap.
11. **Policy drift between repo and prod** (a policy name existing in prod but not in migrations). Mitigation: runbook §2.6 step-2 `pg_policies` pre-flight before R1 push.
12. **Local-stack default privileges differ from hosted** (USING denials error instead of skipping). Mitigation: step-0.5 calibration records the local mode; Shape A′ asserts non-mutation (rowcount) and survival and is correct in either world; hosted mode confirmed by the §2.6 step-4 spot-check (CRITIQUE-v3 #1).
13. **Explicit BEGIN/COMMIT in forward files conflicts with CLI transaction wrapping** (CRITIQUE-v4 unverified-assumption #10). Mitigation: §4.1's third bullet — observed at W0's first local push; plan-authored blocks are stripped from the four new files if warnings appear.

## 10. Hard edges (what must precede what)

- W0 (incl. replay verification + denial-mode calibration + negative-control self-check) → everything testable.
- W1a → W1b → W1c, **one release window, one runbook** (§2.6); W1d + RT travel with them (migration order …00100 → …00110 → …00120 → …00130 — W1d depends on W1a's `can_manage_business_access`).
- W1a → W7 (helpers); RT → W7-realtime AC.
- W2a before W2b (relocation then relabel; W2a's AC is true at W2a time — F9). W2a's redirect-card call site lands before W6 and is unified by W6 (§5.4).
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
16. **pgTAP or a SQL test framework** — the four plain-SQL shapes (§4.2) cover every denial/allow/select case with zero new runtime deps beyond dev-only `pg`.

## 12. Assumptions (with verification owner)

- Local Supabase stack (Docker Desktop) is available on this Windows dev box; `supabase status` exposes the local DB URL (W0 runner parses it). *(verify: W0 implementer)*
- 134-migration replay: unproven; W0 step 0 verifies with a stated contingency — not assumed clean (F6).
- **Local-stack default privileges reproduce hosted USING-denial behavior (silent skip expected).** Not presumed: W0 step 0.5 records the observed mode; Shape A′ is correct in either; the §2.6 step-4 spot-check confirms hosted parity. *(verify: W0 implementer + release captain, R1)*
- Local `auth.users` insert recipe matches the replayed local GoTrue schema's NOT NULLs; the `on_auth_user_created` trigger's first-user branch is neutralized by the runner's `user_roles` re-seed (§4.2). *(verify: W0 implementer)*
- "Secure email change" toggle state and TOTP MFA plan availability: dashboard-only; verified as rollout checklist items (R3), with the single-confirm degradation path coded (W8).
- Local stack mail catcher API usable for the W8 confirmation e2e; else manual runbook (§4.3). *(verify: W0 implementer)*
- **`@supabase/supabase-js` ^2.101.1** (installed) exposes `mfa_factor_id` on the `mfa_required` sign-in error; unit test pins the parsed shape (W9). *(verify: W9 implementer)*
- `lovable-agent-playwright-config` passes `webServer`/`baseURL` through; else direct config replacement (§4.3). *(verify: W0 implementer)*
- `audit_log` insert permits definer-path writes for W7's server-side audit; else client-side `logChange` fallback (W7). *(verify: W7 implementer, harness test)*
- **PostgREST returns `[]` (empty array) for a 0-row UPDATE under `return=representation`** — the basis of W1d's `.update(...).select("id")` 0-row guard (§2.2); long-standing documented behavior, pinned by the W1d mocked-client vitest + the W1d e2e (CRITIQUE-v4 unverified-assumption #11). *(verify: W1d implementer)*
- Prod deploy = Vercel preview → production; migrations applied via `supabase db push` **before** the Vercel promote for tighten+expand releases alike (runbook §2.6).
- Prod policy state matches the repo's migration history (checked via the §2.6 step-2 `pg_policies` pre-flight; drift stops the runbook before push). *(verify: release captain, R1 step 2)*
