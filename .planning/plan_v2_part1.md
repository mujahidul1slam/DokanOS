# Omni-Inbox Implementation Plan v2

## Comprehensive Facebook/Instagram Chat Integration for Shohozbiz

**Date:** 2026-09-10 (v2 revision — addresses all 44 findings from `omni-inbox-critique-1.md` plus 1 additional defect found during this revision's own verification)
**Stack:** Vite + React + TypeScript + shadcn/ui + Supabase (PostgreSQL, Supabase-managed — version not pinned, see §21 note) + Supabase Edge Functions (Deno)
**Scale Target:** 5-20 agents, 100-500 conversations/day/account, multiple business accounts

---

## 0. Revision Summary (v1 → v2)

| Area | v1 | v2 |
|------|----|----|
| Bulk messaging | WhatsApp-style template approvals (nonexistent for Messenger/IG) | 24h-window-filtered campaigns + Recurring Notifications opt-in system + `HUMAN_AGENT`/`POST_PURCHASE` tags; "saved messages" = internal canned drafts, no Meta approval |
| Webhook auth | Per-account `app_secret` (chicken-and-egg, wrong level) | App-level secret in edge-function env (`META_APP_SECRET`); pipeline: parse → identify account → verify signature |
| Token encryption | `pgcrypto` + `current_setting()` GUC (works in psql only) | Vault-held key + `SECURITY DEFINER` RPCs (`connect_channel_account`, `get_channel_access_token`, `rotate_channel_token`) granted to `service_role` only |
| Outbox trigger | "poll or pg_notify" (pg_notify impossible for edge functions) | Client-insert + direct-invoke `meta-send`; auto-replies sent inline by `meta-webhook`; pg_cron + pg_net 30s sweep as safety net |
| Conversation key | `platform_conversation_id` (not delivered by Meta webhooks) | `(channel_account_id, platform_recipient_id)` — 1:1 DM model; group chats out of scope v1 |
| Meta App Review | Absent | Phase 0: app setup, business verification, App Review submission (weeks 1-3, parallel); dev-mode tester strategy for Phases 1-6 |
| `bulk_campaign_recipients` | No `business_id` → Phase 1 migration would fail | `business_id NOT NULL` column + consistency trigger; recipients keyed `(campaign_id, customer_id, channel_account_id)` |
| Staff/viewer RLS | "Add restrictive policy later" (impossible — policies OR together) | Final-shape policies in Phase 1: read = membership; write = membership + `inbox.*` permission via existing `has_permission()` |
| Customer matching at webhook | Phone lookup (Meta provides no phone) | Alias-first only (PSID/IGSID); Messenger Profile API name fetch; phone merge happens at order-creation time |
| Outbound delivery status | No schema | `messages.delivery_status/delivered_at/customer_read_at`, updated by `message_deliveries`/`message_reads` webhooks |

All 44 critique issues addressed (C1-C5, H1-H11, M1-M18, L1-L10) — mapping in §23. One additional defect found during v2's own verification (not in the critique): `customer_aliases.type` has a CHECK constraint `IN ('name','email','address')` (verified in migration `20260418114108`), so v1's `type: 'facebook_psid'` alias inserts would have been **rejected by that constraint**. Fixed in §4.2.

---

## 1. Codebase Context Summary (every fact verified in this session)

| System | Key Files | Verified Facts | Reuse |
|--------|-----------|----------------|-------|
| Multi-tenant foundation | `supabase/migrations/20260904000100_multi_business_foundation.sql` (612 lines) | `businesses` (line 22), `user_business_access` (line 43: `role` IN ('owner','admin','member','viewer')), `is_business_member()` SECURITY DEFINER (lines 56-68), RLS DO block (lines 333-408), `selling_points` (lines 125-152: has `business_id`, `brand_id`, `woo_store_id`, type includes `facebook`/`instagram`), `orders.selling_point_id`/`orders.location_id` added (lines 321-323) | `is_business_member()`, `has_role()`, RLS pattern |
| Role & permission system | `20260412161413` (`has_role`, `app_role`), `20260420112330` (`has_permission()` at line 169 — SECURITY DEFINER; combines admin + user overrides + custom roles + role presets; staff preset does NOT include new inbox perms automatically), `src/integrations/supabase/types.ts` (3496 lines; `app_permission` values end ~3454-3492, `app_role` at 3493) | `has_permission(uid, perm)` gates v2 write policies |
| Orders dialog | `src/components/orders/AddOrderDialog.tsx` (1303 lines) | Props are exactly `{ open, onOpenChange, onCreated }` (lines 89-93) — **no prefill capability**; state: `customerName/customerPhone/customerAddress/source` (default from `is_default` source); fetch effect (lines 287-300) loads products/variations/order_sources/pathao/invoice_settings/stores/categories **with no business filter**; `handleCreate` resolves customer by global phone lookup (lines 779-798) | Reuse **with specified modification** (§9.1) — not as-is |
| Product catalog | `src/components/orders/MiniProductCatalog.tsx` (246 lines) | Props: `products, categories, productCatMap, stores, onSelectProduct, onAddCustomItem` — caller supplies ALL data (Fuse.js at line 75) | Reuse; inbox fetches and passes data (§10.1) |
| Invoice | `src/lib/invoiceHtml.ts`, `src/components/pos/InvoicePrint.tsx` | HTML invoice generation | PDF render source |
| Courier | `src/components/dashboard/CourierDispatchStation.tsx`, `supabase/functions/pathao-courier/index.ts` (1259 lines) | Tracking, dispatch, store links | `CourierQuickSend` |
| Customers | `customers` table (`20260407071618` lines 55-68) | **Global table — no `business_id`**, only nullable `store_id`; `name TEXT NOT NULL`; permissive RLS `USING (true)` (line 71); global phone unique index `uq_customers_phone_global` (partial: `WHERE phone IS NOT NULL AND phone <> ''`, `20260418114108`) | Alias-first resolution (§11.1) |
| Customer aliases | `customer_aliases` (`20260418114108`) | Columns: `customer_id, type, value, source_store_id`; **`type` CHECK `IN ('name','email','address')`**; unique index `uq_customer_alias_value (customer_id, type, lower(value))` | CHECK must be extended for platform-ID alias types (§4.2) |
| Webhooks | `supabase/functions/woo-webhook/index.ts` (615 lines) | `Deno.serve`, CORS, `jsonResp()`, HMAC-SHA256 via `crypto.subtle` (lines 86-120 — compares **base64**, so Meta's hex differs, L1), idempotency via `webhook_events` delivery-id (lines 51-59), `resolveOrCreateCustomer` (lines 550-614: global phone → email → create with fallback name "Guest" → aliases), service-role client | Edge function structure; HMAC approach |
| Cron + Vault precedent | `20260802065715_schedule_woo_sync_cron.sql` (lines 12-22) | `cron.schedule` → `net.http_post` → edge function with `x-cron-secret` header read from `vault.decrypted_secrets` | Exact pattern for outbox sweep / bulk-send / token probe |
| Webhook log precedent | `20260802065800_create_webhook_events.sql` | `webhook_events` table + auto-purge at 30 days | `meta_webhook_events` (§4.2) |
| Supabase client | `src/integrations/supabase/client.ts` | Typed client, localStorage auth | — |
| UI primitives | `src/components/ui/` | `resizable.tsx` (react-resizable-panels), `responsive-dialog.tsx`, `searchable-select.tsx`, `Badge`, `ScrollArea`, `Command` | — |
| Audit logging | `audit_log` (`20260412171140`), `src/lib/auditLog.ts` | `entity_type` is **free text** (no enum/constraint) — new inbox entity types need **no schema change**, only new strings | `logAction()` |
| Order timeline | `order_timeline` (`20260407150827`), `src/lib/orderTimeline.ts` | Event-sourced history | `addOrderTimeline()` |
| Realtime precedent | `20260903000500_enable_realtime.sql` | Adds tables to `supabase_realtime` publication | Same for new tables |
| Dependencies | `package.json` (verified) | Present: `react-resizable-panels ^2.1.9`, `@tanstack/react-query ^5.83.0`, `@tanstack/query-core ^5.99.2`, `fuse.js ^7.3.0`, `vaul ^0.9.9`, `recharts ^3.8.1`, `cmdk ^1.1.1`, `zod`, `sonner`, `@playwright/test ^1.57.0`, vitest. **Absent: `@tanstack/react-virtual`** → install task in Phase 2 (M1) | — |
| Order sources | `order_sources` (`20260415165743`) | `name = 'fb/ig'` row exists (foundation line 516 selects it); the old `orders.source` CHECK was dropped (`20260415171221`) so 'fb/ig' is insertable | Preselect source in inbox order creation |

---

## 2. Architecture

### 2.1 Data Flow Overview

```
Meta Platform (FB Messenger / Instagram DM)
    |
    | HTTPS POST (webhook events) — raw body signed with APP-LEVEL secret
    v
Supabase Edge Function: meta-webhook (/functions/v1/meta-webhook)
    |
    |-- [GET]  hub.verify_token lookup by UNIQUE token on channel_accounts
    |-- [POST] 1. Read raw body
    |          2. JSON.parse → route on payload "object" ("page" | "instagram")
    |          3. Extract page_id / ig_account_id → look up channel_account
    |          4. Verify X-Hub-Signature-256 with META_APP_SECRET (app-level env secret)
    |          5. Idempotency check (UNIQUE platform_message_id on messages)
    |          6. Upsert conversation keyed (channel_account_id, platform_recipient_id)
    |          7. Persist inbound attachments to Storage (Meta CDN URLs expire)
    |          8. Insert message (created_at from Meta's event timestamp)
    |          9. Resolve/create customer (alias-first; profile API fetch for name)
    |          10. Update outbound delivery/read watermarks (message_deliveries/message_reads)
    |          11. Evaluate automation rules; auto-replies sent INLINE (same send module)
    v
Supabase PostgreSQL (conversations, messages, customers, notification_opt_ins ...)
    |
    | Supabase Realtime (postgres_changes; INSERT-only on messages)
    v
React Inbox UI (TanStack Query + Realtime + @tanstack/react-virtual)
    |
    | Agent sends reply:
    |   1. Client INSERTs message_outbox row (RLS: inbox.send_messages)
    |   2. Client invokes meta-send { outbox_id } (JWT auth)
    v
Supabase Edge Function: meta-send
    |
    |-- Verify caller JWT + business membership
    |-- Atomically claim outbox row (pending → sending)
    |-- Check 24h window / HUMAN_AGENT 7d window / active notification opt-in
    |-- Consume rate-limit token (single atomic UPDATE)
    |-- Decrypt page token via get_channel_access_token() RPC (Vault key)
    |-- Call Meta Send API
    |-- Insert messages row + update outbox status on success
    |-- On failure: retry_count++, next_retry_at backoff (sweep retries)
    v
Meta Graph API (version pinned — §3.3)
```

### 2.2 Why Supabase Edge Functions

The codebase already runs Deno edge functions (`woo-webhook`, `pathao-courier`, `parse-order-text`, `woo-sync-all`, etc.). `woo-webhook` establishes the structural pattern: `Deno.serve`, CORS headers, `crypto.subtle` HMAC verification, service-role client, webhook idempotency. No separate backend is needed.

### 2.3 Edge Functions Required

| Function | Purpose | Method / Trigger |
|----------|---------|------------------|
| `meta-webhook` | Receive all Meta webhook events (GET verification + POST events) | GET/POST (public; HMAC-verified) |
| `meta-send` | Claim outbox rows and send via Graph API; called by client after outbox insert; also sweep mode | POST (JWT auth) / POST (`x-cron-secret`) |
| `meta-bulk-send` | Bulk campaign recipient resolution + bounded-concurrency sends | POST (cron via pg_net + manual start; `x-cron-secret`) |
| `meta-token-probe` | Weekly token validity probe (`GET /{v}/{page-id}?fields=id` per account) | POST (cron via pg_net) |

Removed from v1: ~~`meta-template-submit`~~ (no Meta template-approval system exists for Messenger/IG — C2) and ~~`meta-token-refresh`~~ (long-lived page tokens derived from long-lived user tokens do not expire on a 60-day schedule — M4; see §3.4).

### 2.4 Realtime Delivery Strategy

Use Supabase Realtime `postgres_changes`:

- **Conversation list**: subscribe to `conversations` filtered by `business_id`, all events — live unread counts, `last_message_at`, assignment, status changes.
- **Message thread**: subscribe to `messages` **INSERT events only** (filtered by `conversation_id`). Subscribing to UPDATE would echo every `mark_conversation_read` / delivery-status flip to every viewer and cause refetch churn (M8). Read-state and delivery-status changes arrive via the `conversations` channel update or a targeted TanStack Query invalidation.
- **Presence**: Realtime Presence channels for agent online/away/busy within the inbox workspace.
- **Broadcast**: ephemeral typing indicators and collision detection (never persisted).

Connection budget: ~20 agents × ~4 channels each. Supabase Pro allows ~500 concurrent Realtime connections (200 is the Free-tier figure — M8). Comfortably within limits either way.

### 2.5 Message Sending Pipeline (outbox-first; pg_notify removed)

`pg_notify` is dropped entirely — edge functions are short-lived HTTP isolates with no Postgres `LISTEN` capability (H4). The pipeline:

1. **Client insert**: Agent clicks send → client INSERTs a `message_outbox` row (status `pending`, `created_by = auth.uid()`). RLS-gated on the `inbox.send_messages` permission (§5). UI shows the message immediately as "sending" (optimistic, keyed by outbox id).
2. **Direct invoke**: Client calls `POST /functions/v1/meta-send { outbox_id }` with the user's JWT. `meta-send` verifies the JWT, verifies the caller is a member of the outbox row's business, atomically claims the row (`UPDATE ... SET status='sending' WHERE id = ? AND status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at <= now())` — atomic claim, no double-send), then processes. **Latency budget: agent send ≈ 1-2s.**
3. **Auto-replies** (automation rules): `meta-webhook` evaluates rules inline after message insert and **calls the same shared send module in-process** — latency ≈ webhook processing time (~1-2s), not a poll interval (H4).
4. **Sweep (safety net)**: `pg_cron` job `inbox-outbox-sweep` runs **every 30 seconds** (exact `cron.schedule` + `net.http_post` + `x-cron-secret` pattern from `20260802065715`), calling `meta-send` in sweep mode, which claims up to 50 rows `WHERE status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at <= now())`. Catches: client invoke failures (user closed tab), retry backoffs, bulk campaign outbox rows. Sub-30s pg_cron granularity on this instance is confirmed by spike S3 (§18 Phase 0); if unsupported, fall back to 1-minute sweeps — agent sends and auto-replies are unaffected (they use the direct-invoke / inline paths).
5. **Outcomes**: success → `messages` row inserted (with `platform_message_id`), outbox → `sent`; failure → `failed` with retry backoff `30s × 2^retry_count`, max 3 retries, then permanent `failed` + agent notification; window violation → `blocked_window`, composer explains why.

---

## 3. Meta Platform Reality Check

### 3.1 The 24-Hour Window

- Free-form messaging is allowed only within 24 hours of the **customer's last message**. The clock is Meta's, not ours: inbound `messages.created_at` is set from Meta's payload `timestamp` (stored in `metadata`), never from webhook arrival time, so delayed webhook retries cannot inflate our window (H9).
- `conversations.last_customer_message_at IS NULL` means **no customer message has ever been received → window closed** (H9). NULL is treated as blocked in code, never via SQL NULL comparison semantics.
- Messenger message tags outside the window: `ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`, `HUMAN_AGENT` (extends the window to 7 days for human-support conversations), `POST_PURCHASE`. **No marketing tag exists.** IG supports the `HUMAN_AGENT` tag (7-day window; spike S5 confirms). Tags are a payload `tag` field, **not pre-approved templates** (C2).
- Meta's 24h clock resets on the customer's LAST message, not the first.

### 3.2 Proactive/Promotional Messaging — what actually exists (with verification caveats)

v1 modeled WhatsApp's template-approval system (categories MARKETING/UTILITY/AUTHENTICATION, per-template review, approval webhooks, `platform_template_id`). **None of that exists for Messenger/Instagram.** The real mechanisms as understood at plan time — **each verified in Phase 0 spikes S1/S2 before anything is built on it** (C2):

1. **Within-24h messaging** — free-form, including promotional, while the customer's window is open. The primary, always-available channel.
2. **Recurring Notifications (Messenger, available since 2023)** — the business prompts the customer to opt in to a **topic** with a **frequency** (daily/weekly/monthly). On opt-in, Meta issues a per-topic **notification token** valid for a period tied to the frequency. The business can then send the user one message per period per topic, referencing that token, **outside** the 24h window. This is Meta's intended promotional-broadcast mechanism for Messenger. **Spike S1 must verify**: exact opt-in prompt payload shape (CTA/button message), the webhook event that delivers the opt-in + token, the send payload that uses the token, per-topic frequency caps, token expiry/renewal semantics, and **whether Instagram supports this at all** (historically Messenger-only — per-account capability detection, `channel_accounts.supports_recurring_notifications`).
3. **One-Time Notification (OTN)** — single-use, per-message opt-in: customer taps a request, business gets a one-time token to send exactly one message later. Narrower than recurring; modeled in schema but not a primary mechanism.
4. **Facebook Marketing Messages** — legacy broadcast API, being deprecated by Meta. **Not used.**

**Design consequences:**
- All "templates" are now **`saved_messages`**: internal canned drafts with no Meta approval step, usable within the 24h window (or with a policy-permitted tag).
- Bulk campaigns (§12) target only recipients who are (a) inside their 24h window, or (b) hold an **active recurring-notification opt-in** for the campaign's topic. Everyone else is `skipped` with a reason. This is the honest shape of bulk messaging on FB/IG.
- **Defensive fallback**: if spike S1 finds the recurring-notifications API differs (or is unavailable for our app tier/region), bulk campaigns degrade to **within-24h-only recipients**. The schema and campaign engine are window-first by default; opt-in targeting is an additive filter, and the opt-in prompt flow + notification topics are feature-flagged per channel account. No rebuild required either way.
- `POST_PURCHASE` tag is used for order-status pushes from the inbox (a permitted proactive use); `HUMAN_AGENT` for support continuations within 7 days.

### 3.3 Graph API Version Pinning

Pin the version in ONE constant, `GRAPH_API_VERSION`, in `supabase/functions/_shared/meta-api.ts`. Baseline at plan time: `"v21.0"` (latest stable at plan time within its guaranteed support window). **Spike S4 confirms the newest stable version available to the app and bumps the constant before Phase 1 ships** (M3). Upgrade policy: re-check the pinned version at every phase boundary; watch deprecation notices in Phase 9 monitoring. All endpoint examples in this plan write `/{v}`.

### 3.4 Tokens & App Secrets

- **App Secret**: app-level — one value for the entire Meta developer app, shared by every page/IG account connected through it. Stored **only** as the edge-function environment secret `META_APP_SECRET` (`supabase secrets set`). Never a per-row column, never in a plaintext table (C3, M17). Single-app assumption is explicit; if a business ever connects through a different Meta app, a per-app secret map is added then.
- **Webhook Verify Token**: per `channel_accounts` row, `UNIQUE` (§4.2) — lookup-by-token is the intended GET flow (M16).
- **Page Access Tokens**: obtained from a long-lived user token. **They do not expire on a 60-day schedule** — long-lived *user* tokens last ~60 days; page tokens derived from them persist until password change, revocation, or deauthorization (M4). Therefore: no refresh cron. A weekly **validity probe** (`meta-token-probe`: `GET /{v}/{page-id}?fields=id` per active account, cron via pg_net) detects death early; the reconnection flow in Settings is the actual recovery. `pages_messaging`/`instagram_manage_messages` with Advanced Access are required for real-customer traffic (C5 → Phase 0, §18).

### 3.5 Rate Limiting

Meta's per-page send limits vary by call type; our own conservative bucket is the safety valve. Internal default: **40 sends/second per channel account**, capacity 40, enforced with a **single atomic UPDATE** (refill + consume in one statement — no read-modify-write race across isolates, H5). The `consume_send_tokens()` function is defined in §4.2 and granted to `service_role` only.

Throughput reality (H5): one Graph call ≈ 100-300 ms; with a bounded-concurrency pool of 10-20 in-flight requests inside `meta-bulk-send`, realistic sustained throughput is ~50-150 sends/sec per isolate — far above the ~5 msgs/sec average this product needs (500 convos/day). The internal 40/sec bucket is the binding constraint by design. v1's "200/sec bulk headroom" claim is withdrawn.

### 3.6 Instagram vs Facebook Differences

| Aspect | Facebook Messenger | Instagram |
|--------|--------------------|-----------|
| Sender ID | PSID (page-scoped) | IG scoped user ID |
| Send endpoint | `/{v}/me/messages` | `/{v}/{ig-user-id}/messages` |
| Generic template | Supported | **Supported** (v1 said "media template only" — wrong, M7; IG product cards use the generic template; IG button/media constraints differ — spike S5 confirms exact limits) |
| 24h rule | Applies | Applies |
| HUMAN_AGENT tag (7d) | Supported | Supported (spike S5 confirms) |
| Recurring notifications | Supported (2023+) | **Unverified — assume unavailable until spike S1**; IG campaigns window-only by default |
| Handover protocol | Supported | Not supported (v1 does not use it; handover events logged, ignored) |

Both normalized behind `sendMessage(channelAccount, recipientId, payload)` in `supabase/functions/_shared/meta-api.ts`.
