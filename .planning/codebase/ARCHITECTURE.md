<!-- refreshed: 2026-09-09 -->
# Architecture

**Analysis Date:** 2026-09-09

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                       Client SPA (Vite + React 18)                   │
│                                                                      │
│  ┌─────────────────────────────┐   ┌───────────────────────────────┐ │
│  │  Dashboard App (auth)       │   │  Storefront App (public)      │ │
│  │  `src/pages/`               │   │  `src/storefront/`            │ │
│  │  `src/components/`          │   │  routed via brand detection   │ │
│  │  `src/components/pos/` etc. │   │  `src/storefront/lib/brand.ts`│ │
│  └────────────┬────────────────┘   └──────────────┬────────────────┘ │
│               │ Providers: Auth, Permissions,     │                  │
│               │ BusinessContext, Theme            │                  │
│               │ `src/hooks/*.tsx`                 │                  │
└───────────────┼───────────────────────────────────┼──────────────────┘
                │  supabase-js (RLS + user JWT)     │  supabase-js (anon)
                ▼                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Supabase Backend                               │
│                                                                      │
│  ┌──────────────────────────┐   ┌──────────────────────────────────┐ │
│  │  Postgres + RLS + RPCs   │   │  Edge Functions (Deno)           │ │
│  │  `supabase/migrations/`  │   │  `supabase/functions/<name>/`    │ │
│  │  134 SQL migrations      │   │  sync-worker, woo-sync,          │ │
│  │  sync_queue, fair-claim  │   │  woo-push, woo-webhook,          │ │
│  │  RPC (SKIP LOCKED)       │   │  storefront-checkout,            │ │
│  │  Realtime enabled        │   │  pathao-courier, team-manage…    │ │
│  └──────────────────────────┘   └──────────────────────────────────┘ │
└───────────────┬───────────────────────────────────┬──────────────────┘
                │                                   │
                ▼                                   ▼
┌───────────────────────────────┐   ┌──────────────────────────────────┐
│  Schedulers                   │   │  External Systems                │
│  Cloudflare Worker cron       │   │  WooCommerce REST + webhooks     │
│  `cloudflare/dokanos-cron.js` │   │  Pathao courier API              │
│  GitHub Actions (backup)      │   │  bKash / Nagad (manual trx ref)  │
│  `.github/workflows/*.yml`    │   │                                  │
└───────────────────────────────┘   └──────────────────────────────────┘

Hosting: Vercel (`vercel.json` rewrites all paths to `index.html`)
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Root bootstrap | PWA install events, chunk-load-error recovery, mounts `App` | `src/main.tsx` |
| Root routing | Brand detection (storefront vs dashboard), provider tree, query client | `src/App.tsx` |
| Dashboard shell | Sidebar + bottom nav + shortcuts + sync indicator layout | `src/components/DashboardLayout.tsx` |
| Route authorization | Per-route permission check with fallback UI | `src/components/PermissionGuard.tsx` |
| Auth context | Supabase session, sign in/out, role fetch from `user_roles` | `src/hooks/useAuth.tsx` |
| Permissions context | Loads permission list via `get_user_permissions` RPC, exposes `can()` | `src/hooks/usePermissions.tsx` |
| Business context | Multi-business membership (User → Business → Brand), persisted active selection | `src/hooks/useBusinessContext.tsx` |
| Brand detection | Slug/path/custom-domain resolution with 5-min in-memory cache | `src/storefront/lib/brand.ts` |
| Storefront routes | Public shop: home, shop, product, cart, checkout, track | `src/storefront/StorefrontApp.tsx` |
| Sync queue drain | Claims queue batches (SKIP LOCKED), invokes `woo-push`, dead-letters failures | `supabase/functions/sync-worker/index.ts` |
| Woo inbound | HMAC-verified webhooks, idempotent order/product upserts | `supabase/functions/woo-webhook/index.ts` |
| Guest checkout | Validates storefront/products, creates order with service role | `supabase/functions/storefront-checkout/index.ts` |
| Courier adapter contract | Canonical status enum + interfaces all couriers implement | `supabase/functions/_shared/courier-adapter.ts` |
| Woo field mapping | Status/stock/shipping/phone normalization shared by functions | `supabase/functions/_shared/woo-mapping.ts` |
| Cron scheduler | Cloudflare Worker: every 5 min drain, every 15 min Woo import + Pathao tracking | `cloudflare/dokanos-cron.js` |
| Schema | 134 timestamped SQL migrations, RLS policies, RPCs, triggers | `supabase/migrations/` |

