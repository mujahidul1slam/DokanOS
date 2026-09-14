# CRITIQUE-v1 — Adversarial review of PLAN-v1 (DokanOS Settings & Account Remediation)

**Reviewer role:** CRITIC (plan-refinement dialectic)
**Reviewed artifact:** `.planning/dialectic/PLAN-v1.md`
**Ground truth:** `DOKANOS-SETTINGS-AUDIT.md`
**Method:** Full read of plan + audit; claims verified against `supabase/migrations/` (all 134 files swept), `src/` (taka-symbol inventory, `user_business_access` reference sweep, `app_settings` writers, router type, RLS policy texts, function definitions), `package.json`, `supabase/config.toml`, `.github/workflows`, edge functions. Line numbers re-verified at review time.

---

## Findings

### 1. [BLOCKER] The rollback "doc file" is inside `supabase/migrations/` and ends in `.sql` — it will be executed as a migration, re-opening the critical hole on every environment

**Evidence.** PLAN §2.1 Files:
> "Create: `supabase/migrations/20260911000101_rls_rollback_user_business_access.sql.down.sql` (rollback reference; see §2.1.3 — kept as a sibling doc file since Supabase migration dirs are forward-only; the rollback SQL is also embedded as a comment block in the forward file)"

The Supabase CLI treats **every** `supabase/migrations/*.sql` file as a forward migration. Applied in sequence after `20260911000100`, this file would DROP the tightened policies and re-CREATE the vulnerable `Users can write own access` policy (the rollback SQL restores it "verbatim," plan lines 202–208) — on prod, on every teammate's local stack, on every future branch. Verified reality: the repo has **zero** `.down.sql`/rollback-named files in `supabase/migrations/` today, so there is no house convention the plan can lean on — it is inventing a dangerous one.

**Must change.** Delete the sibling file entirely (the embedded comment block already carries the rollback), or store it outside `supabase/migrations/` with a non-`.sql` extension (e.g. `.planning/rollbacks/…md`). Any answer that leaves a rollback `.sql` inside the migrations directory is a shipwreck.

---

### 2. [MAJOR] The realtime risk item rests on a false premise: `user_business_access` is NOT in the `supabase_realtime` publication — the plan's mitigation, remediation path, and e2e assertions are all wrong

**Evidence.** PLAN §2.3 Risks:
> "Mitigation: realtime already enabled on the table (`20260903000500_enable_realtime.sql`); verify channel events still fire for own-row changes in the e2e run; if not, add `ALTER TABLE ... REPLICA IDENTITY FULL`"

