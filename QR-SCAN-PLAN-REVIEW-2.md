# Plan Critique Round 2 — QR-SCAN-IMPLEMENTATION-PLAN.md (v2)

Reviewer: plan critic, round 2 of the convergence loop.
Inputs: `QR-SCAN-IMPLEMENTATION-PLAN.md` (v2, 486 lines) vs. the codebase at repo root, and `QR-SCAN-PLAN-REVIEW-1.md` (round 1: C1–C6, D1–D10, M1–M7).
Method: every v2 claim that could be checked was checked against migrations, `src/`, and `supabase/functions/`. Citations below are `file:line` as verified today.

**Verdict:** v2 is a substantially honest rewrite — 20 of 23 round-1 findings are fully resolved and nearly every citation I re-verified is accurate. However, the rewrite introduced **3 new critical gaps** that round 1 missed, all in the multi-business/RPC layer the plan now leans on: an order→business mapping that doesn't exist (N2), a store-scope check that diverges from the app's real access semantic (N1), and a filename collision with a live POS hook (N3). Fix those three plus the smaller items below and the plan is implementation-ready.

---

## Fix Verification (round-1 findings)

### C1 — RLS claim false / cross-business — **RESOLVED**
- v2 §2 (`PLAN:49`) now states orders RLS correctly: wide-open policy dropped at `20260415001620_de241fc2…sql:24` (verified — `DROP POLICY IF EXISTS "Authenticated users can manage orders"`), SELECT for all authenticated (`:26-27`), INSERT/UPDATE/DELETE gated on `public.has_role(auth.uid(),'admin'|'staff')` (`:29-39`) — all verified verbatim. `order_timeline` INSERT staff/admin (`:129-131`) verified.
- §3.3 (`PLAN:101-121`) adds the in-RPC role check with a **`forbidden`** result (§6.2 `PLAN:275`) plus store scoping via `get_user_store_ids`. Both functions exist with exactly the call shapes the plan uses (see Verified Correct §1–2). Grants are specified (`PLAN:230-232`) and match the cited convention (`20260831000200:116-117` verified).
- Residual issue with the *reimplementation* of store scope — see new Critical N1 (the plan misses `permission_settings.enforce_store_scoping`).

### C2 — Measurement slips have no barcode — **RESOLVED**
- §2 `PLAN:46`: "Measurement slips have NO barcode/QR — order number is styled HTML text only." Re-verified: `MeasurementSlipPrint.tsx` imports (`:1-6`) contain no barcode/jsbarcode/qr import; `printMeasurementSlip` renders the number from a plain `orders` select (`:102-108`); template flags (`:64`) include `show_order_number` but no code flag.
- §1 story 2 (`PLAN:30-32`) and the Phase 2 title (`PLAN:415`: "works with **existing pickup slips** via CODE128; measurement via manual entry") + rollout note (`PLAN:440-442`) now scope the claim correctly.

### C3 — `order_number` not unique per store — **RESOLVED**
- §2 `PLAN:51` states there is **no uniqueness constraint**, lists the only two unique indexes — both verified: `(woo_order_id, store_id)` at `20260407131138…sql:9`, partial `consignment_id` at `20260831000000_attach_pathao_parcel.sql:7-8`. POS global-sequence decoration verified (`20260425220731…sql:78-80`, seq `20260425215805…sql:12`); Woo per-store number claim verified at `woo-sync/index.ts:652` (`order_number: `${wPrefix}${baseNum}${wSuffix}``).
- `ambiguous` is a first-class result code (§6.2 `PLAN:274`) with candidates payload and a resubmission contract (`p_order_id` + `p_store_id`), and §6.3 (`PLAN:283-285`) says "never silently advance on a multi-match". RPC spec §5 step C (`PLAN:212-218`) implements 0/1/many resolution with store scope. Phase 2 item 8 (`PLAN:421`) and §11 (`PLAN:450-452`) test the multi-store collision. Coherent end-to-end.

