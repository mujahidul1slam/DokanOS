# Scan-Driven Operations — Implementation Plan (v3)

> **Scope:** two features on one scanning backbone.
> 1. **Scan-to-find** — Orders + POS search bars scan (wedge on desktop, camera on phone) to FIND orders/products from invoice, pickup slip, measurement slip codes.
> 2. **Scan Hub `/scan`** — 4 batch modes: **Dispatch · Change status · Stock update · Request return**. Scan → list → review → commit once.
>
> **No new order status is created.** Dispatch lands orders in the existing
> `pickup_pending` tab (Pathao `Pickup Pending` tracking, F5). Converged through
> 3 adversarial review rounds (`SCAN-PLAN-REVIEW-1/2/3.md` — final verdict:
> CONVERGED, implementation-ready, 11/11 amendments verified, no criticals).

---

## 1. What already exists (reused, not rebuilt)

| Piece | Evidence | Used for |
|---|---|---|
| Wedge hook `useBarcodeScanner` (rapid-key, `data-barcodeEnabled` opt-in) | `src/hooks/useBarcodeScanner.ts:1-56` (56 lines) | desktop gun on every page incl. `/scan` |
| POS wedge flow: barcode/sku → variation/c parent → cart (with stock check + beeps) | `POS.tsx:169-235` | camera parity target (same async callback shape) |
| Invoice + pickup slip CODE128 = `order_number` | `invoiceHtml.ts:55` (`show_barcode`), `pickupSlipHtml.ts:100-101` (`show_order_number`) | scannable day one |
| `?order=<id>` deep link opens detail sheet | `Orders.tsx:172-179` | scan-to-find target |
| `DispatchDialog` (full-row `orders[]` prop, per-order overrides, Pathao store/city/zone/area autofill) | `DispatchDialog.tsx:74-88` | Dispatch commit step |
| `pathao-courier create_bulk`: creates parcel → sets `consignment_id, tracking_status:'Pickup Pending', status:'shipped'` + timeline + audit + Woo note; **skips if consignment exists** | `pathao-courier/index.ts:539-613` | server-side idempotency (the real guarantee) |
| App status vocabulary (10): `pending, processing, pre_order_pending, pre_order_making, pre_order_ready, ready_to_ship, shipped, delivered, returned, cancelled` | `OrderDetailSheet.tsx:1946-1962` | Change-status picker source |
| Bulk status pattern | `useOrderBulkActions.ts:42-69` | Change-status commit |
| POS `ReturnDialog`: `pos_returns` insert + gated restock + `return_processed` timeline + `logAction('create','pos_return')`; **never touches status** | `ReturnDialog.tsx:108-167` | Request-return commit |
| Global stock toggle: OFF → only `manage_stock===true` tracked; single `products.stock_quantity`; variation stock per-variation | `stockSettings.ts` (`getEffectiveStock`), `ProductDetailSheet.tsx:309-317` | Stock mode semantics |
| Permission catalog + `PermissionGuard` `anyOf` | `usePermissions.tsx:79-162`, `PermissionGuard.tsx:12-17` | per-mode gates |
| SQL helpers `user_has_store_access`, `has_role` (SECURITY DEFINER) | migrations `20260420112330:236-267`, `20260412161413:37-48` | resolve RPC scoping |

**Net-new only:** camera decoding (`@zxing/browser` — not installed, zero `getUserMedia` in app), `resolve_scan` RPC, `/scan` hub page, QR on measurement slips (+ `id` plumbing).

---

## 2. Scan payloads

| Payload | Found on | Resolves to |
|---|---|---|
| `dks1:O:<order-uuid>` (QR) | invoice · pickup slip · **measurement slip (first-ever code)** | order, unambiguous |
| bare order number (existing CODE128) | invoice · pickup slips in circulation | order by number (multi-store collision possible → disambiguation) |
| product `barcode`/`sku` (existing columns) | product packaging / labels | product (+ variation) |

Parser `src/lib/scanPayload.ts` → `{kind:'qr-order',id} | {kind:'code',raw}` | `{kind:'unknown'}`.
QR handles orders only; bare codes resolve contextually (below). Camera decodes both QR and CODE128 (zxing reads 1D too — legacy prints work via camera day one).

---

## 3. Resolve layer — one RPC, `resolve_scan(p_raw text)`

`SECURITY INVOKER` (read-only), `SET search_path=public`, grants `authenticated, service_role`. **Store scoping is enforced by the RPC SQL explicitly — NOT by RLS.** Orders SELECT RLS is all-authenticated (no store filter in it), so scoping lives here: every candidate lookup passes through `user_has_store_access(auth.uid(), store_id)` (the canonical SECURITY DEFINER checker, F14).

