# Scan-Plan Review — Round 3 (Convergence Final)

Plan: `QR-SCAN-IMPLEMENTATION-PLAN.md` (v3, 157 lines) · Reasoned against the pre-verified fact sheet (F1–F16). No codebase files read.

## Round-2 Fix Verification

| # | Severity | Status | Evidence |
|---|---|---|---|
| A1 | Crit | RESOLVED | §3 ¶1: scoping "enforced by the RPC SQL explicitly — NOT by RLS" (old claim deleted). `user_has_store_access` on by-id (§3 ¶2, cross-store → `not_found`, "uniform rule on ALL paths, including QR-by-id"), on by-number + product/variation (§3 ¶3, "every candidate store-scoped"), uniform server-side exclusion → `not_found` (§3 ¶4). One clarity residue → Minor M3. |
| A2 | Crit | RESOLVED | §5 M4.3: "Phase 3 opens with a verify-then-extract task", extraction "move listed in §6", hub-native F8-replica fallback defined; §6 "Phase 3 (conditional)" line; §7 P3 repeats it. |
| A3 | Des | RESOLVED | §5 M2.4: one explicit reading (verify once during P3 planning, before picker ships), own changeset, v1 picker excludes `returned`/`cancelled`; echoed §7 P3 + test 5. Two wording residues → Minor M1/M2. |
| A4 | Des | RESOLVED | No offline/persisted queue anywhere; §5 queue is in-session only ("Failed resolve (network) → row held with retry icon" — no storage/persistence claim). |
| A5 | Des | RESOLVED | §3 ¶3: product `candidates[]` "mirrors orders; stock mode shows a pick-one card — never silent first-match". POS-path residue → Minor M4. |
| A6 | Des | RESOLVED | §5 M3.1: `[−1][+1]` "mutate the scan count", typed delta "overrides the count", "commit uses the final value"; test 6 consistent (×2 → +2 on commit). |
| A7 | Des | RESOLVED | §6 Deps: `@zxing/browser` "(Phase 2 — installed with the camera work, lazy-scoped)", post-build grep bars it from the main chunk; §7 P2 is the camera phase. Matches F13. |
| A8 | Min | RESOLVED | §4 Orders ¶2: "Wedge subscription pauses while this modal is open"; §4 POS ¶3 same; test 9. |
| A9 | Min | RESOLVED | §5 focus caveat states the exact F1 rule (ignores INPUT/TEXTAREA without `data-barcodeEnabled`), names the swallowing hub inputs, adds scan-hint + dedicated capture-input fallback. |
| A10 | Min | RESOLVED | §3 migration: "verify-item: btree on `products.barcode` AND `products.sku` if absent"; §6 repeats. Matches F14 (index status UNKNOWN). |
| A11 | Min | RESOLVED | §5 queue: order modes "dedupe-to-one with a 'scanned again' flash", stock ×N; test 4 covers re-scan in dispatch/status/return + re-scan dispatched → ⚠ "already dispatched". |

11/11 resolved (0 partial, 0 unresolved).

## Critical Issues

None.

## Design Concerns

- **D1 — Mixed multi-store match resolves silently (§3 ¶4).** The exclusion rule ("out-of-scope candidates are excluded server-side, uniformly") combined with "a single out-of-scope candidate → `not_found`" implies exclude-then-count: two orders share a number, one in-scope + one cross-store → resolves silently to the in-scope order. That is coherent with "resolve_scan answers 'what can I act on'", but it is derivable rather than stated, and untested — test 3 covers only the single-match cross-store case and the all-in-scope ambiguous case. State the mixed case in §3 and add a test row.
- **D2 — Hub row fetch leans on resolve_scan for scoping (§5 M1.4).** The commit-path `orders.select()` by ids is fed only in-scope ids from resolve_scan, but the underlying orders SELECT is all-authenticated app-wide (F16 — a pre-existing posture, not introduced by this plan). Optional defense-in-depth: scope the fetch, or add one line noting the reliance. Non-blocking.

## Minor Issues