### C4 — Woo echo guards — **RESOLVED**
- §7 item 10 (`PLAN:329-335`) adds `'picked_up'` to `LOCALLY_ADVANCED` in **both** `woo-webhook/index.ts:392-395` and `woo-sync/index.ts:703-706` (both sets verified to exist at exactly those lines, `picked_up` absent from both today) **and** `reverseMapStatus` (`woo-push/index.ts:533-553` verified; fallback `map[status] || "processing"` at `:552`) → `'completed'`. Failure walkthrough included (`PLAN:333-334`).
- Phase 1 item 4 (`PLAN:411-412`) explicitly pulls this into Phase 1 with the rationale. §11 (`PLAN:453-454`) makes the echo-cycle the first UAT test.

### C5 — `promotePreOrderOnSlipPrint` collision — **RESOLVED**
- Promotion verified exactly as v2 describes: `MeasurementSlipPrint.tsx:13-58`, update at `:48`, skip-list at `:23`, detection at `:34-44`, timeline `trigger: measurement_slip_print` at `:53`.
- §4 (`PLAN:160-167`) re-seeds: primary `pre_order_making → pre_order_ready`; `pre_order_pending → pre_order_ready` documented as stale-slip/manual-entry semantics with a deactivate escape hatch; `processing/on_hold/pending` rows deliberately rejected. Collision documented (`PLAN:169-171`), risk row `PLAN:473`, resolved decision 2 `PLAN:483-485`. Note `orders` does carry `pickup_slip_printed_at` / `measurement_slip_printed_at` (seen in `Orders.tsx:209`), consistent with the print-stamp workflow v2 builds on.

### C6 — Permissions — **RESOLVED**
- §3.5 (`PLAN:132-143`): `orders.change_status` exists in the enum (`20260420112330…sql:14` — verified), generated type `types.ts:3285-3291` — verified, `PERMISSION_GROUPS` label "Change order status" at `usePermissions.tsx:91` — verified. No `ALTER TYPE`, no types regen, no catalog edit; route guard snippet (`PLAN:384-386`) uses it; `orders.view` explicitly rejected; dual gate (UI grant vs DB app_role) documented (`PLAN:139-141`), which matches reality: the viewer preset grants only view permissions (`20260420112330:225-227`).

### D1 — Rules table not business-scoped — **RESOLVED (with a new hole, see N2)**
- §3.2 (`PLAN:87-97`): `business_id uuid NULL = global default`, per-business override, cites the new-tables rule (`20260904000100:338-348` — verified) and the correct RLS precedent: `custom_roles` admin-only (`20260420112330:73-76` — verified), explicitly rejecting `audit_log` (staff INSERT, no UPDATE/DELETE — verified at `20260415001620:265-273`).
- But the RPC's rule resolution step ("business_id IN (order's business, NULL)", `PLAN:220`) presumes an order→business mapping that does not exist — Critical N2.

### D2 — `pre_order` tab double-listing — **RESOLVED**
- §7.1 (`PLAN:309-312`): `picked_up` added to `TabKey`/`ALL_TAB_KEYS`/`matchesTab` **and** to the exclusion list. Verified the list is where v2 says: `tabFilters.ts:135-140` (`!["cancelled","returned","ready_to_ship","shipped","delivered"]…`). §11 unit test (`PLAN:449`) covers it.

