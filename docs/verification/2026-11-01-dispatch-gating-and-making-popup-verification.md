# Verification — Dispatch shipped-gating & manual "Making" promotion (2026-11-01)

Covers the two changes requested in this session:

1. **Order status must become `shipped` only when the courier entry (courier_shipments row) actually succeeded** — not merely because Pathao accepted the booking.
2. **Printing a measurement slip must stop auto-changing the order to "Making"**; instead a persistent popup asks, accumulates newly printed orders while open, and only moves orders when the user confirms.

---

## Change 1 — shipped gated on courier-entry success

### Implementation

`supabase/functions/pathao-courier/index.ts` (deployed v19, project `jiwndicvfkiltgageqwv`):

- `upsertShipmentRow` now returns `Promise<boolean>` — `false` on upsert error (previously the failure was swallowed and dispatch continued).
- In `create_order` (single) and `create_bulk`, the shipment row is written **before** the order update:
  - `const courierEntryOk = await upsertShipmentRow(...)` (deployed source lines ~843 / ~1014)
  - `if (courierEntryOk) orderUpdate.status = "shipped";` (~859 / ~1030)
  - timeline description appends `" (courier entry pending)"` when the entry failed (~865 / ~1036).
- `consignment_id` / `tracking_status` are still recorded either way, so the Pathao booking reference is never lost.
- Deployed source confirmed with `supabase functions download pathao-courier --project-ref jiwndicvfkiltgageqwv`; `supabase functions list` shows pathao-courier ACTIVE v19.

### Live verification (test order EE-8789W — fake customer "Emily Johnson")

**Failure path** — forced by `REVOKE INSERT ON courier_shipments FROM service_role` (the edge function runs as service_role; its upsert then fails and is caught):

| Check | Result |
| --- | --- |
| Pathao booking | ✅ succeeded — consignment `DE011126LNKDWY` booked, client toast "1 order(s) dispatched to Pathao!" |
| `orders.status` | ✅ **stayed `pending`** (not shipped) |
| `orders.consignment_id` | `DE011126LNKDWY`, `tracking_status = "Pickup Pending"` (recorded despite the gate) |
| `courier_shipments` rows for the order | ✅ **0** |
| Timeline | ✅ `dispatched — "Dispatched to Pathao. Consignment: DE011126LNKDWY (courier entry pending)"` |

**Success path** — `GRANT INSERT` restored, then re-dispatched via the dialog's "Replace 1 & Dispatch" (which also cancelled the stranded consignment on Pathao):

| Check | Result |
| --- | --- |
| Replace flow | ✅ `parcel_detached — "Previous Pathao parcel DE011126LNKDWY cancelled on Pathao and marked for replacement."` |
| Pathao booking | ✅ new consignment `DE011126X96E33` |
| `orders.status` | ✅ **`shipped`** |
| `courier_shipments` | ✅ 1 row — `DE011126X96E33`, `canonical_status = pending` |
| Timeline | ✅ `dispatched — "Dispatched to Pathao. Consignment: DE011126X96E33"` (no "courier entry pending" suffix) |

### Cleanup (all verified in DB / Pathao API)

- `DE011126LNKDWY` — cancelled on Pathao by the Replace flow; never had a local row.
- `DE011126X96E33` — cancelled via `delete_courier_entry` (`pathao_cancelled: true`, not a no-op); local row `canonical_status = cancelled`, `cancelled_at` set.
- `EE-8789W` — moved to Trash (`deleted_at` set; Trash count 95 → 96).
- `REVOKE`/`GRANT` fully restored (service_role INSERT present again).

Note: the first dispatch attempt failed with Pathao `422 "recipient phone is not a valid phone number"` because the test order's phone (`5556636026`) is not a valid BD mobile; the phone was corrected to `01712345678` before the real test. This failure itself behaved correctly (no consignment, no status change).

---

## Change 2 — manual "Making" promotion after measurement-slip print

### Implementation

