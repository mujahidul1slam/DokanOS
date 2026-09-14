# STOREFRONT-PLAN-V4 — Adversarial Critique (Cycle 4)

**Critic:** CRITIC agent, plan-convergence loop · **Date:** 2026-09-11
**Target:** STOREFRONT-PLAN-V4.md · **Ground truth:** STOREFRONT-PLAN-V3-CRITIQUE.md (5 findings: H6, M12, M13, L8, L9) + STOREFRONT-PLAN-V2-CRITIQUE.md + STOREFRONT-PLAN-V1-CRITIQUE.md + orchestrator verified facts (trusted) + fresh migration-verification this cycle (20260516201928, 20260904000400, 20260407071618, generate_pos_order_number, GRANT precedents)

---

## Verdict

**REVISE — 3 actionable findings (0 HIGH, 1 MEDIUM, 2 LOW).**

All five cycle-3 resolutions hold at the mechanism level: the H6 grant chain is PG-correct and matches repo precedent, the M12 triggers make clobber detection functional, the M13 cross-key FIFO is recompute-stable and journal-coherent, the L8 unique index is self-guarded and deployable on dirty data, and the L9 migration can no longer fail on deploy. But V4's two NEW grounding-fact "corrections" (facts 9 and 10, the [M12]/[L9] amendments) are both **factually false against the very migrations the plan itself cites**: `20260516201928` already creates the `storefront_pages` `updated_at` bump trigger AND `position` columns on both collections tables. One of these false facts ships an unguarded data-rewrite (the junction backfill) whose stated safety property ("re-run changes nothing") is false in any curated state. A third, smaller defect: the sections-table trigger in §4.1 omits the plan's own stated idempotency idiom used three lines earlier for the pages trigger. No HIGH findings — nothing in V4 breaks checkout, security, or deployability that prior cycles established.

---

## HIGH findings

None.

---

## MEDIUM findings

### N2 — Fact 10's [L9] amendment is false: both `position` columns have existed since `20260516201928` — and the backfill built on the false premise destructively rewrites curated positions, breaking §5.5's own idempotency claim
- **Plan section:** §2 fact 10 ([L9] amendment), §5.2 (migration + backfill), §5.5 (idempotency claim), §14.3 L9 row
- **Defect:** Fact 10 now asserts "**[L9] No inspected migration establishes a `position` column on EITHER table**", and §5.2 states "no order column exists — fact 10". This is verifiably false: `20260516201928_001403e4…` — the exact migration fact 10 cites as the tables' origin — defines `position integer NOT NULL DEFAULT 0` on `storefront_collections` (line 85) **and** on `storefront_collection_products` (line 112). No later migration drops either column (scanned all migrations). The `ADD COLUMN IF NOT EXISTS` is therefore always a no-op — deploy-safety is real, but the fact is wrong. Worse, the backfill (`SET position = row_number()-1 … WHERE scp.position <> ordered.rn`) was justified by that false premise and **unconditionally rewrites every junction position to uuid order**. Live rows are almost certainly all `position=0` (verified: no app code has ever read or written these columns — only generated types.ts mention them), so first-run harm is low; but (a) any operator curation via SQL is silently destroyed, and (b) §5.5's claim "junction backfill idempotent (**re-run changes nothing**)" is false the moment Phase 2's own reorder UI exists: a re-run (staging clone from prod, `db reset` on dumped data) resets operator-curated positions back to uuid order. The plan's stated pre-flight ("the executor's pre-flight column check records the live answer") directly contradicts the fact's definitive assertion — the verification V3's L9 demanded was performed and the **wrong answer was recorded**.
- **Evidence:** `20260516201928` lines 85, 112, 108–114 (junction DDL with `position` + `UNIQUE (collection_id, product_id)`); no `ALTER … DROP COLUMN position` in any migration; fact 10 (plan line 31); §5.2 lines 216–245; §5.5 line 261; §14.3 L9 row line 743.
- **Required resolution:** Correct fact 10: the `position` columns exist on both tables since `20260516201928`, defaulted 0, never managed by any UI (pre-flight now confirms rather than discovers). Make the backfill non-destructive — e.g. renumber only rows still at the default (`AND scp.position = 0`), or pre-flight-gate the whole renumber on "all live positions are default"; fix §5.5's idempotency wording to hold in the curated state. The index and reorder UX need no change.

