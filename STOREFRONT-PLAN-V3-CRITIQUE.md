# STOREFRONT-PLAN-V3 — Adversarial Critique (Cycle 3)

**Critic:** CRITIC agent, plan-convergence loop · **Date:** 2026-09-11
**Target:** STOREFRONT-PLAN-V3.md · **Ground truth:** STOREFRONT-PLAN-V2-CRITIQUE.md (10 findings: H5; M7–M11; L4–L7) + STOREFRONT-PLAN-V1-CRITIQUE.md (13 findings; H1/H2 partials) + orchestrator verified facts (trusted; no new repo searches this cycle)

---

## Verdict

**REVISE — 5 actionable findings (1 HIGH, 2 MEDIUM, 2 LOW).**

All ten cycle-2 findings are resolved at the plan-text level, and both cycle-1 partials (H1 anon-policy coverage, H2 RPC race safety) are finally closed: the eight-table drop list, the constraint-gated 23505 handler, the self-checking decrement, the stock-ledger journal/replay rules, the deployable enum split, the in-RPC customer upsert, and the honest effort arithmetic all verify against the plan text. What remains: a guaranteed-broken wiring decision (the RPC REVOKE strips EXECUTE from its own callers — including a restore path the plan itself wires to an authenticated client call), a silently-dead claimed mitigation (clobber detection with no `updated_at` auto-update mechanism), a recompute-erasure hole in the new M8 fall-through, and two fact-basis gaps under new V3-specified migrations/probes. Three of the five (H6, M12, L9) are pre-existing V2 text the cycle-2 critique missed — caught fresh this cycle.

---

## HIGH findings