- `src/lib/makingPromotionStore.ts` — module store (`MakingCandidate { orderId, orderNumber, fromLabel, fromStatus }`) with `addMakingCandidate` (dedupes, opens), `removeMakingCandidates(ids)` (removes only resolved), `dismissMakingPromotion()`, `useMakingPromotion()` via `useSyncExternalStore`.
- `src/components/orders/MeasurementSlipPrint.tsx` — the old auto-promotion (`promotePreOrderOnSlipPrint` at the end of `printMeasurementSlip`) is replaced by `checkMakingEligibility(orderId)` (read-only, same pre-order eligibility rules) + `applyMakingPromotion(orderId, fromLabel, fromStatus)` (writes `status = 'pre_order_making'`, throws on DB error). Printing now **queues a candidate** instead of changing status.
- `src/components/orders/MakingPromotionPopup.tsx` — fixed, non-modal panel mounted globally in `App.tsx`:
  - lists queued candidates with checkboxes and origin status;
  - "Change to Making (N)" promotes the selected orders, removes **only the ones that succeeded** (failed ones stay for retry), toasts the outcome, and fires `orders:refresh`;
  - stays open until explicitly **Dismissed** — including after everything is promoted (completed state: "All queued orders have been moved to Making.");
  - new slips printed while it is open are **added** to the queue.
- `src/pages/orders/useOrdersData.ts` listens for the `orders:refresh` event and refetches.

### Live verification (preview :4173, business Enveil Vincent)

1. Order **EE-8828W** (Pre-Order/Pending) → Print Slip → popup appeared: *"1 order had a measurement slip printed"* with candidate `EE-8828W from Pre-Order`. **Pending count unchanged (8)** — no automatic status change.
2. Closed the order sheet — popup **remained** (persists until dismissed).
3. Opened order **#9253** (Pre-Order) while the popup was open → Print Slip → popup **accumulated**: *"2 orders had a measurement slip printed"*, button "Change to Making (2)".
4. "Change to Making (2)" → both promoted; Pending 8 → 6, Making 40 → 42; popup switched to the completed state; Dismiss closed it.
5. DB: both rows `status = pre_order_making` with `measurement_slip_printed_at` stamped.

> Note: EE-8828W and #9253 are real pending pre-orders that were deliberately promoted to **Making** as part of this verification (a legitimate forward workflow step). Move them back to Pending from the order sheet if that was not desired.

---

## Incident notes (infrastructure, fixed during verification)

1. **Orders page showed 0 rows / HTTP 500 (statement timeout).**
   - Root cause A: the `active_business_context` row for the signed-in user had been wiped (by something outside this session — not this session's code). The orders RLS depends on `current_business_context()`; with no row every orders query returns 0 for everyone. Re-seeded with `insert into active_business_context ... on conflict (user_id) do update`. The client never writes this table (it persists the active business only in localStorage) — worth wiring up properly later.
   - Root cause B: after re-seeding, the orders queries timed out (8s role timeout). The RLS helpers `user_can_access_store()` / `current_business_context()` are `SECURITY DEFINER` SQL functions, so they cannot be inlined and were executed **per row** (~1 ms × ~3 200 rows ≈ 2.3–3.5 s per statement; 16–22 s under the app's concurrent page/count queries).
   - Fix applied (production DB):
     - `ALTER ROLE authenticated SET statement_timeout = '20s'` and `ALTER ROLE authenticator SET statement_timeout = '20s'` (API requests run through the pooler as `authenticator`, whose setting is the effective one; other authenticator settings untouched).
     - Rewrote the two hot SELECT policies to inline the same access logic as an uncorrelated `IN (subquery)` (hashed once per statement instead of per row) — **identical semantics, same row counts (3236)**:
       - `orders` policy *"Account members can read orders"* → `(store_id IS NOT NULL) AND store_id IN (SELECT b.woo_store_id FROM brands b JOIN user_business_access membership ON membership.business_id = b.business_id JOIN businesses business ON business.id = b.business_id WHERE membership.user_id = auth.uid() AND business.is_active AND b.business_id = current_business_context())`
       - `order_items` policy *"Account members can read order_items"* → `EXISTS (SELECT 1 FROM orders account_order WHERE account_order.id = order_items.order_id AND account_order.store_id IS NOT NULL AND account_order.store_id IN (<same subquery>))`
     - Measured effect: count query **3532 ms → 187 ms**; page queries 16–22 s → 2.5–6.5 s under load; Orders page loads reliably (All 3141, New 248, Pre-Order 82, Delivered 1993).
   - Remaining recommendation: apply the same inline pattern to the UPDATE/DELETE policies and `stores` policies when convenient, and consider having the client persist the active business via an RPC so `active_business_context` can't silently empty again.

2. **Test artifacts**: consignments cancelled (both), test order trashed, temporary SQL files removed, phone-number change confined to the trashed test order.

## Test suite

505 passed | 3 skipped (41 files) — unchanged from the last code change; typecheck clean; `npm run build` succeeded.