## Pattern Overview

**Overall:** Single-page application with a dual-app route split (authenticated dashboard + public storefront), backed by a Supabase BaaS (Postgres/RLS + Deno Edge Functions), with an outbox-style job queue (`sync_queue`) drained by a worker for reliable third-party synchronization.

**Key Characteristics:**
- **No custom backend** — all server logic is either Postgres (RLS policies + RPC functions in `supabase/migrations/`) or Deno Edge Functions (`supabase/functions/`)
- **Direct data access** — components/hooks call `supabase.from(...)` directly; there is no repository/service layer (see Anti-Patterns)
- **Outbox queue pattern** — outbound WooCommerce writes go through the `sync_queue` table with fair-claim round-robin RPC, retries, and `dead_letter` status after 5 attempts (`supabase/functions/sync-worker/index.ts`, `MAX_ATTEMPTS = 5`)
- **Adapter pattern** for couriers — one file per courier under `supabase/functions/adapters/` implementing `supabase/functions/_shared/courier-adapter.ts`; Pathao is the reference implementation
- **Context-provider composition** at the root (`AuthProvider → PermissionsProvider → BusinessContextProvider → ThemeProvider`) in `src/App.tsx`
- **Aggressive code splitting** — every authenticated page is a lazy-loaded chunk (`src/App.tsx`); the storefront is also lazy

## Layers

**Presentation (Dashboard):**
- Purpose: Authenticated merchant UI — POS, orders, products, customers, analytics, dispatch, settings, team
- Location: `src/pages/` (route pages), `src/components/` (feature subfolders: `pos/`, `orders/`, `dashboard/`, `products/`, `analytics/`, `integrations/`, `settings/`, `team/`, `measurements/`)
- Contains: React components; heavy feature logic lives in page components (e.g., `src/pages/POS.tsx`)
- Depends on: hooks (`src/hooks/`), supabase client, `src/lib/` utilities
- Used by: `src/App.tsx` routes

**Presentation (Storefront):**
- Purpose: Public customer-facing storefronts, one per brand slug
- Location: `src/storefront/` — own `pages/`, `components/`, `lib/`, `themes/`
- Contains: Self-contained mini-app; `BrandContext.tsx` supplies brand config; `lib/cart.ts` local cart state; `lib/catalog.ts` product reads
- Depends on: supabase client (anon reads), `storefront-checkout` edge function
- Used by: `src/App.tsx` `Root` component when `detectBrand()` matches

**State/Provider Layer:**
- Purpose: Cross-cutting client state (session, permissions, active business/brand, theme)
- Location: `src/hooks/useAuth.tsx`, `src/hooks/usePermissions.tsx`, `src/hooks/useBusinessContext.tsx`, `src/hooks/useBusinessProfile.tsx`, `src/hooks/useTheme.tsx`
- Contains: React Context + Provider pattern; persistence in `localStorage` (`dokanos-active-business-id`, `dokanos-sidebar-collapsed`, etc.)
- Depends on: `src/integrations/supabase/client.ts`
- Used by: everything under `src/App.tsx`

