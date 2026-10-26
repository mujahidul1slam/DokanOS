# Phase 1: Sign-Up & Business Remediation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-05
**Phase:** 1-Sign-Up & Business Remediation (source: SIGNUP-BUSINESS-AUDIT.md §4 v3)
**Areas discussed:** Admin UI scoping, Broken-window cleanup, Wizard UX shape, Adjacent read holes, Plan split, Verification depth

---

## Initial gray-area selection

Presented 5 areas (Admin UI scoping, Broken-window cleanup, Wizard UX shape, Adjacent read holes, Plan split) — everything else pre-locked by the audit + critique rounds 1–2. User selected: **Admin UI scoping**. Two later "explore more" loops picked up the remaining areas.

## Admin UI scoping

**Q1: After R2, how should the platform-admin login work in the UI?**

| Option | Description | Selected |
|--------|-------------|----------|
| Per-business only (Recommended) | Switcher lists only member businesses; all 10 surfaces render one business; global = SQL/service-role | ✓ |
| Add 'All businesses' | Admin/staff-only unfiltered switcher entry — re-adds the branch R2 removes | |
| Strict + defer console | Per-business now; park an admin console as future phase | |

**Q2: What does the global lens look like during the remediation?**

| Option | Description | Selected |
|--------|-------------|----------|
| SQL editor only (Recommended) | Supabase Studio / psql; zero extra work | ✓ |
| Add admin SQL views | Read-only platform views in a migration; dev tooling only (~0.5d) | |
| Want in-app view | Captured as deferred idea; stays out of remediation | |

**Q3: Should platform admin and staff behave identically in the business-scoped UI?**

| Option | Description | Selected |
|--------|-------------|----------|
| Treat identically (Recommended) | One rule for every platform account; has_role short-circuit stays; zero special cases | ✓ |
| Identical, but multi-account | Other platform staff exist/coming — same rule, planner informed | |
| Differentiate them | Admin vs staff behave differently — adds branching to R2a/b | |

**Q4: Zero-membership platform account — what experience?**

| Option | Description | Selected |
|--------|-------------|----------|
| Empty state + CTA (Recommended) | Intentional empty states with create-business CTA; copy distinguishes no-membership from blank-business | |
| Hard redirect to create | Route straight into create-business flow; same mechanism as R4 resume guard | ✓ |
| Silent empties | Render with no data or explanation — indistinguishable from a bug | |

**Notes:** User chose hard redirect over the recommendation — every authenticated session without any business membership routes into the create-business flow.

## Broken-window cleanup

**Q1: What are the businesses provisioned since ffb6648?**

| Option | Description | Selected |
|--------|-------------|----------|
| All disposable tests | Hard-delete wholesale | |
| Some are real | Surgical strip only; keep business/membership/users | |
| Not sure - detect | Auto-detect the fake-template signature; only touch matches | ✓ |

**Q2: When the detector finds a fake-template business, what happens?**

| Option | Description | Selected |
|--------|-------------|----------|
| Strip + dry-run (Recommended) | Strip template rows, keep business + UBA + bundle; dry-run first | |
| Delete whole businesses | Harder reset; false positives destroy real tenants | |
| Report-only, manual | Script prints matches + evidence; user runs destructive SQL personally | ✓ |

**Q3: What should the report cover?**

| Option | Description | Selected |
|--------|-------------|----------|
| Evidence per match | created_at, owner email, placeholder URL, connector statuses, row counts, real-data presence | ✓ |
| + integrity checks (Recommended) | Also UBA role, 33-key bundle count, orphans; doubles as R1 acceptance tool | |

**Q4: When is the report run relative to Release 1?**

| Option | Description | Selected |
|--------|-------------|----------|
| Before Release 1 (Recommended) | In .planning/ next to verify-deployment.sql; run during Release 1 dev so testing isn't polluted | ✓ |
| After Release 1 | Validate fresh signups post-deploy; cleanup at leisure | |
| Ad-hoc | No fixed timing; fully decoupled | |

**Notes:** User consistently chose maximum personal control over automation: report-only + manual destructive steps, minimal evidence scope.

## Wizard UX shape

**Q1: Can steps 2 and 3 be skipped?**

