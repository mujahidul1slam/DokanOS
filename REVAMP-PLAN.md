# DokanOS Sync System — Full Revamp Plan & Handoff Ledger

> **Purpose:** Master plan for the DokanOS ↔ WooCommerce ↔ Pathao sync system,
> plus a precise done/remaining ledger so any agent can pick up the work.
> Written 2026-09-03. Last completed commit: `cf2913a`.
>
> **Read this file fully before making changes.** Sections 3–6 tell you
> exactly what exists, what's verified, and what to build next.

---

## 1. System Architecture (current state, as of `cf2913a`)

```
                       ┌─────────────────────────────────────────────┐
                       │                WOO COMMERCE                │
                       │  (enveilbd.com, vincentdhaka.com)           │
                       └───────┬─────────────────────▲───────────────┘
             webhooks (active,│4 hooks/store:        │ woo-push (PUT, retry,
             no signing secret)│ order/product .created/.updated      │ backoff, breaker)
                               ▼                     │
┌──────────────┐    ┌──────────────────────┐   ┌────┴─────────┐
│   Vercel     │    │  Supabase Edge Fns   │   │  sync_queue   │
│  (frontend)  │───▶│  woo-webhook         │   │  (Postgres    │
│  React SPA   │    │  woo-sync (per store)│   │  queue, SKIP  │
│  kickSync()  │    │  woo-sync-all        │   │  LOCKED claim,│
└──────────────┘    │  sync-worker (drain) │   │  idempotency  │
                    │  woo-push            │   │  keys, DLQ,   │
                    │  pathao-courier      │   │  breaker)     │
                    │  (pathao-track:     │   └────▲───────────┘
                    │   DELETED)          │        │ triggers:
                    └──────────┬───────────┘  auto_push_order_to_woo,
                               │              auto_push_product_stock,
                               ▼              auto_push_variation_stock
                      Pathao Aladdin API   + enqueue_order_push RPC
```

**Schedulers (the weak point):** GitHub Actions workflows run `sync-worker`
(*/5), `woo-sync-all` + `pathao-tracking` (*/15). **GitHub throttles them to
~every 4.5h** on this repo (verified via run history). pg_cron in the Supabase
project is dead (launcher dies; documented in the workflow file headers).
Freshness no longer depends on cron because the frontend kicks `sync-worker`
after every user action — but idle-time Woo-originated changes wait for the
throttled cron unless a user acts.

**Key DB objects:** `sync_queue` (+`claim_sync_queue_batch` RPC with
breaker-skip), `webhook_events` (delivery dedup), `woo_updated_at` on
orders/products/product_variations (echo guard), circuit breaker columns on

---

## 2. The Full Revamp Plan (all phases)

### Phase 0 — Stabilize (audit P0s) ✅ DONE
0.1 Parallelize `track_all` (worker pool) — was serial ~2.65s/order = ~200/hr ceiling.
0.2 Pathao dispatch idempotency — no duplicate parcels/COD on retry.
0.3 `woo-push` retry on 429/5xx with Retry-After — stop the breaker punishing busy stores.
0.4 Delete dead `pathao-track` function (local + remote).
0.5 Deterministic default Pathao integration (`.order(created_at)`).

### Phase A — Full-fidelity two-way Woo sync (the 5 reported issues) ✅ DONE
A.1 Order edits (customer info, discount, shipping, totals, notes) sync to Woo.
A.2 Manual/bulk status changes (incl. delivered/cancelled → completed/cancelled) sync to Woo.
A.3 Product stock sync, both directions, incl. **variation** stock (webhook handler) and POS returns (trigger).
A.4 Rich product info: sale price, sale dates, short description, attributes, tags, weight, dimensions — imported, editable, pushed.
A.5 Rich Woo order notes: itemized changes, amounts, consignments, "synced to DokanOS" receipt confirmation.
A.6 Instant delivery: full-queue drain + frontend `kickSyncWorker()` after every action.

### Phase 1 — Own the scheduler + hygiene ⬜ REMAINING
1.1 Move primary scheduling to Vercel Cron or Cloudflare Workers Cron (*/1 or */5). Keep GitHub Actions as a once-daily dead-man's-switch that alerts if the primary missed ticks.
1.2 Courier token caching in DB (expiry-aware) — currently every cold start issues a fresh Pathao token.
1.3 `sync-worker` auth via `x-cron-secret` (same pattern as `woo-sync-all`) — currently anon-triggerable (harmless but sloppy).
1.4 Enforce Woo webhook signatures (currently `if (consumer_secret && signature)` — unsigned payloads are accepted).
1.5 `woo-sync`: advance `last_synced_at` on completion/high-water-mark, not at start (slow stores can permanently skip orders otherwise).
1.6 Retention for `webhook_events` (>30d) — sync_queue retention already done.

