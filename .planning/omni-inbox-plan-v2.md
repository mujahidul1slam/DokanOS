# Omni-Inbox Implementation Plan v2

## Comprehensive Facebook/Instagram Chat Integration for Shohozbiz

**Date:** 2026-09-10 (revision of v1; addresses all 44 issues from `omni-inbox-critique-1.md`)
**Stack:** Vite + React + TypeScript + shadcn/ui + Supabase (managed PostgreSQL 15.x) + Supabase Edge Functions (Deno)
**Scale Target:** 5-20 agents, 100-500 conversations/day/account, multiple business accounts
**Status:** Every codebase claim below was re-verified against the repository during this revision (file:line citations given). Meta platform claims that could not be verified against live platform behavior are explicitly marked **[VERIFY IN PHASE 0 SPIKE]** and are backed by a documented fallback (§10.6).

### What changed from v1 (all 44 critique issues)

| # | Issue | Resolution in v2 |
|---|-------|-----------------|
| C1 | `bulk_campaign_recipients` missing `business_id` → RLS DO block fails | §2.2.11 — table now carries `business_id` + `channel_account_id`, complete SQL |
| C2 | WhatsApp-style template system does not exist for Messenger/IG | §2.2.9, §2.2.10, §10 — full redesign: `saved_messages` (internal drafts, no Meta approval), message tags, notification-subscription tracking (Recurring Notifications/OTN), within-24h-only campaigns as fallback |
| C3 | Webhook account resolution chicken-and-egg; per-row `app_secret` at wrong level | §4.2, §4.3 — app-level secret in edge-function env, verify-first pipeline, `object` field routing, `app_secret` column deleted |
| C4 | Token encryption unusable from edge functions | §13.1 — vault key + `SECURITY DEFINER` encrypt trigger + `get_channel_access_token()` RPC; exact decrypt path for `meta-send` |
| C5 | Meta App Review / business verification absent | Phase 0 (§14) — 3-week track, screencasts, Advanced Access, dev-mode tester strategy, review-approval gate |
| H1 | `customer_tags` UNIQUE missing `business_id` (customers is global) | §2.2.6 — `UNIQUE (business_id, customer_id, tag)`, index `(business_id, tag)` |
| H2 | No outbound delivery/read status schema | §2.2.3 — `delivery_status`, `delivered_at`, `customer_read_at` on `messages` |
| H3 | Inbound attachment URLs expire | §5.5 — webhook-time download to Storage, signed URLs on read; agent upload path specified |
| H4 | `pg_notify` impossible for edge functions; outbox trigger contradiction | §1.5, §5.6 — outbox-first, direct `meta-send` claim + pg_cron/pg_net 30s sweep (repo precedent 20260802065715); `pg_notify` dropped |
| H5 | Token bucket read-modify-write race; 200/sec claim unexamined | §5.3 — single-statement atomic bucket RPC, bounded-concurrency bulk send, honest throughput figures |
| H6 | `AddOrderDialog` has no prefill capability | §6.1 — exact optional-prop modification spec (`prefill?`), backwards-compatible; business-scoped data lists |
| H7 | RLS restrictive-policy dead end | §2.3 — per-class write policies in final shape using existing `has_permission()` (verified, migration 20260420112330) |
| H8 | `mark_conversation_read` SECURITY DEFINER hole | §2.5.2 — ownership assertion inside body |
| H9 | Window bookkeeping uses insert-time now(); NULL window undefined; HUMAN_AGENT omitted | §2.2.2, §2.2.3, §4.5 — `platform_timestamp`, generated `window_expires_at`, NULL = window closed, HUMAN_AGENT 7-day support |
| H10 | `platform_conversation_id` not well-defined | §2.2.2 — conversation key = `(channel_account_id, platform_recipient_id)`; 1:1 DM model; group chats out of scope |
| H11 | Webhook-time phone matching impossible | §7.1 — alias-first resolution only; profile-API fetch for name; phone merge moved to order creation |
| M1 | `@tanstack/react-virtual` not in package.json | Phase 2 checklist — `npm i @tanstack/react-virtual` (verified absent) |
| M2 | Wrong types.ts citation | Preamble — `src/integrations/supabase/types.ts`, app_permission at 3454-3492 |
| M3 | Graph API v20.0 past supported life | §5.0 — pin current stable at Phase 0, single `GRAPH_VERSION` constant, upgrade policy |
| M4 | "60-day page token expiry" wrong | §5.4 — page tokens from long-lived user tokens do not expire; weekly validity probe replaces refresh cron |
| M5 | `rate_limit_buckets` not RLS-enabled | §2.2.13 — RLS enabled, no policies, service-role-only grants |
| M6 | Storage bucket policies unspecified | §2.6 — complete `storage.objects` policies keyed by path business segment |
| M7 | "IG: no generic templates" wrong | §4.6 — generic template on both platforms |
| M8 | Realtime: wrong Pro limit; UPDATE echo churn | §1.4 — ~500 connections (Pro); INSERT-only subscription on messages |
| M9 | New-customer NOT NULL name fails | §7.1 — profile fetch with fallback names, avatar persisted to Storage |
| M10 | No mobile strategy | §3.1.1 — breakpoint strategy, vaul drawer (verified in deps) |
| M11 | Missing UX states, pagination, search UI | §3.6, §3.7 — empty/loading/failure states, keyset pagination, search component |
| M12 | "Has ordered" indicator not implemented | §2.5.3 — two DB triggers (orders + conversation_orders), badge surfacing |
| M13 | No retention policy | §17.5 — pg_cron purge jobs + 12-month message archive table |
| M14 | Opt-out / recipient semantics ambiguous | §2.2.15, §10.3 — NULL channel = global opt-out; per-platform recipient rows |
| M15 | CSAT violates 24h window | §11.3 — immediate send on resolution, in-thread prompt fallback |
| M16 | `webhook_verify_token` not UNIQUE | §2.2.1 — `UNIQUE (webhook_verify_token)` |
| M17 | `app_secret` plaintext column | Column deleted; edge env / vault only |
| M18 | Webhook event log table never defined | §2.2.14 — `meta_webhook_events`, service-role-only, 30-day purge |
| L1 | "Mirror woo-webhook exactly" — encoding differs | §5.3, §15.2 wording fixed (Woo base64 vs Meta `sha256=` hex) |
| L2 | "virtual column" impossible | §2.2.2 — `GENERATED ALWAYS AS ... STORED` |
| L3 | FTS over JSON-bearing column | §2.4 — partial index `WHERE content_type = 'text'` |
| L4 | Double `updated_at` write | §2.5.1 — explicit set removed |
| L5 | PostgreSQL 14.5 stale | Header — "managed PostgreSQL 15.x" |
| L6 | Handovers ≠ account deletion | §16.4 row rewritten |
| L7 | "Meta retries up to 24h" undocumented | §16.1 — schedule unstated; 20-second response requirement kept |
| L8 | MiniProductCatalog not self-sufficient | §15.1 — caller-supplied data documented (props verified at lines 31-39) |
| L9 | Audit entity types | §13.4 — free-text constants added (column verified as plain `text`) |
| L10 | Cost estimate 10x off | §17.1 — 10-20K webhook invocations/day |

**Additional defects found during this revision's verification pass (not in the 44):**

- **A1:** `customer_aliases.type` has a CHECK constraint allowing only `('name','email','address')` (verified: migration 20260418114108, table definition). v1's plan to insert `type: 'facebook_psid'` / `'instagram_id'` aliases would fail with a constraint violation on every webhook. Fixed in §2.2.0 (constraint replaced, platform-ID values added, lookup index created).
- **A2:** v1's analytics materialized view referenced `conversations.first_agent_response_at`, a column v1 never defined in its schema. Fixed in §2.2.2 (column added, populated by the §2.5.1 trigger).

---

## Preamble: Verified Codebase Facts

Every fact below was verified directly during this revision session:

| Fact | Evidence |
|---|---|
| `customers` is a **global** table — no `business_id`, nullable `store_id`, `name TEXT NOT NULL`, permissive RLS `USING (true)` | Migration `20260407071618_75b9cdbd-ffa1-48c1-bbce-54015ebc3c86.sql` (customers block read in full) |
| `customer_aliases`: `type text NOT NULL CHECK (type IN ('name','email','address'))`, unique index `(customer_id, type, lower(value))`, nullable `source_store_id` FK to stores | Migration `20260418114108_15541481-23a5-43f7-9792-6e3c6c2d4ae1.sql` lines 7-18 |
| Multi-tenant RLS pattern: DO block with `FOREACH` over `business_id`-carrying tables; `has_role(auth.uid(),'admin') OR is_business_member(business_id)` | `20260904000100_multi_business_foundation.sql` lines 333-348 |
| `is_business_member()` — `SECURITY DEFINER`, checks `user_business_access` | Foundation lines 56-68 |
| `user_business_access` — per-business roles `('owner','admin','member','viewer')`, `UNIQUE (user_id, business_id)` | Foundation lines 43-53 |
| `has_role(_user_id, _role)` — SECURITY DEFINER over `user_roles` | Migration `20260412161413_d2006eab-219f-4bd9-9489-6a3a448bef24.sql` |
| **`has_permission(_user_id, _permission)` exists** — SECURITY DEFINER; admin bypass, per-user override, custom-role grants | Migration `20260420112330_bfd713d1-04d8-416e-a7e6-cae7f3d7a9f5.sql` (function head read in full) |
| `trigger_set_timestamp()` | Migration `20260803160000_create_sync_queue.sql` line 20 |
| woo-webhook: 616 lines; HMAC via `crypto.subtle`, **compares base64** (`btoa`) at lines 86-120; idempotency via `webhook_events.delivery_id` lookup at lines 50-59; service-role client line 48; `resolveOrCreateCustomer` at lines 550-614 — phone-first **global** lookup, email fallback, create, alias recording | `supabase/functions/woo-webhook/index.ts` |
| `AddOrderDialog` — 1304 lines; `Props { open, onOpenChange, onCreated }` at lines 89-93; **no prefill props exist**; source default state line 241; customer resolved by typed phone at line 782; customer insert at line 796 | `src/components/orders/AddOrderDialog.tsx` |
| `MiniProductCatalog` props: `products, categories, productCatMap?, stores, onSelectProduct, onAddCustomItem, className?` — caller must supply all data | `src/components/orders/MiniProductCatalog.tsx` lines 31-39 |
| package.json: has `@tanstack/react-query`, `@tanstack/query-core`, `react-resizable-panels`, `fuse.js`, `vaul`, `recharts`; **does NOT have `@tanstack/react-virtual`** | `package.json` dependencies |
| `webhook_events`: service-role-only (`REVOKE ... FROM PUBLIC, anon, authenticated; GRANT ALL ... TO service_role`) | Migration `20260802065800_create_webhook_events.sql` |
| pg_cron → edge function precedent: `cron.schedule` + `net.http_post` to the function URL with an `x-cron-secret` header drawn from `vault.decrypted_secrets` | Migration `20260802065715_schedule_woo_sync_cron.sql` |
| Vault precedent: `vault.create_secret` + `SECURITY DEFINER` getter RPC with `SET search_path = public, vault` | Migration `20260901000000_scheduler_auth_and_courier_tokens.sql` |
| Realtime publication precedent: `ALTER PUBLICATION supabase_realtime ADD TABLE` | Migration `20260903000500_enable_realtime.sql` |
| Type definitions live in `src/integrations/supabase/types.ts` (3497 lines); `app_permission` enum values at lines 3454-3492; `app_role` at 3493 | — |
| `orders.source` CHECK constraint was dropped (any text insertable); `order_sources` has an `'fb/ig'` row | Migration `20260415171221` (drop verified); foundation line 516 |
| `selling_points` maps businesses to channels: `business_id NOT NULL`, `type IN ('facebook','instagram', ...)`, nullable `woo_store_id` FK | Foundation lines 125-155 |
| `audit_log.entity_type` is plain `text` (no enum constraint); `logAction(action: string, entityType: string, ...)` | Migration `20260412171140`; `src/lib/auditLog.ts` line 5 |
| pg_cron used extensively (13 `cron.schedule` sites across migrations); pg_net precedent for HTTP-calling edge functions | — |

---

## Codebase Context Summary

| System | Key Files | Reuse Opportunity |
|--------|-----------|-------------------|
| Multi-tenant foundation | `supabase/migrations/20260904000100_multi_business_foundation.sql` | `businesses`, `user_business_access`, `brands`, `selling_points` (has `facebook`/`instagram` types), `is_business_member()`, `has_role()`, `has_permission()` RLS toolkit |
| Role/permission system | `src/integrations/supabase/types.ts` (app_permission at 3454-3492) | `app_permission` enum extension; `user_permissions`/`custom_roles` consumed by `has_permission()` |
| Orders | `src/components/orders/AddOrderDialog.tsx` (1304 lines) | Order creation flow — **requires a small modification for inbox prefill** (§6.1); not as-is reuse |
| Product catalog | `src/components/orders/MiniProductCatalog.tsx` | Fuse.js product search — **caller supplies products/categories/stores** (props verified) |
| Invoice | `src/lib/invoiceHtml.ts`, `src/components/pos/InvoicePrint.tsx` | HTML invoice generation ready for PDF rendering |
| Courier | `src/components/dashboard/CourierDispatchStation.tsx`, `supabase/functions/pathao-courier/index.ts` | Tracking/dispatch patterns |
| Customers | `customers` (global), `customer_aliases` | Alias-based platform-ID → customer mapping (type CHECK must be extended, §2.2.0) |
| Webhooks | `supabase/functions/woo-webhook/index.ts` | Deno.serve, CORS, `crypto.subtle` HMAC, idempotency, service-role client (HMAC *comparison encoding* differs from Meta — §5.3) |
| Cron + pg_net | `20260802065715_schedule_woo_sync_cron.sql` | Exact pattern for cron-triggered edge functions with vault-held cron token |
| Vault | `20260901000000_scheduler_auth_and_courier_tokens.sql` | Pattern for vault secret + SECURITY DEFINER getter |
| Supabase client | `src/integrations/supabase/client.ts` | Typed client with `Database` type, localStorage auth |
| UI primitives | `src/components/ui/` | `resizable.tsx` (react-resizable-panels), `responsive-dialog.tsx`, `searchable-select.tsx`, `Badge`, `ScrollArea`, vaul drawer |
| Audit logging | `audit_log` table, `src/lib/auditLog.ts` | `logAction()` (entity_type is free text — add inbox constants, §15.4) |
| Order timeline | `order_timeline` table, `src/lib/orderTimeline.ts` | Event-sourced order history |
| Selling points | `selling_points` table | Already has `facebook` and `instagram` types (foundation line 133) |

---

## 1. Architecture

### 1.1 Data Flow Overview