### H6 — The RPC REVOKE breaks both callers: `storefront_place_order` is uncallable by the edge fn, and `storefront_restore_stock` is uncallable by the admin app
- **Plan section:** §9.1 (REVOKE line), §9.2, §9.3, §10.1 (RPC row)
- **Defect:** "Both RPCs: `REVOKE ... FROM PUBLIC, anon, authenticated` (defense in depth — the edge fn runs service role and bypasses grants)". Two errors. (1) The service role bypasses **RLS, not EXECUTE privileges**. A SECURITY DEFINER function still requires the *calling* role to hold EXECUTE at call time; after `REVOKE FROM PUBLIC`, only the function owner retains it. Supabase's `service_role` is not the owner and holds no default EXECUTE grant on newly created functions — the standard post-revoke pattern is an explicit `GRANT EXECUTE ... TO service_role`, which the plan omits. As written, `storefront-checkout`'s single RPC call (§9.2) returns permission-denied for **every** checkout: the Phase 6 headline fails at runtime. (2) The restore RPC's caller is not even service role: §9.3 wires `storefront_restore_stock(order_id)` into `OrderDetailSheet.tsx`'s cancel path — a direct client call by an **authenticated** staff/admin session, the exact role the REVOKE strips. Cancel-restores-stock is dead on arrival by the plan's own text, and §10.1's row ("no execute for PUBLIC/anon/authenticated") directly contradicts §9.3's call site within the same document.
- **Evidence:** §9.1 line 479 (REVOKE + "bypasses grants" parenthetical); §9.2 line 486 (fn → single RPC call); §9.3 line 493 (authenticated app call to restore); §10.1 line 535.
- **Required resolution:** After the REVOKE, add explicit grants matching the callers: `GRANT EXECUTE ON FUNCTION public.storefront_place_order(jsonb) TO service_role;`. For the restore, either `GRANT EXECUTE ... TO authenticated` **plus** an in-RPC guard (`has_role(auth.uid(),'staff'|'admin')` — SECURITY DEFINER still resolves the caller's JWT via `auth.uid()`; RAISE P0001 otherwise) — or route the restore through a tiny service-role edge fn, consistent with the checkout path. Delete the "bypasses grants" parenthetical; it is factually wrong and is precisely why this shipped.
- **Provenance:** pre-existing V2 text (V2 line 382), missed by the cycle-2 critique.

---

## MEDIUM findings

### M12 — Clobber detection is dead as specified: no `updated_at` auto-update mechanism exists for `storefront_page_sections` (and none is claimed for `storefront_pages`)
- **Plan section:** §4.1 (DDL), §4.4 (save clobber detection), §13 risk 6
- **Defect:** §4.4's optimistic-concurrency check — "the update matches `WHERE id = ? AND updated_at = <base>` — zero-rows-updated → conflict toast" — only detects a clobber if the *other* writer's UPDATE advanced `updated_at`. The §4.1 DDL defines `updated_at timestamptz NOT NULL DEFAULT now()` and creates **no BEFORE UPDATE trigger**; nowhere does the plan say a save's SET clause writes a fresh `updated_at`. As written, `updated_at` keeps its insert-time value forever: the second writer's `WHERE updated_at = <base>` always matches, every save is plain last-write-wins, and the conflict toast can never fire. §13 risk 6 then claims this no-op as the accepted mitigation for concurrent editing. (Same dependency for page-level saves on the existing `storefront_pages` table — fact 9 lists the column, not a trigger.)
- **Evidence:** §4.1 lines 90–92 (DDL, no trigger); §4.4 line 164; §13 line 594.
- **Required resolution:** Add a `set_updated_at()` BEFORE UPDATE trigger for `storefront_page_sections` (verify or add the equivalent for `storefront_pages`), or specify that every save's SET clause includes `updated_at = now()` alongside the base-value WHERE predicate; add a §4.6 vitest asserting a save against a stale base updates zero rows.
- **Provenance:** pre-existing V2 text (V2 line 153), missed by the cycle-2 critique.

### M13 — The M8 fall-through's products-direct decrement is silently erased by the next locations-write recompute — an oversell window on a location-bearing product
- **Plan section:** §9.1 step 3 (Case A non-variation, M8 fall-through), §2 fact 1
- **Defect:** For a non-variation item on a product whose location rows are ALL variation-keyed, the M8 fix falls through to the Case-B products-direct decrement — correct per the letter of M8's required resolution, and "no sync-trigger rewrite needed because no locations row changed". But the product **has** location rows, and fact 1's `sync_product_stock_from_locations` recomputes `products.stock_quantity = SUM(location rows)` on **every** locations write for the product. The fall-through's decrement lives only in `products.stock_quantity`, invisible to the location rows — so the very next locations write for that product (e.g., a variation sale decrementing a variation-keyed row, a POS/Woo location edit) recomputes the aggregate from the rows and **resurrects the decremented qty**. Stock is then inflated by the sale amount until a manual resync — the exact oversell class Phase 6's headline ("oversell-safe") claims closed. Exploitability is not just crafted-RPC: `storefront-checkout` forwards cart items and validates `variation_id` only *when present* (§6.4), so a variations-product item without `variation_id` passes the fn's product-level check and reaches the fall-through. Contrast: Case B proper (zero location rows) is stable because no locations write can occur until rows are added; the fall-through product has rows, so the erase is routine, not exotic.
- **Evidence:** §9.1 lines 431–436 (fall-through + "no sync-trigger rewrite needed"); fact 1 (recompute on every locations write, parent+variation together); §6.4 (variation checks when present).
- **Required resolution:** Either (a) make the fall-through ledger-coherent: when the parent-keyed UPDATE matches zero rows, decrement the product's location rows FIFO across **all** its rows (mirroring the variation-item's cross-key fallback to parent rows — symmetric, recompute-stable), journaling them like any Case-A decrement; or (b) keep products-direct but record a drift marker and explicitly acknowledge the erase window in §13 (it is NOT currently covered by risk 1, which addresses the variations-vs-locations double ledger, not aggregate-vs-locations erase), with the §9.6 M8 fixture extended to fire a subsequent locations write and assert the decrement survives.
- **Provenance:** NEW — introduced by the V3 M8 fix.

---

## LOW findings

### L8 — The M7 scripted probe presumes a unique constraint on `orders.order_number` that no grounding fact establishes
- **Plan section:** §9.6 (M7 probe), §9.1 step 1a
- **Defect:** The probe — "force an order_number collision (two different-key requests with the same pre-generated number) → the RPC re-raises" — requires an actual unique constraint/index on `orders.order_number` to raise 23505 at all. No §2 fact establishes one. If none exists, the "collision" violates nothing: the second insert commits silently, there is no 23505, no re-raise, and duplicate order numbers are created — the probe is unbuildable as specified and M7's motivating case (the order_number collision) is untestable. (The handler fix itself is constraint-agnostic and sound; only the probe's runnability is at stake.)
- **Evidence:** §9.6 line 511; §9.1 lines 409–411; §2 (no order_number uniqueness fact anywhere in cycles 1–3).
- **Required resolution:** Verify whether a unique constraint/index exists on `orders.order_number` and record it as a grounding fact; if absent, add one (expand-only) or re-scope the probe to whichever unique constraint the insert actually faces.

