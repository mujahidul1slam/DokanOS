# Omni-Inbox Implementation Plan v5

## Unified Four-Platform Chat Integration (Facebook Â· Instagram Â· WhatsApp Â· TikTok) for Shohozbiz

> **Lineage:** v4 (FB/IG only, 4 critique cycles, ~119 issues fixed) is the verified substrate. v5 copies v4's platform-agnostic SQL **verbatim** (RLS DO-block shape, `claim_outbox_batch` SKIP LOCKED, `search_conversations` UNION, `merge_chat_customers` 3-arg, `post_system_message` GUC, `freeze_conversation_anchors`, `seed_rate_limit_bucket` SECURITY DEFINER, `resolve_order_business`) and adapts only the platform-specific parts: the service-window generated column, the webhook router, the send matrix, templates, and bulk.
>
> **Evidence discipline.** WhatsApp items marked **FACT** are design-first-class. TikTok items marked **[VERIFY IN PHASE 0 SPIKE]** are spike-gated â€” no TikTok API specifics are asserted in this plan beyond the OAuth token-lifetime pattern and the reply-first posture. Where a claim would be fabrication, the marker is present instead of the claim.

---

## 0. Multi-Platform Matrix (read this first)

One inbox, four platforms, one schema, one queue. Everything below is enforced at the schema/adapter layer â€” the UI, the outbox, the sweep, analytics, and RLS are platform-agnostic and read `platform` where behavior diverges.

| Dimension | Facebook Messenger | Instagram DM | WhatsApp Business Cloud | TikTok Business Messaging |
|---|---|---|---|---|
| **Identity** | PSID (page-scoped) | IG scoped user ID | `wa_id` = E.164 phone, no `+` **FACT** | `open_id` (per-app) **[SPIKE]** |
| **Alias type** | `facebook_psid` | `instagram_id` | `whatsapp_wa_id` | `tiktok_open_id` |
| **Customer resolution** | Alias-first (no phone in payload) | Alias-first | **Phone-first direct match** (normalizeBdPhone â†’ `customers.phone`); alias inserted for uniformity **FACT** | Alias-first **[SPIKE]** |
| **Conversation key** | `(account, PSID)` | `(account, IGSID)` | `(account, wa_id)` | `(account, open_id)` **[SPIKE]** |
| **Service window** | 24h from customer's last msg | 24h | 24h **FACT** | 48h (believed) **[SPIKE]** |
| **Out-of-window path** | Message tags (HUMAN_AGENT 7d) + RN/OTN opt-in tokens | same, RN/OTN believed absent | **Approved templates only** (MARKETING / UTILITY / AUTHENTICATION) **FACT** | **Blocked in v1** â€” `error_code='tiktok_window_closed'` |
| **Template model** | None (tags + opt-ins instead) | None | **Pre-approved templates required** for business-initiated/out-of-window **FACT** | n/a (v1) |
| **Bulk campaigns** | RN/OTN-gated + within-window | Within-window only | **Approved-template broadcasts to any customer base**, capped by tier **FACT** | **Not in v1** (greyed out, explained) |
| **Opt-in requirement for bulk** | Yes (RN/OTN token) | n/a | **No per-user opt-in needed**; business-level opt-out honored **FACT** | n/a |
| **Token model** | Long-lived page token (no fixed expiry) | Same | **Permanent system-user Bearer token** **FACT** | `access_token` ~24h + `refresh_token` ~1y â†’ **refresh flow required** **FACT-pattern** |
| **Rate model** | ~250 msg/s per page | ~250 msg/s per page | **Tiered daily caps** 250 â†’ 1K â†’ 10K â†’ 100K unique customers/24h (business-initiated) + ~80 req/s **FACT** | Platform-specific **[SPIKE]** |
| **Delivery tracking** | Watermark (no mids on reads) | Watermark | **Per-message `wamid`** sent/delivered/read/failed **FACT** | **[SPIKE]** |
| **Webhook signature** | Meta `X-Hub-Signature-256` (shared app secret) | Same | Same Meta machinery, object `whatsapp_business_account` **FACT** | **Own scheme â‰  Meta HMAC** â€” separate verification branch **[SPIKE]** |
| **Media** | CDN URL (expires) | CDN URL (expires) | `GET /{media_id}` â†’ URL expires ~5 min â†’ Storage **FACT** | **[SPIKE]** |
| **Group messaging** | Out of scope | Out of scope | Not supported (1:1 only) **FACT** | Out of scope |
| **v5 ship posture** | Phase 2 (App Review gated for live) | Phase 2 | **Phase 2 first-class â€” independent of FB/IG App Review (WABA verification is separate)** | Phase 0 spike + approval application; **Phase 6â€“7 adapter gated on approval**; inbound read-only fallback always |

**Design consequence:** the only platform-aware schema objects are the `channel_platform` enum, the `window_expires_at` generated column (CASE on platform), per-platform credential columns on `channel_accounts`, the tier/quality columns, `message_templates` (WhatsApp), and per-platform rate-bucket seeding. Everything else â€” conversations, messages, outbox, campaigns, RLS, realtime, the sweep, analytics â€” is unchanged in shape and gains platform coverage by reading `platform`.

---

## 1. Architecture

### 1.1 Data Flow Overview

```
PLATFORM WEBHOOKS
  Meta family (FB / IG / WhatsApp)  â†’  meta-webhook   (X-Hub-Signature-256, shared app secret)
  TikTok                             â†’  tiktok-webhook (own signature scheme â€” [VERIFY SPIKE])
        |
        |-- 1. verify signature FIRST (per-platform verifier)
        |-- 2. route by object field: "page" | "instagram" | "whatsapp_business_account"
        |      (TikTok branch in its own function, normalizes to the SAME internal event shape)
        |-- 3. resolve channel_account by the platform's identity column
        |-- 4. idempotency (messages.platform_message_id UNIQUE)
        |-- 5. upsert conversation keyed by (channel_account_id, platform_recipient_id)
        |-- 6. resolve/create customer  â€” WhatsApp: PHONE-FIRST; others: alias-first
        |-- 7. insert message w/ platform event timestamp; attachments carry meta_url +
        |      download_pending=true (downloads OFF the critical path â€” sweep owns them)
        |-- 8. delivery/read status  â€” WhatsApp: per-wamid; FB/IG: watermark
        |-- 9. WhatsApp: message_template_status_update â†’ message_templates.status
        |-- 10. opt-in capture (FB/IG RN/OTN) / opt-out keyword detection (all platforms)
        |-- 11. automation rules â†’ outbox rows; fire sweep non-blocking ONLY if rows inserted
        v
Supabase PostgreSQL (conversations, messages, customers, message_outbox, message_templates)
        |
        | Supabase Realtime (postgres_changes â€” Â§1.4)
        v
React Inbox UI (TanStack Query + Realtime + @tanstack/react-virtual)

Agent sends reply (identical for all platforms):
  UI â†’ INSERT message_outbox (RLS-validated incl. cross-tenant EXISTS checks â€” HI-3)
      â†’ POST meta-send { outbox_id }
           |-- atomic claim (status 'sending')
           |-- cross-business re-assert (HI-3)
           |-- per-platform send decision matrix (Â§5.2): window / template / tag / opt-out
           |-- atomic rate token (Â§5.3 â€” platform-aware, incl. WhatsApp daily tier)
           |-- decrypt token via get_channel_access_token (Â§13.1)
           |-- dispatch to _shared/platforms/<platform>.ts adapter
           |-- insert messages row; set outbox sent / blocked_window / cancelled / failed
      â†’ (safety net) pg_cron 30s sweep: retries, automation rows, attachment downloads,
         campaign dispatch (sole campaign trigger â€” ME-3)
```

### 1.2 Why Supabase Edge Functions

Unchanged from v4. The codebase runs Deno edge functions extensively (`woo-webhook`, `pathao-courier`, `parse-order-text`, cron-triggered functions via pg_net). `woo-webhook` establishes the pattern we **adapt**: `Deno.serve`, CORS, `crypto.subtle` HMAC, service-role client, idempotency. One deliberate difference: Woo compares base64 (`btoa`); Meta needs `sha256=` + lowercase hex. **v5 addition:** the HMAC pattern is now one of two verifiers â€” TikTok's scheme is different and lives behind a `verifyTiktokSignature()` branch **[VERIFY IN PHASE 0 SPIKE]**.

### 1.3 Edge Functions Required

| Function | Purpose | Trigger |
|---|---|---|
| `meta-webhook` | All **Meta-family** webhooks (FB + IG + WhatsApp): verification GET + event POST, with a **platform router** on the `object` field | GET/POST from Meta |
| `tiktok-webhook` | TikTok events: **separate signature verification** (â‰  Meta HMAC), normalizes to the same internal event shape as the Meta router | GET/POST from TikTok **[VERIFY SPIKE]** |
| `meta-send` | Claim + process one outbox row for **any platform** â€” dispatches to the `_shared/platforms/` adapter selected by the channel account's platform | POST from client (JWT) |
| `meta-outbox-sweep` | Batch claim (SKIP LOCKED), attachment downloads (all platforms), due-campaign dispatch â€” platform-agnostic by construction | pg_cron 30s via pg_net; also fired non-blocking by `meta-webhook`/`tiktok-webhook` **only when outbox rows were inserted** |
| `meta-bulk-send` | Campaign engine: atomic claim, audience build, recipient rows, paced dispatch â€” now branched FB/IG (RN/OTN) vs WhatsApp (approved template + tier cap) | Invoked by the sweep â€” sole trigger (ME-3) |
| `meta-token-probe` | Weekly token validity probe â€” **per-platform endpoint**: FB/IG `GET /{page-id}?fields=id`; WhatsApp `GET /{phone_number_id}?fields=id`; TikTok token-expiry read | pg_cron weekly |
| `tiktok-token-refresh` | **New (v5).** Daily refresh of TikTok `access_token` from `refresh_token`, plus on-401 refresh inside the TikTok adapter. Alerts when `refresh_token_expires_at < now() + 14d` | pg_cron daily + on-401 |
| `meta-connect-account` | OAuth connect flow + manual-token fallback â€” **FB/IG path (v4 Â§4.7) unchanged**; adds a WhatsApp connect path (WABA id + phone_number_id + permanent system-user token) and a TikTok OAuth path (client key/secret from edge env) | POST from client (JWT + `inbox.manage`) |
| `meta-presence` | Heartbeat endpoint for `agent_presence_log` intervals | POST from client (JWT) |

### 1.4 Realtime Delivery Strategy

Unchanged from v4, restated for completeness:

- **Conversation list**: `conversations` (all events) filtered by `business_id`.
- **Message thread**: `messages` **INSERT only**; delivery ticks come from a 30-seconds-while-open status refetch (postgres_changes cannot watch column transitions server-side).
- **Outbox status**: two handlers on one channel â€” INSERT (optimistic `pending` bubble) + UPDATE (`sending â†’ sent/failed/blocked_window/cancelled`). The UPDATE events are the **only** realtime signal for failed/blocked sends. Churn bounded to ~3 events/row.
- **Presence / Broadcast**: Realtime Presence channels; ephemeral collision events (Â§9.5).

Capacity: Pro allows ~500 concurrent connections; 20 agents Ã— one connection each is comfortable. Realtime publication for `conversations` + `messages` + `message_outbox` is added in Phase 1 (Â§2.7) with `REPLICA IDENTITY FULL`.

### 1.5 Message Sending Pipeline

**Outbox-first, two trigger paths, no `pg_notify`** â€” edge functions cannot `LISTEN`; they are short-lived isolates.

1. Agent clicks send â†’ client inserts a `message_outbox` row (`status: 'pending'`). RLS validates membership + permission + cross-tenant relational consistency (HI-3) at insert time.
2. Client immediately invokes `meta-send` with `{ outbox_id }` (JWT). `meta-send` claims atomically: `UPDATE message_outbox SET status='sending' WHERE id=$1 AND status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at <= now()) RETURNING *`. **NULL-safe compound** â€” a fresh row has `next_retry_at IS NULL`, which `.lte` would silently exclude (v4 ME-B5 fix, preserved).
3. `meta-send` re-asserts cross-business consistency, applies the **per-platform send decision matrix** (Â§5.2), consumes a platform-aware rate token (Â§5.3), decrypts the token, **dispatches to the platform adapter** (`_shared/platforms/{facebook,instagram,whatsapp,tiktok}.ts`), inserts the `messages` row, sets the terminal outbox status.
4. **Interactive latency budget: < 1s** (direct invoke).
5. **Automation auto-replies**: webhook fires a non-blocking sweep call after inserting outbox rows â†’ **â‰¤ 2s typical**. Fired ONLY when rows were actually inserted (ME-16).
6. **Safety net**: pg_cron 30s sweep (pg_net + `x-cron-secret`, exact pattern of migration 20260802065715). If pg_cron rejects sub-minute intervals, fall back to 1 min â€” interactive sends are unaffected.
7. **Retries**: exponential backoff (1s, 2s, 4s â€¦ max 5) for **explicit retryable API errors only**. Timeout/unknown-outcome errors are **never auto-retried** (LO-6) â€” the Send APIs have no client dedup id; auto-retry after a lost response duplicates the customer message. `error_code='timeout_unknown'` surfaces "possibly sent â€” verify in thread".

---

## 2. Database Schema

All new tables follow the existing multi-tenant pattern: `business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE`, RLS reads via `is_business_member(business_id) OR has_role(auth.uid(),'admin')`, and per-class write policies gated on `has_permission()` â€” final shape from day one.

**Two exceptions** (unchanged): `conversation_viewers` has no `business_id` (keyed to conversation; policy joins), and `meta_webhook_events` + `rate_limit_buckets` are service-role-only (no policies).

### 2.1 New Enums

```sql
-- v5 CHANGE: channel_platform gains 'whatsapp' and 'tiktok'
CREATE TYPE public.channel_platform AS ENUM ('facebook', 'instagram', 'whatsapp', 'tiktok');
CREATE TYPE public.conversation_status AS ENUM ('open', 'assigned', 'waiting', 'resolved', 'closed');
CREATE TYPE public.conversation_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE public.message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE public.message_sender_type AS ENUM ('customer', 'agent', 'system', 'bot');

-- v5 CHANGE: five content types added / restored for WhatsApp + TikTok fidelity
CREATE TYPE public.message_content_type AS ENUM (
  'text', 'image', 'video', 'audio', 'file', 'document',
  'location', 'sticker', 'interactive',
  'product_card', 'invoice_pdf', 'courier_info',
  'order_confirmation', 'saved_message', 'quick_reply',
  'template', 'internal_note'
);
CREATE TYPE public.outbox_status AS ENUM ('pending', 'sending', 'sent', 'failed', 'blocked_window', 'cancelled');
CREATE TYPE public.campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'completed', 'paused', 'failed');

-- app_permission additions â€” Migration A ONLY (see the ME-15 warning below)
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.manage';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.send_messages';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.bulk_send';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.view_analytics';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.send_tagged';
```

**v5 content-type mapping justification:**

- `'document'` â€” WhatsApp has an explicit `document` type (filename + caption + media) distinct from a generic file **FACT**. FB/IG file messages continue to map to `'file'`. Keeping both preserves WhatsApp fidelity on the wire and in the archive.
- `'location'` â€” WhatsApp `location` messages carry latitude/longitude **FACT**. Stored in `metadata->'location'`; FB/IG have no equivalent in v1 scope.
- `'sticker'` â€” WhatsApp (and IG) stickers require distinct rendering semantics (transparent/animated). Bundling them under `'image'` loses the ability to render correctly.
- `'interactive'` â€” WhatsApp button replies (max 3 buttons) and list replies (max 10 rows) **FACT**. The reply payload is structured (`button_reply`/`list_reply` id+title), stored in `metadata->'interactive'`. Not a freeform text message.
- `'template'` â€” **restored and now actively used.** v4 renamed it to `'saved_message'` because Messenger/IG have no approval system (v4 issue C2 â€” correct there). v5 keeps `'saved_message'` for internal agent drafts **and** restores `'template'` for genuine WhatsApp template sends â€” they are different objects: one is an internal draft, the other is a platform-approved artifact carrying `template_id` + language.

**ME-15 hard warning (unchanged, re-verified):** Migration A (`ALTER TYPE`) and Migration C (tables/policies that cast `'inbox.send_messages'::app_permission`) run in **separate files and separate transactions**. Postgres rejects `ADD VALUE` followed by a same-transaction cast of the new value ("unsafe use of new value"); the `IF NOT EXISTS` guard does **not** make the combination safe. CI check: the Phase 1 PR asserts Migration A contains zero `CREATE POLICY`/`CREATE TABLE` statements.

### 2.2.0 Pre-existing schema changes

```sql
-- ============================================================================
-- A1 (v5 EXTENDED): customer_aliases.type â€” add all four platform alias types.
-- Verified: migration 20260418114108 defines the CHECK as ('name','email','address')
-- only. Platform-ID aliases would violate the constraint on every webhook.
-- Replace the CHECK and add a lookup index (unchanged mechanism, wider domain).
-- ============================================================================
ALTER TABLE public.customer_aliases DROP CONSTRAINT IF EXISTS customer_aliases_type_check;
ALTER TABLE public.customer_aliases ADD CONSTRAINT customer_aliases_type_check
  CHECK (type IN ('name','email','address',
                  'facebook_psid','instagram_id',
                  'whatsapp_wa_id','tiktok_open_id'));

CREATE INDEX IF NOT EXISTS idx_customer_alias_type_value
  ON public.customer_aliases (type, lower(value));

-- ============================================================================
-- LO-2 + L3-1 (v5 EXTENDED): seed order_sources for every chat platform.
-- Verified: order_sources.name IS UNIQUE (20260415165743 DDL) and the only
-- seeds are ('online','pos','phone','social','wholesale'). Guarded inserts
-- are self-documenting and harmless. Unblocks order prefill sourceName per
-- platform ('fb/ig' | 'whatsapp' | 'tiktok').
-- ============================================================================
INSERT INTO public.order_sources (name, is_default, sort_order)
SELECT 'fb/ig', false, 6
WHERE NOT EXISTS (SELECT 1 FROM public.order_sources WHERE name = 'fb/ig');

INSERT INTO public.order_sources (name, is_default, sort_order)
SELECT 'whatsapp', false, 7
WHERE NOT EXISTS (SELECT 1 FROM public.order_sources WHERE name = 'whatsapp');

INSERT INTO public.order_sources (name, is_default, sort_order)
SELECT 'tiktok', false, 8
WHERE NOT EXISTS (SELECT 1 FROM public.order_sources WHERE name = 'tiktok');
```

(`source_store_id` is nullable â€” platform aliases insert with `NULL`.)

### 2.2.1 Channel Accounts (v5 â€” four-platform credentials)

```sql
-- ============================================================================
-- Channel Accounts: per-business platform connections.
-- v5 CHANGE: WhatsApp columns (waba_id, phone_number_id, tier, quality_rating)
-- and TikTok token lifecycle columns. The Meta App Secret stays APP-LEVEL in
-- edge env (META_APP_SECRET) â€” no per-row app_secret (v4 C3 fix, preserved).
-- TikTok client_key/client_secret are ALSO app-level (edge env:
-- TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET) â€” one TikTok app per deployment;
-- per-row rows carry only the OAuth grant artifacts.
-- ============================================================================
CREATE TABLE public.channel_accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform                 public.channel_platform NOT NULL,
  account_name             text NOT NULL,

  -- Platform identity (exactly one group set, enforced below)
  page_id                  text,                    -- FB Page ID (numeric string)
  ig_account_id            text,                    -- Instagram professional account ID
  waba_id                  text,                    -- WhatsApp Business Account ID
  phone_number_id          text,                    -- WhatsApp number (one per connected number)

  -- Credentials
  access_token_encrypted   text NOT NULL,           -- PGP-armored ciphertext (Â§13.1).
                                                           -- FB/IG: long-lived page token.
                                                           -- WhatsApp: permanent system-user token.
                                                           -- TikTok: short-lived access_token (~24h).
  refresh_token_encrypted  text,                    -- TikTok ONLY (~1 year refresh token)
  token_expires_at         timestamptz,             -- TikTok ONLY: access_token expiry
  refresh_token_expires_at timestamptz,             -- TikTok ONLY: refresh_token expiry (alert < 14d)

  -- WhatsApp throughput tier + quality rating (FACT: tiered caps; rating drops
  -- on unread/blocked). Both mutable by the business in settings; a tier change
  -- re-seeds the rate bucket's daily_capacity (Â§5.3).
  whatsapp_tier            text CHECK (whatsapp_tier IN ('250','1K','10K','100K')),
  whatsapp_quality_rating  text CHECK (whatsapp_quality_rating IN ('GREEN','YELLOW','RED')),

  webhook_verify_token     text NOT NULL,           -- 32+ byte random; UNIQUE
  token_validated_at       timestamptz,             -- Set by weekly meta-token-probe
  is_active                boolean NOT NULL DEFAULT true,
  last_connected_at        timestamptz,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- CHECK: exactly one platform identity group (v4's constraint, extended)
  CONSTRAINT channel_accounts_one_identity CHECK (
       (platform = 'facebook' AND page_id IS NOT NULL
        AND ig_account_id IS NULL AND waba_id IS NULL AND phone_number_id IS NULL
        AND refresh_token_encrypted IS NULL)
    OR (platform = 'instagram' AND ig_account_id IS NOT NULL
        AND page_id IS NULL AND waba_id IS NULL AND phone_number_id IS NULL
        AND refresh_token_encrypted IS NULL)
    OR (platform = 'whatsapp' AND waba_id IS NOT NULL AND phone_number_id IS NOT NULL
        AND page_id IS NULL AND ig_account_id IS NULL
        AND refresh_token_encrypted IS NULL)
    OR (platform = 'tiktok' AND page_id IS NULL AND ig_account_id IS NULL
        AND waba_id IS NULL AND phone_number_id IS NULL
        AND refresh_token_encrypted IS NOT NULL)
  ),
  UNIQUE (platform, page_id),
  UNIQUE (platform, ig_account_id),
  UNIQUE (platform, waba_id, phone_number_id),
  UNIQUE (webhook_verify_token)
);
CREATE INDEX idx_channel_accounts_business ON public.channel_accounts(business_id);
CREATE TRIGGER set_channel_accounts_updated_at BEFORE UPDATE ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
```

**TikTok row identity note:** a TikTok `channel_accounts` row carries no platform identity column â€” the app is identified by the edge-env `TIKTOK_CLIENT_KEY`, and `open_id` is per-*customer*, not per-account. One row per business per TikTok app is therefore the natural cardinality, enforced by a partial unique index:

```sql
CREATE UNIQUE INDEX uq_channel_accounts_tiktok_per_business
  ON public.channel_accounts (business_id) WHERE platform = 'tiktok';
```

### 2.2.2 Conversations (v5 â€” platform-aware service window)

```sql
-- ============================================================================
-- Conversations â€” 1:1 DM model (H10): a conversation IS the (account, recipient)
-- pair. WhatsApp is 1:1 only by API design (FACT); FB/IG provide no durable
-- thread ID for DMs; TikTok is scoped to open_id (SPIKE). Group chats are OUT
-- OF SCOPE for all platforms.
-- ============================================================================
CREATE TABLE public.conversations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id        uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  platform                  public.channel_platform NOT NULL,
  -- v5: platform_recipient_id documents its meaning per platform
  platform_recipient_id     text NOT NULL,          -- PSID (FB) | IGSID (IG) | wa_id (WhatsApp) | open_id (TikTok)
  customer_id               uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  assigned_agent_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status                    public.conversation_status NOT NULL DEFAULT 'open',
  priority                  public.conversation_priority NOT NULL DEFAULT 'normal',
  tags                      text[] NOT NULL DEFAULT '{}',
  last_message_at           timestamptz,
  last_customer_message_at  timestamptz,            -- NULL => service window CLOSED (H9)
  last_agent_message_at     timestamptz,
  first_agent_response_at   timestamptz,            -- analytics (A2); population rules Â§2.5.1 (ME-11)
  unread_count              integer NOT NULL DEFAULT 0,
  snoozed_until             timestamptz,
  closed_at                 timestamptz,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- v5 CHANGE: platform-aware STORED generated column. A CASE over a column of
  -- the same row is immutable, so this is legal in a STORED generated column
  -- (v4's static `+ interval '24 hours'` is the 3rd branch). TikTok = 48h
  -- (believed window â€” [VERIFY IN PHASE 0 SPIKE]); all others = 24h.
  --
  -- HUMAN_AGENT's 7-day extension is deliberately NOT here: it is FB/IG-only
  -- AND depends on the outbox row's message_tag, which is not visible from the
  -- conversation row. It stays a send-time check in Â§5.2 (unchanged from v4).
  window_expires_at         timestamptz GENERATED ALWAYS AS
                             (CASE
                                WHEN last_customer_message_at IS NULL THEN NULL
                                WHEN platform = 'tiktok'::public.channel_platform
                                  THEN last_customer_message_at + interval '48 hours'
                                ELSE last_customer_message_at + interval '24 hours'
                              END) STORED,
  UNIQUE (channel_account_id, platform_recipient_id)
);
CREATE INDEX idx_conversations_assigned_agent ON public.conversations(assigned_agent_id, status) WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX idx_conversations_last_message ON public.conversations(business_id, last_message_at DESC);
CREATE INDEX idx_conversations_customer ON public.conversations(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_conversations_tags ON public.conversations USING GIN (tags);
CREATE INDEX idx_conversations_unread ON public.conversations(business_id) WHERE unread_count > 0;
CREATE INDEX idx_conversations_window ON public.conversations(channel_account_id, last_customer_message_at)
  WHERE last_customer_message_at IS NOT NULL;
CREATE TRIGGER set_conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
```

### 2.2.3 Messages

```sql
-- ============================================================================
-- Messages (inbound, outbound, internal notes, system events) â€” all platforms
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
    -- [{storage_path, filename, mime, size, type, meta_url}] (ME-12: meta_url set
    -- at insert; storage_path filled by the sweep's download task â€” applies to
    -- Meta CDN URLs AND WhatsApp media_id URLs, both expiring)
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- campaign_id stamped by meta-bulk-send (ME-11); download_pending (ME-12);
    -- WhatsApp: {template_name, template_language, pricing_category,
    --            interactive: {type:'button'|'list', id, title},
    --            location: {lat, lon}}; error payloads on failed statuses
  platform_message_id  text,
  platform_timestamp    bigint,                     -- Platform event timestamp, ms epoch (H9)
  is_read              boolean NOT NULL DEFAULT false,
  read_at              timestamptz,
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
-- delivery-status updates scan outbound sent messages by platform_message_id
-- (mid for FB/IG, wamid for WhatsApp â€” both land in the same column)
CREATE INDEX idx_messages_delivery_pending ON public.messages(platform_message_id)
  WHERE direction = 'outbound' AND delivery_status = 'sent';
```

**Per-platform read-tracking difference (documented â€” a webhook-processing rule, not a schema change):**

