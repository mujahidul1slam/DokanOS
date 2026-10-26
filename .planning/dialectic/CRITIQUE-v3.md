# CRITIQUE-v3 — Adversarial review of PLAN-v3 (DokanOS Settings & Account Remediation)

**Reviewer role:** CRITIC (plan-refinement dialectic, round 3)
**Reviewed artifact:** `.planning/dialectic/PLAN-v3.md` (913 lines)
**Ground truth:** `DOKANOS-SETTINGS-AUDIT.md` · prior rounds: `CRITIQUE-v1.md`, `CRITIQUE-v2.md` (must-fix = findings 1–3)
**Method:** Full read of PLAN-v3, CRITIQUE-v2, and the audit (§3.4, §5, §6, §10). Every checkable claim re-verified against the repo at review time by scripted sweep, not spot-read: all 134 migration files (policy-name census on `businesses`/`user_business_access`/`app_settings`, function-name census, GRANT/REVOKE census, publication statements, `ALTER DEFAULT PRIVILEGES` census); `20260904000100` (policy texts at :355/:358/:368/:371, table defs, 9 cascade children enumerated, `is_business_member` body), `20260412161413` (enum, `user_roles`, `has_role`, `handle_new_user` body), `20260420112330` (`has_permission` + its callers), `20260429165344` (app_settings policy names), `20260903000500` (publication); `BusinessAccountTab.tsx`, `useBusinessContext.tsx`, `SettingsPage.tsx`, `App.tsx`, `package.json`. The v3 last-owner SQL was traced by hand for all five actor classes through INSERT/UPDATE/DELETE USING/WITH CHECK, including the two v2-mandated denials.

---

## Part A — Regression check: are CRITIQUE-v2's must-fix findings genuinely fixed?

**Yes — all three, verified in the SQL, not in the prose.** This is the strongest part of v3.

| v2 | v3 resolution | Verified at review time |
|---|---|---|
| **#1 [BLOCKER]** last-owner guard unreachable — `can_manage_business_access` OR-short-circuits past `business_has_other_owner` | DELETE restructured into three branches: platform admin / self-leave-with-other-owner / manager-removes-**another**-row-with-target-guard (§2.1 :244-260) | ✔ Traced. Branch 2 requires `user_id = auth.uid()`; branch 3 requires `user_id IS DISTINCT FROM auth.uid()` — **disjoint by construction**, so branch 3 can never short-circuit branch 2's guard. Sole-owner self-delete: branch 2's `business_has_other_owner(biz, self)` returns FALSE (verified against `UNIQUE (user_id, business_id)`, `20260904000100:50`), branch 3 unreachable → denied. AC-6 and AC-7 are now satisfiable. |
| **#2 [BLOCKER]** `CREATE POLICY "Members can read businesses"` collides with `20260904000100:355` → 42710 mid-runbook | W1d touches only the write policy; read policy never dropped or re-created (§2.2 :341-364) | ✔ Census: the only policies ever created on `businesses` are `"Members can read businesses"` (:355) and `"Members can write businesses"` (:358); on `user_business_access` only `"Users can read own access"` (:368) and `"Users can write own access"` (:371). All six of v3's new policy names (3 × uba, 3 × businesses) plus W4's two app_settings names are **absent from all 134 migrations** — zero remaining 42710 surface. All eight new function names equally absent. |
| **#3 [MAJOR]** zero-owner invariant enforced on one path only (PostgREST self-demotion, manager delete/demote of last owner) | Guard moved to UPDATE **USING** side (`role IS DISTINCT FROM 'owner' OR business_has_other_owner(business_id, user_id)`) + same guard in DELETE manager branch (§2.1 :213-260) | ✔ Traced all paths. Sole-owner self-demotion: USING fails (`business_has_other_owner(biz, self)` = FALSE) → denied. UBA-admin deletes sole owner: branch 3's guard evaluates `business_has_other_owner(biz, **target**)` = FALSE → denied. UBA-admin demotes sole owner: same USING guard → denied. Co-owner cases pass. Platform-admin first-disjunct exemption works as documented. Note the guard's `user_id` is the **target row's** column, which is exactly why the manager branch works — the v2 placement bug is structurally gone. The §2.1 "guard placement rationale" (USING filters existing rows; `role` is the only mutable column) is correct per `CREATE POLICY` docs. |

