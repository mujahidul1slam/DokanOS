# End-to-End Verification — Issues #3, #16, #18–33 (Patch A + Patch B)

Date: 2026-10-27 (Asia/Dhaka)
Verified by: browser-driven E2E against the local dev server, cross-checked against source and unit suites.
Code under test: `Frontpage` @ `544f0fb` ("docs: changelog entry for the NEXT PATCH (#17)") — the pushed patch set.
Runtime: `npm run dev` (Vite) at `http://localhost:8080/`, live Supabase project, business "Enveil Vincent" (3,106 all-time orders, 225 products) + "Arekta Geek Store" (empty) for scoping.
Unit suites: **477 passed / 3 skipped (38 files)**, `tsc --noEmit` clean.

> Method note: verification used the live UI (DOM/accessibility-level assertions, real user input events) plus code reading for paths the environment could not reach. Print HTML was captured by stubbing `window.open`, so slip content was verified byte-level without printing.

---

## Result matrix

| # | Title (short) | Result | Notes |
|---|---|---|---|
| 3 | City/Area autofill accuracy | **PASS** | contains-matching, scoped fuzzy match, address autofill |
| 16 | Business switching scopes data | **PASS w/ 1 residual defect** | scoping airtight; sidebar categories query still broken |
| 18 | Parcel cancel/replace + edge cases | **PARTIAL (blocked)** | UI wording/dialogs verified; all booking paths blocked by invalid Pathao credentials (401) |
| 19 | Add Order: images + customer autofill | **PASS** | images load; "Existing customer" + Fill semantics verified |
| 20 | Size/variation picker (Order Info + Exchange) | **PASS** | picker, size rows, name convention, preset prefill |
| 21 | Brand/SP/Pathao selection rules + defaults | **PASS** | rules, defaults UI, brand column; 2 dead guard toasts (cosmetic) |
| 22 | Branded identity strip + smart dispatch | **PASS** | strip, grouping, non-default warning, batch controls |
| 23 | Create & Dispatch + retry + courier descriptions | **PASS** | validation, failure→retry idempotency, toggle default OFF |
| 24 | Print upgrades | **PASS** | slip elements, "(default)" marker, thermal mono, bold, POS daily |
| 25 | Settings sticky bar + route-away guard | **PASS w/ 2 defects** | all 5 flows work; bar position defeated by shell CSS; most tabs unguarded |
| 26 | Products hover/tap image preview | **PASS** | 224px layer, fixed/pointer-events:none, Escape/toggle, no-image case |
| 27 | Payment gate + rename | **PASS** | rename everywhere, locks, toast, confirm panel, release, timeline/audit |
| 28 | Measurements: deferred, cascade, overrides | **PASS** | scope prompt, exclusions, badges, never-measure, pending markers |
| 29 | Duplicate-order warning | **PASS w/ 1 display bug** | live warn, dismiss, never blocks; pairs listed twice (A,B + B,A) |
| 30 | Same-customer merge (pre-entry) | **FAIL (blocking bug)** | UI spec-perfect; persistence always fails (SELECT omits `source`) |
| 31 | Order split + payment transfer | **PASS** | money semantics exact, both timelines, links |
| 32 | Brand/SP change from Order Info | **PASS** | re-resolution, zero-SP block, timeline, list column |
| 33 | Fuzzy product search (Add Order + POS) | **PASS** | Bangla↔Latin, mid-word, exact-SKU short-circuit, partial SKU; parity |

---

## Bugs found (live)