**Data Access Layer:**
- Purpose: Single generated Supabase client with typed `Database` schema
- Location: `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts` (auto-generated — do not edit)
- Contains: Typed client using `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`, localStorage session persistence
- Depends on: `@supabase/supabase-js`
- Used by: all hooks, pages, components, storefront libs. Server cache is TanStack Query (`staleTime: 60s` tuned in `src/App.tsx` to limit egress)

**Backend — Postgres:**
- Purpose: Source of truth; RLS-secured tables, RPC functions (permissions, fair-claim queue), triggers, views (`sync_health_view`)
- Location: `supabase/migrations/*.sql` (134 migrations, newest: `20260906000000_courier_shipments_cancelled_at.sql`)
- Contains: Multi-business foundation (`20260904000100_multi_business_foundation.sql`), realtime enablement (`20260903000500_enable_realtime.sql`), courier-agnostic core (`20260902000000_courier_agnostic_core.sql`)
- Depends on: —
- Used by: supabase-js (RLS + user JWT), Edge Functions (service role)

**Backend — Edge Functions (Deno):**
- Purpose: Privileged operations that must bypass RLS or call external APIs
- Location: `supabase/functions/<kebab-name>/index.ts`; shared code in `supabase/functions/_shared/`
- Contains: sync pipeline (`sync-worker`, `woo-sync`, `woo-sync-all`, `woo-push`, `woo-webhook`, `sync-alert`), couriers (`pathao-courier`, `pathao-location-refresh`, `adapters/`), storefront (`storefront-checkout`, `generate-storefront-content`, `get-orders`), admin (`team-manage`, `parse-order-text`)
- Depends on: `npm:@supabase/supabase-js@2`, `SUPABASE_SERVICE_ROLE_KEY` env, vault-stored cron tokens via `get_sync_worker_cron_token` RPC
- Used by: frontend (fetch), Cloudflare Worker cron, GitHub Actions, WooCommerce webhooks
- Config: `supabase/config.toml` — `verify_jwt = false` for `woo-webhook`, `storefront-checkout`, `get-orders` (they perform their own auth: HMAC signature, payload validation, anon reads respectively)