### D3 — Blast radius — **RESOLVED** (all five additions real; two line citations drift slightly, see N9)
- `StatusBadge.tsx:1-17` — verified: generic `statusStyles` map exactly there, no `picked_up`.
- `OrderPipeline.tsx` — verified: stage matchers at `:41` (processing), `:51` (processing+consignment), `:61` (shipped), `:71` (delivered) — a scanned `picked_up` order matches no stage. (A `pending` stage also exists just above; §7.7's phrasing "match only processing/shipped/delivered" is slightly loose but the conclusion holds.)
- `useDashboardData.ts:237-255` — verified: fixed key set, `k in c` guard at `:252`; `NON_REVENUE_STATUSES` at `:50` — verified, and v2's "no change, picked_up stays revenue-bearing" note is correct.
- `OrderDetailSheet.tsx:1951-1960` — verified: manual status `<Select>` has no `picked_up` (and no `on_hold`).
- `OrderFilters.tsx` / `OrderBulkActionsBar.tsx` — verified substance (no `picked_up` in either menu); line ranges drifted (N9).

### D4 — Store context for legacy path — **RESOLVED**
- §6.3 item 1 (`PLAN:279-282`) + §9 UX (`PLAN:392-394`): store filter chip sourced from `usePermissions.storeIds` + stores list, empty-array users "see all stores and *should* pick one", ambiguous card as safety net, and "a selected store never *authorizes* cross-store scans, the RPC does that". Matches the verified semantics of `usePermissions.tsx:10,59`.

### D5 — Undo vs push queue — **RESOLVED**
- §6.4 (`PLAN:294-303`): both pushes named, `skip_woo_note: true` supported (`orderTimeline.ts:7,49` — verified), "net Woo state ends correct; brief flip accepted; debounced undo out of scope".

### D6 — Timeline attribution — **RESOLVED**
- §3.3 (`PLAN:114-117`) + §5 notes (`PLAN:253-256`): `profiles.full_name` read inside the SECURITY DEFINER function (`profiles` verified at `20260412161413…sql:6-13`, `full_name` at `:9`), `user_id = auth.uid()`, RPC-vs-client attribution asymmetry documented.

### D7 — `SlipOrderData.id` — **RESOLVED**
- §8.1 (`PLAN:341-344`): type at `pickupSlipHtml.ts:5-14` verified — **no `id`** — with runtime `any`-cast carriers verified (`PickupSlipPrint.tsx:27-28`; `Orders.tsx:209` selects `id`). Phase 3 item 9 makes it explicit.
- Small over-generalization: the measurement slip does **not** consume `SlipOrderData` — it builds its own document from `printMeasurementSlip(orderId)` (`MeasurementSlipPrint.tsx:102-104`), where the id is already a parameter. Phase 3 item 9's "pickup + measurement pipelines" implies a shared type that doesn't exist (Minor N10).

### D8 — Choice sheet unreachable with seed — **RESOLVED**
- §6.3 item 3 (`PLAN:286-289`): "edit-safety path: unreachable with the default seed"; §9 labels `ScanChoiceSheet` "(slip-type choice — edit-safety)".

### D9 — Lazy route chunk — **RESOLVED**
- §3.4 (`PLAN:128-129`) + §9 (`PLAN:375-376`, route snippet `PLAN:383-387`). Verified `App.tsx:89-106` lazy + `PermissionGuard` pattern and that no `/scan` route exists yet.

### D10 — Undo is unregulated — **RESOLVED**
- §6.4 (`PLAN:300-303`): "deliberately an unregulated status change (same as runBulkStatus today)"; zinc fallback cited (`OrderBadges.tsx:77` — verified).

### M1 — §2 status-list citation — **PARTIALLY RESOLVED**
- `payment_pending` added and correctly sourced (`tabFilters.ts:124` — verified). Residual slop: `PLAN:43`'s parenthetical says `pending`/`on_hold` come "also from `OrderDetailSheet.tsx:1951`, `woo-mapping.ts:10`". The detail-sheet select has `pending` (`:1951`) but **no `on_hold` item** (verified `:1951-1960`); `woo-mapping.ts` contains `"on-hold"` only as a **Woo** status key that maps to `processing`/`payment_pending` (`:13`) — it never produces order status `on_hold`. `on_hold` as an order status appears only in detection lists (e.g., `MeasurementSlipPrint.tsx:34`). Conclusion (free-text column) unaffected; the citation is still half-wrong.

### M2 — Barcode citation — **RESOLVED**
- §2 `PLAN:45`: generated in `pickupSlipHtml.ts:100-101` (verified — `makeBarcodeSvg(order.order_number, …)`, gated on `tpl.show_order_number`), other consumer `invoiceHtml.ts:55` (verified `:54-55`), consumed via `buildPrintDocument` (`PickupSlipPrint.tsx:25` — verified).

### M3 — `show_qr` migration — **RESOLVED**
- §8.5 (`PLAN:355-357`): TS-default only, "no migration needed", merge semantics cited (`useInvoiceSettings.ts:223-226` — verified; defaults `:178-184`).

### M4 — Permission catalog pointer — **RESOLVED**
- §2 `PLAN:53` points at `PERMISSION_GROUPS` (`usePermissions.tsx:79-96` — verified) consumed by `RolesTab.tsx:157` and `UserAccessDialog.tsx:174` (both verified).

### M5 — iOS-PWA camera — **RESOLVED**
- §11 `PLAN:457-458`: "iOS Safari browser **and** installed-to-home-screen PWA… verify, don't assume."

### M6 — Test approach naming — **RESOLVED**
- §5 item 4 (`PLAN:234-237`) names the verify-then-drop convention; both cited exemplars exist (`20260901000190_verify_phase1_final_v2.sql`, `20260901000250_drop_phase1_verification_oracles.sql`). The `scanPayload` unit-test import precedent (`src/test/tabFilters.test.ts:3`) is cited in §9 and verified verbatim.

### M7 — `qrSvg.ts` sequencing — **PARTIALLY RESOLVED**
- File creation moved to Phase 3 (§8.2, Phase 3 item 10). But Phase 1 item 1 (`PLAN:406-407`) still installs `qrcode` + `@types/qrcode` with zero Phase-1 consumers — the same nit one level down. Trivial.

---

## Critical Issues (must fix)

### N1. The RPC's store-scope check diverges from the app's actual store-access semantic — it omits `permission_settings.enforce_store_scoping`
v2 §5 step B (`PLAN:210-211`) hand-rolls scope: `v_store_ids := get_user_store_ids(auth.uid()); (empty = all stores). Non-empty + order.store_id NOT IN v_store_ids → 'forbidden'`. But the codebase's canonical checker, `public.user_has_store_access(_user_id, _store_id)` (`20260420112330…sql:236-267`, which v2's own fact table cites at `PLAN:52`), has a **third leg the plan drops**:

```sql
SELECT enforce_store_scoping INTO v_enforce FROM permission_settings LIMIT 1;
IF NOT COALESCE(v_enforce, true) THEN RETURN true; END IF;   -- :251-254
```

Consequences of the divergence:
1. Any deployment running with `enforce_store_scoping = false` (i.e., store access unrestricted app-wide) gets **false `forbidden` cards from the scanner** for staff whose `user_store_access` rows don't include the order's store — while every other surface (Orders store filter, POS, `hasStoreAccess` in `usePermissions.tsx:56-61`) permits them. The scanner would be the *strictest* surface in the app by accident, not policy.
2. Two sources of truth for "who can touch this store" drift apart the first time someone edits either function.

Fix (one line of plan text): replace step B's hand-rolled logic with `IF NOT public.user_has_store_access(auth.uid(), v_order.store_id) THEN … 'forbidden'`. The function already exists, is `SECURITY DEFINER`, and encodes admin bypass + enforce flag + empty-mapping-means-all in one call. Keep `get_user_store_ids` for the *client-side* store-chip population (§6.3), where v2 already uses it correctly.

### N2. §5 step E's rule resolution — "business_id IN (order's business, NULL)" — is not implementable as written: **neither orders nor stores carry `business_id`**
v2's own fact table says orders have no `business_id` (`PLAN:50`), and the multi-business migration confirms: `orders` gets only `location_id`/`selling_point_id` (`20260904000100…sql:321-323`), while `stores` is explicitly left **un-scoped** — the migration states existing tables "(stores, pathao_integrations, courier_integrations) remain the credential stores" (`20260904000100:155-156`), and the generated `stores` Row confirms no `business_id` (`src/integrations/supabase/types.ts`, stores Row: `manual_order_prefix`, `pos_order_prefix`, `consumer_key`, … — no business column). Stores link to businesses only transitively via `brands.woo_store_id` (seed loop `20260904000100:480-485`) or `connectors.woo_store_id`.

