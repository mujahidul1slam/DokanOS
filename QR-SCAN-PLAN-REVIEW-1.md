# Plan Critique — QR-SCAN-IMPLEMENTATION-PLAN.md

**Critic role:** adversarial plan review against the actual codebase.
**Method:** every claim in the plan was traced to source: 134 migrations in `supabase/migrations/`, all edge functions in `supabase/functions/`, and the relevant `src/` files (read fully, not grepped in passing).
**Plan file:** `QR-SCAN-IMPLEMENTATION-PLAN.md` (347 lines; cited below as `PLAN:NNN`).
**Verdict:** the plan's architecture (rules table + atomic RPC + zxing scanner) is sound and idiomatic for this codebase, but it contains **two factually false "verified current state" claims** (the RLS policy and the measurement-slip barcode), **one false uniqueness premise** that silently corrupts the legacy-scan path, and **one missing Woo echo-guard integration** that will destroy the new `picked_up` status within seconds of the first scan. Do not implement until Criticals 1–6 are resolved.

---

## Critical Issues (must fix before implementation)

### C1. The plan's central security claim about orders RLS is factually wrong — the wide-open policy was dropped two months into the project

`PLAN:158-159` (§5 Notes):

> `SECURITY INVOKER` is fine — existing RLS lets authenticated users manage orders (`"Authenticated users can manage orders"` policy).

That policy **no longer exists**. It was created in `supabase/migrations/20260407071618_75b9cdbd-ffa1-48c1-bbce-54015ebc3c86.sql:98` and **dropped** in `supabase/migrations/20260415001620_de241fc2-26dc-493f-a9b1-3159a1e9267c.sql:24`. The current orders policies (`20260415001620:26-39`) are:

- `Authenticated can read orders` — SELECT for all authenticated (`:26-27`)
- `Staff and admin can write/update/delete orders` — INSERT/UPDATE/DELETE gated on `public.has_role(auth.uid(), 'admin'|'staff')` (`:29-39`)

Two consequences the plan must absorb:

1. **`SECURITY INVOKER` does not "just work" for every authenticated user.** A user with app_role `viewer` (the third role in the enum, `supabase/migrations/20260412161413_d2006eab-219f-4bd9-9489-6a3a448bef24.sql:3`) passes the route guard `permission="orders.view"` (`PLAN:261`) but the RPC's `UPDATE ... FOR UPDATE` and its `order_timeline` INSERT (RLS: staff/admin only, `20260415001620:129-131`) will both fail at RLS. The plan's default UX for that user is a stream of red error cards with no explanation. The RPC must return a distinct `forbidden` code, and the permission decision (C6) must not reuse a view permission.
2. **The plan's answer to "can anyone with an authenticated session scan any order from any business?" is never stated, and the answer is yes.** The multi-business migration deliberately left orders RLS untouched — `20260904000100_multi_business_foundation.sql:329-331`: *"RLS — new tables are business-scoped… existing tables untouched (§6 tightening)"*. Orders has no `business_id` (only `location_id`/`selling_point_id`, `20260904000100:321-323`), and the write policies check only the global `admin`/`staff` app_role — not `is_business_member`, not `user_store_access`. Any staff member of business A can therefore scan business B's pickup slip and mutate B's order. `p_store_id` (`PLAN:137`) is a *disambiguation hint*, not an authorization boundary. The plan should either (a) enforce store membership inside the RPC via `public.user_has_store_access()` (`supabase/migrations/20260420112330_bfd713d1-04d8-416e-a7e6-cae7f3d7a9f5.sql:236`) / `get_user_store_ids()` (`:299`) — noting `usePermissions` already exposes `storeIds` and `hasStoreAccess` on the client (`src/hooks/usePermissions.tsx:16`), or (b) explicitly document that scanning is cross-store by design. Silence here is a shipped security posture decision made by accident.

### C2. Measurement slips have no barcode at all — the plan's "verified fact" and Phase 2's headline claim are false for them

`PLAN:33` (§2 fact table):

> Slips already print with a vector-safe **CODE128 barcode** (`jsbarcode`) encoding the order number | `src/lib/barcodeSvg.ts`, `PickupSlipPrint.tsx`, `MeasurementSlipPrint.tsx`

`src/components/orders/MeasurementSlipPrint.tsx` (361 lines) contains **no** import of `barcodeSvg`, `jsbarcode`, or any barcode rendering — verified by full read. The only `makeBarcodeSvg` consumers in the codebase are `src/lib/pickupSlipHtml.ts:2` and `src/lib/invoiceHtml.ts:3`. The measurement slip renders order number as styled HTML text (`MeasurementSlipPrint.tsx:102-119`, template flags `show_order_number` etc. at `:64`) — nothing a scanner can read.