### 🔴 BUG-1 — Order merge is 100% broken (issue #30)
- **Symptom**: every merge fails with toast `Merge failed | null value in column "source" of relation "orders" violates not-null constraint`.
- **Root cause**: `fetchMergeOrderDetails` ([MergeOrdersDialog.tsx:63](../../src/components/orders/MergeOrdersDialog.tsx#L63)) selects
  `id, order_number, status, consignment_id, deleted_at, customer_name, customer_phone, subtotal, discount, shipping_cost, tax_amount, total`
  — it omits **`source`, `store_id`, `selling_point_id`, `payment_status`**, yet `buildMergedOrderRow` ([mergePersistence.ts:55](../../src/lib/mergePersistence.ts#L55)) writes them from `merged.source` etc. (`orderMerge.ts:370`: `orders[0].source ?? null` → `undefined → null`). The INSERT violates NOT NULL on `orders.source`.
- **Secondary impact**: even with `source` fixed, `store_id` / `selling_point_id` / `payment_status` identity would be silently dropped (null), breaking the "merged result keeps its identity" acceptance.
- **Repro**: Orders → two same-customer same-state orders → "Merge 2 orders" → confirm.
- **Suggested fix**: add `source, store_id, selling_point_id, payment_status` to the SELECT (or `select("*")`), and add a persistence test with real-shape rows. Unit tests pass today because mocks carry the full field set.
- Everything else in #30 verified: grouping section copy, "Merge possible" badge, dialog (Items Rollup, "PAYMENT RECORDS (0 — MOVED, NEVER RE-CREATED)", Total (sum of source totals) / Paid (payment union) / To collect, Charge Allocation), and the failure toast itself ("Merge failed" + message).

### 🟠 BUG-2 — Sticky save bar is only visible at page bottom (issue #25)
- **Symptom**: "You have unsaved changes" bar exists with Save/Discard but scrolls with the page; a user editing a field near the top of a tall settings tab never sees it.
- **Root cause**: `StickySaveBar` uses `sticky bottom-6` ([SettingsPage.tsx:450](../../src/pages/SettingsPage.tsx#L450)), but the shell ([DashboardLayout.tsx:20](../../src/components/DashboardLayout.tsx#L20)) is `min-h-screen` + `overflow-hidden`, so the **window** scrolls and `<main class="overflow-auto">` never becomes the scroll container — the sticky element stays pinned to `<main>`'s box, which is the document bottom. Measured: bar top 1682px at scrollY=0 (viewport 771px), only visible at scrollY=max.
- **Suggested fix**: `h-screen` shell (let `<main>` scroll) or `fixed bottom-6` positioning for the bar.
- All functional paths verified: bar on dirty, route-away dialog ("You have unsaved changes" / Stay / Discard / Save), Stay keeps edits, Discard (bar and dialog) drops edits, Save persists + navigates.

### 🟡 BUG-3 — Duplicate pairs listed twice (issue #29)
- **Symptom**: the Orders-page notice reads "Possible duplicate orders: A and B, **B and A**, C and D, **D and C** …" — every pair appears in both directions (e.g. 27 pairs → 54 entries).
- **Where**: [Orders.tsx:847](../../src/pages/Orders.tsx#L847) notice rendering (`Possible duplicate orders: {list}`), fed by pair detection that is not symmetric-deduped.
- **Fix**: dedupe unordered pairs before rendering.

### 🟡 BUG-4 — Toggle switches show OFF while features are ON (issue #24 settings)
- **Symptom**: on any business whose saved invoice/pickup template predates this patch, the new element toggles ("Brand name & logo", "Selling Point", "Order Source", "Pathao Account", "Dispatch Status", "Bold thermal text") all render **OFF**, while slips/previews/printing actually **show** those elements.
- **Root cause**: switches bind `checked={!!invoiceTpl[key]}` ([InvoiceSettingsTab.tsx:346](../../src/components/settings/InvoiceSettingsTab.tsx#L346)) but the generators use default-ON `tpl.show_pathao_account !== false` etc. ([pickupSlipHtml.ts:231,273,286,325](../../src/lib/pickupSlipHtml.ts#L231)). First click turns the switch ON with no visible change; only the second click hides the element (live-verified both ways).
- **Fix**: bind switches with the same `!== false` semantics (or migrate defaults to explicit `true`).

### 🟡 BUG-5 — Glossary wording: row actions still say "Parcel" (cross-cutting #6)
- Orders quick actions are **"Attach Pathao Parcel"** / **"Replace Pathao Parcel"** ([Orders.tsx:775,777](../../src/pages/Orders.tsx#L775)) while Order Info and the dialog say "Attach Pathao **Consignment**" ([OrderDetailSheet.tsx:1524,1872](../../src/components/orders/OrderDetailSheet.tsx#L1524), [AttachParcelDialog.tsx:208](../../src/components/orders/AttachParcelDialog.tsx#L208)). Glossary mandates "Consignment" everywhere.

### 🟠 BUG-6 — Route-away guard covers only 3 of ~13 settings tabs (issue #25)
- Only Profile / Business Account / General register dirty state (`useRegisterDirty`). Deferred-save tabs — **Invoice / Pickup Slip, Print Header, POS Settings, Measurements, Brand Settings…** — silently discard edits on navigation. This includes the very tabs this patch extended (#24, #28). Acceptance letter says "registered tabs", but the issue intent ("never silently lose edits") is unmet for most of Settings.

### 🔵 Environment blocker (not a code bug) — Pathao credentials invalid
- "Enveil Pathao" (and dispatch through it) returns `401 {"message":"Unauthorized User"}` from `POST /aladdin/api/v1/orders`. Consequently **no consignment can be booked or attached** in this environment. Verified graceful handling: order saved + `Retry dispatch` (idempotent — one order across repeated retries), verbatim error surfaced, batch dispatch leaves orders untouched. Blocking live coverage of: #18 replace/skip dialog, "Consignment Already Exists" / "Overwrite Previous Entry" / "Add as New Consignment", "Force Overwrite Locally", delete/cancel terminal no-op toasts, #22 partial-failure toast counts, #32 "Active consignment on another Pathao Account" warning. These are green in `parcelReplaceEdgeCases.test.ts` / `paymentGateWiring.test.ts` etc. Re-run live when valid Pathao test credentials are configured.

---

## Observations (low severity / to confirm)

1. **Add Order catalog excludes 9 of 225 products** ("216 products" shown) — e.g. "Beige karchupi" is findable on /products but absent from the Add Order catalog for any query ("beige" returns 20 products, none of them it). Likely visibility/price/store filter; worth a product-data audit.
2. **Customer "Since" date may be a month off**: the QA customer (created Oct 27) shows "Since Sep 27, 2026" on /customers.
3. **Dead guard toasts**: "Choose an active Selling Point first" / "Choose a Pathao Account first" ([BrandSettingsTab.tsx:496,530](../../src/components/settings/BrandSettingsTab.tsx#L496)) are unreachable — the Save buttons disable first (`:598,:623`); likewise "Enter a consignment ID" ([AttachParcelDialog.tsx:102](../../src/components/orders/AttachParcelDialog.tsx#L102)) — the Attach button disables on empty input. Safe UX, but the code comments/tests imply toast behavior.
4. **Measurement Slip Template has no live preview** (Invoice/Pickup Slip tabs have one each).
5. **Button pluralization**: bulk bar shows "Print Pickup Slip" (singular) but "Print Measurement Slips" (plural) for one order.
6. **Picker title wording**: the variation picker title is "Add product & size" (not "Choose product & size" as quoted in some spec text); helper "the size label is kept in the item name" is good.
7. **#32 zero-SP hint wording** differs from spec quote ("No active Selling Point is configured for this Brand. Add one in Stores." vs "Choose a Selling Point to save this identity change.") — behavior (save disabled) is correct.
8. **Business switcher lists two businesses named "Enveil Vincent"** (data quirk; verified each maps to different datasets — one holds the 3,106 orders).
9. The agent-cursor overlay text "click" appears in `innerText` reads — harness artifact, not app UI.

---

## What was verified, per issue (functional + visual)

### #3 City/Area autofill — PASS
- City dropdown **contains-matching**: typing "haka" lists "Dhaka" **and** "Dhakaaaaaaaa" (mid-fragment hits).
- Address autofill: "House 5, Mirpur 10, Dhaka" → City "Dhaka", Zone "Mirpur 10" auto-selected (scoped fuzzy city→zone; area left empty when unmatched); shipping auto-defaulted ৳80 (Inside Dhaka).
- Zone/Area gating consistent with parent selection. (Unmatched-address edge cases covered by `pathaoMatch.test.ts`.)

### #16 Business scoping — PASS + residual defect
- "Enveil Vincent" markers: Dashboard **3,106 all-time**, Orders **All 925/969 (live)**, Products **225**.
- Switch → "Arekta Geek Store": Dashboard **0 all-time**, Orders **All 0**, Products **0**, Analytics all ৳0 + "No data"; zero leakage of the other business's rows/customers/money; unions never appear. Switch back → data returns (3,106). Deep links across all four surfaces scoped correctly.
- Selling-point-only orders stay visible in their business (orders with `store_id` NULL appear in list and scoping).
- **Residual defect (acceptance item C)**: `AppSidebar.tsx:117-122` queries `categories` with `.eq('store_id', active?.id)` where `active` is the **business** id → the sidebar product-category area renders **nothing** for every business (empirically: sidebar shows only nav links for a business with ~30 categories). Fix: resolve the business's store ids first (as `useStoresList` does elsewhere).
- Unrouted dead `Dispatch.tsx` is gone (no `/dispatch` route).

### #18 Parcel cancel/replace — PARTIAL (env-blocked)
Verified: "Consignment" wording on Order Info ("Courier Entries", "No consignments attached to this order yet.", "Attach Pathao Consignment"), Attach dialog ("Attach Pathao Consignment — #N", "Enter the Pathao consignment ID…", Pathao Account selector preselected to the order's default, placeholder "e.g. DT2607XXXXXX", disabled-empty-button behavior). Blocked (Pathao 401): attach/replace flows, "Consignment Already Exists"/"Overwrite Previous Entry"/"Add as New Consignment", "Force Overwrite Locally", delete/cancel toasts incl. terminal-state no-op, active-consignment guards. Unit tests green.

### #19 Add Order fixes — PASS
- Mini catalog images load from the Woo CDN hotlinks (naturalWidth 1365+, `referrerPolicy` pattern in place); placeholder path for image-less products.
- Phone blur lookup: "01601608310" → inline **"Existing customer — arafat hossan mahi" + "1 previous order"** (singular grammar ✓) + **Fill** / Dismiss.
- Fill semantics: typed name **kept** ("QA Typed Name" preserved); empty fields populated when the customer has data. (No toast by design — the "Filled:" toast belongs to the AI-parse flow.)
- Note: one known customer's phone (01636239056) does not resolve through the lookup while canonical `01X` phones do — consistent with stored-format variance in `customers.phone`; multi-match picker path verified in code (`AddOrderDialog.tsx:1990-2016`) but no aliased phone was available live.

### #20 Variation picker — PASS
- Order Info "+ Add product to order…" → picker with **"Search products by name or SKU…"**, product rows "Name (SKU) — ৳price", then size rows (L/M/XL/XXL + "Custom"), helper "the size label is kept in the item name".
- Added lines render `Name - L` / `Name - M` convention (also on slips and merge rollup); totals recalc live.
- S/M/L presets **auto-prefill** measurement fields ("PRESET M" badge; slip prints "39.5 - 32 - 38.5 … in"). Out-of-stock "Out" badge exists in catalog contexts (no OOS variation encountered in the picker).

### #21 Brand / Selling Point / Pathao rules — PASS
- Multi-brand business: Add Order brand **starts clear**; first product auto-selects its brand ("Enveil"); Selling Point resolves to brand default with **"Default Selling Point"** sub-label; Pathao Account resolves to brand default ("Enveil Pathao · Pickup: Enveil").
- Mixed-brand cart: per-brand chips ("Enveil | … - L ×1" / "Vincent | … - S ×1") + dismissible warning "This order contains products from multiple Brands; the selected Brand remains the order identity." — brand stays at first product; Dismiss hides it.
- Brand Settings: "Order identity defaults" cards with "Defaults used by Add Order and courier dispatch. Brand, Selling Point and Pathao Account remain separate choices."; "Default Selling Point" / "Default Pathao Account" / "Default pickup store (optional)"; toasts **"Default Selling Point saved"** / **"Default Pathao Account saved"** verified (no-op re-saves of existing defaults — zero data change); empty-state hints verified on the brand without stores ("No active Selling Points…", "Connect a WooCommerce store to this brand…").
- Orders list **"Brand / Selling Point"** column with monogram/accent presentation ("Vincent | Showroom POS"); pickup slips show brand monogram + name + selling point.

### #22 Identity strip + smart dispatch — PASS
- Add Order strip above footer: Brand / Selling Point / Pathao Account segments with Pathao mark, account name + pickup store; changer popover lists accounts with **"Default"** badge + check; footer "Create Order" / "Create & Dispatch".
- Dispatch dialog: title **"Dispatch to Pathao (2 orders)"**, per-order rows (recipient fields, COD Amount, Weight, Special Instruction), **multi-brand grouping** — one group per brand with its default account ("Enveil Pathao · Pickup: Enveil" / "Vincent Pathao · Pickup: Vincent Official"), per-order **X** buttons with aria "Remove order #N from this batch", counts live-update ("Dispatch to Pathao (1 order)" → "Dispatch 1 Order(s)").
- Non-default selection warning **"This group will dispatch through a non-default Pathao Account (Enveil Pathao · Enveil)."** + Dismiss ✓. Empty batch → **"Dispatch 0 Order(s)" disabled** ✓.
- Not seen: "Default: {accountName}" strip caption from spec (default-ness shows via the popover "Default" badge instead). Reopen-resets-to-default is code-verified (`DispatchDialog.tsx:199`).

### #23 Create & Dispatch — PASS
- Two footer buttons present ("Create Order", "Create & Dispatch").
- Validation chain live: empty destination → **"Enter the customer address before dispatching"**; address w/o city → **"Choose a recipient City before dispatching"** (zone variant same handler); nothing created.
- Real run: order **EE-4666M** created and dispatch attempted → toast **"Order EE-4666M is saved, but dispatch failed | Pathao POST /aladdin/api/v1/orders failed [401]: Unauthorized User"**, footer switches to **"Retry dispatch"**.
- Retry idempotency: repeated retries keep reporting the same order (EE-4666M appears exactly once in the list) — no duplicate orders/consignments.
- Pathao Account popover carries the **"Courier product descriptions"** toggle with "Include product names, quantities and sizes on the courier label for {account}. Off by default." — switch state **false** by default ✓ (label sending itself is edge-fn behavior, unit-tested).

### #24 Print upgrades — PASS
- Settings: invoice + pickup "Bold thermal text (thermal)" toggles; pickup element toggles "Brand name & logo", "Selling Point", "Order Source", "Pathao Account", "Dispatch Status" all present; Live Preview (Thermal) iframes.
- Live pickup slip (captured HTML, EE-4666M): monogram "VI" + "Vincent" + "Showroom POS"; "SOURCE Fb/ig"; **"PATHAO ACCOUNT P · Vincent Pathao · Vincent Official (default)"** — "(default)" marker on undispatched slips exactly as designed (settings preview also shows the dispatched sample **without** "(default)" and "STATUS Dispatched · PTH-903211" vs "Not dispatched").
- Thermal daily print (POS Reports → **"Print Daily"** → **"Thermal (80mm)" / "A4"**): captured "POS Daily Summary" with Sales (Orders/Gross/Discounts/Returns/Net/Shipping/Tax/Total invoiced), Cash Collected (Collected/On prior orders/Refunds/Net cash), Fulfillment (Walk-in/Pickup/Delivery pending-done/Cancelled) sections; thermal output strictly monochrome (`@page size: 80mm`, colors #111 only) with bold applied via `thermalTextCss(.report, { bold: opts.bold !== false })`.
- Bold toggle verified at settings level: preview font-weight flips 700 ↔ 400 with the switch.
- Measurement slip carries the identity line (below).

### #25 Settings guard — PASS + 2 defects (BUG-2, BUG-6)
Functional: dirty → bar ("You have unsaved changes" + Save + Discard); route-away → dialog ("Leaving now will discard your edits…", Stay/Discard/Save) blocking navigation; Stay keeps edits; Discard drops (bar + dialog variants); Save persists and continues; beforeunload guard code-verified.

### #26 Products image preview — PASS
- Real click on thumbnail (aria "Preview image of …") pins the preview: `data-testid="product-image-preview"`, **222×222** (`w-56 h-56`), `position: fixed`, `pointer-events: none` (row actions never blocked), clamped inside viewport.
- Escape closes; re-click toggles open/closed; hover path code-verified (`pointerType !== "touch"`).
- Image-less rows expose no preview trigger (only checkbox + actions) ✓; 0 broken images across 200 rows (hotlink fallback in place).

### #27 Payment gate + rename — PASS
- Badge **"Payment Needs Confirmation"** on Woo online-payment orders (3 found) — zero "Payment Pending"/"Pending Payment" anywhere on Orders; status dropdown option, filter item and sheet all use the new label.
- Row action gate: "Attach Pathao Parcel" on gated order renders `aria-disabled="true"` + `opacity 0.5`; click → toast **"Order VC-10615W is locked — Payment Needs Confirmation"**, no dialog. Locked suffix "(locked — …)" lives in tooltips/overflow labels (code-verified; hover not scriptable).
- Order Info lock surface: "Consignment locked — Payment Needs Confirmation", "Locked — confirm the payment to enter with a courier", "Payment Needs Confirmation — consignment stays locked until the payment is confirmed.", status select disabled with "Locked — Payment Needs Confirmation".
- Confirm-payment panel (status `payment_pending`): heading "Payment Needs Confirmation", subtext "This order is on hold pending payment via non-COD method. Confirm the amount received — any remaining balance will be set as the COD amount for Pathao dispatch.", Method/Amount Received/Trx ID, button **"Confirm Payment Received"** ("Log Additional Payment"/"Log New Payment Attempt" variants for partial/failed — code-verified). Live partial payment ৳1,000 of ৳3,676: dynamic hint **"৳2,676 will remain due (collected on delivery)."** → gate released (status New Order), Payment Status "Partial", Total Paid/Due recalculated.
- Timeline + Activity Log: **"Status changed from \"payment_pending\" to \"processing\" (payment confirmed)"**, "Payment of ৳1,000 via bkash confirmed. ৳2,676 due — to be collected on delivery.", "Payment status changed to partial".
- Negative scope: manual Add Order orders never gate; dispatch-blocked semantics covered by `paymentGate.test.ts` (gate is status-agnostic — see note below).
- Note: gated **Delivered** orders keep the badge/locks (gate is payment-scoped by design per ADR-0001), and the confirm panel only renders while `status = payment_pending`; the generic "Log Payment" flow releases the gate in any state.

### #28 Measurements — PASS
- Deferred entry: orders save without measurements; nothing hard-blocks.
- Scope prompt live: assigning to category "Winter" (has children) → **"How should this group apply to \"Winter\"?"** + "This category has subcategories. Choose how far the assignment reaches — subcategories created later are resolved when products are measured, so nothing is frozen here." + three cards with exact copy ("All subcategories" / "Selected subcategories" / "All except excluded") + Cancel/Apply.
- "All except excluded" → live descendant list (6 children incl. "Winter Jackets") → exclusion → badge **"· except 1"** on the assignment (also "· all subcategories" / "· N selected" variants in code).
- Product Overrides: "Never measure" picker; chip **"1 product never measured"**; aria **"Remove never-measure override"**; copy "…a never-measure override wins over every category and product assignment; measurements can still be captured later at the order level."
- **Measurement slip captured live** (EE-4667M): identity line "Brand | Enveil | Pathao Account | Enveil Pathao · Enveil (default)" (#24), size-M preset values printed ("39.5 - 32 - 38.5 - 24.5 - 25 - 15 in" for both cascade-resolved groups), and the Custom-size line shows **"Measurements pending: Enveil Pant Measurements, Flared Pant"** — the exact `Measurements pending: {fields}` marker.
- Bonus verified: printing a measurement slip promotes a pre-order-category order "New Order" → "Making" with timeline "Status changed from \"New Order\" to \"Making\" — measurement slip printed" (by design: `promotePreOrderOnSlipPrint` treats pre-order-category products as pre-orders).
- Edge: "No measurements recorded for this order." alert when an order has no expected groups and no entries (hit live).

### #29 Duplicate warning — PASS + BUG-3
- Add Order live panel: **"Possible duplicate order"**, "A recent order from this customer shares this Brand and at least one product. Review before saving — this warning never blocks saving.", conflict listed **"#EE-4666M · … · shared: All Over Embroidery Punjabi - Black (L)"**, dismiss aria "Dismiss duplicate warning".
- Dismiss hides it; saving proceeds (created EE-4667M despite the warning) — warn-only ✓.
- Orders page notice lists pairs (but doubled — BUG-3);48h window + same-brand + ≥1-shared-product semantics per `duplicateOrder.test.ts`.

### #30 Merge — FAIL (BUG-1) with UI verified
- Grouping section: "Same-customer groups" + "2+ orders of one customer in one state — merge each group into a single order (pre-entry only)", panel "01700000001 | 2 orders in \"processing\" · combined ৳7,272 | **Merge possible**", "Merge 2 orders" button.
- Merge dialog spec-perfect (Source orders, Items Rollup "2 × ৳3,596", "PAYMENT RECORDS (0 — MOVED, NEVER RE-CREATED)" + "No payment records on the source orders.", Subtotal/Discount/Shipping/Tax/**Total (sum of source totals)**/**Paid (payment union)**/**To collect**/Payment status, "CHARGE ALLOCATION (EACH SOURCE IN FULL)").
- Confirm → **fails every time** (BUG-1). Post-merge behaviors (merged badge, "View merged order", read-only sources) not reachable live; unit-tested.

### #31 Split — PASS
- "Split Order — #EE-4666M": "Items to move" table (Product/Price/In order/**Move qty**/**Moves**) + "at least one line must stay on the original"; "New order payment" three cases with exact copy ("No money moves…", "Collect a new payment now and record it on the new order only.", "Move part of this order's recorded payment…") + "Money already recorded on this order is never duplicated — a transfer moves it."; "Payment to transfer" ("Pick a recorded payment…") + capped-transfer note; charge allocation ("Delivery charge (source ৳80)", "New order gets", "Leave blank to split it automatically…").
- Preview money-perfect: Original (keeps) Paid **৳1,000 → ৳500** "existing payments, adjusted for transfers"; New order Paid **৳500** "transferred from the original"; delivery 40+40=80 "split, never duplicated".
- Execute → **"Order split — new order #SPLIT-EE-4666M-669M created"**; list shows both sides exact (৳3,636 / Due ৳3,136 / Partial each; new order carries the transferred "bkash" method + parent naming convention).
- **Both timelines** written: new order "Created by splitting order #EE-4666M — All Over Embroidery Punjabi - Black - M ×1"; original "Order split — … M ×1 moved to new order #SPLIT-EE-4666M-669M; 500 transferred to the new order from this order's bkash" + audit entries.

### #32 Identity change — PASS
- "Order Identity" section: Brand select (options incl. "No Brand" concept for legacy), Selling Point select with "· Default" sub-label, "Pathao Account (default)" readout, helper "Saved with Save Changes. Changing the Brand re-resolves the Selling Point and the default Pathao Account above."
- Zero-SP brand ("safsdfsafsd"): hint "No active Selling Point is configured for this Brand. Add one in Stores.", account "Not configured", **Save Changes disabled** ✓.
- Valid change (Enveil → Vincent): Pathao readout re-resolves to "Vincent Pathao · Vincent Official"; Save enabled; toast "Order updated & synced"; timeline/Activity Log entry **"Order identity changed — Brand: \"Enveil\" → \"Vincent\", Selling Point: \"Showroom POS\" → \"Showroom POS\", default Pathao Account: \"Enveil Pathao · Enveil\" → \"Vincent Pathao · Vincent Official\""**; Orders list column flips to "Vincent | Showroom POS" immediately.
- Consignment-conflict warning path ("Active consignment on another Pathao Account") code-verified; live test blocked by the Pathao 401 (no consignment can exist).

### #33 Fuzzy product search — PASS (parity)
Add Order mini catalog **and** POS catalog ("Scan or search... (F1)"):
- Bangla "পাঞ্জাবি" → Punjabi products (transliteration folding) ✓
- Mid-word "zardosi" / "karchupi-style" partial words → ranked results ✓
- Exact SKU "EV-8536" → **exactly one** result (scanner short-circuit) ✓ (same in POS)
- Partial SKU "EV-85" → code-fragment tier (6 products) ✓
- "sky blue xl" (variation option words) → 5 products ✓
- Dead duplicate search wiring confirmed removed (one search UI in Add Order).

---

## Cross-cutting checks

1. **Gate × dispatch surfaces**: row/bulk/dispatch-dialog/Create-&-Dispatch all consult the gate (bulk skips + "Locked — Payment Needs Confirmation" toast per `paymentGateWiring`; DispatchDialog filters via `gateAllowedOrders`); release via payment unlocks every surface at once (verified on row/sheet; others follow the same predicate).
2. **Gate × merge/split**: merge preserves gate & identity code-side (`mergePersistence`; unreachable live due to BUG-1); split of gated parents → children `payment_pending` locked (`splitPersistence:297-305`, unit-tested).
3. **Identity consistency**: same Brand → SP → Pathao resolution in Add Order strip, DispatchDialog groups, Order Info, and Brand Settings defaults pre-fill all three (verified in each surface). Monogram+accent consistent across strip, orders list and slips ("VI" monogram on slip).
4. **Shared search engine**: identical results Add Order ↔ POS; product picker search also uses name/SKU matching.
5. **Markers × print**: pending markers and identity line render in both formats of the measurement slip; thermal mono + bold rules apply to slips (capture + unit tests).
6. **Consignment wording**: toasts/dialogs/sheet use "Consignment"; orders quick actions still "Parcel" (BUG-5).
7. **Business scoping × everything**: post-switch, Orders (badges/notices/groups), Products (previews/search), Dashboard, Analytics all re-scope; orders created during the session land in the active business and move with it (verified with the three test orders across switches).
8. **Duplicate × Create & Dispatch**: duplicate panel shows during dispatch builds and never blocks (verified).

---

## Test data created & cleanup status

| Item | State |
|---|---|
| Orders `#EE-4666M`, `#EE-4667M`, `#SPLIT-EE-4666M-669M` (+items, payment records bkash ৳1,000 with ৳500 transfer, timeline/audit entries, slip-print stamps) | Moved to **Trash** via bulk action ("automatically deleted after 15 days"). No permanent-delete exists in the UI (Trash rows offer Edit/Restore only). |
| Customer "QA VERIFY ORDER" (01700000001) | **Residual** — Customers UI has no delete action. Remove via SQL if unwanted. |
| Profile display name | Changed to "QA Verify Temp Name" for #25 Save test — **reverted & saved** to original. |
| Measurement group assignment ("Winter" cascade-exclusion) + never-measure override | **Removed** (group counts restored to 2/1/1; no "except" badges). |
| Invoice/pickup toggles flipped during #24 tests | **Not persisted** (tab saves only via "Save All Settings", never clicked). |
| Brand Settings defaults | No-op re-saves of pre-existing defaults (Showroom POS / Vincent Pathao) — no behavioral change. |
| Settings values otherwise | Untouched. |

## Suite results
- `npm run test` — 477 passed / 3 skipped, 38 files (includes `paymentGate`, `paymentGateWiring`, `orderMerge`, `mergePersistence`, `orderSplit`, `splitPersistence`, `duplicateOrder`, `parcelReplaceEdgeCases`, `productSearch`, `measurementRules`, `slipPrint`, `printPosDaily`, `settingsNavGuard`, `brandIdentity`, `orderIdentity`, `productImagePreview`).
- `npm run typecheck` — clean.
- Note: BUG-1 is invisible to `mergePersistence.test.ts` because mocks supply the full row shape; recommend an integration test over `fetchMergeOrderDetails` output.

## Re-verification after fixes (2026-10-28)

The reported defects were fixed and rechecked against the live app at `http://localhost:8080/`:

- **BUG-1 merge persistence: PASS** — two fresh same-customer QA orders (#EE-4677M, #EE-4678M) opened the spec-complete merge dialog and confirmed successfully. Toast: `Orders merged — #EE-4679M created from #EE-4677M, #EE-4678M.` The previous `source` NOT NULL failure did not recur.
- **BUG-3 duplicate pair display: PASS** — the notice now renders each unordered pair once (for example `VC-4675M and VC-4676M`, without the reverse pair too).
- **BUG-4 print toggle defaults: PASS** — Brand name & logo, Selling Point, Order Source, Pathao Account, Dispatch Status, and Bold thermal text all load `aria-checked=true`, matching the default-on generators.
- **BUG-5 wording: PASS** — live order row actions now say `Attach Pathao Consignment`.
- **BUG-2 sticky bar: PASS** — after the shell changed from `min-h-screen` to `h-screen`, a dirty Invoice/Pickup Slip tab shows the shared bar at the viewport bottom while the page is scrolled; Discard clears it.
- **BUG-6 settings guard coverage: PASS** — dirtying the Measurements tab triggers the same route-away guard; Discard navigates and clears the dirty state. Invoice/Pickup Slip dirty state also triggered it.
- **#16 sidebar categories: PASS** — Products now shows the active business's category tree in the sidebar (Pants, Flared Pants, Punjabi, etc.) instead of an empty Catalog section.
- **TypeScript/tests: PASS** — `npm run typecheck` clean; `npm run test` 477 passed / 3 skipped.

QA cleanup: the two source orders and merged result were moved to Trash after verification. The prior QA residue remains governed by the app's 15-day Trash purge; the customer UI has no hard-delete action.

## Recommended fix order
1. BUG-1 (merge persistence — feature unusable) · 2. BUG-2 + BUG-6 (settings guard reach/visibility) · 3. BUG-4 (toggle truthiness) · 4. BUG-3 + BUG-5 (display polish) · 5. observations 1–2 (product catalog filter, customer Since date).