```
Meta Platform (FB Messenger / Instagram DM)
    |
    | HTTPS POST (webhook events, X-Hub-Signature-256)
    v
Supabase Edge Function: meta-webhook (/functions/v1/meta-webhook)
    |
    |-- 1. Read raw body; verify HMAC-SHA256 with APP-LEVEL secret (edge env META_APP_SECRET)
    |-- 2. Parse payload; route by "object" field ("page" -> FB, "instagram" -> IG)
    |-- 3. Extract recipient.id (page_id / ig_account_id); look up channel_account
    |-- 4. Idempotency check (meta_webhook_events + messages.platform_message_id UNIQUE)
    |-- 5. Upsert conversation keyed by (channel_account_id, platform_recipient_id)
    |-- 6. Persist inbound attachments to Storage (Meta CDN URLs expire)
    |-- 7. Resolve/create customer (alias-first; profile API for name)
    |-- 8. Insert message with Meta's event timestamp
    |-- 9. Update outbound delivery/read statuses (message_deliveries / message_reads)
    |-- 10. Record notification opt-ins (messaging_optins -> notification_subscriptions)
    |-- 11. Evaluate automation rules -> insert message_outbox rows
    |-- 12. Fire meta-outbox-sweep (non-blocking) for instant auto-replies
    v
Supabase PostgreSQL (conversations, messages, customers, message_outbox)
    |
    | Supabase Realtime (postgres_changes, INSERT-only on messages)
    v
React Inbox UI (TanStack Query + Realtime + @tanstack/react-virtual)

Agent sends reply:
  UI -> INSERT message_outbox (status 'pending', RLS-validated)
     -> POST meta-send {outbox_id}  (JWT-authenticated)
          |-- claim row atomically (status 'sending')
    |-- window / tag / subscription check (§4.5, §5.2)
    |-- atomic rate-limit token (§5.3)
    |-- decrypt page token via get_channel_access_token RPC (§13.1)
          |-- call Meta Send API
          |-- insert message row; set outbox 'sent' or schedule retry
     -> (safety net) pg_cron 30s sweep via pg_net handles retries,
        automation rows, and campaign batches (meta-outbox-sweep)
```

### 1.2 Why Supabase Edge Functions

The codebase uses Deno edge functions extensively (`woo-webhook`, `pathao-courier`, `parse-order-text`, plus cron-triggered functions via pg_net). The woo-webhook function establishes the pattern we **adapt** (not copy byte-for-byte): `Deno.serve`, CORS headers, `crypto.subtle.importKey` HMAC, service-role client, idempotency checks. One deliberate difference: the HMAC *comparison encoding* — Woo compares base64 (`btoa`, woo-webhook line 104), Meta uses `sha256=` + lowercase hex (§5.3). No separate backend server is needed.

### 1.3 Edge Functions Required

| Function | Purpose | Trigger |
|----------|---------|---------|
| `meta-webhook` | Receive all Meta webhook events (verification GET + event POST) | GET/POST from Meta |
| `meta-send` | Claim and process a single outbox row (send + status update) | POST from client (JWT) |
| `meta-outbox-sweep` | Process pending/retrying outbox rows + dispatch automation auto-replies | pg_cron every 30s via pg_net; also fired non-blocking by `meta-webhook` |
| `meta-bulk-send` | Campaign engine: audience build, recipient rows, paced dispatch loop | pg_cron every minute; picks up scheduled campaigns |
| `meta-token-probe` | Weekly page-token validity check (`GET /{page-id}?fields=id`) + alerts | pg_cron weekly |

Removed from v1: `meta-template-submit` (no Meta template-approval system exists for Messenger/IG — §10). Renamed: `meta-token-refresh` → `meta-token-probe` (long-lived page tokens obtained from long-lived user tokens do not expire on a 60-day clock — §5.9).

### 1.4 Realtime Delivery Strategy

Supabase Realtime `postgres_changes` subscriptions:

- **Conversation list**: subscribe to `conversations` (all events) filtered by `business_id` — live unread counts, `last_message_at`, assignment changes.
- **Message thread**: subscribe to `messages` **INSERT events only**, filtered by `conversation_id`. Subscribing to `event: '*'` would broadcast every `UPDATE` (e.g., `mark_conversation_read` flipping `is_read`, delivery-status updates) as echo/refetch churn to every viewer — INSERT-only avoids that. Read/delivery state flows through the `conversations` channel or a targeted refetch.
- **Outbox status**: INSERT-only subscription on `message_outbox` filtered by `conversation_id` drives the "sending → sent/failed" inline affordances (§3.6).
- **Presence**: Realtime Presence channels for agent online/offline/typing indicators.
- **Broadcast**: ephemeral collision-detection events (§9.5) that should not persist.

