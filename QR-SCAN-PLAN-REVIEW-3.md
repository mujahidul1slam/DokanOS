# Plan Critique Round 3 — QR-SCAN-IMPLEMENTATION-PLAN.md (v3)

Reviewer: plan critic, round 3 (final) of the convergence loop.
Inputs: `QR-SCAN-IMPLEMENTATION-PLAN.md` (v3, 591 lines) vs. the codebase at repo root, `QR-SCAN-PLAN-REVIEW-2.md` (N1–N13), and `QR-SCAN-PLAN-REVIEW-1.md` (C1–C6/D1–D10/M1–M7).
Method: every v3 claim that could be checked was re-checked against migrations, `src/`, and `supabase/functions/`. `PLAN:nn` = line in `QR-SCAN-IMPLEMENTATION-PLAN.md` (v3). This is a research pass only — no code or plan files were modified.

**Verdict up front: CONVERGED.** All 13 round-2 findings and both round-1 residuals are fully resolved with accurate citations. No new critical issues. Four design concerns and five minors remain — all addressable with one-line plan amendments or migration-SQL hardening; none requires another review round.

---

## Fix Verification (round-2 findings)

### N1 — Store scope via canonical `user_has_store_access` — **RESOLVED**
- §3.3 (`PLAN:155-163`) now specifies `IF NOT public.user_has_store_access(auth.uid(), v_order.store_id) THEN 'forbidden'`, explicitly rejecting the hand-rolled `get_user_store_ids` reimplementation, and states `get_user_store_ids` is "used **client-side only**, for the store filter chip (§6.3/§9)". §5 step C (`PLAN:278-280`) repeats it with the rationale (admin bypass + `enforce_store_scoping` + empty-mapping-means-all, "one source of truth").
- Function verified verbatim: `public.user_has_store_access(_user_id UUID, _store_id UUID)`, `SECURITY DEFINER`, `SET search_path = public` (`20260420112330…sql:236-267`) — admin bypass `:247-249`, `permission_settings.enforce_store_scoping` flag `:251-254`, empty-mapping-means-all `:256-260`. Exactly the semantics the plan claims.
- Client chip side re-verified: `usePermissions.tsx:10` ("empty = all stores accessible"), `hasStoreAccess` `:56-61` (admin bypass `:57`, empty-array unrestricted `:59`). §6.3 (`PLAN:337-341`) and §9 (`PLAN:477-479`) both repeat "a selected store never *authorizes* cross-store scans — the RPC's `user_has_store_access` check does that."
- One residual nuance (chip may *under*-list what the server permits) → Minor M-2; not a fix failure.

### N2 — Order→business derivation defined, legs verified real — **RESOLVED** (with hardening notes → D1/D2)
- §3.2 (`PLAN:112-128`) defines the COALESCE chain (`selling_point → location → connector`) as literal SQL, plus the fallback "`v_business_id IS NULL` → GLOBAL (NULL) rules only" (`PLAN:123`). §5 step E (`PLAN:284-287`) instructs the SQL author to use exactly that chain ("Documented here so the SQL author doesn't improvise"). §11 adds a derivation-fallback oracle (`PLAN:546-547`). No canonical derivation function exists elsewhere in the repo to conflict with (`v_business_id` at `20260904000100:449` is a backfill local, not a helper).
- **Leg 1 — `selling_points.business_id`:** real, `uuid NOT NULL REFERENCES businesses` at `20260904000100:127` (table `:125-150`). PK lookup — scalar subquery safe.
- **Leg 2 — `locations.business_id`:** real, `uuid NOT NULL` at `20260904000100:100` (table `:98-114`). PK lookup — safe. (Currently unreachable in practice — see D2.)
- **Leg 3 — connectors:** real. `connectors.category` CHECK includes `'channel'` and defaults to it (`20260904000100:163-164`); `config jsonb` at `:170`; `business_id NOT NULL` at `:160`. The woo connector seed writes exactly the key the plan reads: `jsonb_build_object('store_id', v_store.id)` (`:539-541`), guarded by `(c.config->>'store_id')::uuid = v_store.id` (`:537`). JSON key **is** `'store_id'` — verified.
- The chain is SQL-correct for today's data, but leg 3 as written is a scalar subquery with no row-cap and a `::uuid` cast on jsonb text — two runtime failure modes under data shapes the schema permits. → Design Concern D1 (the only substantive residue of N2).