### L9 — Phase 2's index and reorder UI depend on a junction `position` column (and a collections `position` column) that no grounding fact establishes
- **Plan section:** §5.2, §5.4, §2 fact 10
- **Defect:** §5.2's entire migration is `CREATE INDEX idx_scp_collection_pos ON storefront_collection_products(collection_id, position)`, and §5.4 builds add/remove/**reorder via position** plus a collections list column "position" — but fact 10 (the grounding fact for the junction: "product_id has NO FK; (collection_id, product_id) UNIQUE") never says either table has a `position` column. If the junction lacks it, the index DDL **fails on deploy** — the same deploy-blocking shape as V1's `CREATE TABLE storefront_pages` (cycle-2 catch). "Phase 2 needs zero new tables" is true either way, but the plan never states the needed `ADD COLUMN IF NOT EXISTS position` (junction) or verifies a `position` on `storefront_collections`.
- **Evidence:** §5.2 line 195; §5.4 line 207; fact 10 line 31.
- **Required resolution:** Verify both columns exist and record in fact 10; if the junction column is absent, extend the §5.2 migration with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0` (plus backfill by current ordering) so the index and reorder UI are grounded.
- **Provenance:** pre-existing V2 text (V2 lines 176/186), missed by the cycle-2 critique.

---

## Resolution table (cycle-2 findings → V3 verdicts)

| # | Verdict | Justification (one line) |
|---|---|---|
| H5 | **RESOLVED** | Drop list extended to all eight 20260407074308 tables with the correct policy names (§9.1 lines 378–385); fact 6 attribution corrected; §9.6 asserts zero `TO anon` on products/stores + 2020619-survives + anon-UPDATE rejected; §1/§10.1/§10.3 exception #1 all updated consistently. |
| M7 | **RESOLVED** | Handler gated: CONSTRAINT_NAME must equal `uq_orders_idempotency_key` (else re-raise), by-key SELECT empty → re-raise, only then `deduped:true`; chain is complete and dedupes correctly (partial unique index guarantees the by-key row is the winner); §9.6 probe added (probe runnability → new L8, handler itself sound). |
| M8 | **RESOLVED** | Zero-row non-variation decrement falls through to Case-B products-direct; FIFO fallback capped (variation+parent short of qty → P0001); every location UPDATE guarded `stock_quantity >= take` with rows-affected assertion; §9.6 fixtures cover all three shapes — but the fall-through's interaction with the locations recompute opens a new hole (M13). |
| M9 | **RESOLVED** | No re-create in Phase 6; the 20260407074308-name drop is a genuine no-op against Phase 3's differently-named policy, which persists; the self-contradictory block deleted; §9.6 assertion unchanged. |
| M10 | **RESOLVED** | `order_items.stock_ledger` journal written in-transaction; restore replays the recorded shape with explicit deleted-row (products-direct + drift notice) and added-rows (products-direct, net-zero) rules — traced coherent in every combination; restore-path woo pushes acknowledged (fact 2, §9.1, risk 8); fixtures cover all three divergence cases. |
| M11 | **RESOLVED** | Arithmetic verified: P1 20–25 + P2 3–5 + P3 5–7.5 + P4 5–7 + P5 3.5–5 + P6 7–9 = 43.5–58.5 d = 8.7–11.7 wk at 5 d/wk; header, §3, and §14.2 agree; Phase 6 re-estimate justified item-by-item. |
| L4 | **RESOLVED** | routes.ts created in §5.1 (Phase 2, first consumer) with route-shape vitest there; §7.1 retitled "adopted, not created"; §3 table + §11 note the hoist; no phase consumes a later-shipping module. |
| L5 | **RESOLVED** | Two-migration split is deployable: migration 1 does ADD VALUE only (no same-txn comparison — the PG12+ restriction stated correctly in fact 20); migration 2's guarded UPDATE compares the value in its own committed-later transaction; both re-run safely; §4.6 verifies the grant. |
| L6 | **RESOLVED** | Customer upsert moved to RPC step 0 inside the transaction; plpgsql subtransaction semantics make the dedupe path rollback-safe (the loser's upsert rolls back; the winner's identical upsert stands — idempotent on retry); §9.2 updated; §9.6 ghost-customer check added. |
| L7 | **RESOLVED** | Policy gated `USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variations.product_id AND p.is_active))` matching the 2020619 precedent; fact 11 + §10.1 updated; §6.6 deactivate-product anon-REST check; §13 risk 9 acknowledges the EXISTS cost. |

**RESOLVED: 10 · PARTIALLY: 0 · NOT: 0**

### V1 partials — final status

- **H1 (anon-policy coverage): fully resolved.** The eight-table closure is exactly the batch 20260407074308 created (trusted fact); the Track fn is the replacement access path deployed in the same window (§9.4); §9.6 now verifies the full set end-to-end including that the closure did not break the catalog and that anon UPDATE on products/stores is rejected.
- **H2 (RPC race safety): fully resolved.** Insert-first + unique partial index + single transaction deletes the cross-call window by construction; the V3-constrained 23505 handler closes V2's residual misclassification hole; the genuinely-concurrent race script (same-key both-200/one-order/one-decrement; different-key one-200-one-400) verifies it. (M13 concerns ledger coherence after commit, not the race window — outside H2's scope.)

---

## Fresh-eyes scan (pre-existing V2 defects the cycle-2 critique missed)

- **H6** (REVOKE without service_role GRANT / authenticated restore caller) — V2 line 382 + V2 §9.3 wiring, unchanged into V3. The cycle-2 critique audited the RPC's exception contract but not its invocation privileges.
- **M12** (clobber detection without any `updated_at` bump mechanism) — V2 line 153, unchanged into V3.
- **L9** (junction `position` column unestablished) — V2 lines 176/186, unchanged into V3.
- No other missed V2 content defects found: the V2-carried Track no-oracle contract, shipping-quote CORS posture, bulk-cancel failure semantics, and backfill ON CONFLICT guard all re-verified clean in V3 text.

## Appendix — minor notes (not actionable)

1. §5.5 says Phase 4 "drops by the same amount" (routes.ts work moved out) while §3 and §14.2 say Phase 4 is "unchanged net" at 5–7 d — a wording tension only; the arithmetic is consistent.
2. The restore's added-locations branch (Case B + rows added) gets no drift NOTICE, unlike the deleted-row branch — same divergence shape; consider a notice for symmetry (§9.6 fixtures already document the branch).
3. Phase 1's ProductGrid/FeaturedProducts card linking mechanics are unspecified (routes.ts ships in Phase 2); inline literals in Phase 1 with Phase-2 adoption match the L4-approved pattern — fine, but stating it would be cleaner.
4. Main-domain `/robots.txt` now returns the fn's 404-shape instead of the static allow-all — a 404/absent robots.txt is treated as allow-all by Google/Bing, so behavior is functionally equivalent; the static file survives for localhost.
5. The M8 fixture's "products.stock_quantity drops by qty" assertion is correct for the fall-through; once M13 is fixed via option (a), that fixture should also assert the location-row ledger moves (or stays) coherently.
6. §4.6's "backfilled home drafts = storefront count" can legitimately undershoot if the dead table already holds a `(storefront_id, 'home')` row (ON CONFLICT DO NOTHING skips) — the verify assertion itself surfaces it; acceptable as a guard.

## Facts relied on (no new repo searches this cycle)

- **Trusted orchestrator facts:** the eight-table 20260407074308 anon FOR ALL batch (products/stores drops were missing in V2 — now covered); 20260415171221 dropped orders_source_check; storefront_pages pre-exists; no storefronts.view enum value pre-Phase-1; vitest present; vercel.json single catch-all; stock triggers enqueue sync_queue rows with ON CONFLICT dedup.
- **Plan-text analysis:** all five findings, the 10-row resolution audit, H1/H2 closure, effort arithmetic (recomputed: 43.5–58.5 d = 8.7–11.7 wk ✓), ADD VALUE/grant transaction sequencing, decrement/journal/restore replay rule-tracing, RPC exception-chain completeness, sequencing/dependency consistency, and change-log (§14.2) accuracy — checked row-by-row against the plan text; every claim in the change log matches its cited section.
- **PostgreSQL semantics applied:** EXECUTE privilege vs RLS bypass for SECURITY DEFINER callers (H6); plpgsql subtransaction rollback-to-block on caught exceptions (M7/L6); PG12+ ALTER TYPE ADD VALUE same-transaction use restriction (L5 — plan states it correctly).
