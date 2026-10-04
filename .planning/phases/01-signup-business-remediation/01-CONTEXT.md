# Phase 1: Sign-Up & Business Remediation - Context

**Gathered:** 2026-10-05
**Status:** Ready for planning

> **Source of truth:** `SIGNUP-BUSINESS-AUDIT.md` §4 remediation plan **v3** (post-critique rounds 1–2) is LOCKED work-item scope: R1, R3, R4a, R4, R2a, R2b, R2c, R2d with per-item acceptance criteria and the gate-regression checklist. This document records the discussion decisions that extend/modulate that plan. Where the audit and this document agree, cite both; where this document adds, it wins. Downstream agents MUST read the audit before planning.

<domain>
## Phase Boundary

Remediate the sign-up & business account system exactly per `SIGNUP-BUSINESS-AUDIT.md` §4 v3: blank-slate provisioning (R1), connection-truth UI (R3), member store-creation RPC (R4a), onboarding wizard (R4), business-scoped data access across all 10 surfaces (R2a/R2b), read-side RLS completion (R2c, extended here by D-13/D-14), member POS writes (R2d), plus a new report-only window-business detection script (R0, D-05–D-08). Shipped as TWO phases matching the audit's two atomic releases; public signup launch (`signup_open`) stays gated on Release 2 completion and is flipped manually by the operator.

</domain>

<decisions>
## Implementation Decisions

### Admin UI scoping (audit's embedded product decision — now CONFIRMED)
- **D-01:** Business switcher is **per-business only**. No "All businesses" pseudo-entity, no unfiltered branch anywhere in the UI. All 10 surfaces always render exactly one active business (via `useBusinessStores()`). — **Reversibility:** costly — undo would re-edit query shapes across all 10 surfaces.
- **D-02:** Global lens is the **SQL editor only** (Supabase Studio / psql). No admin SQL views, no in-app global oversight in this remediation.
- **D-03:** Platform **admin and staff are treated identically**: UI business-scoped for both; SQL/RLS keeps both global (member_scoped_rls `has_role` short-circuit, lines 21–22, stays). Zero special cases in `useBusinessStores`.
- **D-04:** Zero-membership sessions get a **hard redirect into the create-business flow** — same guard mechanism as the R4 resume guard, triggered by "no business memberships" instead of "no stores". Applies to any authenticated account (platform accounts, legacy accounts).
  - **Reversibility:** reversible.

### Broken-window cleanup (new deliverable — R0)
- **D-05:** Cleanup is **detection-based, never date-based**. The detector matches the fake-template signature (placeholder store URL, all connectors `'disconnected'`, zero real data) and only matching businesses are ever reported. No wholesale "created after ffb6648" logic.
- **D-06:** **Report-only, manual.** The script prints match candidates with evidence columns; the user personally reviews and runs any destructive SQL. NO destructive code ships with the remediation. — **Reversibility:** reversible.
- **D-07:** Report scope = **evidence per match** only: created_at, owner email, placeholder store URL, connector statuses, template-table row counts, real-data presence. No integrity checks, no bundle audits.
- **D-08:** The script lives in `.planning/` (next to `verify-deployment.sql`, matching convention) and is run by the user **during Release 1 development, before R1 acceptance verification** — so window artifacts don't pollute wizard/StoresHub testing and manual cleanup can happen first.