MINORs 4–10 and NITs 11–13: every one has a substantive (not cosmetic) v3 resolution, and the underlying facts survive re-verification: W1c AC-4 writer-sweep is achievable (`.from("user_business_access")` exists in exactly two src files today, `BusinessAccountTab.tsx:308` + `useBusinessContext.tsx:72`; `types.ts` never matches `.from(`); SELECT widening dropped (switcher flow at `useBusinessContext.tsx:69-90` reads own rows via join — unaffected); §11.9 reworded correctly; `@supabase/supabase-js ^2.101.1` and `input-otp ^1.4.2` both verified in `package.json` (no `pg` yet — v3 adds it dev-only); merge discipline consistently threaded through §0.9/§5.2/§6/§10; R1 = 4–7 days; `is_business_member` **does** carry REVOKE/GRANT (:69-70) while `has_role` (:37-48) and `has_permission` (:169+) carry none — v3's §0.4 correction is right; `SettingsPage.tsx` has exactly the four `setActiveTab` sites claimed (:114, :245, :303, :356) and no `handleTabChange`; W1b's timezone allow-list is the **verbatim 8 values** of `BusinessAccountTab.TIMEZONES` (:22-31); W7 rollback counts three functions. Pre-emptive V1–V5 corrections also verified (`app_role` = admin/staff/viewer only; 9 cascade children including `user_business_access` itself; `handle_new_user` first-user admin branch at `20260412161413:129-133`).

**One v2 finding is NOT genuinely fixed:** #8 (harness mechanics). v3 specified the negative-assertion shape as demanded — but the shape it chose is semantically wrong for roughly half the battery. Finding 1 below.

---

## Part B — Findings

### 1. [MAJOR] Harness "Shape A" mis-models RLS denial semantics for UPDATE/DELETE: USING-side denials are **silent row skips, not 42501** — the Release-1 gate ("RLS battery green") is unachievable as scripted, including on the exact v2-mandated cases (AC-6, AC-9)

**Evidence.** §4.2 Shape A wraps each denied statement in `BEGIN … RAISE 'FAIL' (P0001) … EXCEPTION WHEN insufficient_privilege THEN NULL; END` and the expected-errcode table maps "**RLS/policy denials** and RPC 42501 → `insufficient_privilege`". That mapping is wrong for every denial whose mechanism is a **USING** predicate:

