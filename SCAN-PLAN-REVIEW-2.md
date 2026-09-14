# SCAN-PLAN-REVIEW-2 — Plan Critic, Round 2

> Input: `QR-SCAN-IMPLEMENTATION-PLAN.md` (v2, 157 lines). Round-1 baseline: 7 critical / 6 design / 2 minor.
> Method: verify all 15 round-1 amendments against the fact sheet, then hunt v2-introduced issues.
> Notation: `M2.2` = §5 Mode 2, list item 2.
> **Verdict up front: NOT CONVERGED — 2 surgical amendments required (A1 security, A2 feasibility), then implementation-ready.** 13/15 round-1 fixes fully landed, 2 partial, 0 unresolved. No architecture change needed.

## Round-1 Fix Verification

| # | Round-1 amendment | Verdict | Evidence (v2) |
|---|---|---|---|
| 1 | [Crit] 10-item picker, no on_hold | **RESOLVED** | M2.2 lists all ten F6 statuses verbatim incl. `pending`, `pre_order_pending`; `on_hold` absent |
| 2 | [Crit] Stock = global qty only, gating, no "current store" | **RESOLVED** | M3.2–3: `products`/`product_variations.stock_quantity` only; gate `globalStockEnabled OR manage_stock===true` = F7/F8 condition; "No per-store stock exists" |
| 3 | [Crit] Dispatch fetches full rows pre-dialog | **RESOLVED** | M1.4: one select by scanned ids, every `DispatchOrder` field incl. `pathao_recipient_city/zone/area` (F3); M1.5 fetch-by-id never depends on Orders-page loaded slice (F4) |
| 4 | [Crit] Gate = ready_to_ship AND !consignment_id; server idempotency is the guarantee | **RESOLVED** | M1.2 exact F4 gate; M1.3 "UX warning only", real guarantee = `create_bulk` skip (F5) — no overclaim |
| 5 | [Crit] Return: no status change, POS semantics | **RESOLVED** | M4.2 + §9.1: F8 semantics (pos_returns + `return_processed` timeline + audit), status never touched |
| 6 | [Crit] Echo-guard verify = blocking phase task | **RESOLVED** | M2.4: blocking "before these two are selectable"; confirmed-member list matches F9 exactly. Wording defects → D1 |
| 7 | [Crit] Resolve RPC: role-first, both-candidates, cross-store→not_found, INVOKER | **PARTIAL** | All structural elements present (§3.1–4) BUT the scoping mechanism is mis-specified — "RLS does store scoping" is false (orders SELECT RLS = all-authenticated, not store-scoped) → **Critical C1** |
| 8 | [Des] Per-mode permission gates | **RESOLVED** | §5: M1 `orders.change_status`+canWrite, M2 `orders.change_status`, M3 `products.edit`, M4 `pos.use`+parity; test 10 negative case (F10 `anyOf`) |
| 9 | [Des] allowedKinds; POS ignores dks1:O; Orders ignores products | **RESOLVED** | §4 O.2/P.2 + §6 CameraModal `{allowedKinds}` prop; cross-context toasts; tests 2, 10 |
| 10 | [Des] Typed `SlipOrderData.id`; two-code layout | **RESOLVED** | §6: typed id kills the any-cast (F11); measurement contract gains it; invoice/pickup "second code beside CODE128"; test 8 |
| 11 | [Des] Per-mode dedupe (orders→one, stock ×N) | **PARTIAL** | §5 queue promises "Dedupe rules per mode (below)" but only stock states one (×N, M3.1); no order mode states dedupe-to-one; no re-scan test → A11 |
| 12 | [Des] Return commit shape picked, with reasons | **RESOLVED** | M4.3 shape (a) sequential ReturnDialog; reasons given (per-item qty, refund method/amount, POS audit trail); §9.1 restates. New wiring gap → **Critical C2** |
| 13 | [Des] Print regression, all 3 slips | **RESOLVED** | §7 P4 ship line + test 8 (80mm + A4, vector size, curled-paper QR) |
| 14 | [Min] Scan-to-find cleanup | **RESOLVED** | §4 O.1 clear input + cancel debounce; O.4 typed fallback for text-only measurement slips (F11); P.3 wedge suppression; tests 1, 9. Orders-modal gap → M1 |
| 15 | [Min] Index verify, timestamp migration, reuse audit verb | **RESOLVED** | §3 `20260910120000_scan_resolve.sql` (order_number btree per F14, products.barcode verify-item); M3.4 reuses `update`/`product` verb (F7) |

Score: 13 RESOLVED · 2 PARTIAL · 0 NOT RESOLVED.

## Critical Issues

### C1. Resolve RPC store-scoping rests on a false RLS claim (residual from amendment 7 — its own prescription said "INVOKER + RLS", and v2 inherited the flaw)