So where does "the order's business" come from for rule resolution and for the per-business override the whole D1 fix depends on? The only candidate paths are:
- `orders.selling_point_id → selling_points.business_id` — works, but `selling_point_id` is a **nullable** FK on orders (POS orders can lack it; imported Woo orders may never get one);
- `orders.location_id → locations.business_id` — same nullability problem;
- `orders.store_id → connectors(woo_store_id) → business_id` — Woo-only; a POS-only store has no connector row.

An order with none of these populated (perfectly possible today) has **no business**, so per-business rules can never match and the RPC falls back to… what? The plan doesn't say. Fix in the plan: specify the derivation explicitly and its fallback order, e.g. `COALESCE(selling_point→business, location→business, connector→business)`, with "no business derivable → global (NULL) rules only" as the defined behavior. Otherwise the RPC author will improvise this in SQL, and the multi-business UAT row (`PLAN:463-464`) will test whatever they improvised.

### N3. `src/hooks/useBarcodeScanner.ts` **already exists** — the plan's Phase 2 filename collides with a live POS hook
§9 (`PLAN:366`) proposes creating `src/hooks/useBarcodeScanner.ts` as "zxing wrapper: getUserMedia…BrowserMultiFormatReader". That path is occupied by an existing 57-line hook that does something completely different: a **keyboard-wedge detector** (rapid keystroke buffering, `useBarcodeScanner.ts:1-57`) consumed by `src/pages/POS.tsx`. Outcomes if the plan is followed as written:
- An implementer "adds" the zxing wrapper to the existing file → merge chaos and two unrelated responsibilities in one hook;
- Or overwrites it → **POS barcode-gun input breaks silently** (the wedge hook has a POS-specific `data-barcodeEnabled` escape hatch at `:15-19`, so it is load-bearing).

Fix: rename the new hook (e.g., `useCameraScanner.ts`) in §9. Bonus: the existing wedge hook is exactly the "keyboard-wedge scanners land here too" path §6.4 (`PLAN:291`) wishes for — the plan should reference it instead of implying it will be built later.

---

## Design Concerns (should fix)

### N4. The SECURITY DEFINER RPC spec omits `SET search_path = public`
Every SECURITY DEFINER function in this repo pins its search path: `has_role` (`20260412161413…sql:42`), `user_has_store_access` (`20260420112330:241`), `get_user_store_ids` (`:304`), `enqueue_order_push` (`20260831000200:96` — the very function v2 cites as its grant convention). The §5 skeleton (`PLAN:201-232`) specifies LANGUAGE, SECURITY, and the grants but not the search-path pin. For a DEFINER function that is a documented hijack vector and a Supabase lint failure (`function_search_path_mutable`). One line: `SET search_path = public`.