**Order of checks:**
1. `has_role(auth.uid(),'admin'|'staff')` → else `forbidden` (fail-first: nothing resolved for viewers; no existence oracle).
2. `dks1:O:<uuid>` → order by id **store-scoped**: `user_has_store_access(auth.uid(), order.store_id)` must pass → else `not_found` (uniform rule on ALL paths, including QR-by-id — no cross-store data leaves this RPC).
3. Bare code → **both lookups in parallel; return both candidate sets, no hidden precedence**, every candidate store-scoped through `user_has_store_access`:
   - orders: `order_number = raw` → >1 in-scope → `ambiguous.candidates[]` (filtered to the caller's stores)
   - products: `products.barcode = raw OR products.sku = raw` (+ variation barcode/sku via `product_variations`) → >1 in-scope → product `candidates[]` (mirrors orders; stock mode shows a pick-one card — never silent first-match)
4. Cross-store or out-of-scope candidates are **excluded server-side, uniformly on every path** — `resolve_scan` answers "what can I act on"; a single out-of-scope candidate → `not_found` (aligns with test 3; no cross-store existence oracle).
5. Returns `{ok, order?{…summary}, product?{…summary}, both?:true}` or `{ok:false, code:'not_found'|'ambiguous'|'forbidden', …}`.

**Search-context disambiguation of `both:true`:** Orders page ignores product candidates (flash "product code"), POS ignores order candidates (flash "order code") — context decides, the payload never hides a candidate.

**Migration `20260910120000_scan_resolve.sql`:** RPC (with the explicit scoping above) + btree on `orders.order_number` (only GIN trigram exists today) + verify-item: btree on `products.barcode` AND `products.sku` if absent.

---

## 4. Feature 1 — scan-to-find

**Orders page:**
1. Add `data-barcodeEnabled` to the search input; wedge hook fires `onScan(raw)` → `resolve_scan` → order found → `setSearchParams({order: id})`, **clear input + cancel pending debounce** (junk-filter guard), detail sheet opens.
2. QR icon button beside input → `CameraModal` (allowed-kinds: order-only) → same resolve → same deep link. Product codes → toast "product code — ignored here". **Wedge subscription pauses while this modal is open** (same rule as POS/hub — no double-fire).
3. `ambiguous` (multi-store number) → inline candidate chips under the search bar; tap → deep link.
4. Legacy text-only measurement slips: typed fallback — user types the number, same resolve path (manual entry was always possible; the typed path reuses it).

**POS page:**
1. Wedge already works (adds to cart via the POS handler).
2. Camera button beside search (phone) → `CameraModal` (allowed-kinds: product-only) → calls the **same async barcode callback** (`POS.tsx:169` shape) → identical add-to-cart behavior. `dks1:O` payloads → toast "order code — not in POS".
3. **Modal-open suppression:** wedge subscription pauses while `CameraModal` is mounted (no double-add); resumes on close.

---

## 5. Feature 2 — Scan Hub `/scan` (lazy route)

Route guard: `anyOf: [orders.change_status, pos.use, products.edit]` (hub entry). **Each mode adds its own gate on entry/commit** (see per mode). Wedge works page-wide (hook is a page-global keydown); camera optional per device; `CameraModal` shares the suppression rule.

**Shared queue:** scan → resolve → row card (order number/name/qty, status, store) → explicit **×** per row to remove (no tap-row-to-remove on mobile). **Dedupe rules per mode:** order modes (dispatch/status/return) dedupe-to-one with a "scanned again" flash (a second dispatch of one order is meaningless — F5 makes it a server-side skip anyway); stock mode accumulates ×N (each scan = +1). Failed resolve (network) → row held with retry icon + toast (payload not lost). **Focus caveat:** the wedge hook ignores keystrokes aimed at INPUT/TEXTAREA without `data-barcodeEnabled` — the hub's manual-entry and typed-delta inputs swallow scans while focused (correct, but the input shows a subtle scan-hint so users don't think scanning died); a dedicated scan-capture input (POS pattern) is the fallback.