§3 header (line 49): "SECURITY INVOKER (read-only; **RLS does store scoping** — no DEFINER bypass for a read)". §3.3 (line 55): "**RLS applies store scoping implicitly**; caller's `user_store_access` filters multi-row hits".

Orders SELECT RLS is **all-authenticated** — store scoping is NOT in RLS (fact sheet, F14 context). Under SECURITY INVOKER:

- `order_number = raw` returns **every store's** matches, not the caller's stores'.
- The QR by-id lookup (§3.2) has no store check anywhere — the "cross-store → not_found" rule (§3.4, test 3) has no mechanism on the id path. A cross-store UUID would resolve and return that order's summary.
- "Caller's user_store_access filters multi-row hits" names no location. If it means client-side, it contradicts §3.4 ("excluded **server-side** — not returned") and test 3's no-oracle claim — cross-store order summaries would flow to any staff user. If it means RPC SQL, the plan never says so and instead credits RLS.

The fix's ingredients exist and are even cited in §1 ("SQL helpers `user_has_store_access`… **resolve RPC scoping**") — §3 just never wires them in.

**Fix (A1):** the RPC SQL explicitly filters **every** candidate — order-by-id, order-by-number, product, variation — through `user_has_store_access(store_id)` / `user_store_access` (F14); delete both RLS-scoping claims; state cross-store → `not_found` uniformly across all lookup paths. Two lines of plan text; otherwise the migration ships an RPC that leaks cross-store data on day one.

### C2. Mode 4 commits to reusing POS's ReturnDialog without saying how, or verifying it can take a scanned order

M4.3 (line 110): "Commit = sequential ReturnDialog per scanned order… the hub pre-fills the order number so it's one confirm per order."

Three unspecified load-bearing details:

1. **No reuse path.** ReturnDialog is a POS component (F8 context). §6's new/edited file lists omit it entirely — no extraction, no move, no import strategy. If it's coupled to POS page state (cart/register/cashier context), "import and pre-fill" doesn't exist as an operation.
2. **Input contract unverified.** F8 describes the commit (pos_returns insert, items[], refund fields) but not the props. The plan asserts the dialog accepts a scanned **Woo order** and offers per-item return quantities — items source, refund-method applicability, and restock inputs are POS-flow-shaped and un-evidenced.
3. **Estimate exposure.** If extraction is real work, Phase 3's 1½ days (three modes + echo-guard + this) breaks.

**Fix (A2):** Phase 3's first task becomes "verify ReturnDialog's input contract against a scanned order (items source, refund fields); extract to a shared component and list the move in §6". Name the fallback: a hub-native minimal return form replicating F8's commit exactly (pos_returns row + `return_processed` timeline + `logAction('create','pos_return')` + gated restock, no status change). If the contract verifies, the mode stays as planned.

## Design Concerns

- **D1. Echo-guard item is self-contradictory and mistimed (M2.4, line 99).**
  - (a) "If absent → ship the picker without them **and** add them to the guard set" reads as both at once. Write the intended reading explicitly. The coherent conservative reading: extend `LOCALLY_ADVANCED` (so returned/cancelled echo correctly in existing flows) but still don't offer them as bulk targets in v1 — but say that.
  - (b) "Phase-1 task, not a footnote" vs §7, which ships the picker + "echo-guard verify" in **Phase 3**. Verify-early/ship-later is fine — state it.
  - (c) If the guard set IS extended inside the Phase-1 `scan_resolve` migration, that changes **existing** single-order sync behavior (returned/cancelled begin echoing to Woo on deploy). Own migration + changelog line, not a rider inside a scan-RPC migration.