| Option | Description | Selected |
|--------|-------------|----------|
| Skip + done-flag (Recommended) | Steps 2–3 skippable; explicit finish sets onboarding-done marker; resume guard fires only on abandonment | ✓ |
| Required except 4 | Literal audit reading; simplest guards; blocks storefront-only persona | |
| Step 2 skip, 3 required | Hybrid; still blocks storefront-only persona | |

**Q2: Where does the wizard live?**

| Option | Description | Selected |
|--------|-------------|----------|
| New /onboarding page (Recommended) | Dedicated route, full-page multi-step; /welcome retired; AuthConfirm retargets | ✓ |
| Reuse /welcome route | Fewer route changes; misleading name; setup-failed entanglement | |
| Dialog-based wizard | CreateBusinessDialog pattern; cramped; resume guard needs a route anyway | |

**Q3: When does the user see the reserved storefront URL?**

| Option | Description | Selected |
|--------|-------------|----------|
| Preview at step 1 (Recommended) | Read-only live preview derived from store name; "reserved" wording | ✓ |
| Reveal at step 4 | Hidden until publish; user commits a slug they never saw | |
| Editable slug field | Override before reserve; adds input + collision UX | |

**Q4: Finish destination + zero-membership landing?**

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard + dialog (Recommended) | Finish → Dashboard + toast; zero-membership redirect → create-business dialog, not wizard | ✓ |
| Finish at StoresHub | See fresh setup + CTAs; extra hop | |
| Recap page | Summary of created things; new one-time page | |

## Adjacent read holes

**Q1: Fold pathao_integrations + courier_shipments into R2c?**

| Option | Description | Selected |
|--------|-------------|----------|
| Fold both into R2c (Recommended) | Member-scoped read + grant fix; same migration/acceptance; ≈+0.5d | ✓ |
| pathao only | Credentials leak is urgent; shipments wait | |
| Defer to security pass | R2c ships audit-list exactly; secrets hole stays live after signups open | |

**Q2: How far on the plaintext secret columns themselves?**

| Option | Description | Selected |
|--------|-------------|----------|
| Policy-scoping only (Recommended) | Scope reads; columns stay plaintext but member-scoped; zero edge-fn changes | ✓ |
| Also hide columns | REVOKE on secret columns + RPC getters; touches pathao-courier money path | |
| Vault migration later | Endgame per CONCERNS.md; own future phase | |

## Plan split

**Q1: How does the remediation map to phases?**

| Option | Description | Selected |
|--------|-------------|----------|
| Two phases (Recommended) | Phase 1 = Release 1 (R1+R3+R4a+R4); Phase 2 = Release 2 (R2a–d); each with own plans/verification/gate | ✓ |
| One phase | ~9d blast radius; can't ship Release 1 until everything verifies | |

**Q2: When should Phase 2 (Release 2) be planned?**

| Option | Description | Selected |
|--------|-------------|----------|
| Plan Rel 2 after (Recommended) | CONTEXT.md covers both now; Phase 2 planned after Release 1 ships (R2a/b target wizard/R3-reshaped surfaces) | ✓ |
| Plan both now | Momentum; Phase 2 plans risk staleness | |

## Verification depth

**Q1: Add unit tests for the new frontend seams?**

| Option | Description | Selected |
|--------|-------------|----------|
| SQL + seam tests (Recommended) | Audit's SQL/member-JWT scripts PLUS vitest on useBusinessStores fail-closed, wizard guards, R4a wrapper idempotency; ≈+1d | ✓ |
| SQL scripts only | No new automated tests; fail-open regressions surface at runtime | |

## Declined / defaulted

- **Signup launch flip** — offered as a loose end; declined. Default recorded (D-18): `signup_open` flipped manually by the operator after Release 2 verifies.

## the agent's Discretion

- Wizard internal component structure/visual design within `/onboarding` (follow existing shadcn/ui page patterns; avoid god-component)
- Onboarding-done marker storage mechanism (server-side, cross-device)
- Detection script exact SQL (must implement the locked signature semantics)
- R2b picker-sweep mechanics within the locked 18-file checklist
- Deployment ordering within each atomic release

## Deferred Ideas

- Platform admin console (in-app global oversight for platform staff) — future phase
- New-signup notifications for the platform admin — future phase
- Additional self-serve stores beyond the declared single-store cap — future flow via the same R4a RPC
- Column-level secret hiding / Supabase Vault migration for courier+Woo credentials — future security pass
- UBA-based team invitations + business-scoped team-manage — future phase
