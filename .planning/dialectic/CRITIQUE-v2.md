# CRITIQUE-v2 — Adversarial review of PLAN-v2 (DokanOS Settings & Account Remediation)

**Reviewer role:** CRITIC (plan-refinement dialectic, round 2)
**Reviewed artifact:** `.planning/dialectic/PLAN-v2.md`
**Ground truth:** `DOKANOS-SETTINGS-AUDIT.md` · round-1 findings: `.planning/dialectic/CRITIQUE-v1.md`
**Method:** Full read of PLAN-v2 (769 lines), CRITIQUE-v1 (27 findings), audit. Every checkable claim re-verified against the repo at review time: `supabase/migrations/` (134 files swept — policy texts, function bodies, publication statements, grant statements), `src/App.tsx`, `BusinessAccountTab.tsx`, `useBusinessContext.tsx`, `SettingsPage.tsx`, `ProfileSettingsTab.tsx`, `Login.tsx`, `PermissionGuard.tsx`, `AppSidebar.tsx`, `invoiceHtml.ts`, `dueCollection.ts`, `orderTimeline.ts`, `slug.ts`, `package.json`, `playwright.config.ts`, `.github/workflows/`, `supabase/config.toml`, edge functions. ৳ inventory re-counted from source.

---

## Part A — Regression check: are CRITIQUE-v1's findings genuinely fixed?

Every v1 finding was checked against v2's actual text **and** against the code it cites. Result: **no cosmetic-only fixes, no re-worded non-fixes, zero unfixed v1 BLOCKER/MAJORs.** Spot-verification highlights:

| v1 | v2 resolution | Verified at review time |
|---|---|---|
| F1 [BLOCKER] rollback `.sql` in migrations dir | No rollback file in `supabase/migrations/`, ever; embedded comment + `.planning/rollbacks/*.md` (§2.0) | ✔ `supabase/migrations/` has 134 `.sql`, zero non-sql, zero rollback/down-named files; `.planning/rollbacks/` correctly does not exist yet |
| F2 [MAJOR] realtime false premise | §2.5 adds publication membership; REPLICA IDENTITY dropped | ✔ `20260903000500:6-8` adds only `stores`/`orders`/`courier_shipments`; no other `PUBLICATION` statement in any of the 134 migrations; `useBusinessContext.tsx:94-105` subscription is verifiably dead today |
| F3 [MAJOR] entitlement smuggled into W1b | RPC admin-only (`has_role` gate); self-serve deferred to §11.13 | ✔ consistent throughout (§2.3, §2.4, §11.13); error-copy mapping reconciled |
| F4 [MAJOR] email-change semantics | Explicit client-side `signInWithPassword` step; false claim deleted; residual risk documented (§5.6) | ✔ no `updateUser({email})` anywhere in `src/` today; `ProfileSettingsTab.tsx:194-195` confirms read-only email |
| F5 [MAJOR] route-level blocking impossible | Claim dropped; scoped to tab switch + `beforeunload`; router migration deferred (§11.12) | ✔ `App.tsx:3,164` = plain `<BrowserRouter>`; `createBrowserRouter` absent |
| F6 [MAJOR] fabricated `--linked`, branch/local conflation, unproven replay | Local-stack vocabulary only; `db reset` + runner parsing `supabase status`; W0 step 0 replay gate with dump-baseline contingency; pgTAP dropped | ✔ `package.json` has no `test:rls` today; no `supabase/tests/`; plan no longer references branches |
| F7 [MAJOR] `Members can write businesses` untouched | New W1d with SQL + `BusinessAccountTab` role-gating + rollback (§2.2) | ✔ policy exists verbatim at `20260904000100:358-361`; 8 `business_id ON DELETE CASCADE` children confirmed (lines 77/100/127/160/189/211/238/275) — **but W1d's SQL itself is broken; see Finding 2** |
| F8–F19 (MINORs) | All addressed in text | ✔ F10's inventory re-verified **exactly**: 203 `৳` / 48 operator files; posReports 38/6; OrderDetailSheet 35, CartPanel 19, ShiftDialog 16; `buildInvoiceInnerHtml` at `invoiceHtml.ts:41`; `dueCollection.ts:60,62` and `orderTimeline.ts:58,66` confirmed persisted-content writers. F12's census actions confirmed (`SettingsPage.tsx:196` `settings_inventory`, `PreOrderCategoriesDialog.tsx:131` `settings_preorder_categories`, `SettingsPage.tsx:131` localStorage-only `settings_general`). F13's `has_permission` confirmed at `20260420112330:169` with signature `(_user_id UUID, _permission app_permission)`. F18's currency allow-list matches `BusinessAccountTab.tsx:21` exactly |
| F20–F27 (NITs) | All addressed | ✔ `TabDef.keywords?: string` at `SettingsPage.tsx:42`; v2 uses a single string; no `§2.1.3` reference; no otplib |