- **FB/IG:** `message_reads` payloads carry a **watermark** and **no mids array**. The webhook marks ALL outbound messages of the conversation with `created_at <= to_timestamp(watermark/1000)` as `read` (HI-B4 fix from v4, unchanged).
- **WhatsApp:** `statuses[]` are **per-message** â€” each entry carries `recipient_id` (wa_id) + the **`id` = wamid** of the specific message + `status` (sent/delivered/read/failed) **FACT**. The webhook updates the single matching `messages` row by `platform_message_id = wamid`. `failed` statuses additionally record `errors` into `metadata->'errors'`.
- Both paths converge on the same three columns (`delivery_status`, `delivered_at`, `customer_read_at`) â€” the UI's tick renderer is platform-agnostic.

Window bookkeeping (H9, unchanged): inbound inserts set `created_at = to_timestamp(platform_timestamp / 1000.0)` â€” the platform's event timestamp, not webhook-processing `now()`. The `handle_new_message` trigger (Â§2.5.1) propagates it into `last_customer_message_at` **monotonically** (ME-4).

### 2.2.4 Message Outbox (v5 â€” template + TikTok states)

```sql
-- ============================================================================
-- Message Outbox: queue for ALL outbound sends on ALL platforms (Â§1.5)
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
  template_variables    jsonb,                      -- Variable substitution (saved drafts AND WhatsApp templates)
  -- v5 ADD: WhatsApp template send path
  template_id           uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  -- Send modes (meta-send derives the path per Â§5.2; at most one set):
  message_tag           text CHECK (message_tag IN ('ACCOUNT_UPDATE','CONFIRMED_EVENT_UPDATE','HUMAN_AGENT','POST_PURCHASE')),
  subscription_id       uuid REFERENCES public.notification_subscriptions(id) ON DELETE SET NULL,
  campaign_id           uuid REFERENCES public.bulk_campaigns(id) ON DELETE CASCADE,
  status                public.outbox_status NOT NULL DEFAULT 'pending',
  error_code            text,                       -- 'opted_out' | 'cross_business_refusal' |
                                                    -- 'timeout_unknown' | 'tiktok_window_closed' |
                                                    -- 'template_not_approved' | 'tier_exhausted' |
                                                    -- API code (LO-6/ME-13/HI-3)
  error_message         text,
  retry_count           integer NOT NULL DEFAULT 0,
  next_retry_at         timestamptz,
  sent_at               timestamptz,
  platform_message_id   text,                       -- Platform's message ID after send (mid / wamid)
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_pending ON public.message_outbox(status, next_retry_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX idx_outbox_conversation ON public.message_outbox(conversation_id);
CREATE INDEX idx_outbox_channel ON public.message_outbox(channel_account_id, status);
```

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

### 2.2.6 Customer Tags (H1 â€” `customers` is a verified GLOBAL table)

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

### 2.2.9 Saved Messages (internal drafts â€” FB/IG/agent drafts)

**There is no Meta template-approval system for Messenger/Instagram** (v4 issue C2 â€” verified across 4 critique cycles). `saved_messages` remains an **internal saved-draft library** for within-window sends (and tag/subscription sends), plus the structured home for FB/IG opt-in prompt configs. **WhatsApp templates do NOT live here** â€” they are pre-approved platform artifacts in `message_templates` (Â§2.2.16).

```sql
CREATE TABLE public.saved_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name          text NOT NULL,
  body          text NOT NULL,                     -- Agent-visible description / draft text ({{variable}} placeholders)
  variables     text[] NOT NULL DEFAULT '{}',      -- Variable names for substitution
  category      text NOT NULL DEFAULT 'general'
                CHECK (category IN ('general','promo','support','order_status','csat','optin_prompt','optin_one_time')),
  optin_config  jsonb,                             -- REQUIRED when category='optin_prompt' or
                -- 'optin_one_time'; NULL otherwise (enforced by trigger Â§2.5.6):
                -- optin_prompt:    { topic: <taxonomy value>, frequency: 'daily'|'weekly'|'monthly', title, payload? }
                -- optin_one_time:  { title, payload? }   (one_time_notif template)
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
```

### 2.2.10 Notification Subscriptions (FB/IG RN/OTN â€” unchanged from v4)

**Corrected mechanism (Messenger; exact payload shapes [VERIFY IN PHASE 0 SPIKE]):**

- **Recurring Notifications (RN)**: the page sends a **`notification_messages` structured template message** via the Send API (`attachment.type='template'`, `payload.template_type='notification_messages'`) carrying a **`topic` selected from Meta's fixed taxonomy** and a `re_prompt_interval` (daily/weekly/monthly). Meta renders the prompt card itself, with its own Allow/Manage controls â€” **the business cannot compose a custom-CTA message, and no freeform opt-in exists**. If the user accepts, Meta fires `messaging_optins` carrying a notification token tied to the topic; while active, the page may send messages **outside the 24h window** using that token.
- **One-Time Notification (OTN) â€” a DISTINCT flow**: the page sends a `one_time_notif` **button template** (with `title` and a `payload` string the page chooses); the user taps Notify; Meta fires `messaging_optins` with a one-usable, short-lived token; the page sends exactly one follow-up.
- **Instagram**: Recurring Notifications is believed Messenger-only; IG campaigns are designed within-24h-only unless the spike proves otherwise (fallback Â§10.6).
- **WhatsApp**: no equivalent â€” WhatsApp needs no opt-in token for business-initiated template sends **FACT**. This table is FB/IG-only in practice (no CHECK is added; rows simply are not created for WhatsApp, whose campaign path uses `message_templates` instead â€” Â§10).

**Topic taxonomy:** Meta exposes a **fixed topic list** (documented values include `ACCOUNT_UPDATE`, `COMMUNITY_ALERT`, `EVENT_REMINDER`, `NEWSLETTER`, `ORDER_STATUS`, `SHIPPING_UPDATE` â€” exact current list is **[VERIFY IN PHASE 0 SPIKE]**). The plan stores taxonomy values verbatim; UI labels map to them. **No free-form topics anywhere in the schema or UI.**

```sql
CREATE TABLE public.notification_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id  uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  customer_id         uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  platform            public.channel_platform NOT NULL,
  subscription_type   text NOT NULL CHECK (subscription_type IN ('recurring','one_time')),
  topic               text CHECK (topic IN (
                        -- Initial documented taxonomy; FINALIZED from the
                        -- Phase 0 spike (Phase 7 migration updates this CHECK)
                        'ACCOUNT_UPDATE','COMMUNITY_ALERT','EVENT_REMINDER',
                        'NEWSLETTER','ORDER_STATUS','SHIPPING_UPDATE')),
                      -- NULL only for one_time subscriptions (no topic):
                      -- enforced by Â§2.5.6 trigger
  frequency           text CHECK (frequency IN ('daily','weekly','monthly')),
                        -- RN re_prompt_interval the business chose [VERIFY spike labels]
  token               text NOT NULL,                -- Notification token used for sends
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','used','expired','revoked')),
  opted_in_at         timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,                  -- RN: per-topic validity; OTN: short-lived [VERIFY]
  quota_remaining     integer,                      -- If Meta enforces per-subscription quotas [VERIFY]
  last_sent_at        timestamptz,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- Raw optin payload for debugging
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, token)
);
CREATE INDEX idx_subscriptions_active ON public.notification_subscriptions(channel_account_id, status)
  WHERE status = 'active';
CREATE INDEX idx_subscriptions_topic ON public.notification_subscriptions(channel_account_id, topic)
  WHERE status = 'active';   -- serves the Â§10.3 recipient-build JOIN (ME-10)
CREATE INDEX idx_subscriptions_customer ON public.notification_subscriptions(customer_id);
CREATE INDEX idx_subscriptions_conversation ON public.notification_subscriptions(conversation_id);
```

Token storage note (unchanged): a notification token is a per-recipient send capability with small blast radius (one customer, one topic, expiring), stored in this RLS-protected table, written only by the service role â€” proportionate protection without the PGP machinery of Â§13.1.

### 2.2.11 Bulk Campaigns + Recipients (v5 â€” WhatsApp template broadcasts)

```sql
-- ============================================================================
-- v5 CHANGE: template_id + whatsapp_pricing_category added for WhatsApp
-- broadcasts (FACT: approved-template broadcasts to any customer base, capped
-- by tier; per-24h-conversation pricing by category).
-- ============================================================================
CREATE TABLE public.bulk_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  saved_message_id      uuid REFERENCES public.saved_messages(id) ON DELETE SET NULL,
  -- v5 ADD: WhatsApp template broadcast path (NULL for FB/IG campaigns)
  template_id           uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  whatsapp_pricing_category text CHECK (whatsapp_pricing_category IN
                            ('marketing','utility','authentication','service')),
                            -- FACT: per-24h-conversation pricing category; recorded
                            -- per campaign for the cost view in the dashboard
  -- ME-10: the campaign's RN topic â€” the join key to notification_subscriptions.
  -- NULL means a within-window-only campaign (freeform, no subscription path).
  notification_topic    text CHECK (notification_topic IN (
                          'ACCOUNT_UPDATE','COMMUNITY_ALERT','EVENT_REMINDER',
                          'NEWSLETTER','ORDER_STATUS','SHIPPING_UPDATE')),
  name                  text NOT NULL,
  status                public.campaign_status NOT NULL DEFAULT 'draft',
  audience_filter       jsonb NOT NULL DEFAULT '{}'::jsonb,
      -- {tags: [...], min_orders: N, platforms: ['facebook','whatsapp',...],
      --  within_window_only: true|false}
      -- (require_subscription implied by notification_topic IS NOT NULL â€” ME-10;
      --  WhatsApp template campaigns require template_id IS NOT NULL â€” Â§10.3)
  template_variables    jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at          timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  total_recipients      integer NOT NULL DEFAULT 0,
  sent_count            integer NOT NULL DEFAULT 0,
  failed_count          integer NOT NULL DEFAULT 0,
  skipped_count         integer NOT NULL DEFAULT 0,  -- Outside window + no path (Â§10.3)
  opted_out_count       integer NOT NULL DEFAULT 0,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaigns_business ON public.bulk_campaigns(business_id);
CREATE INDEX idx_campaigns_due ON public.bulk_campaigns(status, scheduled_at)
  WHERE status = 'scheduled';   -- serves the sweep's due-campaign scan (ME-3)

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
  skip_reason         text,   -- 'opted_out' | 'outside_window_no_path' | 'no_conversation' |
                              -- 'quota_exhausted' | 'tier_exhausted' | 'template_not_approved'
  error_message       text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, customer_id, channel_account_id)
);
CREATE INDEX idx_recipients_campaign ON public.bulk_campaign_recipients(campaign_id);
CREATE INDEX idx_recipients_business ON public.bulk_campaign_recipients(business_id);
```

The recipient-creation path (`meta-bulk-send` Â§10.4) backfills `business_id` and `channel_account_id` from the campaign row â€” never NULL.

### 2.2.12 Automation Rules (v5 â€” platform scoping + WhatsApp template action)

```sql
CREATE TABLE public.automation_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  is_active         boolean NOT NULL DEFAULT true,
  trigger_type      text NOT NULL CHECK (trigger_type IN (
    'keyword_match', 'new_conversation', 'idle_timeout',
    'order_status_change', 'order_created',
    'tag_added', 'business_hours_off',
    'customer_first_message'
  )),
  -- v5 ADD: scope rules to platforms (NULL = all platforms on the business)
  platform_scope    public.channel_platform[],
  trigger_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type       text NOT NULL CHECK (action_type IN (
    'auto_reply', 'auto_tag', 'auto_assign', 'auto_close',
    'escalate', 'send_saved_message', 'send_optin_prompt',
    'send_whatsapp_template'      -- v5 ADD: out-of-window auto-reply on WhatsApp
  )),
  action_config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority          integer NOT NULL DEFAULT 0,
  match_count        integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_automation_business ON public.automation_rules(business_id, is_active);
```

`order_created` triggers resolve the business via `orders.business_id` (Â§2.5.4 â€” ME-9). `platform_scope` makes "WhatsApp-only auto-reply" expressible â€” necessary because the out-of-window auto-reply path differs per platform (WhatsApp = template; FB/IG = nothing outside window without a tag/subscription). `send_whatsapp_template` carries `{template_id}` in `action_config` and only fires for `platform='whatsapp'` conversations; the template must be APPROVED or the outbox row lands `blocked_window`-adjacent (`template_not_approved`) per Â§5.2 â€” no silent drop.

### 2.2.13 Rate Limit Buckets (v5 â€” platform-aware, daily tier cap)

```sql
-- ============================================================================
-- v5 CHANGE: daily_capacity / daily_used / daily_reset_at â€” WhatsApp's TIERED
-- 24h cap on business-initiated conversations (FACT: 250 â†’ 1K â†’ 10K â†’ 100K
-- unique customers/24h) is a DAILY budget, not a per-second token. The
-- per-second column stays for pacing (~80 req/s WhatsApp [VERIFY], ~200/s
-- FB/IG). FB/IG set daily_capacity = 0 (no daily cap).
-- ============================================================================
CREATE TABLE public.rate_limit_buckets (
  channel_account_id  uuid PRIMARY KEY REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  capacity            integer NOT NULL DEFAULT 200,      -- instant burst (per-second pacing)
  refill_rate_per_sec integer NOT NULL DEFAULT 200,
  tokens_remaining    integer NOT NULL DEFAULT 200,
  last_refill_at      timestamptz NOT NULL DEFAULT now(),
  daily_capacity      integer NOT NULL DEFAULT 0,        -- 0 = no daily cap (FB/IG)
  daily_used          integer NOT NULL DEFAULT 0,
  daily_reset_at      timestamptz NOT NULL DEFAULT now()
);
-- Service-role ONLY: RLS enabled, no policies, grants revoked (webhook_events precedent)
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_buckets TO service_role;
```

### 2.2.14 Webhook Event Log

```sql
-- v5: serves TikTok too, but the TABLE NAME is kept as meta_webhook_events to
-- preserve the v4 verified migration/RLS/retention pattern byte-for-byte. The
-- `object` column now also carries 'whatsapp_business_account' and 'tiktok'.
CREATE TABLE public.meta_webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id  uuid REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  object              text,                        -- 'page' | 'instagram' | 'whatsapp_business_account' | 'tiktok'
  event_type          text NOT NULL,               -- 'messages' | 'messaging_optins' | 'message_deliveries' |
                                                    -- 'message_template_status_update' | 'statuses' | ...
  platform_message_id text,                        -- mid / wamid when present
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

(30-day purge job in Â§17.5, following the `webhook_events` precedent.)

### 2.2.15 Remaining small tables

```sql
-- Agent presence (analytics persistence; Realtime Presence is the live source)
CREATE TABLE public.agent_presence_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('online', 'offline', 'away', 'busy')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz                        -- close-out: keepalive fetch on pagehide + 24h sweep (LO-10)
);
CREATE INDEX idx_presence_user ON public.agent_presence_log(user_id, started_at DESC);
CREATE INDEX idx_presence_open ON public.agent_presence_log(business_id) WHERE ended_at IS NULL;

-- Conversation viewers (collision detection) â€” scoped via join (no business_id column)
CREATE TABLE public.conversation_viewers (
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- Opt-out registry (M14: NULL channel_account_id = GLOBAL opt-out across ALL channels).
-- v5 NOTE: unchanged. WhatsApp has NO platform-level STOP handling (FACT) â€”
-- business keyword detection inserts rows here (Â§10.5), identical mechanism.
CREATE TABLE public.messaging_opt_outs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  channel_account_id uuid REFERENCES public.channel_accounts(id) ON DELETE CASCADE,  -- NULL = all channels
  reason             text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_opt_out_per_channel
  ON public.messaging_opt_outs (customer_id, channel_account_id)
  WHERE channel_account_id IS NOT NULL;
CREATE UNIQUE INDEX uq_opt_out_global
  ON public.messaging_opt_outs (customer_id, business_id)
  WHERE channel_account_id IS NULL;
```

Opt-out semantics (Â§10.5, ME-13): exclude when a row exists with `channel_account_id = :acct OR channel_account_id IS NULL` for that customer + business â€” applied to **all** outbound on **all** platforms, not just campaigns.

### 2.2.16 Message Templates (v5 â€” RE-INTRODUCED, WhatsApp only)

**v4 removed this table (issue C2) because Messenger/Instagram have no approval system â€” correct there, and the FB/IG design (tags + RN/OTN + saved drafts) is unchanged in v5.** WhatsApp is a genuinely different mechanism **FACT**: business-initiated and outside-24h messages require **pre-approved templates**, with categories MARKETING / UTILITY / AUTHENTICATION and a PENDING â†’ APPROVED/REJECTED lifecycle surfaced by the `message_template_status_update` webhook event. The table is therefore restored, scoped to WhatsApp by CHECK.

```sql
CREATE TABLE public.message_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  platform              public.channel_platform NOT NULL
                        CHECK (platform = 'whatsapp'::public.channel_platform),
                        -- scoped: only WhatsApp has an approval system in v5.
                        -- Messenger/IG use saved_messages + tags + RN/OTN instead (C2).
  name                  text NOT NULL,             -- Template name as registered with Meta
  language              text NOT NULL,             -- e.g. 'en_US', 'bn'
  category              text NOT NULL CHECK (category IN
                          ('MARKETING','UTILITY','AUTHENTICATION')),   -- FACT
  components            jsonb NOT NULL,            -- {header, body, buttons, footer} as registered
  status                text NOT NULL CHECK (status IN
                          ('PENDING','APPROVED','REJECTED')),          -- FACT lifecycle
  platform_template_id  text,                      -- Meta's template id once created
  rejection_reason      text,                      -- populated on REJECTED
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, name, language)
);
CREATE INDEX idx_message_templates_business ON public.message_templates(business_id, status);
CREATE INDEX idx_message_templates_eligible ON public.message_templates(channel_account_id, status)
  WHERE status = 'APPROVED';   -- serves the send-matrix + campaign eligibility lookups
CREATE TRIGGER set_message_templates_updated_at BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
```

**Template lifecycle in the product:**

1. Business composes a template in Settings (name, language, category, components). The settings UI submits it to Meta via the WhatsApp adapter (`POST /{waba_id}/message_templates`) and inserts the row `status='PENDING'`.
2. Meta's `message_template_status_update` webhook event flips `status` to `APPROVED` (setting `platform_template_id`) or `REJECTED` (setting `rejection_reason`) **FACT**.
3. Only `status='APPROVED'` rows are eligible for sends (Â§5.2 check 3d, Â§10.3).
4. The composer's template picker and the campaign builder list APPROVED templates only; PENDING/REJECTED rows show their state in the settings table (agent-visible, never silently usable).

### 2.3 RLS Policies â€” final shape, written once (H7 + HI-3 + ME-5 + LO-3)

v1's blanket "Members can write" `FOR ALL` policy would grant every business member (including viewers) full write, and Postgres RLS permissive policies OR together â€” you cannot add a later policy that *removes* access. The policies below are the **final shape from day one**. Reads: member-or-admin for all `business_id` tables. Writes: gated per class using the existing `has_permission()` function (verified: SECURITY DEFINER, migration 20260420112330).

**HI-3 core principle â€” relational consistency:** every INSERT that references a cross-table row (conversation, channel account, order) must assert that the referenced row belongs to the **same business** as the new row. Without this, a Business A agent can enqueue an outbox row with `business_id = A` (passes membership RLS) while `conversation_id`/`channel_account_id` point at Business B â€” `meta-send` (service role, RLS-exempt) would then decrypt B's token and deliver on B's channel. The `EXISTS` subqueries close that hole at the database layer; `meta-send` re-asserts in code (Â§5.1) as defense in depth.

```sql
-- ============================================================================
-- SELECT policies: every business_id-carrying table (DO block, foundation pattern)
-- v5 CHANGE: message_templates added to the array. Everything else is v4 verbatim.
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
    'message_templates', 'agent_presence_log', 'messaging_opt_outs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can read %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Members can read %1$s" ON public.%1$I FOR SELECT TO authenticated
       USING (has_role(auth.uid(), ''admin''::app_role) OR is_business_member(business_id))', t);
  END LOOP;
END $$;

-- conversation_viewers: read scoped via conversation join (LO-3: split off the
-- old FOR ALL own-rows policy, which let any user insert viewer rows for
-- ARBITRARY conversations â€” cross-tenant "X is viewing" pollution)
ALTER TABLE public.conversation_viewers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can read viewers" ON public.conversation_viewers;
CREATE POLICY "Members can read viewers" ON public.conversation_viewers FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.conversations c
               WHERE c.id = conversation_viewers.conversation_id
                 AND is_business_member(c.business_id)));

DROP POLICY IF EXISTS "Agents insert own viewer rows" ON public.conversation_viewers;
CREATE POLICY "Agents insert own viewer rows" ON public.conversation_viewers FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.conversations c
                WHERE c.id = conversation_viewers.conversation_id
                  AND is_business_member(c.business_id))
  );

DROP POLICY IF EXISTS "Agents update own viewer rows" ON public.conversation_viewers;
CREATE POLICY "Agents update own viewer rows" ON public.conversation_viewers FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Agents delete own viewer rows" ON public.conversation_viewers;
CREATE POLICY "Agents delete own viewer rows" ON public.conversation_viewers FOR DELETE TO authenticated
  USING (user_id = auth.uid());
```

Write policies â€” per class (complete statements):

```sql
-- ---------------------------------------------------------------------------
-- Class A: agent send path â€” inbox.send_messages (or admin)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agents update conversations" ON public.conversations;
CREATE POLICY "Agents update conversations" ON public.conversations FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)));

-- M3-2 fix: the membership re-check above validates the NEW business_id, but
-- an UPDATE that SWAPS channel_account_id to another business's channel would
-- pass it (member of both). This trigger freezes the tenant-anchor columns
-- on client updates (service-role/webhook rows have auth.uid() NULL and pass):
CREATE OR REPLACE FUNCTION public.freeze_conversation_anchors()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.channel_account_id IS DISTINCT FROM OLD.channel_account_id THEN
      RAISE EXCEPTION 'business_id/channel_account_id are immutable for client updates';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_freeze_conversation_anchors BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.freeze_conversation_anchors();

-- ME-5: EXISTS clause asserts the conversation belongs to the SAME business
-- (closes the cross-tenant insert hole); sender spoofing closed by requiring
-- sender_type='agent' AND sender_agent_id = auth.uid() for client inserts
-- (system/bot/customer rows are inserted only by the service role; the
-- Â§2.5.5 trigger re-asserts this at the DB layer).
DROP POLICY IF EXISTS "Agents insert messages" ON public.messages;
CREATE POLICY "Agents insert messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)
             AND sender_type = 'agent'
             AND sender_agent_id = auth.uid()
             AND EXISTS (SELECT 1 FROM public.conversations c
                         WHERE c.id = messages.conversation_id
                           AND c.business_id = messages.business_id)));
-- (internal notes go through this same policy â€” sender_type='agent', never sent anywhere)

-- HI-3: outbox INSERT asserts BOTH referenced rows belong to the row's business.
-- v5 NOTE: template_id is NOT in the EXISTS set â€” templates are only readable/
-- selectable through their own Class B manager-write policy, and the send
-- matrix re-validates template ownership + status at send time (Â§5.2 check 3d).
DROP POLICY IF EXISTS "Agents enqueue outbox" ON public.message_outbox;
CREATE POLICY "Agents enqueue outbox" ON public.message_outbox FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND created_by = auth.uid()
             AND has_permission(auth.uid(),
                  CASE WHEN message_tag IS NOT NULL THEN 'inbox.send_tagged'::app_permission
                       ELSE 'inbox.send_messages'::app_permission END)
             AND EXISTS (SELECT 1 FROM public.conversations c
                         WHERE c.id = message_outbox.conversation_id
                           AND c.business_id = message_outbox.business_id)
             AND EXISTS (SELECT 1 FROM public.channel_accounts ca
                         WHERE ca.id = message_outbox.channel_account_id
                           AND ca.business_id = message_outbox.business_id)));

-- M3-2 + M3-6 fix: UPDATE policy dropped entirely â€” no client flow UPDATEs
-- outbox rows (cancel = DELETE-own below; retry = meta-send re-invoke; status
-- transitions are service-role only). A mutable UPDATE policy let any
-- send-permission member rewrite a colleague's queued content or forge
-- 'sent' ticks. Supabase RLS with no UPDATE policy = UPDATE denied to
-- clients; meta-send runs service-role and is unaffected.

DROP POLICY IF EXISTS "Agents cancel own outbox" ON public.message_outbox;
CREATE POLICY "Agents cancel own outbox" ON public.message_outbox FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id) AND created_by = auth.uid()));

-- HI-3: link rows must reference a conversation AND an order of the same business
DROP POLICY IF EXISTS "Agents link orders" ON public.conversation_orders;
CREATE POLICY "Agents link orders" ON public.conversation_orders FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role)
         OR (is_business_member(business_id)
             AND has_permission(auth.uid(),'orders.edit'::app_permission)
             AND EXISTS (SELECT 1 FROM public.conversations c
                         WHERE c.id = conversation_orders.conversation_id
                           AND c.business_id = conversation_orders.business_id)
             AND EXISTS (SELECT 1 FROM public.orders o
                         WHERE o.id = conversation_orders.order_id
                           AND o.business_id = conversation_orders.business_id)));

