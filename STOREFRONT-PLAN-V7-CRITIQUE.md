# STOREFRONT-PLAN-V7 — Adversarial Critique (Cycle 7)

**Critic:** CRITIC agent, plan-convergence loop · **Date:** 2026-09-11
**Target:** STOREFRONT-PLAN-V7.md · **Ground truth:** STOREFRONT-PLAN-V6-CRITIQUE.md (M14/M15 definitions) + V1–V6 critiques + orchestrator-verified facts (trusted) + fresh verification this cycle (full read of V7, 826 lines; programmatic guard/create pairing analysis of the §9.1 pathao block; verbatim policy-name cross-check against `20260412170009` lines 14–30; full read of `20260620172022` (the June pathao_stores decision) and `20260614043218` (repo-precedent idiom); exhaustive pathao-mention enumeration across all 826 plan lines; §9.6/§10.1/§10.3/fact 6/§14.5 alignment audit; effort arithmetic recompute)

---

## Verdict

**CONVERGED — no actionable findings.**

Both cycle-6 fixes landed exactly as the required resolutions specified. M14 is fully resolved: all **seven** surviving §9.1 pathao re-creates (lines 487, 489, 491, 493, 495, 497, 505) are each immediately preceded by a `DROP POLICY IF EXISTS "<same name>" ON public.<same table>;` whose name **and** table match the create — verified programmatically, not by eye. The seven names are verbatim identical to `20260412170009` lines 20, 21, 23, 24, 26, 27, 29–30, so on a fresh `db reset` (where the April tail already created all eight names and Phase 6 runs later in timestamp order) every create is preceded by a no-op drop of the same name — no `policy … already exists` error, the migration applies, and re-runs are drop+create idempotent. The comment block (lines 480–485) states the idiom, its rationale (no `CREATE POLICY IF NOT EXISTS`, repo precedent `20260614043218`), and the live-vs-fresh semantics correctly; the "Re-run, idempotently (every re-create guarded — M14)" claim (lines 474–475) is now genuinely true, as is "harmless where already gone" for the block it governs. M15 is fully resolved: the `"Anyone can read pathao_stores"` re-create is **deleted** (the only pathao_stores create remaining is the guarded manage policy, exactly the M14-resolution carve-out as specified); the inline comment (lines 498–503) cites `20260620172022`'s "pathao_stores: remove public read" (re-verified against the migration: line 9 comment, line 10 `DROP POLICY IF EXISTS "Anyone can read pathao_stores"`) and states the end state — zero anon policies, authenticated-manage-only, no storefront need (service-role quote §8.2, zero `src/storefront` pathao references). The verification and summary layers are aligned to the amended scope with no assertion anywhere enforcing a public read on `pathao_stores`: §9.6 line 649 (cities/zones/areas = exactly the SELECT-only + authenticated-manage pair; `pathao_stores` = exactly its authenticated-manage policy and ZERO anon policies; zero `FOR ALL TO public` on any of the four), §10.1 line 680, fact 6 line 27 ("as amended by `20260620172022` (M15 — `pathao_stores`' public read is NOT restored)"), §10.3 line 695, and §14.5's H7 row annotation (line 813) all carry the amendment. The §14.6 change log is accurate (seven survivors / eight April names / guards no-op on live, re-create on fresh; M15 row matches the edit actually made; M9 note unchanged as claimed); the header (line 3) describes both fixes correctly. Effort arithmetic unchanged and internally consistent (44.5–59.5 d = 8.9–11.9 wk in header, §3, §14.6). The full-text sweep found zero collateral damage: the ten anon-policy drops (lines 462–471), the M9 note (506–508), and every other section are internally consistent, and the exhaustive pathao-mention enumeration shows no stale claim anywhere in the plan.

---

## HIGH findings

None.

## MEDIUM findings

None.

## LOW findings

None.

---

## Resolution table (cycle-6 findings → V7 verdicts)