### Wizard UX shape (extends R4)
- **D-09:** Wizard steps 2 (locations/warehouse) and 3 (selling points) are **skippable via "skip for now"**; an explicit finish sets an **onboarding-done marker** (server-side, cross-device — storage mechanism is planner's choice). The audit's resume-at-step-3 guard then fires ONLY on abandonment (store exists, no done marker); explicit finishers are never re-trapped. Rationale: step 3's options (POS/Woo/Facebook) are wrong for a storefront-only merchant. This refines the audit's acceptance criterion "wizard resume at step 3 for store-without-selling-points state" to mean abandonment-only.
- **D-10:** Wizard lives at a **new `/onboarding` route as a full-page multi-step component**. `/welcome` and `/welcome/setup-failed` are retired; AuthConfirm's two call sites (:100, :174) retarget to `/onboarding`.
- **D-11:** The reserved storefront URL is shown as a **read-only live preview at step 1**, derived from the store name as typed ("reserved for you" wording — reservation, not publication). Fixes CreateBusinessDialog's false preview (:104) by the same treatment. No editable slug field.
- **D-12:** **Finish → Dashboard** with a success toast (StoresHub CTAs / R3 empty states remain the path for skipped items). The **zero-membership hard redirect (D-04) lands on a create-business flow** (CreateBusinessDialog pattern, R4-rewritten copy) — NOT the wizard; there is no business yet to onboard.

### Adjacent read holes (extends R2c)
- **D-13:** **Fold both holes into R2c** (+≈0.5d): drop `pathao_integrations`' `USING(true)` authenticated read and add member-scoped read (store_id → `user_can_access_store`); fix `courier_shipments` (revoke the authenticated SELECT grant or add the same RLS pattern). Same migration, same acceptance test shape (member-JWT read of another tenant's rows returns zero). Without this, every NEW tenant's courier credentials stay readable by every authenticated user after signups open — worse than the holes R2c already closes.
  - **Reversibility:** costly — policy DROPs revert only via new migrations; shipping R2c without them re-opens credentials to all tenants.
- **D-14:** **Policy-scoping only** on the plaintext secret columns. No column-level REVOKE, no vault changes, no edge-function changes in this remediation (deferred).

### Plan split
- **D-15:** **Two phases**: Phase 1 = Release 1 (R0 + R1+R3+R4a+R4, ≈4.5d, atomic per audit); Phase 2 = Release 2 (R2a→R2d including D-13/D-14 extensions, ≈6d incl. +0.5d R2c extension and +1d seam tests). Each gets its own plans, verification, and ship gate.
- **D-16:** **Phase 2 is planned only after Release 1 ships and verifies.** This CONTEXT.md covers both phases so nothing is lost; Phase 2 planning re-reads it plus Release 1's SUMMARY.

### Verification depth (extends both releases)
- **D-17:** **SQL + seam tests.** The audit's SQL/member-JWT acceptance scripts (run by the user per release) PLUS a small vitest layer on the new frontend seams only: `useBusinessStores` fail-closed behaviors (empty business → empty list, never all stores), wizard guards (zero-membership redirect, resume-at-step-3, done-flag semantics), R4a wrapper idempotency. Rides the existing vitest+jsdom setup. ≈ +1d across both phases. Protects the exact failure mode that started this audit (silent fail-open scoping).

### Open default (declined discussion — conservative default recorded)
- **D-18:** `signup_open` stays `false` through both releases and is flipped **manually by the operator via SQL/settings after Release 2 verifies**. No migration auto-opens signup; the kill switch (signup-provision/index.ts:48–57) stays operator-controlled.