### Phase 2 — Courier-agnostic core ⬜ REMAINING (do before integrating courier #2)
2.1 Schema: `courier_providers` (code), `courier_integrations` (per-merchant creds), `courier_shipments` (order_id, provider, consignment_id, raw/canonical status, last_tracked_at). Keep `pathao_*` location tables as the Pathao adapter's location store. Backfill `orders.consignment_id` → `courier_shipments`.
2.2 Adapter interface (one file per courier):
```ts
interface CourierAdapter {
  authenticate(integration): Promise<Token>;      // DB-cached (1.2)
  listMerchantStores(integration): Promise<Store[]>;
  createParcels(integration, parcels): Promise<Result[]>;  // idempotent
  trackParcels(integration, consignments): Promise<Status[]>;
  cancelParcel(...); refreshLocations(...);
  mapStatus(raw): CanonicalStatus;  // pending|picked_up|in_transit|out_for_delivery|
                                   // delivered|returned|cancelled|on_hold|lost
  rateLimit: { maxPerMinute: number };
}
```
2.3 Route dispatch/track/cancel through `sync_queue` (actions `courier_dispatch`, `courier_track_batch`) with per-integration idempotency keys + per-provider rate limits.
2.4 Per-provider polling cadence (assume polling-first; Steadfast/RedX/eCourier webhook availability unverified — their doc sites 404'd during the audit).
2.5 Extract `pathao-courier`'s ~60-entry status map into `adapters/pathao.ts`.

### Phase 3 — Scale to 100–500 stores ⬜ REMAINING
3.1 Chunk `woo-sync-all` fan-out (concurrency ~50 with retry on throttled invokes) + jitter + skip stores synced < X min ago.
3.2 Fair scheduling in `claim_sync_queue_batch` (round-robin by store) so one merchant's burst can't starve others.
3.3 Observability: `sync_health` view (queue depth, oldest-pending age, DLQ count, breaker trips, per-courier latency, tracking rotation age) + dashboard surface + alert webhook.
3.4 Supabase Realtime on `orders`/`courier_shipments` (replace the 5s `GlobalSyncIndicator` poll).
3.5 Load test: 500 synthetic stores (directive in `directives/`, script in `execution/` per repo conventions).
3.6 Sustained-drain architecture: Supabase throttles sustained edge invocations (~30 per ~45s window — discovered live). If a single drain must push >1000 rows, move processing into ONE batched `woo-push` invocation (one fn call, many orders) or a Vercel Cron worker with direct DB access.

### Cross-cutting hardening (from the original audit, folded in)
- Webhook order handlers still write directly to DB (mitigated by the `woo_updated_at` stale guard). Optional Phase 2+: route webhook writes through the queue.
- Frontend is polling, not realtime (3.4).
- `.claude/worktrees/` is committed in the repo (repo hygiene, any time).
`stores`, `recover_orphaned_sync_rows` RPC, product columns
`regular_price/sale_price/sale_price_from/sale_price_to/short_description/
attributes/tags/weight/dimensions`.


---

## 3. Status Ledger — DONE (all verified live; do not redo)

| Item | Evidence / where |
|---|---|
| 0.1 Parallel `track_all` ×8 | `pathao-courier/index.ts` `case "track_all"` — live: 9 consignments in 6.7s (3.6×), response shape unchanged |
| 0.2 Dispatch idempotency | `create_order` + `create_bulk` skip orders with existing `consignment_id` |
| 0.3 `wooPutWithRetry` | `woo-push/index.ts` — 429/502/503/504, Retry-After honored; 90+ real pushes, 0 data failures |
| 0.4 `pathao-track` deleted | local dir removed + remote fn deleted via CLI |
| 0.5 Deterministic integration | `loadIntegration()` `.order("created_at")` |
| A.1 Order-edit sync | Trigger `auto_push_order_to_woo` (migration `…0200`) fires on any tracked field, echo-guarded by `woo_updated_at`; `pushOrder` sends billing/shipping/name-split (email omitted when empty — Woo 400s on `""`), shipping_lines, discount fee **with coupon double-apply guard** |
| A.2 Status sync | Per-minute idempotency keys `push:{order}:{status}:{YYYYMMDDHHMI}` killed the permanent-collision bug; bulk bar + detail sheet call `kickSyncWorker()` |
| A.3 Stock → Woo | Triggers on `products` + `product_variations` (parent-coalesced keys) → `sync_queue` action `push_stock`; covers POS, POS returns, bulk edits |
| A.3 Stock ← Woo | `woo-webhook` variation handler (payloads were literally `skipped: "variation"`); ping-detector fixed (`parent_id` exemption). **E2E: real Woo variation edit → DokanOS stock in ~30s** (set 12, verified 12 via temporary SECURITY DEFINER oracle) |
| A.4 Product fields | DB cols (migration `…0300`); imported in woo-sync/woo-webhook; pushed in pushProduct (sale-safe); UI: Regular/Sale Price, Weight, Short Description + read-only Woo attributes/tags badges |
| A.5 Rich notes | `orderTimeline.ts` enriches from metadata; importers post "✅ Order synced to DokanOS — #N, X items, total ৳Y" |
| A.6 Instant drain | `sync-worker` full-drain loop (BATCH 50 × MAX 20 batches, 240s budget, concurrency 3, 500ms inter-batch); `kickSyncWorker()` in OrderDetailSheet, useOrderBulkActions, ProductDetailSheet |
| Rate-limit safety | Supabase throttles sustained edge invocations (~30/45s, discovered live). Worker requeues those rows **without burning attempts**; migration `…0600` restored the 713 initial victims |
| Orphan recovery | `recover_orphaned_sync_rows` RPC (atomic, per-row attempts) |
| Queue retention | Worker sweeps completed >7d, dead_letter >30d |
| Verified E2E | Trigger tests 5/5, stock tests 6/6 (rollback-safe harnesses), Woo pushes 20/0 + 30/0 + 30/0, E2E variation 12→12, build ✅, tests 21/21 ✅ |

**Commit:** `cf2913a` (pushed; Vercel auto-deploys).

### Migration ledger (all applied remotely)
```
20260831000000_attach_pathao_parcel.sql                     (parallel session)
20260831000100_backfill_completed_orders_to_delivered.sql   (renamed — fixed version collision)
20260831000200_order_push_full_sync.sql                    (trigger rework + enqueue_order_push RPC)
20260831000300_product_pricing_attributes.sql              (product + variation columns)
20260831000380…392                                          (verification harness no-op pairs)
20260831000400_enqueue_push_include_items.sql               (include_items flag)
20260831000500_product_stock_triggers.sql                   (stock triggers + orphan RPC + index)
20260831000590…596                                          (stock verification harness no-op pairs)
20260831000600_requeue_rate_limit_victims.sql               (713 rows restored)
20260831000790…794                                          (debug oracle no-op pairs)
```

---

## 4. Status Ledger — REMAINING (pick up here, in this order)

1. **Phase 1.1 — Scheduler ownership (highest impact).**
   - Add `api/cron/sync-worker.ts` (Vercel serverless route) POSTing to the
     Supabase function with `x-cron-secret`; add crons to `vercel.json`
     (`*/5` sync-worker, `*/15` pathao-tracking — sub-daily needs Vercel Pro).
     Alternative: Cloudflare Worker Cron (free).
   - Do 1.3 at the same time (token exists in vault as `woo_sync_cron_token`;
     copy the `get_woo_sync_cron_token` pattern from `woo-sync-all`).
   - Demote the three GitHub workflows to once-daily dead-man's-switch runs
     that alert if the queue's newest `updated_at` is stale.
2. **Phase 1.2 — Token cache table** (`courier_tokens`: integration_id,
   token, expires_at). Update `getAccessToken` in `pathao-courier`.
3. **Phase 1.4 — Enforce webhook signatures.** In `woo-webhook`, when
   `store.consumer_secret` is set, REQUIRE a valid signature (currently
   optional). Both live stores show `secret: MISSING` in the Woo API view —
   `.tmp/harden-woo-webhooks.cjs` exists to set them.
4. **Phase 1.5 — Sync window fix.** In `woo-sync`, set `last_synced_at` to
   max `date_modified_gmt` AFTER the sync body completes (currently set at
   start, around line 324).
5. **Phase 2 — Courier-agnostic core** (full spec in §2). Before courier #2.
6. **Phase 3.1 — Chunk `woo-sync-all`** (bounded pMap ~50).
7. **Phase 3.3 — `sync_health` view + dashboard surface + alert webhook.**
8. **Phase 3.2 / 3.4 / 3.5** as capacity allows.---

## 5. Known quirks the next agent MUST know

- **`npx supabase db push` hangs on its Y/n prompt** in this shell - pipe
  `Write-Output 'y' |` into it. It is transactional: a failed migration fully
  rolls back and is not recorded.
- **Do not write SQL files from PowerShell** (`Set-Content -Encoding utf8`
  adds a BOM -> `syntax error at or near "..."`). Use the editor tool, or
  `[System.IO.File]::WriteAllText(path, text, [System.Text.UTF8Encoding]::new($false))`.
- **Apply-order trap:** if you push a verification-RPC migration together
  with its drop migration, the drop wins immediately. Pattern: create ->
  push -> verify -> THEN write+push the drop.
- **PostgREST schema cache is stale ~10-15s** after creating/replacing an RPC
  via migration - retry the RPC call after a wait before assuming failure.
- **RLS blocks anon reads** on orders/stores/product_variations/webhook_events
  (by design). For verification use temporary SECURITY DEFINER oracle
  functions, then drop them.
- **Supabase edge invocation throttle:** ~30 sustained invokes per ~45s
  window. The drain loop already respects it (concurrency 3 + requeue).
  Do not raise CONCURRENCY above ~5 without re-testing.
- **Woo API gotchas:** empty-string email -> 400; variation webhook payloads
  lack `name`/`sku` but have `parent_id`; Woo `price` field is the effective
  (sale) price; `rest_post_invalid_page_number` means "no more pages".
- **Verification harness pattern** (rollback-safe, used successfully 3x):
  PL/pgSQL fn using `RAISE EXCEPTION 'ABORT_TEST'` inside `BEGIN...EXCEPTION`
  subtransactions - variable assignments survive, DB writes roll back. Grant
  to `anon` temporarily, invoke via PostgREST, then drop via migration.

---

## 6. Verification playbook

1. **Triggers/DB logic:** temporary rollback-safe harness RPC (quirk 8) ->
   `POST /rest/v1/rpc/<name>` with the anon key -> assert booleans in the
   JSON -> drop via a follow-up migration.
2. **DokanOS->Woo pushes:** invoke `sync-worker` directly (anon key works
   today); read `processed/failed/rate_limited_requeued`. Inspect Woo via the
   REST API with the store keys in `.tmp/check-woo-webhooks.cjs`.
3. **Woo->DokanOS:** make a real merchant-style edit via the Woo API (PUT
   product variation / order meta), wait ~30s, verify via a temporary oracle
   or the authenticated frontend.
4. **Pathao:** POST `{action:track_all}` and time it; dispatch tests must
   respect the idempotency guard (already-dispatched orders return
   `skipped:true` + existing consignment).
5. **Frontend:** `npm run build` + `npm test` (21 tests as of `cf2913a`) +
   `npx eslint <changed files>` (keep your diff lint-neutral; the codebase
   has ~1100 pre-existing errors).
6. **Deployments:** `npx supabase functions deploy <fn> --project-ref
   jiwndicvfkiltgageqwv --no-verify-jwt` (the bundler catches syntax errors).
   Migrations: `Write-Output 'y' | npx supabase db push --linked --include-all`.

---

## 7. Source-of-truth file map

| Concern | File(s) |
|---|---|
| Queue drain | `supabase/functions/sync-worker/index.ts` |
| Woo writes (orders/products/stock/notes) | `supabase/functions/woo-push/index.ts` |
| Woo import (bulk) | `supabase/functions/woo-sync/index.ts` |
| Woo import (webhooks, incl. variations) | `supabase/functions/woo-webhook/index.ts` |
| Fan-out scheduler fn | `supabase/functions/woo-sync-all/index.ts` |
| Pathao dispatch/track/attach | `supabase/functions/pathao-courier/index.ts` |
| Push triggers | migrations `20260831000200`, `...0400`, `...0500` |
| Claim RPC + breaker skip | migrations `20260829000000`, `20260830000100` |
| Frontend kick + notes | `src/lib/wooNotes.ts`, `src/lib/orderTimeline.ts` |
| Order edit push callsite | `src/components/orders/OrderDetailSheet.tsx` (`handleSave`) |
| Bulk status push callsite | `src/pages/orders/useOrderBulkActions.ts` |
| Product UI (sale price etc.) | `src/components/products/ProductDetailSheet.tsx` |
| External schedulers | `.github/workflows/{sync-worker,woo-sync-all,pathao-tracking}.yml` |
| Cron token vault fn | `get_woo_sync_cron_token` (used by woo-sync-all) |
| Diagnostic scripts (Woo keys, E2E) | `.tmp/check-woo-webhooks.cjs`, `.tmp/e2e-variation-stock-test.cjs` |

*End of handoff document.*