| # | Verdict | Justification (one line) |
|---|---|---|
| M14 | **RESOLVED** | Every surviving re-create (7 of the April tail's 8 names) is preceded by a matching-name-and-table `DROP POLICY IF EXISTS` — verified programmatically against `20260412170009` lines 20–30 verbatim; fresh-reset and re-run both safe; the guard comment (lines 480–485) and the line-474 idempotency claim are now true; the M15 carve-out is implemented as the required resolution presupposed (guard+create deleted, not guarded). |
| M15 | **RESOLVED** | The `pathao_stores` public-read re-create is deleted and the guarded manage create kept; the inline comment cites `20260620172022` (re-verified: "-- 2. pathao_stores: remove public read" + the DROP); §9.6's assertion now enforces zero anon policies on `pathao_stores` (nothing asserts a public read anywhere); §10.1, fact 6, §10.3, and §14.5's H7 row all state the amended scope. |

**RESOLVED: 2 · PARTIALLY: 0 · NOT: 0** — **0 new actionable findings.**

---

## Fresh-eyes sweep (cycle-7 delta audit — final gate)

- **Guard/create pairing (programmatic):** event sequence over the §9.1 block — 7 CREATEs, each guarded by an immediately-preceding DROP with identical name + table; zero unguarded creates; zero orphan drops. Names byte-identical to `20260412170009`'s tail.
- **M15 absence check:** `"Anyone can read pathao_stores"` appears in the plan only inside comments/change-log rows describing its deletion — never as a CREATE. Ground truth re-verified: `20260620172022` drops it and nothing re-creates it in any migration (V6's repo-wide scan: the name appears in exactly two migrations — April create, June drop).
- **State matrix recheck (both fixes together):** fresh reset → April tail creates the 8 names → June drops pathao_stores' read → Phase 6's guards no-op, creates re-create byte-identically → end state = pair ×3 + pathao_stores manage-only (matches §9.6's assertion exactly). Live → Phase 6 drops the four `FOR ALL TO public` policies, creates the pair ×3 + manage → same end state. Both states satisfy every §9.6/§10.1 claim.
- **"Exactly" assertions:** `20260614043218` touches `pathao_integrations` (a different table) — no effect on the four location tables; no other migration in the chain adds policies to them (per cycle-6's 134-migration scan, unchanged this cycle). "Exactly pair / exactly manage-only" holds in both reachable states.
- **Pathao-mention enumeration (all 826 lines):** every mention (header, §1, §3, fact 6, §9.1 block + comments, §9.5, §9.6, §10.1, §10.3, §14.5, §14.6) is consistent with the amended scope; the shorthand "pathao tighten (H7)" in §1/§3/§9.5 is a summary reference into §9.1/§10.3, which carry the amendment — same accepted shape as V6, not actionable.
- **Effort arithmetic re-verified:** 20–25 + 3.5–5.5 + 5–7.5 + 5–7 + 3.5–5 + 7.5–9.5 = 44.5–59.5 d = 8.9–11.9 wk; header = §3 = §14.6's "none" delta. Both fixes fit inside Phase 6's existing 7.5–9.5 d as the V6 critique projected.
- **No other plan-text defects:** §4–§8, §9.2–§9.4, §10.2, §11–§13, §14.1–§14.5 re-read in full; internally consistent and unchanged from the V6-verified state; "retaining every cycle-1/2/3/4/5/6 resolution" holds.

## Appendix — minor notes (not actionable)

1. **Shorthand scope references:** §1 (line 10), §3 (line 56), and §9.5 (line 645) say "the pathao_* tighten" without repeating "as amended by `20260620172022`". The authoritative scope statements (§9.1's comment + M15 carve-out, §9.6's assertion, §10.3 exception #1) are the sections an executor implements from and they are aligned; the M15 required resolution did not list these summary lines. Wording-level, no change required.
2. **§9.6's ten-table clause shape:** lists nine named tables + `product_variations` via its exactly-one-SELECT-only clause — the full ten, same accepted shape as V6 (cycle-6 verified); unchanged.
3. **M14 row's "all eight policy names" phrasing** (§14.6) refers to the April tail's eight created names, of which seven survive as guarded re-creates — accurate as written; the June-amended name count (7) is stated in the same row.

## Verification method (this cycle)

- **Fresh repo verification:** full read of V7 (826 lines, chunked); programmatic DROP/CREATE pairing analysis of the §9.1 pathao block (regex event extraction, name+table match); verbatim name cross-check against `20260412170009` lines 14–30; complete statement read of `20260620172022` (June decision) and `20260614043218` (guard idiom precedent); exhaustive case-insensitive pathao-mention extraction across all plan lines with full untruncated text.
- **Plan-text analysis:** M14/M15 resolution audits against the V6 critique's required resolutions (including the M15 carve-out presupposition inside M14's fix); §9.6/§10.1/§10.3/fact 6/§14.5 alignment check; "no assertion enforces public read on pathao_stores" negative check; §14.6/header accuracy spot-check; live-vs-fresh-vs-re-run state matrix; effort arithmetic recompute; collateral-damage sweep.
- **PostgreSQL semantics applied:** guard idempotency on fresh replay (April tail precedes Phase 6 in timestamp order), re-run safety of DROP-IF-EXISTS + CREATE, absence of `CREATE POLICY IF NOT EXISTS`.

**Loop outcome: 7 cycles — V1 (13) → V2 (10) → V3 (5) → V4 (3) → V5 (2) → V6 (2) → V7 (0). CONVERGED.**