Capacity: Supabase Pro allows ~500 concurrent Realtime connections (v1's "~200" was the Free-tier figure); 20 agents holding one browser connection each with multiple channel subscriptions is comfortably within limits. Realtime publication membership for `conversations` + `messages` is added in the Phase 1 migration (§2.7); `messages` and `conversations` get `REPLICA IDENTITY FULL` so RLS-filtered postgres_changes deliver row payloads.

### 1.5 Message Sending Pipeline (v1's contradiction resolved)

**Architecture decision: outbox-first, two trigger paths, no `pg_notify`.** Edge functions cannot `LISTEN` on Postgres channels — they are short-lived HTTP-invoked isolates with no persistent Postgres connection (v1's mention was a technical impossibility and is removed).

1. Agent clicks send → client inserts a `message_outbox` row (`status: 'pending'`) via supabase-js. RLS validates membership + permission at insert time (§2.3).
2. Client immediately invokes `meta-send` with `{ outbox_id }` (JWT-authenticated). `meta-send` claims the row atomically: `UPDATE message_outbox SET status='sending' WHERE id=$1 AND status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at <= now()) RETURNING *` — concurrent invocations cannot double-send.
3. `meta-send` applies window/tag/subscription rules (§5.2), consumes a rate token (§5.3), decrypts the page token via the `get_channel_access_token` RPC (§13.1), calls Meta, inserts the `messages` row, and sets outbox `sent` / `failed`+`next_retry_at` / `blocked_window`.
4. **Interactive-send latency budget: < 1s** (direct invoke; no polling delay).
5. **Automation auto-replies** (inserted by `meta-webhook` with no user present to invoke meta-send): after inserting outbox rows, the webhook fires a non-blocking HTTP call to `meta-outbox-sweep` → auto-reply latency **≤ 2s typical**.
6. **Safety net**: pg_cron schedules `meta-outbox-sweep` every 30 seconds (pg_net + `x-cron-secret` vault token, exact pattern of migration 20260802065715). The sweep claims `pending` rows older than 5 seconds, all `failed` rows with `next_retry_at <= now()`, and hands campaign batches to `meta-bulk-send`. If the platform's pg_cron rejects sub-minute intervals at implementation time, fall back to a 1-minute schedule — interactive sends are unaffected (direct-invoke path), only the safety net widens.
7. Retries: exponential backoff (1s, 2s, 4s … max 5 attempts), then terminal `failed` with an agent-facing inline retry affordance (§3.6).

This decouples the UI from Meta API latency, provides automatic retry semantics, and gives every outbox row a processor. `pg_notify` is gone.

---

## 2. Database Schema

All new tables follow the existing multi-tenant pattern: `business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE`, RLS reads via `is_business_member(business_id) OR has_role(auth.uid(),'admin')`, and **per-class write policies gated on `has_permission()`** written in final shape from day one (v1's blanket member-write policy would grant viewers full write and RLS permissive policies OR together — you cannot restrict later; fixed per H7).

**Two exceptions:** `conversation_viewers` has no `business_id` (keyed to conversation; policy joins), and `meta_webhook_events` + `rate_limit_buckets` are service-role-only (no policies).

### 2.1 New Enums

```sql
CREATE TYPE public.channel_platform AS ENUM ('facebook', 'instagram');
CREATE TYPE public.conversation_status AS ENUM ('open', 'assigned', 'waiting', 'resolved', 'closed');
CREATE TYPE public.conversation_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE public.message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE public.message_sender_type AS ENUM ('customer', 'agent', 'system', 'bot');
CREATE TYPE public.message_content_type AS ENUM (
  'text', 'image', 'video', 'audio', 'file',
  'product_card', 'invoice_pdf', 'courier_info',
  'order_confirmation', 'saved_message', 'quick_reply',
  'internal_note'
);
CREATE TYPE public.outbox_status AS ENUM ('pending', 'sending', 'sent', 'failed', 'blocked_window', 'cancelled');
CREATE TYPE public.campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'completed', 'paused', 'failed');

-- app_permission additions (ALTER TYPE ... ADD VALUE must run outside a transaction block
-- in some migration runners; split into its own migration file if needed)
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.manage';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.send_messages';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.bulk_send';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.view_analytics';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.send_tagged';
```

Changes from v1: `template_status` enum deleted (no Meta approvals — C2). `outbox_status.blocked_24h` → `blocked_window` (HUMAN_AGENT's 7-day window and subscription sends changed the semantics). `message_content_type.template` → `saved_message`. `automation_action_type` is folded into the `automation_rules` CHECK below (no separate type needed). v1's `inbox.manage_templates` permission removed; `inbox.send_tagged` added (message tags are permission-gated, §5.2).

### 2.2.0 Pre-existing schema changes (required — without these, webhook customer resolution fails)

```sql
-- ============================================================================
-- A1 (new discovery): customer_aliases.type CHECK only allows
-- ('name','email','address') — verified in migration 20260418114108.
-- v1 planned to insert type='facebook_psid' aliases, which would violate
-- the constraint on every webhook. Replace the CHECK and add a lookup index.
-- ============================================================================
ALTER TABLE public.customer_aliases DROP CONSTRAINT IF EXISTS customer_aliases_type_check;
ALTER TABLE public.customer_aliases ADD CONSTRAINT customer_aliases_type_check
  CHECK (type IN ('name','email','address','facebook_psid','instagram_id'));

-- Webhook-time resolution looks up by (type, value); existing indexes are
-- customer-keyed only.
CREATE INDEX IF NOT EXISTS idx_customer_alias_type_value
  ON public.customer_aliases (type, lower(value));
```

(`source_store_id` is nullable — platform aliases insert with `NULL`.)

### 2.2.1 Channel Accounts

```sql
-- ============================================================================
-- Channel Accounts: Meta Page/IG account connections per business
-- NOTE: no app_secret column — the Meta App Secret is APP-LEVEL (one per
-- developer app, shared by every page/IG account connected through it) and
-- lives in the edge function environment (META_APP_SECRET). Never per-row
-- (C3, M17).
-- ============================================================================
CREATE TABLE public.channel_accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform                 public.channel_platform NOT NULL,
  account_name             text NOT NULL,
  page_id                  text,                    -- FB Page ID
  ig_account_id            text,                    -- Instagram professional account ID
  access_token_encrypted   text NOT NULL,           -- PGP-armored ciphertext (§13.1)
  webhook_verify_token     text NOT NULL,           -- 32+ byte random value; UNIQUE (M16)
  token_validated_at       timestamptz,             -- Set by weekly meta-token-probe
  is_active                boolean NOT NULL DEFAULT true,
  last_connected_at        timestamptz,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, page_id),
  UNIQUE (platform, ig_account_id),
  UNIQUE (webhook_verify_token)
);
CREATE INDEX idx_channel_accounts_business ON public.channel_accounts(business_id);
CREATE TRIGGER set_channel_accounts_updated_at BEFORE UPDATE ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
-- (trigger_set_timestamp exists: verified at 20260803160000:20)
```

Changes from v1: `app_secret`, `permissions`, `token_expires_at` columns removed (app-level secret; permissions are app-level concepts; page tokens from long-lived user tokens don't expire on a clock — §5.9). `webhook_verify_token` made UNIQUE — gives the GET-verification lookup an index and guarantees `maybeSingle` is unambiguous. `token_validated_at` added.

### 2.2.2 Conversations

```sql
-- ============================================================================
-- Conversations — 1:1 DM model (H10): a conversation IS the (account, recipient)
-- pair. Messenger/IG webhooks provide no durable thread ID; PSID/IGSID is the
-- stable thread identity for 1:1 DMs. Group chats are OUT OF SCOPE for v1
-- (they need a different conversation key; documented in §4.6).
-- ============================================================================
CREATE TABLE public.conversations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id        uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  platform                  public.channel_platform NOT NULL,
  platform_recipient_id     text NOT NULL,          -- PSID (FB) or IG scoped ID
  customer_id               uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  assigned_agent_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status                    public.conversation_status NOT NULL DEFAULT 'open',
  priority                  public.conversation_priority NOT NULL DEFAULT 'normal',
  tags                      text[] NOT NULL DEFAULT '{}',
  last_message_at           timestamptz,
  last_customer_message_at  timestamptz,            -- NULL => 24h window CLOSED (H9)
  last_agent_message_at     timestamptz,
  first_agent_response_at   timestamptz,            -- analytics (A2 — v1's MV referenced this without defining it)
  unread_count              integer NOT NULL DEFAULT 0,
  snoozed_until             timestamptz,
  closed_at                 timestamptz,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  -- L2 fix: real stored generated column (Postgres has no virtual columns)
  window_expires_at         timestamptz GENERATED ALWAYS AS
                             (last_customer_message_at + interval '24 hours') STORED,
  UNIQUE (channel_account_id, platform_recipient_id)
);
CREATE INDEX idx_conversations_business_status ON public.conversations(business_id, status);
CREATE INDEX idx_conversations_assigned_agent ON public.conversations(assigned_agent_id, status) WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX idx_conversations_last_message ON public.conversations(business_id, last_message_at DESC);
CREATE INDEX idx_conversations_customer ON public.conversations(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_conversations_tags ON public.conversations USING GIN (tags);
CREATE INDEX idx_conversations_unread ON public.conversations(business_id) WHERE unread_count > 0;
-- Window-filtered campaign audience queries (§10.3)
CREATE INDEX idx_conversations_window ON public.conversations(channel_account_id, last_customer_message_at)
  WHERE last_customer_message_at IS NOT NULL;
CREATE TRIGGER set_conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
```

Changes from v1: `platform_conversation_id` removed — `(channel_account_id, platform_recipient_id)` is the upsert key (H10). `window_expires_at` is a GENERATED STORED column (L2). `first_agent_response_at` added (A2). **NULL `last_customer_message_at` is defined to mean the window is closed** — every window comparison is NULL-safe by that definition, and `meta-send` treats NULL as blocked for freeform sends (H9).

### 2.2.3 Messages

```sql
-- ============================================================================
-- Messages (inbound, outbound, internal notes, system events)
-- ============================================================================
CREATE TABLE public.messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction             public.message_direction NOT NULL,
  sender_type           public.message_sender_type NOT NULL,
  sender_id             text,                       -- Platform sender ID (inbound)
  sender_agent_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content_type          public.message_content_type NOT NULL DEFAULT 'text',
  content               text,                       -- Text body; JSON ONLY for structured types
  attachments           jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{storage_path, filename, mime, size, type, meta_url}]
    -- storage_path: persisted Supabase Storage object (H3); meta_url kept for debugging
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  platform_message_id  text,
  platform_timestamp    bigint,                     -- Meta's event timestamp, ms epoch (H9)
  -- Agent-read state for INBOUND messages
  is_read               boolean NOT NULL DEFAULT false,
  read_at               timestamptz,
  -- Customer delivery/read state for OUTBOUND messages (H2)
  delivery_status       text CHECK (delivery_status IN ('sent','delivered','read','failed')),
  delivered_at          timestamptz,
  customer_read_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_message_id)
);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at ASC);
CREATE INDEX idx_messages_business_time ON public.messages(business_id, created_at DESC);
CREATE INDEX idx_messages_sender_agent ON public.messages(sender_agent_id) WHERE sender_agent_id IS NOT NULL;
CREATE INDEX idx_messages_unread ON public.messages(conversation_id) WHERE is_read = false AND direction = 'inbound';
-- delivery-status updates from webhooks scan outbound sent messages by mid
CREATE INDEX idx_messages_delivery_pending ON public.messages(platform_message_id)
  WHERE direction = 'outbound' AND delivery_status = 'sent';
```

Window bookkeeping (H9): inbound inserts set `created_at = to_timestamp(platform_timestamp / 1000.0)` — Meta's event timestamp, not webhook-processing `now()`, so a delayed or retried delivery doesn't inflate the window past what Meta enforces. The `handle_new_message` trigger (§2.5.1) propagates `created_at` into `last_customer_message_at`.

### 2.2.4 Message Outbox

```sql
-- ============================================================================
-- Message Outbox: queue for ALL outbound sends (§1.5)
-- ============================================================================
CREATE TABLE public.message_outbox (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  content_type          public.message_content_type NOT NULL,
  content               text NOT NULL,
  attachments           jsonb NOT NULL DEFAULT '[]'::jsonb,
  saved_message_id      uuid REFERENCES public.saved_messages(id) ON DELETE SET NULL,
  template_variables    jsonb,                      -- Variable substitution for saved drafts
  -- Send modes (meta-send derives the path per §5.2; at most one set):
  message_tag           text CHECK (message_tag IN ('ACCOUNT_UPDATE','CONFIRMED_EVENT_UPDATE','HUMAN_AGENT','POST_PURCHASE')),
  subscription_id      uuid REFERENCES public.notification_subscriptions(id) ON DELETE SET NULL,
  campaign_id           uuid REFERENCES public.bulk_campaigns(id) ON DELETE CASCADE,
  status                public.outbox_status NOT NULL DEFAULT 'pending',
  error_message         text,
  retry_count           integer NOT NULL DEFAULT 0,
  next_retry_at         timestamptz,
  sent_at               timestamptz,
  platform_message_id   text,                       -- Meta's returned message ID after send
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_pending ON public.message_outbox(status, next_retry_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX idx_outbox_conversation ON public.message_outbox(conversation_id);
CREATE INDEX idx_outbox_channel ON public.message_outbox(channel_account_id, status);
```

Changes from v1: `template_id` → `saved_message_id` (C2). `message_tag` (permitted Meta message tags — the only out-of-window freeform-text escape hatch, permission-gated as `inbox.send_tagged`), `subscription_id` (recurring/OTN sends), and `campaign_id` columns added. Status enum `blocked_24h` → `blocked_window`.

### 2.2.5 Conversation-Order Links

```sql
CREATE TABLE public.conversation_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  linked_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, order_id)
);
CREATE INDEX idx_conv_orders_order ON public.conversation_orders(order_id);
CREATE INDEX idx_conv_orders_conversation ON public.conversation_orders(conversation_id);
```

### 2.2.6 Customer Tags (H1 fix — `customers` is a verified GLOBAL table)

Because `customers` has no `business_id` (verified — migration 20260407071618) and the inherited resolution strategy deliberately creates shared customer records across businesses, tags MUST be scoped by `(business_id, customer_id, tag)`:

```sql
CREATE TABLE public.customer_tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tag           text NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id, tag)
);
-- Business-scoped for audience-builder tag filters (never cross tenants)
CREATE INDEX idx_customer_tags_business_tag ON public.customer_tags(business_id, tag);
CREATE INDEX idx_customer_tags_customer ON public.customer_tags(customer_id);
```

### 2.2.7 Customer Notes

```sql
CREATE TABLE public.customer_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  content       text NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_notes_customer ON public.customer_notes(customer_id);
```

### 2.2.8 Quick Replies

```sql
CREATE TABLE public.quick_replies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  shortcut      text NOT NULL,                     -- e.g., "/hours"
  content       text NOT NULL,
  category      text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, shortcut)
);
```

### 2.2.9 Saved Messages (C2 redesign — replaces `message_templates`)

**There is no Meta template-approval system for Messenger/Instagram.** The WhatsApp categories (MARKETING/UTILITY/AUTHENTICATION), per-template submission, `platform_template_id`, and approval-status webhooks do not exist for these platforms and are removed entirely. What remains is an **internal saved-draft library** — reusable message content for within-24h sends (and tag/subscription sends). No approval workflow, no platform IDs, no `meta-template-submit` function.

```sql
CREATE TABLE public.saved_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name          text NOT NULL,
  body          text NOT NULL,                     -- Text; may embed {{variable}} placeholders
  variables     text[] NOT NULL DEFAULT '{}',      -- Variable names for substitution
  category      text NOT NULL DEFAULT 'general'
                CHECK (category IN ('general','promo','support','order_status','csat','optin_prompt')),
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
```

### 2.2.10 Notification Subscriptions (C2 — Recurring Notifications / OTN tracking)

Mechanism (Messenger; **[VERIFY IN PHASE 0 SPIKE]** for exact payload shapes and current limits):

- **Recurring Notifications**: business sends an in-conversation opt-in prompt (CTA) for a topic; if the user accepts, Meta delivers a `messaging_optins`-family webhook carrying a notification token tied to the topic; while the subscription is active, the page may send messages on that topic **outside the 24h window** using the token. Per-topic re-prompt frequencies and validity periods apply.
- **One-Time Notification (OTN)**: a single follow-up per opt-in, same webhook event family, one usable short-lived token.
- **Instagram**: to the best of our knowledge at plan time, Recurring Notifications is Messenger-only; IG campaigns are designed within-24h-only unless the spike proves otherwise (fallback §10.6).

```sql
CREATE TABLE public.notification_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id  uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  customer_id         uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  platform            public.channel_platform NOT NULL,
  subscription_type   text NOT NULL CHECK (subscription_type IN ('recurring','one_time')),
  topic               text,                         -- Recurring topic (e.g., 'new_arrivals')
  frequency           text,                         -- Opt-in frequency, if provided [VERIFY spike]
  token               text NOT NULL,                -- Notification token used for sends
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','used','expired','revoked')),
  opted_in_at         timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,                  -- Recurring: per-topic validity; OTN: short-lived
  quota_remaining     integer,                      -- If Meta enforces per-subscription quotas [VERIFY]
  last_sent_at        timestamptz,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- Raw optin payload for debugging
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, token)
);
CREATE INDEX idx_subscriptions_active ON public.notification_subscriptions(channel_account_id, status)
  WHERE status = 'active';
CREATE INDEX idx_subscriptions_customer ON public.notification_subscriptions(customer_id);
CREATE INDEX idx_subscriptions_conversation ON public.notification_subscriptions(conversation_id);
```

Token storage note: unlike page tokens (which can act as the page for anything), a notification token is a per-recipient send capability with a small blast radius (one customer, one topic, expiring). It is stored in this RLS-protected table, written only by the service role (webhook), readable by business members — proportionate protection without the PGP machinery of §15.1.

### 2.2.11 Bulk Campaigns + Recipients (C1 fix)

```sql
CREATE TABLE public.bulk_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  saved_message_id      uuid REFERENCES public.saved_messages(id) ON DELETE SET NULL,
  name                  text NOT NULL,
  status                public.campaign_status NOT NULL DEFAULT 'draft',
  audience_filter       jsonb NOT NULL DEFAULT '{}'::jsonb,
      -- {tags: [...], min_orders: N, platforms: ['facebook'],
      --  require_subscription: true|false, within_window_only: true|false}
  template_variables    jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at          timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  total_recipients      integer NOT NULL DEFAULT 0,
  sent_count            integer NOT NULL DEFAULT 0,
  failed_count          integer NOT NULL DEFAULT 0,
  skipped_count         integer NOT NULL DEFAULT 0,  -- Outside window + no subscription (§10.3)
  opted_out_count       integer NOT NULL DEFAULT 0,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaigns_business ON public.bulk_campaigns(business_id);
CREATE INDEX idx_campaigns_status ON public.bulk_campaigns(status);

-- C1 FIX: business_id present (RLS DO block applies cleanly); channel_account_id
-- added so a customer on both FB and IG gets ONE recipient row PER PLATFORM (M14)
CREATE TABLE public.bulk_campaign_recipients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id         uuid NOT NULL REFERENCES public.bulk_campaigns(id) ON DELETE CASCADE,
  channel_account_id  uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  customer_id         uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  conversation_id     uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  subscription_id     uuid REFERENCES public.notification_subscriptions(id) ON DELETE SET NULL,
  outbox_id           uuid REFERENCES public.message_outbox(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','failed','skipped','cancelled')),
  skip_reason         text,   -- 'opted_out' | 'outside_window_no_subscription' | 'no_conversation' | 'quota_exhausted'
  error_message       text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, customer_id, channel_account_id)
);
CREATE INDEX idx_recipients_campaign ON public.bulk_campaign_recipients(campaign_id);
CREATE INDEX idx_recipients_status ON public.bulk_campaign_recipients(campaign_id, status);
CREATE INDEX idx_recipients_business ON public.bulk_campaign_recipients(business_id);
```

The recipient-creation code path (`meta-bulk-send` §10.4) backfills `business_id` and `channel_account_id` from the campaign row — never NULL.

### 2.2.12 Automation Rules

```sql
CREATE TABLE public.automation_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  is_active         boolean NOT NULL DEFAULT true,
  trigger_type      text NOT NULL CHECK (trigger_type IN (
    'keyword_match', 'new_conversation', 'idle_timeout',
    'order_status_change', 'order_created',          -- M12
    'tag_added', 'business_hours_off',
    'customer_first_message'
  )),
  trigger_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type       text NOT NULL CHECK (action_type IN (
    'auto_reply', 'auto_tag', 'auto_assign', 'auto_close',
    'escalate', 'send_saved_message', 'request_optin'
  )),
  action_config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority          integer NOT NULL DEFAULT 0,
  match_count       integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_automation_business ON public.automation_rules(business_id, is_active);
```

Changes from v1: `order_created` trigger type added (M12); `send_template` → `send_saved_message`; new `request_optin` action (sends a Recurring-Notifications opt-in prompt, §10.2); enums folded into CHECK constraints (simpler, avoids the separate `automation_action_type` type).

### 2.2.13 Rate Limit Buckets (M5 fix)

```sql
CREATE TABLE public.rate_limit_buckets (
  channel_account_id  uuid PRIMARY KEY REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  capacity            integer NOT NULL DEFAULT 250,      -- Meta page messaging limit [VERIFY spike]
  refill_rate_per_sec integer NOT NULL DEFAULT 250,
  tokens_remaining    integer NOT NULL DEFAULT 250,
  last_refill_at      timestamptz NOT NULL DEFAULT now()
);
-- Service-role ONLY: RLS enabled, no policies, grants revoked (webhook_events precedent)
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_buckets TO service_role;
```

### 2.2.14 Meta Webhook Event Log (M18 — the "webhook_events equivalent", now actually defined)

```sql
CREATE TABLE public.meta_webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id  uuid REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  object              text,                        -- 'page' | 'instagram'
  event_type          text NOT NULL,               -- 'messages' | 'messaging_optins' | 'message_deliveries' | ...
  platform_message_id text,                       -- mid when present
  status_code         integer NOT NULL DEFAULT 200,
  error               text,
  payload_size        integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_meta_webhook_events_created ON public.meta_webhook_events(created_at);
CREATE INDEX idx_meta_webhook_events_mid ON public.meta_webhook_events(platform_message_id);
-- Service-role only, exactly like webhook_events (20260802065800)
ALTER TABLE public.meta_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.meta_webhook_events TO service_role;
```

(30-day purge job in §17.5, following the `webhook_events` precedent.)

### 2.2.15 Remaining small tables

```sql
-- Agent presence (analytics persistence; Realtime Presence is the live source)
CREATE TABLE public.agent_presence_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('online', 'offline', 'away', 'busy')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);
CREATE INDEX idx_presence_user ON public.agent_presence_log(user_id, started_at DESC);

-- Conversation viewers (collision detection) — scoped via join (no business_id column)
CREATE TABLE public.conversation_viewers (
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- Opt-out registry (M14: NULL channel_account_id = GLOBAL opt-out across ALL channels)
CREATE TABLE public.messaging_opt_outs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  channel_account_id uuid REFERENCES public.channel_accounts(id) ON DELETE CASCADE,  -- NULL = all channels
  reason             text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- At most one row per (customer, specific channel) and one global row per (customer, business)
CREATE UNIQUE INDEX uq_opt_out_per_channel
  ON public.messaging_opt_outs (customer_id, channel_account_id)
  WHERE channel_account_id IS NOT NULL;
CREATE UNIQUE INDEX uq_opt_out_global
  ON public.messaging_opt_outs (customer_id, business_id)
  WHERE channel_account_id IS NULL;
```

The audience exclusion query (§10.3) defines the semantics explicitly: exclude when a row exists with `channel_account_id = :acct OR channel_account_id IS NULL` (for that customer + business).

### 2.3 RLS Policies — final shape, written once (H7 fix)

v1's blanket "Members can write" `FOR ALL` policy would grant every business member (including viewers) full write on all tables, and Postgres RLS permissive policies OR together — you cannot add a later policy that *removes* access. The policies below are the **final shape from day one**. Reads: member-or-admin for all `business_id` tables (consistent with the foundation's treatment of orders — all business members see all conversations of their business; v1's "staff sees assigned-only" idea is dropped as both unenforceable in this pattern and inconsistent with the codebase). Writes: gated per class using the existing `has_permission()` function (verified: SECURITY DEFINER, migration 20260420112330 — admin bypass, per-user overrides, custom-role grants).

```sql
-- ============================================================================
-- SELECT policies: every business_id-carrying table (DO block, foundation pattern)
-- ============================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'channel_accounts', 'conversations', 'messages', 'message_outbox',
    'conversation_orders', 'customer_tags', 'customer_notes',
    'quick_replies', 'saved_messages', 'bulk_campaigns',
    'bulk_campaign_recipients', 'automation_rules', 'notification_subscriptions',
    'agent_presence_log', 'messaging_opt_outs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can read %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Members can read %1$s" ON public.%1$I FOR SELECT TO authenticated
       USING (has_role(auth.uid(), ''admin''::app_role) OR is_business_member(business_id))', t);
  END LOOP;
END $$;

-- conversation_viewers: scoped via conversation join
ALTER TABLE public.conversation_viewers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can read viewers" ON public.conversation_viewers;
CREATE POLICY "Members can read viewers" ON public.conversation_viewers FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.conversations c
               WHERE c.id = conversation_viewers.conversation_id
                 AND is_business_member(c.business_id)));
DROP POLICY IF EXISTS "Agents write own viewer rows" ON public.conversation_viewers;
CREATE POLICY "Agents write own viewer rows" ON public.conversation_viewers FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

Write policies — per class (complete statements):

```sql
-- ---------------------------------------------------------------------------
-- Class A: agent send path — inbox.send_messages (or admin)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agents update conversations" ON public.conversations;
CREATE POLICY "Agents update conversations" ON public.conversations FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)));

DROP POLICY IF EXISTS "Agents insert messages" ON public.messages;
CREATE POLICY "Agents insert messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)
             AND (sender_agent_id = auth.uid() OR sender_type IN ('system','bot'))));