-- ---------------------------------------------------------------------------
-- Class B: management tables â€” inbox.manage
-- v5 CHANGE: message_templates joins the DO-block array (managers create/edit
-- template drafts; PENDING/APPROVED status transitions are written by the
-- webhook's service role, which bypasses RLS).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'channel_accounts','automation_rules','saved_messages','quick_replies',
    'message_templates'
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
-- Class C: bulk messaging â€” inbox.bulk_send
-- (unchanged from v4; WhatsApp template campaigns add no new policy surface â€”
--  the template_id FK is validated at send time, Â§5.2 check 3d)
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
-- service-role only (meta-bulk-send) â€” deliberately NO write policy here.

-- ---------------------------------------------------------------------------
-- Class D: CRM â€” customers.edit
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

Edge functions use the service role key (bypasses RLS) and validate `business_id` scope manually in code â€” unchanged from codebase convention, now backed by the `meta-send` re-assert (Â§5.1).

**Enforcement summary:** a `viewer`-role user (or any member without `inbox.send_messages`) can read conversations but cannot send, tag, assign, or enqueue; a member WITH send permission cannot reference another business's conversation, channel, or order from their inserts (HI-3); no authenticated client can forge system/bot-authored rows (ME-5). All enforced at the database, not just in UI filters. **All four platforms are covered by the same policy set** â€” there is no per-platform RLS.

### 2.4 Indexes for Scale

At 100-500 convos/day across four platforms, after 1 year: ~100-200K conversations, millions of messages. Beyond Â§2.2's indexes:

```sql
-- Covering index for the conversation list query (most common query)
CREATE INDEX idx_conversations_list_covering ON public.conversations(
  business_id, status, last_message_at DESC
) INCLUDE (id, platform, customer_id, assigned_agent_id, unread_count);

-- FTS on text content ONLY (L3 â€” content holds JSON for structured types)
CREATE INDEX idx_messages_fts ON public.messages
  USING GIN (to_tsvector('english', content)) WHERE content_type = 'text';
```

Keyset pagination on `(business_id, last_message_at DESC, id DESC)` uses `idx_conversations_last_message` â€” see Â§3.3 (LO-7 tuple keyset). Monthly partitioning of `messages` is deferred: Phase 8 ships a 12-month cold archive table (Â§17.5) â€” simpler and reversible.

### 2.5 Database Triggers and Functions

#### 2.5.1 New-message conversation maintenance (ME-4 GREATEST guards + ME-11 exclusion + L4)

**Unchanged from v4 â€” platform-agnostic by construction** (it reads `direction`/`content_type`/`metadata`, never `platform`):

```sql
CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations SET
    -- ME-4: monotonic (NULL-safe â€” GREATEST ignores NULLs). A delayed platform
    -- retry carrying an OLDER timestamp can no longer rewind the window or
    -- the last_message_at ordering.
    last_message_at = GREATEST(last_message_at, NEW.created_at),
    last_customer_message_at = CASE WHEN NEW.direction = 'inbound'
                                    THEN GREATEST(last_customer_message_at, NEW.created_at)
                                    ELSE last_customer_message_at END,
    last_agent_message_at = CASE WHEN NEW.direction = 'outbound'
                                 THEN GREATEST(last_agent_message_at, NEW.created_at)
                                 ELSE last_agent_message_at END,
    -- ME-11: only genuine 1:1 agent responses count as first responses.
    -- Excludes: internal notes (content_type), bot/system rows, and
    -- campaign-originated rows (metadata.campaign_id stamped by meta-bulk-send).
    first_agent_response_at = COALESCE(
      first_agent_response_at,
      CASE WHEN NEW.direction = 'outbound'
                AND NEW.sender_type = 'agent'
                AND NEW.content_type <> 'internal_note'
                AND (NEW.metadata->>'campaign_id') IS NULL
                AND last_customer_message_at IS NOT NULL
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

#### 2.5.2 Mark conversation read (H8 â€” ownership check inside the SECURITY DEFINER body)

Shared-inbox semantics: any member viewing the conversation resets the shared unread counter. The function authenticates the caller itself:

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
  -- Ownership assertion â€” without this, any authenticated user could reset
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

#### 2.5.3 "Has ordered" auto-indicator (M12)

Two triggers cover every path by which an order becomes attributable to a business. Both key off `orders.business_id` (added by Â§2.5.4 â€” ME-9). **Unchanged from v4; platform-agnostic** (an order from a WhatsApp or TikTok chat links through the same `conversation_orders` path):

```sql
-- (a) Any order insert with a resolved business
CREATE OR REPLACE FUNCTION public.tag_customer_has_ordered_from_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_id IS NULL OR NEW.business_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.customer_tags (business_id, customer_id, tag)
  VALUES (NEW.business_id, NEW.customer_id, 'has_ordered')
  ON CONFLICT (business_id, customer_id, tag) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_orders_has_ordered AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tag_customer_has_ordered_from_order();

-- (b) Order linked to a conversation: tag under the conversation's business
-- (covers orders whose business could not be resolved at insert time)
CREATE OR REPLACE FUNCTION public.tag_customer_has_ordered_from_link()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  -- M3-3 fix: backfill the order's business_id from the conversation at link
  -- time â€” the single authority for inbox-created orders (HI-B3). Runs before
  -- the tag insert so the tag is always keyed on a scoped order chain.
  UPDATE public.orders o
     SET business_id = c.business_id
    FROM public.conversations c
   WHERE c.id = NEW.conversation_id
     AND o.id = NEW.order_id
     AND o.business_id IS NULL;

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

Surfacing: a `has_ordered` badge on `ConversationItem` and `CustomerProfileCard` reads `EXISTS (SELECT 1 FROM customer_tags WHERE business_id = ? AND customer_id = ? AND tag = 'has_ordered')` â€” a real persisted indicator, not a display-time proxy.

#### 2.5.4 `orders.business_id` resolution (ME-9 â€” unchanged from v4)

**Verified gap:** `orders` has no `business_id`; business scope is only reachable via `store_id â†’ selling_points.woo_store_id` (Woo channels only), and `selling_points` has **no UNIQUE on `(type, woo_store_id)`**. Orders with `store_id IS NULL` (inbox-created, POS walk-ins) have no resolution path at all.

**Fix (additive-only, permitted by Â§17.3):** a nullable `business_id` column + a BEFORE INSERT trigger that resolves it from the row's own selling-point linkage + a one-time backfill:

```sql
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS business_id uuid
  REFERENCES public.businesses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_business_customer
  ON public.orders (business_id, customer_id) WHERE business_id IS NOT NULL;

-- BEFORE INSERT resolution: prefer the order's explicit selling point; fall
-- back to store_id -> selling_points. selling_point_id is UNIQUE-anchored
-- (PK) so it cannot be ambiguous; the store_id fallback picks the OLDEST
-- matching selling_point (deterministic) and logs nothing â€” the documented
-- ambiguity data-quality follow-up (Phase 8) surfaces such rows instead.
CREATE OR REPLACE FUNCTION public.resolve_order_business()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_business_id uuid;
BEGIN
  IF NEW.business_id IS NOT NULL THEN RETURN NEW; END IF;   -- caller already scoped it

  IF NEW.selling_point_id IS NOT NULL THEN
    SELECT sp.business_id INTO v_business_id
      FROM public.selling_points sp WHERE sp.id = NEW.selling_point_id;
  ELSIF NEW.store_id IS NOT NULL THEN
    SELECT sp.business_id INTO v_business_id
      FROM public.selling_points sp
     WHERE sp.woo_store_id = NEW.store_id
     ORDER BY sp.created_at ASC
     LIMIT 1;   -- deterministic pick; ambiguity documented (no UNIQUE on (type, woo_store_id) â€” verified)
  END IF;

  NEW.business_id := v_business_id;   -- stays NULL for unresolvable storefront/POS orders
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_resolve_order_business BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.resolve_order_business();

-- One-time business_id backfill (M3-4 companion; NEW-4 fix â€” concrete SQL):
DO $$
DECLARE
  v_rows int := 1;
BEGIN
  WHILE v_rows > 0 LOOP
    WITH resolved AS (
      SELECT o.id, sp.business_id
        FROM public.orders o
        LEFT JOIN LATERAL (
          SELECT sp.business_id
            FROM public.selling_points sp
           WHERE (o.selling_point_id IS NOT NULL AND sp.id = o.selling_point_id)
             OR (o.selling_point_id IS NULL AND o.store_id IS NOT NULL
                 AND sp.woo_store_id = o.store_id)
           ORDER BY sp.created_at ASC
           LIMIT 1
        ) sp ON true
       WHERE o.business_id IS NULL AND sp.business_id IS NOT NULL
       LIMIT 10000
       FOR UPDATE
    )
    UPDATE public.orders o
       SET business_id = r.business_id
      FROM resolved r
     WHERE o.id = r.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  END LOOP;
END $$;

-- One-time has_ordered tag backfill (M3-4):
INSERT INTO public.customer_tags (business_id, customer_id, tag, created_by)
SELECT DISTINCT o.business_id, o.customer_id, 'has_ordered', NULL
  FROM public.orders o
 WHERE o.business_id IS NOT NULL
   AND o.customer_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.customer_tags t
                   WHERE t.business_id = o.business_id
                     AND t.customer_id = o.customer_id
                     AND t.tag = 'has_ordered')
ON CONFLICT DO NOTHING;
```

**Scope statement:** audience-builder `min_orders` / LTV / `has_ordered` aggregations (Â§10.1, Â§7.4) count **only** orders with non-NULL `business_id`. Storefront/POS orders that never resolve are **explicitly out of scope for inbox audience analytics** until they gain linkage. This applies uniformly across all four platforms â€” an inbox-created order from any platform is scoped at the link step (below).

**HI-B3 fix â€” canonical path for inbox-created orders (all platforms):** the dialog's `orders` insert does NOT know the business (verified Â§6.1). The link path is the single authority:

1. `OrderLinker` receives `onCreated({orderId, orderNumber, customerId})` (Â§6.1 Modification 1).
2. `OrderLinker` immediately: `UPDATE orders SET business_id = <conversation.business_id> WHERE id = :orderId AND business_id IS NULL`, THEN inserts the `conversation_orders` link row.
3. Trigger (b) ALSO backfills defensively â€” so even a missed OrderLinker step cannot leave an inbox order unscoped (M3-3 fix).

#### 2.5.5 Sender assertion trigger + sanctioned system-message RPC (ME-5 â€” unchanged from v4)

```sql
-- Any authenticated client inserting into messages must be an agent sending as
-- itself (policy Â§2.3 already requires it; this trigger re-asserts at the DB
-- layer so a policy regression cannot silently reopen spoofing). Service-role
-- inserts (webhook, sweep, meta-send) run with auth.uid() NULL and pass.
CREATE OR REPLACE FUNCTION public.assert_message_sender()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Sanctioned system messages from the SECURITY DEFINER RPC: the RPC sets a
  -- trusted transaction-local GUC before inserting; direct client inserts
  -- cannot set it (only the RPC body does, via set_config).
  IF NEW.sender_type = 'system'
     AND current_setting('app.sanctioned_system_message', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL THEN
    IF NEW.sender_type <> 'agent' OR NEW.sender_agent_id IS NULL
       OR NEW.sender_agent_id <> auth.uid() THEN
      RAISE EXCEPTION 'client inserts must be sender_type=''agent'' with sender_agent_id = auth.uid()';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_assert_message_sender BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.assert_message_sender();

-- Sanctioned client-originated system events (order-created notes, transfer
-- notes) go through this RPC instead of raw inserts:
CREATE OR REPLACE FUNCTION public.post_system_message(
  p_conversation_id uuid,
  p_business_id     uuid,
  p_content_type    public.message_content_type,
  p_content         text,
  p_metadata        jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id   uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authenticated callers only';
  END IF;
  -- Ownership assertion (SECURITY DEFINER bypasses RLS â€” H8 pattern)
  IF NOT (public.has_role(v_user, 'admin'::app_role)
          OR public.is_business_member(p_business_id)) THEN
    RAISE EXCEPTION 'forbidden: not a member of this business';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversations c
                 WHERE c.id = p_conversation_id
                   AND c.business_id = p_business_id) THEN
    RAISE EXCEPTION 'conversation does not belong to this business';
  END IF;
  -- Mark this transaction as a sanctioned system-message source so the
  -- assert_message_sender trigger lets sender_type='system' rows through from
  -- this RPC only. Transaction-local: reverts on commit/rollback.
  PERFORM set_config('app.sanctioned_system_message', '1', true);
  INSERT INTO public.messages
    (business_id, conversation_id, direction, sender_type, sender_agent_id,
     content_type, content, metadata)
  VALUES
    (p_business_id, p_conversation_id, 'outbound', 'system', v_user,
     p_content_type, p_content, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_system_message(uuid, uuid, public.message_content_type, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_system_message(uuid, uuid, public.message_content_type, text, jsonb) TO authenticated;
```

#### 2.5.6 Opt-in config sanity trigger (HI-1 â€” unchanged from v4)

```sql
-- saved_messages: optin_config required for opt-in categories, forbidden otherwise;
-- optin_prompt config must carry a taxonomy topic + frequency; one_time must not.
CREATE OR REPLACE FUNCTION public.assert_saved_message_optin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category IN ('optin_prompt','optin_one_time') THEN
    IF NEW.optin_config IS NULL THEN
      RAISE EXCEPTION 'opt-in categories require optin_config (template payload â€” HI-1)';
    END IF;
    IF NEW.category = 'optin_prompt'
       AND (NEW.optin_config->>'topic' IS NULL
            OR NEW.optin_config->>'frequency' IS NULL) THEN
      RAISE EXCEPTION 'optin_prompt requires {topic (taxonomy value), frequency}';
    END IF;
  ELSIF NEW.optin_config IS NOT NULL THEN
    RAISE EXCEPTION 'optin_config is only valid for opt-in categories';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_saved_message_optin BEFORE INSERT OR UPDATE ON public.saved_messages
  FOR EACH ROW EXECUTE FUNCTION public.assert_saved_message_optin();

-- notification_subscriptions: topic required for recurring, NULL for one_time
CREATE OR REPLACE FUNCTION public.assert_subscription_topic()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subscription_type = 'recurring' AND NEW.topic IS NULL THEN
    RAISE EXCEPTION 'recurring subscriptions require a taxonomy topic';
  END IF;
  IF NEW.subscription_type = 'one_time' AND NEW.topic IS NOT NULL THEN
    RAISE EXCEPTION 'one_time subscriptions carry no topic';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_subscription_topic BEFORE INSERT ON public.notification_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.assert_subscription_topic();
```

### 2.6 Storage Bucket and Policies (M6 + H3 + ME-6 + ME-7 â€” unchanged from v4)

Migration `supabase/migrations/202609XX04_omni_inbox_storage.sql`. **Serves all four platforms** â€” WhatsApp media (`GET /{media_id}` â†’ expiring URL â†’ Storage) lands in the same bucket via the same sweep path as Meta CDN URLs.

```sql
-- Private bucket; objects addressed {business_id}/{conversation_id}/{filename}
-- Avatars (service-role only): {business_id}/avatars/{platform_recipient_id}.{ext}
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('inbox-attachments', 'inbox-attachments', false, 26214400)  -- 25MB
ON CONFLICT (id) DO NOTHING;

-- ============================================================================--
-- ME-7 note: storage.foldername() is used nowhere in this repo (verified) â€”
-- these policies are NEW territory. The uuid-regex guard prevents malformed
-- folder names from crashing the ::uuid cast; each evaluation is O(1) on the
-- user_business_access unique index; volumes: <=50 evaluations per gallery
-- page. Smoke-tested in the Phase 2 checklist.
-- ============================================================================

-- Read: members of the business named in the first path segment.
CREATE POLICY "Members read inbox attachments" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'inbox-attachments'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (
      has_role(auth.uid(),'admin'::app_role)
      OR is_business_member((storage.foldername(name))[1]::uuid)
    )
  );

-- ME-6: upload constrained to {business_id}/{conversation_id}/{filename} â€”
-- the SECOND segment must be a conversation of the SAME business (the EXISTS
-- subquery rides conversations RLS, which double-checks tenant scoping).
-- Avatar paths fail the second-segment check by design (avatars upload via
-- the service role only).
CREATE POLICY "Agents upload inbox attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inbox-attachments'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND has_permission(auth.uid(),'inbox.send_messages'::app_permission)
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = (storage.foldername(name))[2]::uuid
        AND c.business_id::text = (storage.foldername(name))[1]
    )
  );

-- ME-6 explicit statement: there is NO storage-layer mime/extension
-- enforcement â€” the type allowlist and extension check are CLIENT-SIDE ONLY
-- (composer pre-upload validation, Â§5.5). The bucket's 25MB file_size_limit is
-- the only storage-layer gate. Acceptable because upload is already
-- permission-gated and member-scoped; noted for reviewers.

-- Service role writes (webhook-time attachment persistence, avatars) bypass RLS by design.
```

Customers never access this bucket directly; the UI renders via short-lived signed URLs. Outbound attachment sending re-uploads from Storage to the platform (temporary signed URL with a short TTL at send time, or platform attachment-id reuse â€” Â§5.5).

### 2.7 Realtime Publication (Phase 1 migration â€” unchanged from v4)

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_outbox;

ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_outbox REPLICA IDENTITY FULL;
```

(Follows the verified precedent of `20260903000500_enable_realtime.sql`. `REPLICA IDENTITY FULL` is required for RLS-filtered `postgres_changes` to deliver row payloads on UPDATE events â€” mandatory because the outbox UPDATE events carry the send-status transitions, ME-2.)

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

#### 3.1.1 Mobile / Responsive Strategy (M10)

| Breakpoint | Layout |
|---|---|
| `< md (768px)` | Single panel. Conversation list full-screen; tapping a conversation pushes the `MessageThread` (master-detail navigation with a back button). ContextSidebar accessible via a bottom-sheet drawer (`vaul` â€” verified in dependencies). |
| `md â€“ lg` | Two panels: list (collapsible) + thread; ContextSidebar behind a `Sheet`/drawer toggled from the thread header. |
| `>= lg` | Full three-panel resizable layout (Â§3.1). |

State: a `useMediaQuery` hook drives panel-mode switching; selection state persists so resizing doesn't lose the open conversation.

### 3.2 Component Architecture (v5 â€” platform-aware additions)

| Component | File | Purpose | Reuses Existing |
|-----------|------|---------|-----------------|
| `OmniInbox` | `src/components/inbox/OmniInbox.tsx` | Page container, responsive panel switching, route params | - |
| `ConversationList` | `src/components/inbox/ConversationList.tsx` | Filterable list, tabs (Open, Assigned, Unassigned, Closed), **platform filter chips**, keyset pagination, search | `OrderFilters` pattern |
| `ConversationItem` | `src/components/inbox/ConversationItem.tsx` | Row: **platform badge (Â§3.2.1)**, avatar, name, preview, time, unread badge, tags, priority, `has_ordered` badge | `OrderCard` pattern |
| `MessageThread` | `src/components/inbox/MessageThread.tsx` | Virtualized message list (`@tanstack/react-virtual`) | new dep (M1) |
| `MessageBubble` | `src/components/inbox/MessageBubble.tsx` | Renders by `content_type` incl. **interactive/location/sticker/template**; delivery ticks for outbound | - |
| `ComposerBar` | `src/components/inbox/ComposerBar.tsx` | Text input, attachment upload, send, saved-message picker, tag-picker, **WhatsApp template picker (outside window)**, **TikTok reply-only notice**, opt-out banner | `Textarea` |
| `ContextSidebar` | `src/components/inbox/ContextSidebar.tsx` | Tabs (Customer, Orders, Products, Notes) | `Tabs` |
| `CustomerProfileCard` | `src/components/inbox/CustomerProfileCard.tsx` | Name, phone, tags, `has_ordered` badge, order count, LTV | - |
| `ProductQuickSend` | `src/components/inbox/ProductQuickSend.tsx` | Search products, send as rich card (FB/IG generic template; WhatsApp product/image message) | **`MiniProductCatalog`** |
| `InvoiceQuickSend` | `src/components/inbox/InvoiceQuickSend.tsx` | Render `invoiceHtml.ts` in a hidden DOM node â†’ `html-to-image` â†’ PNG â†’ Storage â†’ image attachment | **`invoiceHtml.ts`** + new dep `html-to-image` |
| `CourierQuickSend` | `src/components/inbox/CourierQuickSend.tsx` | Format & send tracking info | `CourierDispatchStation` logic |
| `OrderLinker` | `src/components/inbox/OrderLinker.tsx` | Link existing or create new order (Â§6.1) | **`AddOrderDialog` (modified â€” Â§6.1)** |
| `TagManager` | `src/components/inbox/TagManager.tsx` | Add/remove customer tags | `Badge` |
| `QuickReplyPicker` | `src/components/inbox/QuickReplyPicker.tsx` | Slash-command or button insert | `Command` |
| `SavedMessagePicker` | `src/components/inbox/SavedMessagePicker.tsx` | Pick saved draft, fill variables | `ResponsiveDialog`, `SearchableSelect` |
| `OptInPromptCard` | `src/components/inbox/OptInPromptCard.tsx` | Sends the structured `notification_messages` opt-in template (FB/IG only â€” Â§10.2) | - |
| `CampaignBuilder` | `src/components/inbox/CampaignBuilder.tsx` | Audience builder + scheduling; **per-platform path selector** (FB/IG topic; WhatsApp approved template; TikTok disabled w/ explanation) | - |
| `TemplateManager` | **v5 NEW** `src/components/inbox/TemplateManager.tsx` | WhatsApp template composer + status table (PENDING/APPROVED/REJECTED + rejection reason); lives in `InboxSettings` | `DataTable` pattern |
| `PlatformBadge` | **v5 NEW** `src/components/inbox/PlatformBadge.tsx` | Icon + label per `channel_platform`; used in list items, thread header, sidebar | `Badge` |
| `AssignmentDropdown` | `src/components/inbox/AssignmentDropdown.tsx` | Assign/reassign agent | `SearchableSelect` |
| `ConversationSearch` | `src/components/inbox/ConversationSearch.tsx` | Full-text search over message content (M11) | `Command` |
| `BulkActionBar` | `src/components/inbox/BulkActionBar.tsx` | Multi-select actions | `OrderBulkActionsBar` pattern |
| `WindowBanner` | shared hook/component | **Platform-aware** window countdown (24h / 48h TikTok / 7d HUMAN_AGENT); composer state depends on it | - |

#### 3.2.1 Platform badges (v5 NEW)

`PlatformBadge({ platform, size })` renders a brand-colored icon + accessible label (`Facebook`, `Instagram`, `WhatsApp`, `TikTok`). Icons: `lucide-react` has no brand glyphs by policy â€” use inline SVG paths in a small `src/components/inbox/platformIcons.tsx` map (no new dependency). Non-color signaling: each badge pairs the icon with a text label (a11y contract Â§3.6.1). Badges appear in `ConversationItem`, `MessageThread` header, and `ContextSidebar` > Customer (showing all of that customer's active conversations across platforms in the same business).

### 3.3 State Management

TanStack Query (verified in deps) for all data fetching:

```typescript
// hooks/useConversations.ts â€” tuple keyset pagination (M11 + LO-7: last_message_at
// alone skips same-timestamp rows; the tuple (last_message_at, id) is the cursor)
// v5: platform filter is a plain .in() on the platform enum column
export function useConversations(filters: ConversationFilters) {
  return useInfiniteQuery({
    queryKey: ['conversations', filters],
    queryFn: ({ pageParam }) => {
      const q = supabase
        .from('conversations')
        .select('id, platform, platform_recipient_id, customer:customers(name), last_message_at, unread_count, status, tags, assigned_agent_id')
        .eq('business_id', filters.businessId)
        .order('last_message_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50);
      if (filters.platforms?.length) q.in('platform', filters.platforms);
      if (pageParam) {
        // compound keyset: (last_message_at, id) strictly less than the cursor
        const { t, id } = pageParam;
        q.or(`last_message_at.lt.${t},and(last_message_at.eq.${t},id.lt.${id})`);
      }
      return q;
    },
    getNextPageParam: (last) => last.at(-1)
      ? { t: last.at(-1)!.last_message_at, id: last.at(-1)!.id }
      : undefined,
  });
}

// Tag filter (LO-8 + ME-B2): conversation tags are written by the
// conversation-level TagManager action; the list filter reads CUSTOMER tags
// via a join, not conversations.tags:
//   customer-tag filter: fetch conversation ids of business customers tagged X
//   (customer_tags) then .in('id', ids) â€” the taxonomy agents actually manage
// ConversationItem renders customer tags (from customer_tags via customer_id),
// keeping ONE tag taxonomy (customer-scoped) in the UI.

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

// Outbox status (ME-2): TWO postgres_changes handlers on ONE channel â€” INSERT
// gives the immediate 'pending' echo (gray bubble); UPDATE carries the
// sending -> sent/failed/blocked_window/cancelled transitions (the ONLY
// realtime signal for failed sends, which never produce a messages row).
export function useOutboxStatus(conversationId: string, onRow: (row: OutboxRow) => void) {
  useEffect(() => {
    const channel = supabase.channel(`outbox:${conversationId}`);
    for (const event of ['INSERT', 'UPDATE'] as const) {
      channel.on('postgres_changes',
        { event, schema: 'public', table: 'message_outbox', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          // render only on actual status transitions to bound churn
          if (event === 'INSERT' || payload.new.status !== payload.old?.status) onRow(payload.new);
        });
    }
    channel.subscribe();
    return () => supabase.removeChannel(channel);
  }, [conversationId]);
}

// LO-13: optimistic concurrency on conversation mutations â€” every client-side
// UPDATE (assign/transfer/snooze/status) carries the stale-check; zero rows
// returned means a concurrent edit won.
export async function updateConversation(expectedUpdatedAt: string, patch: ConversationPatch) {
  const { data, error } = await supabase
    .from('conversations')
    .update(patch)
    .eq('updated_at', expectedUpdatedAt)
    .select();
  if (!data || data.length === 0) throw new ConflictError('conversation changed by another agent â€” refetching');
  return data[0];
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

### 3.6 UX States (M11 + ME-2 + v5 platform states)

- **Empty states**: no conversations ("Connect a Facebook Page, Instagram account, WhatsApp number, or TikTok account to start messaging" + CTA to settings); no conversation selected; empty thread; no search results.
- **Loading**: skeleton rows for the list; skeleton bubbles on initial thread load.
- **Send-failure affordance (ME-2)**: outbox INSERT renders the optimistic `pending` bubble; the outbox UPDATE event flips it `sending â†’ sent` or to a failure chip. `failed` shows Retry (re-invokes `meta-send` on the same row if retry_count < 5) â€” **EXCEPT `error_code='timeout_unknown'`**, which shows "possibly sent â€” verify in thread" and refuses auto-retry (LO-6); `blocked_window` shows the window-expiry countdown instead of Retry. **v5 additions:** `tiktok_window_closed` shows the 48h countdown + explanation; `template_not_approved` shows "template is pending Meta approval" with a link to the template table.
- **Platform-specific composer states (v5 NEW)** â€” the composer reads `conversation.platform` + window status and adapts:

  | State | FB/IG | WhatsApp | TikTok |
  |---|---|---|---|
  | In window | Freeform enabled | Freeform + interactive buttons/lists enabled | Freeform enabled |
  | Out of window | Tag selector (HUMAN_AGENT 7d if approved) + saved opt-in prompts | **Template picker** (APPROVED templates only; freeform disabled) | **Reply-only notice**: "TikTok allows replies within 48h of the customer's message" + composer disabled |
  | Opted out | Banner + freeform disabled (transactional tags excepted) | Same | Same |

- **Optimistic send**: bubble appears immediately as `sending`; the `messages` INSERT event renders the durable bubble; delivery ticks update via the 30-seconds-while-open status refetch (Â§1.4).
- **Opt-out banner (ME-13)**: if the customer has an active opt-out row, the composer shows a persistent banner and disables freeform send except `ACCOUNT_UPDATE`/`POST_PURCHASE` tags.

### 3.6.1 Accessibility contract (ME-B6)

For a surface agents live in all day, these are build requirements, not polish:

- **Live region**: the `MessageThread` appends incoming messages into a `role="log"` / `aria-live="polite"` region so screen readers announce arrivals without stealing focus.
- **Focus management**: master-detail push navigation moves focus into the opened thread; back-navigation restores focus to the originating conversation row.
- **Composer labeling**: `ComposerBar` input has a visible label; send button has an accessible name; attachment buttons announce file dialogs.
- **Keyboard**: full list navigation via â†‘/â†“ + Enter; visible focus rings on all interactive elements (no `outline: none` without replacement).
- **Non-color signaling**: platform badges, priority/status/unread indicators pair color with icon/text (color-blind safe); delivery ticks have text alternatives (`aria-label`).
- **Reduced motion**: `prefers-reduced-motion` disables smooth-scroll on thread jumps and panel transitions.

### 3.7 Pagination and Search (M11 + LO-12)

- **Conversation list**: tuple keyset pagination on `(business_id, last_message_at DESC, id DESC)` with infinite scroll (Â§3.3), capped server-side at 50 rows/page. Never unbounded `select()`.
- **Thread**: load latest 50 messages, paginate backwards on scroll-top â€” **tuple keyset `(created_at, id)`** (LO-B3: `created_at` alone skips same-timestamp rows â€” bulk/campaign inserts share timestamps): `WHERE (created_at, id) < (:oldest_created_at, :oldest_id) ORDER BY created_at DESC, id DESC LIMIT 50`.
- **Search (LO-12)**: `ConversationSearch` uses a `messages` full-text RPC that **caps at 50 conversations** (LIMIT inside the CTE, before `ts_headline` runs) so headline generation never expands over a large set. **Platform-agnostic** â€” search spans all four platforms' messages:

```sql
-- M3-5/ME-B4 fix: spans BOTH the hot table and the archive (UNION before
-- ranking; the 2000-row ceiling is the COMBINED scan cap, 50-conversation
-- result cap is shared â€” archive rows compete with hot rows on recency).
CREATE OR REPLACE FUNCTION public.search_conversations(
  p_business_id uuid, p_query text
)
RETURNS TABLE (conversation_id uuid, snippet text, last_message_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH hot AS (
    SELECT m.conversation_id, m.content, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.business_id = p_business_id
      AND m.content_type = 'text'
      AND to_tsvector('english', m.content) @@ websearch_to_tsquery('english', p_query)
  ), archived AS (
    SELECT a.conversation_id, a.content, a.created_at
    FROM public.messages_archive a
    WHERE a.business_id = p_business_id
      AND a.content_type = 'text'
      AND to_tsvector('english', a.content) @@ websearch_to_tsquery('english', p_query)
  ), pool AS (
    SELECT * FROM hot
    UNION ALL
    SELECT * FROM archived
    LIMIT 2000            -- hard scan ceiling across both tables
  ), matches AS (
    SELECT conversation_id, content, created_at,
           rank() OVER (PARTITION BY conversation_id
                        ORDER BY ts_rank_cd(to_tsvector('english', content),
                                            websearch_to_tsquery('english', p_query)) DESC,
                                    created_at DESC) AS r
    FROM pool
  )
  SELECT conversation_id,
         ts_headline('english', content, websearch_to_tsquery('english', p_query)),
         max(created_at)
  FROM matches
  WHERE r = 1
  GROUP BY conversation_id, content
  ORDER BY max(created_at) DESC
  LIMIT 50;              -- LO-12 result cap
$$;
-- (RLS applies to all three tables under SECURITY INVOKER; the authenticated
-- caller only sees their business's conversations and archived messages.)
```

Clicking a result opens the conversation and scrolls to the message.

---

## 4. Webhooks: Verification and Event Processing

### 4.1 Platform App Setup (v5 â€” three access tracks, all started in Phase 0)

**Track A â€” Meta app (FB + IG):**

1. Create a Meta Business App at developers.facebook.com
2. Add products: **Messenger** (Facebook) and **Instagram** (for IG DMs, configured via the IG professional account)
3. Configure webhook URL: `https://<project-ref>.supabase.co/functions/v1/meta-webhook`
4. Subscribe to events: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`, `messaging_optins` (RN/OTN acceptance â€” HI-1), `messaging_handovers` (pass-thread control)
5. Request permissions: `pages_messaging`, `pages_show_list`, `instagram_basic`, `instagram_manage_messages` + Advanced Access; **include the message-tag (HUMAN_AGENT), `notification_messages` (RN), and `one_time_notif` (OTN) usages in the same App Review submission** (ME-8)

**Track B â€” WhatsApp Business Cloud (FACT â€” separate from Track A):**

1. Meta Business Account + **WhatsApp Business Account (WABA)** + phone number + **business verification** â€” a separate verification from the FB/IG app review; can proceed independently and ship first
2. Subscribe the WABA to the **same `meta-webhook` endpoint** (the Meta webhook machinery is shared: GET `hub.challenge` verification + `X-Hub-Signature-256` HMAC with the app secret **FACT**); the payload object field is `whatsapp_business_account`
3. Subscribe to fields: `messages` (inbound `messages[]` + `statuses[]`) and `message_template_status_update`
4. Create a **permanent system-user token** for the WABA (no page-token expiry problem **FACT**); store encrypted on the `channel_accounts` row

**Track C â€” TikTok Business Messaging (SPIKE-GATED):**

1. TikTok for Business + developer app + **Business Messaging API access â€” APPROVAL REQUIRED (invite/review-based)**. Apply in Phase 0; **may take weeks or be denied**.
2. Configure webhook URL `https://<project-ref>.supabase.co/functions/v1/tiktok-webhook` + verification challenge **[VERIFY IN PHASE 0 SPIKE: exact handshake]**
3. Set `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` in edge secrets (app-level, not per-row)
4. Complete the OAuth flow to obtain `access_token` (~24h) + `refresh_token` (~1 year) per business â€” stored encrypted with expiry columns (Â§2.2.1)

**Shared edge secrets (all tracks):** `META_APP_SECRET`, `META_APP_ID`, `META_GRAPH_VERSION` (Â§5.0 â€” serves the Meta family AND the WhatsApp Cloud API, same graph host), `META_CRON_TOKEN` (vault-held, Â§5.6), `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.

### 4.2 Webhook Verification â€” GET handler (lookup by token is the intended flow)

The Meta family shares one GET handler (same `hub.*` parameters for page/instagram/whatsapp_business_account objects **FACT**); TikTok has its own challenge handshake in `tiktok-webhook` **[VERIFY IN PHASE 0 SPIKE]**.

```typescript
// meta-webhook/index.ts â€” GET (subscription handshake; serves FB + IG + WhatsApp)
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

### 4.3 POST Handler â€” verify FIRST, then route by object (C3 + LO-1 + v5 router)

The signature is verified with the **app-level** secret from the edge environment, available before any DB lookup. Parsing the body before verifying is safe (the signature covers the raw body; parse-then-verify is the standard Meta pattern). **The Meta app secret verifies FB, IG, and WhatsApp payloads alike** â€” the divergence is only in payload shape, handled by the router below **FACT**.

```typescript
// meta-webhook/index.ts â€” POST
const rawBody = await req.text();
const signature = req.headers.get("x-hub-signature-256") || "";

// 1. VERIFY FIRST â€” app-level secret from edge env (no DB lookup needed).
//    Shared by FB / IG / WhatsApp (same Meta webhook machinery â€” FACT).
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

// 2. v5 PLATFORM ROUTER: parse, then dispatch by "object" field. Each branch
//    normalizes to the SAME internal event shape (InternalEvent) so downstream
//    processing (idempotency, conversation upsert, customer resolution, message
//    insert, automation) is platform-agnostic.
const payload = JSON.parse(rawBody);
type InternalEvent = {
  accountLookup: { column: "page_id" | "ig_account_id" | "phone_number_id"; value: string };
  platform: "facebook" | "instagram" | "whatsapp";
  messages: InboundMessage[];      // normalized: id, from, timestamp, type, content/attachments
  statuses?: WaStatus[];           // WhatsApp only: per-wamid delivery + errors
  templateStatuses?: TemplateStatus[];  // WhatsApp only: approval lifecycle
  optins?: Optin[];                // FB/IG RN/OTN
  deliveries?: Delivery[]; reads?: Read[];
};

if (payload.object === "page")              { /* FB: entry[].messaging[] â€” v4 path, unchanged */ }
else if (payload.object === "instagram")    { /* IG: entry[].messaging[] â€” v4 path, unchanged */ }
else if (payload.object === "whatsapp_business_account") {
  // FACT: entries are changes[].value with .messages[] / .statuses[] / template events.
  // entry.id = waba_id; lookup channel_accounts by (waba_id, phone_number_id) â€” the
  // phone_number_id comes from value.metadata.phone_number_id, NOT entry.id.
}
else { return jsonResp({ ok: true, skipped: "unknown object" }); }

// 3. THEN identify the channel account â€” LO-1: validate the ID is numeric
//    (a crafted id with commas/dots would break PostgREST filter syntax via
//    string interpolation), and use ONE typed query per platform instead of .or().
for (const entry of payload.entry ?? []) {
  // ... v4's numeric guard + per-platform typed lookup (now three columns:
  //     page_id | ig_account_id | phone_number_id), fail-closed if not found
}
```

**TikTok branch (`tiktok-webhook/index.ts`) â€” separate function, separate verifier:**

```typescript
// v5 NEW â€” signature scheme is NOT Meta's HMAC [VERIFY IN PHASE 0 SPIKE]:
// believed to be an HMAC-SHA256 signature header computed with the client
// secret over the raw body, plus a challenge handshake on GET. Verify mechanics
// in the Phase 0 spike BEFORE writing this function. Until the spike lands,
// tiktok-webhook exists only as a challenge-responder + event logger.
// 1. GET: respond to the verification challenge [VERIFY]
// 2. POST: verifySignature(rawBody, headers, TIKTOK_CLIENT_SECRET) [VERIFY]
// 3. Normalize to the SAME InternalEvent shape as the Meta router
// 4. Hand off to the shared event-processing pipeline (Â§4.4)
```

Notes:

- L1: the Meta HMAC pattern *adapts* woo-webhook's `crypto.subtle` usage; the **comparison encoding differs** (Woo compares base64 `btoa` â€” woo-webhook line 104; Meta uses `sha256=` + lowercase hex).
- If a business ever connects through a *different* Meta app (per-app secrets), handle it then â€” the single-app assumption is stated here, not silently implied by a wrong per-row column.
- **TikTok signature failure mode:** if the spike shows TikTok's scheme cannot be verified in an edge function (e.g., it requires a shared secret per-callback registration), TikTok falls back to inbound-read-only via a polling path, and the webhook function is retired â€” the fallback is documented in Â§14 Phase 6.

### 4.4 Event Processing Pipeline (per entry, per event â€” platform-agnostic after normalization)

1. Determine event type from the normalized `InternalEvent`: `message` / `postback` / `delivery` / `read` / `optin` / `pass_thread_control` / `wa_status` / `template_status`
2. `message` (inbound):
   a. **Idempotency**: check `messages.platform_message_id` (mid for FB/IG, wamid for WhatsApp, TikTok message id) â€” insert into `meta_webhook_events` for observability (Â§2.2.14)
   b. Upsert conversation by `(channel_account_id, platform_recipient_id)` â€” `from` (wa_id) for WhatsApp, `sender.id` for FB/IG, `open_id` for TikTok â€” ON CONFLICT update nothing
   c. Insert message with `platform_timestamp` as `created_at` basis (H9) and attachments carrying `meta_url` + `metadata.download_pending=true` â€” **no media fetch on the critical path** (ME-12; the sweep downloads). For WhatsApp, `type` maps to `content_type` (text/image/video/audio/document/sticker/location/interactive/contacts) **FACT**; button/list replies land as `content_type='interactive'` with the reply payload in `metadata->'interactive'`
   d. Resolve/create customer â€” **WhatsApp: phone-first (Â§7.1); FB/IG/TikTok: alias-first**
   e. Evaluate automation rules (Â§8, respecting `platform_scope`) â†’ insert outbox rows â†’ fire sweep (only if rows were inserted â€” ME-16)
3. `delivery` / `wa_status`: **FB/IG** â€” update outbound `delivery_status='delivered'` matched by mid (delivery events carry `mids[]`); **WhatsApp** â€” `statuses[]` are per-message **FACT**: each entry has the `id` (wamid) + `status` (sent/delivered/read/failed); update the single matching row by `platform_message_id`; `failed` records `errors` into `metadata->'errors'`
4. `read`: **FB/IG watermark semantics (HI-B4)** â€” `message_reads` payloads carry `{"read": {"watermark": <ms>}}` and **no mids array**; do NOT match by mid. Mark ALL outbound messages of the conversation with `created_at <= to_timestamp(watermark/1000)` as `delivery_status='read', customer_read_at = to_timestamp(watermark/1000) WHERE delivery_status IN ('sent','delivered')`. **WhatsApp needs no separate read handler** â€” reads arrive as `statuses[]` entries with `status='read'` per wamid **FACT**. Record the exact payload shapes in the Phase 0 spike.
5. `optin`: upsert `notification_subscriptions` row â€” RN acceptance carries token + topic + expiry **[VERIFY IN PHASE 0 SPIKE: exact `messaging_optins` payload for notification_messages vs one_time_notif]** (HI-1). **FB/IG only** â€” WhatsApp has no opt-in token mechanism.
6. `template_status` (WhatsApp only **FACT**): `message_template_status_update` â†’ update `message_templates.status` to APPROVED (set `platform_template_id`) or REJECTED (set `rejection_reason`). This is what makes a template usable in Â§5.2 check 3d and Â§10.3.
7. `pass_thread_control`: store in `conversations.metadata` (handover state â€” NOT account deletion, L6). FB only.

### 4.5 Service Windows (H9 + ME-8 + v5 platform awareness)

- `window_expires_at` is the platform-aware generated column (Â§2.2.2): **24h for FB/IG/WhatsApp, 48h for TikTok**. NULL `last_customer_message_at` = window closed.
- Window clock uses the platform's event `timestamp` (via `platform_timestamp` â†’ `created_at`), not processing time.
- **Freeform send allowed** iff `now() < window_expires_at` â€” for all platforms.
- **Out-of-window paths diverge by platform:**
  - **FB/IG**: `HUMAN_AGENT` tag extends a human-support conversation to 7 days â€” **requires Meta Advanced Access approval for the tag** (ME-8). Until approved, live-mode tagged sends fail with a permission error; dev-mode traffic works. The tag selector renders a disabled state with an explanation until approval lands. Other tags (`ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE`) serve their narrow permitted uses; UI labels each with its policy description.
  - **WhatsApp**: **approved template messages ONLY** outside the window **FACT**. The composer swaps freeform for the template picker (Â§3.6). Templates are per-account, status-gated (Â§2.2.16).
  - **TikTok**: **no out-of-window path in v1** â€” business-initiated messaging is heavily restricted and the window is believed 48h **[VERIFY IN PHASE 0 SPIKE]**. Outside the window the send matrix returns `blocked_window` + `error_code='tiktok_window_closed'` and the composer shows a reply-only notice.
- The `WindowBanner` shows the correct countdown per platform and drives the composer state machine.

### 4.6 Platform Differences â€” Reference Table

| Aspect | Facebook | Instagram | WhatsApp | TikTok |
|---|---|---|---|---|
| Sender ID | PSID (page-scoped) | IG scoped user ID | `wa_id` (E.164 phone) **FACT** | `open_id` (per-app) **[SPIKE]** |
| Send endpoint | `/v{X}/me/messages` | `/v{X}/{ig-id}/messages` | `POST /v{X}/{phone_number_id}/messages` with `{messaging_product:"whatsapp", to, type}` **FACT** | Business API endpoints w/ `access_token` **[SPIKE]** |
| Auth | Page access token | Page access token | **Bearer system-user token (permanent)** **FACT** | Bearer `access_token` (~24h, refreshed) |
| Rich/product cards | Generic template | Generic template (M7) | image/product message types | Product cards via TikTok Shop API â€” **separate, post-v1** |
| Media constraints | Broader | Some types unsupported; verify per type in Phase 0 | image/video/audio/document/sticker/location **FACT** | **[SPIKE]** |
| Service window | 24h | 24h | 24h **FACT** | 48h believed **[SPIKE]** |
| Out-of-window | Tags + RN/OTN | Tags (RN/OTN believed absent) | Approved templates **FACT** | Blocked in v1 |
| Delivery tracking | Watermark | Watermark | Per-message wamid **FACT** | **[SPIKE]** |
| Handover protocol | Supported | Not supported | n/a | **[SPIKE]** |

All platforms normalize behind `sendMessage(channelAccountId, payload)` in `supabase/functions/_shared/platforms/<platform>.ts` (Â§5.1).

### 4.7 `meta-connect-account` â€” Connect Flows (ME-14 + v5 two new paths)

**FB/IG path (v4, unchanged):** OAuth URL construction â†’ callback POSTs `{code, state}` â†’ short-livedâ†’long-lived exchange server-side â†’ page token derivation via `/me/accounts` â†’ page selection â†’ insert + `POST /{page-id}/subscribed_apps`. The app secret never crosses the browser; `state` is a signed HttpOnly cookie (LO-B8). Manual-paste fallback retained.

**WhatsApp path (v5 NEW):** WABA + phone number are connected by a manager entering the `waba_id`, `phone_number_id`, and the permanent system-user token into the settings UI (the embedded-signup flow is a future enhancement; manual entry is primary because a system-user token is created in the Meta Business Manager, not via browser OAuth). `meta-connect-account` (JWT + `inbox.manage`):

1. Validate the token by calling `GET /{phone_number_id}?fields=id,display_phone_number` with `Authorization: Bearer <token>` â€” a 401 refuses with "invalid system-user token"
2. Insert the `channel_accounts` row (`platform='whatsapp'`, waba_id, phone_number_id, plaintext token â€” the Â§13.1 trigger encrypts; `whatsapp_tier` seeded from the WABA's verified tier lookup, default `'250'`)
3. Subscribe the WABA's app to webhook fields (`messages`, `message_template_status_update`) via the Graph API
4. Seed `rate_limit_buckets` daily_capacity from the tier (the Â§5.3 trigger does this, but the connect path re-seeds if the tier was corrected)

**TikTok path (v5 NEW, SPIKE-GATED):** standard OAuth 2.0 â€” `client_key`/`client_secret` from edge env, authorization code exchange, store encrypted `access_token` + `refresh_token` + `token_expires_at` + `refresh_token_expires_at`. The daily `tiktok-token-refresh` cron (Â§5.4) keeps it alive; the on-401 refresh inside the TikTok adapter covers drift. **[VERIFY IN PHASE 0 SPIKE: exact endpoint + scope strings]**

**Error surfaces (all paths):** `code != state` â†’ 403 CSRF refusal; exchange failure â†’ 400 with the platform's error summary; missing permissions â†’ "re-connect with the required permissions" prompt.

### 4.8 Attachment persistence (H3 + ME-12 â€” all platforms)

At webhook time: **no downloads**. The message inserts immediately with `attachments: [{meta_url, type, ...}]` and `metadata.download_pending=true`. The sweep's download task (Â§5.5) then fetches each URL and uploads to Storage: `inbox-attachments/{business_id}/{conversation_id}/{platform_message_id}-{n}.{ext}`, filling `storage_path` and clearing the flag. Only the message insert is on the webhook's 20-second critical path (Â§16.1).

**WhatsApp specifics (FACT):** media is fetched in two hops â€” `GET /{media_id}` returns a JSON body with a URL that **expires ~5 minutes**, then the file is fetched with `Authorization: Bearer <token>`. The sweep performs both hops; the webhook stores only the `media_id` in `meta_url`. Avatars: same treatment â€” profile URLs are expiring; the sweep persists to `{business_id}/avatars/{platform_recipient_id}.{ext}`.

---

## 5. Send Path, Rate Limiting, Tokens, Attachments

### 5.0 Graph API Version Pinning (M3)

- Single constant `GRAPH_VERSION` in `_shared/meta-api.ts`, initialized from `Deno.env.get("META_GRAPH_VERSION")` (default: the current stable version **at Phase 0 kickoff**, chosen from Meta's changelog then â€” do not hardcode a version at plan time). **Serves the Meta family AND the WhatsApp Cloud API** â€” both use `graph.facebook.com/v{X}/...` **FACT**.
- TikTok base URL is a separate constant in `_shared/platforms/tiktok.ts` **[VERIFY IN PHASE 0 SPIKE]**.
- Upgrade policy: review the version-deprecation schedule at each phase boundary; bump the pin deliberately (one-line env change); Phase 9 monitoring tracks Meta `error_code` 4 (API version too old) and error subcodes for calls made with an expiring version.

### 5.1 Unified Send â€” per-platform adapters (v5)

`_shared/meta-api.ts` keeps the Meta-family machinery (GRAPH_VERSION, HMAC, token RPC). On top of it, a **unified dispatch entry point** and **four adapters**:

```typescript
// supabase/functions/_shared/platforms/types.ts
export interface SendContext {
  outboxId: string;
  channelAccountId: string;
  conversationId: string;
  recipientId: string;            // PSID | IGSID | wa_id | open_id
  platform: ChannelPlatform;
  text?: string;
  attachments?: Attachment[];
  messageTag?: 'ACCOUNT_UPDATE'|'CONFIRMED_EVENT_UPDATE'|'HUMAN_AGENT'|'POST_PURCHASE';
  notificationToken?: string;     // FB/IG RN/OTN send
  notificationTemplate?:         // FB/IG opt-in prompt send (HI-1)
    | { type: 'notification_messages', topic: string, rePromptInterval: string, title: string, payload?: string }
    | { type: 'one_time_notif', title: string, payload: string };
  templateId?: string;            // v5: WhatsApp template send
  templateVariables?: Record<string, string>;
  interactive?:                   // v5: WhatsApp button/list (within window only)
    | { type: 'button', buttons: { id: string; title: string }[] }   // max 3
    | { type: 'list', sections: { title: string; rows: { id: string; title: string; description?: string }[] }[] };  // max 10 rows total
}

// supabase/functions/_shared/platforms/index.ts â€” the dispatcher meta-send calls
export async function sendMessage(ctx: SendContext): Promise<{ platformMessageId?: string }> {
  const adapter = ADAPTERS[ctx.platform];   // facebook | instagram | whatsapp | tiktok
  if (!adapter) throw new Error(`unsupported platform: ${ctx.platform}`);
  return adapter.send(ctx);
}
```

**Adapter responsibilities** (each implements `send(ctx)`):

- `facebook.ts` â€” `/v{X}/me/messages`; body per mode: freeform / tagged / notification-token / RN opt-in template / OTN template. Page token via `get_channel_access_token`.
- `instagram.ts` â€” `/v{X}/{ig-id}/messages`; same body shapes (generic template supported â€” M7).
- `whatsapp.ts` (v5 NEW) â€” `POST /v{X}/{phone_number_id}/messages` with `{messaging_product: "whatsapp", to: wa_id, type: ...}`; **Bearer system-user token** (permanent **FACT**); modes: freeform text / media / **interactive buttons+lists (within window)** / **template** (`type: "template", template: {name, language, components}` â€” components built from the APPROVED `message_templates` row, variables substituted). Response carries the `wamid` â†’ stored as `platform_message_id`.
- `tiktok.ts` (v5 NEW, SPIKE-GATED) â€” business API endpoints with the `access_token`; **on 401: refresh via `tiktok-token-refresh` logic, retry once** (the refresh function is shared between the daily cron and the adapter). Send capability is gated behind the Phase 0 spike + approval (Â§14 Phase 6); until then the adapter throws `tiktok_unavailable` and the inbox is read-only inbound.

**`processOutboxRow` (v5 â€” the claim + re-assert + dispatch spine, v4 with two changes):**

```typescript
// supabase/functions/_shared/meta-api.ts (sketch)
export async function processOutboxRow(opts: { outboxId: string }) {
  const supa = getServiceClient();
  // 1. Atomic claim (single-writer guarantee â€” ME-B5/H3-2 fix: PostgREST
  //    filter values are literals; "now()" would be a cast error. And a fresh
  //    pending row has next_retry_at = NULL, which .lte excludes â€” the claim
  //    would silently match NOTHING and every interactive send would degrade
  //    to sweep latency. NULL-safe compound, ISO timestamp computed client-side:
  const nowIso = new Date().toISOString();
  const { data: row } = await supa.from("message_outbox")
    .update({ status: "sending" })
    .eq("id", opts.outboxId)
    .in("status", ["pending", "failed"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .select()
    .single();
  if (!row) return; // claimed by another invocation â€” exit
  // Retry affordance: the Retry button CLEARS next_retry_at (update to null)
  // before re-invoking, so backoff-scheduled rows are claimable at once.

  // 2. HI-3 re-assert: cross-business consistency, defense in depth for the
  //    service-role path. One SELECT joining conversation + channel account.
  const { data: ctx } = await supa.from("conversations")
    .select("business_id, window_expires_at, last_customer_message_at, platform, channel_accounts!inner(id, business_id, platform)")
    .eq("id", row.conversation_id)
    .eq("channel_accounts.id", row.channel_account_id)
    .maybeSingle();
  if (!ctx || ctx.business_id !== row.business_id || ctx.channel_accounts.business_id !== row.business_id) {
    // NEVER proceed: an A-agent tried to send on B's channel/conversation
    await supa.from("message_outbox").update({
      status: "failed", error_code: "cross_business_refusal",
      error_message: "referenced conversation/channel account belongs to a different business"
    }).eq("id", row.id);
    return;
  }

  // 3. Â§5.2 decision matrix (opt-out â†’ window/template/tag/subscription â†’ tier)
  // 4. Â§5.3 rate token (platform-aware: incl. WhatsApp daily tier)
  // 5. token decrypt (Â§13.1) / TikTok refresh-on-401
  // 6. v5: dispatch to _shared/platforms/index.ts sendMessage(ctx) by platform
  // 7. Insert messages row (metadata.campaign_id when campaign-originated â€” ME-11;
  //    metadata.template_name/template_language/pricing_category for WhatsApp)
  // 8. Set outbox sent / failed(+next_retry_at) / blocked_window / cancelled
}
```

### 5.2 Send Decision Matrix (v5 â€” per platform; applied IN ORDER, first failure wins)

| # | Check | Fail outcome |
|---|---|---|
| 1 | **Cross-business re-assert** (HI-3): `conversation.business_id = outbox.business_id` AND `channel_account.business_id = outbox.business_id` | `failed` + `error_code='cross_business_refusal'` (never sent; audited) |
| 2 | **Opt-out check (ME-13 â€” ALL outbound, ALL platforms, not just campaigns)**: no `messaging_opt_outs` row for this customer with `channel_account_id = :acct OR channel_account_id IS NULL` (this business) â€” **skipped only for `message_tag IN ('ACCOUNT_UPDATE','POST_PURCHASE')` transactional sends** | `cancelled` + `error_code='opted_out'` |
| 3a | **FB/IG** â€” no tag, no subscription, not an opt-in prompt row: `now() < window_expires_at` (NULL = closed) | `blocked_window` |
| 3b | **WhatsApp** â€” freeform/interactive row: `now() < window_expires_at` (24h **FACT**). Interactive buttons/lists are within-window-only **FACT** | `blocked_window` (composer offers the template picker instead) |
| 3c | **WhatsApp template row** (`template_id` set): template row exists AND `status='APPROVED'` AND belongs to the same `channel_account_id` AND (outside window is ALLOWED â€” that is the template's purpose **FACT**). Cost category recorded from the template's category â†’ `metadata.pricing_category` | `blocked_window` + `error_code='template_not_approved'` when PENDING/REJECTED or mismatched account |
| 3d | **TikTok** â€” `now() < window_expires_at` (48h, believed **[SPIKE]**); business-initiated outside the window is blocked in v1 regardless of content | `blocked_window` + `error_code='tiktok_window_closed'` |
| 3e | **FB/IG tag path**: `message_tag` set â€” HUMAN_AGENT: `now() < last_customer_message_at + 7d` **AND the tag has Meta Advanced Access approval (ME-8; live mode)**; others: permitted-use policy (UI-enforced) + in-window OR tag-authorized out-of-window | `blocked_window` (or `failed` with the Graph permission error on unapproved live-mode use) |
| 3f | **FB/IG subscription path**: `subscription_id` set: subscription `status='active'` AND (`expires_at` IS NULL OR `expires_at > now()`) AND (RN: topic matches) AND quota not exhausted | `cancelled` + `error_code='subscription_expired'` |
| 3g | **FB/IG opt-in prompt rows (ME-B3)**: rows whose `saved_message_id` references a saved message of category `optin_prompt`/`optin_one_time` are TEMPLATE sends, not freeform â€” meta-send loads `optin_config` and builds the `notification_messages`/`one_time_notif` body. The row's `content` is agent-visible descriptive text, NEVER sent. Opt-in prompts are in-window sends by definition | `blocked_window` if outside window |
| 4 | **Rate token available (Â§5.3 â€” includes the WhatsApp daily tier check)** | row stays `pending`, `next_retry_at = now() + 1s` (sweep retries) |
| 5 | **Platform API call â€” outcome classes (LO-6)**: (a) 2xx â†’ `sent`; (b) explicit retryable API error (rate-limit, transient 5xx with error body) â†’ backoff loop; (c) explicit non-retryable API error â†’ `failed` with the API `error_code`; (d) **timeout / network abort / unknown outcome** â†’ `failed` + `error_code='timeout_unknown'` â€” NEVER auto-retried (no client dedup id on any platform; a retry after a lost response duplicates the customer message). The UI shows "possibly sent â€” verify in thread"; manual retry creates a NEW outbox row only after the agent confirms the thread | per class |

The composer's opt-out banner (Â§3.6) surfaces check 2 before the agent types; checks 1â€“3 remain authoritative at send time.

### 5.3 Rate Limiting â€” atomic token bucket (H5 + v5 platform tiers)

One atomic statement that refills AND decrements, called via RPC (avoids PostgREST-side read-modify-write). **v5: the function now also enforces the WhatsApp daily tier** (FACT: business-initiated conversations capped per 24h by tier) and resets the daily counter atomically inside the same UPDATE:

```sql
CREATE OR REPLACE FUNCTION public.consume_rate_limit_token(p_channel_account_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ok boolean;
BEGIN
  -- HI-B1 fix: self-seeding. The bucket row is created on first use if the
  -- connect flow or a migration race missed it, so a freshly connected
  -- account can always consume tokens. (Belt: the AFTER INSERT trigger on
  -- channel_accounts below; braces: this upsert. Defaults are FB/IG-shaped;
  -- the trigger seeds platform-aware values.)
  INSERT INTO public.rate_limit_buckets AS rb
    (channel_account_id, capacity, refill_rate_per_sec, tokens_remaining,
     daily_capacity, daily_used, daily_reset_at)
  VALUES
    (p_channel_account_id, 200, 200, 200, 0, 0, now())
  ON CONFLICT (channel_account_id) DO NOTHING;

  -- Single atomic statement: refill the per-second bucket, roll the 24h daily
  -- counter over when its window lapsed, increment it, and enforce BOTH caps.
  -- A row is claimable iff a per-second token is available AND (no daily cap,
  -- OR the daily window still has budget, OR the daily window lapsed and the
  -- reset in this same statement zeroes it).
  UPDATE public.rate_limit_buckets
     SET last_refill_at = now(),
         tokens_remaining = LEAST(
           capacity,
           tokens_remaining + floor(extract(epoch from (now() - last_refill_at)) * refill_rate_per_sec)
         ) - 1,
         daily_reset_at = CASE WHEN daily_reset_at < now() - interval '24 hours'
                               THEN now() ELSE daily_reset_at END,
         daily_used = CASE
           WHEN daily_reset_at < now() - interval '24 hours' THEN 1        -- window rolled over
           WHEN daily_capacity > 0 THEN daily_used + 1                    -- WhatsApp tier in force
           ELSE daily_used END                                            -- FB/IG: no daily cap
   WHERE channel_account_id = p_channel_account_id
     AND (tokens_remaining
          + floor(extract(epoch from (now() - last_refill_at)) * refill_rate_per_sec)) >= 1
     AND ( daily_capacity = 0
        OR (daily_reset_at >= now() - interval '24 hours' AND daily_used < daily_capacity)
        OR  daily_reset_at <  now() - interval '24 hours' )
   RETURNING true INTO v_ok;
   RETURN COALESCE(v_ok, false);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_rate_limit_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit_token(uuid) TO service_role;

-- HI-B1 belt + NEW-2 fix: SECURITY DEFINER so a client-side channel_accounts
-- INSERT (Class B managers-write path) does not die on the trigger touching
-- the service-role-only rate_limit_buckets table.
-- v5: seeding is now PLATFORM-AWARE (WhatsApp: per-second pacing + tier-based
-- daily cap; FB/IG: v4 values unchanged; TikTok: conservative defaults until
-- the Phase 0 spike documents its limits).
CREATE OR REPLACE FUNCTION public.seed_rate_limit_bucket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_capacity int := 200;
  v_daily    int := 0;
BEGIN
  IF NEW.platform = 'whatsapp'::public.channel_platform THEN
    v_capacity := 80;   -- per-second pacing [VERIFY IN PHASE 0 SPIKE: ~80 req/s]
    v_daily := CASE NEW.whatsapp_tier
                 WHEN '100K' THEN 100000
                 WHEN '10K'  THEN 10000
                 WHEN '1K'   THEN 1000
                 ELSE 250 END;   -- business-initiated conversations / 24h (FACT: tiered)
  ELSIF NEW.platform = 'tiktok'::public.channel_platform THEN
    v_capacity := 20;   -- conservative until the spike documents TikTok limits
    v_daily := 0;
  END IF;
  INSERT INTO public.rate_limit_buckets
    (channel_account_id, capacity, refill_rate_per_sec, tokens_remaining,
     daily_capacity, daily_used, daily_reset_at)
  VALUES
    (NEW.id, v_capacity, v_capacity, v_capacity, v_daily, 0, now())
  ON CONFLICT (channel_account_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_seed_rate_limit_bucket AFTER INSERT ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.seed_rate_limit_bucket();
```

**Tier changes:** the settings UI updates `channel_accounts.whatsapp_tier` AND `rate_limit_buckets.daily_capacity` in one service call (the bucket update is `UPDATE ... SET daily_capacity = <new tier value>`; the daily counter is untouched â€” a tier upgrade does not reset today's usage, a downgrade does not inflate it).

**Phase 2 smoke test (HI-B1):** after connecting a fresh channel on each platform, assert `consume_rate_limit_token(new_account_id)` returns `true` and (WhatsApp) that `daily_used` increments.

- Single-statement refill+decrement: no lost updates (row lock serializes concurrent consumers).
- If no token is available, `meta-send` leaves the row `pending` with `next_retry_at = now() + 1s` (sweep picks it up).
- **Honest throughput**: each send costs one atomic RPC (~5-15ms) + platform API latency (~100-300ms). A single-instance loop sustains ~5-20 sends/sec. Bulk campaigns (Â§10.4) run a bounded-concurrency promise pool (10-20 in-flight calls, each holding one token) â€” realistic ~30-100/sec, comfortably below platform limits and adequate for 500 convos/day. **WhatsApp bulk is additionally bounded by the daily tier** â€” a large broadcast to a 250-tier account simply takes multiple days; the campaign dashboard shows the tier and projects completion (Â§10.4).

### 5.4 Token Management (M4 + v5 two model split)

**FB/IG (unchanged from v4):** long-lived *user* tokens last ~60 days; **page access tokens obtained from a long-lived user token do not have a fixed expiry** â€” they survive until the user changes their password, revokes access, or the app loses permissions. A daily "refresh" cron is a no-op. Real failure modes: user-driven revocations, password changes, app permission loss, page admin role removal. `meta-token-probe` (weekly) probes and flags.

**WhatsApp (v5 NEW â€” the easy case):** a **permanent system-user token** **FACT** â€” no refresh cron, no expiry clock. The weekly `meta-token-probe` calls `GET /{phone_number_id}?fields=id` with the decrypted token; on 401/190 it sets `is_active=false`, records `metadata->>'token_error'`, and raises an admin notification. Success updates `token_validated_at`. Revocation is handled by re-running the Â§4.7 WhatsApp connect path.

**TikTok (v5 NEW â€” the case that needs a refresh flow):** `access_token` expires ~24h; `refresh_token` ~1 year **FACT-pattern**. Two layers:

1. **`tiktok-token-refresh` (daily pg_cron)**: for each active TikTok `channel_account`, refresh the access token via the refresh grant (`client_key`/`client_secret` from edge env), rewrite both encrypted columns + `token_expires_at` (+ `refresh_token_expires_at` if rotated). Idempotent and safe to re-run.
2. **On-401 refresh inside `tiktok.ts`**: the adapter catches a 401, invokes the same refresh logic once, retries the send once. If the refresh fails (refresh_token expired/revoked), the account is marked `is_active=false` with `metadata->>'token_error'` and an admin alert fires.
3. **Expiry alert**: `refresh_token_expires_at < now() + interval '14 days'` â†’ dashboard banner prompting re-authorization (the refresh token's death means a human must re-connect; no silent outage).

**Token rotation:** the settings UI reconnection flows write new tokens through the same encrypt path (Â§13.1) â€” unchanged for all platforms.

### 5.5 Inbound Attachment Persistence (H3 + ME-12 â€” downloads OFF the critical path)

Platform CDN URLs are temporary and token-gated; storing them renders broken media later. Downloads are **asynchronous from day one** on every platform:

1. **Webhook (critical path)**: insert the message immediately; each attachment carries `meta_url` (Meta CDN URL, or the WhatsApp `media_id` â€” the sweep resolves it); `metadata.download_pending = true`. No fetch.
2. **Sweep download task** (every sweep pass): select up to 25 messages with `metadata->>'download_pending' = 'true'` and `created_at > now() - interval '24 hours'`; for each attachment: **WhatsApp two-hop (FACT): `GET /{media_id}` â†’ JSON with a ~5-min URL â†’ fetch with the system-user Bearer token**; Meta family: fetch the CDN URL with the page token. Upload to `inbox-attachments/{business_id}/{conversation_id}/{platform_message_id}-{n}.{ext}`, fill `storage_path`, then clear the flag. Failures leave the flag set and retry on the next pass until the 24h window lapses (then a terminal `download_failed` metadata flag + observability counter).
3. **UI renders** short-lived signed URLs (60 min) generated on demand; while `download_pending`, the bubble shows a lightweight placeholder chip.
4. **Outbound agent attachments** (ComposerBar): upload from browser to the same bucket via the Â§2.6 INSERT policy (25MB bucket limit; type allowlist + extension check enforced **client-side** â€” ME-6), then the outbox row carries `attachments`; the platform adapter either (a) generates a short-TTL signed URL for the platform to fetch, or (b) for previously-sent files, reuses the platform's attachment id. Large-file rule: >8MB images / >25MB files rejected in the composer before upload (UI check).
5. **Avatars**: profile pictures have the same expiring-URL problem on all platforms; the same sweep task persists them to `{business_id}/avatars/{platform_recipient_id}.{ext}` (Â§7.1).

### 5.6 Outbox Sweep (H4 + ME-1 + ME-3 + ME-12 â€” unchanged shape, all platforms)

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

**ME-1: the sweep's claim step is a service-role-only RPC with the exact `FOR UPDATE SKIP LOCKED` + outer-recheck shape of the repo's own `claim_sync_queue_batch` (20260829000000 â€” verified). Platform-agnostic â€” it claims by status, and the per-row platform only matters downstream in the adapter:**

```sql
CREATE OR REPLACE FUNCTION public.claim_outbox_batch(p_limit int)
RETURNS SETOF public.message_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.message_outbox
    WHERE status IN ('pending', 'failed')
      AND (
        (status = 'pending'  AND created_at < now() - interval '5 seconds')
        OR (status = 'failed' AND next_retry_at <= now())
      )
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED          -- concurrent sweeps skip each other's rows
  )
  UPDATE public.message_outbox o
  SET status = 'sending', updated_at = now()
  FROM claimed c
  WHERE o.id = c.id
    AND o.status IN ('pending', 'failed')   -- outer recheck: defeats EvalPlanQual
  RETURNING o.*;                            -- re-evaluation double-claiming
END;
$$;
REVOKE ALL ON FUNCTION public.claim_outbox_batch(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_batch(int) TO service_role;
```

`meta-outbox-sweep` verifies the `x-cron-secret` header (or the non-blocking call's one-shot token from either webhook function), then:

1. **Claim** a batch (â‰¤100 rows) via `claim_outbox_batch` â€” atomically safe under the guaranteed overlap of cron + webhook-fired invocations
2. **Process** each claimed row through the Â§5.1 pipeline (same checks as `meta-send`, dispatched to the platform adapter)
3. **Download pending attachments** (Â§5.5, batch of 25 â€” all platforms)
4. **Dispatch due campaigns** (ME-3 â€” sole trigger): scan `bulk_campaigns WHERE status='scheduled' AND scheduled_at <= now()` (served by `idx_campaigns_due`) and invoke `meta-bulk-send` per campaign. `meta-bulk-send` opens with the **atomic campaign claim** â€” `UPDATE bulk_campaigns SET status='sending', started_at=now() WHERE id=$1 AND status='scheduled' RETURNING *` â€” so if two sweep invocations both dispatch the same campaign, the loser's claim returns zero rows and it exits without sending anything (Â§10.4).

If the platform's pg_cron rejects a `30 seconds` interval, use `'* * * * *'` (1 min) â€” interactive sends never wait on the sweep (direct-invoke path Â§1.5), only auto-reply worst-case latency widens from ~30s to ~90s.

### 5.7 Rate limit on profile fetches (M9)

The webhook-time profile fetch (`GET /{psid}?fields=name,profile_pic` with page token for FB/IG; the WhatsApp profile lookup equivalent **[VERIFY endpoint]**) is rate-limited per account. Strategy: fetch only on FIRST message from a sender (no alias row for that platform id), cache indefinitely (name changes are rare; profile_pic persists to Storage), and never block message processing on it â€” fallback name applies immediately (Â§7.1). **WhatsApp often needs no profile fetch at all** â€” the phone-first resolution already finds the customer's stored name (Â§7.1).

---

## 6. Order Management from Inbox

**Platform-agnostic.** Every platform's conversation carries `business_id` + `customer_id`; the order flow below is identical whether the chat is FB, IG, WhatsApp, or TikTok. Only the prefill `sourceName` differs (`'fb/ig'` | `'whatsapp'` | `'tiktok'` â€” all seeded by Â§2.2.0).

### 6.1 Create Order from Chat (H6 + HI-2 â€” the dialog IS modified; exact spec, re-verified against source)

`AddOrderDialog` today: Props `{open, onOpenChange, onCreated}` (lines 89-93); `onCreated()` invoked with **no arguments** (line 897); customer resolved from the typed phone (line 782 â€” global `customers.phone` lookup, then create at 796); **the dialog self-fetches its entire catalog** (products, variations, order_sources, pathao geo, invoice_settings, stores, categories, product_categories â€” one `Promise.all`, lines 284-321) and accepts **no dataset props**; `source` state holds the source row **name** (lines 241/303) and the name string is what gets inserted into `customers.source` (line 803) and `orders.source` (line 817); the phone is normalized **on save** by `normalizeBdPhone` (lines 35-42, 779).

**Modification 1 â€” `onCreated` result payload + prefill prop (backwards-compatible; existing orders-page caller ignores the new argument and passes no prefill):**

```typescript
// AddOrderDialog.tsx
interface CreatedOrderResult {
  orderId: string;        // order.id â€” in scope at the onCreated call site (line 837 result)
  orderNumber: string;    // orderNumber â€” line 810
  customerId: string | null;  // customerId â€” line 778
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result?: CreatedOrderResult) => void;   // <- optional arg, backwards-compatible
  prefill?: {
    customerName?: string;    // Seeds the customer name field
    customerPhone?: string;   // Seeds the phone field RAW â€” the dialog normalizes on save (line 779);
                              // normalizeBdPhone is BD-format-specific (documented limitation:
                              // non-BD numbers captured from chat may normalize oddly â€” agent
                              // verifies the seeded field before saving)
    sourceName?: string;      // The order_source row NAME (e.g. 'fb/ig' | 'whatsapp' | 'tiktok') â€”
                              // state holds names (line 241/303), and the name string is what
                              // orders.source stores
  };
  catalogScope?: {            // Modification 2 â€” see below
    storeIds?: string[];       // The business's selling-point store ids â€” THE scoping key (ME-B1)
  };
}

// In the component body:
// (1) prefill effect â€” one-time, no render loop; seeds state directly:
useEffect(() => {
  if (open && prefill) {
    if (prefill.customerName) setCustomerName(prefill.customerName);
    if (prefill.customerPhone) setCustomerPhone(prefill.customerPhone);   // RAW â€” normalize happens at save
    if (prefill.sourceName) setSource(prefill.sourceName);                // NAME, not id (HI-2)
  }
}, [open, prefill]);

// (2) catalog scoping â€” applied inside the EXISTING Promise.all (lines 286-297)
//     when catalogScope is present (ME-B1 fixes: store-keyed, not id-list):
//     - products:        .in('store_id', catalogScope.storeIds)   (products carry store_id â€” verified DDL)
//     - product_variations: .in('product_id', <ids of the scoped products>) â€”
//       variations are keyed by their OWN ids with a product_id FK (dialog line 288);
//       the dialog fetches variations AFTER products, so it has the scoped product
//       ids in hand â€” filter by product_id, NOT by 'id'
//     - stores:          .in('id', catalogScope.storeIds)
//     - orders_sources:  NOT scoped (catalogScope carries no source ids; sources
//       are a per-business constant list â€” removing it from the scoped set)
//     The dialog keeps self-fetching (verified: no dataset props exist), but
//     fetches the scoped slice. Store-keyed filters keep the PostgREST URL a
//     handful of values long (id-lists of hundreds of products would breach
//     URL/header limits â€” ME-B1).

// (3) onCreated payload â€” change line 897 from `onCreated();` to:
onCreated({ orderId: order.id, orderNumber, customerId });
// order.id (from the .select("id").single() insert, lines 815-837), orderNumber
// (line 810), and customerId (line 778) are all in scope at the call site â€”
// verified. This is the minimal-change option: no query-latest-order round
// trip, no extra fetch.
```

**v5 shared normalization extraction:** `normalizeBdPhone` (AddOrderDialog lines 37-44) is extracted to `src/lib/normalizePhone.ts` and imported by both the dialog and the WhatsApp webhook resolution path (Â§7.1). One function, one normalization, one match semantics â€” the WhatsApp phone-first resolution MUST use exactly this function or the match silently fails. The BD-specific limitation (non-BD numbers normalize oddly) is inherited and documented in both places.

**Modification 2 â€” business-scoped catalog (HI-2(d) + ME-B1):** v2's claim that "scoping happens in the wrapper's data fetching" was **false** â€” the dialog self-fetches its catalog (verified lines 284-321) and accepts no dataset props, so an inbox wrapper could not scope it. The `catalogScope` prop above is the fix: the `OrderLinker` wrapper computes the active business's `storeIds` via `selling_points` (foundation mechanism â€” `selling_points.business_id` + `woo_store_id`) and passes them in. The dialog's internal queries then filter **by `store_id`** (products), `product_id` (variations), and `id` (stores) â€” Business A's inbox agents can no longer select Business B's products/stores, and the PostgREST URL stays a handful of values long. The orders page (no `catalogScope`) is unaffected.

**Flow (the concrete link â†’ tag â†’ merge chain â€” every step now works as stated):**

1. Agent clicks "Create Order" in the ContextSidebar
2. `OrderLinker` opens `AddOrderDialog` with `prefill = { customerName: <profile name>, customerPhone: <phone captured in chat or, for WhatsApp, from the wa_id, if any â€” RAW>, sourceName: <'fb/ig'|'whatsapp'|'tiktok'> }` (rows seeded by Â§2.2.0) and `catalogScope = <business's storeIds>`
3. Dialog saves: customer resolution by typed phone (line 782) runs â€” **this is the merge point** (Â§7.2). The dialog's orders insert does NOT set `business_id` (it doesn't know the business â€” verified). Resolution for inbox orders happens at the **link** step: `OrderLinker` UPDATEs the order's `business_id` from the conversation immediately after `onCreated`, and trigger (b) backfills it defensively too (Â§2.5.4 HI-B3 â€” both layers, so an inbox order can never stay unscoped). When the agent selects a scoped store, the Â§2.5.4 insert trigger ALSO resolves via `store_id` â†’ selling point.
4. On `onCreated({ orderId, orderNumber, customerId })`: `OrderLinker` inserts into `conversation_orders` (`business_id` from the conversation, `order_id` from the payload) â†’ trigger (b) tags `has_ordered` under the conversation's business; the HI-3 policy guarantees the link is same-business
5. Post a system message into the thread: "Order #`{orderNumber}` created" via `post_system_message` (Â§2.5.5; `content_type='order_confirmation'`, `sender_type='system'`, never sent to any platform)
6. If the dialog resolved a DIFFERENT customer by phone than the conversation's alias-created customer, `OrderLinker` calls `merge_chat_customers` (Â§7.2) with `customerId` (the order's, from the payload) as canonical â€” the RPC moves aliases/conversations to it and the order + chat now aggregate on one customer. The `onCreated` payload's `customerId` makes this check possible without any extra query (this was v2's broken link â€” HI-2).

**Phase 4 budget: 1-2 days** (dialog modifications: prefill effect + catalogScope filters + onCreated payload â‰ˆ 30 lines with tests) **plus regression check of the orders page usage** (passes no `prefill`/`catalogScope`, ignores the new `onCreated` argument â€” unaffected).

### 6.2 Link Existing Order

1. Search orders by order_number, customer name, or phone â€” **business-scoped via `orders.business_id`** (Â§2.5.4; NULL-business rows surface only if the agent has the orders-page-wide permission and the UI marks them "unscoped")
2. Results display with `OrderBadges` (verified exists)
3. On select: insert `conversation_orders` (HI-3 policy enforces same-business conversation + order) â†’ trigger (b) tags `has_ordered`
4. Linked orders render in the ContextSidebar with status badges

### 6.3 Order Status Sync to Chat

On `order_timeline` insert for an order linked to conversations (DB trigger â†’ edge function enqueue, or checked in the sweep):

1. Insert system message via `post_system_message`: "Order #1234 has been shipped"
2. If the business enables "notify customer" and the window is open: insert outbox row for the customer. **Per-platform out-of-window notification:**
   - FB/IG: `POST_PURCHASE` tag permitted if not opted out (ME-13)
   - WhatsApp: approved UTILITY template (e.g. order-status template) if one exists and the customer is not opted out
   - TikTok: within-window only (v1)

### 6.4 AI-Powered Order Extraction

Reuse `parse-order-text` edge function (verified exists, 240 lines). Agent pastes chat text into the dialog's AI parse field â€” existing flow, works with prefill (the extracted phone lands in the same seeded field). Platform-agnostic.

---

## 7. Customer CRM

### 7.1 Customer Resolution at Webhook Time (H11 + M9 + A1 + LO-14 â€” v5: two resolution modes)

**FB/IG/TikTok â€” alias-first ONLY.** These webhooks carry only the platform ID â€” no phone, no email, no name. The woo-webhook phone-first pattern is inapplicable at webhook time; it is inherited only for order creation (Â§6.1).

```
resolveCustomerByPlatformId(platform, senderId):
  1. alias lookup: customer_aliases WHERE type IN
     ('facebook_psid'|'instagram_id'|'tiktok_open_id')
     AND lower(value) = lower(senderId)  -- uses new index Â§2.2.0
     -- LO-14: fetch .limit(2), NOT maybeSingle() â€” the unique index is
     -- (customer_id, type, lower(value)), NOT (type, value), so a merge race
     -- can leave the SAME platform id under two customers; maybeSingle()
     -- would throw PGRST116 on that state
  2. if exactly 1 row -> return customer_id
  3. if 2 rows (merge-race duplicate):
     a. deterministically pick the OLDER customer (min(created_at), tie-break min(id))
     b. log a duplicate-alias warning to meta_webhook_events (observability)
        and enqueue the pair into the Phase 5 manual-merge queue
     c. return the picked customer_id   (the merge RPC Â§7.2 eventually resolves)
  4. not found:
     a. kick off best-effort profile fetch (rate-limited: first-message-only, Â§5.7)
     b. create customers row: name = profile.name OR platform fallback
        ('Facebook User' / 'Instagram User' / 'TikTok User'), phone NULL, store_id NULL
        (customers.name is NOT NULL â€” verified)
     c. insert alias (type per platform, value senderId, source_store_id NULL)
        -- requires Â§2.2.0 CHECK extension; ON CONFLICT DO NOTHING
     d. avatar persisted async by the sweep (expiring URL â€” Â§5.5)
  5. attach customer_id to the conversation
```

**WhatsApp â€” phone-first direct match (v5 NEW, FACT).** The `wa_id` **IS** the phone number (E.164, no `+`) **FACT**, and this codebase's `customers` table is phone-first (`customers.phone` + `idx_customers_phone`, verified DDL). Resolution:

```
resolveCustomerByWaId(channelAccountId, wa_id):
  1. normalize: norm = normalizeBdPhone(wa_id)   -- src/lib/normalizePhone.ts,
     the SAME function the order dialog uses. wa_id arrives E.164 ("8801xxx");
     normalizeBdPhone strips the 880 prefix and yields the local form that
     customers.phone is stored in. Non-BD wa_ids normalize oddly â€” documented
     limitation; they fall through to alias-only handling (step 4) with phone
     stored raw on the created customer.
  2. phone lookup: customers WHERE phone = norm  (idx_customers_phone)
     -- .limit(2) for the same merge-race reason
  3. if exactly 1 row -> DIRECT LINK: this is an existing CRM customer;
     no new customer row, no profile fetch (the stored name wins â€” Â§5.7).
     STILL insert a customer_aliases row (type 'whatsapp_wa_id',
     value = norm) for uniformity â€” so cross-platform merge (Â§7.2) and the
     alias lookup above work identically for WhatsApp. ON CONFLICT DO NOTHING.
  4. if not found: profile fetch + create customers row (phone = norm or raw
     wa_id if non-BD) + insert the alias â€” same shape as the alias-first path.
  5. attach customer_id to the conversation.
```

**Why phone-first matters (the business value):** a customer who has ordered before by phone and later messages on WhatsApp is recognized **immediately**, on the first message â€” their name, tags, `has_ordered` badge, order history, and LTV all populate without waiting for an order-creation merge. FB/IG cannot do this (no phone in the payload) and merge only at order time (Â§7.2).

The profile fetch is non-blocking in all modes: the message and customer insert immediately with the fallback name; a follow-up update lands when the fetch completes (usually <1s).

### 7.2 Cross-Platform Merge (H11 + HI-2 + LO-14 â€” phone matching happens at ORDER time; WhatsApp can trigger it earlier)

Phone linkage becomes possible when the customer shares a number in chat and an order is created:

1. Agent creates an order from the inbox (Â§6.1) with a phone captured from the conversation
2. `AddOrderDialog`'s existing global-phone customer resolution (line 782: lookup by typed phone) runs â€” this is the actual merge point
3. If the resolved-by-phone customer differs from the conversation's alias-created customer:
   - The order's `customer_id` points at the phone-matched (older) customer â€” and the `onCreated` payload (Â§6.1 Modification 1) hands `OrderLinker` that `customerId` directly
   - `OrderLinker` calls `merge_chat_customers(chat_customer_id, canonical_customer_id, conversation.business_id)` (3-arg â€” L3-5) â€” full SQL:

```sql
CREATE OR REPLACE FUNCTION public.merge_chat_customers(
  p_chat_customer_id    uuid,    -- the alias-created (duplicate) customer
  p_canonical_customer_id uuid,  -- the phone-matched customer to keep
  p_business_id         uuid     -- L3-5 fix: explicit business (the caller
                                  -- OrderLinker has the conversation in hand;
                                  -- no heuristic most-recent-conversation pick)
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_id uuid := p_business_id;
BEGIN
  IF p_chat_customer_id = p_canonical_customer_id THEN RETURN; END IF;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'p_business_id is required';
  END IF;
  -- The caller's business is authoritative; verify the chat customer actually
  -- has a conversation in it (guards against cross-tenant misuse).
  IF NOT EXISTS (SELECT 1 FROM public.conversations
                 WHERE customer_id = p_chat_customer_id
                   AND business_id = v_business_id) THEN
    RAISE EXCEPTION 'chat customer has no conversation in this business';
  END IF;

  -- Ownership assertion (SECURITY DEFINER bypasses RLS â€” H8 pattern):
  -- admin, or a member of that business with inbox.manage
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
          OR (v_business_id IS NOT NULL
              AND public.is_business_member(v_business_id)
              AND public.has_permission(auth.uid(), 'inbox.manage'::app_permission))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- LO-14: alias dedup BEFORE the move. If the canonical customer already has
  -- an alias of the same (type, lower(value)) â€” impossible for platform IDs in
  -- normal flow, possible via merge races â€” delete the duplicate from the chat
  -- customer first so the unique index (customer_id, type, lower(value)) never
  -- trips and no platform id ends up under two customers after the merge.
  DELETE FROM public.customer_aliases a
   WHERE a.customer_id = p_chat_customer_id
     AND EXISTS (SELECT 1 FROM public.customer_aliases b
                 WHERE b.customer_id = p_canonical_customer_id
                   AND a.type = b.type AND lower(a.value) = lower(b.value));

  -- Transactional repointing (single statement each; one transaction):
  UPDATE public.customer_aliases SET customer_id = p_canonical_customer_id
   WHERE customer_id = p_chat_customer_id;
  UPDATE public.conversations SET customer_id = p_canonical_customer_id
   WHERE customer_id = p_chat_customer_id;
  UPDATE public.notification_subscriptions SET customer_id = p_canonical_customer_id
   WHERE customer_id = p_chat_customer_id;
  -- conversation_orders has NO customer_id column (verified Â§2.2.5: id,
  -- business_id, conversation_id, order_id, linked_by, created_at) â€” it keys
  -- orders, not customers, so there is nothing to repoint. Orders keep their
  -- own customer_id. (C3-3 fix: the v3 statement UPDATEd a nonexistent column.)
  -- NEW-3 fix: the dedup match includes business_id â€” the unique indexes key
  -- on (customer_id, business_id) [global] and (customer_id, channel_account_id)
  -- [per-channel]. Without the business_id branch, a canonical global opt-out
  -- in ANY business would delete the chat customer's opt-outs in OTHER
  -- businesses (suppression lost â€” ME-13 harm class). Same business is
  -- guaranteed here: the caller's ownership check validated p_business_id.
  UPDATE public.messaging_opt_outs SET customer_id = p_canonical_customer_id
   WHERE customer_id = p_chat_customer_id
     AND NOT EXISTS (SELECT 1 FROM public.messaging_opt_outs o2
                     WHERE o2.customer_id = p_canonical_customer_id
                       AND o2.business_id = public.messaging_opt_outs.business_id
                       AND ((o2.channel_account_id IS NULL
                             AND public.messaging_opt_outs.channel_account_id IS NULL)
                            OR o2.channel_account_id = public.messaging_opt_outs.channel_account_id));
   DELETE FROM public.messaging_opt_outs WHERE customer_id = p_chat_customer_id;  -- survivors moved above; rest were dupes
  UPDATE public.customer_tags SET customer_id = p_canonical_customer_id
   WHERE customer_id = p_chat_customer_id
     AND NOT EXISTS (SELECT 1 FROM public.customer_tags t2
                     WHERE t2.customer_id = p_canonical_customer_id
                       AND t2.business_id = public.customer_tags.business_id
                       AND t2.tag = public.customer_tags.tag);
   DELETE FROM public.customer_tags WHERE customer_id = p_chat_customer_id;  -- survivors moved above; rest were dupes
  UPDATE public.customer_notes SET customer_id = p_canonical_customer_id
   WHERE customer_id = p_chat_customer_id;
  -- messages carry no customer_id (conversation-scoped) â€” nothing to repoint.
  -- bulk_campaign_recipients.customer_id stays pointing at the chat customer:
  -- recipient rows are immutable per-campaign send history (status, sent_at,
  -- error per recipient); repointing would rewrite past-campaign audit rows.
  -- Canonical-customer campaign history is reachable via the aliases +
  -- conversation_id retained on each row.

  -- Leave the chat customer row in place (global table; order history may
  -- reference it) but neutralize: the alias move above guarantees no future
  -- webhook resolves to it. Phase 5's manual-merge UI uses this same RPC.
END;
$$;
REVOKE ALL ON FUNCTION public.merge_chat_customers(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_chat_customers(uuid, uuid, uuid) TO authenticated;
```

4. Result: all platform aliases (FB PSID, IGSID, WhatsApp wa_id, TikTok open_id) point at one customer; orders aggregate correctly; Â§7.1 lookups are unambiguous (LO-14's `.limit(2)` handles the transient window before any merge runs).

If a customer contacts from multiple platforms: platform IDs attach to the same customer via aliases when a phone merge occurs; until then, separate customer records exist (harmless â€” no cross-tenant data exposed; the manual merge UI in Phase 5 uses the same RPC). **WhatsApp's phone-first resolution means a repeat WhatsApp customer is merged at first message, not at order time** â€” the only platform with that property.

### 7.3 Tagging System

- Manual: `TagManager` inserts into `customer_tags` (business-scoped, H1)
- Auto: automation rules (`keyword_match`, `tag_added`) â€” respecting `platform_scope`
- Order-based: `has_ordered` via DB triggers (Â§2.5.3) â€” keyed off `orders.business_id` (Â§2.5.4)
- Tags are business-scoped: different businesses can have different tag taxonomies **and the same tag name on the same shared customer** (unique constraint is `(business_id, customer_id, tag)`)

### 7.4 Customer Profile Sidebar

`ContextSidebar` > Customer tab: name, phone, email, address (from `customers`); `has_ordered` badge + tags (from `customer_tags`); order count and LTV â€” **aggregated from `orders WHERE business_id = :business AND customer_id = :customer`** (the Â§2.5.4 column; unresolvable orders excluded by definition of the filter); notes (`customer_notes`); **active conversations across platforms** (same business â€” lists each platform with its `PlatformBadge`, so the agent knows "this customer is also on WhatsApp"); last interaction timestamp.

---

## 8. Automation Rules

### 8.1 Rules Engine

Evaluated in `meta-webhook` (and `tiktok-webhook`) after message insertion. **v5: the engine filters rules by `platform_scope`** (NULL = all platforms; a WhatsApp-only rule never fires on an FB conversation):

1. Load active rules for the conversation's business `WHERE is_active AND (platform_scope IS NULL OR :platform = ANY(platform_scope))`, ordered by priority
2. For each rule, evaluate `trigger_type` + `trigger_config` against the message/conversation/order context
3. On match: apply `action_type` + `action_config`, increment `match_count`
4. Actions that send (`auto_reply`, `send_saved_message`, `send_optin_prompt`, `send_whatsapp_template`) insert outbox rows; the webhook fires the sweep non-blocking ONLY if rows were inserted (ME-16)

### 8.2 Trigger Types

`keyword_match` (config: `{keywords: [...], match: 'any'|'all', case_sensitive: false}`), `new_conversation`, `idle_timeout`, `order_status_change`, `order_created` (business-resolved via Â§2.5.4), `tag_added`, `business_hours_off`, `customer_first_message`.

### 8.3 Action Types

`auto_reply` (freeform â€” in-window only on every platform), `auto_tag`, `auto_assign`, `auto_close`, `escalate`, `send_saved_message`, `send_optin_prompt` (FB/IG â€” HI-1), **`send_whatsapp_template` (v5 â€” WhatsApp out-of-window auto-reply via an APPROVED template; `action_config: {template_id}`)**.

### 8.4 SLA Timers

pg_cron-driven: conversations unanswered past the business's SLA threshold get `priority` bumped to `high`/`urgent` and an agent/team alert. **v5: SLA thresholds may be configured per platform** (a WhatsApp customer expects faster replies than an IG DM â€” business decision, not a platform constraint).

---

## 9. Agent Collaboration

**Entirely platform-agnostic.** Assignment, notes, transfer, presence, and collision detection operate on `conversations` rows regardless of platform; no section below reads `platform`.

### 9.1 Assignment

- Round-robin auto-assignment in the webhook (new conversations): pick the next online agent (presence-weighted, workload-weighted), skipping offline/busy
- `AssignmentDropdown` for manual assign/reassign with the LO-13 optimistic `updated_at` stale-check
- Supervisor view (admin): filter by assignment across the business

### 9.2 Internal Notes

`sender_type='agent'`, `content_type='internal_note`', inserted via the same Â§2.3 messages INSERT policy; @mentions parse `content` for `@name` and notify (in-app toast + presence-channel broadcast). **Never sent to any platform** â€” the send path only dispatches rows whose content is destined for a platform; internal notes are thread-only.

### 9.3 Transfer

Hand a chat to another agent: assignment update + `post_system_message` note ("Ana transferred this conversation to Rana") via the Â§2.5.5 RPC (GUC-sanctioned `sender_type='system'`).

### 9.4 Presence

Realtime Presence channels for online/away/busy dots; `agent_presence_log` persists intervals with close-out via `meta-presence` keepalive-on-pagehide + the `*/15 * * * *` force-close sweep (LO-10).

### 9.5 Collision Detection

`conversation_viewers` rows (own-row insert policies, LO-3) + Realtime broadcast: "Ana is also viewing this chat" banner; heartbeat cleanup deletes `viewed_at < now() - 5 min`.

---

## 10. Bulk Messaging & Proactive Outreach (C2 + HI-1 redesign + v5 WhatsApp broadcasts)

### 10.0 What is and isn't possible (stakeholder statement â€” per platform)

| Platform | Within window | Outside window | Bulk to cold recipients |
|---|---|---|---|
| **Facebook** | Freeform promotional â€” allowed | Tags (narrow uses) + RN/OTN opt-in tokens | No (no marketing tag, no template approvals) |
| **Instagram** | Freeform promotional â€” allowed | Tags only (RN/OTN believed absent) | No |
| **WhatsApp** | Freeform + interactive â€” allowed **FACT** | **Approved templates (MARKETING/UTILITY/AUTHENTICATION)** **FACT** | **YES â€” template broadcasts to any customer base, capped by tier** **FACT** |
| **TikTok** | Replies â€” allowed | Blocked in v1 | **Not in v1** (UI greys it out with the explanation "TikTok restricts business-initiated messaging; v1 is reply-only") |

**WhatsApp is the out-of-window marketing channel** if that is a hard requirement. **No per-user opt-in prompt is needed on WhatsApp** (unlike FB/IG RN) **FACT** â€” but the business-level opt-out registry (`messaging_opt_outs`) is honored on every send (Â§5.2 check 2). Pricing is per-24h-conversation by category (marketing/utility/auth/service) **FACT** â€” the category is recorded per campaign for the cost view.

### 10.1 Audience Builder

Filter by: tags (business-scoped, array-contains â€” LO-8), order count (via `orders.business_id` â€” Â§2.5.4/ME-9), last order date, **platform (multi-select â€” resolved to per-platform recipient rows, M14)**, `has_ordered` tag, active notification subscription per topic (FB/IG, taxonomy vocabulary â€” HI-1), within-window status (live preview: "N reachable now / M via subscription / K via template / L not reachable"). Excludes `messaging_opt_outs` (global rows + per-channel rows, Â§2.2.15 â€” ME-13).

### 10.2 Opt-In Prompt Flow (HI-1 â€” FB/IG only; corrected: structured template, no custom CTA)

1. Business creates an **opt-in prompt saved message** (category `optin_prompt`). The creation UI is a **topic + frequency picker**: topic from Meta's fixed taxonomy, frequency from daily/weekly/monthly, plus a short title. The row stores `{topic, frequency, title}` in `optin_config` (Â§2.2.9 + Â§2.5.6 trigger enforces presence). **There is no freeform CTA message.**
2. Agent (or an automation `send_optin_prompt` action referencing the saved message) sends the prompt in-conversation (within window): `meta-send` constructs the Send API body with `attachment.type='template'`, `payload.template_type='notification_messages'`, the topic, and the `re_prompt_interval` **[VERIFY IN PHASE 0 SPIKE: exact field names/limits]**. **Meta renders the prompt card with its own Allow/Manage controls.**
3. Customer accepts â†’ Meta fires the `messaging_optins` webhook â†’ the webhook upserts `notification_subscriptions` (token, topic, type='recurring', expires_at per-topic validity) **[VERIFY spike: exact payload shape]**
4. Campaigns for that topic can now include this customer **outside the 24h window**, sending via the notification token
5. Agents see a per-conversation subscription chip (topic label + active/expired); "Re-prompt" re-sends the template when a subscription lapses (subject to per-topic re-prompt rules â€” recorded from the spike)

**OTN â€” distinct flow:** category `optin_one_time` saved messages store `{title, payload}`; the send uses `payload.template_type='one_time_notif'`; the same `messaging_optins` webhook delivers a one-usable token; the single follow-up send consumes it (`status='used'`). **[VERIFY spike: exact payload + token semantics]**

### 10.3 Send-Time Eligibility (per recipient row â€” v5 per-platform branches)

For each `(campaign, customer, channel_account)` recipient:

```
eligible(if) =
  NOT opted_out (global or per-channel for this business â€” ME-13, all platforms)
  AND platform_branch:

  FB/IG:
    (now() < conversation.window_expires_at)                     -- in-window freeform
    OR (campaign.notification_topic IS NOT NULL                   -- ME-10: topic linkage
        AND EXISTS (SELECT 1 FROM notification_subscriptions s
                    WHERE s.channel_account_id = campaign.channel_account_id
                      AND s.conversation_id = recipients.conversation_id
                      AND s.topic = campaign.notification_topic
                      AND s.status = 'active'
                      AND (s.expires_at IS NULL OR s.expires_at > now())))

  WhatsApp (FACT):
    (now() < conversation.window_expires_at)                     -- in-window freeform
    OR (campaign.template_id IS NOT NULL                         -- template broadcast
        AND t.status = 'APPROVED'                                 -- Â§2.2.16 status gate
        AND t.channel_account_id = campaign.channel_account_id)   -- same account
    AND tier_budget_remaining > 0                                  -- daily tier (Â§5.3)
        -- business-initiated conversations/24h by tier; enforced atomically by
        -- consume_rate_limit_token's daily counter

  TikTok:
    now() < conversation.window_expires_at                        -- reply-first; nothing else in v1
```

Ineligible rows are marked `skipped` with `skip_reason` (`opted_out` / `outside_window_no_path` / `no_conversation` / `quota_exhausted` / `tier_exhausted` / `template_not_approved`) and reported in the campaign dashboard â€” the design never attempts API-rejected sends.

### 10.4 Campaign Engine (`meta-bulk-send` â€” ME-3 single trigger + LO-11 atomic counters)

Triggered **only** by the sweep (no independent cron):

1. **Atomic campaign claim** (first statement â€” concurrent sweep invocations dispatching the same campaign race here; the loser exits): `UPDATE bulk_campaigns SET status='sending', started_at=now() WHERE id=$1 AND status='scheduled' RETURNING *` â€” zero returned rows â†’ exit immediately
2. **Platform branch** (from the campaign's channel account): FB/IG â†’ existing v4 path (freeform or notification-token sends); WhatsApp â†’ template sends (build the `type: "template"` body from the APPROVED row, substitute variables); TikTok â†’ not reachable (campaigns on TikTok accounts cannot be scheduled â€” the builder blocks creation)
3. Build audience from `audience_filter` â†’ insert `bulk_campaign_recipients` rows (with `business_id`, `channel_account_id`, `conversation_id`, `subscription_id` backfilled); set `total_recipients` (frozen from this build)
4. Loop (bounded-concurrency promise pool of 10-20 in-flight sends, each consuming one Â§5.3 token):
   - For each pending recipient: re-check Â§10.3 eligibility at send time (the window may close mid-campaign; the WhatsApp tier counter depletes)
   - Eligible â†’ insert outbox row (`subscription_id` set if that's the path; `template_id` set for WhatsApp; `metadata.campaign_id` stamped â€” ME-11) â†’ send â†’ update recipient status; counters increment **atomically per statement** (LO-11): `SET sent_count = sent_count + 1` / `failed_count = failed_count + 1` / `opted_out_count = opted_out_count + 1` â€” never read-modify-write across the pool
   - Ineligible â†’ `skipped` + reason; `skipped_count` incremented atomically
5. On completion (or pause/failure): campaign `completed`/`paused`/`failed`, `completed_at`, final counters
6. **Campaign dashboard**: sent / failed / skipped (by reason) / opted-out counts, per-channel breakdown, **WhatsApp cost view** (recipient count Ã— per-conversation pricing by `whatsapp_pricing_category` â€” estimated cost, reconciled against the actual platform invoice), and **tier-projection** ("at the 250 tier, a 5,000-recipient broadcast takes ~20 days; upgrade the tier in Meta Business Manager to send faster" â€” FACT: tiered caps are the binding constraint on broadcast duration).

### 10.5 Opt-Out Handling (ME-13 + v5 WhatsApp keyword auto-opt-out)

**Decision: opt-outs suppress ALL outbound messaging on ALL platforms â€” 1:1 agent replies, automation auto-replies, and campaigns â€” except the transactional tags `ACCOUNT_UPDATE` and `POST_PURCHASE`.** The check lives in `meta-send`'s Â§5.2 matrix (row 2), which every outbound path funnels through.

- **Inbound keyword detection ("STOP", "UNSUBSCRIBE", "OPT OUT") â†’ insert `messaging_opt_outs` (global row) + audit log.** On WhatsApp this is the *only* opt-out mechanism â€” the platform has no STOP handling of its own **FACT**, so the business's keyword detection IS the compliance layer. The keyword list is configurable per business and applies to all platforms (a Messenger user who texts STOP is suppressed identically).
- Agents can undo an opt-out (admin/inbox.manage DELETE, audited)
- The composer shows the persistent opt-out banner (Â§3.6) so agents know before typing

### 10.6 Fallback If the FB/IG Spike Disproves Subscription Assumptions (defensive design â€” HI-1 extended)

If Phase 0 verification finds Recurring Notifications/OTN behave differently than assumed â€” **including the case where the structured `notification_messages` template is unavailable to this app, requires additional allowlisting, or the taxonomy/payload differs**:

- `notification_subscriptions` table remains valid (it may stay empty; the spike updates the webhook parser and the Â§2.2.10 topic CHECK)
- FB/IG campaign eligibility collapses to **within-window-only**: `eligible = NOT opted_out AND now() < window_expires_at`
- The opt-in prompt flow is disabled behind a feature flag; the UI hides the topic picker and subscription chips
- HUMAN_AGENT remains the 7-day out-of-window path for tagged human-support messages (subject to its own Advanced Access approval â€” ME-8)
- Everything else (audience builder, recipient tracking, dashboards) is unaffected
- **WhatsApp's template path is entirely independent of this fallback** â€” it does not depend on any Meta-app-level feature beyond the WABA itself

No schema change required by the fallback â€” that is the point of this design.

### 10.7 TikTok Fallback (v5 NEW â€” design posture)

TikTok bulk messaging is **not in v1** and the `CampaignBuilder` greys it out with an explanatory tooltip. If the Phase 0 spike or the approval outcome changes the picture:

- **Approval granted + window confirmed at 48h**: TikTok outbound becomes a Phase 6 adapter task (Â§14); bulk remains deferred to a post-v1 cycle (the reply-first posture makes campaigns low-value relative to WhatsApp's template broadcasts).
- **Approval denied or API differs materially**: TikTok stays **inbound read-only** â€” messages still land in the unified inbox, get customers resolved, tagged, assigned, and ordered-from; only outbound is unavailable. The `tiktok.ts` adapter throws `tiktok_unavailable` and the composer shows "TikTok messaging is read-only in this version."

---

## 11. Analytics and Reporting

**The `platform` column is already on every analytic-bearing table** (`conversations.platform`, `campaigns` via their channel account, the MV below) â€” per-platform breakdowns are a GROUP BY, not a redesign.

### 11.1 Materialized View (A2 + ME-11 filter â€” v5: platform is a grouping key)

```sql
CREATE MATERIALIZED VIEW public.inbox_analytics_daily AS
SELECT
  c.business_id,
  DATE_TRUNC('day', m.created_at) AS day,
  c.platform,                       -- v5: per-platform breakdown
  COUNT(DISTINCT c.id) AS conversations_count,
  COUNT(m.id) FILTER (WHERE m.direction = 'inbound') AS inbound_messages,
  COUNT(m.id) FILTER (WHERE m.direction = 'outbound') AS outbound_messages,
  -- ME-11: exclude conversations with no customer message (outbound campaign
  -- seeds) â€” their first_agent_response_at is campaign-time and would skew
  -- first-response-time toward ~0
  AVG(EXTRACT(EPOCH FROM (c.first_agent_response_at - c.created_at)))
    FILTER (WHERE c.last_customer_message_at IS NOT NULL) AS avg_first_response_seconds,
  AVG(EXTRACT(EPOCH FROM (c.closed_at - c.created_at)))
    FILTER (WHERE c.last_customer_message_at IS NOT NULL) AS avg_resolution_seconds
FROM public.conversations c
JOIN public.messages m ON m.conversation_id = c.id
GROUP BY 1, 2, 3;

SELECT cron.schedule('refresh-inbox-analytics', '0 2 * * *',
  'REFRESH MATERIALIZED VIEW public.inbox_analytics_daily');
```

(The trigger-side guard Â§2.5.1 already refuses to SET `first_agent_response_at` for campaign/bot/system/internal-note rows and for outbound-only conversations; the MV filter is the belt-and-braces analytics-side guard.)

### 11.2 Key Metrics

| Metric | Source |
|--------|--------|
| Avg First Response Time (per platform) | `conversations.first_agent_response_at - created_at` (campaign/bot-free â€” ME-11) |
| Avg Resolution Time (per platform) | `closed_at - created_at` |
| Messages/Day, Conversations/Day (per platform) | `messages` / `conversations` |
| Agent performance | `messages.sender_agent_id` aggregation |
| Conversion rate (per platform) | `conversation_orders` JOIN `conversations` |
| Peak hours | `messages` hour-of-day heatmap |
| Saved-message usage | `message_outbox.saved_message_id` |
| **WhatsApp template usage** (v5) | `message_templates` + outbox `template_id` aggregation |
| **WhatsApp campaign cost** (v5) | `bulk_campaigns.whatsapp_pricing_category` Ã— recipient counts (Â§10.4) |
| Opt-out rate | `messaging_opt_outs` over time |
| Campaign reach | `bulk_campaign_recipients` status breakdown (per platform) |
| Subscription rate (FB/IG) | `notification_subscriptions` per topic (taxonomy vocabulary) |

### 11.3 CSAT (M15 fix â€” no delayed out-of-window send)

On `status â†’ resolved`:

1. **Immediately** insert a CSAT prompt message ("How was your experience? Reply 1-5") â€” the customer's window is open in the common case (resolution follows a recent exchange); the prompt is a saved message (category `csat`). **On WhatsApp outside the window, the CSAT prompt requires an approved UTILITY template** (or is deferred â€” the same rule as any other outbound).
2. If the window is closed at resolution time and no template is available: **do not send** â€” render an in-thread CSAT prompt chip for the agent to send later, or include it in the next in-window interaction (automation `keyword_match` rule can attach it)
3. Parse numeric replies, store `conversations.metadata->>'csat_score'`

---

## 12. Multi-Tenant Support

**Unchanged from v4 â€” the model is platform-agnostic by construction:**

- One business â†’ N pages + M IG accounts + K WhatsApp numbers + 1 TikTok connection â†’ N+M+K `channel_accounts` rows. **A business can mix platforms freely** (Â§2.2.1's CHECK enforces per-row identity purity, not per-business platform purity).
- Cross-business isolation: RLS on reads; permission-gated writes (Â§2.3); **relational-consistency EXISTS clauses on every cross-referencing INSERT** (Â§2.3 â€” HI-3) so a member of Business A cannot reference Business B's conversation, channel, or order even inside a row whose `business_id` they control; the `meta-send` re-assert (Â§5.1) covers the service-role path; service-role edge functions additionally filter by `business_id` explicitly.
- The `customers` table is global-by-design (shared across businesses, verified) â€” customer *tags/notes* are business-scoped (H1); platform aliases are global (a PSID/wa_id/open_id maps to one customer system-wide â€” merge-race duplicates handled per Â§7.1/Â§7.2, LO-14).
- **WhatsApp note:** a `wa_id` is a phone number â€” globally unique by nature. Two businesses messaging the same WhatsApp number resolve to the SAME global customer row, each with business-scoped conversations/tags â€” identical to how FB PSIDs behave today. No new isolation concern.

---

## 13. Security

### 13.1 Token Encryption & Decryption (C4 + CR-1 â€” pgcrypto-correct; v5: two token columns)

**CR-1 root cause and fix:** On Supabase, **pgcrypto's functions live in the `extensions` schema** (verified convention: this repo installs pg_net/pg_cron `WITH SCHEMA extensions`; no migration enables pgcrypto or references `pgp_sym_*`/`gen_random_bytes` â€” zero references repo-wide â€” so the hosted default applies and `CREATE EXTENSION IF NOT EXISTS pgcrypto;` without `SCHEMA` is a silent no-op on an existing project). Postgres resolves `pgp_sym_encrypt`, `pgp_sym_decrypt`, `dearmor`, and `gen_random_bytes` through `search_path`; v2's `search_path = public, vault` made them **unresolvable**. The design therefore: (1) creates the extension explicitly in `extensions`; (2) sets every pgcrypto-calling function's `search_path = public, vault, extensions`; (3) **additionally schema-qualifies every pgcrypto call**; (4) the DO block schema-qualifies too (DO blocks have no function-level SET clause).

**Store**: encryption key in Supabase Vault (Phase 1 migration):

```sql
-- CR-1: pgcrypto MUST be created in the extensions schema (Supabase convention;
-- matches the repo's pg_net/pg_cron pattern). The IF NOT EXISTS guard makes
-- this idempotent; WITH SCHEMA makes the no-op case safe too.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- One-time (idempotent): key used ONLY for channel token PGP encryption.
-- DO blocks have no function-level SET search_path â€” the pgcrypto call is
-- schema-qualified directly (CR-1).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'inbox_token_key') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),   -- schema-qualified (CR-1)
      'inbox_token_key'
    );
  END IF;
END $$;
```

**Encrypt on write** â€” SECURITY DEFINER trigger (owner `postgres`, so it can read the vault regardless of the inserting role). **v5: covers both `access_token_encrypted` and `refresh_token_encrypted`** (TikTok) with the same sentinel contract:

```sql
-- CR-1: search_path INCLUDES extensions AND every pgcrypto call is
-- schema-qualified â€” belt and braces.
CREATE OR REPLACE FUNCTION public.encrypt_channel_token()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault, extensions AS $$
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
    extensions.pgp_sym_encrypt(NEW.access_token_encrypted, v_key), 'armor');
  -- v5: the TikTok refresh token uses the same vault key + same contract
  IF NEW.refresh_token_encrypted IS NOT NULL
     AND NEW.refresh_token_encrypted NOT LIKE '-----BEGIN PGP MESSAGE-----%' THEN
    NEW.refresh_token_encrypted := encode(
      extensions.pgp_sym_encrypt(NEW.refresh_token_encrypted, v_key), 'armor');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_encrypt_channel_token
  BEFORE INSERT OR UPDATE OF access_token_encrypted, refresh_token_encrypted
  ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.encrypt_channel_token();
```

**Decrypt for sends** â€” the exact RPC `meta-send` calls; it never touches the vault or key directly:

```sql
CREATE OR REPLACE FUNCTION public.get_channel_access_token(p_channel_account_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault, extensions AS $$   -- CR-1: extensions in the path
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
  RETURN extensions.pgp_sym_decrypt(extensions.dearmor(v_cipher), v_key);  -- schema-qualified (CR-1)
END;
$$;
REVOKE ALL ON FUNCTION public.get_channel_access_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_channel_access_token(uuid) TO service_role;

-- v5 NEW: the TikTok refresh flow needs the refresh token (the daily cron and
-- the on-401 adapter path both call this; service-role only).
CREATE OR REPLACE FUNCTION public.get_channel_refresh_token(p_channel_account_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, vault, extensions AS $$
DECLARE
  v_key text;
  v_cipher text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets
   WHERE name = 'inbox_token_key' LIMIT 1;
  SELECT refresh_token_encrypted INTO v_cipher FROM public.channel_accounts
   WHERE id = p_channel_account_id;
  IF v_key IS NULL OR v_cipher IS NULL THEN
    RAISE EXCEPTION 'refresh token unavailable';
  END IF;
  RETURN extensions.pgp_sym_decrypt(extensions.dearmor(v_cipher), v_key);
END;
$$;
REVOKE ALL ON FUNCTION public.get_channel_refresh_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_channel_refresh_token(uuid) TO service_role;
```

**Phase 1 smoke test (CR-1):** insert a throwaway `channel_accounts` row per platform type with a plaintext token, read it back via `get_channel_access_token`, assert round-trip equality, delete the rows. This proves the extension schema, the search_path, and the vault key all resolve before any real channel connects.

Notes:

- The v1 `current_setting('app.encryption_key')` pattern is **deleted** â€” GUCs can't be set on PostgREST sessions; the Vault IS the key store.
- Reading `channel_accounts` via the client never exposes plaintext (encrypted columns only; both decrypt RPCs are service-role-only).
- Frontend "connect" flows never handle raw tokens either â€” the settings UI calls `meta-connect-account` (Â§4.7; JWT + `inbox.manage` check server-side) which inserts the row; the trigger encrypts.

### 13.2 Webhook Signature Verification

Mandatory on every POST. **Meta family (FB/IG/WhatsApp):** app-level `META_APP_SECRET` from edge env (Â§4.3), `X-Hub-Signature-256`. **TikTok:** its own scheme, verified in `tiktok-webhook` only **[VERIFY IN PHASE 0 SPIKE]** â€” never share a verifier across the two families. GET verification by unique `webhook_verify_token` (Â§4.2). Reject any POST without a valid signature.

### 13.3 Rate Limiting on Client-Facing Endpoints

- `meta-send`: requires valid Supabase JWT; verifies the caller is a member of the outbox row's business (service-role check) AND that the row was created by them or is a sweep-claimed retry; 10 req/sec per user (edge middleware)
- All cron-triggered functions (`meta-outbox-sweep`, `meta-token-probe`, `tiktok-token-refresh`): verify `x-cron-secret` header against the vault token (verified repo pattern). `meta-bulk-send` accepts only the sweep's internal dispatch token (same vault mechanism, distinct secret).

### 13.4 Audit Logging (L9)

Reuse `audit_log` + `logAction()` â€” `entity_type` is free text (verified), so define inbox constants in `src/lib/inboxAudit.ts`:

```typescript
export const INBOX_ENTITY = {
  CONVERSATION: 'inbox.conversation',
  MESSAGE: 'inbox.message',
  CAMPAIGN: 'inbox.campaign',
  CHANNEL_ACCOUNT: 'inbox.channel_account',
  AUTOMATION_RULE: 'inbox.automation_rule',
  SAVED_MESSAGE: 'inbox.saved_message',
  TEMPLATE: 'inbox.message_template',         // v5
  OPT_OUT: 'inbox.opt_out',
  SUBSCRIPTION: 'inbox.notification_subscription',
} as const;
```

Logged: sends, assignments/transfers, conversation close, campaign create/start/pause, rule CRUD, saved-message CRUD, template create/status-change, opt-outs, channel connect/disconnect, cross-business refusals (HI-3).

### 13.5 PII Handling

- Customer phone/email in `customers` (existing protection standards)
- **WhatsApp raises the PII surface**: `wa_id` is a phone number, stored in `conversations.platform_recipient_id` and `customer_aliases.value`. Both are RLS-protected (member-read only); aliases are excluded from any client-facing export without the `customers.edit` permission. Same protection class as `customers.phone`.
- Message `content` at-rest encryption deferred (future; noted)
- GDPR: data export (customer + conversations + messages) and deletion endpoints (right-to-erasure scopes: messages content nulled, aliases removed, customer anonymized). **Meta platforms require deletion via the app's data deletion callback URL** (Phase 0 checklist). **TikTok likewise requires a data-deletion callback if it processes user data â€” confirm in the Phase 0 spike.**

---

## 14. Implementation Phases

### Phase 0: Platform Access, App Review, WABA & the TikTok Spike (Weeks 1-3, parallel) â€” C5 + ME-8 + LO-9

Runs FIRST and partly parallel with Phase 1. **Nothing that touches real customer traffic may ship before the review gates pass.** The three access tracks are independent â€” WhatsApp can ship first.

- [ ] **Track A â€” Meta app (FB/IG):** create the app; add Messenger + Instagram products; Business Verification (docs: company registration) week 1; set `META_APP_SECRET`; configure the webhook URL + verify token
- [ ] **Track A â€” App Review submission (week 1-2):** permissions `pages_messaging`, `pages_show_list`, `instagram_basic`, `instagram_manage_messages` + Advanced Access; **usage submissions for HUMAN_AGENT (message tag), `notification_messages` (RN), `one_time_notif` (OTN)** (ME-8); prepare screencasts of the inbox flows (built against dev-mode tester data) + permission justifications
- [ ] **Track A â€” Dev-mode strategy (LO-9):** Development Mode allows app-role users (admin/dev/tester) â€” team members install the app on their **personal FB/IG accounts**; each tester must **message the test page from their personal account**; **IG testers must first follow + interact with the test professional account**; verify each tester's first DM works in week 1. Phases 2-6 build and test entirely against this traffic
- [ ] **Track B â€” WhatsApp (FACT-based, independent):** Meta Business Account + WABA + phone number + **business verification**; subscribe the WABA to the shared `meta-webhook` (`messages`, `message_template_status_update`); create the **permanent system-user token**; connect one test number and send/receive a real message end-to-end (this is the v5 "ship-first" path â€” it does not depend on Track A's App Review)
- [ ] **Track C â€” TikTok (SPIKE-GATED):** TikTok for Business + developer app + **Business Messaging API access application â€” APPROVAL REQUIRED (invite/review-based; may take weeks or be denied)**; configure `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`; complete the OAuth flow once access lands
- [ ] **Verification spike (week 2-3, hard dependency for Phase 6-7 design and Â§5/Â§10 assumptions):**
  - [ ] **RN (HI-1)**: exact `notification_messages` template payload field names, the **current fixed topic taxonomy** (record verbatim â€” updates the Â§2.2.10/Â§2.2.11 CHECK constraints in Phase 7), the `messaging_optins` webhook payload for RN acceptance, token send mechanics, per-topic validity windows and re-prompt rules, quota semantics
  - [ ] **OTN (HI-1)**: `one_time_notif` button-template payload, its `messaging_optins` webhook shape (distinct from RN), token single-use semantics
  - [ ] **HUMAN_AGENT capability check (ME-8)**: app Advanced Access status for the tag; dev-mode trial behavior; live-mode failure mode recorded
  - [ ] IG messaging: confirm RN/OTN availability (assumed absent â€” Â§10.6 fallback); media/attachment support matrix (per M7)
  - [ ] **WhatsApp**: messaging throughput per-second limit (assumed ~80 req/s â€” Â§5.3), tier escalation mechanics + quality-rating behavior, template submission + `message_template_status_update` payload, interactive button/list payload shapes and limits (3/10), media two-hop download TTL (~5 min), per-24h-conversation pricing categories for the cost view
  - [ ] Page messaging rate limits (bucket capacity/refill assumptions, Â§5.3) and bulk-send policy constraints
  - [ ] Graph API: pick + pin `META_GRAPH_VERSION` (current stable); snapshot the version-deprecation date; write into `_shared/meta-api.ts`
  - [ ] Profile API: name/profile_pic fields, rate limits (Â§5.7), and the WhatsApp profile-lookup endpoint
  - [ ] **TikTok (everything)**: webhook signature scheme + GET challenge handshake; event payload shapes (message, delivery/read if any); send endpoint + payload; rate limits; the exact 48h reply-window semantics; `open_id`/`conversation_id` model; refresh-token rotation behavior; data-deletion callback requirement
- [ ] Data deletion callback URL configuration (GDPR, Â§13.5) â€” Meta + TikTok if applicable
- [ ] **Gates**: (A) review approval + Advanced Access = FB/IG "live traffic" gate; (B) WABA verification + system-user token = WhatsApp live gate (**independent of A**); (C) TikTok approval = TikTok outbound gate (Phase 6). Buffer for rejections: up to 2 resubmission cycles in the week 1-3 window; further slippage delays Phases 7-9 only, since 2-6 run on dev-mode traffic, and does not delay the WhatsApp path at all.

### Phase 1: Foundation (Week 1-2) â€” BLOCKS ALL OTHER PHASES

Dependencies: none (parallel with Phase 0's app setup).

- [ ] Migration A: enums + `app_permission` additions (Â§2.1 â€” the 4-value `channel_platform`, extended `message_content_type`, ALTER TYPE in its OWN file; **never merge with Migration C â€” ME-15**; CI asserts Migration A contains zero CREATE POLICY/CREATE TABLE)
- [ ] Migration B: `customer_aliases` type CHECK extension (4 platform types) + lookup index + **order_sources seeds ('fb/ig', 'whatsapp', 'tiktok')** (Â§2.2.0)
- [ ] **Migration B2 (C3-1/NEW-1 fix): `202609XX03a_omni_inbox_orders_business.sql` runs BEFORE Migration C** â€” `orders.business_id` column (nullable) + `resolve_order_business` trigger + one-time business_id backfill + `has_ordered` tag backfill (Â§2.5.4)
- [ ] Migration C: all tables **in DEPENDENCY order** (H3-1: `message_outbox` AFTER `saved_messages`/`notification_subscriptions`/`bulk_campaigns`/`message_templates`; `message_templates` before the outbox FK), indexes (Â§2.4), RLS policies in final shape **with HI-3/ME-5/LO-3 relational-consistency clauses** (Â§2.3), triggers + functions (Â§2.5), the platform-aware rate-limit RPCs + seeding trigger (Â§5.3), `claim_outbox_batch` RPC (Â§5.6), token encrypt/decrypt incl. the refresh-token column + `get_channel_refresh_token` **with extensions-schema pgcrypto** (Â§13.1), realtime publication (Â§2.7)
- [ ] Migration D: storage bucket + policies (Â§2.6)
- [ ] Migration E: realtime publication + replica identity (Â§2.7)
- [ ] Vault: `inbox_token_key`, `meta_outbox_cron_token`, `meta_bulk_dispatch_token` secrets; presence close-out cron (Â§17.5). **LO-B5 fix: the 30s outbox-sweep cron schedule is NOT created here** â€” created in Phase 2 when `meta-outbox-sweep` first exists
- [ ] **CR-1 smoke test**: round-trip encrypt/decrypt of throwaway channel accounts (one per platform type â€” incl. a TikTok-shaped row with a refresh token) â€” migration C verified end-to-end before any UI exists
- [ ] Edge Function: `meta-webhook` â€” GET verification (Â§4.2) + POST verify-first **platform router** skeleton (Â§4.3; FB/IG branches first, WhatsApp branch gated on Track B)
- [ ] Edge Function: `meta-send` â€” claim + cross-business re-assert + per-platform decision matrix + adapter dispatch (Â§5.1/Â§5.2)
- [ ] Edge Function: `meta-connect-account` â€” FB/IG OAuth flow + manual fallback (Â§4.7) + WhatsApp connect path
- [ ] Shared Modules: `_shared/meta-api.ts` (Graph version, HMAC, token RPC, `processOutboxRow`) + `_shared/platforms/{types,index,facebook,instagram,whatsapp,tiktok}.ts`
- [ ] Settings UI: channel account connect flows â€” FB/IG (Â§4.7), WhatsApp (Â§4.7 path B)
- [ ] `npm i @tanstack/react-virtual` (M1 â€” verified absent)
- [ ] Extract `normalizeBdPhone` â†’ `src/lib/normalizePhone.ts` (imported by AddOrderDialog + the WhatsApp webhook resolver; Â§6.1/Â§7.1)
- [ ] Regenerate `src/integrations/supabase/types.ts` via `supabase gen types typescript`

### Phase 2: Core Messaging (Week 3-5) â€” DEPENDS ON Phase 1 (FB/IG on dev-mode testers; WhatsApp on Track B)

- [ ] **FB/IG webhook**: full event parsing â€” messages, postbacks, deliveries, reads (H2), optins (HI-1)
- [ ] **WhatsApp webhook branch**: `whatsapp_business_account` router arm â€” `messages[]` (type â†’ content_type mapping incl. interactive/location/sticker/document), per-wamid `statuses[]`, `message_template_status_update` â†’ `message_templates` (Â§4.3/Â§4.4)
- [ ] Webhook: customer resolution â€” **alias-first for FB/IG (`.limit(2)` â€” LO-14) and phone-first for WhatsApp (Â§7.1)** + profile fetch + fallback names
- [ ] Webhook: conversation upsert + message insert with `platform_timestamp` + idempotency; **attachments async** (meta_url/media_id + download_pending only â€” ME-12)
- [ ] Sweep: attachment download task live, **incl. the WhatsApp two-hop media fetch** (Â§5.5)
- [ ] **Outbox sweep cron schedule created here (LO-B5)** â€” `meta-outbox-sweep` deployed, then the 30s pg_net cron (Â§5.6)
- [ ] **Storage-policy smoke test** (ME-7): upload/read/list as member + as viewer + cross-tenant attempt refused
- [ ] **Rate-limit smoke test** (HI-B1): a fresh connected account on EACH platform â†’ `consume_rate_limit_token(account_id)` returns `true`; WhatsApp row asserts `daily_used` increments
- [ ] React: `OmniInbox` 3-panel responsive layout (Â§3.1) + mobile master-detail (Â§3.1.1)
- [ ] React: `ConversationList` â€” tuple keyset pagination (LO-7), tag array-contains filters (LO-8), **platform filter chips + `PlatformBadge` (Â§3.2.1)**
- [ ] React: `MessageThread` with `@tanstack/react-virtual`; `MessageBubble` with delivery ticks + interactive/location/sticker/template rendering
- [ ] React: `ComposerBar` â€” outbox insert + meta-send invoke; platform-aware window banner (Â§4.5); **two-handler outbox realtime (ME-2)**
- [ ] React: UX states â€” empty/loading/skeletons; failed/blocked inline retry incl. `timeout_unknown` + `tiktok_window_closed` + `template_not_approved` handling (Â§3.6)
- [ ] React: unread management, `mark_conversation_read` RPC on view
- [ ] Routing: `/inbox` route
- [ ] **Milestone: chat with a real customer from your site on FB/IG (dev-mode) AND WhatsApp (live, Track B).**

### Phase 3: Agent Collaboration (Week 5-6)

- [ ] Round-robin auto-assignment in the webhooks (all platforms)
- [ ] `AssignmentDropdown`; manual assign/reassign (LO-13 stale-check)
- [ ] Internal notes + @mentions
- [ ] Transfer flow + `post_system_message` notes (Â§2.5.5)
- [ ] Realtime Presence (online/offline/away/busy) + `meta-presence` interval close-out (LO-10)
- [ ] Collision detection (`conversation_viewers` + broadcast + heartbeat cleanup; LO-3 policies live from Phase 1)
- [ ] Supervisor view (admin filters by assignment across the business, across platforms)

### Phase 4: Commerce Integration (Week 6-8) â€” re-budgeted per HI-2: 1-2 days for the dialog work + regression

- [ ] `ContextSidebar` tabs (Customer, Orders, Products, Notes) + cross-platform conversation list in the Customer tab (Â§7.4)
- [ ] `CustomerProfileCard` (+ `has_ordered` badge â€” triggers live from Phase 1)
- [ ] **Modify `AddOrderDialog`** (Â§6.1): `onCreated({orderId, orderNumber, customerId})` payload + `prefill {customerName, customerPhone(raw), sourceName('fb/ig'|'whatsapp'|'tiktok')}` + `catalogScope {storeIds}` â€” ~30 lines; **regression-check the orders page** (no prefill, ignores the new arg)
- [ ] `OrderLinker`: link existing (business-scoped search) + create new (prefilled, catalog-scoped) â†’ `conversation_orders` insert â†’ trigger (b) â†’ `post_system_message` order confirmation
- [ ] Phone-merge: `merge_chat_customers` RPC (Â§7.2) + auto-merge at order creation using the `onCreated` payload
- [ ] Order status change â†’ system message (+ optional customer notify: POST_PURCHASE tag FB/IG / UTILITY template WhatsApp â€” opt-out-suppressed, ME-13)
- [ ] `ProductQuickSend` (MiniProductCatalog + generic template on FB/IG; WhatsApp image/product message â€” M7)
- [ ] `InvoiceQuickSend` (install `html-to-image` â†’ invoiceHtml â†’ hidden-node render â†’ toPng â†’ Storage upload â†’ image attachment send â€” HI-B5; no PDF lib in repo, verified)
- [ ] `CourierQuickSend` (courier_shipments â†’ tracking message)
- [ ] **Milestone: the order-taking workflow works end to end on every connected platform.**

### Phase 5: CRM and Tagging (Week 8-9)

- [ ] `TagManager` + `customer_tags` CRUD (business-scoped)
- [ ] `customer_notes` CRUD
- [ ] Filter conversation list by customer tags (array-contains â€” LO-8) and by platform
- [ ] Cross-platform customer merge UI (uses the Â§7.2 RPC; feeds from the duplicate-alias warnings queue â€” LO-14)
- [ ] `QuickReplyPicker` + quick replies CRUD
- [ ] `ConversationSearch` (FTS RPC capped at 50 â€” Â§3.7, LO-12; spans all platforms + the archive)

### Phase 6: Automation + TikTok Inbound (Week 9-11)

- [ ] Automation rules CRUD settings page (incl. `platform_scope` picker + `send_whatsapp_template` action)
- [ ] Rules engine in the webhooks + sweep auto-reply dispatch (Â§8.1 â€” sweep fired only when rows inserted, ME-16)
- [ ] Keyword matching; `order_created` (business-resolved via Â§2.5.4) / `tag_added` triggers
- [ ] Idle-timeout cron; away messages (business hours)
- [ ] SLA escalation timers; auto-close
- [ ] **TikTok inbound (always ships â€” gated only on webhook access, not the send approval):** `tiktok-webhook` with the spike-verified signature scheme; `InternalEvent` normalization; alias-first customer resolution (`tiktok_open_id`); conversation + message persistence; platform badge + 48h window banner; read-only composer state
- [ ] **TikTok outbound (GATED on Phase 0 approval + spike):** `tiktok.ts` adapter send path + `tiktok-token-refresh` daily cron + on-401 refresh + `refresh_token_expires_at` alert; if the gate fails, the adapter throws `tiktok_unavailable` and the read-only posture persists (Â§10.7)

### Phase 7: Bulk Messaging & Proactive Outreach (Week 10-12) â€” design per Phase 0 spike findings; CHECKs finalized here

- [ ] Saved messages library CRUD (internal drafts; opt-in categories carry structured `optin_config` â€” HI-1)
- [ ] **`TemplateManager` (v5 NEW):** WhatsApp template composer (name/language/category/components) â†’ Meta submission â†’ status table (PENDING/APPROVED/REJECTED + rejection reason), fed by the `message_template_status_update` webhook (Â§2.2.16)
- [ ] **Topic/finalization migration**: update the Â§2.2.10/Â§2.2.11 topic CHECK constraints to the taxonomy recorded in the Phase 0 spike (verbatim list)
- [ ] Opt-in prompt flow: `OptInPromptCard` (FB/IG only â€” Â§10.2) + `notification_subscriptions` capture (feature-flagged fallback Â§10.6)
- [ ] Audience builder UI (with live reachability preview â€” now including the WhatsApp template-reachable count; min_orders via `orders.business_id` â€” ME-9)
- [ ] Campaign creation + scheduling (FB/IG topic pick â€” ME-10; WhatsApp APPROVED template pick + pricing category; **TikTok greyed out with explanation â€” Â§10.7**) + per-platform recipient rows
- [ ] `meta-bulk-send` engine: atomic campaign claim (ME-3), per-platform eligibility (Â§10.3), bounded-concurrency dispatch, atomic counters (LO-11), **WhatsApp tier-projection in the dashboard** (Â§10.4)
- [ ] Campaign dashboard (sent/failed/skipped-by-reason/opted-out; per-platform breakdown; WhatsApp estimated cost)
- [ ] Opt-out keyword detection + registry + audit (ME-13: check wired into `meta-send`, not just campaigns)
- [ ] Message-tag support in the FB/IG composer (permission-gated, per-tag policy labels, Advanced-Access-aware â€” ME-8)

### Phase 8: Analytics and Polish (Week 12-14)

- [ ] Materialized view + daily refresh cron (Â§11.1 â€” platform grouping, ME-11 filters)
- [ ] Analytics dashboard (Recharts â€” verified in deps): metrics table Â§11.2, per-platform breakdowns, WhatsApp cost view
- [ ] CSAT flow (immediate-send design Â§11.3)
- [ ] Retention jobs (Â§17.5): presence/viewers purge + presence interval close-out (LO-10), outbox terminal-state purge, 12-month message archive, `meta_webhook_events` 30-day purge
- [ ] **Data-quality follow-up (ME-9)**: list orders with NULL `business_id` + ambiguous `selling_points (type, woo_store_id)` mappings for manual business assignment
- [ ] E2E tests (Playwright) on dev-mode + WhatsApp traffic
- [ ] Load test simulation (mock webhook spout at 500 convos/day rate, mixed platforms)

### Phase 9: Hardening (Week 14-16)

- [ ] `meta-token-probe` weekly cron with **per-platform probe endpoints** (FB/IG page id; WhatsApp phone_number_id; TikTok token-expiry read) + admin alerts + reconnection flow polish (Â§5.4)
- [ ] `tiktok-token-refresh` daily cron + `refresh_token_expires_at` 14-day pre-expiry alert (Â§5.4)
- [ ] Dead-letter handling for permanently failed outbox rows (audit + report; `timeout_unknown` rows get the verify-in-thread affordance â€” LO-6)
- [ ] Webhook retry behavior verification (respond < 20s; processing off the critical path â€” attachments already async from Phase 2, ME-12)
- [ ] Monitoring/alerting: outbox failure rate > 5%, webhook processing > 10s, queue depth, Graph API error-rate (incl. version-deprecation warnings Â§5.0, permission errors on unapproved tag usage â€” ME-8), **WhatsApp quality-rating drop** (tier downgrade risk), **TikTok refresh failures**
- [ ] Docs for business admins (connect pages/accounts/numbers, review status, WhatsApp template approval workflow, opt-in campaigns explainer, service-window explainer per platform, opt-out semantics â€” ME-13)

**Phase dependency graph:** 0 (three independent tracks) â†’ (2+ for live traffic; WhatsApp gated ONLY on Track B); 1 â†’ 2 â†’ {3, 4, 5} â†’ 6 (incl. TikTok inbound always) â†’ 7 â†’ 8 â†’ 9. Phases 2-6 testable on dev-mode + WhatsApp traffic regardless of FB/IG review status; Phase 7's FB/IG out-of-window features additionally gated on spike results + the topic-CHECK finalization; TikTok outbound gated on the Phase 0 approval (fallback Â§10.7).

---

## 15. Component Reuse Strategy (corrected â€” HI-2)

### 15.1 Reuse With Modification

| Component | Modification |
|---|---|
| `AddOrderDialog` | Three modifications (Â§6.1 â€” re-verified against source): (a) `onCreated` gains an optional `{orderId, orderNumber, customerId}` payload â€” the three values are already in scope at the call site (lines 810/837/778; invocation at 897); (b) `prefill {customerName, customerPhone (raw), sourceName}` â€” `source` state holds row **names** (lines 241/303) and the name string is what `orders.source` stores (line 817), so the prop carries the NAME; phone seeds raw because the dialog normalizes on save (line 779, `normalizeBdPhone` â€” BD-specific, documented limitation); (c) `catalogScope {storeIds}` filters the dialog's **self-fetched** catalog (lines 284-321 â€” no dataset props exist). NOT as-is. v5: the sourceName set widens to `'fb/ig' \| 'whatsapp' \| 'tiktok'`. |
| `MiniProductCatalog` | As-is, but caller supplies products/categories/stores (props verified: `products, categories, productCatMap?, stores, onSelectProduct, onAddCustomItem, className?`) â€” the inbox fetches and passes a business-scoped catalog (L8). |
| `normalizeBdPhone` | **v5: extracted to `src/lib/normalizePhone.ts`** â€” imported by `AddOrderDialog` AND the WhatsApp webhook resolver (Â§7.1) so resolution and order-creation share one normalization. |

### 15.2 Pattern Reuse (adapted, not copied byte-for-byte)

| Pattern | Source | Inbox Application | Difference |
|---|---|---|---|
| Webhook HMAC verification | woo-webhook lines 86-120 | Same `crypto.subtle` HMAC flow for the Meta family | Woo compares base64 (`btoa`, line 104); Meta needs `sha256=` + lowercase hex (L1). TikTok uses a **separate verifier** (Â§4.3). |
| Customer resolution | woo-webhook lines 550-614 | **Two modes**: alias-first at webhook time for FB/IG/TikTok (no phone exists â€” H11; `.limit(2)` â€” LO-14); **phone-first for WhatsApp** (wa_id IS the phone â€” FACT); phone-first for order creation on all platforms | Input payload shapes differ per platform |
| Idempotency | woo-webhook lines 50-59 | `messages.platform_message_id` UNIQUE + `meta_webhook_events` log | Different table |
| **Atomic batch claim** | `claim_sync_queue_batch` (20260829000000) | `claim_outbox_batch` (Â§5.6) + the bulk campaign claim (Â§10.4) | Same `FOR UPDATE SKIP LOCKED` CTE shape, outer-recheck generalized (ME-1/ME-3) |
| Order creation flow | AddOrderDialog lines 774-903 | Unchanged inside the dialog | Payload + prefill + catalogScope added at the edges (HI-2) |
| RLS DO block | foundation lines 333-348 | Identical for SELECT policies (v5: `message_templates` in the array) | Write policies are per-class + permission-gated + relational-consistency EXISTS clauses (H7/HI-3) â€” new pattern |
| Cron â†’ edge function | 20260802065715 | Outbox sweep, token-probe, TikTok refresh, presence close-out | Same shape |
| Vault secret + getter RPC | 20260901000000 | Token key + decrypt RPCs (access + refresh) | New use â€” and pgcrypto now schema-correct (CR-1: `extensions` in search_path + schema-qualified calls) |
| Fuse.js search | AddOrderDialog 455-469 | Product search (inside MiniProductCatalog â€” already there) | â€” |
| Bulk actions bar | `OrderBulkActionsBar` | Conversation bulk operations | Same pattern |

### 15.3 New Components

All built on shadcn/ui primitives (`Button`, `Input`, `Badge`, `Card`, `Tabs`, `ScrollArea`, `Avatar`, `Tooltip`, `Popover`, `Command`, `Dialog`, `Sheet`/vaul):

v4 set: `OmniInbox`, `ConversationList` + `ConversationItem`, `MessageThread` + `MessageBubble`, `ComposerBar`, `ContextSidebar`, `CustomerProfileCard`, `TagManager`, `QuickReplyPicker`, `SavedMessagePicker`, `OptInPromptCard`, `CampaignBuilder`, `AssignmentDropdown`, `ConversationSearch`, `BulkActionBar`, `WindowBanner`, `AutomationRuleEditor` (inside `InboxSettings.tsx` â€” LO-B1), `AnalyticsDashboard` (in the analytics page â€” LO-B1).

**v5 additions:** `TemplateManager` (WhatsApp template composer + status table), `PlatformBadge` (+ `platformIcons.tsx` inline-SVG map â€” no new dependency).

---

## 16. Edge Cases and Failure Modes

### 16.1 Webhook Failures

| Scenario | Mitigation |
|----------|------------|
| Duplicate events | `UNIQUE(platform_message_id)` on messages; `meta_webhook_events` observability |
| Webhook endpoint down/slow | Platforms retry failed deliveries on undocumented schedules â€” the reliable contract is: **respond 200 within 20 seconds** (L7). Budget is engineered: attachment downloads are async from Phase 2 (ME-12), so only the message insert is on the critical path |
| Malformed payload | try/catch JSON.parse â†’ 400 + `meta_webhook_events` log |
| Non-numeric `entry.id` (Meta) | `/^\d+$/` guard, fail-closed skip, logged (LO-1) |
| Unknown channel_account | log + 404-equivalent skip (do not crash the batch) |
| **WhatsApp: message for an unregistered number** | The `phone_number_id` in the payload identifies the account; a message arriving for a number we don't have connected is logged and skipped (fail-closed) |
| Token invalid mid-processing | 401/190 â†’ `is_active=false` + admin alert (probe verifies weekly, Â§5.4); TikTok â†’ on-401 refresh + retry once, then flag |
| Attachment download slow/failed | Off the critical path by design (ME-12): placeholder chip â†’ sweep downloads (batch 25, 24h retry window) â†’ terminal `download_failed` flag + counter. **WhatsApp's ~5-min media URL TTL is why the two-hop fetch happens inside the sweep, not the webhook** (FACT) |
| **TikTok signature scheme unworkable in edge functions** | Fallback Â§10.7/Â§14: retire `tiktok-webhook`, inbound read-only via polling (or no TikTok at all); the platform-agnostic core is unaffected |

### 16.2 Send Failures

| Scenario | Mitigation |
|----------|------------|
| Window expired | Pre-checked (Â§5.2); UI composer disables + countdown; outbox â†’ `blocked_window` |
| **WhatsApp outside window without a template** | Composer swaps to the template picker (Â§3.6); a freeform outbox row created outside the window â†’ `blocked_window` (never sent) |
| **Template PENDING/REJECTED used in a send** | Send matrix check 3c â†’ `blocked_window` + `error_code='template_not_approved'`; the UI links to the template table |
| **TikTok outside 48h** | `blocked_window` + `error_code='tiktok_window_closed'`; composer shows the reply-only notice |
| HUMAN_AGENT eligible (7d, FB/IG) | Tag selector offered with permission gate AND Advanced-Access-aware disabled state (Â§4.5, ME-8) |
| Rate limit exhausted | Atomic bucket denies â†’ row stays pending with 1s retry (sweep) |
| **WhatsApp daily tier exhausted** | `consume_rate_limit_token` denies on the daily counter â†’ row stays pending; campaign dashboard shows the tier projection (Â§10.4); business upgrades the tier in Meta Business Manager |
| Customer opted out | Â§5.2 check 2: `cancelled` + `error_code='opted_out'` (except ACCOUNT_UPDATE/POST_PURCHASE tags) â€” ME-13 |
| Cross-business reference | Â§5.2 check 1: `failed` + `error_code='cross_business_refusal'`, audited (HI-3) |
| Customer blocked the account / thread unavailable | Platform error â†’ mark conversation `metadata->>'blocked'`, surface in UI |
| **Network timeout to the platform API** | **Never auto-retried** (LO-6): `failed` + `error_code='timeout_unknown'` + "possibly sent â€” verify in thread" affordance; manual retry (new outbox row) only after the agent confirms the thread â€” auto-retrying a lost-response send duplicates the customer message (no client dedup id on any platform) |
| Invalid/too-large attachment | Rejected in composer pre-upload (8MB image / 25MB file checks â€” client-side, ME-6) |

### 16.3 Concurrency

| Scenario | Mitigation |
|----------|------------|
| Two agents send simultaneously | Outbox claim is atomic (Â§1.5); messages serialize per account rate bucket |
| Assign vs transfer race | Optimistic `updated_at` check on conversation UPDATE (Â§3.3, LO-13) |
| Concurrent sweeps (cron + webhook-fired) | `claim_outbox_batch` `FOR UPDATE SKIP LOCKED` + outer status recheck (ME-1) |
| Concurrent campaign dispatches | Atomic campaign claim `WHERE status='scheduled'` â€” loser exits (ME-3) |
| **Concurrent WhatsApp daily-counter resets** | The reset+increment is a single UPDATE with a CASE (Â§5.3) â€” no read-modify-write, no lost reset |
| Webhook arrives while typing | Normal race; INSERT-only realtime appends the bubble |
| Realtime drop | TanStack refetch on reconnect + channel re-subscription handler |

### 16.4 Data Integrity

| Scenario | Mitigation |
|----------|------------|
| Customer deletes a platform account | **No reliable webhook** for deletion (handovers â‰  deletion) â€” detect via send failures (recipient unreachable errors) and mark conversation inactive; periodic profile-fetch check marks stale senders (L6) |
| Business disconnects a channel | `channel_accounts.is_active=false`; webhook skips the account; UI banner |
| Cascade delete business | `ON DELETE CASCADE` on all FKs |
| Orphaned outbox rows | Sweep requeues â‰¤5 attempts; 7-day-old pending rows cancelled + audited |
| Duplicate platform aliases (race) | `UNIQUE (channel_id, token)` on subscriptions; alias insert ON CONFLICT DO NOTHING; Â§7.1 `.limit(2)` + oldest-customer pick (LO-14); `merge_chat_customers` dedup-deletes before moving (Â§7.2) |
| Delayed webhook retry with older timestamp | GREATEST guards in Â§2.5.1 â€” window/ordering can never rewind (ME-4) |
| Archive copy rerun | `messages_archive` PK on `id` + `ON CONFLICT (id) DO NOTHING` â€” monthly runs idempotent (LO-5) |
| **A template is REJECTED after campaigns queued it** | Send-time re-check (Â§5.2 check 3c) catches the status change; queued recipient rows go `skipped` + `template_not_approved` â€” no failed API calls |
| **WhatsApp quality-rating drop mid-campaign** | Tier downgrade does not affect in-flight sends already claimed; subsequent sends see the reduced daily counter and the dashboard surfaces the rating change (Â§17.2) |

---

## 17. Production Concerns

### 17.1 Cost Estimation (Supabase Pro) â€” L10 + ME-16 honest recount, v5 adjusted

- **Database**: ~17 new tables (v4's 16 + `message_templates`); 500MB-2GB after 1 year at 500 convos/day across platforms
- **Edge Functions** (assumptions stated, per ME-16):
  - Webhook invocations: 500 convos/day Ã— ~10-20 events/conversation (messages + deliveries + reads + WhatsApp per-message statuses â€” **heavier than FB/IG's watermark**, one event per message) â‰ˆ **12-25K/day**
  - Sends: â‰ˆ 5-10K/day
  - Sweep cron: 2,880 invocations/day (30s interval)
  - Sweep fires from the webhook â€” counted: only when automation inserts outbox rows (20-50% of inbound) â‰ˆ **2-10K/day**
  - **TikTok refresh: 1 invocation/day** (negligible)
  - **Total: â‰ˆ 21-43K/day** â€” within Pro-tier function invocation limits, with headroom
- **Realtime**: ~20 agents Ã— 1 connection â€” trivial
- **Storage**: attachments + invoice images + WhatsApp media â€” 10-60GB/year depending on media volume
- **WhatsApp conversation pricing (FACT):** per-24h-conversation by category â€” a marketing-led bulk campaign to 5,000 recipients is a real, budgeted cost; the campaign dashboard's cost projection (Â§10.4) exists so the business approves volume before sending, not after

### 17.2 Monitoring

- All edge function errors â†’ `meta_webhook_events` + structured logs
- Alerts: token invalidation (any platform), outbox failure rate > 5%, webhook processing > 10s, queue depth > 500, Graph API error-rate spikes (incl. permission errors on unapproved tag usage â€” ME-8; `timeout_unknown` rate â€” LO-6), version-deprecation warnings (Â§5.0), duplicate-alias warnings (LO-14), **WhatsApp quality-rating change** (GREENâ†’YELLOWâ†’RED precedes a tier downgrade â€” surface it as a proactive alert), **TikTok refresh failures + 14-day pre-expiry on the refresh token**
- Dashboard: outbox depth, active conversations by platform, agents online, campaign progress, WhatsApp tier + daily-counter usage

### 17.3 Migration Safety

- Policies/seed/backfill statements are re-run-safe (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP POLICY IF EXISTS` before every CREATE). **L3-4 correction: `CREATE TYPE` has no `IF NOT EXISTS` in PG** â€” enum/table/trigger creations are NOT re-runnable as written; enum creation is wrapped in the standard DO-block `EXISTS (SELECT 1 FROM pg_type ...)` guard in the actual migration files. Supabase migrations run exactly once; the claim is scoped to what's actually true.
- Test against a production snapshot before applying; rollback scripts per migration
- Never drop columns from existing tables; only add (exceptions, both intentional and non-destructive: the `customer_aliases` type CHECK replacement â€” additive values; the `order_sources` seeds â€” new rows)
- **ME-15 file discipline:** Migration A (ALTER TYPE) never merged with Migration C (casts the new values); CI assertion in the Phase 1 PR
- **v5 dependency-order note:** `message_templates` must be created before `message_outbox` (FK) and before `bulk_campaigns` (FK); the rate-limit columns are new columns on an existing v4-shaped table â€” in a greenfield v5 deployment they are part of Migration C; in a v4â†’v5 upgrade they are an additive ALTER on `rate_limit_buckets` + `channel_accounts` (never a destructive rebuild)

### 17.4 Testing Strategy

- Unit: automation rules engine (incl. `platform_scope` filtering), window calculator (incl. NULL + 7d tag + GREATEST-rewind cases â€” ME-4 + the 48h TikTok case), eligibility function (Â§10.3 â€” all three platform branches), send-decision matrix incl. opt-out/timeout/template/tier classes (Â§5.2), saved-message variable substitution, optin_config validation, **WhatsApp content-type mapping + template variable substitution**
- Integration: webhook pipeline with recorded payloads per platform (postbacks, deliveries, reads, optins â€” RN + OTN shapes; WhatsApp `messages[]`/`statuses[]`/`message_template_status_update`); send-decision matrix; rate bucket atomicity under concurrent claims **incl. the WhatsApp daily counter + rollover**; `claim_outbox_batch` under concurrent sweeps; campaign claim under concurrent dispatch; RLS tests incl. **cross-tenant insert refusals (HI-3) and sender-spoofing refusals (ME-5)**
- E2E: webhook â†’ UI display â†’ reply â†’ delivery-status ticks (Playwright, dev-mode + WhatsApp traffic)
- Load: mock webhook spout at target rate, mixed platforms; concurrent-agent message storms

### 17.5 Data Retention (M13 + LO-5 + LO-10)

pg_cron jobs (scheduled in Phase 8):

| Data | Policy |
|---|---|
| `meta_webhook_events` | Purge > 30 days (webhook_events precedent) |
| `agent_presence_log` | Purge > 90 days; **interval close-out sweep force-closes `ended_at IS NULL AND started_at < now() - interval '24 hours'`** (LO-10) |
| `conversation_viewers` | Heartbeat cleanup: delete `viewed_at < now() - 5 min`; purge > 90 days |
| `message_outbox` terminal states | Purge sent/failed/cancelled/blocked > 90 days (campaign stats already aggregated) |
| `messages` | **Archive** (not delete): copy > 12 months old to `messages_archive` then delete from hot table â€” monthly cron, batched |

**LO-5: hand-written archive DDL** (`LIKE ... INCLUDING DEFAULTS` silently drops the CHECK constraints and the platform_message_id UNIQUE â€” the archive is deliberately constraint-free, STATED): the archive is read-only cold history; the PK on `id` makes the monthly copy idempotent; the FTS index keeps search spanning the archive.

```sql
CREATE TABLE public.messages_archive (
  id                    uuid PRIMARY KEY,             -- PK: copy reruns are idempotent (LO-5)
  business_id           uuid NOT NULL,
  conversation_id       uuid NOT NULL,
  direction             public.message_direction NOT NULL,
  sender_type           public.message_sender_type NOT NULL,
  sender_id             text,
  sender_agent_id       uuid,
  content_type          public.message_content_type NOT NULL,
  content               text,
  attachments           jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  platform_message_id  text,                          -- NO unique constraint (by design â€” archive is cold history)
  platform_timestamp    bigint,
  is_read               boolean NOT NULL DEFAULT true,   -- archived rows are read by definition
  read_at               timestamptz,
  delivery_status       text,
  delivered_at          timestamptz,
  customer_read_at      timestamptz,
  created_at            timestamptz NOT NULL,
  archived_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.messages_archive SET (autovacuum_enabled = true);
-- H3-4 fix: RLS on the archive â€” without it, Supabase default privileges grant
-- SELECT to `authenticated` and every business's archived history is readable
-- cross-tenant via PostgREST. Same member-read shape as Â§2.3.
ALTER TABLE public.messages_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can read messages_archive" ON public.messages_archive;
CREATE POLICY "Members can read messages_archive" ON public.messages_archive FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR is_business_member(business_id));
-- FTS so ConversationSearch spans the archive â€” M3-5/ME-B4 fix: the Â§3.7 RPC
-- gains a messages_archive arm (UNION, dedup by conversation_id, shared caps:
-- 2000-row scan ceiling split across both tables, 50-conversation result cap)
CREATE INDEX idx_messages_archive_fts ON public.messages_archive
  USING GIN (to_tsvector('english', content)) WHERE content_type = 'text';
CREATE INDEX idx_messages_archive_conversation ON public.messages_archive(conversation_id, created_at);
-- monthly cron: INSERT INTO messages_archive (cols...) SELECT cols..., now() FROM messages
--   WHERE created_at < now() - interval '12 months' ... DELETE ... (batched, 10k rows/pass,
--   INSERT ... ON CONFLICT (id) DO NOTHING for rerun safety)

-- Presence close-out sweep (LO-10; L3-3 fix: */15 = every 15 minutes â€”
-- the previous '15 * * * *' was hourly-at-minute-15, not a sweep):
SELECT cron.schedule('close-presence-intervals', '*/15 * * * *', $$
  UPDATE public.agent_presence_log
     SET ended_at = started_at + interval '1 hour'   -- conservative close
   WHERE ended_at IS NULL AND started_at < now() - interval '24 hours';
$$);
```

---

## 18. Files to Create (Summary)

### Migrations
- `supabase/migrations/202609XX01_omni_inbox_enums.sql` (enums incl. 4-value `channel_platform` + extended `message_content_type`; app_permission â€” ADD VALUE isolated; NEVER merged with 03 â€” ME-15)
- `supabase/migrations/202609XX02_omni_inbox_alias_types.sql` (customer_aliases CHECK â€” 4 platform types; order_sources seeds â€” 'fb/ig'/'whatsapp'/'tiktok')
- `supabase/migrations/202609XX03a_omni_inbox_orders_business.sql` (**FIRST â€” C3-1 fix: orders.business_id + resolve_order_business + backfills**, ordered before ANY statement that references orders.business_id)
- `supabase/migrations/202609XX03_omni_inbox_schema.sql` (tables in DEPENDENCY order â€” H3-1: `message_templates` + `saved_messages`/`notification_subscriptions`/`bulk_campaigns` BEFORE `message_outbox`; the platform-aware `window_expires_at` generated column; the 4-platform `channel_accounts`; rate buckets with daily-tier columns; indexes; RLS incl. HI-3/ME-5/LO-3 clauses; triggers/functions; RPCs â€” `claim_outbox_batch`, `search_conversations`, `consume_rate_limit_token` (v5), `seed_rate_limit_bucket` (v5), `get_channel_access_token`, `get_channel_refresh_token` (v5), `merge_chat_customers`, `mark_conversation_read`, `post_system_message`, `resolve_order_business`; vault; pgcrypto-in-extensions)
- `supabase/migrations/202609XX04_omni_inbox_storage.sql` (bucket + policies â€” ME-6/ME-7)
- `supabase/migrations/202609XX05_omni_inbox_realtime.sql` (publication + replica identity incl. message_outbox)
- `supabase/migrations/202609XX06_omni_inbox_archive.sql` (messages_archive DDL + **RLS + member-read policy (H3-4)** + FTS + cron schedules)

### Edge Functions (`supabase/functions/`)
- `meta-webhook/index.ts` (Meta family: FB/IG/WhatsApp platform router â€” Â§4.3)
- `tiktok-webhook/index.ts` (**v5 NEW** â€” separate signature verification, shared normalization â€” Â§4.3)
- `meta-send/index.ts` (unified outbox processor â†’ platform adapters)
- `meta-outbox-sweep/index.ts` (batch claim, downloads, campaign dispatch â€” all platforms)
- `meta-bulk-send/index.ts` (FB/IG RN/OTN + WhatsApp template broadcast engine)
- `meta-token-probe/index.ts` (weekly, per-platform endpoints)
- `tiktok-token-refresh/index.ts` (**v5 NEW** â€” daily + on-401 refresh)
- `meta-connect-account/index.ts` (FB/IG OAuth + WhatsApp connect + TikTok OAuth)
- `meta-presence/index.ts` (LO-10 close-out endpoint)
- `_shared/meta-api.ts` (Graph version, HMAC, token RPCs, `processOutboxRow`)
- `_shared/platforms/types.ts`, `index.ts` (v5 NEW â€” the dispatcher)
- `_shared/platforms/facebook.ts`, `instagram.ts`, `whatsapp.ts` (v5 NEW), `tiktok.ts` (v5 NEW, spike-gated)
- `_shared/normalize.ts` (v5 NEW â€” `InternalEvent` shape shared by both webhook functions)

### React Components (`src/components/inbox/`)
`OmniInbox`, `ConversationList`, `ConversationItem`, `MessageThread`, `MessageBubble`, `ComposerBar`, `ContextSidebar`, `CustomerProfileCard`, `ProductQuickSend`, `InvoiceQuickSend`, `CourierQuickSend`, `OrderLinker`, `TagManager`, `QuickReplyPicker`, `SavedMessagePicker`, `OptInPromptCard`, `CampaignBuilder`, `AssignmentDropdown`, `ConversationSearch`, `BulkActionBar`, `WindowBanner`, **`TemplateManager` (NEW)**, **`PlatformBadge` (NEW)**, **`platformIcons.tsx` (NEW)** â€” 24 files

### Modified Files
- `src/components/orders/AddOrderDialog.tsx` (onCreated payload + prefill + catalogScope â€” Â§6.1, HI-2)
- `src/lib/normalizePhone.ts` (**v5 NEW** â€” extracted from AddOrderDialog; imported by both the dialog and the WhatsApp webhook resolver)
- `package.json` (+`@tanstack/react-virtual`, +`html-to-image`)
- `src/integrations/supabase/types.ts` (regenerated)

### Hooks (`src/hooks/`)
`useConversations`, `useMessages`, `useMessageInserts`, `useOutboxStatus`, `useConversationRealtime`, `useAgentPresence`, `useWindowStatus` (v5: platform-aware), **`usePlatformCapabilities` (v5 NEW â€” per-platform composer capability set)**

### Settings Pages
- `src/pages/InboxSettings.tsx` (channel accounts per platform incl. `TemplateManager` + WhatsApp tier display; saved messages; automation rules with `platform_scope`; quick replies; campaigns)

---

## 19. v5 Revision Changelog (what changed from v4, and why)

**Platforms:** FB/IG only â†’ **Facebook Â· Instagram Â· WhatsApp Â· TikTok**.

| Area | v4 | v5 | Rationale |
|---|---|---|---|
| `channel_platform` | `('facebook','instagram')` | `+ 'whatsapp','tiktok'` | Four-platform support |
| `channel_accounts` | page_id / ig_account_id + page token | `+ waba_id, phone_number_id, refresh_token_encrypted, token_expires_at, refresh_token_expires_at, whatsapp_tier, whatsapp_quality_rating`; TikTok client key/secret in edge env | Per-platform credentials; WhatsApp tiers; TikTok's expiring tokens |
| Service window | static `+ interval '24 hours'` | **platform-aware STORED generated column** (tiktok 48h, others 24h) | TikTok's believed 48h window; CASE on a row column is immutable-safe |
| HUMAN_AGENT 7d | In the window conversation | **Unchanged â€” send-time check, FB/IG-only** | Tag is on the outbox row, not the conversation; platform-specific |
| `message_content_type` | 12 values | `+ document, location, sticker, interactive`; **`template` restored** | WhatsApp message-type fidelity; templates are real platform artifacts again |
| Templates | Removed (C2 â€” correct for FB/IG) | **`message_templates` RE-INTRODUCED, WhatsApp-only by CHECK**, with the PENDINGâ†’APPROVED/REJECTED lifecycle + `message_template_status_update` webhook handling | FACT: WhatsApp requires pre-approved templates for business-initiated/out-of-window |
| `rate_limit_buckets` | per-second token bucket | `+ daily_capacity / daily_used / daily_reset_at`; platform-aware seeding (WhatsApp: tier-based daily cap + ~80/s pacing; TikTok conservative until spike) | FACT: WhatsApp caps business-initiated conversations per 24h by tier |
| Webhooks | FB/IG object routing | **Platform router** on `page`/`instagram`/`whatsapp_business_account` (shared Meta signature) + **separate `tiktok-webhook`** with its own verifier | Same machinery, different payloads; TikTok â‰  Meta HMAC |
| Delivery tracking | Watermark (FB/IG) | Documented per-platform: **WhatsApp per-wamid `statuses[]`** vs FB/IG watermark | FACT: WhatsApp statuses are per-message |
| Send path | `_shared/meta-api.ts` FB/IG | `_shared/platforms/{facebook,instagram,whatsapp,tiktok}.ts` adapters behind one dispatcher | Platform-agnostic core, pluggable adapters |
| Send decision matrix | 3 window/tag/subscription rows | **Per-platform branches**: WhatsApp template (APPROVED + same-account) / TikTok blocked out-of-window (`tiktok_window_closed`) / FB/IG unchanged | Platform window + template semantics |
| Bulk campaigns | FB/IG RN/OTN + within-window | `+ template_id` + `whatsapp_pricing_category`; **approved-template broadcasts capped by tier**; TikTok excluded (greyed out) | FACT: WhatsApp template broadcasts need no per-user opt-in; tier is the cap |
| Opt-out | STOP keyword â†’ registry | **Unchanged â€” and now the ONLY opt-out layer for WhatsApp** (no platform STOP handling) | FACT |
| Customer resolution | Alias-first (no phone in payload) | **WhatsApp: phone-first direct match** via shared `normalizeBdPhone` â†’ `customers.phone` + alias for uniformity; others alias-first | FACT: wa_id IS the phone; this codebase is phone-first |
| Token management | Long-lived page token; weekly probe | WhatsApp: **permanent system-user token** (probe only); **TikTok: daily refresh cron + on-401 + refresh-token pre-expiry alert**; two decrypt RPCs | FACT / FACT-pattern |
| UI | FB/IG composer | **`PlatformBadge` + platform filter chips + per-platform composer states** (WhatsApp template picker outside window; TikTok reply-only notice) | Four-platform UX |
| Analytics | Conversation-level | **Platform as a grouping key** in the MV; WhatsApp template usage + campaign cost metrics | Platform breakdowns; WhatsApp pricing |
| Phases | 10 phases / ~14 weeks, FB App Review on the critical path | 10 phases / ~16 weeks; **WhatsApp ships first-class in Phase 2 independent of FB/IG App Review** (WABA verification is separate); **TikTok Phase 0 spike + approval, Phase 6 inbound (always), Phase 6-7 outbound gated**, read-only fallback | De-risked access; independent platform tracks |
| Files | 6 migrations / 8 functions / 21 components | 7 migrations / 12 functions / 24 components (+`_shared/platforms/`) | New surfaces |

**Spike gates preserved (never silently asserted):** TikTok mechanics end-to-end **[VERIFY IN PHASE 0 SPIKE]**; FB/IG RN/OTN payload shapes and topic taxonomy **[VERIFY IN PHASE 0 SPIKE]**; HUMAN_AGENT Advanced Access (ME-8); WhatsApp per-second limit ~80 req/s; Graph API version pin. The Â§10.6 fallback (FB/IG) and Â§10.7 fallback (TikTok) both land with **no schema change required** â€” that is the measure of the design's optionality.