### N3 — Hook renamed `useCameraScanner.ts`; wedge hook referenced — **RESOLVED**
- §9 (`PLAN:448-452`): `src/hooks/useCameraScanner.ts` "**N3: renamed** — `useBarcodeScanner.ts` is occupied by the POS keyboard-wedge hook and must not be touched." Also Phase 2 item 6 (`PLAN:504`), revision history (`PLAN:15-16`), resolved decision 5 (`PLAN:590-591`).
- The existing wedge hook is correctly characterized and reused: §2 (`PLAN:59`) — verified `useBarcodeScanner.ts` is exactly 57 lines, POS-consumed (`POS.tsx:5`, `:169`), `data-barcodeEnabled` escape within the cited `:15-19` range (actual line `:18`); §6.3.6 (`PLAN:353-356`) reuses its wedge semantics for manual entry; §11 includes a POS-wedge regression row (`PLAN:554-556`). `useCameraScanner.ts` confirmed absent from `src/` today.

### N4 — `SET search_path = public` — **RESOLVED**
- §3.3 (`PLAN:145-148`) and §5 (`PLAN:264`). All three cited convention sites re-verified: `has_role` (`20260412161413:42`), `user_has_store_access` (`20260420112330:241`), `enqueue_order_push` (`20260831000200:96`).

### N5 — `choice` result code + status-resolved caveat — **RESOLVED**
- §6.2 (`PLAN:331`): `choice` defined — payload `{options:[{slip_type,to_status}]}`, UI sheet, resubmission shape "**resubmit with `p_slip_type = chosen` + `p_order_id`**", and the "unreachable with the default seed (each `from_status` has one rule)" note (verified: seed `from_status` sets are disjoint — pickup `{ready_to_ship, pre_order_ready}` vs measurement `{pre_order_making, pre_order_pending}`, PLAN:206-211).
- Status-resolved caveat in all three requested places: §3.1 (`PLAN:97-102`), §6.3.4 (`PLAN:347-350`), §12 risk row (`PLAN:575`). Consistent across all three.

