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

### Phase 1 — Own the scheduler + hygiene ✅ DONE (2026-09-03)
1.1 CF Worker cron fully prepped (back-burner deploy): ready-to-paste script at
    `cloudflare/dokanos-cron.js` (*/5 sync-worker, */15 woo-sync-all+track_all),
    single secret `SYNC_WORKER_CRON_TOKEN`. GitHub workflows updated to the new
    auth and remain the active scheduler until the CF worker is deployed; the
    workflow headers document the demote-to-dead-man's-switch step.
1.2 `courier_tokens` table (provider, integration_id, token, expires_at;
    service_role-only) + two-tier cache in `getAccessToken` — verified live:
    2 rows, future-dated expiry.
1.3 `sync-worker` + `pathao-courier track_all` + `woo-sync-all` all require
    service-role / valid user JWT / `x-cron-secret` (vault `sync_worker_cron_token`,
    same value in GitHub secret SYNC_WORKER_CRON_TOKEN). Anon-key-only callers
    now get 401 (verified live on all three).
1.4 Webhook signatures REQUIRED when store has `consumer_secret` (missing or
    wrong -> 401). Both stores' Woo hooks hardened with their consumer_secret
    via REST PUT. Verified 3-way live (401 missing / 401 mismatch / 200 valid
    HMAC) and real Woo deliveries processed (status 200 in webhook_events).
1.5 `last_synced_at` advances to max observed `date_modified_gmt` high-water
    mark (falls back to fetch-start when nothing fetched). Verified live:
    last_synced_at == Woo max modified, to the second, both stores.
1.6 `webhook_events` >30d retention sweep added to sync-worker's sweep
    (verified running; oldest row currently 2026-08-29, nothing to purge yet).

### Phase 2 — Courier-agnostic core ✅ DONE (2026-09-03)
2.1 Schema: `courier_providers` (seeded pathao; per-provider cadence/rate
    columns), `courier_integrations` (per-merchant creds blob),
    `courier_shipments` (order_id, provider, consignment_id, raw/canonical
    status, last_tracked_at; UNIQUE (provider, consignment_id)).
    Backfilled 1087/1087 orders.consignment_id rows. Pathao keeps
    `pathao_integrations` as its creds store (adapter choice).
2.2 Adapter interface `_shared/courier-adapter.ts`: authenticate,
    listMerchantStores, createParcels, trackParcels, cancelParcel,
    refreshLocations, mapStatus, rateLimit — one file per courier.
2.3 `sync_queue` actions `courier_dispatch`/`courier_track_batch` (CHECK
    constraint); sync-worker routes them to the pathao adapter path via
    pathao-courier with service-role auth. Idempotency keys + per-provider
    rate limits ready via queue rows.
2.4 Polling cadence columns on courier_providers (track_interval_minutes=15,
    max_requests_per_minute=60 seeded for pathao).