### N5. The `auto` legacy path quietly surrenders §3.1's core guarantee, and its "multiple rules" response has no defined result code
- §3.1 (`PLAN:81`) sells "Slip type in the QR → a pickup-slip scan can never trigger a measurement-stage transition." True only for QR. In the legacy path the client passes `p_slip_type='auto'` (`PLAN:244-247`, `PLAN:283`) — so scanning the order number **printed on a pickup slip** for an order still in `pre_order_making` applies the *measurement* rule and advances production, because `auto` resolves by status, not by the physical slip in the operator's hand. This is a real, if edge, mis-scan vector (the very thing §3.1 was designed to kill); it deserves one honest sentence in §6.3 and/or a risk row in §12 ("legacy path is status-resolved, not slip-resolved"), rather than silence.
- The rule-choice response (one order, current status matches rules of both slip types → "return matched rules so the client shows the choice sheet", `PLAN:241-243` and `PLAN:286-288`) has **no entry in the §6.2 result-code table** (`PLAN:269-276`): is it `ok` with extras? A `choice` code? The candidate-disambiguation resubmission contract is spelled out; this one isn't (client must re-call with `p_slip_type = chosen` + `p_order_id`). Define the code, payload, and resubmission shape the same way §6.2 defines `ambiguous`.

### N6. The unique index key fights the documented `is_active` lifecycle
`uq_scan_rule (COALESCE(business_id,'000…'), slip_type, from_status)` (`PLAN:191-192`) has no `is_active` predicate, but §4 (`PLAN:161`) tells admins to *deactivate* the `pre_order_pending` row to get `no_rule` semantics — and an admin who deactivates and then creates a replacement rule for the same `(business, slip_type, from_status)` hits a unique violation against the dead row. Two partial unique indexes fix it cleanly and also retire the nil-UUID sentinel:

```sql
CREATE UNIQUE INDEX … ON scan_transition_rules (slip_type, from_status) WHERE business_id IS NULL AND is_active;
CREATE UNIQUE INDEX … ON scan_transition_rules (business_id, slip_type, from_status) WHERE business_id IS NOT NULL AND is_active;
```

(For the record, the COALESCE expression index **is** valid PostgreSQL syntax, `ON CONFLICT DO NOTHING` without a target works with it, and the `businesses` FK + `ON DELETE CASCADE` is correct — `businesses.id uuid PK` at `20260904000100:22-23`; deleting a business removes only its per-business rows and leaves global defaults alone. The nil-UUID-collides-with-a-real-business scenario is theoretical. The `is_active` interaction is the part worth changing.)

### N7. Legacy lookups have no usable index — every bare-number scan is a seq scan
The only index touching `order_number` is a GIN trigram (`idx_orders_order_number_trgm`, `20260422185726…sql:15`), which serves `LIKE/ILIKE/similarity`, not `=`. Step C's `WHERE order_number = p_order_number` (twice per ambiguous flow: resolve, then re-resolve) seq-scans `orders`. Fine at today's volumes; since the migration is already being written, a plain btree on `order_number` (or the N6 uniqueness discussion revisited) costs nothing and also speeds the ambiguous-card candidate query.

---

## Minor Issues (nice to fix)

### N8. Store-filtered legacy miss reports `not_found`, not `forbidden`
If the client passes a `p_store_id` the user can't access, step C's scope filter empties the result → `not_found` ("deleted order / bad payload / unknown number", `PLAN:273`) — misleading. Either pre-validate `p_store_id` against the caller's scope and return `forbidden`, or document that a store-filtered miss is indistinguishable from not-found.

### N9. §7 citation drift (substance unaffected)
- `OrderFilters.tsx` status select is `:118-133`; the plan's `:124-141` straddles it and the pre-order stage select (`:135-143`).
- `OrderBulkActionsBar.tsx` status menu items span `:52-60`; the plan's `:53-56` covers only four of nine items.
- `OrderPipeline.tsx` stage array starts ~`:28` (a `pending` stage exists above `:35`); `:40-78` is fine for the stages that matter.

### N10. Phase 3 item 9's "pickup + measurement pipelines" over-shares the `SlipOrderData` extension
The measurement slip doesn't use `SlipOrderData` at all (`MeasurementSlipPrint.tsx:102-104` — its own fetch and inline HTML, with the order id already in hand as the function parameter). The pickup extension (§8.1) is real and needed; the measurement QR needs only its own builder edit. Saying so prevents an implementer from hunting for a measurement-side consumer of the extended type.

