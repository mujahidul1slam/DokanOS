# External Integrations

**Analysis Date:** 2026-09-09

## APIs & External Services

**Supabase (backend platform — primary):**
- Postgres database, Auth, Edge Functions, Realtime, Vault, pg_cron
  - SDK/Client: `@supabase/supabase-js` — singleton in `src/integrations/supabase/client.ts` (localStorage session, autoRefreshToken); typed with generated `src/integrations/supabase/types.ts`
  - Auth: `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`; email/password sign-in via `src/hooks/useAuth.tsx` (roles fetched from `user_roles` table: admin/staff/viewer)
  - Edge Functions (`supabase/functions/`, invoked over HTTPS): `woo-sync`, `woo-push`, `woo-sync-all`, `woo-webhook`, `sync-worker`, `sync-alert`, `pathao-courier`, `pathao-location-refresh`, `storefront-checkout`, `get-orders`, `parse-order-text`, `generate-storefront-content`, `team-manage`
  - Service-role access only inside functions (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`)

**WooCommerce (e-commerce store sync — outbound + inbound):**
- Pull sync (orders, products, customers): `supabase/functions/woo-sync/index.ts` (953 lines; retry/backoff on 429) and `supabase/functions/woo-sync-all/index.ts` (all stores)
- Push sync (order status → Woo): `supabase/functions/woo-push/index.ts`, driven by `sync_queue` table drained by `supabase/functions/sync-worker/index.ts` (batches of 50, SKIP LOCKED claim via RPC `claim_sync_queue_batch`, circuit breaker, full-drain up to 1000 rows)
- Status/field mapping shared in `supabase/functions/_shared/woo-mapping.ts`
  - Auth: WooCommerce REST Basic auth (`consumer_key`/`consumer_secret` stored per-store in `stores` table); no env vars
- Webhook (inbound): `supabase/functions/woo-webhook/index.ts` — verifies HMAC-SHA256 signature (`x-wc-webhook-signature`) against the store's `consumer_secret`, matches `x-wc-webhook-source` to a store, dedupes via `webhook_events` table; `verify_jwt = false` in `supabase/config.toml` (Woo sends no Authorization header)

**Pathao (courier/delivery — Bangladesh):**
- REST API at `https://api-hermes.pathao.com` — parcel creation, tracking, location refresh
  - Adapter: `supabase/functions/adapters/pathao.ts` implements the `CourierAdapter` interface from `supabase/functions/_shared/courier-adapter.ts` (courier-agnostic core since 2026-09-02 migration `courier_agnostic_core.sql`; Pathao is reference implementation — add courier #2 by adding another adapter file)
  - Functions: `supabase/functions/pathao-courier/index.ts`, `supabase/functions/pathao-location-refresh/index.ts`
  - Auth: `Deno.env` — `PATHAO_USERNAME`, `PATHAO_PASSWORD`, `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET` (OAuth token exchange)
  - UI deep links to `merchant.pathao.com` in `src/components/orders/OrderCard.tsx`, `OrderDetailSheet.tsx`; matching logic in `src/lib/pathaoMatch.ts`

**Lovable AI Gateway (LLM):**
- `https://ai.gateway.lovable.dev/v1/chat/completions`, model `google/gemini-2.5-flash`, tool calling
  - Used by: `supabase/functions/parse-order-text/index.ts` (unstructured order text → structured fields), `supabase/functions/generate-storefront-content/index.ts` (storefront copy)
  - Auth: `Deno.env` `LOVABLE_API_KEY`

**Slack (alerting — outbound):**
- `supabase/functions/sync-alert/index.ts` posts sync-failure alerts to a Slack-compatible incoming webhook
  - Auth: webhook URL stored in Supabase Vault as `sync_alert_webhook_url`, read via RPC `get_sync_alert_webhook_url` (configured by migration `20260903000400_sync_alert_webhook_url.sql`)

**Scheduler platforms (cron-as-a-service):**
- Cloudflare Worker: `cloudflare/dokanos-cron.js` — cron triggers every 5 min (`sync-worker` drain) and 15 min (`woo-sync-all`, Pathao `track_all`); calls Edge Functions with anon key + `x-cron-secret` header (vault token `sync_worker_cron_token`)
- GitHub Actions: `.github/workflows/sync-worker.yml` (*/5), `.github/workflows/woo-sync-all.yml` (*/15, `WOO_SYNC_CRON_TOKEN` secret), `.github/workflows/pathao-tracking.yml` (Pathao tracking) — originally built to replace broken Supabase pg_cron (dead since 2026-07-29, per workflow headers); to be demoted to dead-man's switches once Cloudflare cron is primary

## Data Storage

**Databases:**
- Supabase Postgres (project ref `jiwndicvfkiltgageqwv`)
  - Connection: `VITE_SUPABASE_URL` (frontend), `SUPABASE_URL` (functions); no direct DB connection strings in app code
  - Client: `@supabase/supabase-js` (frontend) / service-role client per function
  - Schema: `supabase/migrations/*.sql` — multi-business foundation (`20260904000100_multi_business_foundation.sql`), sync queue, webhook events, courier shipments, storefront, roles; RLS policies in SQL
  - Realtime: enabled via migration `20260903000500_enable_realtime.sql`; used in `src/components/integrations/GlobalSyncIndicator.tsx`, `src/hooks/useBusinessContext.tsx`, `src/hooks/useBusinessProfile.tsx`
- Secrets: Supabase Vault (`vault.create_secret`) — cron tokens, Slack webhook URL

**File Storage:**
- Not detected (no Supabase Storage bucket usage in `src/`); static assets are bundled (`public/`, `src/assets/`); og:image hosted on a Cloudflare R2 public bucket (Lovable legacy)

**Caching:**
- None server-side; browser localStorage for auth session (`src/integrations/supabase/client.ts`); service worker is a cache-clearing kill-switch (`public/sw.js`)

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (email/password)
  - Implementation: `src/hooks/useAuth.tsx` (React context `AuthProvider`, `onAuthStateChange`, role lookup in `user_roles`); session persisted in localStorage
  - Route/UI gating: `src/components/PermissionGuard.tsx`, `src/hooks/usePermissions.tsx`
  - Password reset: `src/pages/ResetPassword.tsx`
  - Edge Function auth: user JWT (gateway) OR `x-cron-secret` vault token (schedulers) OR service-role bearer; webhook functions self-verify (HMAC) with `verify_jwt = false`
  - Multi-business: business/role context in `src/hooks/useBusinessContext.tsx` (migration `20260904000100_multi_business_foundation.sql`)

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/Crashlytics); React error boundary at `src/components/ErrorBoundary.tsx`

**Logs:**
- `console.log/warn/error` in Edge Functions (Supabase function logs); Cloudflare Worker "live logs" tail for cron (`cloudflare/dokanos-cron.js` header)

**Health/Metrics:**
- Sync-health SQL view (migration `20260903000300_sync_health_view.sql`) surfaced in `src/components/dashboard/SyncHealthCard.tsx` and `src/components/integrations/GlobalSyncIndicator.tsx`; `webhook_events` table doubles as delivery audit log

## CI/CD & Deployment

**Hosting:**
- Vercel — static SPA (`vercel.json` rewrites; `.vercel/` present)
- Supabase — functions + database (linked project via `supabase/.temp/`)
- Cloudflare — Workers cron (dashboard-deployed, no wrangler config)

**CI Pipeline:**
- No build/test CI detected; `.github/workflows/` are production schedulers only (sync-worker, woo-sync-all, pathao-tracking), each with `workflow_dispatch`

## Environment Configuration

**Required env vars:**
- Frontend (`.env` → Vite): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- Edge Functions (Supabase project secrets): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (built-in), `LOVABLE_API_KEY`, `PATHAO_USERNAME`, `PATHAO_PASSWORD`, `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`
- Supabase Vault: `sync_worker_cron_token`, `woo_sync_cron_token`, `sync_alert_webhook_url`
- GitHub repo secrets: `SYNC_WORKER_CRON_TOKEN`, `WOO_SYNC_CRON_TOKEN`

**Secrets location:**
- Supabase Vault (cron tokens, Slack URL), Supabase function secrets (Pathao/AI keys), GitHub repo secrets (scheduler tokens), `.env` at root for local frontend (never read for this audit). WooCommerce consumer keys are per-row in the `stores` table (DB-encrypted-at-rest by platform, plaintext to service-role functions)

## Webhooks & Callbacks

**Incoming:**
- `POST /functions/v1/woo-webhook` — WooCommerce store webhooks (topics via `x-wc-webhook-topic`); HMAC-SHA256 verified, deduped in `webhook_events`, `verify_jwt = false` (`supabase/config.toml`)
- `POST /functions/v1/storefront-checkout` — public storefront order placement, `verify_jwt = false`, creates orders via RPC `generate_pos_order_number`

**Outgoing:**
- WooCommerce REST (pull/push syncs), Pathao Hermes API (parcels/tracking), Lovable AI Gateway (LLM calls), Slack incoming webhook (sync alerts)

## Frontend-Reachable Public Endpoints

- Storefront pages (`src/storefront/` — Home/Shop/Product/Cart/Checkout/Track) call `storefront-checkout` and `get-orders` (both `verify_jwt = false`); social links (WhatsApp `wa.me`, Facebook, Instagram, TikTok) in `src/storefront/components/StorefrontLayout.tsx`

---

*Integration audit: 2026-09-09*
