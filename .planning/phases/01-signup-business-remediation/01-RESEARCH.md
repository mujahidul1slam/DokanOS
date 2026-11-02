# Phase 1: Signup-Business Remediation (Release 1) — Research

**Researched:** 2026-10-06
**Domain:** Supabase Postgres RPC/RLS provisioning + React 18 route/wizard integration + vitest seam testing
**Confidence:** HIGH (every claim below was verified against the current working tree at HEAD `778e432` via direct file reads this session)

## Summary

Release 1 (R0 + R1 + R3 + R4a + R4, atomic per audit §4) rewrites `signup_create_business_core` to stop creating 9 template rows per new business, moves the 3-table slug-retry + store/brand/storefront creation into a new member-callable `create_my_brand_store` RPC, retargets the post-signup funnel from `/welcome` to a new `/onboarding` wizard, makes StoresHub render connection truth, and ships a report-only detection script for cleaning up businesses already provisioned with template rows during the `signup_open` test window.

The backend surface is fully verified: the current provisioning body (20260925120100:40–216) creates business + store + brand + location + storefront + 4 selling_points + connector + 2 sources + UBA + a **32-key** permission bundle (comment at :160 wrongly says 31) + 1 user_store_access row, inside a slug-collision retry loop (:91–153) that spans `businesses.slug`, `brands.slug`, `storefronts.slug`. Every line citation in the audit (slug loop :81–153, "31" comment :160, store-access :199, assertion :208–212, StoresHub :137–139/:581/:648, kill switch signup-provision/index.ts:48–57, publish chain 20260925140000:61–109, delete invariants :170–180) **matches the current tree exactly** — `git diff --name-only ffb6648..HEAD` shows the 6 post-ffb6648 commits touched only `src/App.tsx`, storefront-admin files, and docs. No drift on any in-scope claim.

Beyond the audit, research surfaced material the planner must handle: **(1)** `AuthConfirm.tsx` has **four** `/welcome`-family navigations, not two — the two `/welcome/setup-failed` error navigations (:91–93, :167–169) also need retargeting when D-10 retires those routes; **(2)** `scripts/test_signup_rpc.sql` is an existing integration test that asserts the **old** template shape (parity rows ≥1, exactly 32 perms, user_store_access = 1) and **will fail after R1** unless rewritten — it is also the natural home for the new acceptance criteria; **(3)** a second, admin-only business-creation RPC `create_business_with_owner` is still live from `BusinessAccountTab.tsx:379` — it already creates blank businesses (business + owner UBA only), so it is consistent with blank-slate but those businesses will hit the R4 resume guard; **(4)** the test infrastructure is better than the phase facts assumed: 11 test files exist, `vitest.config.ts` already configures jsdom + globals + jest-dom + the `@` alias, `@testing-library/react@16` is installed, and `vi.mock` is already used in `invoiceHtml.test.ts` — D-17 seam tests need **zero** framework setup; **(5)** `businesses` has no onboarding column but the tightened `Owners can update businesses` policy makes a plain column the simplest cross-device marker.

**Primary recommendation:** Plan R1+R4a as two migrations in one atomic push (R1 core rewrite + bundle fix; R4a new RPC + verify fn), rewrite `scripts/test_signup_rpc.sql` as the R1 acceptance script, put the R0 detector at `.planning/detect-window-businesses.sql` following the `verify-deployment.sql` paste-into-Dashboard convention, and build the wizard as small step components under `/onboarding` with a route-level resume guard keyed off `useBusinessContext` (zero brands) + a `businesses.onboarding_completed_at` marker.

<user_constraints>

## User Constraints (from CONTEXT.md — copied verbatim; D-01…D-18 are LOCKED)

### Locked Decisions

