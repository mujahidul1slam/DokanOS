# End-to-End Verification — Post-Patch Findings 1–9 (manual review of Issues #3, #16, #18–33)

Date: 2026-10-29 (Asia/Dhaka) · Instance: `http://localhost:8080` (Vite dev) against the linked remote Supabase project `jiwndicvfkiltgageqwv` · Account: Enveil Vincent (3,114 orders)

## Result matrix

| # | Finding | Status | Verified via |
|---|---------|--------|--------------|
| 1 | Brand default courier change should auto-select that Pathao account's default store | ✅ PASS | Browser (change → auto-select → save → reload → persisted → revert) |
| 2 | Remove scattered settings Save buttons; use the universal save popup | ✅ PASS | Browser (Profile/Brand/Invoice tabs) + grep (zero rendered SaveButton) + registry tests |
| 3 | Clearing phone in Add Order should dismiss previous customer info | ✅ PASS | Browser (clear → instant dismiss; clear mid-lookup → no stale resurrection) |
| 4 | Show selected order IDs in the top actions bar (prototypes first) | ✅ PROTOTYPES DELIVERED | 3 variants live on `/orders?sel=A|B|C` + screenshots; awaiting your pick |
| 5 | Pickup slip format A4 gives "couldn't save your changes" | ✅ PASS | Browser (A4 save succeeds; reload shows persisted value) |
| 6 | Add measurements later in Order Info (existing items + new products) | ✅ PASS | Browser (both cases; values persisted across sheet close/reopen) |
| 7 | Duplicate + merge warnings show on every tab | ✅ PASS | Browser matrix over all 11 tabs + 13 unit tests |
| 8 | Redesign duplicate warning (red count button + filter + pairing) (prototypes first) | ✅ PROTOTYPES DELIVERED | 3 variants live on `/orders?dup=A|B|C` + screenshots; awaiting your pick |
| 9 | All orders sometimes don't load (esp. New / Pre-Order) | ✅ PASS | Root-caused (race + silent 1000-row cap + swallowed errors), red-green regression test, browser re-load stability |

## Root causes and fixes (per issue)

