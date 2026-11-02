# Scan Plan Review — Round 1 (PLAN CRITIC)

Reviewed: `QR-SCAN-IMPLEMENTATION-PLAN.md` (FINAL v1, 134 lines) against the pre-verified fact sheet (F1–F15) and user requirements (R1–R4). No codebase files were opened.

---

## Requirement Coverage

| Req | Verdict | Notes |
|---|---|---|
| R1 — No new order status; Pickup = existing Pathao flow | **PARTIAL** | The header promise (plan:3-5) is correct and dispatch lands in `pickup_pending` via consignment (F5). But Change-status mode offers `on_hold` (plan:80) which is **not in the app vocabulary** (F6) — selecting it writes a status value no select, tab, or echo guard knows. That is a new status introduced through the back door. R1 is violated unless the vocabulary is corrected (Critical #1). |
| R2 — Scan-to-find in Orders + POS search bars; documents exist & are scannable | **MET (phased)** | Orders input lacks `data-barcodeEnabled` today (F2); plan adds it + camera (plan:59-64). POS wedge already works (F15); camera button adds parity. Invoice/pickup CODE128 exist (F11) → scannable day one. Caveats: measurement slips scannable only from Phase 2, and **legacy measurement slips in circulation never become scannable** (text-only, F11) — plan never states the manual-entry fallback for them (Minor #14). |
| R3 — Scan hub, 4 modes, batch-list + commit | **PARTIAL** | All four modes structurally present (§5), but four carry material defects: dispatch data flow is incomplete (Critical #3), dispatch gating conflicts with the app's (Critical #4), change-status vocabulary is wrong (Critical #1), stock semantics describe a data model that doesn't exist (Critical #2), and return mode invents unrequested status behavior (Critical #5). |
| R4 — Desktop wedge / mobile camera | **MET** | Consistent throughout (plan:9, §4, §6); `@zxing/browser` correctly identified as new (F13). |

---

## Critical Issues

### C1. Change-status vocabulary is wrong — `on_hold` doesn't exist; two real statuses omitted
Plan:80 lists: `processing / ready_to_ship / pre_order_making / pre_order_ready / shipped / delivered / returned / on_hold / cancelled`.

Per F6 the app's status select vocabulary is exactly 10 items: **pending, processing, pre_order_pending, pre_order_making, pre_order_ready, ready_to_ship, shipped, delivered, returned, cancelled**.

- `on_hold` is not among them (F6). Setting it via bulk update (F12 pattern writes raw strings) puts orders into a state the detail sheet can't display, tabs can't filter, and Woo echo guards don't protect (F9 set: processing/pre_order_*/ready_to_ship/shipped/delivered). This is a silent R1 violation.
- `pending` and `pre_order_pending` are missing from the plan's list with no stated reason for excluding them.

**Required fix:** the picker must be generated from the same 10-item set as `OrderDetailSheet.tsx:1946-1962` (F6). If the team wants to exclude some statuses from the scan flow (e.g. `pending`), that exclusion must be an explicit, documented subset — not a mutated vocabulary.

### C2. Stock mode "adjusts the store's stock" — per-store stock does not exist
Plan:87: *"else adjusts the store's stock for the current store context"*; Assumption 2 (plan:133) repeats it: *"otherwise current store"*.

Per F7 the stock model is a **single global `products.stock_quantity`** (+ per-variation `stock_quantity`), with a **global** `stockSettings` toggle whose semantics are: OFF → only `manage_stock === true` products are tracked, others treated as unlimited; ON → normal tracking. `product_locations` exists but **no UI writes it** — there is no per-store stock anywhere in the application.

**Required fix:** stock mode always adjusts `products.stock_quantity` / variation stock. The global toggle decides *whether the adjustment is meaningful* (untracked product → no-op or a ⚠ "not stock-tracked" row), and the restock/update path must be gated by the same `globalStockEnabled || manage_stock` condition the POS return flow uses (F8). Delete "current store" from plan:87 and plan:133 — as written it instructs an implementation against a nonexistent data path.

### C3. Dispatch commit: resolve summaries cannot feed `DispatchDialog`
Plan:74: *"opens the existing `DispatchDialog` with `orders={scannedOrders}`"*.

Per F3, `DispatchDialog` requires **full `DispatchOrder` objects** including `pathao_recipient_city/zone/area` (nullable) and complete customer fields — these drive the per-order overrides and city/zone/area autofill. The plan's resolve RPC (plan:51) returns only `{id, order_number, status, store_id, customer_name, consignment_id}` — a summary. Passing summaries would break the dialog at compile time at best and silently at worst.

Also per F4, the existing `openDispatch(ids)` filters **full rows from the currently-loaded orders array** — scanned orders may not be on the loaded page at all, so "reuse what's loaded" is not an option either.

**Required fix:** the commit step must re-fetch full order rows (every field `DispatchOrder` requires, F3) by the scanned ids before invoking the dialog — an explicit `select` of complete rows, not the resolve payload and not the page's loaded slice. This fetch step must appear in the plan (§5 Mode 1) and in the Phase 1 ship line, since Phase 1 already ships dispatch (plan:110).

### C4. Dispatch gating conflicts with the app's existing gating
Plan:75 makes `processing`, `pre_order_ready`, and `ready_to_ship` dispatchable. Per F4, the app's dispatch action appears **only** when `status === "ready_to_ship" && !consignment_id` — `processing` and `pre_order_ready` orders are not dispatchable anywhere in the current UI.

The scan hub would become the only place in the product where a `processing` order can be dispatched — two doorways to the same mutation with different rules. That's a consistency defect and an operational risk (dispatching orders the store has not marked ready).

**Required fix for v1:** match existing gating exactly — dispatchable = `ready_to_ship && !consignment_id`; everything else (including `processing`, `pre_order_ready`) renders as a ⚠ non-dispatchable row. If the user explicitly wants the broader set, that must be a confirmed user decision recorded in the plan's assumptions, not a silent default.

On the plan's redundant guard: F5 shows `create_bulk` already skips orders with an existing `consignment_id` (server-side idempotency). The plan's client-side guard is therefore **UX value (warn before commit), not correctness** — fine to keep, but it must not be described as protection; the plan currently implies both without noting which layer actually guarantees it. No contradiction, just misattribution.

### C5. Request-return mode invents a status change the app never makes — and the user didn't ask for
Plan:92: *"per order set `status='returned'` + timeline + audit (+ restock)"*; Assumption 1 (plan:132) confirms it.

Per F8, the app's **only** existing return flow (POS `ReturnDialog`) inserts `pos_returns`, optionally restocks (gated by `globalStockEnabled || manage_stock`), inserts an `order_timeline` event, and logs `pos_return` — it **never** touches `orders.status`. There is no Pathao return-request action (F8). The user's requirement for this mode was "same batch-list pattern" — batch, review, commit. A bulk `status='returned'` write is new behavior nobody requested, and it additionally collides with:
- the Woo echo guards — `returned`'s membership in `LOCALLY_ADVANCED` is **unverified** (F9 lists only processing/pre_order_*/ready_to_ship/shipped/delivered), so a webhook could revert locally-set `returned` (see C6);
- downstream consumers that treat `returned` as a terminal, human-confirmed state.

**Required fix (v1):** Request-return mode = batch **`pos_returns` inserts** reusing the ReturnDialog commit semantics (F8: return_number `RET-<base36>`, items, reason, refund fields, restock flag with the same stock gate) + timeline event `return_processed` + `logAction('create','pos_return')`, with **no status change**. Two acceptable shapes, plan must pick one:
- (a) sequential: commit opens the existing `ReturnDialog` once per scanned order (preserves per-item selection, refund method/amount — these are per-order decisions that do not batch);
- (b) batch: single commit inserts one `pos_returns` row per order with full-quantity restock and a default reason — cheaper but loses refund/reason capture (see Design D5).
Keep the ⚠ live-consignment handling (plan:92) — that part is sound.

### C6. `returned` / `cancelled` bulk targets vs Woo echo guards — unverified before ship
Plan:123 hedges: *"statuses already in `LOCALLY_ADVANCED`… or documented where not"*. Per F9 the confirmed membership is processing/pre_order_*/ready_to_ship/shipped/delivered. **`returned` and `cancelled` are not confirmed members.** If Change-status mode (and the old return design) writes `returned` on a Woo-linked order and a webhook fires, the locally-set status can be clobbered — exactly the class of bug F9's guards exist to prevent.

**Required fix:** before any bulk target beyond the confirmed set ships, verify `returned`/`cancelled` membership in `woo-webhook/index.ts:392-395` and `woo-sync/index.ts:703-706`; if absent, either add them deliberately (with the same reasoning as the existing members) or exclude them from the scan picker. The plan must name this as a blocking verify item, not a footnote. Note this issue survives Critical #5: even without return-mode status writes, the *Change-status* picker still offers `returned`/`cancelled` (plan:80).

### C7. Resolve RPC — three defects in one section
Plan §3 (plan:44-53):

1. **SECURITY DEFINER for a read.** App precedent is client reads via Supabase under RLS; RPCs are used for mutations. A `SECURITY DEFINER` resolve bypasses RLS and must re-implement store scoping (the plan does via `user_has_store_access`, which exists — F14 — so it's *workable*, but it widens the audit surface for zero gain on a pure read). Either downgrade to `SECURITY INVOKER` (RLS does the scoping for free) or justify DEFINER in the plan.
2. **Order-vs-product precedence collision is unacknowledged.** The plan's fallback is ORDER → PRODUCT (plan:49). A bare code like `3001` can legitimately be both an `order_number` and a product `barcode`. Order-first silently hides the product; the plan never states the rule or the collision. Required: either return **both** candidates in one result (`{order?, product?, ambiguous?}`) and let the context decide, or define explicit precedence *and* say so in §3. Context default: Orders search ignores product candidates, POS ignores order candidates — but the payload contract must support both.
3. **Role check runs after resolution** (plan:50, step 3). Fail-fast and information-disclosure both argue the role check goes first — no reason to resolve anything for a viewer, and returning `ambiguous`/`not_found` before `forbidden` turns the RPC into a cross-store existence oracle (plan Phase 4 mentions "RLS/scope oracles" but never resolves this one). Also decide: cross-store single candidate → `not_found` (no oracle) or `forbidden` (test 3, plan:121, expects `forbidden` — pick one and make §3 and test 3 agree).

---

## Design Concerns

### D1. Permission gating is per-hub, must be per-mode
Plan:68 gates the entire hub on `orders.change_status`. Wrong by mode (F10):
- **Stock update** mutates `products.stock_quantity` → `products.edit` (F10:119), not `orders.change_status`.
- **Request return** mirrors the POS return flow (`pos_returns` + `logAction('create','pos_return')`, F8) → `pos.use` (F10:128) or an orders permission — must be decided, not defaulted.
- **Dispatch** — the existing row action requires `canWrite` (F4); the exact permission behind it should be verified and reused.
- **Change status** → `orders.change_status` (F10:91) ✓.

`PermissionGuard` supports `anyOf` (F10:12-17) — use per-mode gates (route-level guard for the hub page + per-mode gates on mode entry/commit). As written, a user with only `orders.change_status` could adjust stock. Test 10 (plan:128) only checks a viewer — it would pass while the real hole stays open.

### D2. Dedupe semantics contradict themselves between §5 and the test list
Plan:70: *"duplicates merge with ×2"* (stated as a property of the shared queue). Plan:124 (test 6): *"stock rows don't merge"*. Which is it? Required per-mode rules, stated once:
- **Order modes (dispatch/status/return):** duplicate scan of the same order should **dedupe to one** with a "scanned again" flash — a ×2 badge on an order is meaningless (you cannot dispatch or return one order twice; F5's idempotency makes the second attempt a silent skip).
- **Stock mode:** duplicates **accumulate** (×N = +N on commit) — this matches R3's "increment by 1" per scan.
The shared-queue line (plan:70) must be scoped to stock mode only.

### D3. POS camera will decode order payloads it cannot use
Plan:64 pipes `CameraModal` into POS `handleBarcodeScan` — mechanically correct (F15: the handler is an async callback a modal can call). But the camera decodes **any** code in frame, including `dks1:O:<uuid>` from a pickup slip lying on the counter. POS's handler is product-oriented (F1) — an order QR would hit product/sku lookup and fail confusingly. Required: `CameraModal` takes an allowed-kinds filter; POS passes product-only (ignore `dks1:O` with a toast "order code — not in POS"), Orders passes order-only (ignore product barcodes or offer "search products anyway"). The plan is silent on both.

### D4. `SlipOrderData.id` plumbing is missing — the pickup-slip QR can't be built without it
F11: `SlipOrderData` (pickupSlipHtml.ts:5-14) **lacks `id`**; runtime carries it via any-casts. The `dks1:O:<uuid>` QR (plan:36) needs the order uuid inside the slip renderer. The plan's §6 edits slips for QR (plan:100) but never adds `id` to the slip data contract. Required: add `id` (typed, killing the any-cast) to `SlipOrderData` and the measurement-slip data — otherwise Phase 2's QR lands on an any-cast workaround. Also unstated: invoice + pickup slip will now print **two codes** (existing CODE128 + new QR, plan:20-21) — layout/regression implications for both, not just the measurement slip (see D6).

### D5. Batch-return commit fields have no source
`pos_returns` rows in the existing flow carry reason, refund_amount, refund_method, items (F8:108-167) — per-order, human-entered values. The plan's batch commit (plan:89-92) captures only a restock toggle. If Critical #5's option (b) is chosen, the plan must define defaults (`reason: "scan-batch return"`, refund fields null/`refund_method: 'none'`?) or the insert is underspecified. Option (a) (sequential ReturnDialog per order) avoids this entirely — recommend (a) for v1 despite more clicks, since it preserves the audit and refund trail.

### D6. Print regression scope is too narrow
Phase 4 hardening mentions thermal + A4 regression (plan:113) but test 8 covers only the **measurement** slip (plan:126). Invoice and pickup slip layouts also change (second code added, D4). Both need explicit regression entries: 80mm thermal width, vector-only rendering (plan's "no raster bloat" concern is right), and scannability at print size. Test 8 as written would pass while invoice/pickup prints break.

### D7. Scan-to-find side effects on the search input
With `data-barcodeEnabled` on the Orders input (plan:60), the wedge's keystrokes land in the input (that's how the opt-in works, F1) and the debounced search (F2, Orders.tsx:125) fires on the scanned string before/while the deep link opens. Required: on scan, clear the input and cancel the pending debounce (or suppress it), so the list behind the detail sheet isn't filtered to junk. Same cleanup applies after `CameraModal` resolve. POS presumably already handles this in its handler (F1) — Orders needs the same.

### D8. Wedge + camera concurrently on the hub
The wedge hook is a page-global keydown (works on `/scan`, per checklist note) and the hub also hosts `CameraModal`. A gun scan while the modal is open double-adds. Required: pause/suppress the wedge subscription while the modal is mounted. Also: stock-mode delta inputs are INPUTs without `data-barcodeEnabled`, so wedge scans while a delta field is focused are silently ignored (F1) — correct behavior, but worth one UX line (focus hint) so users don't think scanning died.

### D9. Phase 1 ships dispatch with the unresolved data-flow of Critical #3
Plan:110 ships "hub skeleton (Dispatch via existing dialog)" on day 1 — but the full-row fetch (C3) and gating decision (C4) aren't in the plan. Phase 1 as scoped will either ship broken dispatch or discover C3 mid-phase. Fold C3/C4 into Phase 1's ship line.

---

## Minor Issues

1. Plan:18 cites `useBarcodeScanner.ts:1-57` — it's 56 lines (F1). Trivial.
2. **Offline/failure queueing:** a failed resolve (network) on a wedge scan in the hub drops the scan silently; the queue should hold raw payloads and retry, or at least toast. Unaddressed.
3. **`products.barcode` index:** resolve's product fallback queries by barcode/sku (plan:49); whether `products.barcode` has an index is unverified (F14 is silent). Add as a verify item — a seq scan per fallback is fine at current scale but should be a conscious choice.
4. **Migration naming:** repo migrations are timestamp-named (e.g. 20260414203754, F8/F14); plan §6 just says "migration". Name it per convention.
5. **Audit verb consistency:** plan invents `stock_adjust` (plan:86); the existing precedent is the `products.edit` flow with `logAction` (F7). Reuse the existing verb/category or justify a new one — a new verb means a new audit-filter surface.
6. **Manual-entry fallback in search bars:** Phase 1 ships "manual-entry hub MVP" (plan:110) but manual order-number entry in the *Orders search bar* scan context (for legacy text-only measurement slips, F11) isn't mentioned — the deep link path needs a typed fallback too.
7. **`on_hold` also in Assumptions?** No — but Assumption 1 (plan:132) states the return-status decision as already-answered ("✔?") when it's the exact behavior F8 contradicts. Assumptions should be open questions until round 2 amends them.
8. **Tap-row-to-remove (plan:70)** on mobile order rows is accident-prone (a tap during review deletes the row); explicit × per row is safer. Cosmetic.
9. **Camera on old prints:** zxing decodes 1D CODE128 too, so the camera path works on legacy invoice/pickup barcodes day one — worth one line in §4 so readers don't assume camera == QR-only.
10. **Time estimates:** 1+1+1+½ days is thin once C3/C4/C5/C6 land (dispatch fetch layer, return-mode redesign, guard verification). Expect Phase 1 and 3 to grow ~½ day each.

---

## Verified Correct

- **R1 architecture:** no new status in the dispatch path; dispatch → `create_bulk` → `status='shipped'` + `tracking_status='Pickup Pending'` → `pickup_pending` tab (plan:5, plan:76) matches F5 and the tab filters exactly.
- **Deep link choice:** `?order=<id>` as the scan-to-find target (plan:60) is the right primitive — it exists today (F2) and beats `setSearch` (list state, no detail).
- **Wedge mechanics:** `data-barcodeEnabled` opt-in on the Orders input (plan:60) is precisely what F1/F2 require; POS parity via the same async handler signature is real (F15).
- **DispatchDialog reuse:** per-order overrides + city/zone/area autofill + store selector already exist in the dialog (F3) — correct component choice, only its input shape is the problem (C3).
- **runBulkStatus reuse** for change-status commit (update → timeline → audit → `kickSyncWorker`) matches F12 exactly.
- **Payload design:** `dks1:O:<uuid>` QR + legacy CODE128 order_number + product barcode/sku as three parsed kinds (§2) covers all real sources (F1, F11); multi-store collision → ambiguous + disambiguation card is consistent with the no-unique-constraint reality (F14).
- **New-dep identification:** `@zxing/browser` not installed (F13) — correctly listed; lazy-scoping both scan deps (plan:102) matches the all-lazy route pattern (F13).
- **`order_number` btree migration** (plan:98) is genuinely needed — F14 has only a GIN trigram index; equality resolve wants btree.
- **Measurement slip first code** (plan:22, Phase 2) addresses F11's text-only gap.
- **Idempotency awareness:** the ⚠ already-consigned guard is harmless UX on top of F5's server-side skip — no contradiction, only misattribution (C4).
- **iOS Safari + PWA camera permission test** (plan:127) and **viewer-role fallback test** (plan:128) are the right hardening checks.
- **Echo-guard awareness exists** (plan:123) — the plan knows F9 matters; it just doesn't finish the thought for `returned`/`cancelled` (C6).

---

## Verdict

**NOT APPROVABLE AS-IS.** The architecture (one resolve layer, one hub, reuse-first) is sound and most reuse claims check out — but the plan carries **five critical defects**: a status vocabulary containing a nonexistent `on_hold` (back-door R1 violation), a per-store stock behavior with no data model behind it, a dispatch commit that feeds summaries into a dialog requiring full rows, a dispatch gate broader than every other doorway to the same mutation, and a return mode that invents a status change the app's only return flow deliberately never makes. None are hard to fix; all are load-bearing. Revise with the amendments below and resubmit for round 2.

### Required Amendments

| # | Severity | Amendment | Plan ref | Facts |
|---|---|---|---|---|
| 1 | Critical | Replace change-status picker with the exact 10-item app vocabulary (add `pending`, `pre_order_pending`; drop `on_hold`) — or document an explicit, justified subset | §5 M2 :80 | F6, F9 |
| 2 | Critical | Stock mode always adjusts global `products.stock_quantity`/variation stock; gate by stockSettings toggle + `manage_stock`; delete "current store" semantics | :87, :133 | F7 |
| 3 | Critical | Dispatch commit must fetch full `DispatchOrder` rows (pathao city/zone/area, customer fields) before opening the dialog; resolve summaries and the loaded page slice are both insufficient | §3 :51, §5 M1 :74 | F3, F4 |
| 4 | Critical | Dispatch gating = `ready_to_ship && !consignment_id` (match existing UI); broader set only with explicit user sign-off; describe the client guard as UX, not protection (server idempotency is the guarantee) | :75 | F4, F5 |
| 5 | Critical | Return mode: no `status` change in v1 — batch/sequential `pos_returns` + `return_processed` timeline + `logAction('create','pos_return')` + gated restock, per POS ReturnDialog semantics | :89-92, :132 | F8 |
| 6 | Critical | Block on verifying `returned`/`cancelled` membership in `LOCALLY_ADVANCED` echo guards before enabling them as bulk targets; exclude or extend the guard set accordingly | :80, :123 | F9, F6 |
| 7 | Critical | Resolve RPC: fix precedence for dual-meaning bare codes (return both candidates or define order-first explicitly); move role check before resolution; settle `forbidden` vs `not_found` for cross-store (align with test 3); prefer SECURITY INVOKER or justify DEFINER | §3 :44-53 | F13, F14 |
| 8 | Design | Per-mode permission gates via `PermissionGuard anyOf`: stock → `products.edit`, return → `pos.use` (verify), dispatch/change → `orders.change_status` (verify dispatch's exact permission) — not one hub-wide gate | §5 :68 | F10 |
| 9 | Design | `CameraModal` takes allowed-kinds filter: POS ignores `dks1:O`, Orders ignores product codes (graceful toast, not lookup failure) | §4 :64 | F1, F15 |
| 10 | Design | Add typed `id` to `SlipOrderData` (kill the any-cast) + measurement-slip data contract so Phase 2 QR has a clean uuid source; note the two-codes-per-slip layout consequence | §6 :100 | F11 |
| 11 | Design | State per-mode dedupe rules: order modes dedupe-to-one with flash; stock mode accumulates ×N; reconcile plan:70 with test 6 | :70, :124 | F5 |
| 12 | Design | Pick the return-commit shape (a: sequential ReturnDialog per order — recommended, preserves refund/reason/items; b: batch insert with defined field defaults) and write the field defaults if (b) | §5 M4 | F8 |
| 13 | Design | Extend print regression to invoice + pickup slip second-code layouts (80mm + A4), not just the measurement slip | §7 P4, :126 | F11 |
| 14 | Minor | Scan-to-find cleanup: clear input + cancel debounce after wedge/camera resolve; pause wedge hook while CameraModal open; add typed fallback for legacy text-only measurement slips | §4 | F1, F2, F11 |
| 15 | Minor | Verify `products.barcode` index for the resolve fallback; timestamp-named migration; reuse existing audit verb (products.edit flow) instead of new `stock_adjust` | §3, §6 :86 | F7, F14 |

— Round 1 critic. Awaiting revised plan for round 2 convergence.