Consequences:

- `PLAN:41-43` ("slips already in customers' hands carry only the CODE128 order-number barcode") is false for measurement slips — existing measurement slips carry **nothing scannable**.
- `PLAN:292` (Phase 2 title: *"Scanner (works with existing printed slips via CODE128)"*) and `PLAN:314-316` ("staff scan the **existing** slips' barcodes… today") hold only for pickup slips. The measurement-scan flow (workshop user story, `PLAN:17-19`) is dead until Phase 3 QRs are in circulation — unless staff use manual order-number entry, which the plan does mention as a fallback (`PLAN:257`) but doesn't connect to this gap.
- Phase 3's "same with `dks1:M:`" for `MeasurementSlipPrint.tsx` (`PLAN:234`) is therefore not an *addition* to that slip, it's the first machine-readable code of any kind on it — a bigger layout/QA task than the plan implies.

Fix the fact table, the rollout narrative, and set expectations for user story 2's day-one reality.

### C3. "`order_number` is unique per store" is false — no constraint enforces it, and the legacy CODE128 path can silently resolve to the wrong order

`PLAN:39` (§2 fact table):

> Orders are multi-store/multi-business; `order_number` is unique **per store**, `id` (uuid) is global | `generate_pos_order_number` RPC, multi-business migration `20260904000100`

Neither cited source says this.

- There is **no UNIQUE constraint on `orders.order_number` anywhere**. The only unique indexes on orders are `(woo_order_id, store_id)` (`20260407131138_c15d416f-156a-4802-b928-050fe0da85b0.sql:9`) and a partial one on `consignment_id` (`20260831000000_attach_pathao_parcel.sql:7-8`). Verified across all 134 migrations.
- `generate_pos_order_number` (`supabase/migrations/20260425220731_9ac223b1-94fa-4de4-9ff0-fd9b8a17fcea.sql:66-82`) draws from **one global sequence** `public.pos_order_number_seq` (`20260425215805_97f2a200-ad49-4c04-81a5-fda1150e7021.sql:12`, `START WITH 3000`) and decorates it with per-store prefix/suffix. It guarantees a globally unique *sequence value*, not a unique string — and only for POS/manual orders.
- Woo orders get `order_number = ${wPrefix}${wooNumber}${wSuffix}` (`supabase/functions/woo-sync/index.ts:652`), where `wooNumber` is **per-Woo-store**. Two connected Woo stores with default empty prefixes both produce `"1042"`. A POS order that reaches sequence 3001 and a Woo store that reaches order #3001 in the same store produce two orders with `order_number = "3001"` **in the same store**. Neither collision is prevented at any layer.

The plan's legacy path (`PLAN:185-192`, §6.3) resolves `p_order_number` (+ optional `p_store_id`) and defines behavior for *slip-type* ambiguity (the action sheet) but is silent on **row ambiguity**: 0 rows, and >1 rows, after store scoping. This is not theoretical — it is the guaranteed steady state of multi-store Woo. The RPC spec (`PLAN:143-152`) must define: `not_found` for 0 rows, and a new `ambiguous` code (with the candidate orders' ids/numbers/stores) for >1 rows, with a client-side disambiguation card. Anything less risks **silently advancing the wrong order** — the plan's own worst-case risk (`PLAN:338`), unmitigated.

Also note the plan's `PLAN:59-60` confidence ("Order **uuid**, not order number → globally unique… no store disambiguation needed") is correct *for QRs*, which is exactly why the legacy path inherits all of this risk alone.

### C4. `picked_up` is missing from the Woo echo guards — the first scan of a Woo-linked order will be reverted by the webhook within seconds

The plan's §7 Woo integration (`PLAN:210-213`) covers only the *outbound* map. The *inbound* protection is the real hole.

Outbound (the plan anticipated this, correctly locating the map at `supabase/functions/woo-push/index.ts:533-553` — `reverseMapStatus`): with no `picked_up` entry, the fallback is `return map[status] || "processing"` (`woo-push/index.ts:552`). The plan says to add `picked_up → completed` — fine.

Inbound (missing from the plan entirely): both `woo-webhook` and `woo-sync` protect locally-advanced DokanOS statuses from being overwritten by Woo-derived statuses:

- `supabase/functions/woo-webhook/index.ts:392-395`: `LOCALLY_ADVANCED = new Set(["processing", "pre_order_pending", "pre_order_making", "pre_order_ready", "ready_to_ship", "shipped", "delivered"])`
- `supabase/functions/woo-sync/index.ts:703-706`: same set.

`picked_up` is in neither. Walk the loop for a Woo-linked scanned order:

1. RPC updates `orders.status = 'picked_up'`. The `trg_auto_push_order_status` trigger (`supabase/migrations/20260831000200_order_push_full_sync.sql:74-79`) fires on the UPDATE (row triggers fire for RPC updates exactly as for client updates — the plan's `PLAN:160-162` claim here is correct) and enqueues a push; `kickSyncWorker()` (`src/lib/wooNotes.ts:10-16`) drains it.
2. `woo-push` pushes `status: "completed"` to Woo (`woo-push/index.ts:415,436`).
3. Woo emits an `order.updated` webhook for its own state change. `woo-webhook` receives it: the payload's `woo_updated_at` is fresh, so the stale-guard (`woo-webhook/index.ts:382-385`) doesn't skip; `mapWooStatus("completed")` → `"delivered"` (`supabase/functions/_shared/woo-mapping.ts:14`); `existingOrder.status = "picked_up"` is **not** in `LOCALLY_ADVANCED` (`:397`) so the status fields are **not** stripped from the update payload.
4. `orders.status` flips `picked_up → delivered`. The `picked_up` status is silently destroyed — and because the webhook write stamps `woo_updated_at` (`woo-sync/index.ts:673` does the same on the sync path), the echo guard in `auto_push_order_to_woo` (`20260831000200:38-40`) suppresses the push-back, so nothing even alerts you.

**Fix:** the Phase 1 status-adoption work (`PLAN:288-289`) must include adding `picked_up` to both `LOCALLY_ADVANCED` sets (`woo-webhook/index.ts:392`, `woo-sync/index.ts:703`), plus the `reverseMapStatus` entry. Without it, the feature does not survive its first Woo-linked scan. This is the single most likely "worked in testing with POS orders, broke in production with Woo orders" failure in the plan.

### C5. The plan builds its default rules on a workflow it didn't verify: printing a measurement slip already auto-promotes `pre_order_pending → pre_order_making`

`src/components/orders/MeasurementSlipPrint.tsx:13-58` — `promotePreOrderOnSlipPrint()` runs on every measurement-slip print:

- If the order is in `pre_order_pending` (or is a detected pre-order in `processing`/`on_hold`/`pending`, `:34-44`), printing the slip sets `status = "pre_order_making"` (`:48`) with a timeline entry `trigger: "measurement_slip_print"` (`:53`).
- `:23` skips promotion only for statuses already at/ past making.

So in the real workflow, **any measurement slip physically in the workshop corresponds to an order already in `pre_order_making`** (or later). The plan's seed rules (`PLAN:101-102`):

| seed rule | reality |
|---|---|
| `measurement / pre_order_pending → pre_order_ready` (`PLAN:101`) | dead rule — a printed measurement slip for an order still in `pre_order_pending` only exists for legacy slips printed before this logic (or print-failure edge cases). Scanning one yields `pre_order_ready` even though production never marked complete — arguably the *wrong* transition for a stale slip. |
| `measurement / pre_order_making → pre_order_ready` (`PLAN:102`) | the rule that will actually fire. Fine. |
| User story 3 (`PLAN:20-22`): "I want scanning a `pre_order_pending` order to go to `pre_order_making`" | duplicates what print already does (`MeasurementSlipPrint.tsx:48`). |

The plan's open question 2 (`PLAN:346` — "pre_order_ready vs pre_order_making") is framed as if `pre_order_pending → pre_order_making` were a novel two-stage option; it's the **existing system behavior at print time**. The rules table as seeded is not harmful, but the plan's workflow narrative (`PLAN:17-19` user story 2: workshop scans measurement slip of a *pending* order) misdescribes day-one behavior, and rule 3 gives a stale/legacy slip a *more advanced* transition than the current status warrants. Decide explicitly: should legacy `pre_order_pending` slips resolve via `no_rule` (safest), or transition at all? Document the collision with `promotePreOrderOnSlipPrint` in the migration comment.

### C6. The permission story is unresolved in the plan, and its default ("reuse `orders.view`") guards a mutating action with a read permission — while the catalog is a Postgres enum the plan never migrates

Three sub-problems:

1. **`orders.scan` requires an `ALTER TYPE` migration the plan never writes.** `app_permission` is a Postgres ENUM (`supabase/migrations/20260420112330_bfd713d1-04d8-416e-a7e6-cae7f3d7a9f5.sql:6-55`), not a string catalog. Adding a key requires `ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'orders.scan'` — the exact precedent is `supabase/migrations/20260831000000_attach_pathao_parcel.sql:3` for `orders.attach_courier`. The plan's scan migration (`PLAN:113-155`, §5) contains no `ALTER TYPE`, and §9 hedges with "If the permission catalog is enumerated… add a dedicated `orders.scan` key" (`PLAN:265-266`). It **is** enumerated, definitively: the frontend type is generated from the DB (`src/hooks/usePermissions.tsx:6` — `Database["public"]["Enums"]["app_permission"]`, materialized in `src/integrations/supabase/types.ts:3285`), and the UI catalog is `PERMISSION_GROUPS` (`usePermissions.tsx:79-96`) consumed by `src/components/team/RolesTab.tsx:157` and `src/components/team/UserAccessDialog.tsx:174`. Shipping `permission="orders.scan"` in `App.tsx` without the ALTER TYPE + types regen + `PERMISSION_GROUPS` entry is a compile error at best and a silently ungrantable permission at worst.
2. **The route snippet guards a mutating action with `orders.view`** (`PLAN:261`). Combined with C1: a `viewer`-role user passes the guard, then every scan fails inside the RPC at RLS. Guarding mutation with a read permission also means POS-only staff (the primary scanners per user story 1) need `orders.view` — the full orders page — just to scan. Scanning **is** a status change; the catalog already has `orders.change_status` (`20260420112330:14`, UI label "Change order status" at `usePermissions.tsx:91`). That is the natural permission; a dedicated `orders.scan` is defensible, `orders.view` is not. The plan's open question 3 (`PLAN:347`) picks the wrong default.
3. **If `orders.scan` is added, existing grants don't come along for free** — `custom_roles.permissions` and `user_permissions` rows (`20260420112330:62,105`) store enum arrays; nobody has the new key until an admin grants it. Plan the rollout (default-grant to roles holding `orders.change_status`, or ship behind it).

---

## Design Concerns (should fix)

### D1. `scan_transition_rules` is global, not business-scoped — in a multi-business app

The plan's table (`PLAN:117-126`) has no `business_id`/`store_id`. The multi-business foundation (`20260904000100`) scopes every new domain table by business (`brands`, `locations`, `selling_points`, … `:338-348`) and the plan's own §12 treats multi-business as real (`PLAN:331`, `PLAN:339`). As designed, business A's admin edits the transition rules that govern business B's scans (and there is exactly one seed set for everyone). Either add `business_id uuid NULL` (NULL = global default, matching the `selling_points.is_default` style) or explicitly document that scan semantics are platform-global. Also note the plan's chosen RLS model ("INSERT/UPDATE/DELETE for admin only, follow the audit_log pattern", `PLAN:127-128`) doesn't match its cited precedent — `audit_log` grants INSERT to **staff and admin** and has no UPDATE/DELETE policies at all (`20260415001620:263-273`); the closer precedent for admin-only writes is `custom_roles` (`20260420112330:73-76`). Pick the right one deliberately.

### D2. The `pre_order` tab will double-list `picked_up` orders — the plan's tab adoption misses an exclusion

`src/pages/orders/tabFilters.ts:135-140`: the `pre_order` tab matches `pre_order_*` statuses **OR** (`preOrderOrderIds.has(o.id) && !o.consignment_id && !["cancelled","returned","ready_to_ship","shipped","delivered"].includes(o.status)`). `picked_up` is not in that exclusion list, so a pre-order-item order scanned to `picked_up` appears in **both** the `pre_order` tab and the new `picked_up` tab. The plan's §7 (`PLAN:204-206`) adds a `matchesTab` case but doesn't touch this exclusion. Same class of issue at `src/pages/Orders.tsx:611` and `:621` — tab-specific special-casing lists (`["pickup_pending","in_transit","on_hold","returned","delivered","cancelled"]` / `["delivered","in_transit","pickup_pending","ready","all"]`) that need a decision (probably: `picked_up` joins neither, since collected orders have no live courier cycle — but that's a decision to write down, not to discover in QA).

### D3. The status-adoption blast radius is larger than §7's list

`PLAN:204-214` lists `tabFilters`, `OrderTabs`, `OrderBadges`, storefront, Woo map, dashboard "if enumerated". The enumerations that exist and are missed:

- `src/components/StatusBadge.tsx:1-17` — generic `statusStyles` map (separate from `OrderBadges`); `picked_up` falls to the muted default. Harmless but inconsistent.
- `src/components/dashboard/OrderPipeline.tsx:40-78` — pipeline stages match only `processing`/`shipped`/`delivered`; `picked_up` orders vanish from the owner's pipeline view entirely.
- `src/hooks/useDashboardData.ts:237-255` — `statusCounts` has a fixed key set (`k in c` guard at `:252`); `picked_up` orders are counted nowhere. (`NON_REVENUE_STATUSES` at `:50` correctly *includes* picked_up orders in revenue — no change needed, worth stating.)
- `src/components/orders/OrderDetailSheet.tsx:1951-1960` — the manual status `<Select>`; decide whether staff can also set `picked_up` by hand (consistency says yes).
- `src/components/orders/OrderFilters.tsx:124-141`, `OrderBulkActionsBar.tsx:53-56` — status filter/bulk menus; add `picked_up` or scans create orders unreachable by those controls.

None of these breaks anything (the free-text column means nothing errors), but "status adoption" as a *phase item* should enumerate them so the tab isn't the only place a picked-up order exists.

### D4. "Active store context" for the legacy path is undefined — and it's mandatory, not optional

`PLAN:186-187`: "client passes its active store context as `p_store_id`". The scanner page is a **new** page with no store context: `Orders.tsx` keeps it in `storeFilter` state (`Orders.tsx:377`), POS in `selectedStoreId` (`src/pages/POS.tsx:329`), and the permission layer exposes `storeIds` from `get_user_store_ids` (`usePermissions.tsx:40`). Given C3 (numbers collide across stores, and can collide within one), the store selector on `/scan` is a **required** control with an explicit empty state for multi-store users — not an ambient "context" that's assumed to exist. Define: where it comes from, whether it's remembered, and what happens for users with `storeIds = []` (which means "all stores" per `usePermissions.tsx:10` — a terrible default for number resolution given C3).

### D5. Undo fights the push queue — plan only suppresses the *note*, not the *push*

`PLAN:196-198`: undo is a plain `.update({status: from})` "(skip Woo note)". But the note is the minor half: the original scan's UPDATE already enqueued a `push_order` (`20260831000200:76-79`) that will flip Woo to the mapped `picked_up` status (→ `completed` per the plan's own §7 decision), and the undo's UPDATE enqueues a second push restoring the Woo status. Net Woo state ends correct, but Woo admins see a completed-then-uncompleted churn, and `postWooOrderNote` mirroring in `addOrderTimeline` (`src/lib/orderTimeline.ts:45-72`) is skipped only if the undo timeline entry passes `skip_woo_note: true` (supported — `orderTimeline.ts:7,49`) — the plan should say that explicitly. Either debounce the undo window to within the queue's drain latency or accept and document the churn.

### D6. RPC timeline attribution can't literally "reuse the same `user_name` extraction shape" as the client lib

`PLAN:163-165` says to reuse `src/lib/orderTimeline.ts`'s attribution shape. That shape is `user.user_metadata.full_name ?? user.email` from the **client auth session** (`orderTimeline.ts:25-27`). A Postgres RPC has only `auth.uid()`; recovering the same `full_name` means reading `auth.users.raw_user_meta_data->>'full_name'` or `public.profiles.full_name` (`20260412161413:6-9` — note `profiles` is a separate table that is not guaranteed to be in sync with auth metadata). Pick one source, note that RPC-written and client-written timeline rows may attribute differently, and check `profiles` RLS read policy inside a `SECURITY INVOKER` call. Also: the codebase's callable-function convention is explicit `REVOKE ALL … FROM PUBLIC, anon` + `GRANT … TO authenticated` (see `enqueue_order_push`, `20260831000200:116-117`; `is_business_member`, `20260904000100:69-70`). The plan's RPC spec omits grants — add them, or anon can call `apply_scan_transition` (it will fail at RLS with `SECURITY INVOKER`, but the failure mode should be a revoked grant, not an RLS accident).

### D7. `SlipOrderData` doesn't carry `id` — the QR payload needs the uuid plumbed through the slip pipeline

`PLAN:231`: render `makeQrSvg('dks1:P:' + order.id)` in `PickupSlipPrint.tsx`. But `PickupSlipPrint` builds documents from `SlipOrderData` (`src/lib/pickupSlipHtml.ts:5-14`) which has `order_number`, totals, customer fields, `productItems` — **no `id`**. The runtime objects do carry `id` (`PickupSlipPrint.tsx:27-28` filters on `o.id`, and `Orders.tsx:209` selects it) via `any` casts, but the type doesn't declare it and `buildSlipPagesHtml` never receives it. Phase 3 must extend `SlipOrderData` and the builder signature — a small change, but it's load-bearing for the whole QR payload and the plan presents it as already-available (`order.id` "just works").

### D8. The legacy multi-match action sheet is unreachable with the seed rules — dead code shipped in Phase 2

With the seed set (`PLAN:99-102`), every `from_status` has at most one rule across both slip types (`pre_order_pending`→measurement only, `pre_order_making`→measurement only, `ready_to_ship`→pickup only, `pre_order_ready`→pickup only). The §6.3 "multiple matches → 2-button action sheet" (`PLAN:191`) and `ScanActionSheet.tsx` (`PLAN:256-257`) can only trigger after an admin edits rules into an overlapping state. Build it if you want edit-safety, but label it as such — as written the plan sells it as a day-one flow.

### D9. Scanner bundle should be a lazy route chunk — and the plan should say so

`@zxing/browser` (+`@zxing/library`) is roughly 80–90 KB gzipped — the heaviest dependency this app would take on (current deps are Radix + jsbarcode + recharts, `package.json`). `src/App.tsx` already uses `React.lazy` for pages (verified), so `/scan` can be a lazy route and the zxing code stays out of the main bundle. The plan never mentions lazy-loading; one line in §9 prevents a main-bundle regression on the Orders page that hosts the Scan button.

### D10. `runBulkStatus` today has no per-status eligibility checks — the scanner's strictness is *new* behavior, which is fine, but Undo restores `from_status` without re-checking

`src/pages/orders/useOrderBulkActions.ts:42-69` (`runBulkStatus`) blindly `.update({status})`s the selection — no rule table, no eligibility. The scan RPC being stricter is a deliberate improvement; but note the asymmetry: §6.4's undo (`PLAN:196-198`) also blindly restores `from_status` client-side. Two staff members — one scanning, one undoing, one bulk-editing — can interleave into states the rules table never sanctioned. For v1 this is acceptable (the column is free text and the UI tolerates unknowns — `OrderBadges.tsx:77` falls back to a zinc badge), but the plan should state that undo re-enters "unregulated status change" territory on purpose.

---

## Minor Issues (nice to fix)

### M1. The §2 status list is slightly wrong about its own citation

`PLAN:31` cites `tabFilters.ts` for statuses `pending, processing, ready_to_ship, … on_hold, pre_order_*`. In `tabFilters.ts`, `on_hold` is a **courier-tracking** tab (`tabFilters.ts:158-159`), and `pending` never appears as an order status there (it lives in `OrderDetailSheet.tsx:1951` and `woo-mapping.ts:10`). The list also omits `payment_status`-adjacent `payment_pending`, which **is** an order status (`tabFilters.ts:124`). The conclusion ("no CHECK, free text") stands; the citation is sloppy.

### M2. The barcode citation points at the wrong file

`PLAN:33` cites `PickupSlipPrint.tsx` for the barcode. The barcode is generated in `src/lib/pickupSlipHtml.ts:100-101` (`makeBarcodeSvg(order.order_number, …)`), which `PickupSlipPrint` consumes via `buildPrintDocument` (`PickupSlipPrint.tsx:25`). `invoiceHtml.ts:55` is the other consumer. Matters because Phase 3 edits the right file (`pickupSlipHtml.ts` header/footer builders), not the component.

### M3. The `show_qr` template flag may not need a migration

`PLAN:236-238` proposes a migration adding `"show_qr": true` to `invoice_settings.pickup_slip_template`. But `useInvoiceSettings.ts:223-226` merges DB jsonb over TS defaults (`defaultPickupSlipTemplate`, `:178-183`), so adding `show_qr: true` to the TS default alone lights it up for every business, and the settings UI can persist overrides. A migration is only needed if the flag must be per-row durable from day one. Either is fine — but the plan presents the migration as required; it isn't.

### M4. "team-manage roles" is the wrong pointer for the permission catalog

`PLAN:265-266` says "If the permission catalog is enumerated (`src/hooks/usePermissions.tsx` / team-manage roles)". The `team-manage` edge function (`supabase/functions/team-manage/index.ts`) does invitation/role plumbing with no permission enumeration (verified — it only touches `user_roles`/`invitations`, admin-gated at `:35`). The catalog is `PERMISSION_GROUPS` in `usePermissions.tsx:79-96` consumed by `RolesTab.tsx:157` and `UserAccessDialog.tsx:174`. Point implementers at the right files (see C6).

### M5. iOS-PWA camera claim is asserted, not evidenced

`PLAN:82-83`: "works on Android Chrome (the shop reality) and iOS Safari, **PWA included**." `getUserMedia` in iOS standalone PWAs has a history of restrictions (pre-14.3 blocked; later allowed with quirks). The UAT checklist does include iOS Safari (`PLAN:326`) — add "iOS installed-to-home-screen PWA" explicitly, since user story 1 (`PLAN:14-16`) is the PWA install path.

### M6. Test approach is consistent with the repo — say so and copy the oracle pattern

The plan's SQL integration tests (`PLAN:297-298`) match the repo's verify-then-drop migration convention (`20260901000190_verify_phase1_final_v2.sql` → `20260901000250_drop_phase1_verification_oracles.sql`, and the `2026083100038x` push-trigger series). And unit tests importing edge-function code already exist (`src/test/tabFilters.test.ts:3` imports from `supabase/functions/_shared/woo-mapping`), so `scanPayload` tests fit right in. No change needed — just naming the pattern would have saved the implementer discovery time.

### M7. Phase 1 puts `qrSvg.ts` (`PLAN:286`) ahead of any consumer (Phase 3) — harmless, but consider moving it to Phase 3 to keep Phase 1 shippable-behind-a-flag smaller

Self-explanatory; sequencing nit only.

---

## Verified Correct (things the plan got right)

1. **`orders.status` is free-text; the CHECK was dropped exactly where the plan says.** Created at `supabase/migrations/20260407071618_75b9cdbd-ffa1-48c1-bbce-54015ebc3c86.sql:84` (`CHECK (status IN ('pending','processing','shipped','delivered','cancelled','returned'))`), dropped at `20260407131231_dbbf8de6-d35b-418e-884f-5dd062c00da0.sql:3` (`DROP CONSTRAINT IF EXISTS orders_status_check`). `PLAN:30` is accurate. (A later migration also dropped the `source` check — `20260415171221:1` — same trajectory.)
2. **No `picked_up` order status exists anywhere today**, and the plan's distinction between a customer-collection `picked_up` and the courier canonical `picked_up` (`PLAN:87-91`) is correctly drawn: the courier `picked_up` lives in `CanonicalStatus` (`supabase/functions/_shared/courier-adapter.ts:15`, `adapters/pathao.ts:35-36`) and in tracking-tab bucket lists (`src/pages/orders/tabFilters.ts:62-71` — `PICKUP_PENDING_TRACKING` includes "Picked"/"Picked Up"), never in `orders.status`. The `pickup_pending` **tab** is courier-waiting (`tabFilters.ts:147-148`) — `PLAN:32` correct.
3. **`runBulkStatus` works exactly as described** (`PLAN:35`): `src/pages/orders/useOrderBulkActions.ts:42-69` — blind `.update({status})` → `addOrderTimeline` → `logAction` → fire-and-forget `kickSyncWorker()` (`:57`), which invokes the `sync-worker` edge function (`src/lib/wooNotes.ts:10-16`) whose claim RPC uses `SKIP LOCKED` (documented in the same file). The trigger-then-kick split the plan proposes for the scanner is the established pattern.
4. **`addOrderTimeline` accepts the plan's proposed shape** (`PLAN:35-36`): single-or-array `{order_id, event, description, metadata?}` (`src/lib/orderTimeline.ts:19-23`), with `skip_woo_note`/`woo_customer_note` metadata keys (`:7-9`) the plan's undo ("skip Woo note", `PLAN:198`) can use verbatim.
5. **The Woo push trigger exists, fires on status change, and fires for RPC-driven updates** (`PLAN:160-162`): `trg_auto_push_order_status` `AFTER UPDATE ON public.orders FOR EACH ROW` (`supabase/migrations/20260831000200_order_push_full_sync.sql:74-79`), enqueues on `OLD.status IS DISTINCT FROM NEW.status` (`:44`), coalesces per-minute (`:60-68`), and echo-guards `woo_updated_at` (`:38-40`). Postgres row triggers fire regardless of whether the UPDATE originates from a client or an RPC — the plan's reliance on this is sound.
6. **No QR/camera library is installed** (`PLAN:34`): `package.json` has `jsbarcode ^3.12.3` and nothing else in that space; zero `getUserMedia`/`BarcodeDetector` usage in `src/` (verified by scan). React 18.3.1 + Vite + SWC (`package.json`, `vite.config.ts`) — `@zxing/browser` is a reasonable choice for QR+CODE128 in one stream.
7. **Route/permission-guard pattern is as described** (`PLAN:38`): `src/App.tsx:91-105` wraps every page in `<PermissionGuard permission="…">`; `src/components/PermissionGuard.tsx:22-28` supports `permission`/`anyOf` with a loading-null and default fallback. A `/scan` route drops in cleanly.
8. **PWA claim holds**: `public/manifest.webmanifest`, `public/sw.js`, manifest linked in `index.html` (manual service worker, no vite-plugin-pwa — `vite.config.ts` has no PWA plugin, consistent with the plan's phrasing "installable").
9. **A Postgres RPC (not an edge function) is the codebase's pattern for authenticated mutations** (`PLAN:70-74`, §3.3): `generate_pos_order_number` (invoked from POS/manual/exchange flows — `src/pages/POS.tsx:371`, `AddOrderDialog.tsx:809`, `ExchangeDialog.tsx:249`), `enqueue_order_push` (`OrderDetailSheet.tsx:694`), `get_user_permissions`/`get_user_store_ids` (`usePermissions.tsx:39-40`), `reset_store_circuit_breaker` (`WooCommerceDetail.tsx:53`). The plan's RPC choice is idiomatic; edge functions are reserved for Woo/courier I/O and admin auth flows. (But see D6 on the missing GRANT/REVOKE.)
10. **The multi-business facts the plan leans on are real**: `businesses`/`user_business_access`/`is_business_member` exist (`20260904000100:22-70`), `orders` gained `location_id`/`selling_point_id` but no `business_id` (`:321-323`), and `store_id` remains the only scoping column on orders — so `p_store_id` for legacy disambiguation (`PLAN:137`) is indeed the only lever available (though its uniqueness premise is false — C3 — and its enforcement gap is real — C1).
11. **The pickup-slip barcode encodes the order number** (`PLAN:33`, for pickup slips): `src/lib/pickupSlipHtml.ts:100-101` — `makeBarcodeSvg(order.order_number, …)` — so the legacy CODE128 payload is a bare order-number string, exactly as `PLAN:61-62` assumes. The vector-safety viewBox normalization the plan wants to mirror (`PLAN:222-228`) is real and documented at `src/lib/barcodeSvg.ts:31-45`.
12. **Phase ordering is fundamentally right**: Phase 1 (RPC + `picked_up` adoption + Woo map) before Phase 2 (scanner) before Phase 3 (QR) is the correct dependency order, and the "Phase 2 alone is useful" rollout note (`PLAN:314-316`) is the right instinct — it just needs C2/C3 caveats (pickup slips only; unambiguous numbers only). `FOR UPDATE` + rule-based rejection does give the correct two-scanners-same-slip behavior (`PLAN:74`): the first scan commits; the second finds no rule from the new status and returns `no_rule` — serialized and self-limiting without any extra dedupe machinery. (The 5-second client dedupe at `PLAN:183` is belt-and-suspenders, not load-bearing — good.)

---

## Required plan amendments (summary)

| # | Amendment | Where in plan |
|---|---|---|
| C1 | Correct the RLS claim; add `forbidden` RPC code; decide cross-business policy (enforce `user_store_access` or document) | §5 Notes `:158-159`, §6.2 |
| C2 | Fix the measurement-slip barcode fact; re-scope Phase 2's "existing slips" claim to pickup slips | §2 `:33`, `:41-43`, Phase 2 `:292`, `:314-316` |
| C3 | Drop "unique per store"; define `ambiguous`/`not_found` for the legacy path; add a client disambiguation card | §2 `:39`, §6.3, RPC spec §5 |
| C4 | Add `picked_up` to both `LOCALLY_ADVANCED` sets + `reverseMapStatus`; move into Phase 1 | §7 `:210-213`, Phase 1 `:288-289` |
| C5 | Document the `promotePreOrderOnSlipPrint` collision; decide legacy `pre_order_pending` slip behavior | §4 rules, §12 Q2 |
| C6 | Resolve permission: `orders.change_status` (or `orders.scan` via `ALTER TYPE` migration + types regen + `PERMISSION_GROUPS`); fix route guard | §9 `:259-266`, §12 Q3 |

*End of critique.*