**Admin UI scoping (audit's embedded product decision — now CONFIRMED)**
- **D-01:** Business switcher is **per-business only**. No "All businesses" pseudo-entity, no unfiltered branch anywhere in the UI. All 10 surfaces always render exactly one active business (via `useBusinessStores()`). — **Reversibility:** costly — undo would re-edit query shapes across all 10 surfaces.
- **D-02:** Global lens is the **SQL editor only** (Supabase Studio / psql). No admin SQL views, no in-app global oversight in this remediation.
- **D-03:** Platform **admin and staff are treated identically**: UI business-scoped for both; SQL/RLS keeps both global (member_scoped_rls `has_role` short-circuit, lines 21–22, stays). Zero special cases in `useBusinessStores`.
- **D-04:** Zero-membership sessions get a **hard redirect into the create-business flow** — same guard mechanism as the R4 resume guard, triggered by "no business memberships" instead of "no stores". Applies to any authenticated account (platform accounts, legacy accounts).
  - **Reversibility:** reversible.

**Broken-window cleanup (new deliverable — R0)**
- **D-05:** Cleanup is **detection-based, never date-based**. The detector matches the fake-template signature (placeholder store URL, all connectors `'disconnected'`, zero real data) and only matching businesses are ever reported. No wholesale "created after ffb6648" logic.
- **D-06:** **Report-only, manual.** The script prints match candidates with evidence columns; the user personally reviews and runs any destructive SQL. NO destructive code ships with the remediation. — **Reversibility:** reversible.
- **D-07:** Report scope = **evidence per match** only: created_at, owner email, placeholder store URL, connector statuses, template-table row counts, real-data presence. No integrity checks, no bundle audits.
- **D-08:** The script lives in `.planning/` (next to `verify-deployment.sql`, matching convention) and is run by the user **during Release 1 development, before R1 acceptance verification** — so window artifacts don't pollute wizard/StoresHub testing and manual cleanup can happen first.

**Wizard UX shape (extends R4)**
- **D-09:** Wizard steps 2 (locations/warehouse) and 3 (selling points) are **skippable via "skip for now"**; an explicit finish sets an **onboarding-done marker** (server-side, cross-device — storage mechanism is planner's choice). The audit's resume-at-step-3 guard then fires ONLY on abandonment (store exists, no done marker); explicit finishers are never re-trapped. Rationale: step 3's options (POS/Woo/Facebook) are wrong for a storefront-only merchant. This refines the audit's acceptance criterion "wizard resume at step 3 for store-without-selling-points state" to mean abandonment-only.
- **D-10:** Wizard lives at a **new `/onboarding` route as a full-page multi-step component**. `/welcome` and `/welcome/setup-failed` are retired; AuthConfirm's two call sites (:100, :174) retarget to `/onboarding`.
- **D-11:** The reserved storefront URL is shown as a **read-only live preview at step 1**, derived from the store name as typed ("reserved for you" wording — reservation, not publication). Fixes CreateBusinessDialog's false preview (:104) by the same treatment. No editable slug field.
- **D-12:** **Finish → Dashboard** with a success toast (StoresHub CTAs / R3 empty states remain the path for skipped items). The **zero-membership hard redirect (D-04) lands on a create-business flow** (CreateBusinessDialog pattern, R4-rewritten copy) — NOT the wizard; there is no business yet to onboard.

**Adjacent read holes (extends R2c)** [Phase 2 scope — recorded for continuity]
- **D-13 / D-14:** Fold `pathao_integrations`/`courier_shipments` read holes into R2c (Phase 2); policy-scoping only, no vault changes.
- **D-15:** **Two phases**: Phase 1 = Release 1 (R0 + R1+R3+R4a+R4, ≈4.5d, atomic per audit); Phase 2 = Release 2 (R2a→R2d).
- **D-16:** **Phase 2 is planned only after Release 1 ships and verifies.**
- **D-17:** **SQL + seam tests.** The audit's SQL/member-JWT acceptance scripts (run by the user per release) PLUS a small vitest layer on the new frontend seams only: `useBusinessStores` fail-closed behaviors (empty business → empty list, never all stores), wizard guards (zero-membership redirect, resume-at-step-3, done-flag semantics), R4a wrapper idempotency. Rides the existing vitest+jsdom setup. ≈ +1d across both phases.
- **D-18:** `signup_open` stays `false` through both releases and is flipped **manually by the operator via SQL/settings after Release 2 verifies**. No migration auto-opens signup; the kill switch (signup-provision/index.ts:48–57) stays operator-controlled.

### The Agent's Discretion
- Wizard visual/component structure inside the `/onboarding` page (follow existing shadcn/ui + page patterns; the audit's god-component anti-pattern applies — keep steps as small components).
- Storage mechanism for the onboarding-done marker (D-09) — any server-side mechanism that survives cross-device login.
- Detection script's exact SQL (D-05–D-08) — signature must implement the locked semantics.
- R2b picker-sweep mechanics within the audit's locked 18-file checklist. [Phase 2]
- Deployment ordering within each atomic release (migrations → edge fns → frontend).

### Deferred Ideas (OUT OF SCOPE)
- **Platform admin console** — in-app global oversight views for platform staff. Future phase.
- **New-signup notifications** — signaling new tenant signups to the platform admin. Future phase.
- **Additional self-serve stores** — beyond the declared one-store/one-brand cap (audit R4a); future flow via the same `create_my_brand_store` RPC.
- **Column-level secret hiding / vault migration** (D-14 defers; CONCERNS.md endgame). Future security pass.
- **UBA-based team invitations + business-scoped `team-manage`**. Future phase.
- R2a–R2d implementation (Phase 2 / Release 2) — out of planning scope NOW; Release-1 compatibility constraints are recorded in this research.
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description (audit §4 v3, Release 1 scope) | Research Support |
|----|---------------------------------------------|------------------|
| **R0** | Report-only window-business detection script in `.planning/`, signature-based (D-05–D-08), run by user before R1 acceptance | Signature table built from verified provisioning INSERTs (see "R0 Signature Table"); `verify-deployment.sql` paste-into-Dashboard convention captured; `storefront_domain` seed + placeholder URL literal verified |
| **R1** | Blank-slate rewrite of `signup_create_business_core`: keep business + UBA('owner') + permission bundle (fix to 33 keys incl. `storefronts.view`); drop all row creation; keep gates/idempotency/consent/audit; remove store-access assertion; add per-user 24h idempotency guard to `create_additional_business` | Current fn body mapped line-by-line (survive/drop/move below); 32-key bundle enumerated verbatim; guard insertion point identified; existing test script that must be rewritten identified |
| **R3** | StoresHub connection-truth: drop `brand_id.is.null` leakage (:137–139), badges only for real connections, empty-state Connect CTAs, `useStoresList` fails CLOSED | Current leakage + badge lines verified exact; `useStoresList` fail-open mechanics captured (:31–37); reusable panel/dialog components inventoried |
| **R4a** | New `create_my_brand_store(p_business_id, p_name)` SECURITY DEFINER RPC: UBA owner/admin assert, one transaction (store + brand + user_store_access + inactive placeholder storefront w/ reserved slug), carries the moved slug retry + `storefront_domain` check, idempotent per business, declared single-store cap, own migration + verify fn, GRANT TO authenticated | Full mechanics of the block being moved verified (:81–153); house verify-fn idiom captured from 3 recent examples; member INSERT policy absence on stores confirmed; publish chain compatibility verified |
| **R4** | Onboarding wizard at `/onboarding` (4 steps via existing policies/RPCs), resume guard, AuthConfirm retarget, Welcome retirement, CreateBusinessDialog copy + preview fixes, wizard resumability (abandonment-only per D-09) | Route table + both welcome routes verified; 4 (not 2) AuthConfirm nav sites; membership/brand loading verified in `useBusinessContext`; marker storage options analyzed; member INSERT policy for steps 2–3 verified (is_business_member, 20260904000100:338–348) |
| Gate-regression | Kill switch, purge + retention fns, `delete_unprovisioned_self` invariants asserted unchanged | All three verified at current lines; behavior under blank-slate reasoned and documented |
</phase_requirements>

## Project Constraints (from AGENTS.md / CLAUDE.md)

`AGENTS.md` (repo root) contains only context-mode **tooling** routing rules (sandbox-first analysis, no curl in shell) — no code conventions that bind implementation.

`CLAUDE.md` (repo root) carries behavioral guidelines the executor must honor [VERIFIED: CLAUDE.md, read via PowerShell — sections 1–4]:
1. **Think Before Coding** — state assumptions explicitly; if uncertain, ask; don't pick between interpretations silently.
2. **Simplicity First** — minimum code that solves it; "Would a senior engineer say this is overcomplicated?"; no speculative flexibility.
3. **Surgical Changes** — touch only what the task requires; match existing style; every changed line traces to the request; don't delete pre-existing dead code.
4. **Goal-Driven Execution** — transform tasks into verifiable goals ("write tests for invalid inputs, then make them pass"); state plan with verify steps.

These directly reinforce: no drive-by refactors in the R1 rewrite (keep gate code byte-identical where the audit says "keep"), wizard steps as small components, and acceptance scripts written alongside the code they verify.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Business provisioning (blank-slate) | DB — SECURITY DEFINER RPC (`signup_create_business_core`, service_role-only) | Edge fn (JWT verify + kill switch + rate limit wrapper only) | Provisioning is a transaction; edge fns only authenticate and map errors. Client never writes tenant tables [VERIFIED: 20260925120100:35, :218, :330] |
| Kill switch (`signup_open`) | DB — `app_config` row + edge-fn runtime check | Operator (manual SQL flip) | Edge reads `app_config.signup_open` per invocation; fail-closed when missing [VERIFIED: signup-utils.ts `isSignupOpen`, signup-provision/index.ts:48–57] |
| First store/brand/storefront creation (R4a) | DB — SECURITY DEFINER RPC granted to `authenticated`, caller-JWT assert | — | No member INSERT policy exists on `stores`/`user_store_access` (verified); the RPC is the only member-usable path [VERIFIED: member_scoped_rls:68–83; 20260420112330:135–138] |
| Wizard steps 2–3 (locations, selling points) | DB — RLS member INSERT policies via `is_business_member` | Client — direct `supabase.from(...).insert(...)` | Policies already exist and are audit-locked as "ride unchanged" [VERIFIED: 20260904000100:346–348] |
| Storefront publish (wizard step 4) | DB — `publish_my_storefront` flip-only RPC | — | 4-assertion chain satisfied by construction on the R4a-reserved storefront [VERIFIED: 20260925140000:74–109, :131] |
| Route guarding (resume, zero-membership) | Client — route-level component reading `useBusinessContext` | — | `PermissionGuard` is a *render* guard on permissions only [VERIFIED: PermissionGuard.tsx:22–28]; business-state guards are new |
| Connection-truth UI (R3) | Client — StoresHub + `useStoresList` fail-closed | DB — existing member-scoped SELECT RLS | Read policies already exist; R3 is a frontend truth fix [VERIFIED: member_scoped_rls:74–77] |
| Detection report (R0) | DB — read-only SQL pasted into Dashboard SQL Editor (service context) | — | Report-only per D-06; the operator runs it with elevated visibility by design |
| Onboarding-done marker | DB — `businesses` column (recommended) | — | Cross-device per D-09; owner-writable via existing UPDATE policy [VERIFIED: 20260911000120:24–29] |

## Standard Stack

**No new packages are required for Release 1.** Every capability rides the existing stack. This section documents the verified versions of what the plan will use.

### Core (verified in package.json — read this session)
| Library | Version | Purpose in Release 1 |
|---------|---------|---------------------|
| `@supabase/supabase-js` | ^2.101.1 (client) / `npm:@supabase/supabase-js@2.49.4` (edge fns) | Client RPC calls (`create_my_brand_store`, `publish_my_storefront`), wizard inserts |
| `react-router-dom` | ^6.30.1 | `/onboarding` route, guards, `Navigate` redirects |
| `react` / `react-dom` | ^18.3.1 | Wizard step components |
| `vitest` | ^3.2.4 | D-17 seam tests |
| `jsdom` | ^20.0.3 | vitest environment [VERIFIED: vitest.config.ts:8 `environment: "jsdom"`] |
| `@testing-library/react` | ^16.0.0 | Hook/component seam tests (installed, currently unused) |
| `@testing-library/jest-dom` | ^6.6.0 | DOM assertions [VERIFIED: src/test/setup.ts:1] |
| `sonner` | ^1.7.4 | Success toasts (D-12 finish toast) |
| shadcn/ui (Radix) | various ^1.x/^2.x | Wizard step UI (Card, Button, Input, Label, Checkbox, Dialog) |

### Supporting
| Tool | Version | Purpose |
|-----|---------|---------|
| Supabase CLI (unversioned, host-installed) | — | `supabase db push` (deploy), `supabase db reset` (local chain test), `supabase functions deploy`, type regeneration [VERIFIED: verify-deployment.sql:2–3 documents `supabase db push`; package.json:15 `test:rls` uses `supabase db reset`] |
| pg (node) | ^8.23.0 | `scripts/run-rls-tests.mjs` local battery |

**Installation:** none. Do NOT add dependencies for this phase.

## Package Legitimacy Audit

No external packages are installed or recommended by this research. All work uses existing dependencies. **Verdict: N/A — nothing to audit, nothing to add.**

## Current-State Verification (the planner's ground truth)

Drift baseline: `git diff --name-only ffb6648..HEAD` = `01-CONTEXT.md`, `01-DISCUSSION-LOG.md`, `SIGNUP-BUSINESS-AUDIT*.md` (3), `STOREFRONT-UI-REVIEW.md`, `src/App.tsx`, 6 storefront-admin files, `src/pages/StorefrontsPage.tsx`, `src/storefront/lib/catalog.ts`. **No migration, edge function, hook, AuthConfirm, Welcome, StoresHub, or CreateBusinessDialog file changed.** All audit file:line claims were re-verified individually below.

### 1. R1 — current exact shape of `signup_create_business_core`

File: `supabase/migrations/20260925120100_signup_provision_fns.sql` (515 physical lines). The fn is `CREATE OR REPLACE FUNCTION public.signup_create_business_core(p_user_id uuid, p_business_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''` (:40–48), REVOKE'd from PUBLIC/anon/authenticated (:218) — reachable only via the two service_role entry RPCs.

**SURVIVES R1 unchanged (keep, byte-identical):**
- Advisory lock serializing provisioning per user: `PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));` (:63)
- Name normalization + validation: `v_name := btrim(coalesce(p_business_name, ''));` + 1–100 length check raising `PROVISION_INVALID_NAME` (:66–70)
- Slug-base derivation (:74–79): `lower(regexp_replace(trim(v_name), '[^a-zA-Z0-9]+', '-', 'g'))`, trimmed, `store-<4 random>` fallback when < 2 chars, `left(v_slug_base, 60)`
- Businesses slug + retry semantics — the LOOP/nested-block/`EXIT`/`unique_violation`-after-5-attempts structure (:91–153) survives but shrinks to `businesses` INSERT only (:99–101: `INSERT INTO public.businesses (name, slug) VALUES (v_name, v_slug) RETURNING id INTO v_business_id;`)
- UBA owner row (:156–157): `INSERT INTO public.user_business_access (user_id, business_id, role) VALUES (p_user_id, v_business_id, 'owner');`
- Permission bundle with `ON CONFLICT (user_id, permission) DO NOTHING` (:162–196) — survives with the 33rd key added
- UBA post-insert assertion (:203–207) — survives
- Return shape (:214): `RETURN jsonb_build_object('slug', v_slug, 'business_id', v_business_id);` — **AuthConfirm and the wizard consume `slug` and `business_id` from this** [VERIFIED: AuthConfirm.tsx:84 `provData?.slug`, CreateBusinessDialog.tsx:55 `data?.business_id`]

**DROPS in R1 (per audit):**
- `stores` INSERT (:103–105) — placeholder URL `'https://' || v_slug || '.' || v_store_domain`, status `'disconnected'`
- `brands` INSERT (:107–109), `locations` INSERT (:111–113, `'Main'`/`showroom`/`is_default true`), `storefronts` INSERT (:115–117, `is_active false`)
- 4 selling_points INSERTs (:121–133): `'Showroom POS'`/showroom_pos, `v_name || ' WooCommerce'`/woocommerce, `'Facebook / Instagram'`/facebook (**conditional**: only `IF v_fb_src_exists` — i.e. when `order_sources` has a `'fb/ig'` row, :88–89), `v_name || ' Storefront'`/dokanos_storefront
- `connectors` INSERT (:135–137, channel/woocommerce/`'disconnected'`), `product_sources` INSERT (:139–140, `'WooCommerce catalog'`/two_way), `customer_sources` INSERT (:142–143, `'WooCommerce customers'`/import)
- `user_store_access` INSERT (:199–200) and its post-insert assertion (:208–212) — removed coherently per audit; both reappear inside R4a's RPC
- The `storefront_domain` read + check (:81–86) and the `order_sources` fb check (:88–89) — no longer needed by the core (no store URL to build); the domain check **moves to R4a**
- The "31 keys" comment (:159–161, verbatim: `-- 31 keys per SIGNUP-DISCOVERY.md §2 — excludes settings.manage,` / `-- integrations.manage, stores.manage, team.manage.`) — fix the count as part of the 33-key change

**The permission bundle — exact current 32 keys, verbatim from :164–195:**
```
dashboard.view, orders.view, orders.create, orders.edit, orders.delete,
orders.change_status, orders.dispatch, orders.refund, orders.log_payment,
orders.discount_large, preorders.view, preorders.manage, customers.view,
customers.edit, customers.delete, products.view, products.create,
products.edit, products.delete, products.view_cost, products.edit_cost,
pos.use, pos.discount_large, pos.refund, pos.shift_close, analytics.view,
analytics.view_revenue, integrations.view, stores.view, settings.view,
team.view, audit.view
```
[VERIFIED: counted in-source this session]. `storefronts.view` is **absent** — R1 adds `(p_user_id, 'storefronts.view')` → 33 keys. The enum already contains `storefronts.view` (permission guard live on `/storefronts/*` routes, App.tsx:131–132/:155; added to the enum in commit `8f20cba`), so **no enum migration is needed — only the INSERT list grows**. Corroborating in-repo evidence: `scripts/test_signup_rpc.sql:140–144` asserts `v_perm_count <> 32` fails with "Owner permissions count must be exactly 32 (36 minus 4 excluded)" — after R1 this must read 33, and the same script's forbidden-keys check (:146–152: `settings.manage`, `team.manage`, `integrations.manage`, `stores.manage`) stays valid.

**`create_additional_business` current idempotency state: NONE.** (:336–372). Its only guards are: user exists (:349–352), email confirmed (:353–355), and member-or-platform-admin check (:357–363: `IF NOT EXISTS (SELECT 1 FROM public.user_business_access WHERE user_id = p_user_id) AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role IN ('admin', 'staff')) THEN RAISE 'PROVISION_NOT_MEMBER'`). It then calls `signup_create_business_core` directly (:365) and writes a `'business_added'` signup_event (:367–368). Double-invoke with the same name today = a second business with a `-2`-suffixed slug. **The R1 guard must replace this:** key = `(p_user_id, canonical slug-base)` matched against **that user's own** businesses created within 24 h; on match return the existing business (same `{slug, business_id}` shape); different names always create new; a user B reusing user A's taken name gets a fresh suffixed slug because A's businesses are not B's. Acceptance tests for this are the audit's three (double-invoke → same id; different name → new; user-B-vs-A → suffixed, never A's). Insertion point: after the member check, before the core call.

**Gates that R1 must keep green (all in `provision_owner_business`, :225–327 — untouched by the rewrite):** already-provisioned idempotent return (:245–253), email-confirmed (:255–257), 24h account expiry (:258–260), provider=email (:261–263), not-invited (:264–266), disposable-domain on user email (:268–274), anchor match — canonical email + nonce + 24h + created_at window (:278–292), disposable-domain on anchor (:294–300), consent records ×2 (:306–314), `'provisioned'` audit event (:317–319), anchor consumed flag (:321–323). The edge fn `signup-provision` maps all `PROVISION_*` codes to HTTP statuses (:87–114) — unchanged by R1.

### 2. R4a — the block being moved, and the shape of the new RPC

**The 3-table slug retry + domain check to move (verified current, :81–153):** reads `app_config.storefront_domain` (:81–86, raises `PROVISION_RETRYABLE` if unset — seed value `"stores.dokanos.app"` [VERIFIED: 20260925120000:116]); retry LOOP across one candidate slug checked against **three** unique columns — `businesses.slug`, `brands.slug`, `storefronts.slug` (:91–92 comment: "Slug-collision retry across ALL THREE unique slug columns"); candidates `slug` then `left(slug_base,55) || '-' || attempt` (:94–96); nested BEGIN block with `EXCEPTION WHEN unique_violation` → retry, hard-fail at 5 attempts (:146–152). **Important:** even after R1 removes businesses-creation from R4a's transaction, the new store/brand/storefront slug candidate must STILL be checked against all three unique columns — a wizard store named like an existing business would otherwise hit businesses.slug. The retry set moves as-is.

**`create_my_brand_store(p_business_id, p_name)` required shape (locked by audit + critiques):**
- `SECURITY DEFINER`, `SET search_path = ''`, plpgsql
- Assert `auth.uid()` caller has UBA role `IN ('owner','admin')` on `p_business_id` — house idiom verbatim from `publish_my_storefront` (:96–101): `IF NOT EXISTS (SELECT 1 FROM public.user_business_access WHERE user_id = v_user_id AND business_id = v_biz_id AND role IN ('owner', 'admin')) THEN RAISE EXCEPTION 'FORBIDDEN: owner or admin role required'`
- **One transaction:** `stores (name, url, status='disconnected')` → `brands (business_id, name, slug, woo_store_id=store.id)` → `user_store_access (user_id, store_id)` → `storefronts (name, store_id, slug, is_active=false)` carrying the reserved slug. Note `storefronts.is_active` **defaults to `true`** [VERIFIED: 20260516201928:21 `is_active boolean NOT NULL DEFAULT true`] — the RPC MUST pass `false` explicitly (core did, :116). Insert shapes match core :103–117 exactly.
- Idempotent per business: pre-check whether the business already has a brand with a linked store → return the existing store/brand. Declared cap: one self-serve store/brand per business. **Design note:** July-backfilled businesses (e.g. "Enveil Vincent") have 2 brands with stores — the idempotency pre-check should be scoped as "brand with woo_store_id IS NOT NULL exists for this business → return it", which makes the RPC a no-op for backfilled businesses and never shows them the wizard (resume guard requires zero brands).
- Carry the moved slug retry + `storefront_domain` check (needed because `stores.url` is `TEXT NOT NULL` [VERIFIED: 20260407071618:15] and the URL preview at wizard step 1 derives from it)
- `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated` (house pattern: 20260925140000:130–131)
- Own migration + verify fn

**House verify-migration idiom (the newest convention, follow `verify_signup_fns` / `verify_signup_publish_and_delete_rpcs`, not the older `verify_multi_business_foundation`):** `CREATE OR REPLACE FUNCTION public.verify_<name>() RETURNS jsonb LANGUAGE plpgsql SET search_path = ''` with `RAISE EXCEPTION` on each missing object (pg_proc existence checks joined on `pg_namespace`), grant assertions where relevant, `jsonb_build_object('status','ok', ...)` return, then `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO service_role, authenticated` [VERIFIED: 20260925120100:466–515; 20260925140000:281–338; 20260925120000:150–222]. The verify fn should assert: RPC exists, is granted to authenticated (not anon), and is NOT granted to service_role-only… (i.e. positive grant checks mirroring `verify_signup_fns` negative grant check at :486–494).

**Migration numbering:** newest existing migration is `20260929120000_member_scoped_rls.sql`; new migrations take fresh `20261006xxxxxx_`-style prefixes after it (134+ files, linear chain — `supabase db reset` is the only full-schema test per CONCERNS.md:141–144).

**Rollback convention:** `.planning/rollbacks/<migration_name>.md` — 5 existing examples [VERIFIED: directory listing]. New migrations should get matching rollback notes.

### 3. R3 — StoresHub + useStoresList current state

**Leakage (verified exact, audit claim holds):** `StoresHub.tsx:137–139` —
```typescript
supabase.from("connectors").select("*").or(`brand_id.eq.${brand.id},brand_id.is.null`).order("category").order("name"),
supabase.from("product_sources").select("*").or(`brand_id.eq.${brand.id},brand_id.is.null`).order("name"),
supabase.from("customer_sources").select("*").or(`brand_id.eq.${brand.id},brand_id.is.null`).order("name"),
```
Global/shared rows (brand_id NULL) leak into every brand's panel. Fix: drop the `,brand_id.is.null` from all three (locations :135 and selling_points :136 already filter correctly with plain `.eq("brand_id", ...)`).

**Badges (verified exact):** connectors badge `StoresHub.tsx:581` `<Badge variant={c.status === "connected" ? "default" : "secondary"}>`; sources badge `:648` `<Badge variant={s.status === "connected" ? "default" : "secondary"}>`. Placeholder rows with `'disconnected'` render as secondary badges but still appear as channel cards ("WooCommerce — disconnected" reads as a connection in the card list). R3: render rows only when they represent real connections; `'disconnected'` template rows vanish once R1 stops creating them; empty states become Connect CTAs.

**Empty states + CTA targets:** current per-tab empties are plain text — "No locations." (:278), "No selling points." (:379), "No connectors." (:568), "No sources registered." (:636), plus the brand-count zero copy at :85–89 ("No brands yet. Brands are created automatically when a WooCommerce store is connected." — false after R1; rewrite). The existing add-dialogs are the CTA targets: `LocationsPanel` dialog (:295–338), `SellingPointsPanel` dialog (:400–441), `SourcesPanel` dialog (:655–697) — R3 CTAs should open these or link to wizard steps.

**`useStoresList` fail-open mechanics (verified, :16–45):**
```typescript
const activeStoreIds = brands.map((b) => b.woo_store_id).filter(Boolean) as string[];
if (activeStoreIds.length > 0) {
  query = query.in("id", activeStoreIds);
}
```
Zero brand-stores → **no filter** → the query returns every store RLS lets the caller read (for a platform admin: all tenants' stores). **Fail-closed concretely means:** when a business context exists (activeId set) and `activeStoreIds.length === 0`, return `[]` without querying. Also note the hook swallows provider absence via try/catch (:20–26, "Graceful fallback if called outside BusinessContextProvider") — that outside-provider path is a second fail-open; keep it only for genuinely public surfaces or fail closed there too. Test seam: the effect deps are `[activeId, brands.length]` (:42).

**Scoping today:** audit F1.1 verified — `.eq("business_id")` exists in exactly two frontend places: `useBusinessContext` brands load (:127) and `StorefrontsPage`. Everything else is union-of-memberships. `usePermissions.hasStoreAccess` is fail-open and forbidden for scoping [VERIFIED: usePermissions.tsx:56–61 — `if (isAdmin) return true;` … `if (storeIds.length === 0) return true; // unrestricted`; `storeIds` comes from `get_user_store_ids` which unions across ALL businesses]. R3's fix must not touch usePermissions.

### 4. R4 — wizard integration points (all verified current)

**Route table (`App.tsx`, 234 lines at HEAD — file DID change post-ffb6648 but only in storefront-admin preview routes; the signup-relevant routes are unchanged):**
- Unauthenticated branch (:107–118): `/login`, `/signup`, `/check-email`, `/auth/confirm`, **`/welcome` (:113)**, **`/welcome/setup-failed` (:114)**, `/reset-password`, `* → /login`.
- Authenticated branch (:121–169): **`/welcome` (:123)** and **`/welcome/setup-failed` (:124)** AGAIN (separate mounts), `/auth/confirm` (:125), preview routes (:131–132, `PermissionGuard permission="storefronts.view"`), then `DashboardLayout` wildcard (:137–168) containing guarded routes: `/` `dashboard.view` (:142), `/stores` **`dashboard.view`** (:152), `/storefronts/*` `storefronts.view` (:155), etc.
- **R4 changes:** add `/onboarding` to the authenticated table; remove/retire the two `/welcome` + two `/welcome/setup-failed` rows; the wizard route should sit OUTSIDE `DashboardLayout` (full-page, like `/welcome` today) but INSIDE the authenticated branch. `SetupFailed` page mounts from `App.tsx:60` (`./pages/SetupFailed`) — retiring the route retires the lazy import too.
- A fresh owner holds the 33-key bundle incl. `dashboard.view` → `PermissionGuard` passes; the resume guard is orthogonal to permission checks.

**AuthConfirm navigation call sites — FOUR, not two (the audit names the two success sites; D-10's route retirement catches two more):**
- :91–93 — failure path: `navigate(\`/welcome/setup-failed?code=...&message=...\`)` (provision failure)
- :100 — success path: `localStorage.removeItem` ×2 then `navigate(\`/welcome?slug=${encodeURIComponent(provData.slug)}\`)` [VERIFIED: audit's ":100" matches exactly]
- :167–169 — reanchor failure path: `navigate(\`/welcome/setup-failed?message=...\`)`
- :174 — reanchor success path: `navigate(\`/welcome?slug=...\`)` [VERIFIED: audit's ":174" matches exactly]
- **Planner must retarget all four.** Suggested: success sites → `/onboarding?slug=...&business_id=...` (the RPC return contains `business_id` — :214 of the migration — pass it so the wizard doesn't re-fetch); failure sites → `/onboarding?error=...` state on the wizard, or keep a small `/onboarding/failed` surface. Note the reanchor form is a **cross-device recovery path** (no nonce in localStorage → business-name re-anchor + Turnstile, :115–179) — the wizard route must be reachable with only a session, no local nonce.
- AuthConfirm also invokes `signup-event` with `{event: "email_confirmed"}` (:58–60) and `signup-provision` with `{nonce}` (:78–80) — unchanged by Release 1.

**Welcome.tsx (174 lines — audit F2.3 confirmed, plus the cross-tenant hole):** loads `get_my_businesses` RPC (:42–47) then queries `storefronts` **unscoped** (:50–55: `.select("is_active, slug").order("created_at").limit(1).maybeSingle()` — no business filter). Post-RLS this returns the **first active storefront of ANY tenant** (storefronts SELECT policy: `is_active = true OR user_can_access_store(store_id)`, member_scoped_rls:95–98) — critique-1 #6 confirmed at code level. Publish via no-arg `publish_my_storefront()` (:75). Store URL hardcodes `.stores.dokanos.app` (:91). The whole page is replaced by the wizard; D-10 retires it.

**CreateBusinessDialog (115 lines):** invokes `create-business` edge fn (:46–51, body `{business_name, captchaToken}`); on success `refresh()` + `setActive(data.business_id)` (:67–68). **The false preview (:101–106):** `Storefront URL: https://{slug}.stores.dokanos.app` where `slug = generateStoreSlug(name || "new-store")` (:31) — client-side guess, false until a store exists. **D-11 treatment:** read-only reservation wording derived from typed name. **Copy (:84–86) is now false:** "Provision a complete new business entity with default showroom, warehouse, online storefront, and POS." — rewrite per R4. **Mounted at:** `AppSidebar.tsx:468` (import :12) and `BusinessAccountTab.tsx:202` + `:347` (import :22) — three mounts, one component; copy changes propagate automatically, but the D-04 zero-membership redirect will need its own surface (see Risks).

**useBusinessContext (181 lines) — what the guards read:**
- Memberships: `supabase.from("user_business_access").select("role, business_id, businesses(*)")` (:76–78) — RLS-scoped (users see own rows, 20260904000100:368–370)
- Active business: `businesses.find(b => b.id === activeId) || businesses[0] || null` (:152); persisted `localStorage["dokanos-active-business-id"]` (:61, :91–95)
- Brands of active business: `.eq("business_id", activeId)` ordered by name (:124–131) — one of only two `.eq("business_id")` in the frontend
- **Zero-membership state:** `businesses: []`, `active: null`, `brands: []`, `loading: false` after refresh — D-04's redirect triggers on `!loading && businesses.length === 0`. Realtime: a `postgres_changes` channel on `user_business_access` re-runs `refresh()` (:104–115) — after wizard/provisioning creates the UBA row, the context self-updates; guards should tolerate `loading === true` (render nothing, don't redirect yet).
- `myRole` (:155): `rolesByBusiness[active.id]` — the R4a client wrapper can assert owner/admin client-side before invoking (UX only; the RPC re-asserts authoritatively).

**Onboarding-done marker storage options (agent discretion per D-09 — research recommendation):**

| Option | Writability today | Cross-device | Verdict |
|--------|-------------------|--------------|---------|
| **`businesses.onboarding_completed_at timestamptz` (new column)** — RECOMMENDED | Owner/admin via existing `"Owners can update businesses"` UPDATE policy (`has_role(admin) OR can_manage_business_access(id, auth.uid())`) [VERIFIED: 20260911000120:24–29]; readable by every member via `"Members can read businesses"` SELECT (20260904000100:355–357, never dropped) | ✅ server-side | **Simplest.** One ALTER TABLE in the R4a/R1 migration; direct `supabase.from("businesses").update({onboarding_completed_at: new Date().toISOString()}).eq("id", active.id)` from the wizard finish; resume guard reads it from the already-loaded `active` object (add the field to the `Business` interface). NULL = onboarding incomplete. |
| `signup_events` row (`event='onboarded'`) | ❌ service-role-only writes AND zero client SELECT policies [VERIFIED: 20260925120000:55–58 "No client policies at all"; event CHECK constraint at :38–43 would need a migration to add a new value] | ✅ but unreadable by client | **Dead end** — the client can't read it back for the resume guard. |
| `app_settings` key/value | ❌ staff/admin-only; **global** (key PRIMARY KEY, no business_id) [VERIFIED: 20260429165344:2–6 + staff/admin policies] | ✅ but not per-business | **Wrong shape** — one row per business would require a schema change anyway. |
| New dedicated table + RPC | new policies + verify fn needed | ✅ | Over-engineering for one boolean-per-business (CLAUDE.md §2 Simplicity First). |

The column rides an existing migration in this release; types regeneration (below) picks it up.

### 5. R0 — window-business detection signature table

All signature values verified from the current provisioning INSERTs (20260925120100:99–143) and table definitions. The detector matches businesses whose **entire** row-set was produced by the old template.

| Signature element | Exact value / predicate | Source (verified) |
|---|---|---|
| Placeholder store URL | `stores.url = 'https://' || b.slug || '.stores.dokanos.app'` (domain from `app_config.storefront_domain`, seeded `"stores.dokanos.app"`) | core :104 + 20260925120000:116 |
| Store status | `stores.status = 'disconnected'` (CHECK enum: connected/disconnected/syncing/error) | core :104; 20260407071618:18 |
| Connector | exactly 1 connector: `category='channel' AND type='woocommerce' AND status='disconnected'` | core :135–137; connectors schema 20260904000100:158–176 |
| Selling points | per template business: type set ⊆ {`showroom_pos`(name `'Showroom POS'`, is_default), `woocommerce`(name `<bizname> WooCommerce`), `facebook`(name `'Facebook / Instagram'`, **only if `order_sources` contains `'fb/ig'`** — conditional, do NOT hard-require 4), `dokanos_storefront`(name `<bizname> Storefront`, has storefront_id + woo_store_id)} | core :121–133, :88–89 |
| Product source | exactly 1: `name='WooCommerce catalog' AND type='woocommerce' AND status='disconnected' AND sync_direction='two_way'` | core :139–140 |
| Customer source | exactly 1: `name='WooCommerce customers' AND type='woocommerce' AND status='disconnected' AND sync_direction='import'` | core :142–143 |
| Location | 1 default showroom: `name='Main' AND type='showroom' AND is_default=true` | core :111–113 |
| Storefront | 1 inactive storefront whose slug == business slug (same candidate), `is_active=false` (unless the owner published during the window — see note) | core :115–117 |
| UBA | exactly 1 row, role `'owner'` (window signups were single-owner) | core :156–157 |
| user_store_access | exactly 1 row (the auto-store) | core :199–200 |
| **Zero real data** | `orders` count = 0 AND `products` count = 0 AND `customers` count = 0 for the business's store(s), joined via `stores.id = brands.woo_store_id AND brands.business_id = b.id` (orders/products/customers all carry `store_id`) | 20260407071618:29–31/:55–57/:77–79; index confirmations member_scoped_rls:51–58 |
| Provisioned cohort (optional context column) | `signup_events.event='provisioned'` rows give user_id + timestamp (service-role table; if the script runs in Dashboard SQL Editor as postgres it can join) | 20260925120000:35–49 |

**Report columns per D-07:** `business id, name, slug, created_at, owner email (join auth.users via UBA), placeholder store url, connector statuses (string_agg), template-row counts (stores/locations/storefronts/selling_points/connectors/product_sources/customer_sources), real-data presence (orders/products/customers counts), storefront is_active`.

**Convention for the script itself [VERIFIED: .planning/verify-deployment.sql:1–4]:** header comment `-- Post-deploy backend verification — paste into Supabase Dashboard > SQL Editor` with numbered blocks, each block preceded by an expect-comment (`-- expect N rows`). Suggested location: `.planning/detect-window-businesses.sql`. Per D-06 the script contains **zero DELETE/UPDATE statements** — it SELECTs candidates with evidence; the operator writes the cleanup SQL by hand.

**Edge cases the detector must encode:** (a) the FB/IG selling point is conditional on `order_sources` — a template business may have 3, not 4, selling points; (b) an owner who **published** during the window has `storefronts.is_active=true` — still a template business (publishing only flips the flag, 20260925140000:111–119) but the operator may want a warning column rather than silent inclusion; (c) a business with any order/product/customer row is EXCLUDED even if all other signature elements match (D-05 "zero real data" guards against false positives); (d) window businesses created via `create_additional_business` have identical signatures — include them; (e) backfilled July businesses (Enveil/Vincent) have REAL pathao connectors and 2 brands — excluded automatically by the one-brand/one-connector/zero-data signature, never by date.

## Architecture Patterns

### System flow — signup → wizard → first sale (Release 1 target state)

```
/signup (Signup.tsx)
   │ signup-event edge fn: anchor row (nonce, business_name, consent versions)
   ▼
email confirm → /auth/confirm (AuthConfirm.tsx)
   │ signup-provision edge fn (kill switch → rate limit → service role)
   │     └─ provision_owner_business RPC  [R1: gates+anchor+consent UNCHANGED]
   │           └─ signup_create_business_core  [R1 REWRITE: business+UBA+33 keys ONLY]
   │                     → {slug, business_id}   (no store/brand/location/sf/sp/conn/sources/usa)
   ▼
/onboarding (NEW wizard, full-page)
   step 1: create_my_brand_store(p_business_id, p_name)  [R4a RPC, client JWT]
   │        └─ ONE tx: store + brand(woo_store_id) + user_store_access + inactive storefront(reserved slug)
   │        └─ slug retry across businesses/brands/storefronts slugs + storefront_domain check (moved from core)
   step 2: locations INSERT          (member policy: is_business_member)   [skippable, D-09]
   step 3: selling_points INSERT     (member policy: is_business_member)   [skippable, D-09]
   step 4 (optional): selling_points INSERT (dokanos_storefront, storefront_id=R4a sf, woo_store_id=store)
   │        └─ publish_my_storefront(sf_id)  [existing 4-assertion RPC, flip-only]
   finish: businesses.onboarding_completed_at = now()  (owner UPDATE policy) → Dashboard + toast
   ▼
Resume guard (route level, reads useBusinessContext):
   active business, zero brands, no done-marker → /onboarding   (login/refresh/switch-back/cross-device)
   zero memberships → create-business flow (D-04, CreateBusinessDialog pattern)
```

### Recommended Project Structure (additions only)

```
supabase/migrations/
  20261006xxxxxR1_blank_slate_provisioning.sql        # core rewrite + 33-key bundle + create_additional_business guard + verify_signup_fns update
  20261006xxxxxR4a_create_my_brand_store.sql          # new RPC + businesses.onboarding_completed_at + verify fn
.planning/
  detect-window-businesses.sql                        # R0 (D-08, next to verify-deployment.sql)
  rollbacks/20261006xxxxx*.md                         # rollback notes per convention
scripts/
  test_signup_rpc.sql                                 # REWRITE: new acceptance shape (33 keys, ZERO template rows)
src/
  pages/Onboarding.tsx                                # thin wizard shell (route, guard, step state)
  components/onboarding/Step1Store.tsx … Step4Storefront.tsx  # small steps (anti-god-component)
  components/onboarding/guards.ts (or hooks/useOnboardingState.ts)  # resume/redirect predicates — pure, testable
src/test/
  useStoresList.test.tsx                              # D-17 fail-closed
  onboardingGuards.test.ts(x)                         # D-17 wizard predicates
  createMyBrandStoreWrapper.test.ts(x)                # D-17 R4a wrapper idempotency
```

### Pattern 1 — SECURITY DEFINER RPC with caller-JWT assert (house idiom)
**What:** service-role-only provisioning RPCs (REVOKE from PUBLIC/anon/authenticated, GRANT to service_role) vs. member-callable flip/assert RPCs (REVOKE from anon, GRANT to authenticated, assert `auth.uid()` + UBA role inside).
**When to use:** `create_my_brand_store` = the second kind. Copy `publish_my_storefront` exactly: `SET search_path = ''`, `auth.uid()` null check, role assert raising `P0001`, `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;`.
[VERIFIED: 20260925140000:41–56, :96–101, :130–131]

### Pattern 2 — verify-migration (repo convention)
`verify_<migration>() RETURNS jsonb LANGUAGE plpgsql SET search_path = ''`, RAISE EXCEPTION per missing object/grant, `jsonb_build_object('status','ok',...)`, `REVOKE ... FROM PUBLIC, anon` + `GRANT ... TO service_role, authenticated`. Run post-push by the operator (same flow as verify-deployment.sql blocks). [VERIFIED: 20260925120100:466–515; 20260925140000:281–338]

### Pattern 3 — module-singleton supabase client → `vi.mock` the module
The client is `export const supabase = createClient<Database>(...)` at module scope reading `import.meta.env` [VERIFIED: src/integrations/supabase/client.ts:11–17]. In tests, **mock the module path**, never instantiate the real client (env vars absent under vitest would throw at import). The repo already has one vi.mock precedent [VERIFIED: src/test/invoiceHtml.test.ts:9 `vi.mock("@/lib/barcodeSvg", () => ({...}))`]. See Code Examples for the concrete recipe.

### Pattern 4 — route-level state guard (new, mirrors PermissionGuard mechanics)
`PermissionGuard` renders `null` while `loading` and a fallback when denied [VERIFIED: PermissionGuard.tsx:22–28]. The R4 resume guard / D-04 redirect follow the same contract but read `useBusinessContext` (`loading`, `businesses.length`, `brands.length`, marker) and render `<Navigate to="/onboarding" replace />` instead. Keep the predicate in a pure function (`decideRoute(ctx): "app" | "wizard" | "create-business" | "wait"`) so D-17 tests exercise it without React.

### Anti-Patterns to Avoid
- **Hand-rolling store creation client-side** — no member INSERT policy exists on `stores`; any client `insert()` will 403. All creation goes through the R4a RPC.
- **Reading membership truth from `usePermissions.storeIds`/`hasStoreAccess`** — fail-open + union across all businesses [VERIFIED: usePermissions.tsx:56–61].
- **God wizard component** — audit's anti-pattern + CLAUDE.md §2; keep steps as separate components with a thin shell.
- **Editing `src/integrations/supabase/client.ts` or `types.ts` by hand** — auto-generated; regenerate via Supabase CLI after schema changes [VERIFIED: client.ts:1, ARCHITECTURE.md:234].
- **Date-based cleanup** — D-05 forbids it; the signature is the only match predicate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| First store/brand/storefront creation | client-side multi-step inserts | `create_my_brand_store` SECURITY DEFINER RPC | no member INSERT policies on stores/user_store_access; atomicity across 4 tables; collision retry needs one transaction [VERIFIED: member_scoped_rls:68–83, 20260420112330:135–138] |
| Storefront publish | new INSERT/UPDATE path | existing `publish_my_storefront` (flip-only + 4 asserts) | chain satisfied by construction on the R4a-reserved row [VERIFIED: 20260925140000:74–119] |
| Signup gating | new gate columns | existing anchor/nonce/expiry/provider/domain apparatus | audit-locked "keep gates"; §10.3 tests re-run against them unchanged |
| Onboarding-done marker | new table + policies | `businesses` column + existing UPDATE policy | owner-writable today; one ALTER TABLE [VERIFIED: 20260911000120:24–29] |
| Slug generation (client preview) | new slugifier | `src/lib/slug.ts` `generateStoreSlug` | parity with RPC rules is load-bearing (see Pitfall 4) |
| Test doubles for supabase | dependency-inject the client everywhere | `vi.mock("@/integrations/supabase/client")` | zero production-code churn; precedent exists |

## Common Pitfalls

### Pitfall 1: R4a storefront insert with default `is_active = true`
**What goes wrong:** `storefronts.is_active` defaults to `true` [VERIFIED: 20260516201928:21]. A placeholder row inserted without an explicit `false` is instantly LIVE on the public storefront router (brand detection → StorefrontApp) with an empty catalog.
**Avoid:** copy core :115–117 verbatim — `INSERT INTO public.storefronts (name, store_id, slug, is_active) VALUES (v_name, v_store_id, v_slug, false)`.
**Warning sign:** freshly-onboarded store resolving publicly before step 4 publish.

### Pitfall 2: brands UNIQUE(business_id, name) vs idempotent re-invoke
`brands` has `UNIQUE (business_id, name)` [VERIFIED: 20260904000100:87]. If the idempotency pre-check ("business already has a store-linked brand → return it") is skipped or keyed only on slug, a second invoke with a **different** p_name raises 23505 instead of returning the existing store. The single-store cap must return-first-ask-never.

### Pitfall 3: the slug retry set shrinks too far
After R1, core creates only `businesses` rows; R4a creates store/brand/storefront. But a wizard store named "Bengal Artisans" in a business that itself is `bengal-artisans` (or in ANY business with that slug) collides with `businesses.slug` — the moved retry loop must keep checking **all three** unique columns (businesses.slug, brands.slug, storefronts.slug), not just the two R4a inserts into.

### Pitfall 4: client preview slugs diverge from RPC slugs
`slugify` truncates at **48** chars [VERIFIED: src/lib/slug.ts:11 `.slice(0, 48)`]; the RPC slug-base truncates at **60** [VERIFIED: core :79 `left(v_slug_base, 60)`]. A 50-char business name previews one slug and provisions another. D-11's "read-only live preview" should mirror the RPC's rules (or the preview should display the actual reserved slug returned by R4a at step-1 submit). Pre-existing cosmetic bug in CreateBusinessDialog:104 — fix by the same treatment per D-11, don't inherit it.

### Pitfall 5: guards redirect during `loading`
`useBusinessContext.loading` starts `true`; memberships fetch is async (:74–100). A naive zero-membership guard redirects authenticated users to the create-business flow on every hard refresh **before memberships load**. Guard contract: render nothing while `loading`, decide after. (Welcome.tsx makes the same class of mistake — unscoped storefront read — for the same reason: missing wait-for-context.)

### Pitfall 6: R1 breaks `scripts/test_signup_rpc.sql` silently
That script asserts brand/loc/store/storefront exist (:113–116), parity rows ≥ thresholds (:129–132), exactly 32 perms (:142), user_store_access = 1 (:155–158). After R1 all of those RAISE. It must be rewritten **in the same change** — it doubles as the R1 acceptance script (see Validation Architecture).

### Pitfall 7: retiring `/welcome` routes while AuthConfirm still navigates to them
Four navigation sites (see §4 above). Missing the two setup-failed sites (:91–93, :167–169) leaves dead routes → NotFound for exactly the users who most need a recovery path.

### Pitfall 8: `granted` overrides
`user_permissions.granted` is a boolean with `false = revoke override` [VERIFIED: 20260420112330:106]. R1's 33-key INSERT sets granted implicitly true (column list omits it) — correct; don't "helpfully" set it, and don't count rows where granted=false in acceptance asserts (`WHERE user_id = X` is fine — the RPC only ever inserts granted=true).

## Code Examples

### Kill switch (asserted unchanged — gate-regression)
```typescript
// Source: supabase/functions/signup-provision/index.ts:47-57 (verified current)
    // Runtime kill-switch check
    const open = await isSignupOpen(sb);
    if (!open) {
      return new Response(
        JSON.stringify({
          error: "SIGNUP_CLOSED",
          message: "Sign up is currently closed.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
```
`isSignupOpen` reads `app_config` key `'signup_open'` and returns false when missing — fail-closed [VERIFIED: _shared/signup-utils.ts]. Seed: `('signup_open', 'false'::jsonb)` [20260925120000:113]. `create-business` edge fn carries the same switch (:48–58).

### Verify-fn skeleton for the R4a migration (house idiom)
```sql
-- Pattern from 20260925140000:281-338 (verify_signup_publish_and_delete_rpcs)
CREATE OR REPLACE FUNCTION public.verify_create_my_brand_store()
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='create_my_brand_store') THEN
    RAISE EXCEPTION 'verify: create_my_brand_store missing';
  END IF;
  -- granted to authenticated, NOT to anon (mirror verify_signup_fns:486-494)
  IF EXISTS (SELECT 1 FROM information_schema.role_routine_grants
             WHERE specific_schema='public' AND routine_name='create_my_brand_store'
               AND grantee = 'anon') THEN
    RAISE EXCEPTION 'verify: create_my_brand_store must not be anon-executable';
  END IF;
  -- marker column exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='businesses'
                   AND column_name='onboarding_completed_at') THEN
    RAISE EXCEPTION 'verify: businesses.onboarding_completed_at missing';
  END IF;
  RETURN jsonb_build_object('status','ok','rpc',true,'marker_column',true);
END; $$;
REVOKE ALL ON FUNCTION public.verify_create_my_brand_store() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_create_my_brand_store() TO service_role, authenticated;
```

### D-17 seam-test recipe — mocking the module-singleton client
```typescript
// Source pattern: vi.mock precedent src/test/invoiceHtml.test.ts:9; config vitest.config.ts:7-15 (jsdom+globals+setup)
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted before any import of the client module — hooks import { supabase } from it.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({ select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      then: (cb: any) => cb({ data: [] }) })),   // awaitable terminal
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}));
import { useStoresList } from "@/hooks/useStoresList";
import { renderHook } from "@testing-library/react";
// For context-dependent hooks, wrap in the real provider OR mock "@/hooks/useBusinessContext".
```
Key facts: vitest `environment: "jsdom"`, `globals: true`, `setupFiles: ["./src/test/setup.ts"]`, include `src/**/*.{test,spec}.{ts,tsx}`, alias `@` → `./src` [VERIFIED: vitest.config.ts:1–16]. `renderHook` from RTL 16 works out of the box. For `useStoresList` the lighter alternative is `vi.mock("@/hooks/useBusinessContext")` returning `{ brands: [], active: { id: "b1" } }` — then assert the hook yields `[]` and that `supabase.from` was **never** called with an unscoped query (fail-closed = no query at all when brand-stores are empty). Wizard guard predicates: pure functions, no mocks needed. R4a wrapper idempotency: mock the client's `.rpc("create_my_brand_store", ...)` to resolve the same `{store_id}` twice; assert the wrapper returns the first result and does not double-invoke for the same business.

### Fail-closed useStoresList (target shape)
```typescript
// Current fail-open: useStoresList.ts:32-35 — no filter applied when activeStoreIds is empty.
// Target: business context present + zero brand-stores => [] without querying.
const activeStoreIds = brands.map((b) => b.woo_store_id).filter(Boolean) as string[];
if (activeId && activeStoreIds.length === 0) {   // fail CLOSED
  setStores([]);
  return;
}
let query = supabase.from("stores").select("id, name, status").order("name");
if (activeStoreIds.length > 0) query = query.in("id", activeStoreIds);
```

## Risks & Landmines (things the audit did NOT call out)

1. **`scripts/test_signup_rpc.sql` asserts the OLD shape and will fail after R1** (:113–116 resources created; :129–132 parity rows; :142 exactly 32 perms; :155–158 store access = 1; even its NOTICE at :174 says "all 11 tables populated"). It is not referenced by `npm test` (vitest) — it's a psql/DO-block script — so nothing in CI catches the breakage; it fails at operator-verification time. **Plan must rewrite it as the R1 acceptance script** (33 keys, ZERO template rows, gates unchanged, idempotency triple for create_additional_business). Note its jwt-claim simulation trick for member-JWT RPC testing (:184–185 `set_config('request.jwt.claim.sub', ...)`) — reusable for R4a deny-tests.

2. **AuthConfirm has four `/welcome`-family navigations** (success :100/:174, failure :91–93/:167–169) — D-10's retirement must retarget all four or the two error paths land on NotFound. The reanchor path (cross-device, no local nonce) is the highest-risk user journey to break.

3. **`create_business_with_owner` is a second, live business-creation path** — client-callable from `BusinessAccountTab.tsx:379` (Settings → Business Account, fresh-install branch), admin-only, creates business + owner UBA with NO template rows and NO permission bundle/consent/audit [VERIFIED: 20260911000130:52–57, :24–26]. It is *already blank-slate*, so it doesn't fight R1 — but (a) businesses made this way have zero brands → the R4 resume guard will push their owners into the wizard (desired), and (b) they lack the 33-key bundle, so a platform admin creating a business this way gets `dashboard.view` via admin bypass, while a non-admin invited owner would have NO permissions and see a PermissionGuard wall. **Recommend: leave the RPC untouched in Release 1 (out of scope), but assert in the plan that the wizard works for its businesses (it only needs the marker + brands state, not permissions).**

4. **`useBusinessContext` never refetches on `user` change and has no auth-listener** — it loads once + on UBA realtime events (:102–115). After fresh signup the UBA INSERT (server-side, service role) fires the realtime channel → refresh. Realtime on `user_business_access` was enabled by `20260911000110_realtime_user_business_access.sql` [14L migration exists] — so the wizard's step-1 completion updates the context automatically. Good. But RLS: the realtime payload only reaches the client if the SELECT policy admits the row — user sees own rows (20260904000100:368–370). Verified safe; do not remove the realtime subscription while reworking guards.

5. **No rate limit on `create_my_brand_store`.** The service_role entries (`signup-provision` 5/h/IP; `create-business` 3/day/user + 10/day/IP) have edge-fn rate limiting, but a client-JWT RPC has none. An owner can spam the RPC (each invoke = idempotent no-op after the first, so abuse is bounded, but the retry loop burns DB cycles). Acceptable for Release 1 (authenticated-only + idempotent); note for the secure-phase review — do NOT add a `rate_limit_hits` dependency inside the RPC without a plan decision.

6. **`signup_events.event` CHECK constraint** (:38–43) has a fixed 13-value allow-list. If the wizard wants to write an `'onboarded'` audit event it needs a migration to extend the CHECK — and the table is service-role-write-only, so the client can't write it anyway. Use `businesses.onboarding_completed_at` (recommended) instead; skip the audit event for Release 1.

7. **`user_store_access` RLS is `USING (true)` for SELECT** [VERIFIED: 20260420112330:132–133] — every authenticated user can read every other user's store-access rows. Not touched by Release 1 (R2c-adjacent); flag for Phase 2's read-hole sweep. Do not "fix" it incidentally in this phase (CLAUDE.md §3 Surgical Changes).

8. **stores table still has plaintext `consumer_key`/`consumer_secret` columns** [VERIFIED: 20260407071618:16–17] and CONCERNS.md HIGH item on stores/pathao_integrations read policies — the R4a-created store row will have NULL secrets (safe), but D-13/D-14 (Phase 2) is the real fix. No Release-1 action.

9. **Test facts drift:** phase facts said "3 test files, all pure-function" — the tree has **11** test files in `src/test/` (added across ffb6648 and earlier commits) and `vitest.config.ts` + `src/test/setup.ts` already configure jsdom + jest-dom. The D-17 estimate should assume **zero Wave-0 framework work**; only new test files.

10. **`npm run test:rls` requires Docker Desktop + local Supabase** (`supabase db reset && node scripts/run-rls-tests.mjs`, runner bails if `supabase status` can't resolve a local DB URL [VERIFIED: run-rls-tests.mjs:44–55]). The RLS battery at `supabase/tests/rls/` (6 SQL files + `_harness.md`) has fixture users OWNER_A/MEMBER_A/VIEWER_A/OWNER_B/OUTSIDER (:24–37) — a natural home for R4a member/viewer-deny tests if the operator prefers the harness over test_signup_rpc.sql. Docker availability on the operator machine is unverified (see Environment Availability).

## Deploy Mechanics — what "deploy Release 1" concretely involves

[VERIFIED chain: verify-deployment.sql:1–4 "paste into Supabase Dashboard > SQL Editor after `supabase db push` completes"; ARCHITECTURE.md:46 "Hosting: Vercel"; README:52 "Hosting | Vercel (web app), Supabase cloud (database and functions)"; workflows contain NO deploy pipelines — only cron schedulers]

1. **Schema first:** `supabase db push` (hosted project `jiwndicvfkiltgageqwv`, config.toml:1) applying the new R1 + R4a migrations at the end of the 139-file linear chain. Local pre-flight: `supabase db reset` (Docker) to prove the whole chain replays, then run the acceptance SQL.
2. **Post-push verification:** run each `verify_*` fn + the rewritten `scripts/test_signup_rpc.sql` (or Dashboard blocks) — the `.planning/verify-deployment.sql` flow.
3. **Edge functions: NO redeploy required for Release 1.** R1 rewrites RPC internals the edge fns call unchanged (`provision_owner_business`, `create_additional_business` signatures and error codes are preserved — `PROVISION_*` mapping at signup-provision/index.ts:87–114 and create-business/index.ts:115–133 still matches). R4a is a client-JWT RPC via supabase-js, not an edge fn. (A `functions deploy` is harmless but unnecessary; nothing in `supabase/functions/` changes.)
4. **Types:** regenerate `src/integrations/supabase/types.ts` via Supabase CLI after the push — the new RPC + `businesses.onboarding_completed_at` must appear in `Database["public"]["Functions"]` / businesses Row type before typecheck passes on wizard code [constraint: ARCHITECTURE.md:234, client.ts:1 "automatically generated"].
5. **Frontend:** standard Vercel deploy of the SPA (`vite build`; no CI gate exists — CONCERNS.md:193–196). `npm run typecheck` + `npm test` locally before shipping is the only quality gate available.
6. **Order within the atomic release (planner's discretion per CONTEXT.md, recommended):** migrations → verify fns → types regen → frontend → operator re-checks kill switch state (`signup_open` stays `false` through both releases per D-18 — no migration touches `app_config`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + npm/bun | vitest, build | ✓ (repo runs vite/vitest today) | — | — |
| vitest + jsdom + RTL + jest-dom | D-17 seam tests | ✓ [VERIFIED: package.json:81–82,92,100; vitest.config.ts] | vitest ^3.2.4 / jsdom ^20 / RTL ^16 | — |
| Supabase CLI | `db push`, `db reset`, types regen | [ASSUMED] present on operator machine (used historically: verify-deployment.sql documents `db push`; `test:rls` script exists) | — | Dashboard SQL Editor paste (migration files' SQL applied block-by-block — the verify-deployment.sql flow implies this is already a practiced fallback) |
| Docker Desktop | `supabase db reset` + RLS battery | [ASSUMED] unverified this session | — | Rewrite acceptance as paste-into-Dashboard SQL (test_signup_rpc.sql + verify fns already work that way); R0 needs only the Dashboard |
| Hosted Supabase project `jiwndicvfkiltgageqwv` | deploy target | ✓ (config.toml:1) | — | — |
| Vercel | frontend deploy | ✓ (ARCHITECTURE.md:46, README:52) | — | — |

**Missing dependencies with no fallback:** none — every gap has a Dashboard-paste fallback consistent with the project's existing verification convention.

## Validation Architecture

> Nyquist validation enabled (no `.planning/config.json` exists — key absent ⇒ enabled; confirmed by `gsd init.phase-op`: no config output).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.2.4, environment jsdom, globals true [VERIFIED: vitest.config.ts] |
| Config file | `vitest.config.ts` (separate from vite.config.ts; includes `src/**/*.{test,spec}.{ts,tsx}`) |
| Setup | `src/test/setup.ts` (jest-dom + matchMedia mock) |
| Quick run command | `npx vitest run src/test/<file>.test.tsx` (or `npm test` for all 11 files — pure-function suite, seconds-fast) |
| Full suite command | `npm test` |
| SQL acceptance | `scripts/test_signup_rpc.sql` (psql/DO-block; rewritten in this phase) + `npm run test:rls` (Docker-gated) |
| Typecheck gate | `npm run typecheck` (tsc --noEmit) — required after types regen |

### Requirements → Test Map (cheapest test per most-likely failure mode)

| Req | Behavior / acceptance criterion (audit + D-05…D-18) | Sample | Cheapest catching test | Type | File exists? |
|-----|------------------------------------------------------|--------|------------------------|------|-------------|
| **R1-a** | Provisioned business = exactly 1 `businesses` row + 1 UBA('owner') + **33** `user_permissions` rows | One provision through `provision_owner_business` (fixture anchor) | SQL acceptance script — the rewritten `scripts/test_signup_rpc.sql` counts rows per user/business | SQL (operator, Dashboard or psql) | ❌ rewrite of existing file (Wave 0) |
| **R1-b** | ZERO rows in stores/brands/locations/storefronts/selling_points/connectors/product_sources/customer_sources/user_store_access for a fresh provision | Same fixture as R1-a | Same script — count(*) = 0 asserts per table (replaces today's :113–132 asserts) | SQL | ❌ same rewrite |
| **R1-c** | All gates re-run green unchanged (anchor/nonce/expiry/provider/domain/idempotency) | Same script's gate section — today's sections 1/4 (anchor insert :39–59, idempotent re-invoke :176–181) carry over nearly verbatim | SQL | SQL | ✅ carry-over (edit in place) |
| **R1-d** | `create_additional_business` idempotency: same name ≤24h → same business_id; different name → new; user-B-vs-A → suffixed slug, never A's | Three scripted invokes with two fixture users | SQL acceptance (add section 6b to test_signup_rpc.sql) | SQL | ❌ new section |
| **R4a-a** | owner/admin of A cannot create in B; member/viewer cannot invoke at all | Member-JWT simulation (`set_config('request.jwt.claims', …)` — pattern already in test_signup_rpc.sql:184–185) or RLS battery fixture users MEMBER_A/VIEWER_A | SQL deny-asserts (expect P0001 FORBIDDEN) | SQL | ✅ pattern exists (harness `supabase/tests/rls/` if preferred) |
| **R4a-b** | Second invoke returns the SAME store (single-store cap, declared) | Two sequential invokes on one business | SQL + client wrapper vitest (wrapper doesn't re-invoke when business already has store) | SQL + unit | ❌ new vitest file |
| **R4a-c** | RPC creates store+brand(woo_store_id)+user_store_access+inactive storefront(reserved slug) in one transaction; storefront is_active=false | Inspect rows after one invoke | SQL acceptance (assert is_active false, slugs equal, brand link) + verify fn asserts existence | SQL | ❌ new section |
| **R4-d1** | `storefronts.view` in bundle → fresh owner opens /storefronts | Bundle count 33 (R1-a covers) + manual UAT: fresh signup reaches storefronts page | SQL count + UAT | SQL + UAT | — |
| **R4-d2** | Wizard resume: abandonment (store, no done marker) → resumes at step 3; explicit finish never re-trapped (D-09 semantics) | Pure predicate `decideRoute({brands, marker, memberships})` across 5 state cases | vitest unit test on the extracted pure function — no rendering needed | unit | ❌ Wave 0 |
| **R4-d3** | Zero-membership redirect (D-04) fires for membership-less authenticated accounts, never during loading | Same predicate function, loading=true case | vitest unit | unit | ❌ Wave 0 |
| **R4-d4** | Publish works post-wizard on the R4a-reserved storefront (4-assertion chain satisfied by construction) | test_signup_rpc.sql section 5 (existing publish test) re-pointed at the R4a-created storefront id | SQL | SQL | ✅ exists, edit target id source |
| **R3-a** | `useStoresList` fail-closed: active business with zero brand-stores → `[]`, never all stores | Hook render with mocked context `{brands: [], active: {id}}` | vitest + RTL renderHook + `vi.mock` of client module (assert `from("stores")` never called) | unit/component | ❌ Wave 0 |
| **R3-b** | No NULL-brand leakage; badges only for real connections; empty states = Connect CTAs | Manual UAT on a blank business vs a backfilled one + grep asserts no `brand_id.is.null` remains | UAT + code review grep | UAT | — |
| **R0-a** | Detector matches ONLY template businesses; evidence columns per D-07 | Run against live DB: window businesses reported, backfilled (Enveil/Vincent) NOT reported, zero-data predicate excludes anything with orders/products/customers | The script IS the test — operator eyeballs evidence columns; cross-check: `select count(*) from businesses` vs report size | SQL (operator) | ❌ Wave 0 (the deliverable itself) |
| **R0-b** | Report-only: zero destructive statements | Code review: file contains no DELETE/UPDATE/ALTER | grep gate in review | review | — |
| **Gate-regression** | Kill switch 403s when `signup_open=false`; purge/retention fns unchanged; `delete_unprovisioned_self` invariants hold under blank-slate (provisioned owner HAS UBA ⇒ correctly denied) | SQL: flip check via existing verify fn; deny asserts on delete_unprovisioned_self with a provisioned fixture | SQL acceptance additions (sections already partially exist — delete test at test_signup_rpc.sql :210+) | SQL | ✅ extend existing |

### Sampling Rate
- **Per task commit:** `npm test` (vitest suite incl. new seam tests) + `npm run typecheck` — seconds.
- **Per wave merge:** `npm test` + local `supabase db reset` + acceptance SQL dry-run (if Docker available).
- **Phase gate (pre `/gsd-verify-work`):** full SQL acceptance run by operator against hosted project post-`db push` (R1-a…d, R4a-a…c, gate-regression), R0 script executed and reviewed (D-08: before R1 acceptance), wizard UAT walk (signup → confirm → wizard → dashboard → resume → publish), StoresHub UAT on blank + backfilled businesses.

### Wave 0 Gaps
- [ ] `scripts/test_signup_rpc.sql` — REWRITE (old-shape asserts fail post-R1; becomes the R1/R4a acceptance script)
- [ ] `.planning/detect-window-businesses.sql` — the R0 deliverable itself
- [ ] `src/test/useStoresList.test.tsx` — R3-a fail-closed seam test
- [ ] `src/test/onboardingGuards.test.ts` — R4-d2/d3 predicate tests
- [ ] `src/test/createMyBrandStoreWrapper.test.ts` — R4a-b wrapper idempotency
- [ ] Framework install: **none needed** — jsdom/RTL/jest-dom configured and installed [VERIFIED]
- [ ] Types regeneration step must precede wizard implementation (wrapper needs typed `create_my_brand_store` in `Database["public"]["Functions"]`)

*(Everything else — vitest config, setup file, mock precedent — exists.)*

## Security Domain

> `security_enforcement` absent ⇒ enabled. Release 1 adds/rewrites SECURITY DEFINER surface — the categories below are the ones that apply.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | Supabase Auth email/password + email confirmation gate in `provision_owner_business` (:255–257) — unchanged; no new auth surface in Release 1 |
| V3 Session Management | no | No session changes; edge fns verify JWT at gateway (`verify_jwt = true`, config.toml:46–50) |
| V4 Access Control | **yes — the core of R4a** | SECURITY DEFINER + caller-JWT assert (`UBA role IN ('owner','admin')`, house idiom publish_my_storefront:96–101); GRANT to authenticated only; REVOKE anon; verify fn asserts the anon grant is absent |
| V5 Input Validation | yes | `p_name` normalized+length-checked inside the RPC (mirror core :66–70); `p_business_id` typed uuid; client preview strings never trusted server-side (slug derived server-side only, F18 comment at 20260911000130:34–39 states the principle) |
| V6 Cryptography | no | No new secrets; R4a store row has NULL consumer secrets |
| V12 File/Resource | no | No file handling |

### Known Threat Patterns for this change

| Pattern | STRIDE | Standard Mitigation (in place / required) |
|---------|--------|-------------------------------------------|
| Privilege escalation via new RPC | Elevation | UBA role assert + `SET search_path = ''` + REVOKE anon + verify-fn grant check; idempotent-first-invoke prevents row spam |
| SQL injection via `p_name` in `.or()` style filters | Tampering | N/A — RPC uses parameters only; StoresHub's `.or(\`brand_id.eq.${brand.id}\`)` interpolation (:137–139) uses a server-issued uuid — safe today, but prefer `.eq` when rewriting |
| Cross-tenant storefront publish | Elevation | publish_my_storefront's 4-assertion chain unchanged (20260925140000:74–109) + `idx_brands_woo_store_id_unique` (:12–14) |
| Provisioning bypass of gates | Spoofing/Repudiation | All gates stay in the service-role RPC path; client never writes tenant tables (REVOKE at :218); consent + audit rows still written server-side |
| Onboarding marker forgery | Tampering | Marker writable only via `Owners can update businesses` policy (`can_manage_business_access`) — members/viewers cannot set it; worst case a co-owner marks done early (benign UX state, not a security boundary) |
| Detection script data exposure | Disclosure | R0 reads PII (owner email) — script lives in `.planning/`, run by the operator in their own Dashboard session (D-06 manual, no distribution) |

## Release-2 Compatibility Constraints (Release 1 must not block R2a–R2d)

1. **`user_can_access_store` short-circuit stays** (D-03; member_scoped_rls:21–22 admin/staff global) — R4a's RPC must NOT embed admin special-cases; the UBA role assert is the only authorization.
2. **The R3 fail-closed scoping in `useStoresList` is the seed of R2a's `useBusinessStores()`** — keep the brand→`woo_store_id` mapping in one extractable place (a helper or the hook itself) so R2a generalizes rather than rewrites it.
3. **Do not touch read-side `USING(true)` policies** (orders/products/customers SELECT, user_store_access SELECT, user_permissions SELECT) — they are R2c's controlled demolition, and dropping them piecemeal now would desync Release 2's acceptance scripts.
4. **Wizard step 3's selling-point INSERTs must keep writing plain member-policy rows** (business_id + brand_id + type + links) — R2d's pos_shifts policy depends on `selling_point_id → selling_points.business_id` existing; the dokanos_storefront step-4 row carries `storefront_id + woo_store_id` which R2a's brand→store resolution expects.
5. **Do not add `user_roles` writes anywhere** — gate-regression asserts zero user_roles rows from self-serve; team-manage's UBA migration (deferred) must stay possible without cleanup.
6. **`get_my_businesses` RPC (20260925120000:125–145) stays the switcher source** — the wizard and guards should read memberships via `useBusinessContext` (which uses the UBA table directly under RLS), not invent a third membership API.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Supabase CLI + Docker Desktop available on the operator machine (historical use implies presence; not probed this session) | Deploy Mechanics, Environment Availability | `db push`/`db reset` blocked → fallback: Dashboard SQL Editor paste per the verify-deployment convention; acceptance scripts already written for that medium |
| A2 | Hosted project schema == migration chain head (no out-of-band schema drift) | Deploy Mechanics | R1 acceptance could fail on drift → `supabase db reset` locally + compare, or run verify fns before push |
| A3 | Turnstile stays available on the reanchor path (AuthConfirm:254) and CreateBusinessDialog — wizard step 1 (R4a RPC) needs NO captcha (authenticated-only + idempotent) | R4 integration | If captcha is wanted on step 1, it would have to go through an edge fn (RPCs can't verify Turnstile) — scope creep; flagged as Open Question |
| A4 | `app_permission` enum contains exactly the 36 values the old test cites + `storefronts.view` (added by 8f20cba) ⇒ 33-key bundle needs no enum migration | R1 verification | If `storefronts.view` were absent from the enum, an extra ALTER TYPE migration is needed — one-line check for the planner (`select enumlabel from pg_enum where enumtypid = 'app_permission'::regtype`) |
| A5 | `order_sources` still contains a `'fb/ig'` row in hosted data (core guards it with EXISTS, :88–89) — affects only whether window businesses have 3 or 4 selling points | R0 signature | Detector already encodes the conditionality; no risk |
| A6 | July-backfilled businesses have real data (orders/products) — assumed yes; R0's zero-real-data predicate excludes them regardless | R0 signature | If a backfilled business had zero real data AND template shape, it would be reported — evidence columns let the operator decide (report-only per D-06) |

## Open Questions

1. **Where do the two AuthConfirm failure paths land after `/welcome/setup-failed` retires?**
   - What we know: D-10 retires both `/welcome` routes; audit names only the two success retargets.
   - What's unclear: whether failures should render inside `/onboarding` (query-param error state) or keep a dedicated failure surface.
   - Recommendation: `/onboarding?error=<code>` with the wizard's step-0 error panel — one fewer route, and the recovery actions (re-anchor form / contact) can be reused from AuthConfirm's reanchor branch.
2. **Does the wizard's step-1 name field reuse the anchor's business name (pre-filled) or ask fresh?**
   - What we know: anchor meta carries `business_name` (signup_events), and the business name is what R4a's store/brand name derives from by default.
   - Recommendation: pre-fill with the active business's name; store/brand name is editable but defaults to it (one less decision for the merchant; slug preview follows).
3. **R4a rate limiting** — none planned (see Risks #5); confirm with the operator that idempotency-only is acceptable for Release 1.
4. **Types regen execution** — no scripted command exists in the repo; the plan should include the exact CLI invocation as a task (operator or agent with CLI access runs `supabase gen types typescript --linked > src/integrations/supabase/types.ts` or equivalent) rather than assuming it happens.

## Sources

### Primary (HIGH confidence — every in-repo claim read directly this session)
- `supabase/migrations/20260925120100_signup_provision_fns.sql` (full read) — core/entry fns, bundle, verify idiom
- `supabase/migrations/20260925140000_signup_publish_and_delete_rpcs.sql` (full read) — publish/delete/purge/retention + verify
- `supabase/migrations/20260925120000_signup_support_tables.sql` (full read) — gate tables, app_config seeds, event CHECK
- `supabase/migrations/20260904000100_multi_business_foundation.sql` (:1–240, :330–459) — table defs, member policies, is_business_member
- `supabase/migrations/20260929120000_member_scoped_rls.sql` (:1–160) — user_can_access_store, stores/storefronts policies
- `supabase/migrations/20260911000120_rls_tighten_businesses.sql`, `20260911000130_create_business_with_owner.sql`, `20260516201928_*` (storefronts), `20260407071618_*` (stores/products/orders), `20260420112330_*` (user_permissions/user_store_access), `20260429165344_*` (app_settings), `20260904000200_verify_foundation.sql`
- `supabase/functions/signup-provision/index.ts`, `supabase/functions/create-business/index.ts`, `_shared/signup-utils.ts` (kill switch)
- `src/App.tsx`, `src/pages/AuthConfirm.tsx`, `src/pages/Welcome.tsx`, `src/pages/StoresHub.tsx` (full), `src/components/CreateBusinessDialog.tsx`, `src/components/settings/BusinessAccountTab.tsx` (:170–409), `src/hooks/useBusinessContext.tsx`, `src/hooks/useStoresList.ts`, `src/hooks/usePermissions.tsx`, `src/components/PermissionGuard.tsx`, `src/lib/slug.ts`, `src/integrations/supabase/client.ts`
- `vitest.config.ts`, `src/test/setup.ts`, `src/test/signup.test.ts`, `src/test/invoiceHtml.test.ts:9` (vi.mock precedent)
- `package.json`, `supabase/config.toml`, `scripts/run-rls-tests.mjs`, `scripts/test_signup_rpc.sql`, `.planning/verify-deployment.sql`, `supabase/tests/rls/` listing, `.planning/rollbacks/` listing
- `SIGNUP-BUSINESS-AUDIT.md` + both critiques (full reads), `01-CONTEXT.md` (full), `.planning/codebase/CONCERNS.md` + `ARCHITECTURE.md` (full), `CLAUDE.md` (via PowerShell)
- `git log`/`git diff --name-only ffb6648..HEAD` — drift baseline

### Secondary / Tertiary
- None used — no web research was required; every claim is in-repo.

## Metadata

**Confidence breakdown:**
- R1/R4a backend current-state: **HIGH** — the operative migration was read line-by-line; every audit line citation re-verified at HEAD
- Frontend integration points: **HIGH** — all five surfaces read in full; four-not-two AuthConfirm finding is code-level
- Test mechanics (D-17): **HIGH** — config, deps, and precedent verified; recipes grounded in the existing vi.mock usage
- Deploy mechanics: **HIGH** for the documented `db push` + Dashboard + Vercel chain; **MEDIUM** for operator-tooling availability (Docker/CLI — Assumption A1)
- R0 signature: **HIGH** — all literals taken from the provisioning INSERTs themselves, not inferred

**Research date:** 2026-10-06
**Valid until:** 2026-11-06 (stable, in-repo evidence; invalid earlier if any commit touches `supabase/migrations/20260925120100*`, `20260925140000*`, or the five frontend integration files)
</content>