- **M1 — M2.4 says "its own timestamped migration," but LOCALLY_ADVANCED is TS code (F9: `woo-webhook/index.ts:392-395`, `woo-sync/index.ts:703-706`).** Extending the guard set is a code change + changelog line, not a SQL migration — there is no DB artifact to migrate. Reword to "extend the guard set in woo-webhook/woo-sync (one changeset + changelog line)". Inherited from A3's own phrasing; must fix wording before implementation (~5 min). The same sentence cites the correct `.ts` locations, so practical risk is low.
- **M2 — M2.4 picker-exclusion ambiguity.** "If absent: extend … AND exclude `returned`/`cancelled`" reads conditional, but the rationale "(terminal states, set individually)" reads unconditional, and test 5 ("before they're selectable") implies they may become selectable after verification. State which: exclusion only in the absent branch, or unconditional v1 exclusion.
- **M3 — §3 ¶3 variation scoping mechanism not spelled out.** Variation candidates join `product_variations` → `products`; add one clause that scoping inherits the parent `products.store_id` (A1's requirement is stated at the summary level; the join detail is not).
- **M4 — POS camera path bypasses resolve_scan (§4 POS ¶2).** Raw goes to the existing handler (F1), which does its own matching. Unspecified: (a) who detects `dks1:O` in that path (the handler would barcode/sku-match the literal string and fail — the plan promises a toast); (b) behavior on an ambiguous product code (inherits current first-match semantics, which §3's "never silent first-match" does not govern since POS never calls resolve_scan). One clause fixes both; alternatively route the POS camera through resolve_scan.
- **M5 — Test 7 wording + §6 Edited list.** Test 7 names "sequential ReturnDialog" — under the fallback path the component is the hub-native form (the assertions — `pos_returns` rows, timeline, gated restock, status unchanged — hold either way; reword to "return form (extracted or fallback)"). §6 Edited omits the conditional POS re-import when ReturnDialog is extracted (the "Phase 3 (conditional)" line covers the move, not the re-point).

## Verified Correct

- §3 role gate is fail-first (`has_role` admin/staff → else `forbidden`, "no existence oracle") — matches F14; test 3 checks viewer → forbidden before any resolution.
- §5 M1 gate mirrors the app exactly (`ready_to_ship && !consignment_id`, F4); client guard labeled "UX warning only" with server idempotency correctly attributed to `create_bulk`'s existing-consignment skip (F5) — no false-protection claim.
- M1.4 full-row fetch matches F3 (DispatchDialog needs `pathao_recipient_city/zone/area` + customer fields); M1.5 correctly decouples from the Orders page's loaded slice (F4 bulk-bar caveat).
- M2.2 picker vocabulary matches F6's 10 statuses verbatim; M2.3 commit matches F12 exactly (`orders.update` + timeline + `logAction` + `kickSyncWorker`).
- M3.2/M3.3: global-stock-only matches F7 (no per-store stock anywhere); gating `globalStockEnabled || manage_stock` matches the F8 restock condition; untracked rows surfaced, not silent.
- M3.4: reuses the `update`/`product` audit verb (F7 pattern, no invented verb); read-modify-write race acknowledged — same pattern as ProductDetailSheet today.
- M4.2/M4.3: no status change (F8: POS returns never touch `orders.status`); fallback replicates F8's commit exactly (`pos_returns` + `return_processed` + `logAction('create','pos_return')` + gated restock); live-consignment ⚠ consistent with no Pathao return action (F8); test 7's delivered-order choice coherently dodges M4.1's courier-return warning.
- §4 POS camera reuses the async callback shape (F15 — modal-callable); suppression rule shared consistently across Orders/POS/hub (§4 ¶2–3, §5, test 9).
- §6 deps Phase 2 + main-chunk grep aligns F13 (`@zxing/browser` not installed, zero `getUserMedia`); §1 "Net-new only" list matches.
- §1 slip citations match F11 (`show_barcode` / `show_order_number` gates; measurement slip text-only today → §2's "first-ever code"); `SlipOrderData` gains a typed `id`, killing the any-cast (F11).
- §2 payload grammar/parser kinds and camera 1D+QR decode are internally consistent; legacy CODE128 via camera covered in test 2.
- No material test-list vs body mismatch beyond M5's component name; §7 phases cover every artifact §6 lists; §9 assumptions restate §4/§5 decisions without drift.

## Verdict

**CONVERGED — implementation-ready.** All 11 round-2 amendments verified resolved; no new criticals introduced by v3.

Non-blocking amendments (~20 min total):
1. **M1 (must-fix wording):** M2.4 "timestamped migration" → code change to LOCALLY_ADVANCED in woo-webhook/woo-sync + changelog.
2. **M2:** state whether v1 picker exclusion of `returned`/`cancelled` is conditional (absent branch) or unconditional.
3. **M3:** one clause — variation candidates scope via parent `products.store_id`.
4. **M4:** one clause — POS-camera `dks1:O` detection point + ambiguous-product behavior.
5. **M5:** reword test 7; note the conditional ReturnDialog re-import in §6.
6. **D1/D2 (optional):** mixed-match test row; note the hub fetch's scoping reliance.