---

## LOW findings

### N1 — Fact 9's [M12] amendment is false: `20260516201928` already creates the `storefront_pages` BEFORE UPDATE `updated_at` trigger — the pages table was never "insert-frozen"
- **Plan section:** §2 fact 9 ([M12] amendment), §4.1 (trigger comment), §14.3 M12 row
- **Defect:** Fact 9 now asserts "**[M12] No inspected migration establishes a BEFORE UPDATE `updated_at` trigger on it — as created, `updated_at` keeps its insert-time value forever.**" False: the same migration fact 9 cites (`20260516201928` §5) creates `update_storefront_pages_updated_at` — `BEFORE UPDATE ON public.storefront_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()` (lines 153–155), and that function sets `NEW.updated_at = now()` (defined in `20260407071618`). No migration drops it (scanned). So page-level clobber detection was already functional pre-V4; only `storefront_page_sections` (genuinely new, no trigger) needed the fix. V4's design survives its own false premise — the §4.1 block explicitly hedges ("If some differently-named trigger already bumps updated_at, ours is harmless") and the added duplicate trigger is indeed harmless (both set `now()`, transaction-stable) — but the grounding fact is presented as "re-verified across cycles 1–4" and is wrong, and §14.3 repeats it ("V3 had no bump mechanism — `updated_at` was insert-frozen" — true only for the sections table, which didn't exist). Cycle 2 proved false grounding facts become HIGH findings later (H5); this class must not be re-normalized.
- **Evidence:** `20260516201928` lines 153–155; `update_updated_at_column()` body in `20260407071618` (sets `NEW.updated_at = now()`); no DROP of the trigger anywhere; fact 9 (plan line 30); §4.1 lines 105–109; §14.3 M12 row line 740.
- **Required resolution:** Correct fact 9: `storefront_pages` has had a BEFORE UPDATE `updated_at` bump since `20260516201928`; the [M12] gap was real only for the new `storefront_page_sections` table. Fix §4.1's comment and §14.3's parenthetical accordingly. Optionally drop the redundant pages trigger add and rely on the pre-existing one (or keep the harmless duplicate with corrected rationale — either is acceptable once the fact is true).