### 1 — Default courier → default Pathao store
`pathao_stores` has no per-account default flag, so "the account's default store" = first active store in display order (same convention as `ExchangeDialog`'s `stores[0]` preselect). Changing the Default Courier select now sets an auto-pick flag; the stores effect then selects the new account's default pickup store instead of keeping the old account's store. New pure helper [`defaultPathaoStoreForAccount`](src/lib/dispatchAccounts.ts) + 2 tests. Fix in [BrandSettingsTab.tsx](src/components/settings/BrandSettingsTab.tsx) (auto-pick flag :700–706, selection effect :539–545).
**E2E:** Brand 1 changed Enveil Pathao → Vincent Pathao: pickup store auto-selected "Vincent Official" (#77755). Saved via the universal bar, reloaded page: persisted. Reverted to Enveil Pathao: auto-selected "Enveil" (#63088) — the exact original. Left in original state.

### 2 — Universal save popup
Root cause: per-element/per-section Save buttons throughout settings (3 in Brand, 3 in Profile, footer buttons in 6 more tabs), and Invoice/Pos/Orders weren't registered with the save registry at all (which is exactly what broke Issue 5). Fix: new invisible `SettingsSaveHandler` primitive ([SettingsSection.tsx](src/components/settings/SettingsSection.tsx):94–116), every visible field-Save button removed, each tab registered with proper dirty tracking; route-away guard and per-section error toasts preserved. Kept intentionally: dialog commit buttons (Create brand/business, category dialog, "Apply") — flow actions, not scattered field saves.
**E2E:** Profile/Brand/Invoice tabs show no field-level Save buttons; edits raise the sticky "Discard | Save" bar which commits registered sections (Brand defaults + Invoice settings both saved through it during this session).

### 3 — Clear phone → dismiss customer info
Root cause: `customerMatches` only recomputed on blur and cleared only manually; the lookup seq guard didn't cover clearing, so an in-flight lookup could resurrect stale cards after the field was emptied. Fix: [AddOrderDialog.tsx](src/components/orders/AddOrderDialog.tsx):770–783 — bump `phoneLookupSeq` on every phone edit (invalidates in-flight lookups) and reset matches when the value is empty.
**E2E:** Typed 01315515757 → blur → "Existing customer — Hasibul hasan Hujaifa, 1 previous order" appeared → cleared phone → card dismissed instantly. Race case: blur (lookup starts) then immediately clear → waited 2.2s → card never reappeared.

### 5 — A4 pickup slip save failure
Root cause was **frontend save-wiring, not the database**: the tab's save was a raw button never registered with the save registry, so the sticky bar ran **zero handlers**, the tab stayed dirty, and the generic "could not be saved — review and try again" toast fired — the A4 change was never attempted. Secondary defects fixed: pickup-slip template edits never marked dirty (silent-loss hazard), real DB errors were swallowed behind "Failed to save", and a silent 0-row RLS no-op could fake success. Schema analysis: committed migrations have **no CHECK/enum/trigger** on `pickup_slip_print_format` (plain `text NOT NULL DEFAULT 'thermal'`) — no migration needed; `default_print_format` shared the identical bug and is fixed too. Fix: [InvoiceSettingsTab.tsx](src/components/settings/InvoiceSettingsTab.tsx):135–143, :187–223, :724.
**E2E (frontend + backend):** Invoice / Pickup Slip → set "A4 landscape (3 slips across)" → sticky bar → Save → success, bar cleared, no error. Full page reload → value still "A4 landscape (3 slips across)" — persisted to `invoice_settings` in the live database. **Left on A4 per your original intent.**

### 6 — Add measurements later in Order Info
Root cause: the sheet only edited measurement rows that already existed; no affordance for items with none; new products got no measurement entry; and the save inserted `order_items` without returning ids so measurements couldn't attach to just-added lines. Fix: pure helper `getGroupsWithoutRows` ([measurementRules.ts](src/lib/measurementRules.ts):188–205) + [OrderDetailSheet.tsx](src/components/orders/OrderDetailSheet.tsx) entry helpers, lazy group cache, "Add measurements" affordance (:2413–2524), new-line attach with size-preset pre-fill (:880), id-returning insert + temp→real id mapping (:1076–1110, :1316–1345). 4 new unit tests.
**E2E:** Created test order EE-4686M with "Black Joggers" (no groups → no affordance: correct). Added "Black Bootcut Gurkha Pants" from Order Info: variation picker → size M → measurement entry appeared with **size-M preset values pre-filled** (39.5/32.5/39/29/24.5/20) and "saved on Save Changes" — the preselected-measurement case. Cleared presets → saved (empty entries dropped) → **"Add measurements" button appeared** — the later-entry case. Filled 40/33/39.5/29.5/24.5/20.5 → Save Changes → closed sheet → reopened: **values persisted** (backend write confirmed). Affordance correctly gone once rows exist.

### 7 — Warning scoping per tab
Root cause: both banners rendered unconditionally. Fix: gating block in [tabFilters.ts](src/pages/orders/tabFilters.ts):43–89 — `DUPLICATE_WARNING_TABS` (new, pre_order, ready, pickup_pending, in_transit) and `MERGE_PANEL_TABS` (same minus in_transit, per your "probably just new, pre order, ready, and pickup"), applied at Orders.tsx:728/:826. Detection logic and per-tab counts untouched. 3 tests.
**E2E (all 11 tabs):** duplicate warning on New/Pre-Order/Ready/Pickup/Transit ✅, hidden on All/Delivered/On Hold/Returned/Cancelled/Trash ✅ (the All tab with 3,114 orders and global matches never shows them — the strong case). Merge panel on New/Pre-Order ✅; hidden on Transit (asymmetric by design) and on all post-dispatch tabs ✅. Ready/Pickup had no same-customer groups in current data (gate allows them; predicates pinned by unit tests).

### 9 — Orders sometimes don't load (New / Pre-Order)
Evidence chain (three compounding defects):
1. **Overlapping-fetch race, last-response-wins (the intermittent root cause).** Scope inputs (stores / selling points / brands) resolve asynchronously, so a partial-scope fetch could land after the full-scope fetch and overwrite the complete list; nothing refetched. The lost class was exactly selling-point-only (app-created) orders — the New/Pre-Order pipeline — and a stale category map broke the two tab rules only New/Pre-Order consume.
2. **Swallowed errors** — any fetch failure silently rendered an empty/stale list, no feedback, no retry.
3. **Silent 1000-row PostgREST truncation + oversized `.in()` URLs** — one unpaginated select (the exact bug documented in `supabasePage.ts`), and a hundreds-of-UUIDs category query that can 414.

Fix: extracted loader [useOrdersData.ts](src/pages/orders/useOrdersData.ts) with request-token stale guard, `fetchAllRows` pagination, chunked category queries ([orderCategoryMap.ts](src/pages/orders/orderCategoryMap.ts), chunk=150), atomic rows+map commit, surfaced errors + Retry banner (Orders.tsx:708). Race regression test proven red-capable (fails with the exact user symptom when the guard is disabled).
**Follow-up fix applied during review:** raw status `"pending"` matched **no** active tab (fresh unpaid Woo orders were invisible in New — the dashboard's `/orders?status=pending` link had nothing to land on). Now `new` matches `["pending","processing","payment_pending"]` ([tabFilters.ts](src/pages/orders/tabFilters.ts):176–191) + 2 tests. Per-tab counts change accordingly (intended).
**E2E:** All tab loaded **3,114 orders** (pre-fix page showed 918 — the loader was losing ~2,200 rows), New shows **251** (was 5 — pending orders included), counts identical across re-navigation cycles, no error banner. The red-green race test pins the intermittency.

## Suite results

- `npm run typecheck` — clean (exit 0)
- `npm test` — **500 passed | 3 skipped** (40 files; skips pre-existing). Baseline before this work: 481 passed.
- New tests: 4 (measurementRules) + 3 (tabFilters banner visibility) + 2 (tabFilters pending) + 7 (orderCategoryMap) + 5 (useOrdersData race/pagination/errors) + 2 (dispatchAccounts default store) = 23.

## Test data created & cleanup status

- **Order EE-4686M** ("TEST-VERIFY Issue6", phone 01700000001, Black Joggers + Black Bootcut Gurkha Pants) — created for Issue 6 verification, **moved to Trash** at the end of the session (auto-deletes after 15 days). Safe to purge immediately.
- **Pickup slip print format** — left on **A4** (your original attempt; the fix makes it stick). Invoice print format untouched (Thermal).
- **Brand 1 default courier** — restored to original (Enveil Pathao → store "Enveil") after the Issue 1 test; verified persisted.

## Prototypes delivered (issues 4 & 8 — for your selection)

Throwaway prototype code in [src/components/orders/__prototype__/](src/components/orders/__prototype__) (dev-only floating switcher; hidden in production builds). Live in the running app — flip variants with the bottom bar or open the URLs. Row checkboxes populate the selection variants.

| Question | A | B | C |
|---|---|---|---|
| **#4 Selected order IDs in the actions bar** | `/orders?sel=A` — inline removable chips in the bar with "+N more" overflow | `/orders?sel=B` — second-row scrollable strip of ID cards (order #, customer, total, remove) | `/orders?sel=C` — aggregate chip "5 selected: #…, #… +2" expanding into a selection grid |
| **#8 Duplicate warning redesign** | `/orders?dup=A` — red count pill toggles duplicate-only filtering; paired rows get left-rail + pair tokens | `/orders?dup=B` — red button opens duplicate-groups dropdown (why-matched, View); rows get linked D1/D2 tags with counterpart highlight | `/orders?dup=C` — inline warning/filter strip; clustering with explicit "Duplicate of #XXXX" labels |

Combine freely, e.g. `/orders?sel=C&dup=A`. Screenshots: `~/Downloads/shohozbiz-prototypes/sel-A-chips.png`, `sel-B-strip.png`, `sel-C-summary.png`, `dup-A-pill.png`, `dup-B-groups.png`, `dup-C-cluster.png`.
When you pick (or mix) a winner I'll fold it into the real code and move the prototype set to a throwaway branch as the prototype process requires.

## Known gaps / follow-ups (out of scope, flagged)

1. `useStoresList` ([useStoresList.ts](src/hooks/useStoresList.ts):67) still swallows fetch errors — if the stores query fails, the load silently runs selling-point-scoped. Suggest exposing an error/ready flag (shared hook used by dashboard).
2. Row quick action "Mark Ready to Ship" still requires `status === "processing"` — not extended to `"pending"` (kept unchanged per minimal-change rule).
3. The Order Info measurement affordance is intentionally **not** gated on `pos_custom_measurements_enabled` (that toggle is documented as POS capture; order-level deferred entry is a domain guarantee) — say the word if product wants it gated.
4. `CreateBusinessForm`'s SaveButton instance is dead code (never rendered) — left untouched.
