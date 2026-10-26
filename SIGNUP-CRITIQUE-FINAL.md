# SIGNUP-CRITIQUE-FINAL — Loop Convergence Report

**Verdict: CONVERGED (v1.0, rounds 1–14 core)** then **re-opened by user scope change** (multi-business membership + top-left switcher + create-new-business) and **re-converged (v2.0, rounds 14–15)**: round 14 found 1 BLOCKER + 1 MAJOR (existing `get_my_managed_businesses()` filters out member/viewer memberships and returns no role column → replaced by new `get_my_businesses()` RPC returning the caller's own UBA rows, all four roles, role column included, no platform-admin dump); round 15 confirmation pass: PASS on all targeted checks, no substantive findings. The fixes were applied; the artifact's status is now FINAL v2.0.

## The loop

- **Method**: fresh-context adversarial reviewer per round (doubt-driven-development) — ARTIFACT + CONTRACT only, never the author's confidence; every finding re-validated against the plan text by the orchestrator before classification.
- **Cross-model review**: offered after round 1; **declined by user** (single-model throughout).
- **Findings**: **139 total, 139 classified "valid + actionable", 0 dismissed as noise, 0 rubber-stamped** — no doubt theater. (Rounds 1–13: 136 on the core; round 14: 2 on the multi-business delta; round 15 (light confirmation): 0 substantive.)

| Round | Total | Blocker | Major | Minor |
|---|---|---|---|---|
| 1 | 15 | 3 | 8 | 4 |
| 2 | 15 | 2 | 8 | 5 |
| 3 | 15 | 4 | 5 | 6 |
| 4 | 11 | 0 | 5 | 6 |
| 5 | 12 | 2 | 4 | 6 |
| 6 | 11 | 2 | 4 | 5 |
| 7 | 12 | 2 | 7 | 3 |
| 8 | 11 | 1 | 4 | 6 |
| 9 | 10 | 1 | 4 | 5 |
| 10 | 6 | 0 | 2 | 4 |
| 11 | 6 | 0 | 3 | 3 |
| 12 | 6 | 0 | 2 | 4 |
| 13 | 6 | 0 | 0 | 6 |
| 14 | 1 | 0 | 0 | 1 |

Blockers extinct by round 4 (one revival each in rounds 5–7 and 9, each fixed immediately). Majors extinct by round 13.

## What the loop caught, thematically

1. **Wrong authority model** (r1–3): self-signups would have received platform-wide `admin` (`user_roles` is global; RLS write policies check it without tenancy). Fixed: per-store/business permissions; zero global roles from the self-serve path, SQL-asserted in tests.
2. **False ground truth** (r1–4): the initial plan asserted a tenant model that didn't exist — and missed the one that did (`businesses`/`user_business_access` multi-business layer, 20260904000100). §1 is now fully migration-cited.
3. **Broken security primitives as specced** (r1, r5–8): Turnstile double-verification (single-use tokens), `admin.generateLink` misuse for resends (user-creation API), GoTrue captcha all-or-nothing (login outage risk), login `email_not_confirmed` enumeration oracle, metadata-based forgeable gate (replaced by server-anchored nonce + provider/`invited_at` channel checks).
4. **Concurrency/state holes** (r3, r5–6): duplicate-store race (advisory lock), purge deleting pending invitees / racing resends, unprovisionable zombie accounts (26 h purge; 24 h gate coherence; 30 d invitee sweep).
5. **Missing schema bindings** (r6–8, r10): NOT NULL columns (`stores.name`, `brands.name`, `storefronts.name`), link columns (`brands.woo_store_id`, `storefronts.store_id`), parity row set incl. `location_id`/`woo_store_id` bindings on selling points, `stores.status`/`is_active` defaults.
6. **Legacy-function hazards** (r2–3, r9–13): `team-manage` would have deleted every self-registered owner on invite; final design = five exhaustive routes keyed on server-anchored state, resolved via unpaginated lookup (the original code's 4,000-user scan cap found at scale).
7. **Monitoring lying** (r2, r5–6): funnel events no client could write; anonymous funnel poisoning; resend events recorded for emails never sent (GoTrue 200/empty on confirmed emails; TOCTOU race) — all closed.
8. **Retention/PII incoherence** (r1–3, r13): single retention table; self-delete writes email NULL at insert; `ON DELETE SET NULL` FK pinned; consent attributed to acceptance-time actor with server-stamped versions.
9. **Honesty in claims** (every round): "verified" labels removed until tasks run; timing-uniformity claims downgraded; estimates re-priced three times (final: ~30 person-days); DoD claims each backed by a named test.

## Deliverable

- **`SIGNUP-PLAN.md` (FINAL v2.0)** — 14 sections: cited ground truth; goals/non-goals; architecture (full gating + transaction spec, incl. §3.2 switcher + create-additional-business); data model; flows incl. every edge case; security controls; existing-auth integration incl. 5-route team-manage fix; dashboard/config checklist incl. launch blockers; analytics + retention; 11-block test plan (incl. multi-business + switcher cases); rollout with sequencing; ~33.5 person-day task table (two streams); risks with accepted residuals; definition of done — every DoD line traceable to a §10 test.

## Biggest residual flag for whoever builds this

**Task 0.1 discovery gates everything downstream.** The one unverified runtime behavior that could still reshape the plan is GoTrue version-dependent invite/metadata semantics on the deployed project; the plan now contains explicit contingency notes for it, but Task 0.1 must land before any migration work starts.