### The agent's Discretion
- Wizard visual/component structure inside the `/onboarding` page (follow existing shadcn/ui + page patterns; the audit's god-component anti-pattern applies — keep steps as small components).
- Storage mechanism for the onboarding-done marker (D-09) — any server-side mechanism that survives cross-device login.
- Detection script's exact SQL (D-05–D-08) — signature must implement the locked semantics.
- R2b picker-sweep mechanics within the audit's locked 18-file checklist.
- Deployment ordering within each atomic release (migrations → edge fns → frontend).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Operative plan (locked scope)
- `SIGNUP-BUSINESS-AUDIT.md` — THE plan v3: §4 work items R1/R3/R4a/R4/R2a–d with sizes/deps, per-item acceptance criteria, gate-regression checklist, release shape. Every file:line claim in it is verified evidence.
- `SIGNUP-BUSINESS-AUDIT-CRITIQUE-1.md` — 12 dispositions that produced v2/v3 (origin of R4a, atomic release, picker sweep, fail-closed useStoresList).
- `SIGNUP-BUSINESS-AUDIT-CRITIQUE-2.md` — 6 dispositions (origin of R2d, slug-reservation placeholder, declared single-store cap, `signup_open` gating).

### Codebase intel
- `.planning/codebase/CONCERNS.md` — security concerns; §Security items on `pathao_integrations` (plaintext secrets, `USING(true)` read) and §Known Bugs on `courier_shipments` grant leak are now IN SCOPE via D-13. The remaining CONCERNS items stay out of scope.
- `.planning/codebase/ARCHITECTURE.md` — provider tree, routing, RLS-as-boundary idiom, migration-chain fragility notes (fresh `supabase db reset` after schema changes).

### Convention anchors
- `.planning/verify-deployment.sql` — the placement/pattern the R0 detection script follows (D-08).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useBusinessContext` (src/hooks) — active-business state, localStorage persistence; R2a's `useBusinessStores()` builds on it (active business → brands → woo_store_id set), and it is the ONLY scoping source (`usePermissions.storeIds` is fail-open and forbidden for scoping, audit R2a).
- `member_scoped_rls.sql` pattern (`user_can_access_store`) — R2c/R2d policies and D-13's pathao_integrations scoping mirror this idiom.
- `CreateBusinessDialog` — retargeted per D-04/D-12 with rewritten copy (its storefront-URL preview :104 becomes reservation wording per D-11).
- `publish_my_storefront` (20260925140000:61–109) — 4-assertion chain satisfied by construction via the R4a-reserved placeholder storefront; wizard step 4 calls it, no new INSERT.
- Member INSERT policies via `is_business_member` (20260904000100:338–348) — wizard steps 2–3 ride these unchanged.
- Signup edge functions (`signup-provision`, `signup-event`, `auth-resend`, `create-business`, `purge-unconfirmed`) — R1 rewrites `signup_create_business_core` internals; all §10.3 gates, consent, audit, kill switch, purge fns stay green (gate-regression checklist).
- vitest + jsdom setup (`src/test/`) — D-17's seam tests ride it.
- `StorefrontsPage` + `StoresHub` — the only existing `.eq("business_id")` implementations; reference for R2a/b and the R3 truth-badges work (StoresHub drops `brand_id.is.null` leakage :137–139).

### Established Patterns
- RLS is the real security boundary; frontend filters are the admin-visible isolation layer (audit F1.3).
- Fail-closed data scoping (R3 `useStoresList`, R2a `useBusinessStores`): empty set → empty list + wizard CTA, never "all stores".
- Route-level guards for state-based routing (R4 resume guard; D-04 zero-membership redirect reuses the mechanism).
- DROP old authenticated policies, don't "replace" (R2c instruction); RETAIN anon policies for public storefront reads.
- SQL/member-JWT acceptance scripts as verification currency (audit acceptance criteria; `.planning/verify-deployment.sql` convention).

### Integration Points
- `AppSidebar` + `useBusinessContext` — switcher unchanged in behavior (D-01), benefits from R2a/b making it real.
- `AuthConfirm` (src/pages/auth) — both call sites (:100, :174) retarget to `/onboarding` (D-10).
- `App.tsx` routing — new `/onboarding` route; `/welcome` routes retired (D-10).
- `StoresHub.tsx` — R3 truth-badges + empty-state Connect CTAs; `useStoresList` fails closed.
- R2b's locked 18-file picker/write-target checklist (audit §4 R2b) — every store picker lists only active-business stores.

</code_context>

<specifics>
## Specific Ideas

- Storefront URL preview wording at wizard step 1: reservation semantics ("…dokanos.storefront — reserved for you"), never publication (D-11).
- Wizard finish lands on Dashboard with a success toast; no recap page (D-12).
- Step 3 skip rationale to honor in empty-state copy: its options (POS/Woo/Facebook) don't fit a storefront-only merchant — Connect CTAs in StoresHub/R3 are the later path (D-09).
- The audit's §4 "Explicit product decision embedded (confirm)" — platform-admin login sees business-scoped UI after R2, global views via SQL/service role — is CONFIRMED (D-01, D-02, D-03).

</specifics>

<deferred>
## Deferred Ideas

- **Platform admin console** — in-app global oversight views for platform staff (global reads via a dedicated console, not the tenant UI). Future phase.
- **New-signup notifications** — signaling new tenant signups to the platform admin. Future phase.
- **Additional self-serve stores** — beyond the declared one-store/one-brand cap (audit R4a); future flow via the same `create_my_brand_store` RPC.
- **Column-level secret hiding / vault migration** — moving courier + Woo credentials to Supabase Vault with edge-fn-only getters (D-14 defers; CONCERNS.md endgame). Future security pass.
- **UBA-based team invitations + business-scoped `team-manage`** — team-manage currently uses global `user_roles` (CONCERNS MEDIUM); multi-tenant invitation flows need the UBA model. Future phase.

</deferred>

---

*Phase: 1-Sign-Up & Business Remediation*
*Context gathered: 2026-10-05*