v1's Finding 17 (TOCTOU) fix is present but **incomplete in a new way** — its surrounding policy logic fails its own acceptance criteria. That is Finding 1 below.

---

## Part B — Findings

### 1. [BLOCKER] W1a's last-owner protection is unreachable code: the DELETE policy's `OR` short-circuits past the guard, so AC-6 and AC-7 cannot pass and a sole owner can delete their own row

**Evidence.** PLAN-v2 §2.1, forward SQL (lines 211–217):

```sql
CREATE POLICY "Members can leave; owners can remove" ON public.user_business_access
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR can_manage_business_access(business_id, auth.uid())
    OR (user_id = auth.uid() AND business_has_other_owner(business_id, auth.uid()))
  );
```

with `can_manage_business_access` defined (§2.1, lines 132–138) as:

```sql
SELECT public.has_role(p_user, 'admin'::app_role)
    OR public.my_business_role(p_business_id, p_user) IN ('owner', 'admin');
```

For the sole owner deleting **their own row**: `my_business_role(business, self)` returns `'owner'` (verified: `user_business_access` has `UNIQUE (user_id, business_id)` at `20260904000100:50`, so the function returns exactly one row), so `can_manage_business_access` evaluates **TRUE**, and the policy predicate is TRUE regardless of the third clause. The `business_has_other_owner` guard sits in a disjunct that is only reachable when the first two are false — i.e., never for an owner. Postgres does not guarantee (and does not need) evaluation order; the predicate is semantically TRUE either way.

Consequences, per the plan's own acceptance criteria:
- AC-6 ("Sole owner deletes own row → denied (last-owner lockout)") **fails** in the harness on first run.
- AC-7 (concurrent last-owner deletion) is moot on the owner path — both sides pass via branch 2.
- The §2.1 Goal statement — "(c) deleting **their own row to leave** (with last-owner protection)" — is not what the SQL does.
- The `FOR UPDATE` TOCTOU machinery (F17 fix) protects a branch that cannot be reached.

**Must change.** Restructure so self-service leave is the *only* self path and requires another owner, while manager deletes target other people's rows:

```sql
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (user_id = auth.uid() AND business_has_other_owner(business_id, auth.uid()))
  OR (can_manage_business_access(business_id, auth.uid())
      AND user_id IS DISTINCT FROM auth.uid())
);
```