Verified: `20260903000500_enable_realtime.sql:6-8` adds **only** `stores`, `orders`, `courier_shipments` to the publication. A sweep of all 134 migrations finds no other `PUBLICATION` statement. `user_business_access` was never added — so the existing subscription in `src/hooks/useBusinessContext.tsx:94-105` already delivers **zero events today** (the audit's §2.3 claim that membership changes "propagate live" is itself false — the plan inherited it without checking). Consequences:

- The e2e step "verify channel events still fire" fails **today**, for a reason unrelated to the RLS change it is meant to guard.
- The prescribed remediation (`REPLICA IDENTITY FULL`) fixes WAL payload shape for UPDATE/DELETE, **not** publication membership — it is the wrong lever.
- W7's `set_member_business_role` RPC will silently not propagate to the affected member's client (they see their business-role change only on next refresh) — a UX consequence the plan never surfaces.

**Must change.** Add `ALTER PUBLICATION supabase_realtime ADD TABLE public.user_business_access;` as a one-line migration in R1; rewrite the risk item to state publication membership is missing; drop `REPLICA IDENTITY FULL` from the primary remediation path; fix the W1/W7 e2e expectations accordingly.

---

### 3. [MAJOR] W1b silently changes product entitlement: any authenticated user (including `viewer`) becomes able to create businesses and self-own them — contradicting current RLS, the code's own error copy, and the plan's own rationale

**Evidence.** PLAN §2.2:
> "the entitlement is: any authenticated user may create a *new* business … This matches the product model where businesses are operator-created orgs"

Verified current state:
- `20260904000100:358-361` — businesses write policy `FOR ALL … USING/WITH CHECK (has_role(admin) OR is_business_member(id))`. On INSERT of a **new** business, `is_business_member(new_id)` is necessarily false (no access rows can exist for a business that doesn't exist yet) — so **today only platform admins can insert a business**. The current two-step flow in `BusinessAccountTab.tsx:288-317` therefore succeeds only for admins; staff genuinely hits the policy wall.
- `BusinessAccountTab.tsx:298` error copy: "only account admins can provision new businesses" — the product's stated semantics.

W1b's `SECURITY DEFINER` RPC bypasses the businesses INSERT policy entirely and grants every authenticated user org-creation + ownership. That is a real authorization-semantics expansion (and an unbounded one — no rate limit, no cap on businesses per user, spam rows in `businesses`/`user_business_access`), made inside an item labeled "P0 security fix." The justification sentence is self-contradictory: "operator-created orgs" argues for *restricted* creation, not open creation. §2.3 even keeps the old admin-only error copy as the "generic failure fallback" while the behavior it describes is gone.

**Must change.** Either (a) restrict `create_business_with_owner` to `has_role(auth.uid(),'admin')` — preserving today's semantics while still moving the insert server-side, which fully satisfies audit P0-1; or (b) make the self-serve entitlement an explicit, product-signed-off decision with its own work item (spam controls, cap, audit, updated error copy) and reconcile the "operator-created orgs" rationale. As written, the plan hides a product decision inside a security fix.

---

### 4. [MAJOR] W8's core behavior contract misstates Supabase Auth semantics — `updateUser({ email })` neither requires nor verifies the current password, and "Secure email change" does not add re-auth

**Evidence.** PLAN §5.6:
> "current-password re-auth → `supabase.auth.updateUser({ email })` … Supabase enforces recent-password re-auth for email change when secure change is on"

and Behavior contract #3:
> "Wrong current password → `updateUser` returns `AuthApiError` (401/400)"

`supabase.auth.updateUser({ email })` takes no password and performs no password verification; the dashboard "Secure email change" toggle only controls whether **both** addresses receive confirmation emails vs. only the new one. There is no gotrue-side "recent authentication" requirement for email change. Therefore:

- Contract #3 as written is **unimplementable** — `updateUser` cannot fail on a wrong current password because no password is ever sent. The promised e2e ("wrong-pass", testing-matrix W8 row) fails as designed.
- The re-auth guarantee exists only if the client *explicitly* calls `signInWithPassword` first — a step the plan implies ("current-password re-auth →") but never specifies, while attributing the enforcement to Supabase.

**Must change.** Specify the re-auth as an explicit client-side `signInWithPassword` step (with its own error mapping for contract #3), delete the false "Supabase enforces recent-password re-auth" claim, and note the residual risk: `updateUser`-with-session remains callable by any holder of the session token, so the re-auth is UX-hardening, not a security boundary.

---

### 5. [MAJOR] W6's route-level blocking promise is unachievable on the app's router: `useBlocker` requires a data router, but the app uses `BrowserRouter`

**Evidence.** PLAN §5.4:
> "a `useBlocker`-equivalent (react-router v6 `useNavigate` + `useLocation` — v6.30 has stable `useBlocker`) for in-app route navigation"

and AC-2: "Same flow via browser back / URL nav to /orders → blocked (route-level)."

Verified: `src/App.tsx:3` — `import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom"` (plain `<BrowserRouter>`, not `createBrowserRouter`); `react-router-dom@^6.30.1` (package.json). `useBlocker` in react-router 6.x only works inside a **data router** (`createBrowserRouter`/`createHashRouter`); under `<BrowserRouter>` it throws. The plan's version claim ("v6.30 has stable useBlocker") is true and irrelevant — the app cannot use it without a router migration that appears nowhere in the dependency graph, effort table, or §11.

**Must change.** Either add an explicit "migrate App.tsx to `createBrowserRouter`" work item (with effort + regression risk for the route tree, `detectBrand` logic at App.tsx:114, and the `Routes` structure) before W6, or drop AC-2 and scope W6 to in-page tab switching + `beforeunload` (which only covers close/reload, not SPA navigation). The plan cannot promise route-level blocking while the current router makes it impossible.

---

### 6. [MAJOR] The W0 test-harness plan contains a fabricated CLI flag, conflates the local CLI with platform "branches," and stakes its schedule on an unproven assumption that all 134 migrations replay cleanly

**Evidence.**
- PLAN §4.1 script: `"test:rls": "supabase db reset --linked false && supabase test db"` — `supabase db reset` has **no `--linked` flag** (it resets the local stack by definition). The script as written does not run.
- §4.1/§7 repeatedly say tests run "against a local Supabase branch" — Supabase *branches* are a platform feature; the local CLI gives you a local stack (`supabase start` + `db reset`), not branches. The plan mixes the two models throughout (§12 even makes "branches available" an assumption).
- §7: "`supabase db reset` applies all 134+new migrations — **this also validates that every historical migration replays cleanly**, a free regression check" — presented as a freebie. The migrations are lovable-era + hand-written backfills tailored to a live DB (e.g. `20260904000100`'s DO block, lines 447–612, backfills from `invoice_settings`/`stores`/`pathao_integrations` rows; other early migrations embed live-data UUID backfills). Nothing in the repo has ever demonstrated a clean from-zero replay (no seed files, no CI, `test_db.ts` is a scratch Deno script — correctly noted). If replay breaks anywhere in the 129 pre-foundation files, W0 is not "M (1 day)" — and the R1 gate ("RLS battery green") is unreachable until it is fixed. `supabase/config.toml` exists but contains no seed config.
- Mechanics gap: `supabase/tests/enable_pgtap.sql` will not be applied by `supabase db reset` (reset applies only `supabase/migrations/`), so the pgTAP step has no defined application path (see also Finding 27).

**Must change.** Fix the script (`supabase db reset && supabase test db`, local stack, Docker Desktop prerequisite acknowledged for this Windows dev box); pick local-stack vs. platform-branch and use one vocabulary; add a W0 pre-step "verify 134-migration replay on a fresh DB" with a contingency (baseline dump or budgeted replay repair) instead of calling it free; define how pgTAP gets enabled.

---

### 7. [MAJOR] The "Members can write businesses" FOR ALL policy is left untouched: any member — including a `viewer` — can still UPDATE *and DELETE* the businesses row (cascade-wiping brands, locations, connectors, suppliers, purchase orders)

**Evidence.** `20260904000100:358-361`:
```sql
CREATE POLICY "Members can write businesses" ON public.businesses
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_business_member(id));
```
`FOR ALL` includes DELETE, and `business_id … ON DELETE CASCADE` exists on `brands` (line 77), `locations` (100), `selling_points` (127), `connectors` (160), `product_sources` (189), `customer_sources` (211), `suppliers` (238), `purchase_orders` (275). The audit's §6 explicitly names this policy as part of the escalation blast radius ("the ability to edit the `businesses` row itself (the 'Members can write businesses' policy admits any `is_business_member`)"). The plan's W1 fixes only `user_business_access`; after W1, a legitimately-invited `viewer` of business A still holds UPDATE and business-destroying DELETE on `businesses` A. The plan neither fixes it, schedules it, nor lists it in §11's eleven deliberate non-goals — it is simply absent, in the item whose goal statement reads "Close the multi-tenant escalation hole."

**Must change.** Add a work item (R1 or R3) restricting `businesses` writes to platform admin or `owner`/`admin` of that business (the W1a helper `can_manage_business_access` already exists for this), at minimum removing member DELETE. This has a frontend consequence the work item must carry: `BusinessAccountTab.handleSave` (`BusinessAccountTab.tsx:107-140`) currently lets any member save — the tab must gate its save button by role, or viewer members will get raw RLS toasts. If the team decides to accept member-write for now, it must appear in §11 with rationale — silent omission is not acceptable.

---

### 8. [MINOR] W2a's acceptance criteria are unachievable as written: the localStorage-null assertion fails on any existing profile, and the `omnisync-` grep-to-zero target is impossible

**Evidence.** AC-1 asserts `localStorage.getItem('omnisync-currency') === null` after visiting — any browser profile that ever saved the General tab already has the key persisted from before; the assertion must run in a fresh context or `removeItem` first. AC-4: "verify `grep -r "omnisync-" src/` → 0" — verified remaining `omnisync-*` keys in src: `omnisync-global-stock`, `omnisync-global-stock-change` (`src/lib/stockSettings.ts:4,6`), `omnisync-preorder-category-ids`, `omnisync-preorder-categories-change` (`src/lib/preOrderSettings.ts`), `omnisync-install-ready`, `omnisync-chunk-recovery-attempted` — the grep can never return 0.

**Must change.** Scope AC-1 to the three retired keys (`omnisync-business-name|currency|timezone`) in a fresh Playwright context; scope AC-4's grep to exactly those three key strings.

---

### 9. [MINOR] W2a and W2b acceptance criteria overlap incoherently: the General tab cannot be "theme + install only" while `BusinessProfileTab` still renders in its body

**Evidence.** Verified: `SettingsPage.tsx:181` renders `<BusinessProfileTab />` inside the `general` case-branch. W2a (which ships first) promises "Tab renders theme toggle + InstallAppButton + redirect card" and removes the General Settings card — but `BusinessProfileTab` leaves the general body only in W2b ("remove from `general` case-branch"). W2a's AC-1 is therefore false at W2a time and only true after W2b; the plan's own hard edge "W2a before W2b (IA restructure once, not twice)" guarantees the intermediate state fails W2a's gate.

**Must change.** Either fold the `BusinessProfileTab` relocation into W2a, or restate W2a's AC to acknowledge the print-header card remains until W2b lands in the same release (R2 ships both, so the user-facing gate can be the release, not the work item).

---

### 10. [MINOR] W2d's factual inventory is off, the named function `renderInvoice` does not exist, and two of the "print document" files are actually persisted-content writers with data-history implications

**Evidence.**
- Plan claims "~50 files / 207 hardcoded `৳` … `posReports/*` 45 across 6 files." Verified: **203 occurrences across 48 operator-app files** (plus 3 in `src/test/invoiceHtml.test.ts`, 1 in one storefront file); posReports = **38** across 6 files. The plan presents these as verified inventory facts.
- Plan: "signature change `renderInvoice(order, settings, currency: string)`" — there is **no** `renderInvoice` in the codebase. The real API surface (verified `src/lib/invoiceHtml.ts`): `buildInvoiceInnerHtml(data, tpl, biz, date)` (line 41), `buildInvoiceCss`, `buildInvoicePrintDocument`; `pickupSlipHtml.ts` exports `buildPrintDocument`. Callers verified: `InvoicePreview`, `MeasurementSlipPrint`/print paths import these builders.
- Plan classifies `dueCollection.ts` and `orderTimeline.ts` as print-document renderers. Verified: `dueCollection.ts:60,62` builds payment **descriptions** ("Due payment of ৳…") and `orderTimeline.ts:58,66` builds timeline entry strings — these are **persisted to the database**, not printed documents. Parameterizing them means new rows store "$…" for USD businesses while history keeps "৳…" — a mixed-symbol data-history consequence the plan never notes.

**Must change.** Correct the inventory numbers (or cite the canonical re-grep as the only source); rewrite the signature change against the real function names; reclassify `dueCollection`/`orderTimeline` as persisted-content writers and state the historical-consistency decision explicitly (e.g., symbol frozen at write time is acceptable — say so).

---

### 11. [MINOR] W2d's headline acceptance criterion is self-defeating: the new `src/lib/currency.ts` symbol map must itself contain the `৳` literal

**Evidence.** AC-1: `rg "৳" src/ --glob '!src/storefront/**' --glob '!*.test.*'` → 0 matches. The plan's own design puts `CURRENCY_SYMBOL: Record<string,string> = { BDT: "৳", … }` in `src/lib/currency.ts` — the sweep's own destination fails the sweep.

**Must change.** Exclude the symbol map from the AC, or scope the assertion to component/page files. An AC the implementation cannot pass by construction will be quietly amended at review time — make it precise now.

---

### 12. [MINOR] W4's pre-deploy census query conflates localStorage-only General saves with real `app_settings` writes, overcounting the lockout population

**Evidence.** Plan §5.2: `select distinct user_id from audit_log where action like 'settings%' …` — verified audit actions: `settings_general` (`SettingsPage.tsx:131` — **localStorage-only**, never touches `app_settings`), `settings_inventory` (`SettingsPage.tsx:196` — writes `app_settings`), `settings_preorder_categories` (`PreOrderCategoriesDialog.tsx:131` — writes `app_settings`). `LIKE 'settings%'` catches the localStorage action and flags users who never wrote the DB table.

**Must change.** Enumerate the two DB-writing actions (`settings_inventory`, `settings_preorder_categories`) explicitly in the census query.

---

### 13. [MINOR] W4 invents `has_permission_cached` when an identical SECURITY DEFINER function already exists

**Evidence.** Verified `20260420112330_…sql:169`:
```sql
CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission app_permission)
RETURNS BOOLEAN … STABLE SECURITY DEFINER SET search_path = public
```
It resolves preset + custom + override permissions — exactly what W4 needs (`get_user_permissions` at line 270 of the same file is the array wrapper around it). The plan's justification ("the cheapest safe check is a new helper mirroring `has_role`") shows the author did not sweep existing DB helpers. The new function is also misleadingly named ("cached") for something with no caching, as the plan itself admits.

**Must change.** Use `public.has_permission(auth.uid(), 'settings.manage'::app_permission)` in the policies; if its EXECUTE grant state is uncertain, add an explicit `REVOKE … GRANT EXECUTE TO authenticated` migration for it rather than minting a duplicate SECURITY DEFINER surface.

---

### 14. [MINOR] W9 contradicts itself on flag storage and ships contradictory artifacts

**Evidence.** §5.7 Design decision 1: "default OFF, enabled per-project via `app_settings` row `key='totp_enabled'` … we implement the RFS-lite variant: a `req_mfa` helper used by NO policies initially, shipped inert." Files/DB (§5.7 end): "DB: none. (No `app_settings` even for the flag — the flag lives client-side … the earlier `totp_enabled` idea is downgraded …)". One paragraph mandates an `app_settings` flag plus an inert helper function; the other forbids both. Which artifacts get built? No W9 migration exists at §5.5-level detail, so this contradiction surfaces mid-implementation.

**Must change.** Pick one design; delete the other's artifacts (the `app_settings` key plumbing or the `req_mfa` helper). An inert "security" helper used by zero policies is dead code in a security context — cut it.

---

### 15. [MINOR] W1b's "Why RPC over edge function" argues from a false premise

**Evidence.** Plan §2.2: "the edge function path can't do a single-statement atomic insert without also being granted service role" — verified: `team-manage` already runs with the service-role key (audit §3.3; `supabase/functions/team-manage/index.ts` builds an admin client). No "granting" would be needed. The real argument (single-transaction atomicity of business+access, no Deno deploy cycle, no CORS surface) stands on its own.

**Must change.** Rewrite the rationale without the false claim, or drop the comparison; the decision is right, the justification is wrong.

---

### 16. [MINOR] The W1 deploy-window instruction contradicts itself: "immediately before/after" vs. "order: migration first"

**Evidence.** §2.1 Deployment sequencing: "run the migration immediately before/after the Vercel deploy (order: migration first, then frontend …)". "Before/after" hedges the exact question the sentence then answers. For the riskiest cutover in the plan (the one window where fresh installs can break), an ambiguous instruction is how the wrong order happens.

**Must change.** One unambiguous runbook: (1) pre-deploy rogue-owner query; (2) `supabase db push`; (3) verify RPC + policies in SQL editor; (4) Vercel promote; (5) post-deploy smoke of create-business; (6) rollback referencing the embedded SQL only — never a sibling migrations file (Finding 1).

---

### 17. [MINOR] `business_has_other_owner` has a TOCTOU race: two concurrent owner-deletions can leave a business with zero owners

**Evidence.** The DELETE policy's USING checks `business_has_other_owner` at statement-evaluation time. Two owners deleting **each other's** rows concurrently can both pass USING under READ COMMITTED before either commit lands → business left ownerless (and now unmanageable — nobody satisfies `can_manage_business_access`). Same race applies to W7's `set_member_business_role` last-owner check.

**Must change.** Lock the membership rows in the check (`SELECT … FOR UPDATE` inside a plpgsql helper), or explicitly document the race as accepted with the platform-admin recovery path stated in W7's risks.

---

### 18. [MINOR] `create_business_with_owner` accepts unvalidated free-text slug/currency/timezone directly from PostgREST

**Evidence.** The RPC body validates only name/slug non-empty (`btrim`); `p_slug` can be `"My Slug!!"` (`businesses` has no slug-format CHECK — verified `20260904000100:22-35`), `p_currency`/`p_timezone` any string. The frontend slugifies and constrains via `CURRENCIES`/`TIMEZONES` (`BusinessAccountTab.tsx:21-30`), but the RPC is callable directly by any authenticated client, seeding malformed rows that the UI's passthrough-select then perpetuates.

**Must change.** Normalize slug (lowercase regex) and validate currency/timezone inside the RPC; raise clean errors.

---

### 19. [MINOR] The e2e claims quietly assume infrastructure the plan never provisions: Docker-based local Supabase on Windows, an email catch-all, TOTP generation, seeded auth fixtures

**Evidence.** §4.1 promises `authedUser(role, { businesses })` Playwright fixtures seeding via service-role client "against a local Supabase branch"; §5.6 W8 needs "Mailosaur-style catch-all OR admin `updateUserById`" (Mailosaur is a paid external service; "style" is undefined); §5.7 W9 AC-2 needs TOTP generation (`otplib` devDependency). None of these prerequisites (Docker Desktop running the local stack on this Windows box, catch-all inbox, otpauth fixture) appears in W0's file list or the effort table; W0 is priced at 1 day. The `lovable-agent-playwright-config` wrapper's ability to even carry a `webServer`/`baseURL` override is unverified (see Assumptions).

**Must change.** Enumerate the environment prerequisites in W0, or descope the affected e2e specs to manual runbooks with the RLS harness covering the assertions — and say which ACs become manual.

---

### 20. [NIT] The UPDATE policy carries dead code labeled as a guard

**Evidence.** `AND (user_id = auth.uid() IS FALSE OR role IN ('owner','admin','member','viewer'))  -- no-op guard` — the role list covers the full CHECK constraint domain of the table, so the disjunction is always true. Dead conditions inside a security policy invite misreading during future edits.

**Must change.** Delete the clause (the plan itself labels it a no-op — then it should not ship).

---

### 21. [NIT] `user_id = auth.uid() IS FALSE` is precedence-obscure

**Evidence.** It parses as `(user_id = auth.uid()) IS FALSE` — correct, but only if the reader knows `IS FALSE` binds looser than `=`. `user_id IS DISTINCT FROM auth.uid()` says the same thing unambiguously.

**Must change.** Rewrite with `IS DISTINCT FROM`.

---

### 22. [NIT] W9's `otplib` devDependency sits uneasily beside "No new heavyweight dependencies"

**Evidence.** §0.6 declares no new heavyweight deps; §5.7 AC-2 adds `otplib` as a devDependency. Light and dev-only, but the constraint and the add should be reconciled (or the TOTP generated with a ~15-line WebCrypto test helper instead).

**Must change.** One sentence in §5.7 acknowledging the devDep exception, or a tiny in-repo TOTP test util.

---

### 23. [NIT] The plan calls `invoiceHtml.test.ts` assertions "snapshots"; they are plain expects

**Evidence.** §3.2 W2b AC-3: "vitest snapshot on `invoiceHtml.test.ts` still green"; §7 matrix W2b row: "snapshot invoiceHtml (existing)". Verified: the file has 29 `expect(` assertions, 3 `৳` occurrences — no snapshot testing.

**Must change.** Say "existing assertions stay green."

---

### 24. [NIT] W2b's tab-definition sketch won't compile against the real `TabDef` type

**Evidence.** Plan: `keywords: ["invoice", "header", …]` (array). Verified `SettingsPage.tsx:41-42`: `keywords?: string` — a single string (see line 65's usage). The plan's code sketches are elsewhere line-accurate; this one isn't.

**Must change.** `keywords: "invoice header logo print brand"`.

---

### 25. [NIT] The retained error copy "only account admins can provision new businesses" is misleading after W1b (compounds Finding 3)

**Evidence.** §2.3 keeps `BusinessAccountTab.tsx:298`'s copy as the "generic failure fallback" while (per the plan's own parenthetical) "any authenticated user can now create a new business legitimately." A DB failure will show users a false explanation.

**Must change.** Replace with a neutral "Could not create the business — please try again" fallback.

---

### 26. [NIT] Broken internal cross-reference: "see §2.1.3"

**Evidence.** §2.1 Files cites "§2.1.3" for the rollback-file rationale; no §2.1.3 exists in the document (the section runs §2.1 → §2.2 → §2.3).

**Must change.** Fix the reference (the rationale lives inline in §2.1 Files).

---

### 27. [NIT] `supabase/tests/enable_pgtap.sql` has no defined application path

**Evidence.** §4.1 places the pgTAP-enabling script under `supabase/tests/`, "applied by the harness" — but `supabase db reset` applies only `supabase/migrations/`, and `supabase test db` runs tests, not setup scripts. The harness runner must apply it out-of-band (or pgTAP must be pre-enabled in the local stack config), which is unstated.

**Must change.** Specify the mechanism (e.g., `test:rls` pipes `enable_pgtap.sql` through `supabase db psql` before `supabase test db`).

---

## Assumptions I could NOT verify

1. **Prod Supabase dashboard settings** — whether "Secure email change" is actually ON and TOTP MFA is available on the project's plan tier (dashboard-only state; the plan asserts defaults).
2. **gotrue-js 2.101.1 MFA error surface** — whether `signInWithPassword` exposes `mfa_factor_id` on the returned `AuthApiError` in this exact version (I did not inspect `node_modules/@supabase/gotrue-js`; W9's `parseMfaError` design depends on this shape).
3. **`lovable-agent-playwright-config` extensibility** — whether `createLovableConfig` supports `webServer`/`use.baseURL` overrides and what the re-exported fixture provides (both files are thin wrappers around a package I did not open).
4. **Clean from-zero replay of all 134 migrations** — almost certainly NOT clean (lovable-era migrations embed live-data backfills; several reference tables with pre-existing rows), but I did not execute `supabase db reset` (instructed not to run builds; also Docker dependency). This is why Finding 6 is a MAJOR rather than a BLOCKER: the failure mode is schedule/correctness-of-test-claims, not a shipped vulnerability.
5. **`team-manage` edge function full behavior** — I read its action dispatch (user_roles/invitations writes only; no `user_business_access` writes), but did not trace its auth path end-to-end beyond the audit's account.
6. **Prod data state** — whether rogue `user_business_access` rows already exist (the plan's pre-deploy query is the right instrument; I have no DB access).
7. **React-router `useBlocker` runtime behavior under this exact 6.30.1 build** — the data-router requirement is documented API behavior; I did not execute the app to confirm the throw.

---

## Verdict

**REVISE**

Must-fix set = Findings **1–7** (all BLOCKERs + MAJORs):

1. **[BLOCKER] F1** — rollback `.sql` inside `supabase/migrations/` will execute as a forward migration and re-open the P0 hole. Remove it from the migrations dir.
2. **[MAJOR] F2** — realtime mitigation is built on a false premise (`user_business_access` is not in the publication); fix the migration, the risk item, and the e2e expectations.
3. **[MAJOR] F3** — W1b changes product entitlement (any authenticated user can create/own businesses) hidden inside a security fix; restrict to admin or make it an explicit signed-off product decision.
4. **[MAJOR] F4** — W8's behavior contract misstates Supabase email-change semantics; contract #3 is unimplementable as written; specify the client-side re-auth step.
5. **[MAJOR] F5** — W6 promises route-level blocking (`useBlocker`) impossible under the app's `BrowserRouter`; add the router migration as a work item or drop the claim.
6. **[MAJOR] F6** — W0 harness contains a fabricated CLI flag (`--linked`), conflates local stack with platform branches, and assumes unproven 134-migration replay; fix the script, the vocabulary, and add the replay-verification pre-step with contingency.
7. **[MAJOR] F7** — the "Members can write businesses" FOR ALL policy (member UPDATE/DELETE + cascade destruction) is left untouched and unacknowledged; schedule the tightening (plus BusinessAccountTab role-gating) or record it explicitly in §11.

The MINOR/NIT items (F8–F27) should be addressed in the revision but do not block approval.