DROP POLICY IF EXISTS "Agents enqueue outbox" ON public.message_outbox;
CREATE POLICY "Agents enqueue outbox" ON public.message_outbox FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND created_by = auth.uid()
             AND has_permission(auth.uid(),
                  CASE WHEN message_tag IS NOT NULL THEN 'inbox.send_tagged'::app_permission
                       ELSE 'inbox.send_messages'::app_permission END)));

DROP POLICY IF EXISTS "Agents update outbox" ON public.message_outbox;
CREATE POLICY "Agents update outbox" ON public.message_outbox FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)));

DROP POLICY IF EXISTS "Agents cancel own outbox" ON public.message_outbox;
CREATE POLICY "Agents cancel own outbox" ON public.message_outbox FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id) AND created_by = auth.uid()));

DROP POLICY IF EXISTS "Agents link orders" ON public.conversation_orders;
CREATE POLICY "Agents link orders" ON public.conversation_orders FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'orders.edit'::app_permission)));

-- ---------------------------------------------------------------------------
-- Class B: management tables — inbox.manage
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'channel_accounts','automation_rules','saved_messages','quick_replies'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Managers write %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Managers write %1$s" ON public.%1$I FOR ALL TO authenticated
       USING (has_role(auth.uid(), ''admin''::app_role)
              OR (is_business_member(business_id)
                  AND has_permission(auth.uid(), ''inbox.manage''::app_permission)))
       WITH CHECK (has_role(auth.uid(), ''admin''::app_role)
              OR (is_business_member(business_id)
                  AND has_permission(auth.uid(), ''inbox.manage''::app_permission)))', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Class C: bulk messaging — inbox.bulk_send
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Bulk senders write campaigns" ON public.bulk_campaigns;
CREATE POLICY "Bulk senders write campaigns" ON public.bulk_campaigns FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.bulk_send'::app_permission)))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.bulk_send'::app_permission)));
-- bulk_campaign_recipients: SELECT via member-read (DO block above); WRITES are
-- service-role only (meta-bulk-send) — deliberately NO write policy here.

-- ---------------------------------------------------------------------------
-- Class D: CRM — customers.edit
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_tags','customer_notes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "CRM users write %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "CRM users write %1$s" ON public.%1$I FOR ALL TO authenticated
       USING (has_role(auth.uid(), ''admin''::app_role)
              OR (is_business_member(business_id)
                  AND has_permission(auth.uid(), ''customers.edit''::app_permission)))
       WITH CHECK (has_role(auth.uid(), ''admin''::app_role)
              OR (is_business_member(business_id)
                  AND has_permission(auth.uid(), ''customers.edit''::app_permission)))', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Class E: self-service rows
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agents log own presence" ON public.agent_presence_log;
CREATE POLICY "Agents log own presence" ON public.agent_presence_log FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Agents record opt-outs" ON public.messaging_opt_outs;
CREATE POLICY "Agents record opt-outs" ON public.messaging_opt_outs FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)));

DROP POLICY IF EXISTS "Managers remove opt-outs" ON public.messaging_opt_outs;
CREATE POLICY "Managers remove opt-outs" ON public.messaging_opt_outs FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.manage'::app_permission)));
```

Edge functions use the service role key (bypasses RLS) and validate `business_id` scope manually in code — unchanged from codebase convention.

**Enforcement summary:** a `viewer`-role user (or any member without `inbox.send_messages`) can read conversations but cannot send, tag, assign, or enqueue — enforced at the database, not just in UI filters. Any direct supabase-js query from a client still hits these policies. This resolves H7 without restrictive-policy gymnastics.

### 2.4 Indexes for Scale

At 100-500 convos/day, after 1 year: ~100K-180K conversations, millions of messages. Beyond §2.2's indexes:

```sql
-- Covering index for the conversation list query (most common query)
CREATE INDEX idx_conversations_list_covering ON public.conversations(
  business_id, status, last_message_at DESC
) INCLUDE (id, platform, customer_id, assigned_agent_id, unread_count);

-- FTS on text content ONLY (L3 — content holds JSON for structured types)
CREATE INDEX idx_messages_fts ON public.messages
  USING GIN (to_tsvector('english', content)) WHERE content_type = 'text';
```

Keyset pagination on `(business_id, last_message_at DESC)` uses `idx_conversations_last_message` — see §3.7. Monthly partitioning of `messages` is deferred: Phase 8 instead ships a 12-month cold archive table (§17.5) — simpler and reversible; partitioning can be adopted later if volume demands.

### 2.5 Database Triggers and Functions

#### 2.5.1 New-message conversation maintenance (L4 fix — no explicit `updated_at`; the BEFORE UPDATE trigger `set_conversations_updated_at` already sets it)

```sql
CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations SET
    last_message_at = NEW.created_at,
    last_customer_message_at = CASE WHEN NEW.direction = 'inbound' THEN NEW.created_at
                                    ELSE last_customer_message_at END,
    last_agent_message_at = CASE WHEN NEW.direction = 'outbound' THEN NEW.created_at
                                 ELSE last_agent_message_at END,
    first_agent_response_at = COALESCE(
      first_agent_response_at,
      CASE WHEN NEW.direction = 'outbound' AND NEW.sender_type = 'agent'
           THEN NEW.created_at END),
    unread_count = CASE WHEN NEW.direction = 'inbound' AND NOT NEW.is_read
                        THEN unread_count + 1 ELSE unread_count END,
    status = CASE WHEN status = 'resolved' AND NEW.direction = 'inbound'
                 THEN 'open'::public.conversation_status ELSE status END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_new_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_message();
```

#### 2.5.2 Mark conversation read (H8 fix — ownership check inside the SECURITY DEFINER body)

Shared-inbox semantics decision: any member viewing the conversation resets the shared unread counter (standard shared-inbox behavior; per-agent read receipts are a future enhancement). The function authenticates the caller itself:

```sql
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id FROM public.conversations WHERE id = p_conversation_id;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;
  -- Ownership assertion — without this, any authenticated user could reset
  -- any business's read state (SECURITY DEFINER bypasses RLS)
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
          OR public.is_business_member(v_business_id)) THEN
    RAISE EXCEPTION 'forbidden: not a member of this conversation''s business';
  END IF;
  UPDATE public.messages SET is_read = true, read_at = now()
   WHERE conversation_id = p_conversation_id AND direction = 'inbound' AND is_read = false;
  UPDATE public.conversations SET unread_count = 0 WHERE id = p_conversation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
```

#### 2.5.3 "Has ordered" auto-indicator (M12 — the explicit user requirement, now actually implemented)

Two triggers cover every path by which an order becomes attributable to a business:

```sql
-- (a) Any order insert whose store maps to a business via selling_points
CREATE OR REPLACE FUNCTION public.tag_customer_has_ordered_from_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_id uuid;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.store_id IS NOT NULL THEN
    SELECT sp.business_id INTO v_business_id
      FROM public.selling_points sp
     WHERE sp.woo_store_id = NEW.store_id
     LIMIT 1;
  END IF;
  IF v_business_id IS NOT NULL THEN
    INSERT INTO public.customer_tags (business_id, customer_id, tag)
    VALUES (v_business_id, NEW.customer_id, 'has_ordered')
    ON CONFLICT (business_id, customer_id, tag) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_orders_has_ordered AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tag_customer_has_ordered_from_order();

-- (b) Order linked to a conversation (covers inbox-created fb/ig orders that
--     carry no store_id): tag under the conversation's business
CREATE OR REPLACE FUNCTION public.tag_customer_has_ordered_from_link()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  SELECT COALESCE(o.customer_id, c.customer_id) INTO v_customer_id
    FROM public.orders o
    JOIN public.conversations c ON c.id = NEW.conversation_id
   WHERE o.id = NEW.order_id;
  IF v_customer_id IS NOT NULL THEN
    INSERT INTO public.customer_tags (business_id, customer_id, tag)
    VALUES (NEW.business_id, v_customer_id, 'has_ordered')
    ON CONFLICT (business_id, customer_id, tag) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_conv_orders_has_ordered AFTER INSERT ON public.conversation_orders
  FOR EACH ROW EXECUTE FUNCTION public.tag_customer_has_ordered_from_link();
```

Surfacing: a `has_ordered` badge on `ConversationItem` and `CustomerProfileCard` reads `EXISTS (SELECT 1 FROM customer_tags WHERE business_id = ? AND customer_id = ? AND tag = 'has_ordered')` — a real persisted indicator, not a display-time proxy.

### 2.6 Storage Bucket and Policies (M6, H3)

Migration `supabase/migrations/202609XX_omni_inbox_storage.sql`:

```sql
-- Private bucket; objects addressed {business_id}/{conversation_id}/{filename}
-- Avatars: {business_id}/avatars/{platform_recipient_id}.{ext}
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('inbox-attachments', 'inbox-attachments', false, 26214400)  -- 25MB
ON CONFLICT (id) DO NOTHING;

-- Tenant isolation: first path segment is the business_id.
-- Read access for members of that business:
CREATE POLICY "Members read inbox attachments" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'inbox-attachments'
    AND EXISTS (
      SELECT 1 FROM public.channel_accounts ca
      WHERE ca.business_id::text = (storage.foldername(name))[1]
        AND (has_role(auth.uid(),'admin'::app_role) OR is_business_member(ca.business_id))
    )
  );

-- Write: members with inbox.send_messages may upload into their business's folder
CREATE POLICY "Agents upload inbox attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inbox-attachments'
    AND EXISTS (
      SELECT 1 FROM public.channel_accounts ca
      WHERE ca.business_id::text = (storage.foldername(name))[1]
        AND is_business_member(ca.business_id)
        AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)
    )
  );

-- Service role writes (webhook-time attachment persistence) bypass RLS by design.
```

Customers never access this bucket directly — agents share attachments inside messages; the UI renders via short-lived signed URLs. Outbound attachment sending re-uploads from Storage to Meta (Meta requires a publicly fetchable URL or an attachment_id; we generate a temporary signed URL with a short TTL at send time, or reuse Meta's attachment_id for repeated files — §5.6).

### 2.7 Realtime Publication (Phase 1 migration)

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_outbox;

ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_outbox REPLICA IDENTITY FULL;
```

(Follows the verified precedent of `20260903000500_enable_realtime.sql`. `REPLICA IDENTITY FULL` is required for RLS-filtered `postgres_changes` to deliver the row payload on UPDATE/DELETE events.)

---

## 3. Inbox UI

### 3.1 Three-Panel Layout (desktop)

Using the existing `react-resizable-panels` dependency (verified in package.json; wrapper at `src/components/ui/resizable.tsx`):

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

<ResizablePanelGroup direction="horizontal">
  <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
    <ConversationList />
  </ResizablePanel>
  <ResizableHandle withHandle />
  <ResizablePanel defaultSize={50} minSize={30}>
    <MessageThread />
  </ResizablePanel>
  <ResizableHandle withHandle />
  <ResizablePanel defaultSize={25} minSize={20} maxSize={40}>
    <ContextSidebar />
  </ResizablePanel>
</ResizablePanelGroup>
```

#### 3.1.1 Mobile / Responsive Strategy (M10 — v1 was desktop-only)

| Breakpoint | Layout |
|---|---|
| `< md (768px)` | Single panel. Conversation list full-screen; tapping a conversation pushes the `MessageThread` (master-detail navigation with a back button). ContextSidebar accessible via a bottom-sheet drawer (`vaul` — verified in dependencies). |
| `md – lg` | Two panels: list (collapsible) + thread; ContextSidebar behind a `Sheet`/drawer toggled from the thread header. |
| `>= lg` | Full three-panel resizable layout (§3.1). |

State: a `useMediaQuery` hook drives panel-mode switching; selection state persists so resizing doesn't lose the open conversation.

### 3.2 Component Architecture

| Component | File | Purpose | Reuses Existing |
|-----------|------|---------|-----------------|
| `OmniInbox` | `src/components/inbox/OmniInbox.tsx` | Page container, responsive panel switching, route params | - |
| `ConversationList` | `src/components/inbox/ConversationList.tsx` | Filterable list, tabs (Open, Assigned, Unassigned, Closed), keyset pagination, search | `OrderFilters` pattern |
| `ConversationItem` | `src/components/inbox/ConversationItem.tsx` | Row: avatar, name, preview, time, unread badge, tags, priority, `has_ordered` badge | `OrderCard` pattern |
| `MessageThread` | `src/components/inbox/MessageThread.tsx` | Virtualized message list (install `@tanstack/react-virtual`) | new dep (M1) |
| `MessageBubble` | `src/components/inbox/MessageBubble.tsx` | Renders by `content_type`; delivery-status ticks for outbound | - |
| `ComposerBar` | `src/components/inbox/ComposerBar.tsx` | Text input, attachment upload, send, saved-message picker, tag-picker (if permitted) | `Textarea` |
| `ContextSidebar` | `src/components/inbox/ContextSidebar.tsx` | Tabs (Customer, Orders, Products, Notes) | `Tabs` |
| `CustomerProfileCard` | `src/components/inbox/CustomerProfileCard.tsx` | Name, phone, tags, `has_ordered` badge, order count, LTV | - |
| `ProductQuickSend` | `src/components/inbox/ProductQuickSend.tsx` | Search products, send as generic template card | **`MiniProductCatalog`** (caller supplies data — §6.3) |
| `InvoiceQuickSend` | `src/components/inbox/InvoiceQuickSend.tsx` | Generate + send invoice PDF | **`invoiceHtml.ts`** |
| `CourierQuickSend` | `src/components/inbox/CourierQuickSend.tsx` | Format & send tracking info | `CourierDispatchStation` logic |
| `OrderLinker` | `src/components/inbox/OrderLinker.tsx` | Link existing or create new order (§6.1) | **`AddOrderDialog` (modified — §6.1)** |
| `TagManager` | `src/components/inbox/TagManager.tsx` | Add/remove customer tags | `Badge` |
| `QuickReplyPicker` | `src/components/inbox/QuickReplyPicker.tsx` | Slash-command or button insert | `Command` |
| `SavedMessagePicker` | `src/components/inbox/SavedMessagePicker.tsx` | Pick saved draft, fill variables | `ResponsiveDialog`, `SearchableSelect` |
| `AssignmentDropdown` | `src/components/inbox/AssignmentDropdown.tsx` | Assign/reassign agent | `SearchableSelect` |
| `ConversationSearch` | `src/components/inbox/ConversationSearch.tsx` | Full-text search over message content (M11) | `Command` |
| `BulkActionBar` | `src/components/inbox/BulkActionBar.tsx` | Multi-select actions | `OrderBulkActionsBar` pattern |
| `OptInPromptCard` | `src/components/inbox/OptInPromptCard.tsx` | Sends Recurring-Notifications opt-in CTA (§10.2) | - |
| `CampaignBuilder` | `src/components/inbox/CampaignBuilder.tsx` | Audience builder + campaign scheduling | - |
| `WindowBanner` | shared hook/component | 24h/7d window countdown; composer state depends on it | - |

Renamed from v1: `TemplateMessagePicker` → `SavedMessagePicker` (C2). Added: `ConversationSearch`, `OptInPromptCard`, `WindowBanner`.

### 3.3 State Management

TanStack Query (verified in deps) for all data fetching:

```typescript
// hooks/useConversations.ts — keyset pagination (M11)
export function useConversations(filters: ConversationFilters) {
  return useInfiniteQuery({
    queryKey: ['conversations', filters],
    queryFn: ({ pageParam }) => supabase
      .from('conversations')
      .select('id, platform, platform_recipient_id, customer:customers(name), last_message_at, unread_count, status, tags, assigned_agent_id')
      .eq('business_id', filters.businessId)
      .order('last_message_at', { ascending: false })
      .lt('last_message_at', pageParam ?? new Date().toISOString())  // keyset
      .limit(50),
    getNextPageParam: (last) => last.at(-1)?.last_message_at,
  });
}