- **D2. Offline queue is unphased, untested scope creep (§5, line 86).** "Offline = red banner, scans queue locally in-session, retried on reconnect" appears in no §7 phase and no §8 test. The per-row retry + toast already covers failed resolves. Cut from v1, or assign Phase 4 + a test.
- **D3. Product-side ambiguity undefined (§3.5, line 59).** Orders get `ambiguous.candidates[]` + chips (§4 O.3); a bare code matching two products (or product + variation) has no candidates path — the return shape holds a single `product?{…}`. Stock mode would silently pick one row. Define product `candidates[]` (mirror orders) or document first-match and its risk.
- **D4. Stock row has two competing inputs (M3.1, line 102).** `[−1][+1]` adjusters AND a typed delta field both edit the same quantity; merge rule unstated (typed overrides ×N, or adds?). Recommend: adjusters mutate scan count; typed field overrides; commit uses the final value. (The ×N-then-fix-to-+1 flow itself is coherent — test 6's ×2→+2 with adjusters works.)
- **D5. Dependency phase contradiction (§6, line 122).** "`@zxing/browser` (Phase 1, lazy-scoped…)" — §7 ships all camera work in Phase 2 and Phase 1's ship list contains no camera. Label it Phase 2.

## Minor Issues

- **M1.** Orders-page wedge suppression while its own CameraModal is open is unstated (§4 O.2) — POS (P.3) and hub (§5) have the rule; without it one scan double-fires (wedge + camera both resolve → double navigation). CameraModal itself has no text inputs, so the conflict is the wedge, not modal focus.
- **M2.** "Wedge works page-wide (hook is a page-global keydown)" (§5, line 84) vs F1: the hook ignores INPUT/TEXTAREA unless `data-barcodeEnabled`. Hub manual-entry and typed-delta inputs will swallow scans while focused — add a capture input (POS pattern) or note the focus caveat.
- **M3.** Migration verify-item covers `products.barcode` only (F14); the resolve lookup is `barcode OR sku` — extend the verify to `products.sku`.
- **M4.** Stock commit computes `current + delta` from the scan-time snapshot (M3.4) — read-modify-write with a stale base. Same pattern as F7's ProductDetailSheet, so inherited not new; one acknowledging line about the concurrent-adjust race.
- **M5.** Test gaps: no order re-scan/dedupe test (amendment 11), no offline test if D2 survives.

## Verified Correct

- **Dispatch full-row fetch is consistent with F3/F4**: `pathao_recipient_city/zone/area` are order-row columns; one select by scanned ids (M1.4) bypasses the unfiltered-bulk-bar/loaded-slice problem F4 describes (M1.5).
- **Idempotency honesty** (M1.3): client gate = UX warning, server `create_bulk` skip (F5) = guarantee. Correctly attributed, not overclaimed.
- **Mode 2** = exact F6 vocabulary; commit = F12 pattern (update + timeline + logAction + kickSyncWorker).
- **Mode 3** = single global quantity (F7), F8-parity gating, existing audit verb reused — no invented `stock_adjust`.
- **Mode 4** = F8 semantics, no status change, live consignments ⚠ (F5-tracking-aware), variation-restock limitation inherited and documented (M4.4).
- **POS camera parity** = the F15 async callback shape is the stated integration (§4 P.2) — callable from a modal, as F15 confirms.
- **Honest net-new list** vs F13: no /scan route, no getUserMedia, @zxing/browser absent — all declared net-new.
- **Requirements coverage**: R1 no new status (lands in existing pickup_pending via F5 tracking); R2 both search bars + all three slips scannable (measurement: QR in P2, typed fallback in P1 — covers the F11 text-only gap); R3 four batch modes with review-before-commit; R4 wedge + camera.
- **Multi-store order_number collisions** (F14: no uniqueness) → server-side candidates + chips (§4 O.3) — contingent on A1 landing.
- **Estimates** (4½ days): plausible for Phases 1/2/4; Phase 3 conditional on C2's verification outcome.

## Verdict

**NOT CONVERGED — one more pass.** All round-1 fixes landed structurally, but amendment 7's own prescription ("INVOKER + RLS") carried a false premise that v2 inherited (C1), and the return-mode revision surfaced an unspecified component reuse (C2). Both are plan-text fixes measured in lines, not architecture. Apply A1+A2 and the plan is implementation-ready; A3–A7 and the minors ride along as non-blocking.

| # | Severity | Amendment (round 3) | Where |
|---|---|---|---|
| A1 | Critical | RPC SQL filters every candidate (by-id, by-number, product, variation) via `user_has_store_access`/`user_store_access` (F14); delete both "RLS does store scoping" claims; cross-store → `not_found` on ALL lookup paths incl. QR-by-id | §3 |
| A2 | Critical | Phase 3 opens with ReturnDialog contract verification (scanned Woo order: items source, refund fields); extraction named in §6; fallback = hub-native form replicating F8 commit exactly | §5 M4, §6, §7 |
| A3 | Design | Rewrite M2.4 to one explicit reading; fix P1-verify/P3-ship timing; echo-guard extension gets its own timestamped migration + changelog note | §5 M2.4, §7 |
| A4 | Design | Cut the offline queue from v1 (or phase + test it) | §5 |
| A5 | Design | Define product-ambiguity behavior (candidates[] or documented first-match) | §3, §5 M3 |
| A6 | Design | Stock merge rule: adjusters mutate count, typed delta overrides, commit uses final value | §5 M3.1 |
| A7 | Design | `@zxing/browser` → Phase 2 | §6 |
| A8 | Minor | Orders-page wedge suppression while its CameraModal is open | §4 O.2 |
| A9 | Minor | Hub scan-capture input / focus caveat (F1 input-ignoring) | §5 |
| A10 | Minor | Extend index verify-item to `products.sku` | §3 |
| A11 | Minor | State order-mode dedupe-to-one explicitly in §5 + add a re-scan test | §5, §8 |