### N3 — The sections-table trigger omits the plan's own stated idempotency idiom used three lines earlier in the same DDL block
- **Plan section:** §4.1 (trigger DDL)
- **Defect:** §4.1 states "the DROP IF EXISTS of OUR OWN trigger name + re-CREATE is the standard migration idempotency idiom on a self-owned object" — and the pages trigger follows it (`DROP TRIGGER IF EXISTS trg_storefront_pages_set_updated_at …; CREATE TRIGGER …`). The `storefront_page_sections` trigger two lines above is a bare `CREATE TRIGGER trg_storefront_page_sections_set_updated_at …` with no preceding `DROP TRIGGER IF EXISTS` (and PG's `CREATE OR REPLACE TRIGGER` is not used). Any re-run of `storefront_page_builder.sql` errors with "trigger already exists", contradicting the plan's claimed migration re-run safety ("Both migrations re-run safely", §4.1; repo convention, e.g. `20260831000592`/`594`).
- **Evidence:** §4.1 lines 100–104 (bare CREATE) vs lines 110–113 (DROP IF EXISTS + CREATE) and line 106–109 (the idiom, stated).
- **Required resolution:** Add the one matching line: `DROP TRIGGER IF EXISTS trg_storefront_page_sections_set_updated_at ON public.storefront_page_sections;` before the CREATE (or use `CREATE OR REPLACE TRIGGER`, supported on the PG15+ Supabase runtime), restoring the block's own consistency and the claimed re-run safety.

---

## Resolution table (cycle-3 findings → V4 verdicts)

| # | Verdict | Justification (one line) |
|---|---|---|
| H6 | **RESOLVED** | `GRANT EXECUTE … TO service_role` after the REVOKEs matches PG EXECUTE-vs-RLS semantics (fact 22 correct, and the repo's established pattern — 20+ precedents scanned); restore re-routed through `storefront-restore-stock` (JWT-verified, staff/admin role-checked inside the fn, NOT CORS-open — §10.2), so the admin app never calls a SECURITY DEFINER RPC directly; §9.6 verifies `routine_privileges` + anon/authenticated REST-denied + staff-through-fn positive; the false "bypasses grants" parenthetical is gone. |
| M12 | **RESOLVED** | `set_updated_at()` BEFORE UPDATE triggers make the stale-base `WHERE updated_at = <base>` predicate functional on both tables (pages already had a bump — false premise flagged as N1, mechanism unaffected); the FOR EACH ROW trigger fires on section-reorder/toggle bulk UPDATEs, so position-only writes advance the stamp and concurrent stale-base saves get the conflict toast; §4.6 adds pg_trigger presence + scripted stale-base-0-rows/current-base-1-row + two-tab manual test; risk 6 rewritten truthfully. |
| M13 | **RESOLVED** | V3's products-direct fall-through deleted for location-bearing products; non-variation items now mirror the variation path — parent-keyed FIFO, then variation-keyed FIFO fallback, capped (all rows combined short → P0001); decrements land in the rows the `sync_product_stock_from_locations` trigger SUMs (verified: SUM over ALL rows for product_id, parent+variation together), so they survive every recompute; cross-key rows journaled by row-id and restore-replayable via the M10 ledger; §9.6 recompute-survival fixture + risk 11; §6.4's crafted-payload claim is now true. |
| L8 | **RESOLVED** | Fact 21 repo-verified TRUE (no unique constraint/index on `orders.order_number` in any migration — scanned); `uq_orders_order_number` with the loud DO-block duplicate pre-check handles pre-existing dupes safely (halts with a count before the index, nothing partially applied); step-1a re-raise names the constraint; §9.2 retry is bounded and idempotency-safe (the re-raised attempt committed nothing); §9.6 probe grounded on the guaranteed constraint; §10.1 row + risk 10. |
| L9 | **PARTIALLY** | The deploy-blocking defect is closed (`ADD COLUMN IF NOT EXISTS` cannot fail on either live state) and the index/reorder UX is grounded — but the required *verification* was performed incorrectly: fact 10 records the OPPOSITE of repo reality (both `position` columns exist since `20260516201928`), and the backfill written on that false premise unconditionally rewrites junction positions and breaks §5.5's re-run-changes-nothing claim in any curated state (→ N2). |

**RESOLVED: 4 · PARTIALLY: 1 · NOT: 0**

---

## Fresh-eyes sweep (V4-delta audit)

- **H6 grant chain (orchestrator question a):** sound. Edge fns run with the service key; the restore fn verifies the caller's platform JWT and checks staff/admin roles inside the fn (§9.3/§10.2), with §9.6 asserting pass-for-staff/reject-for-roleless-JWT. The exact role-check mechanism (decode claims vs service-role lookup) is left to the executor with the verified in-repo precedent (`generate-storefront-content` admin check, fact 18) — acceptable plan-level granularity.
- **M12 reorder interaction (question b):** the row-level BEFORE UPDATE trigger fires on the two swapped-position UPDATEs of a reorder (and on visible-toggles), advancing `updated_at` on each touched section — a concurrent stale-base save on those rows correctly conflicts. Page-level saves work via the pages-table bump. No defect.
- **M13 math (question c):** verified against the actual `sync_product_stock_from_locations` body (SUM over ALL rows for the product, single recompute UPDATE with an idempotent `IS DISTINCT FROM` guard): a cross-key decrement is a locations write → lowers the aggregate exactly once; no double count; restore replays recorded row-ids; deleted-row rule (products-direct + drift) applies uniformly to cross-key rows. The one residual skew — a non-variation sale borrowing variation-keyed rows leaves `product_variations.stock_quantity` overstated relative to its location rows — can only surface as a loud P0001 on a later variation sale (never an oversell), and is within risk 11's one-pool framing. Sound.
- **L8 deployability (question d):** the plan cannot know prod dupes; the DO-block pre-check makes the migration fail loudly with the dup-group count BEFORE the index builds, leaving nothing partially applied; operator dedupes; risk 10 owns it. Note (appendix 2): the halt also blocks the anon-policy drops in the same migration — acknowledged, acceptable.
- **Junction backfill idempotency (question e):** idempotent only in the never-curated state; after any curation a re-run clobbers (folded into N2).
- **Internal consistency:** effort arithmetic re-verified (20–25 + 3.5–5.5 + 5–7.5 + 5–7 + 3.5–5 + 7.5–9.5 = 44.5–59.5 d = 8.9–11.9 wk; header = §3 = §14.3 deltas); §14.3 change-log rows each match the plan text they cite (except the two false facts → N1/N2); §10.1/§10.2/§10.3 consistent with §9.1/§9.3; §6.4's safety note correctly points at §9.1 step 3; sequencing (1→2→3→5→6→4; 6 after 3; routes.ts in 2) unchanged and correct; RPC signatures match the GRANT/REVOKE argument types.
- **No other new V4 text defects found:** fact 22's PG semantics correct; §9.2's collision retry and "all other re-raises → 500" consistent with M7's error-never-dedupe contract; `GROUP BY 1 HAVING count(*)>1` pre-check valid; NULL-order_number note harmless (column is NOT NULL per `20260407071618:82`); verify assertions all executable.

## Appendix — minor notes (not actionable)

1. **M7 probe wording mixes levels:** "two different-key requests carrying the SAME pre-generated order number … the fn retries once" — through the fn this is unforceable (the fn mints numbers from `pos_order_number_seq`, which cannot collide); the probe is executable as a *direct RPC* invocation with crafted `number` payloads (assert the 23505 re-raise + constraint name + first-commit), and the fn-retry path is separately testable by pre-seeding an order row with the sequence's next value. Executor latitude suffices; wording could be tightened.
2. The L8 DO-block halt gates the whole Phase 6 migration — including the H1/H5 anon-policy drops — on order-number dedupe. Splitting the migration would decouple the PII closure from that hygiene halt; risk 10 owns the coupling as written; optional.
3. Post-deploy there will be two `updated_at` triggers on `storefront_pages` (pre-existing `update_storefront_pages_updated_at` + the new one). Harmless (both set `now()`, transaction-stable); N1's fact correction makes this explicit, and relying on the pre-existing trigger alone would be cleaner.
4. A non-variation cross-key borrow leaves `product_variations.stock_quantity` overstated vs its location rows until resync — can only produce a loud P0001 later, never an oversell; within risk 11's framing.
5. `generate_pos_order_number` is sequence-based (`nextval('pos_order_number_seq')` + store/invoice prefix-suffix), so genuine fn-minted collisions are essentially impossible in production; the §9.2 retry is dead-in-practice defense — harmless, worth keeping.
6. Fact 21's "unique indexes ignore NULLs" note is moot (order_number is NOT NULL) but harmless.

## Verification method (this cycle)

- **Fresh repo verification (cheap scans):** `20260516201928` full DDL read (positions lines 85/112, pages trigger lines 153–155, junction/UNIQUE/FK lines 108–114); `update_updated_at_column()` body (`20260407071618`); `sync_product_stock_from_locations` body + trigger events (`20260904000400`: AFTER INSERT/UPDATE/DELETE, SUM over all rows, `IS DISTINCT FROM` guard); zero unique refs on `orders.order_number` across all 100+ migrations (fact 21 TRUE); zero `position` refs on collections tables outside `20260516201928` (fact 10 amendment FALSE); zero DROP refs to the pages trigger (fact 9 amendment FALSE); `generate_pos_order_number` body (sequence-based); `GRANT EXECUTE … TO service_role` precedent scan (20+ occurrences); app-code scan (no runtime reads/writes of junction/collections `position` — only generated types.ts); `storefront_page_sections` absent from all migrations (new-table premise correct).
- **Plan-text analysis:** all five resolution audits above; new-defect hunt across every V4 delta (facts 9/10/21/22, §3, §4.1, §4.4, §4.6, §5.2, §5.5, §6.4, §9.1–§9.6, §10.1–§10.3, §13, §14.3); change-log accuracy row-by-row; effort arithmetic recomputed; cross-references and sequencing traced.
- **PostgreSQL semantics applied:** EXECUTE privileges vs RLS bypass for SECURITY DEFINER (H6); BEFORE UPDATE FOR EACH ROW triggers firing on position-only bulk UPDATEs (M12); CTE-backed UPDATE self-reference snapshot semantics (L9 backfill); unique-index CREATE lock behavior and DO-block same-transaction pre-checks (L8); transaction-stable `now()` under stacked triggers (N1 harmlessness).