…then add harness assertions for exactly this case (sole owner self-delete denied; owner deleting another member's row allowed; owner deleting own row with a second owner present allowed).

### 2. [BLOCKER] W1d's "exact SQL" will not run: `CREATE POLICY "Members can read businesses"` collides with the existing policy of the same name → the migration aborts at push, in the middle of the Release-1 window

**Evidence.** `20260904000100_multi_business_foundation.sql:355-357` (verified verbatim):

```sql
CREATE POLICY "Members can read businesses" ON public.businesses
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id));
```

PLAN-v2 §2.2 forward SQL (lines 277–282) drops only `"Members can write businesses"` and then executes:

```sql
CREATE POLICY "Members can read businesses" ON public.businesses
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id));
```

`CREATE POLICY` has no `IF NOT EXISTS`; the duplicate name raises `42710 duplicate_object` and the whole migration transaction fails. Runbook §2.6 step 2 (`supabase db push` of `…00100 → …00110 → …00120 → …00130`) dies at `…00120` — after the `user_business_access` tightening has landed, i.e., precisely the half-deployed state the runbook exists to avoid. Secondary defect: the embedded rollback "DROP POLICY the four above" includes the new read policy, and the re-created `Members can write businesses` FOR ALL does restore read — acceptable — but the forward file must be fixed regardless.

**Must change.** W1d does not need to re-create SELECT at all: the existing `"Members can read businesses"` (:355) already grants exactly what v2 wants. Forward SQL should be: `DROP POLICY IF EXISTS "Members can write businesses";` + CREATE the three write policies (insert/update/delete) only. Alternatively drop-and-recreate the read policy explicitly — but do not CREATE a name that already exists.

### 3. [MAJOR] The zero-owner invariant is enforced on exactly one path — and per Finding 1, not even there. Direct PostgREST UPDATE/DELETE bypasses W7's RPC protections

**Evidence.** Three remaining routes to an ownerless `businesses` row under v2's SQL:

- **Sole-owner self-demotion via UPDATE.** §2.1 lines 199–209: `USING (can_manage_business_access(...))` passes for the owner; `WITH CHECK` passes whenever `NEW.role NOT IN ('owner','admin')` — so `owner → member` on one's own row is allowed. Result: business with zero owners. W7's `set_member_business_role` RPC has sole-owner demotion protection (§5.5 AC-4), but RPCs are optional sugar — the table is still writable via PostgREST with the session token, and the RLS policy is the actual boundary.
- **Manager deletes the last owner's row.** `USING` branch 2 (`can_manage_business_access`) authorizes a business-`admin` (uba role) or co-owner to DELETE *any* row of the business, including the sole owner's; `business_has_other_owner` guards only the self-delete disjunct (which Finding 1 shows is dead anyway).
- **Manager demotes the last owner.** UPDATE `owner → member` by a business-admin passes `WITH CHECK` (new role is not owner/admin).

The plan's stated invariant — AC-7: "business retains ≥1 owner" — is therefore not delivered by the migration. Platform-admin recovery (§2.1 risk item) is a real backstop, but "recoverable by support" is not the invariant the plan promises, and it contradicts the item's own goal statement.

**Must change.** Carry the last-owner condition into the UPDATE policy (demoting an `owner` row requires `business_has_other_owner(business_id, auth.uid())` when the row being demoted is the caller's *or* when the target is an owner) and into the manager-branch of DELETE (deleting an `owner` row requires another owner to remain). Add battery assertions: sole-owner self-demotion denied; business-admin deleting/demoting the sole owner denied.

### 4. [MINOR] W1c AC-4 is unachievable as written: `src/integrations/supabase/types.ts` (generated) contains `user_business_access`

**Evidence.** Verified sweep of `src/`: `user_business_access` appears in exactly three files — `src/components/settings/BusinessAccountTab.tsx` (the writer W1c removes), `src/hooks/useBusinessContext.tsx` (read path), and **`src/integrations/supabase/types.ts`** (generated Supabase Database types, which must not be hand-edited and will be regenerated by `supabase gen types`). AC-4 ("`grep -r "user_business_access" src/` → only `useBusinessContext.tsx`") can never return true — the same class of self-defeating AC as v1's F11, which v2 fixed everywhere else.

**Must change.** Exclude the generated types file (as W2a's AC-5 excludes legitimate `omnisync-*` keys), or scope the assertion to write patterns: `.from("user_business_access")` outside the two known files → 0.

### 5. [MINOR] W1a silently widens SELECT entitlement: managers gain read access to all membership rows of their business — undocumented, and no work item needs it

**Evidence.** Current SELECT (`20260904000100:368-370`): own rows or platform admin. v2's `"Users can read own access"` (§2.1 lines 182–188) adds `can_manage_business_access(business_id, auth.uid())` — so any business owner/admin can now SELECT every member's row (every member's `user_id`) of that business. Nothing in the plan requires it: W7 reads the membership list through the SECURITY DEFINER `get_member_access` RPC, and W1d's frontend gating explicitly reads only *own* rows ("own-row SELECT stays readable", §2.2). Side effect: with §2.5's publication membership, managers will also receive realtime events for all membership changes of their business.

This is an unflagged entitlement expansion inside a migration whose goal is to *remove* entitlements. It is benign today, but security hardening should not ship quiet widenings.

**Must change.** Either drop the `can_manage_business_access` term from the SELECT policy (managers get member lists via W7's RPC), or add a sentence stating the widening and why it is wanted.

### 6. [MINOR] §11.9's premise is false: the repo HAS GitHub Actions workflows

**Evidence.** `.github/workflows/` contains three workflow files: `pathao-tracking.yml`, `sync-worker.yml`, `woo-sync-all.yml`. PLAN-v2 §11.9: "CI pipeline (**no GH Actions in repo**) — harness runs locally; CI is separate infra work." The conclusion (harness is local-only) is defensible; the stated fact is wrong. The three workflows are scheduled worker jobs, not PR gates — say that instead. A plan that misstates what is in the repo invites the same trust erosion v1 dinged elsewhere.

**Must change.** Reword to "no PR-gating CI exists (the three scheduled workflows are unrelated workers)".

### 7. [MINOR] W9 names a nonexistent package (`@supabase/supramab-js`) and mislabels the installed version as "gotrue-js 2.101.1"

**Evidence.** PLAN-v2 §5.7: "Supabase Auth MFA via `@supabase/supramab-js`". No such package exists — MFA (`auth.mfa.enroll/.challenge/.verify/.unenroll`) ships inside `@supabase/supabase-js`, which `package.json` pins at `^2.101.1` (verified). The same version is repeatedly cited as "gotrue-js 2.101.1" (§5.7 AC, §12) — 2.101.1 is the supabase-js version; the auth engine is vendored as `@supabase/auth-js` with independent versioning. A wrong package name in the Files/design section sends the implementer dependency-hunting. (Good news the plan can claim: `input-otp` is **already** installed — `^1.4.2` — so the Login OTP step needs no new dependency; §0.6 remains accurate.)

**Must change.** "@supabase/supabase-js ^2.101.1 (auth.mfa namespace)"; re-pin the `mfa_factor_id` assumption to the installed supabase-js version.

### 8. [MINOR] W0's harness mechanics contradict themselves for denial tests, and fixture-user creation is unspecified

**Evidence.** §4.2's helper pattern is `BEGIN; SET LOCAL ROLE authenticated; …statements…; DO $$ IF NOT <expected> THEN RAISE … $$; ROLLBACK;` while the runner "fails on the first SQLSTATE error". For the majority of the battery — the *denial* assertions (W1a AC-1/2/6, W1d AC-1/2, W1b AC-2/3/4) — the expected outcome **is** a SQLSTATE error on the statement itself, which aborts the transaction and makes the runner report FAIL for tests that should pass. The sketch only expresses positive assertions. Additionally, §4.2 says fixture users "are seeded by the runner itself … `INSERT ... ON CONFLICT DO NOTHING`" without saying *where*: raw inserts into `auth.users` fire the house `handle_new_user`-style triggers and need `encrypted_password`/email-confirm columns; admin-API signup needs the local anon key and confirmation settings (`supabase/config.toml` surfaces no `[auth]` overrides at review — defaults unverified).

**Must change.** Specify the negative-assertion shape (per-statement plpgsql `BEGIN … EXCEPTION WHEN insufficient_privilege WHEN check_violation … END` blocks or expected-SQLSTATE table-driven assertions, with SAVEPOINT discipline), and name the fixture-user mechanism (admin API via local service key, or explicit `auth.users` insert recipe).

### 9. [MINOR] Release-bucket timing is unenforceable: R3's migration files will apply on the first `supabase db push` after merge, bypassing W4's census gate

**Evidence.** §6 puts `20260911000400` (app_settings tightening) and `20260911000500` (W7 RPCs) in Release 3 with the gate "W4 preceded by corrected census". But migrations are append-only files in a shared repo: once merged, **any** teammate's routine `supabase db push` — for any unrelated change — applies them to prod immediately. Nothing in the plan prevents W4's staff-write tightening from landing before its census has been run or its overrides granted. This is the same "old bundles in the wild" class of hazard the plan itself elevates to a guiding constraint (§0.2), applied to its own release sequencing.

**Must change.** State the discipline explicitly: R3 migration files are not merged until their gates pass (or they are authored at R3 time), and/or the W4 census runs at merge time rather than deploy time.

### 10. [MINOR] R1's "Days: 1–4" contradicts the plan's own effort table

**Evidence.** §8: W0 = 1–2 days **(+ ≤2d replay contingency)**; W1 = 2.5–3 days. §6 R1 row: "Days **1–4**", Gate includes "Migration replay verified (§4.1); RLS battery green". W0 alone can consume 4 days under its own contingency before W1 starts. The realistic R1 range is ~4–7 days. A plan that under-quotes its riskiest release's duration will make the gate look "late" when it is merely honest.

**Must change.** R1 days: 4–7 (or move W0 out of R1's window in the table, matching §1's graph where W0 precedes Phase 1).

### 11. [NIT] §0.4's "house RLS idiom" attributes a REVOKE/GRANT sweep to house helpers that don't have one

**Evidence.** Verified: `has_role` (`20260412161413:37-48`), `is_business_member` (`20260904000100:56-67`), and `has_permission` (`20260420112330:169+`) are `SECURITY DEFINER SET search_path = public` but carry **zero** `REVOKE`/`GRANT` statements — they rely on Postgres's default `EXECUTE` to `PUBLIC`. The REVOKE-then-GRANT pattern is v2's *new* (good) idiom, not the house's. Consequence worth one sentence: W4's `REVOKE ALL … FROM PUBLIC, anon, authenticated` on `has_permission` is a net behavior change (anon loses default EXECUTE); verified safe today (no anon-context callers found), but it should be described as a tightening, not "normalization".

### 12. [NIT] W6's design references a `handleTabChange` chokepoint that does not exist

**Evidence.** `SettingsPage.tsx` (381 lines) switches tabs through raw `setActiveTab(...)` calls at :245 (mobile back), :303 (mobile list), :356 (desktop list) — no `handleTabChange` function exists (verified by sweep). W6 §5.4 says both paths go "via `handleTabChange`" as if it exists. The guard needs the chokepoint *created* and three call sites unified — small, but the design paragraph misdescribes the current file, and missing it mid-implementation is exactly how the mobile back path ends up unguarded.

### 13. [NIT] W7's rollback mirror under-counts; W1b's allow-list and risk wording have minor inaccuracies

- §5.5 Files says the W7 migration's rollback mirror is "two `DROP FUNCTION`s", but the section introduces **three** RPCs (`get_member_access`, `set_member_business_role`, `get_my_managed_businesses`).
- §2.3's "exact" SQL hard-codes the timezone allow-list to `('Asia/Dhaka','UTC')` — 2 of the 8 values in `BusinessAccountTab.TIMEZONES` (:22-31). Harmless today because W1c passes only `p_name`/`p_slug` (defaults match the current form's `BDT`/`Asia/Dhaka`, :290), but a trap for the first future caller passing a UI-listed zone; the comment acknowledges it — then the SQL should not be labeled "exact".
- §2.1 risk item says old cached bundles "see an error toast" on the create path: post-migration, an *admin's* old-bundle two-step flow still passes both new `WITH CHECK`s (admin satisfies `has_role` on both tables — verified against §2.1/§2.2 policy text); only staff fail, exactly as they fail today. The risk is real but smaller than stated.

---

## Assumptions I could NOT verify

1. **Prod data state** — whether rogue `user_business_access` rows already exist (runbook §2.6 step 1 is the right instrument; no DB access from review). Note the query itself is sound against verified data: the foundation backfill granted owner only to platform admins (`20260904000100:62-65` header, INSERT at :474) and the only other historical writer (`BusinessAccountTab` two-step) requires businesses INSERT, which only admins could pass.
2. **134-migration clean replay from zero** — not executed (no builds/DB runs per instructions); W0 step 0 handles it, and the schema-dump fallback is a reasonable contingency.
3. **`lovable-agent-playwright-config` runtime pass-through** — `playwright.config.ts` documents `use.baseURL`/timeout overrides in its own template comments, which strongly suggests pass-through works, but the package internals were not opened.
4. **Local-stack mail catcher availability/API shape and `[auth]` defaults** — `config.toml` exposes no inbucket/auth overrides at review; whether the W8 confirmation e2e can run as scripted (vs. its stated manual fallback) is undetermined.
5. **`mfa_factor_id` on the `mfa_required` sign-in error for the installed supabase-js ^2.101.1** — `node_modules` not inspected; W9 already pins this with a unit test, which is the right mitigation.
6. **Realtime RLS-filtered per-subscriber delivery on the local stack** — asserted per platform behavior (§2.5 notes, risk #4); not executed.
7. **Whether all three `omnisync-business-name/currency/timezone` occurrences per key live solely in `SettingsPage.tsx`** — counts (3/3/3) match the verified `SettingsPage.tsx:118-130` usages exactly, so removal should zero the scoped grep, but I did not enumerate every occurrence's file.

---

## Verdict

**REVISE**

Must-fix set = all BLOCKERs + MAJORs:

1. **[BLOCKER] Finding 1** — W1a's last-owner guard is unreachable (`can_manage_business_access` short-circuits the guarded disjunct); AC-6/AC-7 unimplementable; sole owner can self-delete. Restructure the DELETE policy's `USING`.
2. **[BLOCKER] Finding 2** — W1d's `CREATE POLICY "Members can read businesses"` collides with the existing policy (`20260904000100:355`) → `42710` at push, aborting Release-1 mid-runbook. Drop only the write policy; keep the existing SELECT.
3. **[MAJOR] Finding 3** — zero-owner invariant unenforced via UPDATE self-demotion and third-party delete/demotion of the last owner; carry `business_has_other_owner` into those paths and the battery.

The MINORs (4–10) and NITs (11–13) should be folded into the next revision; none is cosmetic enough to skip silently — 4, 5, 8, and 9 in particular will each surface as an implementation-time surprise if left as written.

Credit where due: v2 cleared all 27 v1 findings substantively, and its factual layer (line numbers, policy texts, inventory counts, dep states) survived re-verification almost perfectly — the failures are concentrated in the new SQL's policy logic, which was presented as "exact" but never executed against its own acceptance criteria.