### N11. Phase 1 installs `qrcode` + `@types/qrcode` with no Phase-1 consumer
M7 moved `qrSvg.ts` to Phase 3 but left the deps in Phase 1 (`PLAN:406-407`). Move the install to Phase 3 with the file.

### N12. RPC input validation for `p_slip_type` is unspecified
Nothing says the RPC validates `p_slip_type IN ('pickup','measurement','auto')`. Garbage input currently degrades to `no_rule`, which is confusing ("not eligible" for a typo). One CHECK/validation line in §5. Same slot: define behavior when both `p_order_id` and `p_order_number` are passed (precedence: id wins — say so).

### N13. §7.7 leaves a decision open inside a "full blast radius" list
"decide (v1: count into `delivered`-adjacent bucket or add a stage — pick one, document)" (`PLAN:323-325`). A convergence-loop plan should pick. Either is defensible; write the choice so Phase 1 item 3 is executable without a design meeting.

---

## Verified Correct (things v2 got right)

1. **`has_role` exists with the exact signature the RPC spec assumes**: `public.has_role(_user_id UUID, _role app_role) RETURNS BOOLEAN`, `SECURITY DEFINER`, at `20260412161413…sql:37-48`. The plan's `has_role(auth.uid(),'admin'|'staff')` idiom matches how every policy already calls it (`20260415001620:29-39`).
2. **`get_user_store_ids(auth.uid())` exists with that exact shape**: `(_user_id UUID) RETURNS UUID[]`, `SECURITY DEFINER`, `20260420112330:299-312` (the empty-array-equals-all semantic is even in the function comment at `:298`).
3. **"Empty array = all stores" is genuinely the app-wide semantic**: `usePermissions.tsx:10` ("empty = all stores accessible"), `:59` (`if (storeIds.length === 0) return true; // unrestricted`), and SQL-side `user_has_store_access` (`:256-260`). v2's statement is right as far as it goes — N1 is about the flag it omits, not this semantic.
4. **The COALESCE unique index is valid syntax and the FK/CASCADE behavior is correct** (see N6 for the `is_active` wrinkle): `businesses(id uuid PK)` verified at `20260904000100:22-23`; cascade deletes only per-business rule rows; global `NULL` rows survive.
5. **The ambiguous → resubmission contract is coherent end-to-end**: RPC returns candidates only after the caller's store-scope filter (§5 step C), so the card can never offer an order the user can't then update; the resubmit (`p_order_id` + `p_store_id`) re-enters the QR path where scope is re-checked. `Orders.tsx:209` already selects `stores(name)`, so candidate cards can show store names client-side too.
6. **Every §7 file:line target is real** (with N9's two drifts): `StatusBadge.tsx:1-17`, `OrderPipeline.tsx` matchers `:41/:51/:61/:71`, `useDashboardData.ts:237-255` + `:50`, `OrderDetailSheet.tsx:1946-1960` (10 items, no `picked_up`, no `on_hold`), `tabFilters.ts:135-140` exclusion list, `OrderTabs.tsx` (exists; `TabCounts` at `:9-24` will need the new key — covered by §7.2's "OrderTabs + Orders.tsx"). `ALL_TAB_KEYS` order (`tabFilters.ts:26-41`) places `delivered` before `returned/cancelled`, so "Picked Up after delivered" is a clean insert.
7. **§9's `logAction` call matches the real signature**: `logAction(action, entityType, entityId?, details?)` at `src/lib/auditLog.ts:3-8`; proposed `logAction('update','order_scan', …, {via:'qr_scan'})` fits the repo's `entity_type` family (`order`, `order_status`, `order_status_bulk`, `pickup_slip`, `measurement_slip`, …) exactly as `order_status_bulk` does at `useOrderBulkActions.ts:52`.
8. **The §2 fact table survived re-verification almost everywhere**: free-text status (CHECK created `20260407071618…sql:84`, dropped `20260407131231…sql:3`); no `picked_up` in `orders.status` (courier `picked_up` only in `CanonicalStatus`, `courier-adapter.ts:15`; `pickup_pending` tab is tracking-based, `tabFilters.ts:147-148`); `woo-mapping.ts:14` (`completed → delivered`); trigger `20260831000200:74-79` with status-distinct gate `:44` and echo guard `:38-40`; grant conventions `20260831000200:116-117` and `20260904000100:69-70`.
9. **`orders.deleted_at` exists** (`20260416153225…sql`), so §5 step D ("reject deleted_at rows → not_found") is implementable — and `TabOrder` already carries the field (`tabFilters.ts:91`).
10. **Migration naming and collision**: `20260910000000_scan_transition_rules.sql` matches the repo's `YYYYMMDDHHMMSS_name.sql` convention (e.g., `20260904000100_multi_business_foundation.sql`); no file with that prefix exists (all 134 migrations checked); the verify-then-drop follow-up pattern it cites is real.
11. **Sequencing is self-consistent**: Phase 2 needs only Phase 1 artifacts (RPC, Woo guards, parser); Phase 3 needs nothing from Phase 4; the §7.9 storefront deferral is safe — `src/storefront/` exists (21 files) but contains **zero order-status enumerations**, so the "if enumerated" hedge is accurate and nothing user-visible breaks between Phase 1 and Phase 4.
12. **PWA/library claims hold**: `public/manifest.webmanifest` + `public/sw.js` exist; `package.json` has `jsbarcode ^3.12.3` and no qrcode/zxing yet (plan installs them); zero `getUserMedia`/`BarcodeDetector` usage in `src/`; `App.tsx:89-106` lazy + guarded routes; no existing `/scan` route.
13. **Barcode gating detail the plan implicitly gets right**: the pickup-slip CODE128 is rendered only when `show_order_number` is on (`pickupSlipHtml.ts:100-101`) — a separate `show_qr` flag (§8.5) is the correct design rather than piggybacking on the number flag.