### Mode 1 — Dispatch (gate: `orders.change_status` + `canWrite` parity)
1. Scan pickup slips/invoices → orders accumulate.
2. **Gate exactly like the app does:** dispatchable = `status==='ready_to_ship' && !consignment_id`. Everything else renders a ⚠ row ("not ready to ship / already dispatched") — excluded from commit but visible.
3. Client-side guard is **UX warning only** — the real idempotency guarantee is server-side in `create_bulk` (skips existing consignments, F5). Plan says so; no false "protection" claim.
4. **Commit:** fetch **full rows** (every `DispatchOrder` field: customer name/phone/address, `pathao_recipient_city/zone/area`, items/amounts) via one `orders.select()` by scanned ids → open the existing `DispatchDialog` with those rows (per-order correction, Pathao store/zone autofill, `create_bulk` dispatch) → `pickup_pending` tab via tracking.
5. Non-loaded orders are irrelevant here — the hub fetches by id, never depends on the Orders page's loaded slice.

### Mode 2 — Change status (gate: `orders.change_status`)
1. Scan slips → list (current status shown per row).
2. Status picker = **the app's exact 10-item vocabulary** (`OrderDetailSheet.tsx:1946-1962`): pending, processing, pre_order_pending, pre_order_making, pre_order_ready, ready_to_ship, shipped, delivered, returned, cancelled.
3. Commit → `runBulkStatus` pattern: bulk update + `addOrderTimeline` + `logAction` + `kickSyncWorker()`.
4. **Echo guard (one explicit reading):** verify `returned`/`cancelled` membership in `LOCALLY_ADVANCED` (`woo-webhook/index.ts:392-395`, `woo-sync/index.ts:703-706`) — confirmed members today: processing, pre_order_*, ready_to_ship, shipped, delivered. **If absent: extend the guard set in BOTH edge functions (TypeScript change + deploy + changelog line — this changes existing single-order sync behavior: locally-set returned/cancelled begin echoing to Woo, which is the correct alignment since the app sets both today) AND exclude `returned`/`cancelled` from the v1 scan picker** (terminal states, set individually). Verify during Phase 3 planning, before the picker ships.

### Mode 3 — Stock update (gate: `products.edit`)
1. Scan product barcodes → products/variations accumulate; **duplicates accumulate ×N** (each scan = +1; matches "increment by 1" requirement). Row shows `[−1] [+1]` adjusters (they mutate the scan count) + a typed delta field (**overrides** the count) — commit uses the final value.
2. **Global stock only** — `products.stock_quantity` / `product_variations.stock_quantity`. No per-store stock exists anywhere in the app (none to write to).
3. Gating matches the POS return restock condition: adjust only when `globalStockEnabled || manage_stock===true`; untracked rows show ⚠ "not stock-tracked" (adjustment is a no-op there — surfaced, not silent).
4. Commit → per-row `products.update({stock_quantity: current + delta})` (+ variations) + `logAction('update','product', …)` — **reuses the existing `ProductDetailSheet` audit verb** (`update`/`product`, F7 pattern), no invented `stock_adjust` verb. **Inherited race acknowledged:** `current` is the scan-time snapshot (read-modify-write) — same pattern as `ProductDetailSheet` today; concurrent adjusters converge to a last-write-wins; acceptable at shop volume.

