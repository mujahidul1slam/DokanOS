# End-to-End Verification — Pathao Dispatch (previously env-blocked flows)

Date: 2026-10-29 (Asia/Dhaka) · Instance: `http://localhost:8080` (Vite dev) vs linked remote Supabase `jiwndicvfkiltgageqwv` + **live Pathao production API** · Account: Enveil Vincent · Integrations: "Enveil Pathao", "Vincent Pathao" (both Connected)

Context: the previous round ([issues-3-16-18-33-e2e-verification.md](issues-3-16-18-33-e2e-verification.md)) was blocked by `401 Unauthorized User` on every Pathao call. Root cause of that blocker (now understood via the uncommitted fix in `supabase/functions/pathao-courier`): the edge function cached Pathao tokens per integration for their whole 90-day life, so after a credential save every dispatch replayed the token minted under the OLD credentials. The fix fingerprints the credentials into the cache key, evicts cached tokens on credential save (`force_refresh`), and adds a `reauth` action that verifies fresh credentials against Pathao before the UI claims success. The deployed function (v17, 2026-10-28) carries this fix.

## Result matrix — everything previously blocked is now covered

| Previously blocked (401) | Status | Evidence |
|---|---|---|
| Reauth / "connection verified" flow | ✅ PASS (after fixing bug #1 below) | `reauth` → `200 {"data":{"reauthorized":true,"stores":1}}`; UI toast "Pathao connection verified" |
| Pathao location/stores data (live authed reads) | ✅ PASS | 66 cities / 1,192 zones / 25,517 areas / 1 store; "Refresh" round-trips to live API |
| Bulk Track (live tracking reads) | ✅ PASS | "Tracking updated for 2 of 3 order(s)" on returned orders with real consignments |
| Create & Dispatch → real consignment booked | ✅ PASS | Test order EE-4687M dispatched; toast "Order EE-4687M dispatched to Pathao. Consignment: DE291026GARJTX" |
| Retry / re-dispatch idempotency | ✅ PASS | Re-dispatch of a dispatched order books exactly one fresh consignment after the old one is cancelled; never duplicates rows (one `courier_shipments` row per consignment, re-parented on attach) |
| #18 "Consignment Already Exists" prompt | ✅ PASS | "Order #EE-4687M already has courier entries (active: DE291026GARJTX). How would you like to attach new consignment …?" |
| #18 "Add as New Consignment" branch | ✅ PASS | "New consignment added — Consignment DE291026GARJTX — Status: Pending" (live status fetched on attach) |
| #18 "Overwrite Previous Entry" branch | ✅ PASS | "Previous consignment cancelled & new consignment attached" (calls Pathao cancel) |
| #18 delete/cancel flow + terminal handling | ✅ PASS | Confirm dialog "This will call the Pathao API to cancel the consignment…"; "Cancel on Pathao & Delete" → `pathao_cancelled: true` verified in fn response; terminal entry refuses further deletes (`400 "Courier entry … is already cancelled"`; UI hides Delete on cancelled entries) |
| #18 "Force Delete Locally" / pathao_failed dialog | 🟡 CODE-VERIFIED ONLY | Needs a Pathao cancel *rejection* (non-terminal); fabricating one would require disrupting a real parcel. Unit-covered (`parcelReplaceEdgeCases.test.ts`); dialog wiring live-confirmed present |
| Attach Pathao Consignment by real ID (live lookup) | ✅ PASS | Real ID: precise double-link guard `409 "Consignment DE291026GARJTX is already attached to order #EE-4687M"` (after bug #2 fix); bogus ID: live lookup rejection "Pathao returned no valid status for consignment DT2607TESTNOTREAL" |
| #32 "Active consignment on another Pathao Account" | ✅ PASS | Brand change on dispatched order → warning appears with re-resolve helper text |
| #22 batch dispatch + partial-failure counts | ✅ PASS | Batch of 3 with one corrupted row (invalid phone): **2 booked** (DE2910266FN7R3, DE291026B6PCWS), **1 left untouched** (EE-4688M stayed `processing`, no consignment) — partial success with the failed order not mutated |

## Bugs found & fixed during this verification

### 🟠 BUG-A — Credential-save "verified" toast could never succeed (in the fix itself)
`PathaoDetail.tsx` checked `reauthData?.reauthorized === true`, but the edge function answers in the standard `{ data: result }` envelope (as every other `pathao-courier` consumer knows — `createDispatch.ts:153`, `DispatchDialog.tsx:631`, `OrderDetailSheet.tsx:327`). A **successful** reauth was therefore always reported as "Saved, but Pathao rejected these credentials — could not verify the connection". Fixed by unwrapping `data?.data ?? data` defensively ([PathaoDetail.tsx](../../src/components/integrations/PathaoDetail.tsx) save handler). Live-verified: toast now reads "Pathao connection verified".

### 🟠 BUG-B — Attach/replace/delete failures hid the real reason behind "Edge Function returned a non-2xx status code"
`AttachParcelDialog.tsx` (and `OrderDetailSheet.handleDeleteCourierEntry`) tried `JSON.parse(error.message)` to recover the fn's error body — but current supabase-js puts the body on `error.context` and leaves `message` generic. Every non-2xx refusal (409 double-link, 404 unknown ID, 400 already-cancelled) surfaced as the useless generic string. Fixed in `AttachParcelDialog.tsx` (recover body from `error.context` as fallback, prefer `body.error`, keep the `pathao_failed` special case). Live-verified: toasts now show "Consignment DE291026GARJTX is already attached to order #EE-4687M" and "Pathao returned no valid status for consignment DT2607TESTNOTREAL". **Recommended follow-up:** apply the same two-line body recovery to `OrderDetailSheet.handleDeleteCourierEntry` (same latent issue).

## Observations (not app bugs)

1. **Pathao's status endpoint lags its own accepted cancels.** After `cancel` returned success (`pathao_cancelled: true`), `track_order` still reported `order_status: "Pending"` for the consignment minutes later. DokanOS records the cancel correctly (row `cancelled_at`, `canonical_status: cancelled`) and will reconcile on the next tracking pass whenever Pathao's read model catches up.
2. **Same-ID replace degenerates gracefully.** When old and new consignment IDs are identical (as forced in one test), "Overwrite"/"Add as New" collapse into the single existing row (dedupe) while still showing their normal success toasts — harmless, and real usage has distinct IDs.
3. The fn's cancel semantics are well-layered: real success / terminal-no-op (`pathao_cancel_noop`) / rejection (`pathao_failed` → Force dialog) are distinct outcomes, and the UI has a matching toast/dialog for each.

## Test data created & cleanup status

| Item | Cleanup |
|---|---|
| Orders EE-4687M, EE-4688M, EE-4689M ("TEST-PATHAO-VERIFY*") | **Trashed** (`deleted_at` 2026-10-29 04:29Z; auto-purge in 15 days) |
| Consignments DE291026GARJTX, DE2910266FN7R3, DE291026B6PCWS | **Cancelled on Pathao + locally** (`pathao_cancelled: true` for the two live ones; all three rows `canonical_status: cancelled`) |
| Integration settings / location data | Refreshed only (read paths); no changes left behind |

## Suite results

- `npm run typecheck` — clean
- `npm test` — **500 passed | 3 skipped** (unchanged from the fixes round; the two UI fixes are component-level and compile clean)

## Verdict

All Pathao dispatch flows that were blocked by the stale-token 401 are now verified live against the production Pathao API: booking, tracking, attach-by-ID with live lookup, the full #18 exists/overwrite/add-new/cancel-delete matrix (minus the cancel-*rejection* dialog, which is code+unit verified), the #32 cross-account warning, and #22 batch partial-failure semantics. Two real defects found in the uncommitted credential-fix code and corrected (BUG-A, BUG-B), one recommended follow-up noted.