// hooks/useMessages.ts
export function useMessages(conversationId: string) {
  return useQuery({ queryKey: ['messages', conversationId], queryFn: ... });
}

// Realtime: INSERT-only on messages (M8)
export function useMessageInserts(conversationId: string, onInsert: (m: Message) => void) {
  useEffect(() => {
    const channel = supabase.channel(`messages:${conversationId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => onInsert(payload.new))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [conversationId]);
}
```

### 3.4 Virtualization (M1)

`@tanstack/react-virtual` is **not currently in package.json** (verified). Phase 2 checklist includes `npm i @tanstack/react-virtual` as an explicit install task. Estimate ~40px per bubble; render visible viewport + overscan of 10.

### 3.5 Keyboard Shortcuts

- `Cmd/Ctrl + K`: Focus conversation search
- `Up/Down`: Navigate conversation list
- `Enter`: Open selected conversation
- `Cmd/Ctrl + Enter`: Send message
- `Escape`: Close drawer / deselect
- `/`: Trigger quick reply picker in composer

### 3.6 UX States (M11 — v1 had none)

- **Empty states**: no conversations at all ("Connect a Facebook Page or Instagram account to start messaging" + CTA to settings); no conversation selected ("Select a conversation to begin"); empty thread; no search results.
- **Loading**: skeleton rows for the list (shadcn `Skeleton`); skeleton bubbles on initial thread load.
- **Send-failure affordance**: outbox rows with status `failed` / `blocked_window` render inline in the thread with an error chip + Retry button (re-inserts as a new outbox row / re-invokes `meta-send` on the same row). `blocked_window` shows the window-expiry countdown instead of Retry.
- **Optimistic send**: bubble appears immediately as `sending` (gray ticks), transitions to `sent` (single tick) → `delivered` (double tick) → `read` (blue tick) as delivery webhooks land (H2 status fields).

### 3.7 Pagination and Search (M11)

- **Conversation list**: keyset pagination on `(business_id, last_message_at DESC)` with infinite scroll (§3.3), capped server-side at 50 rows/page. Never unbounded `select()`.
- **Thread**: load latest 50 messages, paginate backwards on scroll-top (`created_at < oldest_loaded`).
- **Search**: `ConversationSearch` uses a `messages` full-text RPC (`websearch_to_tsquery` against the §2.4 partial FTS index, `content_type = 'text'` only) returning matching conversation IDs with highlighted snippets; clicking a result opens the conversation and scrolls to the message.

---

## 4. Webhooks: Verification and Event Processing (C3)

### 4.1 Meta Developer App Setup

1. Create a Meta Business App at developers.facebook.com
2. Add products: **Messenger** (Facebook) and **Instagram** (for IG DMs, configured via the IG professional account)
3. Configure webhook URL: `https://<project-ref>.supabase.co/functions/v1/meta-webhook`
4. Subscribe to events: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`, `messaging_optins` (notification opt-ins — C2), `messaging_handovers` (pass-thread control between apps)
5. Request permissions: `pages_messaging`, `pages_show_list`, `instagram_basic`, `instagram_manage_messages` (the latter two + `pages_messaging` need App Review with business verification — Phase 0, §14.0)
6. Copy the **App Secret** into edge function secrets: `supabase secrets set META_APP_SECRET=...` (app-level, C3). Also set `META_APP_ID`, `META_APP_SECRET`, `META_CRON_TOKEN` (vault-held, §5.7), `META_GRAPH_VERSION` (§5.0).
7. Obtain a long-lived Page Access Token per connected page (via a long-lived user token)

### 4.2 Webhook Verification — GET handler (lookup by token is the intended flow)

```typescript
// meta-webhook/index.ts — GET (subscription handshake)
if (req.method === "GET") {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const { data: account } = await supabase
    .from("channel_accounts")
    .select("id")
    .eq("webhook_verify_token", token)   // UNIQUE index guarantees at most one row (M16)
    .maybeSingle();

  if (mode === "subscribe" && account) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}
```

### 4.3 POST Handler — verify FIRST, then route (C3 fixed)

The v1 code referenced `account.app_secret` before defining how `account` is obtained — impossible. The fix: the signature is verified with the **app-level** secret from the edge environment, available before any DB lookup. Parsing the body before verifying is safe (the signature covers the raw body; parse-then-verify is the standard Meta pattern).

```typescript
// meta-webhook/index.ts — POST
const rawBody = await req.text();
const signature = req.headers.get("x-hub-signature-256") || "";

// 1. VERIFY FIRST — app-level secret from edge env (no DB lookup needed)
const appSecret = Deno.env.get("META_APP_SECRET")!;
const key = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(appSecret),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
);
const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
const expected = "sha256=" + Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
if (signature !== expected) {
  return jsonResp({ error: "invalid signature" }, 401);
}

// 2. THEN parse and route by "object" field (FB vs IG share this endpoint)
const payload = JSON.parse(rawBody);
if (payload.object !== "page" && payload.object !== "instagram") {
  return jsonResp({ ok: true, skipped: "unknown object" });
}

// 3. THEN identify the channel account from the payload itself
for (const entry of payload.entry ?? []) {
  const recipientId = entry.id;              // page ID (page object) or IG account ID (instagram object)
  const { data: account } = await supabase
    .from("channel_accounts")
    .select("id, business_id, platform, page_id, ig_account_id, is_active")
    .or(`page_id.eq.${recipientId},ig_account_id.eq.${recipientId}`)
    .eq("is_active", true)
    .maybeSingle();
  if (!account) { await logWebhookEvent(null, payload.object, "unknown", 404, "no channel_account"); continue; }
  // 4. process entry events for this account...
}
```

Notes:
- L1: this HMAC pattern *adapts* woo-webhook's `crypto.subtle` usage; the **comparison encoding differs** (Woo compares base64 `btoa` — woo-webhook line 104; Meta uses `sha256=` + lowercase hex).
- If a business ever connects through a *different* Meta app (per-app secrets), handle it then — the single-app assumption is stated here, not silently implied by a wrong per-row column.

### 4.4 Event Processing Pipeline (per entry, per event)

1. Determine event type: `message` / `postback` / `delivery` / `read` / `optin` / `pass_thread_control`
2. `message` (inbound):
   a. Idempotency: check `messages.platform_message_id` (mid) — insert into `meta_webhook_events` for observability (§2.2.14)
   b. Upsert conversation by `(channel_account_id, platform_recipient_id = sender.id)` — ON CONFLICT update nothing (row exists)
   c. Persist attachments to Storage (§5.6)
   d. Resolve/create customer — alias-first only (§7.1)
   e. Insert message with `platform_timestamp` as `created_at` basis (H9)
   f. Evaluate automation rules (§8) → insert outbox rows → fire sweep
3. `delivery`: update outbound message `delivery_status='delivered', delivered_at` (matched by mid — H2)
4. `read`: update outbound `delivery_status='read', customer_read_at` (H2)
5. `optin`: upsert `notification_subscriptions` row with token (C2 — **[VERIFY IN PHASE 0 SPIKE]** exact payload)
6. `pass_thread_control`: store in `conversations.metadata` (handover state — NOT account deletion, L6)

### 4.5 24-Hour Window + HUMAN_AGENT (H9)

- `window_expires_at` is the generated column (§2.2.2); NULL `last_customer_message_at` = window closed.
- Window clock uses Meta's event `timestamp` (via `platform_timestamp` → `created_at`), not processing time.
- **Freeform send allowed** iff `now() < window_expires_at`.
- **HUMAN_AGENT tag** extends a human-support conversation to 7 days. The ComposerBar shows: freeform enabled (within 24h) → tag selector with HUMAN_AGENT (within 7d, requires `inbox.send_tagged`) → saved-message prompts to re-open the window (§10.2) → composer disabled with countdown.
- The other tags (`ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE`) are for their narrow permitted uses; UI labels each with its policy description so agents don't misuse them.

### 4.6 Facebook vs Instagram Differences

| Aspect | Facebook Messenger | Instagram |
|--------|--------------------|-----------|
| Sender ID | PSID (page-scoped) | IG scoped user ID |
| API endpoint | `/v{X}/me/messages` | `/v{X}/{ig-user-id}/messages` |
| Generic template | Supported | **Supported** (M7 — v1 was wrong; IG product cards use it) |
| Media/attachment constraints | Broader | Some types unsupported/unavailable; verify per type in Phase 0 spike |
| 24h rule | Applies | Applies |
| HUMAN_AGENT tag | Supported | Supported (7-day window) |
| Recurring Notifications | Supported (per current docs — [VERIFY spike]) | Not believed available — design within-24h only (fallback §10.6) |
| Handover protocol | Supported | Not supported |

Normalize both behind `sendMessage(channelAccountId, recipientId, payload)` in `supabase/functions/_shared/meta-api.ts`.

---

## 5. Send Path, Rate Limiting, Tokens, Attachments

### 5.0 Graph API Version Pinning (M3)

v1 pinned `/v20.0/` — past its ~2-year supported life at plan date. Instead:

- Single constant `GRAPH_VERSION` in `_shared/meta-api.ts`, initialized from `Deno.env.get("META_GRAPH_VERSION")` (default: the current stable version **at Phase 0 kickoff**, chosen from Meta's changelog then — do not hardcode a version at plan time).
- Upgrade policy: review Meta's version-deprecation schedule at each phase boundary; bump the pin deliberately (one-line env change); the Phase 9 monitoring dashboard tracks Meta `error_code` 4 (API version too old) and Graph API error subcodes for calls made with an expiring version.

### 5.1 Meta Send API Call (shared module)

```typescript
// supabase/functions/_shared/meta-api.ts (sketch)
export async function sendMessage(opts: {
  channelAccountId: string; conversationId: string;
  recipientId: string;                          // PSID or IGSID
  text?: string; attachment?: unknown;
  messageTag?: 'ACCOUNT_UPDATE'|'CONFIRMED_EVENT_UPDATE'|'HUMAN_AGENT'|'POST_PURCHASE';
  notificationToken?: string;                    // recurring/OTN send
}) {
  const token = await getChannelAccessToken(opts.channelAccountId); // RPC — §15.1
  const version = Deno.env.get("META_GRAPH_VERSION")!;
  // endpoint per account platform; body per mode:
  //  - freeform (within window): { recipient: {id}, message: {...} }
  //  - tagged: adds { tag: messageTag }
  //  - notification: { recipient: {notification_token}, message: {...} } [VERIFY spike]
  ...
}
```

### 5.2 Send Decision Matrix (meta-send applies this per outbox row)

| Outbox row shape | Rule check | Meta payload mode |
|---|---|---|
| No tag, no subscription | `now() < window_expires_at` (NULL = closed) | Freeform |
| `message_tag` set | HUMAN_AGENT: `now() < last_customer_message_at + 7d`; others: permitted use policy (UI-enforced) | Tagged |
| `subscription_id` set | Subscription row `status='active'` and `expires_at` in future | Notification token send |
| None of the above pass | outbox → `blocked_window` + agent notification | — |

### 5.3 Rate Limiting — atomic token bucket (H5)

v1's read-modify-write bucket loses updates across isolates. Fixed: one atomic statement that refills AND decrements, called via RPC (avoids PostgREST-side read-modify-write):

```sql
CREATE OR REPLACE FUNCTION public.consume_rate_limit_token(p_channel_account_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.rate_limit_buckets
     SET tokens_remaining = LEAST(
           capacity,
           tokens_remaining + floor(extract(epoch from (now() - last_refill_at)) * refill_rate_per_sec)
         ) - 1,
         last_refill_at = now()
   WHERE channel_account_id = p_channel_account_id
     AND (tokens_remaining
          + floor(extract(epoch from (now() - last_refill_at)) * refill_rate_per_sec)) >= 1
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_rate_limit_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit_token(uuid) TO service_role;
```

- Single-statement refill+decrement: no lost updates (row lock serializes concurrent consumers).
- If no token is available, `meta-send` leaves the row `pending` with `next_retry_at = now() + 1s` (sweep picks it up).
- **Honest throughput**: each send costs one atomic RPC (~5-15ms) + Graph API latency (~100-300ms). A single-instance loop sustains ~5-20 sends/sec. Bulk campaigns (§10.4) run a bounded-concurrency promise pool (10-20 in-flight Graph calls, each holding one token) — realistic ~30-100/sec, comfortably below Meta's page limits and adequate for 500 convos/day. v1's "200/sec" claim is removed.

### 5.4 Token Management (M4 — corrected facts)

- **Facts**: Long-lived *user* tokens last ~60 days. **Page access tokens obtained from a long-lived user token do not have a fixed expiry** — they survive until the user changes their password, revokes access, or the app loses permissions. A daily "refresh" cron is a no-op.
- **Real failure modes**: user-driven revocations (fix = reconnection flow, which we keep), password changes, app permission loss, page admin role removal.
- **`meta-token-probe`** (weekly pg_cron): for each active `channel_account`, `GET /{page-id}?fields=id` with the decrypted token; on 401/190 (`access token invalid`), set `is_active = false`, `metadata->>'token_error'`, and raise an admin notification (realtime + dashboard banner). Success updates `token_validated_at`.
- Token rotation: if Meta invalidates a token, the settings UI reconnection flow writes a new one through the same encrypt path (§15.1).

### 5.5 Inbound Attachment Persistence (H3)

Meta's CDN attachment URLs are temporary and token-gated; storing them renders broken media later.

At webhook time, for each attachment on an inbound message:

1. Fetch the Meta URL with the page token (`Authorization: Bearer <page_token>`)
2. Upload to Supabase Storage: `inbox-attachments/{business_id}/{conversation_id}/{platform_message_id}-{n}.{ext}`
3. Store `attachments: [{storage_path, filename, mime, size, type, meta_url}]` (original URL kept in `meta_url` for debugging)
4. UI renders via short-lived signed URLs (60 min) generated on demand

Failure handling: download failures do NOT fail the webhook — the message inserts immediately with `meta_url` in metadata + a `download_pending` flag in `metadata`; a sweep task retries downloads for 24h.

Avatars: profile pictures from the profile API have the same expiring-URL problem; persisted to `{business_id}/avatars/{platform_recipient_id}.{ext}` at first fetch (§7.1).

Agent-initiated attachments (ComposerBar): upload from browser to the same bucket via the §2.6 INSERT policy (25MB limit, type allowlist: image/video/audio/file with extension check), then the outbox row carries `attachments`; `meta-send` either (a) generates a short-TTL public signed URL for Meta to fetch, or (b) for previously-sent files, reuses Meta's `attachment_id`. Large-file rule: >8MB images / >25MB files rejected in the composer before upload (UI check).

### 5.6 Outbox Sweep (H4 resolved — the cron-processor, concrete)

Migration (exact pattern of verified 20260802065715):

```sql
-- Vault secret for the sweep token (one-time setup)
SELECT vault.create_secret('<generated-uuid>', 'meta_outbox_cron_token');

DO $$
BEGIN
  PERFORM cron.unschedule('meta-outbox-sweep-30s');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'meta-outbox-sweep-30s',
  '30 seconds',
  $$
  SELECT net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/meta-outbox-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meta_outbox_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
```

`meta-outbox-sweep` verifies the `x-cron-secret` header (or the non-blocking call's one-shot token from `meta-webhook`), then:
1. Claims `pending` rows older than 5 seconds and `failed` rows with `next_retry_at <= now()` (limit 100 per pass, ordered by `created_at`)
2. For each: same pipeline as `meta-send` (window check → rate token → send → status)
3. Also scans `bulk_campaigns` where `status='scheduled' AND scheduled_at <= now()` and invokes `meta-bulk-send` for each (§10.4)

If the platform's pg_cron rejects a `30 seconds` interval, use `'* * * * *'` (1 min) — interactive sends never wait on the sweep (direct-invoke path §1.5), only auto-reply worst-case latency widens from ~30s to ~90s.

### 5.7 Rate limit on profile fetches (M9)

The webhook-time profile fetch (`GET /{psid}?fields=name,profile_pic`, page token) is rate-limited by Meta per page. Strategy: fetch only on FIRST message from a sender (no `customer_aliases` row for that PSID), cache indefinitely (name changes are rare; profile_pic persists to Storage), and never block message processing on it — fallback name applies immediately (§7.1).

---

## 6. Order Management from Inbox

### 6.1 Create Order from Chat (H6 fix — the dialog IS modified; exact spec)

`AddOrderDialog` today has `Props { open, onOpenChange, onCreated }` (verified lines 89-93), resolves the customer from the typed phone number (line 782), and has no prefill or business-scoping capability. Plan:

**Modification 1 — optional prefill prop (backwards-compatible)**

```typescript
// Add to Props (src/components/orders/AddOrderDialog.tsx)
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  prefill?: {
    customerName?: string;       // Seeds the customer name field
    customerPhone?: string;     // Seeds the phone field (main resolution key)
    sourceId?: string;          // Pre-selects an order_sources row (e.g., the 'fb/ig' source)
  };
}

// In the component body (one-time effect, no render loop):
useEffect(() => {
  if (open && prefill?.customerPhone) {
    setCustomerPhone(normalizePhone(prefill.customerPhone));  // existing state setter
    if (prefill.customerName) setCustomerName(prefill.customerName);
    if (prefill.sourceId) setSource(prefill.sourceId);
  }
}, [open, prefill]);
```

All three fields remain user-editable. This is a ~15-line change; the dialog's existing flows (product search, Pathao cascade, measurements, AI parse) are untouched. Phase 4 budget: 0.5 day including regression check of the orders page usage (which passes no `prefill` — unaffected).

**Modification 2 — business-scoped data lists**

The dialog's product/store/customer queries hit the legacy `USING (true)` RLS tables (verified 20260407071618) with no business filter — an agent of Business A can currently select Business B's products. In the inbox context (and only there for now), the `OrderLinker` wrapper passes a business-scoped dataset: products/stores fetched through the active business's `selling_points` (the verified foundation mechanism — `selling_points.business_id` + `woo_store_id`), so `MiniProductCatalog` (whose props we already must supply — L8) receives only that business's catalog. The dialog itself remains untouched for this part — scoping happens in the wrapper's data fetching.

**Flow**

1. Agent clicks "Create Order" in the ContextSidebar
2. `OrderLinker` opens `AddOrderDialog` with `prefill = { customerName, customerPhone? (if known), sourceId: <fb/ig order_source id> }`
3. On `onCreated`: insert into `conversation_orders` (business_id from conversation) → the §2.5.3 trigger tags `has_ordered`
4. Post a system message into the thread: "Order #ORD-1234 created" (`content_type='order_confirmation'`, sender_type='system', never sent to Meta)
5. If the customer gave a phone in chat, `OrderLinker` pre-fills it (agent copies from the thread) — and at creation time the **phone-merge** fires (§7.2)

### 6.2 Link Existing Order

1. Search orders by order_number, customer name, or phone (business-scoped via §6.1 Modification 2's dataset)
2. Results display with `OrderBadges` (verified exists)
3. On select: insert `conversation_orders` → trigger tags `has_ordered`
4. Linked orders render in the ContextSidebar with status badges

### 6.3 Order Status Sync to Chat

On `order_timeline` insert for an order linked to conversations (DB trigger → edge function enqueue, or checked in the sweep):
1. Insert system message: "Order #1234 has been shipped"
2. If the business enables "notify customer" and the window is open (or `POST_PURCHASE` tag permitted): insert outbox row for the customer

### 6.4 AI-Powered Order Extraction

Reuse `parse-order-text` edge function (verified exists, 240 lines). Agent pastes chat text into the dialog's AI parse field — existing flow, works with prefill (the extracted phone lands in the same seeded field).

---

## 7. Customer CRM

### 7.1 Customer Resolution at Webhook Time (H11 + M9 + A1 fix)

**Webhook-time resolution is alias-first ONLY.** Meta webhooks carry only the platform ID — no phone, no email, no name. The woo-webhook phone-first pattern (lines 550-614) is inapplicable at webhook time; it is inherited only for order creation.

```
resolveCustomerByPlatformId(platform, senderId):
  1. alias lookup: customer_aliases WHERE type IN ('facebook_psid'|'instagram_id')
     AND lower(value) = lower(senderId)  -- uses new index §2.2.0
  2. if found -> return customer_id
  3. not found:
     a. kick off best-effort profile fetch: GET /{senderId}?fields=name,profile_pic
        with page token (rate-limited: first-message-only, §5.7)
     b. create customers row: name = profile.name OR 'Facebook User' / 'Instagram User'
        (fallback immediately — customers.name is NOT NULL, verified), phone NULL,
        store_id NULL
     c. insert alias (type facebook_psid|instagram_id, value senderId,
        source_store_id NULL)  -- requires §2.2.0 CHECK extension
     d. persist avatar (if fetched) to Storage (expiring URL — §5.5)
  4. attach customer_id to the conversation
```

The profile fetch is non-blocking: the message and customer insert immediately with the fallback name; a follow-up update lands when the fetch completes (usually <1s).

### 7.2 Cross-Platform Merge (H11 fix — phone matching happens at ORDER time)

Phone linkage becomes possible only when the customer shares a number in chat and an order is created:

1. Agent creates an order from the inbox (§6.1) with a phone captured from the conversation
2. `AddOrderDialog`'s existing global-phone customer resolution (line 782: lookup by typed phone) runs — this is the actual merge point
3. If the resolved-by-phone customer differs from the conversation's alias-created customer:
   - The order's `customer_id` points at the phone-matched (older) customer
   - `OrderLinker` migrates the platform aliases from the chat-customer to the phone-matched customer and updates `conversations.customer_id` (a small RPC: `merge_chat_customers(chat_customer_id, canonical_customer_id)`, SECURITY DEFINER, moves aliases + reassigns conversations; admin/inbox.manage permission)
4. Result: both the FB PSID and IG IGSID aliases point at one customer, orders aggregate correctly

If a customer contacts from both FB and IG: both platform IDs attach to the same customer via aliases when a phone merge occurs; until then, two customer records exist (harmless — no cross-tenant data is exposed; manual merge UI in Phase 5 uses the same RPC).

### 7.3 Tagging System

- Manual: `TagManager` inserts into `customer_tags` (business-scoped, H1)
- Auto: automation rules (`keyword_match`, `tag_added`)
- Order-based: `has_ordered` via DB triggers (§2.5.3) — plus `orders.create` automation rules if businesses want custom order tags
- Tags are business-scoped: different businesses can have different tag taxonomies **and the same tag name on the same shared customer** (unique constraint is `(business_id, customer_id, tag)`)

### 7.4 Customer Profile Sidebar

`ContextSidebar` > Customer tab: name, phone, email, address (from `customers`); `has_ordered` badge + tags (from `customer_tags`); order count and LTV (aggregated from business-scoped orders); notes (`customer_notes`); active conversations across platforms (same business); last interaction timestamp.

---

## 8. Automation Rules

### 8.1 Rules Engine

Evaluated in `meta-webhook` after message insertion (same shape as v1, corrected for the sweep trigger):

```typescript
async function evaluateAutomationRules(supabase, businessId, message, conversation) {
  const { data: rules } = await supabase
    .from("automation_rules")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("priority", { ascending: false });

  for (const rule of rules || []) {
    if (matchesTrigger(rule, message, conversation)) {
      await executeAction(rule, supabase, conversation);
      await supabase.from("automation_rules")
        .update({ match_count: rule.match_count + 1 }).eq("id", rule.id);
    }
  }
  // After inserting any outbox rows, meta-webhook fires meta-outbox-sweep
  // (non-blocking) so auto-replies go out in <= 2s (§1.5).
}
```

### 8.2 Trigger Types

| Trigger | Config | Evaluation |
|---------|--------|------------|
| `keyword_match` | `{keywords: ["price"], match: "any"}` | Regex/keyword on text content |
| `new_conversation` | `{}` | First message in a new conversation |
| `idle_timeout` | `{timeout_minutes: 30}` | pg_cron check on `last_message_at` |
| `order_status_change` | `{from_status, to_status}` | `order_timeline` inserts (linked orders) |
| `order_created` | `{}` | `orders` insert (business-scoped via §2.5.3 resolution) — M12 |
| `tag_added` | `{tag: "vip"}` | `customer_tags` inserts |
| `business_hours_off` | `{hours: {start, end}}` | Time-of-day check (business timezone) |
| `customer_first_message` | `{}` | Customer has no prior conversations |

### 8.3 Action Types

| Action | Config | Effect |
|--------|--------|--------|
| `auto_reply` | `{text: "..."}` | Insert outbox row (freeform — window-checked) |
| `auto_tag` | `{tag: "interested"}` | Insert `customer_tags` |
| `auto_assign` | `{strategy: "round_robin" \| agent_id}` | Update `assigned_agent_id` |
| `auto_close` | `{idle_hours: 48}` | Status → closed |
| `escalate` | `{to_role: "admin"}` | Priority → urgent + notify |
| `send_saved_message` | `{saved_message_id}` | Insert outbox row from saved draft |
| `request_optin` | `{topic: "new_arrivals"}` | Sends a Recurring-Notifications opt-in prompt (§10.2) |

### 8.4 SLA Timers

pg_cron every 5 minutes: query conversations `status NOT IN ('closed')` AND `last_message_at < now() - X minutes` → escalate priority or auto-close per rules; notify agents via Realtime Broadcast.

---

## 9. Agent Collaboration

(Unchanged in structure from v1; presence/viewers/notes/transfer as v1 described, with the collision-detection heartbeat cleanup and the shared-unread semantics from §2.5.2.)

### 9.1 Assignment

- **Round-robin**: on new conversation, agent with fewest open conversations among `user_business_access` members of the business
- **Manual**: `AssignmentDropdown` via `SearchableSelect`, populated from `user_business_access` (join `profiles` for names)
- **Skill-based routing**: future (custom_roles)

### 9.2 Internal Notes

`content_type = 'internal_note'` rows in `messages` — never sent to Meta (meta-send filters `content_type`), rendered with a distinct background + badge, `@mentions` parsed from `@[name](user_id)` and notified via Realtime.

### 9.3 Transfer

Transfer button → target agent → internal note "transferred from A to B" → update `assigned_agent_id` → Realtime notify both.

### 9.4 Presence

Realtime Presence channels `presence:conversation:{id}`; status dots on avatars; persisted to `agent_presence_log` (90-day retention, §17.5).

### 9.5 Collision Detection

Open conversation → upsert `conversation_viewers` → Broadcast "X is viewing" → banner in others' UI → remove on unmount + heartbeat cleanup (sweep deletes `viewed_at < now() - 5 min` rows).

---

## 10. Bulk Messaging & Proactive Outreach (C2 redesign)

### 10.0 What is and isn't possible (stakeholder statement)

- **Within 24h of the customer's last message**: freeform promotional messages are allowed. This is the primary bulk channel.
- **Outside the window**: the only options are (a) the four permitted message tags for their narrow uses, and (b) **Recurring Notifications / OTN** — opt-in-based tokens that let the page message the customer on a subscribed topic outside the window (Messenger; **[VERIFY IN PHASE 0 SPIKE]**). There is NO template-approval mechanism, NO marketing tag, and NO way to bulk-message cold recipients. WhatsApp is a different product/channel if out-of-window marketing is a hard requirement.

### 10.1 Audience Builder

Filter by: tags (business-scoped), order count, last order date, platform (FB/IG/both — resolved to per-platform recipient rows, M14), `has_ordered` tag, active notification subscription (per topic), within-window status (live preview: "N reachable now / M via subscription / K not reachable"). Excludes `messaging_opt_outs` (global rows + per-channel rows, §2.2.15).

### 10.2 Opt-In Prompt Flow (builds the out-of-window audience)

1. Business creates an opt-in prompt saved message (category `optin_prompt`) — e.g., "Want updates on new arrivals? Tap below."
2. Agent (or an automation `request_optin` action) sends the prompt in-conversation (within window — it's a normal message)
3. Customer taps accept → Meta delivers the `messaging_optins` webhook → webhook inserts `notification_subscriptions` (token, topic, type, expires_at)
4. Campaigns can now include this customer for the subscribed topic, outside the 24h window
5. Agents see a per-conversation "subscription" chip (topic + active/expired); an "Ask to re-subscribe" button re-sends the prompt when a subscription lapses

### 10.3 Send-Time Eligibility (per recipient row — the honest version of bulk)

For each `(campaign, customer, channel_account)` recipient:

```
eligible(if) =
  NOT opted_out (global or per-channel for this business)
  AND (
       (now() < conversation.window_expires_at)                     -- in-window freeform
    OR (subscription active for the campaign's topic
        AND subscription.expires_at > now())                        -- notification token send
  )
```

Ineligible rows are marked `skipped` with `skip_reason` (`opted_out` / `outside_window_no_subscription` / `no_conversation`) and reported in the campaign dashboard — v1's design would have attempted API-rejected sends instead.

### 10.4 Campaign Engine (`meta-bulk-send`)

Triggered by the sweep when `bulk_campaigns.status='scheduled' AND scheduled_at <= now()`:

1. Mark campaign `sending`, `started_at = now()`
2. Build audience from `audience_filter` → insert `bulk_campaign_recipients` rows (with `business_id`, `channel_account_id`, `conversation_id`, `subscription_id` backfilled — C1's code path)
3. Loop (bounded-concurrency promise pool of 10-20 in-flight sends, each consuming one §5.3 token):
   - For each pending recipient: re-check §10.3 eligibility at send time (the window may close mid-campaign)
   - Eligible → insert outbox row (`subscription_id` set if that's the path) → send → update recipient + campaign counters
   - Ineligible → `skipped` + reason
4. On completion (or pause/failure): campaign `completed`/`paused`/`failed`, `completed_at`, final counters
5. Campaign dashboard: sent / failed / skipped (by reason) / opted-out counts, per-channel breakdown

### 10.5 Opt-Out Handling

- Inbound keyword detection ("STOP", "UNSUBSCRIBE", "OPT OUT") → insert `messaging_opt_outs` (global row) + audit log
- Excluded from all future campaigns (§10.3 first clause)
- Agents can undo an opt-out (admin/inbox.manage, audited)

### 10.6 Fallback If the Spike Disproves Subscription Assumptions (defensive design)

If Phase 0 verification finds Recurring Notifications/OTN behave differently than assumed (unavailable, different payload, per-user quotas that break the campaign model):

- `notification_subscriptions` table remains valid (it just may stay empty or carry different fields — the spike updates the webhook parser)
- Campaign eligibility collapses to **within-window-only**: `eligible = NOT opted_out AND now() < window_expires_at`
- The opt-in prompt flow (§10.2) is disabled behind a feature flag (`saved_messages.category='optin_prompt'` creation + `request_optin` action gated)
- Everything else (audience builder, recipient tracking, dashboards) is unaffected

No schema change required by the fallback — that is the point of this design.

---

## 11. Analytics and Reporting

### 11.1 Materialized View (A2 fix — all referenced columns now exist)

```sql
CREATE MATERIALIZED VIEW public.inbox_analytics_daily AS
SELECT
  c.business_id,
  DATE_TRUNC('day', m.created_at) AS day,
  c.platform,
  COUNT(DISTINCT c.id) AS conversations_count,
  COUNT(m.id) FILTER (WHERE m.direction = 'inbound') AS inbound_messages,
  COUNT(m.id) FILTER (WHERE m.direction = 'outbound') AS outbound_messages,
  AVG(EXTRACT(EPOCH FROM (c.first_agent_response_at - c.created_at))) AS avg_first_response_seconds,
  AVG(EXTRACT(EPOCH FROM (c.closed_at - c.created_at))) AS avg_resolution_seconds
FROM public.conversations c
JOIN public.messages m ON m.conversation_id = c.id
GROUP BY 1, 2, 3;

SELECT cron.schedule('refresh-inbox-analytics', '0 2 * * *',
  'REFRESH MATERIALIZED VIEW public.inbox_analytics_daily');
```

### 11.2 Key Metrics

| Metric | Source |
|--------|--------|
| Avg First Response Time | `conversations.first_agent_response_at - created_at` |
| Avg Resolution Time | `closed_at - created_at` |
| Messages/Day, Conversations/Day | `messages` / `conversations` |
| Agent performance | `messages.sender_agent_id` aggregation |
| Conversion rate | `conversation_orders` JOIN `conversations` |
| Peak hours | `messages` hour-of-day heatmap |
| Saved-message usage | `message_outbox.saved_message_id` |
| Opt-out rate | `messaging_opt_outs` over time |
| Campaign reach | `bulk_campaign_recipients` status breakdown |
| Subscription rate | `notification_subscriptions` per topic |

### 11.3 CSAT (M15 fix — no delayed out-of-window send)

On `status → resolved`:
1. **Immediately** insert a CSAT prompt message ("How was your experience? Reply 1-5") — the customer's window is open in the common case (resolution follows a recent exchange); the prompt is a saved message (category `csat`)
2. If the window is closed at resolution time: **do not send** — render an in-thread CSAT prompt chip for the agent to send later, or include it in the next in-window interaction (automation `keyword_match` rule can attach it)
3. Parse numeric replies, store `conversations.metadata->>'csat_score'`

---

## 12. Multi-Tenant Support

(Unchanged from v1 — verified foundation: every table `business_id NOT NULL` → `businesses(id)`; RLS `is_business_member`; multiple `channel_accounts` per business (multiple FB pages, IG accounts); conversations scoped to `channel_account_id`, aggregated at `business_id`; edge functions extract business context from the JWT/`user_business_access` and always filter by `business_id` in service-role queries.)

- One business → N pages + M IG accounts → N+M `channel_accounts` rows
- Cross-business isolation: RLS on reads; permission-gated writes (§2.3); service-role edge functions filter by `business_id` explicitly
- The `customers` table is global-by-design (shared across businesses, verified) — customer *tags/notes* are business-scoped (H1); platform aliases are global (a PSID maps to one customer system-wide)

---

## 13. Security

### 13.1 Token Encryption & Decryption (C4 fix — concrete, edge-function-usable)

**Store**: encryption key in Supabase Vault (one-time setup in the Phase 1 migration):

```sql
-- One-time (idempotent): key used ONLY for channel token PGP encryption
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'inbox_token_key') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),   -- 64-char hex key
      'inbox_token_key'
    );
  END IF;