### Mode 4 — Request return (gate: `pos.use` + `orders.change_status` parity — verify exact permission during impl)
1. Scan slips → orders accumulate; live consignments (consignment_id present, not delivered/returned tracking) → ⚠ "courier return — handle in order detail" (no forced batch action).
2. **No status change in v1** (matches the app's only return flow, F8: POS returns never touch `orders.status`).
3. **Commit = sequential return form per scanned order.** Phase 3 opens with a **verify-then-extract** task: check `ReturnDialog`'s input contract against a scanned order (items source, refund-method applicability, restock inputs — F8 documents its commit, not its props). **If the contract verifies:** extract it to a shared component (move listed in §6), hub pre-fills the order number, one confirm per order — preserves per-item quantities, refund method/amount, reason, restock toggle (the POS audit + refund trail). **If it doesn't:** fallback = a hub-native minimal return form replicating F8's commit exactly (`pos_returns` row + `return_processed` timeline + `logAction('create','pos_return')` + gated restock, no status change). Either path preserves the same audit trail.
4. Variations restock correctly (ReturnDialog restock is product-level; per-variation restock is a known POS limitation — hub inherits it, documented, not fixed here).

---

## 6. New/changed files

**New:** `src/lib/scanPayload.ts` · `src/hooks/useCameraScanner.ts` (zxing wrapper — name distinct from the wedge `useBarcodeScanner`) · `src/components/scan/CameraModal.tsx` (props: `{open, onResult(raw), allowedKinds, onClose}`) · `src/pages/ScanHub.tsx` + 4 mode panels · migration `20260910120000_scan_resolve.sql` (RPC + `order_number` btree + `products.barcode`/`products.sku` verify).

**Edited:** `App.tsx` (lazy `/scan`), `Orders.tsx` (input attr + camera button + debounce-clear + candidate chips), `POS.tsx` (camera button + suppression), slips get `dks1:O` QR via new `src/lib/qrSvg.ts` (vector-safe, `barcodeSvg.ts:31-45` viewBox pattern): invoice + pickup slip (second code beside CODE128) + measurement slip (first code ever).
**`SlipOrderData` gains a typed `id`** (kills the any-cast; QR needs the uuid in the renderer); measurement-slip data contract gains it too.
**Phase 3 (conditional):** `ReturnDialog` extracted to a shared component (or the hub-native fallback form if the contract fails verification — §5 M4.3).

**Deps:** `@zxing/browser` (Phase 2 — installed with the camera work, lazy-scoped to `/scan` + modal chunks) · `qrcode` (Phase 2). Enforce via post-build grep: main chunk must contain neither.

---

## 7. Phases

| # | Phase | Ships | ~Time |
|---|---|---|---|
| 1 | Resolve RPC + parser + **full dispatch flow** (row fetch + gate + dialog reuse) + Orders search wedge scan + hub skeleton with manual entry | desktop scan-to-find + working dispatch batch | 1½ days |
| 2 | Camera (`useCameraScanner` + `CameraModal` + suppression) + Orders/POS camera buttons + `dks1:O` QR onto all three slips (incl. `SlipOrderData.id`) | phone scanning everywhere | 1 day |
| 3 | Hub modes: Change status (10-item picker; echo-guard verify → own migration, picker excludes returned/cancelled in v1) + Stock update + Request return (**verify-then-extract ReturnDialog**, fallback = hub-native F8-replica form) | full hub | 1½ days |
| 4 | Hardening: oracles (RLS/scope/dedupe), print regression **on all three slips** (80mm thermal + A4, vector-size, scannability), Playwright smoke, CHANGELOG | ship | ½ day |

(~4½ days total; Phase 1/3 grew ~½ day each per round-1 review.)

---

## 8. Test checklist

1. Wedge scan invoice barcode on Orders → input cleared, debounce cancelled, detail sheet opens for the right order.
2. Camera scan measurement-slip QR `dks1:O:…` → same order opens. Camera also reads legacy CODE128 (zxing 1D) — verify explicitly.
3. Multi-store same number → candidate chips; cross-store → `not_found` (out-of-scope excluded server-side). Viewer → `forbidden` before any resolution.
4. Dispatch: scan 3 ready_to_ship + 1 processing → dialog opens with 3; processing row shows ⚠; consignment created → orders in `pickup_pending` tab. Re-scan an already-dispatched order → ⚠ "already dispatched". **Re-scan a queued order in dispatch/status/return mode → dedupes to one row with "scanned again" flash.**
5. Change status: 3 slips → `shipped` → statuses + timeline + audit + kick; echo-guard verify task done for `returned`/`cancelled` before they're selectable.
6. Stock: scan product twice → ×2, +2 on commit; `manage_stock:false` product under global-off → ⚠ not-tracked, no-op; variations adjust on their own rows; audit verb = `update`/`product`.
7. Return: scan 2 delivered orders → sequential ReturnDialog per order, `pos_returns` rows + timeline + restock (gated) — **status unchanged**.
8. Print regression: **all three slips** (invoice/pickup second-code layout + measurement first code) — 80mm + A4, vector-size sane, QR scans from curled paper at angle.
9. iOS Safari **and** installed PWA camera; Android wedge + camera; wedge pauses while CameraModal open (no double-add).
10. Viewer role on `/scan` → clean `forbidden`; stock mode walled by `products.edit` (a user with only `orders.change_status` cannot adjust stock); POS-camera ignores `dks1:O` gracefully.

## 9. Assumptions (re-stated as decisions — round-1 fixes)

1. **Request return** = POS-style per-order return records (`pos_returns`), **no status change**, sequential dialogs. Courier return-request (Pathao) stays out of v1 — live consignments get ⚠.
2. **Stock** = global quantities only; gated by `globalStockEnabled || manage_stock` exactly like POS restock.
3. Dispatch gate mirrors the app (`ready_to_ship && !consignment_id`); broadening it would be a separate, explicit user decision.
4. Product labels: v1 relies on barcodes already in `products.barcode` (packaging/supplier codes). Printing our own product labels = later.