---

## Summary of required amendments

| # | Severity | Amendment | Where |
|---|---|---|---|
| N1 | Critical | RPC scope check → call `user_has_store_access(auth.uid(), store_id)` (picks up `enforce_store_scoping` + admin bypass); keep `get_user_store_ids` for the client chip only | §5 step B, §3.3 |
| N2 | Critical | Define order→business derivation (`selling_point → location → connector`, nullable-aware) and the no-business fallback (global rules only) for rule resolution | §5 step E, §3.2 |
| N3 | Critical | Rename the planned zxing hook (e.g., `useCameraScanner.ts`); reference the existing keyboard-wedge `useBarcodeScanner.ts` as the manual/wedge path | §9 |
| N4 | Design | Add `SET search_path = public` to the RPC spec | §5 |
| N5 | Design | Acknowledge legacy path is status-resolved not slip-resolved; define the rule-choice result code + resubmission shape | §6.2, §6.3, §12 |
| N6 | Design | Partial unique indexes `WHERE is_active` instead of the nil-UUID COALESCE key | §5 |
| N7 | Design | Add a btree index on `order_number` in the same migration | §5 |
| N8–N13 | Minor | `forbidden` for out-of-scope store filter; citation drift (OrderFilters `:118-133`, OrderBulkActionsBar `:52-60`); measurement slip doesn't use `SlipOrderData`; move qrcode deps to Phase 3; validate `p_slip_type` + param precedence; pick the OrderPipeline decision | §6, §7, §8, Phase 1 |

Round-1 scorecard: **20 RESOLVED, 2 PARTIALLY RESOLVED (M1, M7), 0 NOT RESOLVED.** New findings: **3 Critical (N1–N3), 4 Design (N4–N7), 6 Minor (N8–N13).**