- Postgres semantics (CREATE POLICY): rows failing a DELETE/UPDATE **USING** expression are *not visible* — the statement simply affects 0 rows. `42501 new row violates row-level security policy` is raised **only** by a failed **WITH CHECK** (INSERT, and UPDATE's new-row check), or an explicit `RAISE`.
- The `authenticated` role holds table privileges: zero `REVOKE`/`ALTER DEFAULT PRIVILEGES` statements exist in any of the 134 migrations (the only table GRANTs are 5 service_role grants on unrelated courier/webhook tables), so the standard Supabase default grant of ALL to `authenticated` is in force — meaning DELETE/UPDATE reach RLS and **skip silently**. (If privileges were ever revoked, the raised error would be `permission denied` — still not a *policy* denial; the rowcount assertion below is the only robust shape either way.)

Assertions scripted as Shape A that will therefore **execute successfully (0 rows) and trip the in-test `RAISE 'FAIL'` with P0001** — uncaught, aborting the file, failing a **correct** implementation:

| Assertion | Mechanism | As scripted |
|---|---|---|
| W1a AC-6 — sole owner self-**DELETE** | DELETE USING all-branches-false | silent skip → FAIL raised → runner fails |
| W1a AC-8 — UBA-admin **DELETE**s sole owner | branch 3 USING guard false | silent skip → FAIL raised |
| W1a AC-8 — UBA-admin **demotes** sole owner | UPDATE USING guard false | silent skip → FAIL raised |
| W1a AC-9 — sole owner self-**demotes** (v2 Finding 3's headline case) | UPDATE USING guard false | silent skip → FAIL raised |
| W1d AC-1 — member **UPDATE**s businesses | UPDATE USING false | silent skip → FAIL raised |
| W1d AC-2 — member/owner **DELETE**s businesses | DELETE USING false | silent skip → FAIL raised |
| W4 AC — staff **UPDATE**s `app_settings` | UPDATE USING false | silent skip → FAIL raised |

Shape A remains correct for INSERT/WITH CHECK denials (W1a AC-1/2/3b/5/10b), trigger `check_violation` (AC-11), and RPC raises (W1b) — which is why the example ACs the plan happened to script first look fine. W1a AC-15 (SELECT narrowing) additionally has **no specified assertion shape at all** — a SELECT denial is a 0-row result, not an exception.

Consequence chain: §6's R1 gate is "RLS battery green" → the gate can never be met as specified → either R1 stalls at W0 on a correct migration, or — the dangerous failure mode — the implementer "fixes" the harness under time pressure by weakening assertions, converting silent skips into false greens. This is the same class of defect v2 Finding 8 flagged ("denial tests would abort transactions… makes the runner report FAIL for tests that should pass"): v3 fixed it for *exception-visible* denials and re-introduced it for *invisibility* denials. The irony is pointed: the two assertions the round-2 critique cared most about (AC-6, AC-9) are among the broken ones.

**Must change.** Add a third shape to §4.2 — **Shape A′ (deny-by-invisibility)**: run the statement under the actor's role, then verify persistence as connection owner, e.g.

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<OWNER_A_UUID>","role":"authenticated"}';
DELETE FROM public.user_business_access
 WHERE business_id = '<BIZ_A_UUID>' AND user_id = '<OWNER_A_UUID>';
COMMIT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.user_business_access
              WHERE business_id = '<BIZ_A_UUID>' AND user_id = '<OWNER_A_UUID>') THEN
    NULL;  -- expected: row survived (USING denied invisibly)
  ELSE RAISE EXCEPTION 'FAIL: W1a-AC6 sole-owner row was deletable' USING ERRCODE = 'P0001';
  END IF;
END $$;
```

…or use a plpgsql wrapper asserting `GET DIAGNOSTICS rowcount = 0`. Restrict the exception-based Shape A to INSERT/WITH CHECK/RPC/trigger denials and correct the expected-errcode table accordingly ("USING-side denials never raise — assert row survival"). Add a row-count assertion shape for AC-15's SELECT narrowing. Update §6's gate wording if the battery spec changes shape.

### 2. [MINOR] The old-bundle risk narrative repeats the same semantic error: a cached member/staff bundle's tightened UPDATE does not produce a "42501 toast" — it produces **silent fake success**

**Evidence.** §0.2(b) ("may break an old bundle's write with a 42501 toast"), §2.1 risks ("the only *new* 42501 surface is a member/viewer saving business details"), §2.2 ("a member saving post-migration gets a 42501 toast — rare, non-destructive, accepted"), and §5.2 W4 AC ("Old-bundle staff writes toast-fail post-migration"). Verified current writer: `BusinessAccountTab.handleSave` (`:121-133`) is a bare `.update({...}).eq("id", active.id)` — **no `.select()`/returning**. Post-W1d, a member's UPDATE is USING-filtered → `error` is `null`, `count` is 0 → execution falls through to `logChange` + `toast.success("Business account saved")` (`:143-147`) while **nothing persisted**. The user is told they saved; on reload the old values reappear with no explanation and every retry fails identically. That is materially worse than the claimed self-healing toast, and it silently writes a false `business_account` audit row (`logChange` at :143 runs on the error-free path). The INSERT-half of W4's old-bundle claim is accurate (INSERT WITH CHECK does raise 42501 → toast); the UPDATE-half is not.

**Must change.** Rewrite the four spots to distinguish the two failure modes: INSERT-tightenings surface 42501 toasts; UPDATE-tightenings (W1d save, W4 staff update) surface **silent no-op + success toast** for stale bundles. Either accept fake-success explicitly with that description, or add a mitigation (e.g., W1d's same-release gating ships in the same Vercel promote — state the residual stale-bundle window honestly; optionally have `handleSave` in the *new* bundle assert the update returned a row). Note this also softens §0.2(b) as a general rule: it only describes INSERT-class tightenings.

### 3. [MINOR] The fixture matrix cannot express the battery's own "allowed" INSERT assertions (AC-3, AC-5): every seeded non-privileged user already has a `user_business_access` row, and a fresh UUID trips the FK

**Evidence.** §4.2 seeds uba rows for A: OWNER_A/OWNER_A2 `owner`, UBA_ADMIN_A `admin`, MEMBER_A `member`, VIEWER_A `viewer`; B: OWNER_B. W1a AC-3 asserts "Owner of A inserts `{U2, A, 'member'}` → allowed (Shape B verify)" and AC-5 asserts "`{U3, A, 'member'}` → allowed". Neither U2 nor U3 is defined. If U2/U3 is any seeded user other than OUTSIDER, the INSERT violates `UNIQUE (user_id, business_id)` (`20260904000100:50`) → `23505`, which Shape A/B do not catch (expected-errcode table notwithstanding) → runner fails a correct implementation. If U2/U3 is a brand-new UUID, the FK `user_id REFERENCES auth.users(id)` (`:45`) raises `23503`. The only in-matrix candidate, OUTSIDER, is already consumed by the AC-1/AC-2 denial tests — reusing it as an insert *target* would then make its own denial tests order-dependent.

**Must change.** Add two spare fixture users (e.g., `SPARE_A`, `SPARE_B`) with `auth.users` rows and **no** seeded uba rows, or specify a per-test teardown that frees MEMBER_A/VIEWER_A's rows before the allow-inserts. One sentence in §4.2 suffices; without it, `user_business_access_test.sql` fails on its first Shape B assertion.

### 4. [MINOR] W6's chokepoint inventory is stale under v3's own dependency graph: W2a adds a fourth user-facing `setActiveTab` call site that W6 does not list, and it will bypass the dirty guard

**Evidence.** §5.4 unifies "all three user-facing call sites (:245, :303, :356)". But §1 orders W2a (Release 2) **before** W6 (Release 3), and §3.1 (W2a) adds a "Business basics" redirect card whose button calls `handleTabChange("account")`/"`setActiveTab("account")` until then". At W6 time, `SettingsPage.tsx` therefore has **four** user-facing switch sites — and the redirect card's is exactly the kind that needs guarding (a user with dirty edits in Business Account clicking "Business basics" silently discards them). The §5.4 sweep of ":114 initial auto-select stays direct" was correct for today's file and is already stale relative to the plan's own Phase-2 output.

**Must change.** W6's call-site list gains the W2a redirect card (or W2a is required to call `handleTabChange` from birth with the guard landing later — but then state that the guard is a no-op until W6). One line in §5.4 and one in §3.1.

### 5. [NIT] §2.6 step 2 says "the four policy names v3 creates" and then lists six (correctly annotated "— six, on the two tables")

"Four" is a leftover from an earlier draft. Say six, or drop the count.

### 6. [NIT] R1 "Days 4–7" is still ~0.5d short of §8's own worst case

§8: W0 = 1–2 (+≤2 replay contingency) = up to 4d; W1 = 3–3.5d → contingency-inclusive upper bound 7.5d vs §6's 7. The fix that produced this NIT (v2 #10) under-corrected by exactly the rounding. Either 4–8, or accept and note the contingency may push past the window.

### 7. [NIT] AC-13's "both sole owners self-delete/self-demote simultaneously" — a business cannot have two *sole* owners

Means two co-owners (OWNER_A/OWNER_A2). The lock-trace itself is sound (each session's `business_has_other_owner` FOR UPDATE locks the *other* row; commit order yields at most one success or a 40P01 deadlock abort, both invariants-preserving); only the wording misleads whoever scripts the two-session psql step.

### 8. [NIT] W1b validation nits

(a) `p_name` has a non-empty check but no upper bound — the W5 schema will cap name at 100 while the RPC (the *authoritative* path post-W1c) accepts arbitrarily long names; add `length(btrim(p_name)) <= 100`. (b) `btrim(p_name)` is applied at INSERT but the slug regex/name checks run on the untrimmed value — cosmetic today. (c) The trigger function `user_business_access_immutable` (§2.1 :171-180) lacks `SET search_path`, unlike every other new helper — harmless for a trigger fn with no dynamic SQL, but it contradicts §0.4's own "new helpers follow the house idiom" claim by a hair.

---

## Assumptions I could NOT verify

1. **Local-stack default privileges** — whether the local CLI's bootstrap applies the same default privileges (ALL → `anon`/`authenticated`) as hosted projects. Zero `ALTER DEFAULT PRIVILEGES` statements exist in the 134 migrations, so bootstrap behavior decides whether USING-side denials are silent skips (standard Supabase) or `42501 permission denied`. Either way Finding 1's rowcount assertion is the robust shape — but the expected-errcode table cannot be finalized without W0 confirming this empirically (one 5-minute check: attempt a policy-denied DELETE as `authenticated` and observe).
2. **134-migration clean replay from zero** — not executed (no builds/DB runs per instructions); W0 step 0 + schema-dump fallback remains the right instrument.
3. **Local GoTrue `auth.users` NOT NULL column set** for the fixture INSERT recipe — `node_modules`/replayed schema not inspected; the plan self-covers with an explicit verify-at-W0 note (§4.2, §12).
4. **`mfa_factor_id` on the `mfa_required` error for supabase-js ^2.101.1** — not inspected; W9's unit-test pin is the right mitigation.
5. **`lovable-agent-playwright-config` `webServer`/`baseURL` pass-through** — package internals not opened; plan carries the direct-config fallback.
6. **Realtime per-subscriber RLS-filtered delivery** (own-row-only events) on the local stack — platform behavior asserted, not executed; RT AC-2 is the instrument.
7. **Prod policy drift vs repo** — the §2.6 step-2 `pg_policies` pre-flight is the instrument; no DB access from review.
8. **`audit_log` RLS permitting definer-path inserts** for W7's server-side audit — table exists (`20260417171140`-era migration), policy set not traced; plan self-flags with the client-side fallback.
9. **Local-stack mail catcher API shape** for W8's confirmation e2e — plan carries the named manual runbook fallback.

---

## Verdict

**REVISE**

Must-fix set = all BLOCKERs + MAJORs (zero BLOCKERs this round):

1. **[MAJOR] Finding 1** — Harness Shape A treats USING-side UPDATE/DELETE denials as `42501` exceptions; they are silent 0-row skips. Seven specified assertions (incl. the round-2-mandated AC-6 and AC-9) will false-fail a correct migration, and the R1 gate ("RLS battery green") is unachievable as specified. Add the deny-by-invisibility shape, correct the expected-errcode table, add a row-count shape for AC-15.

Fold into the next revision (cheap, each is an implementation-time surprise if skipped): Finding 2 (old-bundle failure mode is fake success, not a toast — four spots), Finding 3 (spare fixture users for AC-3/AC-5), Finding 4 (W6's fourth call site from W2a). NITs 5–8 optional.

Credit where due: v3's must-fix SQL is now genuinely correct — the three disjoint DELETE branches are verifiably disjoint, the USING-side guard placement is the right fix and correctly argued, and the policy-name census is airtight (zero remaining 42710 surface across all six new policies and eight new functions). The factual layer again survived near-total re-verification. What remains is confined to the verification layer the plan itself elevated to a release gate: the battery cannot pass as scripted, and the two places the plan narrates old-bundle failure behavior narrate a Postgres mechanism that does not exist for UPDATE/DELETE tightenings.