### N6 — Partial unique indexes `WHERE is_active` — **RESOLVED**
- §3.2 (`PLAN:130-138`) and §5 (`PLAN:242-246`): `uq_scan_rule_global … WHERE business_id IS NULL AND is_active` and `uq_scan_rule_biz … WHERE business_id IS NOT NULL AND is_active`. Nil-UUID sentinel gone.
- **ON CONFLICT check (Part B #3): correct.** The seed (`PLAN:254`) says `ON CONFLICT DO NOTHING` *without a conflict target* — the form that works with partial unique indexes (any arbiter whose predicate the row satisfies). If a target were specified it would have to match the partial predicate; the plan doesn't specify one. Repo precedent for the target-less form exists (`20260904000210:17`). The four seed rows have distinct `(slip_type, from_status)` — no self-conflict.

### N7 — `order_number` btree — **RESOLVED**
- §5 (`PLAN:247-248`): `CREATE INDEX idx_orders_order_number_btree ON public.orders (order_number);` inside the migration — the right file (Part B #4: write amplification is one additional index on a low-write table; the plan's comment correctly states today's only `order_number` index is the trigram GIN, re-verified at `20260422185726:15`, which cannot serve `=`). §12 risk row (`PLAN:581`).

### N8 — Inaccessible store filter → `forbidden` — **RESOLVED**
- §5 step C (`PLAN:281-282`): "(N8) pre-validate `p_store_id` against caller scope: inaccessible store filter → `'forbidden'`, not `'not_found'`". §6.2 `forbidden` row (`PLAN:332`) and both test lists (Phase 2 item 8 `PLAN:510`; §11 `PLAN:543-544`) include the case.

### N9 — Citation drift fixed — **RESOLVED**
- §7.6 (`PLAN:390-392`): `OrderFilters.tsx:118-133` — verified: the status `<Select>` spans exactly `:118-133`. `OrderBulkActionsBar.tsx:52-60` — verified: exactly the nine `DropdownMenuItem`s. §7.7's OrderPipeline citation now reads "stage matchers at `:41/:51/:61/:71` (plus a `pending` stage ~`:28`)" — all verified (`OrderPipeline.tsx:27-30`, `:41`, `:51`, `:61`, `:71`).

### N10 — `SlipOrderData` scoped to pickup pipeline — **RESOLVED**
- §8.1 (`PLAN:417-424`): extension is pickup-only; "Measurement slips do NOT consume `SlipOrderData` (`MeasurementSlipPrint.tsx:102-104` — its own fetch, order id already the function parameter)… don't hunt for a shared-type consumer that doesn't exist." Verified: `SlipOrderData` (`pickupSlipHtml.ts:5-14`) has no `id`; `printMeasurementSlip(orderId)` at `MeasurementSlipPrint.tsx:102` does its own fetch (`:103-108`). Phase 3 item 9 (`PLAN:515`) says "pickup pipeline only".

### N11 — `qrcode` deps moved to Phase 3 — **RESOLVED**
- Phase 1 item 1 (`PLAN:491-492`): "`qrcode` + `@types/qrcode` move to Phase 3 with their first consumer (N11)". Phase 3 item 9 (`PLAN:515-516`) carries the deps. `package.json` verified: only `jsbarcode ^3.12.3`; no qrcode/zxing today.

### N12 — `p_slip_type` validation + id-wins precedence — **RESOLVED**
- §5 step 0 (`PLAN:268-270`): "`p_slip_type` IN ('pickup','measurement','auto') ELSE {'ok':false,'error':'bad_request'}; param precedence: `p_order_id` WINS when both are passed (say so, don't improvise)." §6.2 adds the `bad_request` row (`PLAN:333`).

### N13 — OrderPipeline decision made — **RESOLVED**
- §7.7 (`PLAN:393-398`): "**Decision (N13, made):** add `picked_up` to the `delivered` stage's matcher… Document in the component comment." Phase 1 item 3 (`PLAN:496-497`) executes it; resolved decision 4 (`PLAN:589`); §11 pipeline test (`PLAN:563`). Matchers verified at `OrderPipeline.tsx:41/:51/:61/:71` — `picked_up` currently matches none, so the decision is executable as written.

### M1 (round-1 residual) — **RESOLVED**
- §2 (`PLAN:53`) rewritten: `on_hold` "as an *order status* appears only in detection lists (e.g. `MeasurementSlipPrint.tsx:34`) — NOT in the detail-sheet select", and `woo-mapping.ts` "only has `on-hold` as a *Woo* status key mapping to `processing`/`payment_pending` (`:13`)". Both re-verified: `MeasurementSlipPrint.tsx:34` (`["processing","on_hold","pending"]` detection list), `_shared/woo-mapping.ts:13`, detail-sheet select `OrderDetailSheet.tsx:1946-1960` — exactly 10 items, `pending` at `:1951`, no `on_hold`.

### M7 (round-1 residual) — **RESOLVED**
- See N11. Deps and file are now both Phase 3.

**Scorecard: 15/15 RESOLVED, 0 PARTIALLY RESOLVED, 0 NOT RESOLVED.**

---

## Critical Issues

**None.** Nothing found in v3 blocks implementation on current data, contradicts the codebase, or leaves a round-2 critical unfixed.

---

## Design Concerns (should fix — one-line or one-sentence amendments; none reopens the plan)

### D1. The connector leg of the N2 chain is a scalar subquery with two unguarded runtime failure modes
§3.2 (`PLAN:119-121`) specifies:
```sql
(SELECT c.business_id FROM connectors c
  JOIN stores s ON (c.config->>'store_id')::uuid = s.id
 WHERE c.category = 'channel' AND s.id = order.store_id)
```
1. **Multi-row → runtime error.** This is a scalar subquery; if two `category='channel'` connectors reference the same store, every legacy scan of that store's orders raises `more than one row returned by a subquery used as an expression` (SQLSTATE 21000) — an uncaught 500, not one of §6.2's result codes. `connectors` has **no unique constraint** preventing this — only non-unique indexes (`idx_connectors_business`, `idx_connectors_category_type`, `20260904000100:177-178`). The one-row-per-store invariant exists only in the idempotent seed guard (`:535-538`), which is migration code, not a DB constraint. And this exact failure class already happened once in this repo: the foundation's pathao loop "cross-joined and produced two rows pointing at ONE integration" (`20260904000210:1-4`), requiring a rebuild migration. `connectors` is explicitly "provider-agnostic" (`20260904000100:153-156`) — a second channel connector (storefront/shopify wiring) is the roadmap, not paranoia.
2. **Cast → runtime error.** `(c.config->>'store_id')::uuid` throws `invalid input syntax for type uuid` if any channel connector ever stores a non-UUID identifier under that key (plausible the moment a non-Woo channel type appears; nothing constrains `config` content). All rows seeded today use UUIDs, so this is latent, not live.

Fix is one line and should be folded into the migration before it ships: cap the subquery (`MAX(c.business_id)` or `LIMIT 1`) and compare as text (`c.config->>'store_id' = s.id::text`, optionally narrowed by `c.type = 'woocommerce'`). Add one §11 oracle: duplicate channel connector for one store → RPC still returns a deterministic result (not a 500). With that amendment this concern is closed.

### D2. Today, per-business rules can only ever match Woo-linked orders — the plan should say so
Verified reality: **no code in `src/` writes `orders.selling_point_id` or `orders.location_id`** (types only, `src/integrations/supabase/types.ts:1329` etc.), and the foundation backfill sets `selling_point_id` only for Woo orders (`UPDATE … WHERE sp.type = 'woocommerce' AND b.woo_store_id = o.store_id`, `20260904000100:578-584`) with the comment "POS orders stay NULL until Phase 3 UI assigns them" (`:575-577`). So for POS orders (`source='pos'`): leg 1 NULL, leg 2 NULL (leg 2 has *no* writer and *no* backfill at all — dead code today), leg 3 NULL (a POS-only store has no woo brand → no channel connector; the seed only creates connectors where `b.woo_store_id = v_store.id`, `:542`) → `v_business_id` NULL → **global rules only**.

This is *defined* behavior and the fallback is correct with the global seed — but it means the D1 business-override feature silently doesn't apply to POS orders, and the "business-override-beats-global" oracle (§5 item 4 `PLAN:512`, §11 `PLAN:547`) can only pass on a Woo-linked order. One sentence in §3.2/§5 (and a warning in the Phase 4 settings UI copy) prevents a future "why doesn't my business rule fire for POS orders?" debugging session. Keep leg 2 (harmless future-proofing); just note it's currently unreachable.

### D3. Deactivating a business override falls through to the *global* rule, not to `no_rule` — pick the semantics explicitly
§5 step E (`PLAN:284-287`): "Match: business-specific row for `v_business_id`, else global NULL row, by (slip_type, from_status = order.status) AND `is_active`." Because `is_active` sits inside the match predicate, a business row that exists but is `is_active=false` finds no match → the **global** row applies. For an admin who deactivated the override expecting "turn this transition off for my business", the seeded global rule still fires. There is no way to express "no rule for this business" (no negative override). Both readings are defensible; the plan should state which one the SQL implements — e.g. "an inactive business row falls through to the global default; to disable a transition business-wide, deactivate the global row (affects everyone) or accept global inheritance" — because the Phase 4 activation-toggle UI (`PLAN:524-525`) will imply "off = off". Non-blocking; one sentence.

### D4. Ambiguous candidates are not specified to be store-scope-filtered
§5 step B returns `candidates[]` for >1 rows filtered only by `order_number` (+ the optional `p_store_id` param); step C's `user_has_store_access` check (`PLAN:278-280`) is written for the single-`v_order` case, and N8's pre-validation covers only the `p_store_id` *parameter*, not candidate membership. A user with access to stores A+B who scans a number existing in A+B+C gets candidate C in the card; tapping it resubmits and gets `forbidden` — fails safe, but contradicts the round-2 claim that "the card can never offer an order the user can't then update" (REVIEW-2 §Verified #5). One line: either "filter candidates to stores where `user_has_store_access(auth.uid(), store_id)`" or explicitly document unfiltered-candidates + per-tap `forbidden` as intended.

---

## Minor Issues

### M-1. `choice`-flow race (Part B #2) — safe with the seed, worth one documented sentence
Between the `auto` call returning `choice` and the client resubmitting with explicit `p_slip_type` + `p_order_id`, the order's status can change (a parallel scan, bulk edit, or Woo webhook). The resubmission re-resolves the order fresh, so outcomes are: new status has no rule under the chosen slip type → `no_rule` (safe); or a *different* rule matches than either option the sheet showed → it applies that rule. With the default seed `choice` is unreachable (disjoint `from_status` sets, §6.2 `PLAN:331`), so this is purely edit-safety-path behavior. Options: include the expected `from_status` in the `choice` payload and re-verify it on resubmission, or just document the behavior in §6.2. Either closes it.

### M-2. Client store chip can under-list what the server permits (Part B #5) — narrowing-only, no security exposure
`get_user_store_ids` (`20260420112330:299-312`) has **no admin bypass and no `enforce_store_scoping` check**, while `user_has_store_access` (`:247-254`) has both. So: (a) an admin who *has* `user_store_access` rows gets a chip listing only those stores, though the RPC would permit any store; (b) deployments with `enforce_store_scoping=false` show the mapped subset only. The mismatch direction is always client-stricter — the chip can never surface a store the server would forbid, so there is no authorization leak; the §6.3 framing ("A selected store never *authorizes* cross-store scans") already covers the dangerous direction. One sentence in §6.3/§9 ("the chip is a narrowing filter; it may show fewer stores than the RPC would permit") sets expectations.

### M-3. Undo path surfaces a raw RLS error for the dual-gate edge user
§6.4's undo is a plain client-side `.update({status: from})` (`PLAN:359-361`). A user holding the `orders.change_status` grant but viewer `app_role` passes the UI guard (§3.5) but fails orders-UPDATE RLS (`20260415001620:33-35`) — the RPC path shows a clean `forbidden` card, but undo throws a raw Supabase error. Extremely narrow (the viewer preset grants only view permissions, `20260420112330:225-227`, so an admin must have custom-granted a viewer), but the scan success card offers Undo 10 minutes long. A `.catch` → toast on undo closes it.

### M-4. Grants omit `service_role` relative to the cited convention
The cited precedent grants `TO authenticated, service_role` (`20260831000200:116-117`); §5 (`PLAN:298-299`) grants only `TO authenticated`. Defensible (no edge function calls this RPC), but if the plan invokes the convention, match it or say why not — one word either way.

### M-5. Optional: a build check that zxing stays in the lazy chunk
§3.4/§9 require `/scan` to be a lazy route chunk "so zxing never enters the main bundle" (`PLAN:177-179`, `PLAN:460-462`); the ≈80–90 KB gzip figure is an estimate no static check can confirm. §11 has print-size oracles but no bundle assertion. A one-line Phase 2 item (assert the main chunk has no `@zxing` import after build) makes the guarantee enforced rather than intended.

*(Checked and NOT issues: the btree write-amplification question — one extra index on a low-volume table, correctly placed in the migration (`PLAN:248`); the seed's `ON CONFLICT DO NOTHING` form — target-less, valid with partial indexes (see N6); plan-internal contradictions — none found; §3.1↔§6.2↔§6.3↔§12, §3.2↔§5, §3.3↔§5.C, §7↔Phase 1 all agree.)*

---

## Verified Correct

1. **All three N2 chain legs are real** with the exact shapes the plan uses: `selling_points.business_id NOT NULL` (`20260904000100:127`), `locations.business_id NOT NULL` (`:100`), `connectors.category 'channel'` + `config` jsonb + `business_id NOT NULL` (`:160,:163-164,:170`), and the woo connector seed's JSON key is literally `'store_id'` (`:539-541`).
2. **`user_has_store_access` semantics match the plan verbatim** — admin bypass `:247-249`, enforce-flag `:251-254`, empty-mapping `:256-260`, `SECURITY DEFINER` + `search_path` `:239-241` (`20260420112330`).
3. **All §7 blast-radius citations re-verified line-exact**: `StatusBadge.tsx:1-17` (generic map, no `picked_up`); `OrderPipeline.tsx:41/:51/:61/:71` + pending stage `:27-30`; `useDashboardData` fixed-key pattern and `NON_REVENUE_STATUSES` (per round-2, unchanged in v3); `OrderDetailSheet.tsx:1946-1960` (10 items, `pending` at `:1951`); `OrderFilters.tsx:118-133`; `OrderBulkActionsBar.tsx:52-60`; `tabFilters.ts:26-41` (delivered `:36` before returned/cancelled), exclusion list `:135-140` (exact list verified), `deleted_at` `:91`, `payment_pending` `:124`, `pickup_pending` tracking `:147-148`; `OrderBadges.tsx:77` zinc fallback.
4. **§2 fact table survives a third pass**: orders CHECK created `20260407071618:84` / dropped `20260407131231:3`; unique `(woo_order_id, store_id)` `20260407131138:9`; partial consignment `20260831000000:7-8`; trigram-only `order_number` index `20260422185726:15`; POS number decoration `20260425220731:78-80` + seq `20260425215805:12`; `deleted_at` `20260416153225:3`; orders RLS `20260415001620:24-39`; timeline INSERT `:129-131`; stores-have-no-`business_id` `20260904000100:155-156`; new-tables RLS rule `:338-348`; Woo `LOCALLY_ADVANCED` at `woo-webhook/index.ts:392-395` and `woo-sync/index.ts:703-706` (both lack `picked_up`); `reverseMapStatus` `woo-push/index.ts:533-553` with fallback `:552`; woo number template `woo-sync/index.ts:652`; `woo-mapping.ts:13-14`; `profiles`/`full_name` `20260412161413:6-13`; enum + `orders.change_status` `20260420112330:14` / `types.ts:3285-3291` / `usePermissions.tsx:91`; `custom_roles` precedent `:73-76`; viewer preset `:225-227`; trigger `20260831000200:74-79` with `:44` gate.
5. **Client-side claims verified**: `useOrderBulkActions.ts:42-69` (`logAction` `:52`, `kickSyncWorker` `:57` — `src/pages/orders/useOrderBulkActions.ts`); `Orders.tsx:209` selects `stores(name)` + both print stamps; `Orders.tsx:611`/`:621` tab-keyed action lists — `picked_up` joins neither, as decided; `App.tsx:89-106` lazy + `PermissionGuard`, no `/scan` route; `pickupSlipHtml.ts:5-14` (no `id`) and `:100-101` (gated barcode); `barcodeSvg.ts:31-45` viewBox lesson; `MeasurementSlipPrint.tsx:34/:48/:53/:64/:102-104`; `useInvoiceSettings.ts:178-184/:223-226`; `orderTimeline.ts:7/:49` `skip_woo_note`; `auditLog.ts:3-8`; `POS.tsx:5/:169` wedge consumption; `package.json` (jsbarcode only); `src/test/tabFilters.test.ts:3` import precedent; `src/storefront/` = 21 files, zero order-status enumerations.
6. **No naming collisions**: `useCameraScanner.ts`, `scanPayload.ts`, `scanTransition.ts`, `qrSvg.ts`, `OrderScanner.tsx` all absent from `src/`; zero `getUserMedia`/`BarcodeDetector` usage.
7. **Migration hygiene**: 134 migrations, none ≥ `20260910000000` (filename clean); verify-then-drop exemplars exist (`20260901000190`, `20260901000250`); the four seed rows are distinct under `uq_scan_rule_global`; `businesses(id uuid PK)` `20260904000100:22-23` — FK/CASCADE semantics as stated (per-business rows only; globals survive).
8. **Internal consistency**: v3's sections agree with each other everywhere I probed (N5 in three places; N1 in two; N2 in two; N13 across §7.7/Phase 1/§12; phase dependencies all satisfied in order: Phase 2 needs only Phase 1 artifacts, Phase 3 needs nothing from Phase 2, Phase 4 consumes Phase 1's table and Phase 2's route).

---

## Verdict

**CONVERGED — implementation-ready.** All 15 round-2/residual findings are fully resolved with verified evidence, and the three round-2 criticals are fixed correctly (canonical authz checker, explicit derivation with verified legs, hook rename). No critical issues remain. No design decisions are left open for the implementer — every previously-open choice (permission, Woo mapping, OrderPipeline, undo semantics, choice code, param precedence, pipeline bucket) is decided in-plan.

Non-blocking amendments to fold in (no further review round required):

| # | Sev | Amendment | Where |
|---|---|---|---|
| D1 | Design | Cap the connector subquery (`MAX()`/`LIMIT 1`) and compare `config->>'store_id'` as text instead of `::uuid` cast; add a duplicate-connector oracle | §3.2 SQL, §5 step E, §11 |
| D2 | Design | State that POS orders (no selling_point/location/connector linkage) resolve to global rules only; leg 2 currently has no writer | §3.2/§5, Phase 4 UI copy |
| D3 | Design | Pin the deactivate-override semantics (inactive business row → global fall-through, as the predicate reads) | §5 step E |
| D4 | Design | Specify whether `ambiguous` candidates are store-scope-filtered | §5 step B/C |
| M-1 | Minor | Document (or guard with expected `from_status`) the choice-resubmission race | §6.2 |
| M-2 | Minor | One sentence: store chip is narrowing-only and may under-list server-permitted stores | §6.3/§9 |
| M-3 | Minor | Catch RLS errors on undo with a toast | §6.4 |
| M-4 | Minor | `service_role` in the grant list, or a word on why not | §5 |
| M-5 | Minor | Optional bundle assertion that `@zxing` never enters the main chunk | Phase 2/§11 |

D1 is the only one I would insist lands *inside* the migration itself rather than as prose — it is a one-line SQL change and the oracle already has a natural home in §11's list.
