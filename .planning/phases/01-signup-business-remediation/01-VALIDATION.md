---
phase: "1"
slug: "signup-business-remediation"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-06"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Release 1 scope: R0, R1, R3, R4a, R4.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.2.4 (environment jsdom, globals true) |
| **Config file** | `vitest.config.ts` (separate from vite.config.ts) |
| **Setup** | `src/test/setup.ts` (jest-dom + matchMedia mock) |
| **Quick run command** | `npm test` (pure-function suite + new seam tests, seconds-fast) |
| **Full suite command** | `npm test` + `npm run typecheck` |
| **SQL acceptance** | `scripts/test_signup_rpc.sql` (rewritten this phase) — run by operator in Supabase Dashboard SQL Editor or psql |
| **Estimated runtime** | ~10s vitest; SQL acceptance is operator-paced |

---

## Sampling Rate

- **After every task commit:** Run `npm test` + `npm run typecheck`
- **After every plan wave:** `npm test` + local `supabase db reset` + acceptance SQL dry-run (if Docker available)
- **Before `/gsd-verify-work`:** full SQL acceptance run by operator against hosted project post-`db push` (R1-a…d, R4a-a…c, gate-regression) + R0 script executed and reviewed (D-08: before R1 acceptance) + wizard UAT walk + StoresHub UAT on blank + backfilled businesses
- **Max feedback latency:** ~30 seconds (vitest + typecheck)

---

## Per-Task Verification Map

> Task IDs assigned at planning time; requirement rows below are the seed mapping. Executor updates status per task.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD-01 | — | 0 | R1-a | T-01 | Provisioned business = 1 businesses + 1 UBA('owner') + 33 user_permissions rows | SQL | `scripts/test_signup_rpc.sql` §1 (rewritten) | ❌ W0 rewrite | ⬜ pending |
| TBD-02 | — | 0 | R1-b | T-01 | ZERO rows in stores/brands/locations/storefronts/selling_points/connectors/product_sources/customer_sources/user_store_access | SQL | same script, per-table count(*)=0 asserts | ❌ W0 rewrite | ⬜ pending |
| TBD-03 | — | 0 | R1-c | T-02 | Gates (anchor/nonce/expiry/provider/domain/idempotency) re-run green unchanged | SQL | same script, gate sections carry-over | ✅ edit in place | ⬜ pending |
| TBD-04 | — | 0 | R1-d | T-02 | create_additional_business idempotency: same-name≤24h→same id; diff name→new; user-B gets suffixed slug | SQL | same script §6b (new) | ❌ W0 | ⬜ pending |
| TBD-05 | — | 0 | R4a-a | T-03 | owner/admin of A cannot create in B; member/viewer denied (P0001) | SQL | same script deny-asserts (member-JWT via set_context pattern :184–185) | ✅ pattern exists | ⬜ pending |
| TBD-06 | — | 0 | R4a-b | T-03 | Second invoke returns the SAME store (single-store cap) | SQL + unit | script asserts + `src/test/createMyBrandStoreWrapper.test.ts` | ❌ W0 | ⬜ pending |
| TBD-07 | — | 0 | R4a-c | T-03 | One transaction: store + brand(woo_store_id) + user_store_access + inactive storefront (reserved slug, is_active=false) | SQL | script asserts is_active=false, slug equality, brand link | ❌ W0 | ⬜ pending |
| TBD-08 | — | 0 | R4-d1 | — | storefronts.view in bundle → fresh owner opens /storefronts | SQL + UAT | bundle count (R1-a) + manual UAT | — | ⬜ pending |
| TBD-09 | — | 0 | R4-d2 | — | Resume: abandonment → step 3; explicit finish (marker) never re-trapped | unit | `src/test/onboardingGuards.test.ts` — pure predicate decideRoute across 5 state cases | ❌ W0 | ⬜ pending |
| TBD-10 | — | 0 | R4-d3 | — | Zero-membership redirect fires, never during loading | unit | same predicate file, loading=true case | ❌ W0 | ⬜ pending |
| TBD-11 | — | 0 | R4-d4 | — | Publish works post-wizard on the R4a-reserved storefront | SQL | script §5 re-pointed at R4a-created storefront id | ✅ edit target | ⬜ pending |
| TBD-12 | — | 0 | R3-a | — | useStoresList fail-closed: zero brand-stores → [] never all stores | unit | `src/test/useStoresList.test.tsx` (renderHook + vi.mock client; assert from("stores") never called) | ❌ W0 | ⬜ pending |
| TBD-13 | — | 0 | R3-b | — | No NULL-brand leakage; badges only for real connections; Connect CTAs | UAT + grep | manual UAT blank vs backfilled + grep no `brand_id.is.null` | — | ⬜ pending |
| TBD-14 | — | 0 | R0-a | — | Detector matches ONLY template businesses; evidence columns per D-07 | SQL (operator) | `.planning/detect-window-businesses.sql` IS the deliverable; cross-check count vs report | ❌ W0 | ⬜ pending |
| TBD-15 | — | 0 | R0-b | — | Report-only: zero destructive statements | review | grep gate: no DELETE/UPDATE/ALTER in file | — | ⬜ pending |
| TBD-16 | — | 0 | Gate-regression | T-04 | Kill switch 403s when signup_open=false; purge/retention fns unchanged; delete_unprovisioned_self invariants hold under blank-slate | SQL | script gate-regression section (extends :210+ delete test) | ✅ extend existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/test_signup_rpc.sql` — REWRITE (old-shape asserts fail silently post-R1; becomes the R1/R4a/gate acceptance script)
- [ ] `.planning/detect-window-businesses.sql` — the R0 deliverable itself
- [ ] `src/test/useStoresList.test.tsx` — R3-a fail-closed seam test
- [ ] `src/test/onboardingGuards.test.ts` — R4-d2/d3 predicate tests
- [ ] `src/test/createMyBrandStoreWrapper.test.ts` — R4a-b wrapper idempotency
- [ ] Types regeneration (`supabase gen types`) must precede wizard implementation — wrapper needs typed `create_my_brand_store` in `Database["public"]["Functions"]`

*Framework install: none needed — jsdom/RTL/jest-dom configured and installed (verified).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wizard UAT walk: signup → confirm → wizard → dashboard → resume → publish | R4 (d1/d4) | End-to-end auth email loop can't run in vitest/jsdom | Fresh signup on hosted/staging; complete wizard skipping steps 2-3; finish → Dashboard + toast; re-login → no re-trap; publish storefront at step 4; open /storefronts |
| StoresHub truth on blank vs backfilled business | R3-b | Visual rendering + real data states | Switch active business between a blank (post-R1) and a July-backfilled business; blank shows Connect CTAs and zero channel cards; backfilled shows its REAL connections |
| R0 report review + any manual cleanup | R0 (D-06) | Operator reviews evidence and personally runs any destructive SQL | Run detector; eyeball evidence columns; confirm backfilled businesses (real data) NOT reported |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