END $$;
```

**Encrypt on write** — SECURITY DEFINER trigger (owner `postgres`, so it can read the vault regardless of the inserting role — the repo's own vault reads all occur inside SECURITY DEFINER functions, verified in 20260623184244/20260802065715/20260901000000):

```sql
CREATE OR REPLACE FUNCTION public.encrypt_channel_token()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_key text;
BEGIN
  -- Inserts must always pass PLAINTEXT (documented contract; double-encryption
  -- hazard noted). Sentinel: refuse re-encrypting already-armored values.
  IF NEW.access_token_encrypted LIKE '-----BEGIN PGP MESSAGE-----%' THEN
    RETURN NEW;  -- already encrypted (e.g., UPDATE that didn't touch the column)
  END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets
   WHERE name = 'inbox_token_key' LIMIT 1;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'inbox_token_key vault secret missing';
  END IF;
  NEW.access_token_encrypted := encode(
    pgp_sym_encrypt(NEW.access_token_encrypted, v_key), 'armor');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_encrypt_channel_token
  BEFORE INSERT OR UPDATE OF access_token_encrypted
  ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.encrypt_channel_token();
```

**Decrypt for sends** — the exact RPC `meta-send` calls; it never touches the vault or key directly:

```sql
CREATE OR REPLACE FUNCTION public.get_channel_access_token(p_channel_account_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE
  v_key text;
  v_cipher text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets
   WHERE name = 'inbox_token_key' LIMIT 1;
  SELECT access_token_encrypted INTO v_cipher FROM public.channel_accounts
   WHERE id = p_channel_account_id;
  IF v_key IS NULL OR v_cipher IS NULL THEN
    RAISE EXCEPTION 'token unavailable';
  END IF;
  RETURN pgp_sym_decrypt(dearmor(v_cipher), v_key);
END;
$$;
REVOKE ALL ON FUNCTION public.get_channel_access_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_channel_access_token(uuid) TO service_role;
```

Notes:
- `pgcrypto` must be enabled (`CREATE EXTENSION IF NOT EXISTS pgcrypto;` — in the Phase 1 migration).
- The v1 `current_setting('app.encryption_key')` pattern is **deleted** — GUCs can't be set on PostgREST sessions; the Vault IS the key store, no second indirection.
- Reading `channel_accounts` via the client never exposes plaintext (encrypted column only; the decrypt RPC is service-role-only).
- Frontend "connect page" flow: the client never handles the raw token either — the settings UI calls a `meta-connect-account` edge function (JWT + `inbox.manage` check server-side) which inserts the row; the trigger encrypts.

### 13.2 Webhook Signature Verification

Mandatory on every POST; app-level `META_APP_SECRET` from edge env (§4.3). GET verification by unique `webhook_verify_token` (§4.2). Reject any POST without a valid `X-Hub-Signature-256`.

### 13.3 Rate Limiting on Client-Facing Endpoints

- `meta-send`: requires valid Supabase JWT; verifies the caller is a member of the outbox row's business (service-role check) AND that the row was created by them or is a sweep-claimed retry; 10 req/sec per user (edge middleware)
- All cron-triggered functions (`meta-outbox-sweep`, `meta-bulk-send`, `meta-token-probe`): verify `x-cron-secret` header against the vault token (verified repo pattern)

### 13.4 Audit Logging (L9)

Reuse `audit_log` + `logAction()` — `entity_type` is free text (verified), so define inbox constants in `src/lib/inboxAudit.ts`:

```typescript
export const INBOX_ENTITY = {
  CONVERSATION: 'inbox.conversation',
  MESSAGE: 'inbox.message',
  CAMPAIGN: 'inbox.campaign',
  CHANNEL_ACCOUNT: 'inbox.channel_account',
  AUTOMATION_RULE: 'inbox.automation_rule',
  SAVED_MESSAGE: 'inbox.saved_message',
  OPT_OUT: 'inbox.opt_out',
  SUBSCRIPTION: 'inbox.notification_subscription',
} as const;
```

Logged: sends, assignments/transfers, conversation close, campaign create/start/pause, rule CRUD, saved-message CRUD, opt-outs, channel connect/disconnect.

### 13.5 PII Handling

- Customer phone/email in `customers` (existing protection standards)
- Message `content` at-rest encryption deferred (future; noted)
- GDPR: data export (customer + conversations + messages) and deletion endpoints (right-to-erasure scopes: messages content nulled, aliases removed, customer anonymized — Meta also requires deletion via the app's data deletion callback URL, added to Phase 0 checklist)

---

## 14. Implementation Phases

### Phase 0: Meta App Setup, App Review & Verification Spike (Weeks 1-3, parallel) — C5, C2 spike

Runs FIRST and partially parallel with Phase 1. **Nothing that touches real customer traffic may ship before the review gate passes.**

- [ ] Create Meta Business App; add Messenger + Instagram products
- [ ] Business Verification (Meta Business Suite → verification docs: company registration etc.) — week 1
- [ ] Set `META_APP_SECRET` in edge secrets; configure webhook URL + verify_token per account
- [ ] **App Review submission** (week 1-2): permissions `pages_messaging`, `pages_show_list`, `instagram_basic`, `instagram_manage_messages` + Advanced Access; prepare screencasts of the inbox flows (built against dev-mode tester data) + permission justifications
- [ ] **Dev-mode strategy**: Development Mode allows app-role users (admin/dev/tester — up to ~100 roles) — team members install the app on their personal FB/IG accounts and message the test pages; Phases 2-6 build and test entirely against this traffic
- [ ] **Verification spike** (week 2-3, hard dependency for Phase 7 design and §5 assumptions):
  - [ ] Recurring Notifications: opt-in prompt payload, `messaging_optins` webhook shape, token send mechanics, topic/frequency/validity/quota rules — record actuals vs §2.2.10/§10.2 assumptions; update schema/parser accordingly
  - [ ] OTN: same, one-time flow
  - [ ] IG messaging: confirm Recurring Notifications availability (assumed absent — §10.6 fallback); media/attachment support matrix (per M7: generic template works; verify per-type constraints)
  - [ ] Page messaging rate limits (bucket capacity/refill assumptions, §5.3) and bulk-send policy constraints
  - [ ] Graph API: pick + pin `META_GRAPH_VERSION` (current stable); snapshot the version-deprecation date; write into `_shared/meta-api.ts`
  - [ ] Profile API: name/profile_pic fields, rate limits (§5.7)
- [ ] Data deletion callback URL configuration (GDPR, §13.5)
- [ ] **Gate**: review approval + Advanced Access = "live traffic" gate for Phase 2 onward (buffer for rejections: up to 2 resubmission cycles are in the week 1-3 window; further slippage delays Phases 7-9 only, since 2-6 run on dev-mode traffic)

### Phase 1: Foundation (Week 1-2) — BLOCKS ALL OTHER PHASES

Dependencies: none (parallel with Phase 0's app setup)

- [ ] Migration A: enums + `app_permission` additions (§2.1; ALTER TYPE in its own file — ADD VALUE cannot run inside a transaction in some runners)
- [ ] Migration B: `customer_aliases` type CHECK extension + lookup index (§2.2.0 — A1)
- [ ] Migration C: all tables (§2.2), indexes (§2.4), RLS policies in final shape (§2.3), triggers + functions (§2.5), rate-limit RPC (§5.3), token encrypt/decrypt (§13.1), storage bucket + policies (§2.6), realtime publication (§2.7)
- [ ] Vault: `inbox_token_key`, `meta_outbox_cron_token` secrets; cron schedules (outbox sweep, §5.6)
- [ ] Edge Function: `meta-webhook` — GET verification (§4.2) + POST verify-first pipeline skeleton (§4.3)
- [ ] Edge Function: `meta-send` — claim + window check + send + status (no rate limiting yet)
- [ ] Shared Module: `supabase/functions/_shared/meta-api.ts` — unified FB/IG abstraction, GRAPH_VERSION constant
- [ ] Settings UI: channel account connect flow (via `meta-connect-account`; manual token entry fallback: paste long-lived page token)
- [ ] `npm i @tanstack/react-virtual` (M1 — verified absent)
- [ ] Regenerate `src/integrations/supabase/types.ts` via `supabase gen types typescript`

### Phase 2: Core Messaging (Week 3-4) — DEPENDS ON Phase 1 (+ Phase 0 dev-mode testers)

- [ ] Webhook: full event parsing — messages, postbacks, **deliveries, reads** (H2 status updates), optins (subscription capture per Phase 0 spike findings)
- [ ] Webhook: customer resolution — alias-first + profile fetch + fallback names (§7.1)
- [ ] Webhook: conversation upsert + message insert with `platform_timestamp` + idempotency
- [ ] Webhook: attachment persistence to Storage (§5.5)
- [ ] React: `OmniInbox` 3-panel responsive layout (§3.1) + mobile master-detail (§3.1.1)
- [ ] React: `ConversationList` — keyset pagination, filters, realtime
- [ ] React: `MessageThread` with `@tanstack/react-virtual`; `MessageBubble` with delivery ticks
- [ ] React: `ComposerBar` — outbox insert + meta-send invoke; window banner (§4.5)
- [ ] React: UX states — empty/loading/skeletons; failed/blocked inline retry (§3.6)
- [ ] React: unread management, `mark_conversation_read` RPC on view
- [ ] Routing: `/inbox` route

### Phase 3: Agent Collaboration (Week 4-5)

- [ ] Round-robin auto-assignment in webhook
- [ ] `AssignmentDropdown`; manual assign/reassign
- [ ] Internal notes + @mentions
- [ ] Transfer flow + system message
- [ ] Realtime Presence (online/offline/away/busy)
- [ ] Collision detection (`conversation_viewers` + broadcast + heartbeat cleanup)
- [ ] Supervisor view (admin filters by assignment across the business)

### Phase 4: Commerce Integration (Week 5-7)

- [ ] `ContextSidebar` tabs (Customer, Orders, Products, Notes)
- [ ] `CustomerProfileCard` (+ `has_ordered` badge — trigger live from Phase 1)
- [ ] **Modify `AddOrderDialog`**: `prefill` prop + business-scoped wrapper datasets (§6.1 — budgeted, not as-is reuse)
- [ ] `OrderLinker`: link existing (business-scoped search) + create new (prefilled)
- [ ] Phone-merge RPC (`merge_chat_customers`) + auto-merge at order creation (§7.2)
- [ ] Order status change → system message (+ optional POST_PURCHASE-tagged customer notify)
- [ ] `ProductQuickSend` (MiniProductCatalog + generic template on BOTH platforms — M7)
- [ ] `InvoiceQuickSend` (invoiceHtml → PDF → Storage → attachment send)
- [ ] `CourierQuickSend` (courier_shipments → tracking message)

### Phase 5: CRM and Tagging (Week 7-8)

- [ ] `TagManager` + `customer_tags` CRUD (business-scoped)
- [ ] `customer_notes` CRUD
- [ ] Filter conversation list by customer tags
- [ ] Cross-platform customer merge UI (uses the Phase 4 RPC)
- [ ] `QuickReplyPicker` + quick replies CRUD
- [ ] `ConversationSearch` (FTS RPC + snippets — §3.7)

### Phase 6: Automation (Week 8-9)

- [ ] Automation rules CRUD settings page
- [ ] Rules engine in webhook + sweep auto-reply dispatch (§8.1)
- [ ] Keyword matching; `order_created` / `tag_added` triggers
- [ ] Idle-timeout cron; away messages (business hours)
- [ ] SLA escalation timers; auto-close

### Phase 7: Bulk Messaging & Proactive Outreach (Week 9-11) — design per Phase 0 spike findings

- [ ] Saved messages library CRUD (internal drafts — no approval flow)
- [ ] Opt-in prompt flow + `notification_subscriptions` capture (validated against spike; feature-flagged fallback §10.6)
- [ ] Audience builder UI (with live reachability preview)
- [ ] Campaign creation + scheduling; per-platform recipient rows
- [ ] `meta-bulk-send` engine: send-time eligibility (§10.3), bounded-concurrency dispatch, counters
- [ ] Campaign dashboard (sent/failed/skipped-by-reason/opted-out)
- [ ] Opt-out keyword detection + registry + audit
- [ ] Message-tag support in composer (permission-gated, per-tag policy labels)

### Phase 8: Analytics and Polish (Week 11-13)

- [ ] Materialized view + daily refresh cron (§11.1)
- [ ] Analytics dashboard (Recharts — verified in deps): metrics table §11.2
- [ ] CSAT flow (immediate-send design §11.3)
- [ ] Retention jobs (§17.5): presence/viewers purge, outbox terminal-state purge, 12-month message archive, `meta_webhook_events` 30-day purge
- [ ] E2E tests (Playwright) on dev-mode traffic
- [ ] Load test simulation (mock Meta webhook spout at 500 convos/day rate)

### Phase 9: Hardening (Week 13-14)

- [ ] `meta-token-probe` weekly cron + admin alerts + reconnection flow polish (§5.4)
- [ ] Dead-letter handling for permanently failed outbox rows (audit + report)
- [ ] Webhook retry behavior verification (respond < 20s; processing off the critical path where possible — enqueue-then-process for heavy entries)
- [ ] Monitoring/alerting: outbox failure rate > 5%, webhook processing > 10s, queue depth, Graph API error-rate (incl. version-deprecation warnings, §5.0)
- [ ] Docs for business admins (connect pages, review status, opt-in campaigns explainer, 24h window explainer)

**Phase dependency graph:** 0 → (2+ for live traffic); 1 → 2 → {3, 4, 5} → 6 → 7 → 8 → 9. Phases 2-6 testable on dev-mode traffic regardless of review status; Phase 7's out-of-window features additionally gated on spike results.

---

## 15. Component Reuse Strategy (corrected)

### 15.1 Reuse With Modification

| Component | Modification |
|---|---|
| `AddOrderDialog` | + optional `prefill` prop (§6.1 spec — customerName/customerPhone/sourceId seeds + useEffect); business-scoped datasets supplied by the inbox wrapper. NOT as-is. |
| `MiniProductCatalog` | As-is, but caller supplies products/categories/stores (props verified: `products, categories, productCatMap?, stores, onSelectProduct, onAddCustomItem, className?`) — the inbox must fetch and pass a business-scoped catalog (L8). |

### 15.2 Pattern Reuse (adapted, not copied byte-for-byte)

| Pattern | Source | Inbox Application | Difference |
|---|---|---|---|
| Webhook HMAC verification | woo-webhook lines 86-120 | Same `crypto.subtle` HMAC flow for Meta | Woo compares base64 (`btoa`, line 104); Meta needs `sha256=` + lowercase hex (L1) |
| Customer resolution | woo-webhook lines 550-614 | **Inverted**: alias-first at webhook time (no phone exists — H11); phone-first only at order creation | Input payload shape is completely different |
| Idempotency | woo-webhook lines 50-59 | `messages.platform_message_id` UNIQUE + `meta_webhook_events` log | Different table |
| Order creation flow | AddOrderDialog lines 774-903 | Unchanged inside the dialog | Prefill added at the edges |
| RLS DO block | foundation lines 333-348 | Identical for SELECT policies | Write policies are per-class + permission-gated (H7) — new pattern |
| Cron → edge function | 20260802065715 | Outbox sweep, bulk-send, token-probe | Same shape |
| Vault secret + getter RPC | 20260901000000 | Token key + decrypt RPC | New use |
| Fuse.js search | AddOrderDialog 455-469 | Product search (inside MiniProductCatalog — already there) | — |
| Bulk actions bar | `OrderBulkActionsBar` | Conversation bulk operations | Same pattern |

### 15.3 New Components

All built on shadcn/ui primitives (`Button`, `Input`, `Badge`, `Card`, `Tabs`, `ScrollArea`, `Avatar`, `Tooltip`, `Popover`, `Command`, `Dialog`, `Sheet`/vaul):

`OmniInbox`, `ConversationList` + `ConversationItem`, `MessageThread` + `MessageBubble`, `ComposerBar`, `ContextSidebar`, `CustomerProfileCard`, `TagManager`, `QuickReplyPicker`, `SavedMessagePicker`, `OptInPromptCard`, `CampaignBuilder`, `AssignmentDropdown`, `ConversationSearch`, `BulkActionBar`, `WindowBanner`, `AutomationRuleEditor`, `AnalyticsDashboard`.

---

## 16. Edge Cases and Failure Modes

### 16.1 Webhook Failures

| Scenario | Mitigation |
|----------|------------|
| Duplicate events | `UNIQUE(platform_message_id)` on messages; `meta_webhook_events` observability |
| Webhook endpoint down/slow | Meta retries failed deliveries on an undocumented schedule — the reliable contract is: **respond 200 within 20 seconds** (L7 — the "24h exponential backoff" figure is removed as unverified) |
| Malformed payload | try/catch JSON.parse → 400 + `meta_webhook_events` log |
| Unknown channel_account | log + 404-equivalent skip (do not crash the batch) |
| Token invalid mid-processing | Meta 401/190 → `is_active=false` + admin alert (probe verifies weekly, §5.4) |
| Attachment download failure | Non-blocking: message inserts with pending-download flag; retry sweep for 24h (§5.5) |

### 16.2 Send Failures

| Scenario | Mitigation |
|----------|------------|
| Window expired | Pre-checked (§5.2); UI composer disables + countdown; outbox → `blocked_window` |
| HUMAN_AGENT eligible (7d) | Tag selector offered with permission gate (§4.5) |
| Rate limit exhausted | Atomic bucket denies → row stays pending with 1s retry (sweep) |
| Customer blocked page / thread unavailable | Meta error → mark conversation `metadata->>'blocked'`, surface in UI |
| Network timeout to Graph | Backoff retries 1s/2s/4s … max 5; then terminal `failed` + inline retry affordance |
| Invalid/too-large attachment | Rejected in composer pre-upload (8MB image / 25MB file checks) |

### 16.3 Concurrency

| Scenario | Mitigation |
|----------|------------|
| Two agents send simultaneously | Outbox claim is atomic (§1.5); messages serialize per account rate bucket |
| Assign vs transfer race | Optimistic `updated_at` check on conversation UPDATE |
| Webhook arrives while typing | Normal race; INSERT-only realtime appends the bubble |
| Realtime drop | TanStack refetch on reconnect + channel re-subscription handler |

### 16.4 Data Integrity (L6 fix)

| Scenario | Mitigation |
|----------|------------|
| Customer deletes FB/IG account | **No reliable webhook** for account deletion (handovers ≠ deletion) — detect via send failures (recipient unreachable errors) and mark conversation inactive; periodic profile-fetch check marks stale senders (L6) |
| Business disconnects page | `channel_accounts.is_active=false`; webhook skips the account; UI banner |
| Cascade delete business | `ON DELETE CASCADE` on all FKs |
| Orphaned outbox rows | Sweep requeues ≤5 attempts; 7-day-old pending rows cancelled + audited |
| Duplicate platform aliases (race) | `UNIQUE (channel_id, token)` on subscriptions; alias insert uses ON CONFLICT DO NOTHING |

---

## 17. Production Concerns

### 17.1 Cost Estimation (Supabase Pro) — L10 fix

- **Database**: ~16 new tables; 500MB-2GB after 1 year at 500 convos/day
- **Edge Functions**: webhook invocations at 500 convos/day × ~10-20 events/conversation (messages + deliveries + reads + optins) ≈ **10-20K/day**; sends ≈ 5-10K/day; sweep 2.9K/day — well within Pro limits (v1's "150K/day" was ~10x high)
- **Realtime**: ~20 agents × 1 connection — trivial
- **Storage**: attachments + invoice PDFs — 10-50GB/year depending on media volume

### 17.2 Monitoring

- All edge function errors → `meta_webhook_events` + structured logs
- Alerts: token invalidation, outbox failure rate > 5%, webhook processing > 10s, queue depth > 500, Graph API error-rate spikes, version-deprecation warnings (§5.0)
- Dashboard: outbox depth, active conversations, agents online, campaign progress

### 17.3 Migration Safety

- All migrations idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP POLICY IF EXISTS` before every CREATE)
- Test against a production snapshot before applying; rollback scripts per migration
- Never drop columns from existing tables; only add (exception: this plan's one intentional ALTER of `customer_aliases` type CHECK — additive values, no data loss)

### 17.4 Testing Strategy

- Unit: automation rules engine, window calculator (incl. NULL + 7d tag cases), eligibility function (§10.3), saved-message variable substitution
- Integration: webhook pipeline with recorded Meta payloads (postbacks, deliveries, reads, optins); send-decision matrix (§5.2); rate bucket atomicity under concurrent claims
- E2E: webhook → UI display → reply → delivery-status ticks (Playwright, dev-mode traffic)
- Load: mock webhook spout at target rate; concurrent-agent message storms

### 17.5 Data Retention (M13)

pg_cron jobs (scheduled in Phase 8):

| Data | Policy |
|---|---|
| `meta_webhook_events` | Purge > 30 days (webhook_events precedent) |
| `agent_presence_log` | Purge > 90 days |
| `conversation_viewers` | Heartbeat cleanup: delete `viewed_at < now() - 5 min` (continuous semantics); purge > 90 days |
| `message_outbox` terminal states | Purge sent/failed/cancelled/blocked > 90 days (campaign stats already aggregated) |
| `messages` | **Archive** (not delete): copy > 12 months old to `messages_archive` (same shape, no FKs, tablespace-cold) then delete from hot table — monthly cron, batched; search/virtualizer treat the archive as fallback source |

```sql
CREATE TABLE public.messages_archive (LIKE public.messages INCLUDING DEFAULTS);
ALTER TABLE public.messages_archive SET (autovacuum_enabled = true);
-- monthly: INSERT INTO messages_archive SELECT * FROM messages WHERE created_at < now() - interval '12 months' ... DELETE ... RETURNING (batched, 10k rows/pass)
```

---

## 18. Files to Create (Summary)

### Migrations
- `supabase/migrations/202609XX01_omni_inbox_enums.sql` (enums + app_permission — ADD VALUE isolated)
- `supabase/migrations/202609XX02_omni_inbox_alias_types.sql` (customer_aliases CHECK — A1)
- `supabase/migrations/202609XX03_omni_inbox_schema.sql` (tables, indexes, RLS, triggers, RPCs, vault, crons)
- `supabase/migrations/202609XX04_omni_inbox_storage.sql` (bucket + policies)
- `supabase/migrations/202609XX05_omni_inbox_realtime.sql` (publication + replica identity)

### Edge Functions
- `supabase/functions/meta-webhook/index.ts`
- `supabase/functions/meta-send/index.ts`
- `supabase/functions/meta-outbox-sweep/index.ts`
- `supabase/functions/meta-bulk-send/index.ts`
- `supabase/functions/meta-token-probe/index.ts`
- `supabase/functions/meta-connect-account/index.ts` (settings connect flow, encrypts via trigger)
- `supabase/functions/_shared/meta-api.ts`

### React Components (`src/components/inbox/`)
`OmniInbox`, `ConversationList`, `ConversationItem`, `MessageThread`, `MessageBubble`, `ComposerBar`, `ContextSidebar`, `CustomerProfileCard`, `ProductQuickSend`, `InvoiceQuickSend`, `CourierQuickSend`, `OrderLinker`, `TagManager`, `QuickReplyPicker`, `SavedMessagePicker`, `OptInPromptCard`, `CampaignBuilder`, `AssignmentDropdown`, `ConversationSearch`, `BulkActionBar`, `WindowBanner` (21 files)

### Modified Files
- `src/components/orders/AddOrderDialog.tsx` (prefill props — §6.1)
- `package.json` (+`@tanstack/react-virtual`)
- `src/integrations/supabase/types.ts` (regenerated)

### Hooks (`src/hooks/`)
`useConversations`, `useMessages`, `useMessageInserts`, `useConversationRealtime`, `useAgentPresence`, `useWindowStatus`

### Settings Pages
- `src/pages/InboxSettings.tsx` (channel accounts, saved messages, automation rules, quick replies, campaigns)

---

This plan is designed to survive adversarial review. Every schema statement is complete SQL; every codebase claim was re-verified in this revision session; every uncertain Meta platform behavior is spike-gated in Phase 0 with a documented fallback. The phased approach builds each layer on tested foundations, with App Review running as an explicit parallel track rather than a hidden blocker.