2.5 Pathao adapter `adapters/pathao.ts`: ~60-entry status map extracted
    (canonical 9-status + legacy bucket mapping), auth, REST helpers.
    pathao-courier imports it; courier_shipments upserted on dispatch/track/
    attach. Verified live: track_all through new code path, fresh
    out_for_delivery/in_transit/on_hold canonical writes.

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
20260901000000_scheduler_auth_and_courier_tokens.sql        (vault sync_worker_cron_token + RPC + courier_tokens)
20260901000100_verify_webhook_signatures.sql                (temp oracle — dropped by …0250)
20260901000190_verify_phase1_final_v2.sql                  (temp oracle — dropped by …0250; …0150 renamed+repaired)
20260901000200_verify_phase1_retention.sql                 (temp oracle — dropped by …0250)
20260901000250_drop_phase1_verification_oracles.sql        (drops all three oracles)
20260902000000_courier_agnostic_core.sql                   (courier_providers/integrations/shipments + backfill + action CHECK)
20260902000100_verify_phase2_schema.sql                    (temp oracle — dropped by …0300)
20260902000200_verify_phase2_runtime.sql                   (temp oracle — dropped by …0300)
20260902000300_drop_phase2_oracles.sql                     (drops both oracles)
```

---

## 4. Status Ledger — REMAINING (pick up here, in this order)

1. **DEPLOY the Cloudflare Worker (Phase 1.1 finishing move, user does this).**
   - dash.cloudflare.com → Workers & Pages → Create Worker `dokanos-cron`,
     paste `cloudflare/dokanos-cron.js`, Deploy.
   - Settings → Variables: `SYNC_WORKER_CRON_TOKEN` =
     `z4i13r8XGeY2ASnPhyabNQ20IviKCGoA` (Type: Secret).
   - Settings → Trigger Events → Cron Triggers: `*/5 * * * *` AND
     `*/15 * * * *`.
   - Then demote the three GitHub workflows to once-daily dead-man's-switch
     runs that alert if `sync_queue` newest `updated_at` is stale (their file
     headers describe the switch).
2. **Phase 3.1 — Chunk `woo-sync-all`** (bounded pMap ~50, jitter, skip
   stores synced < X min ago).
3. **Phase 3.3 — `sync_health` view + dashboard surface + alert webhook.**
4. **Phase 3.2 / 3.4 / 3.5** as capacity allows.
5. **Courier #2 onboarding** (whenever a second courier is signed): implement
   `adapters/<courier>.ts` against `_shared/courier-adapter.ts`, add a
   `courier_providers` row + `courier_integrations` creds, and dispatch/
   track through the existing queue actions. No core changes needed.---

## 5. Known quirks the next agent MUST know

- **Woo webhook signing secrets cannot be READ back via the REST API** (the
  `secret` field always returns null/absent — `secret: MISSING` in the API
  view does NOT mean unset). To verify, fire a real delivery and check
  webhook_events, or use the 3-way HMAC probe (`.tmp/sig-3way-test.cjs`).
- **Woo's webhook deliveries lag minutes on shared hosting** (Action
  Scheduler batching) — don't assume a webhook is broken under ~2-5 min.
- **`woo-sync-all` accepts TWO cron secrets now** (legacy
  `woo_sync_cron_token` and `sync_worker_cron_token`) so schedulers can
  carry one secret.
- **`npx supabase db push` hangs on its Y/n prompt** in this shell - pipe
  `Write-Output 'y' |` into it. It is transactional: a failed migration fully
  rolls back and is not recorded.
- **Do not write SQL files from PowerShell** (`Set-Content -Encoding utf8`
  adds a BOM -> `syntax error at or near "..."`). Use the editor tool, or
  `[System.IO.File]::WriteAllText(path, text, [System.Text.UTF8Encoding]::new($false))`.
- **Renaming an already-pushed migration file breaks history** — repair with
  `npx supabase migration repair --status reverted <version> --linked`, then
  push the renamed file. (Learned 2026-09-03 with ...0150 → ...190.)
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
| CF Worker cron script (to paste in dashboard) | `cloudflare/dokanos-cron.js` |
| Cron token vault fns | `get_woo_sync_cron_token`, `get_sync_worker_cron_token` (used by woo-sync-all / sync-worker / pathao track_all) |
| Courier token cache | `courier_tokens` table (migration `20260901000000`), `getAccessToken` in `pathao-courier` |
| Courier adapter interface | `supabase/functions/_shared/courier-adapter.ts` |
| Pathao adapter (status map, auth, REST) | `supabase/functions/adapters/pathao.ts` |
| Courier schema | `courier_providers`/`courier_integrations`/`courier_shipments` (migration `20260902000000`) |
| Diagnostic scripts (Woo keys, E2E) | `.tmp/check-woo-webhooks.cjs`, `.tmp/e2e-variation-stock-test.cjs`, `.tmp/sig-3way-test.cjs`, `.tmp/verify-auth.cjs`, `.tmp/drain-once.cjs` |

*End of handoff document.*