**Scheduler Layer:**
- Purpose: Periodic triggering of sync pipeline
- Location: `cloudflare/dokanos-cron.js` (primary), `.github/workflows/sync-worker.yml`, `.github/workflows/woo-sync-all.yml`, `.github/workflows/pathao-tracking.yml` (backup / dead-man's-switch)
- Contains: Cron triggers `*/5` (drain) and `*/15` (Woo import + Pathao tracking refresh); auth via `x-cron-secret` header checked against Supabase vault token
- Depends on: Supabase Edge Functions over HTTPS
- Used by: — (top-level trigger)

## Data Flow

### Primary Request Path (Dashboard, e.g., Orders)

1. User loads app → `src/main.tsx` mounts `src/App.tsx` → `Root` runs `detectBrand()` (`src/storefront/lib/brand.ts`); no brand match → renders provider tree
2. `AuthProvider` (`src/hooks/useAuth.tsx`) restores session from localStorage and fetches role from `user_roles` table
3. `AppRoutes` gates each route with `<PermissionGuard permission="orders.view">` (`src/components/PermissionGuard.tsx`) backed by `get_user_permissions` RPC
4. Page component (e.g., `src/pages/Orders.tsx`) queries Postgres directly via `supabase.from('orders')...` through `src/integrations/supabase/client.ts`, cached by TanStack Query
5. Mutations write to Postgres (RLS-enforced); UI updates via query invalidation and Postgres Realtime (enabled by `supabase/migrations/20260903000500_enable_realtime.sql`)

### Outbound WooCommerce Sync (Outbox Pattern)

1. A local change needing Woo propagation inserts a `sync_queue` row (pending)
2. Scheduler triggers `supabase/functions/sync-worker/index.ts` (Cloudflare cron every 5 min, GitHub Actions backup, or user "kick" from frontend with a valid JWT)
3. Worker authenticates (service-role bearer / `x-cron-secret` vault token / user JWT), claims a batch of 50 via fair-claim RPC using `SKIP LOCKED` (round-robin fairness, `supabase/migrations/20260903000010_fair_claim_round_robin_v2.sql`)
4. Claimed rows are dispatched to `woo-push` with bounded concurrency (3) to respect Supabase platform rate limits; failures retry up to 5 attempts, then `dead_letter`
5. Full-drain loop continues until queue empty / 1000-row cap / 240s time budget

### Inbound WooCommerce Sync (Webhook)

1. WooCommerce delivers webhook to `/functions/v1/woo-webhook` (`verify_jwt = false` in `supabase/config.toml` — Woo sends no Authorization header)
2. Function authenticates by matching `x-wc-webhook-source` to a store row and verifying the HMAC signature against that store's consumer secret (`supabase/migrations/20260901000100_verify_webhook_signatures.sql`)
3. Echo loops are skipped via `_dokan_origin` meta marker; delivery idempotency is checked before processing
4. Payload is normalized by `supabase/functions/_shared/woo-mapping.ts` (status, stock, shipping, phone, measurements) and upserted with service role

### Guest Storefront Checkout

1. Customer submits cart on `src/storefront/pages/Checkout.tsx` → POST to `storefront-checkout` edge function (anon; `verify_jwt = false`)
2. Function validates payload, loads storefront by slug, verifies every `product_id` belongs to that storefront, re-fetches authoritative prices/stock (`supabase/functions/storefront-checkout/index.ts`)
3. Order is created with service-role client; Pathao city/zone/area ids ride along for courier dispatch; frontend shows `CheckoutSuccess` with order number

### Courier Dispatch & Tracking

1. Merchant dispatches parcel from `src/components/orders/DispatchDialog.tsx` / dashboard `CourierDispatchStation` → `pathao-courier` function
2. Function talks only to the adapter interface (`supabase/functions/_shared/courier-adapter.ts`); Pathao implementation in `supabase/functions/adapters/`
3. Tracking refresh runs on the 15-min cron (`pathao-courier` `track_all` mode via `cloudflare/dokanos-cron.js` and `.github/workflows/pathao-tracking.yml`); token refresh handled by `pathao-location-refresh`

**State Management:**
- Server state: TanStack Query (QueryClient configured in `src/App.tsx`, `staleTime: 60_000`, `gcTime: 5 min` — tuned to reduce Supabase egress)
- Client state: React Context providers (`src/hooks/*.tsx`); localStorage for persisted selections (active business/brand, sidebar collapse); module-level caches (`src/storefront/lib/brand.ts` slug cache, 5-min TTL)

## Key Abstractions

**Courier Adapter Contract:**
- Purpose: Courier-agnostic interface (create parcel, track, cancel; canonical statuses `pending|picked_up|in_transit|out_for_delivery|delivered|returned|cancelled|on_hold|lost`)
- Examples: `supabase/functions/_shared/courier-adapter.ts`, `supabase/functions/adapters/` (Pathao reference)
- Pattern: Interface + per-provider implementation files; adding a courier = one new file, zero core changes

**Permission System:**
- Purpose: Fine-grained page/action authorization beyond the coarse `user_roles` (admin/staff/viewer)
- Examples: `src/hooks/usePermissions.tsx` (`can()`, `canAny()`, `hasStoreAccess()`), `src/components/PermissionGuard.tsx`, DB enum `app_permission` and RPC `get_user_permissions`
- Pattern: Server-side RPC loads permission set into context; routes/components guard declaratively; admin bypasses all checks

**Multi-Business Hierarchy:**
- Purpose: One login → many businesses → many brands → locations/selling points/connectors
- Examples: `src/hooks/useBusinessContext.tsx`, `supabase/migrations/20260904000100_multi_business_foundation.sql`, `user_business_access` table with RLS
- Pattern: Membership rows resolved per session; active business/brand persisted in `localStorage` and exposed via context

**Brand/Storefront Resolution:**
- Purpose: Route the same SPA bundle to a public storefront based on URL
- Examples: `src/storefront/lib/brand.ts` (`detectBrand` sync via `?brand=` or `/storefront/:slug` path; `detectBrandAsync` via hostname/custom domain), `src/storefront/BrandContext.tsx`
- Pattern: Two-phase detection (sync path check, then async DB-backed hostname match) with cached slug list

**Sync Queue (Outbox):**
- Purpose: Reliable, rate-limit-aware delivery of changes to WooCommerce
- Examples: `supabase/functions/sync-worker/index.ts` (drain loop), `supabase/migrations/20260903000010_fair_claim_round_robin_v2.sql` (claim RPC), `sync_health_view`
- Pattern: Outbox + fair-claim worker pool + exponential attempts + dead-letter + realtime health surfacing (`src/components/dashboard/SyncHealthCard.tsx`)

**Chunk-Load Recovery:**
- Purpose: Survive stale-deploy chunk 404s (common on Vercel after redeploys)
- Examples: `src/lib/chunkRecovery.ts`, wired to `unhandledrejection` in `src/main.tsx`, `markAppLoaded()` in `src/App.tsx`
- Pattern: Detect chunk errors → clear caches → one-shot reload

## Entry Points

**Web App:**
- Location: `index.html` → `src/main.tsx` → `src/App.tsx`
- Triggers: Browser navigation (Vercel rewrites all routes to `index.html` via `vercel.json`)
- Responsibilities: PWA install hooks, chunk-error recovery, brand detection, provider tree, route split

**Edge Function (each is its own entry point):**
- Location: `supabase/functions/<name>/index.ts` — `Deno.serve(async (req) => ...)`
- Triggers: HTTPS POST from frontend, Cloudflare cron, GitHub Actions, or WooCommerce
- Responsibilities: Per-function auth (see `supabase/config.toml` for `verify_jwt` overrides), CORS headers, JSON in/out

**Cron Scheduler:**
- Location: `cloudflare/dokanos-cron.js` — `export default { scheduled(event, env, ctx) }`
- Triggers: Cloudflare Cron Triggers (`*/5`, `*/15`)
- Responsibilities: Invoke `sync-worker`, `woo-sync-all`, Pathao tracking with `x-cron-secret` header

**CI Workflows:**
- Location: `.github/workflows/sync-worker.yml`, `woo-sync-all.yml`, `pathao-tracking.yml`
- Triggers: Schedule (backup / dead-man's-switch role)
- Responsibilities: Same function invocations as the CF Worker using repo secrets

## Architectural Constraints

- **Chunking:** Do not introduce `manualChunks` in `vite.config.ts` — Recharts/Radix read `React.forwardRef` at module-eval time; splitting React out causes a production blank-screen race (documented in `vite.config.ts` comments)
- **Rate limits:** Supabase Edge Functions platform throttles sustained invocations — `sync-worker` caps `CONCURRENCY = 3` with inter-batch pauses (`supabase/functions/sync-worker/index.ts`); keep this when touching the drain loop
- **Time budget:** A single sync-worker invocation must stay under ~300s (`MAX_BATCHES = 20`, `TIME_BUDGET_MS = 240_000`) because schedulers use curl timeouts
- **Generated files:** `src/integrations/supabase/types.ts` and `src/integrations/supabase/client.ts` are auto-generated — regenerate via Supabase CLI instead of editing
- **verify_jwt=false functions** (`woo-webhook`, `storefront-checkout`, `get-orders`) MUST self-authenticate (HMAC / payload validation); never add privileged logic to them without that check
- **Secrets:** Runtime secrets live in Supabase Vault (read via RPC like `get_sync_worker_cron_token`) and GitHub repo secrets; frontend only holds the public publishable anon key (`src/integrations/supabase/client.ts`)
- **Single SPA bundle:** Dashboard and storefront share one Vite bundle and one deploy on Vercel; brand detection decides which app renders (`src/App.tsx` `Root`)

## Anti-Patterns

### No Data-Access Abstraction in the Frontend

**What happens:** Supabase queries are written inline in pages/components throughout `src/pages/` and `src/components/` (e.g., `src/pages/POS.tsx`, `src/pages/Orders.tsx`); the same table/column strings repeat across files.
**Why it's wrong here:** Renaming a column or tightening an RLS policy requires grepping the whole `src/` tree; typing regressions surface late; tests must mock the client per-component.
**Do this instead:** For new features, at minimum group queries into a per-feature module next to the page (e.g., `src/pages/orders/` already does this with `useOrderBulkActions.ts` and `tabFilters.ts`), or a `src/lib/<domain>.ts` helper — do not add new inline query strings to large page files.

### God-Page Components

**What happens:** Feature pages such as `src/pages/POS.tsx`, `src/pages/Orders.tsx`, `src/pages/StorefrontsPage.tsx` accumulate large amounts of state, dialogs, and queries in one file (they are the biggest files in `src/`).
**Why it's wrong here:** Slows chunk load of the main feature, hard to review, and increases merge conflicts.
**Do this instead:** Follow the existing extraction pattern — dialogs and widgets go to `src/components/<feature>/` (e.g., `src/components/pos/`, `src/components/orders/`), reusable logic to hooks in `src/hooks/` or co-located `use*.ts` files.

### Module-Level Mutable Singletons

**What happens:** `src/storefront/lib/brand.ts` keeps `_slugCache` module state with a TTL; the supabase client is a module singleton by design.
**Why it's wrong here:** Cache invalidation depends on every caller remembering `invalidateSlugCache()` (`src/pages/StorefrontsPage.tsx` does this after mutations); forgetting it leaves stale slugs for 5 minutes.
**Do this instead:** Any new storefront-mutating flow must call `invalidateSlugCache()`; prefer TanStack Query with `staleTime` for new cached reads instead of hand-rolled module caches.

## Error Handling

**Strategy:** Defense at three levels — global chunk-error recovery, React error boundary, and per-function JSON error responses with a queue dead-letter fallback.

**Patterns:**
- Global: `src/main.tsx` intercepts `unhandledrejection`, and `src/lib/chunkRecovery.ts` recovers from stale-chunk loads (cache clear + reload)
- React: `src/components/ErrorBoundary.tsx` wraps the app (mounted in `src/App.tsx`)
- Edge Functions: `try/catch` around the whole handler; JSON error responses with proper status codes (`supabase/functions/storefront-checkout/index.ts` returns 400/403/404 with `{ error }`)
- Background jobs: retry with attempt counting; rows exceed `MAX_ATTEMPTS = 5` → `dead_letter` status (`supabase/functions/sync-worker/index.ts`); alerting via `sync-alert` function and `sync_health_view`
- UI feedback: `sonner` and shadcn toaster (`src/components/ui/sonner.tsx`, `src/components/ui/toaster.tsx`)

## Cross-Cutting Concerns

**Logging:** `console.*` in Edge Functions (visible in Supabase/CF logs); no structured frontend logger
**Validation:** Manual payload validation at function boundaries (e.g., `storefront-checkout` checks required fields and storefront-product membership); frontend forms via `react-hook-form` + `zod` (`@hookform/resolvers`)
**Authentication:** Supabase Auth (email/password) with roles in `user_roles`; fine-grained permissions via `get_user_permissions` RPC; per-store access via `get_user_store_ids` RPC; cron/service auth via vault-backed `x-cron-secret`
**Authorization (DB):** RLS policies in `supabase/migrations/*.sql` are the real security boundary; service-role bypass exists only inside Edge Functions
**Audit:** `src/lib/auditLog.ts` for client-side audit logging

---

*Architecture analysis: 2026-09-09*
