# Omni-Inbox Implementation Plan v1

## Comprehensive Facebook/Instagram Chat Integration for Shohozbiz

**Date:** 2026-09-10
**Stack:** Vite + React + TypeScript + shadcn/ui + Supabase (PostgreSQL 14.5) + Supabase Edge Functions (Deno)
**Scale Target:** 5-20 agents, 100-500 conversations/day/account, multiple business accounts

---

## Codebase Context Summary

This plan was built after analyzing the following existing systems:

| System | Key Files | Reuse Opportunity |
|--------|-----------|-------------------|
| Multi-tenant foundation | `supabase/migrations/20260904000100_multi_business_foundation.sql` | `businesses`, `user_business_access`, `brands`, `is_business_member()`, `has_role()` RLS pattern |
| Role system | `types.ts` lines 3323+ | `app_role` enum (`admin`, `staff`, `viewer`), `user_roles` table, `custom_roles` with `app_permission[]` |
| Orders | `src/components/orders/AddOrderDialog.tsx` (1200+ lines) | Full order creation flow with product search, customer resolution, Pathao locations, measurements, AI parsing |
| Product catalog | `src/components/orders/MiniProductCatalog.tsx`, `src/components/pos/ProductCatalog.tsx` | Fuse.js-based product search, variation selection, category filtering |
| Invoice | `src/lib/invoiceHtml.ts`, `src/components/pos/InvoicePrint.tsx` | HTML invoice generation ready for PDF rendering |
| Courier | `src/components/dashboard/CourierDispatchStation.tsx`, `supabase/functions/pathao-courier/index.ts` | Pathao integration with tracking, dispatch, store links |
| Customers | `customers` table, `customer_aliases` table | Global phone/email lookup, alias-based deduplication across stores |
| Webhooks | `supabase/functions/woo-webhook/index.ts` | Established pattern: Deno.serve, HMAC-SHA256 via `crypto.subtle`, idempotency via `webhook_events` table, service role client |
| Supabase client | `src/integrations/supabase/client.ts` | Typed client with `Database` type, localStorage auth |
| UI primitives | `src/components/ui/` | shadcn/ui: `Resizable` (react-resizable-panels), `ResponsiveDialog`, `SearchableSelect`, `Badge`, `ScrollArea`, etc. |
| Audit logging | `audit_log` table, `src/lib/auditLog.ts` | `logAction(action, entity_type, entity_id, details)` |
| Order timeline | `order_timeline` table, `src/lib/orderTimeline.ts` | Event-sourced order history |
| Selling points | `selling_points` table | Already has `facebook` and `instagram` type enums |

---

## 1. Architecture

### 1.1 Data Flow Overview

```
Meta Platform (FB Messenger / Instagram DM)
    |
    | HTTPS POST (webhook events)
    v
Supabase Edge Function: meta-webhook (/functions/v1/meta-webhook)
    |
    |-- Verify X-Hub-Signature-256 (HMAC SHA-256)
    |-- Idempotency check (platform_message_id UNIQUE)
    |-- Upsert conversation (match platform_conversation_id)
    |-- Insert message
    |-- Resolve/create customer (via customers + customer_aliases)
    |-- Trigger automation rules (auto-reply, auto-tag, auto-assign)
    |-- Write to outbox queue if response needed
    |
    v
Supabase PostgreSQL (messages, conversations, customers tables)
    |
    | Supabase Realtime (postgres_changes subscription)
    v
React Inbox UI (TanStack Query + supabase realtime)
    |
    | Agent sends reply
    v
Supabase Edge Function: meta-send (/functions/v1/meta-send)
    |
    |-- Check 24h window
    |-- Rate limit (token bucket per channel_account)
    |-- Call Meta Send API
    |-- Update message delivery status
    v
Meta Send API (graph.facebook.com / graph.instagram.com)
```

### 1.2 Why Supabase Edge Functions

The existing codebase already uses Deno edge functions extensively (`supabase/functions/woo-webhook/index.ts`, `pathao-courier/index.ts`, etc.). The woo-webhook function establishes the exact pattern we follow: `Deno.serve`, CORS headers, `crypto.subtle.importKey` for HMAC verification, service-role Supabase client, idempotency checks. No separate backend server is needed.

### 1.3 Edge Functions Required

| Function | Purpose | Method |
|----------|---------|--------|
| `meta-webhook` | Receive all Meta webhook events (verification GET + event POST) | GET/POST |
| `meta-send` | Send messages via Meta Graph API with rate limiting | POST (authenticated) |
| `meta-template-submit` | Submit message templates to Meta for approval | POST (authenticated) |
| `meta-bulk-send` | Process bulk campaign batches from queue | POST (service role, cron-triggered) |
| `meta-token-refresh` | Refresh expiring page access tokens | POST (cron-triggered) |

### 1.4 Realtime Delivery Strategy

Use Supabase Realtime `postgres_changes` subscriptions scoped by `business_id`:

- **Conversation list**: Subscribe to `conversations` table filtered by `business_id` for live updates to unread counts, last_message_at, assignment changes
- **Message thread**: Subscribe to `messages` table filtered by `conversation_id` for new messages appearing in the active thread
- **Presence**: Use Supabase Realtime Presence channels for agent online/offline/typing indicators within a conversation
- **Broadcast**: Use Realtime Broadcast for ephemeral events (typing indicators, collision detection) that should not persist in the database

Edge case: At 500 convos/day with 20 agents, Realtime connections are well within Supabase limits (max ~200 concurrent connections per project on Pro plan). Each agent's browser holds one connection with multiple channel subscriptions.

### 1.5 Message Sending Pipeline

All outbound messages go through an **outbox queue** pattern rather than direct API calls from the frontend:

1. Agent clicks send -> insert row into `message_outbox` table with status `pending`
2. Edge function `meta-send` polls or is triggered via pg_notify
3. Function checks 24h rule compliance
4. Function applies token bucket rate limiting (per `channel_account_id`)
5. Function calls Meta Graph API
6. On success: update outbox status to `sent`, insert into `messages` table
7. On failure: update outbox status to `failed`, schedule retry with exponential backoff
8. On 24h violation: update outbox status to `blocked_24h`, notify agent

This decouples the UI from Meta API latency and provides automatic retry semantics.

---

## 2. Database Schema

All new tables follow the existing multi-tenant pattern: every table carries `business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE`, and RLS policies use `is_business_member(business_id) OR has_role(auth.uid(), 'admin'::app_role)`.

### 2.1 New Enums

```sql
-- Add to existing app_permission enum
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.manage';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.send_messages';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.bulk_send';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.manage_templates';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.view_analytics';

-- New enums
CREATE TYPE public.channel_platform AS ENUM ('facebook', 'instagram');
CREATE TYPE public.conversation_status AS ENUM ('open', 'assigned', 'waiting', 'resolved', 'closed');
CREATE TYPE public.conversation_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE public.message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE public.message_sender_type AS ENUM ('customer', 'agent', 'system', 'bot');
CREATE TYPE public.message_content_type AS ENUM (
  'text', 'image', 'video', 'audio', 'file',
  'product_card', 'invoice_pdf', 'courier_info',
  'order_confirmation', 'template', 'quick_reply',
  'internal_note'
);
CREATE TYPE public.outbox_status AS ENUM ('pending', 'sending', 'sent', 'failed', 'blocked_24h', 'cancelled');
CREATE TYPE public.template_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'disabled');
CREATE TYPE public.campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'completed', 'paused', 'failed');
CREATE TYPE public.automation_action_type AS ENUM ('auto_reply', 'auto_tag', 'auto_assign', 'auto_close', 'escalate', 'send_template');
```

### 2.2 Core Tables

```sql
-- ============================================================================
-- Channel Accounts: Meta Page/IG account connections per business
-- ============================================================================
CREATE TABLE public.channel_accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform                 public.channel_platform NOT NULL,
  account_name             text NOT NULL,
  page_id                  text,                    -- FB Page ID
  ig_account_id            text,                    -- Instagram Account ID
  access_token_encrypted   text NOT NULL,           -- pgcrypto encrypted
  webhook_verify_token     text NOT NULL,           -- Random token for Meta webhook verification
  app_secret               text,                    -- For signature verification
  permissions              text[] DEFAULT '{}',
  token_expires_at         timestamptz,
  is_active                boolean NOT NULL DEFAULT true,
  last_connected_at        timestamptz,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, page_id),
  UNIQUE (platform, ig_account_id)
);
CREATE INDEX idx_channel_accounts_business ON public.channel_accounts(business_id);
CREATE TRIGGER set_channel_accounts_updated_at BEFORE UPDATE ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ============================================================================
-- Conversations
-- ============================================================================
CREATE TABLE public.conversations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id        uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  platform                  public.channel_platform NOT NULL,
  platform_conversation_id  text NOT NULL,          -- Meta's conversation/thread ID
  platform_recipient_id     text NOT NULL,          -- PSID (FB) or IG scoped ID
  customer_id               uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  assigned_agent_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status                    public.conversation_status NOT NULL DEFAULT 'open',
  priority                  public.conversation_priority NOT NULL DEFAULT 'normal',
  tags                      text[] NOT NULL DEFAULT '{}',
  last_message_at           timestamptz,
  last_customer_message_at  timestamptz,           -- Critical for 24h rule calculation
  last_agent_message_at     timestamptz,
  unread_count              integer NOT NULL DEFAULT 0,
  snoozed_until             timestamptz,
  closed_at                 timestamptz,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  -- Idempotency: same platform conversation can only exist once per channel account
  UNIQUE (channel_account_id, platform_conversation_id)
);
CREATE INDEX idx_conversations_business_status ON public.conversations(business_id, status);
CREATE INDEX idx_conversations_assigned_agent ON public.conversations(assigned_agent_id, status) WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX idx_conversations_last_message ON public.conversations(business_id, last_message_at DESC);
CREATE INDEX idx_conversations_customer ON public.conversations(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_conversations_tags ON public.conversations USING GIN (tags);
CREATE INDEX idx_conversations_unread ON public.conversations(business_id) WHERE unread_count > 0;
CREATE TRIGGER set_conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ============================================================================
-- Messages
-- ============================================================================
CREATE TABLE public.messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction             public.message_direction NOT NULL,
  sender_type           public.message_sender_type NOT NULL,
  sender_id             text,                       -- Platform sender ID or auth.users.id
  sender_agent_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- For outbound/notes
  content_type          public.message_content_type NOT NULL DEFAULT 'text',
  content               text,                       -- Text body or JSON for structured types
  attachments           jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{url, type, size, storage_path}]
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb, -- Platform-specific data
  platform_message_id   text,                       -- Meta's message ID for dedup
  is_read               boolean NOT NULL DEFAULT false,
  read_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- Idempotency: prevent duplicate message processing from Meta retries
  UNIQUE (platform_message_id)
);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at ASC);
CREATE INDEX idx_messages_business_time ON public.messages(business_id, created_at DESC);
CREATE INDEX idx_messages_sender_agent ON public.messages(sender_agent_id) WHERE sender_agent_id IS NOT NULL;
-- Partial index for unread messages only
CREATE INDEX idx_messages_unread ON public.messages(conversation_id) WHERE is_read = false AND direction = 'inbound';

-- ============================================================================
-- Message Outbox: Queue for outbound messages
-- ============================================================================
CREATE TABLE public.message_outbox (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  content_type          public.message_content_type NOT NULL,
  content               text NOT NULL,
  attachments           jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_id           uuid,                       -- If sending a template message
  template_variables    jsonb,                      -- Variable substitution values
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
CREATE INDEX idx_outbox_pending ON public.message_outbox(status, next_retry_at) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_outbox_conversation ON public.message_outbox(conversation_id);
CREATE INDEX idx_outbox_channel ON public.message_outbox(channel_account_id, status);

-- ============================================================================
-- Conversation-Order Links
-- ============================================================================
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

-- ============================================================================
-- Customer Tags
-- ============================================================================
CREATE TABLE public.customer_tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tag           text NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, tag)
);
CREATE INDEX idx_customer_tags_customer ON public.customer_tags(customer_id);
CREATE INDEX idx_customer_tags_tag ON public.customer_tags(tag);

-- ============================================================================
-- Customer Notes (CRM free-text)
-- ============================================================================
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

-- ============================================================================
-- Quick Replies (saved responses per business)
-- ============================================================================
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

-- ============================================================================
-- Message Templates (Meta-approved templates for proactive messaging)
-- ============================================================================
CREATE TABLE public.message_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  platform_template_id  text,                       -- Meta's template ID after approval
  name                  text NOT NULL,
  category              text NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  language              text NOT NULL DEFAULT 'en',
  components            jsonb NOT NULL,             -- Meta template component structure
  variables             text[] NOT NULL DEFAULT '{}', -- Variable names for substitution
  status                public.template_status NOT NULL DEFAULT 'draft',
  rejection_reason      text,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, name, language)
);
CREATE INDEX idx_templates_business ON public.message_templates(business_id);
CREATE INDEX idx_templates_status ON public.message_templates(status);

-- ============================================================================
-- Bulk Campaigns
-- ============================================================================
CREATE TABLE public.bulk_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  template_id           uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  name                  text NOT NULL,
  status                public.campaign_status NOT NULL DEFAULT 'draft',
  audience_filter       jsonb NOT NULL DEFAULT '{}'::jsonb, -- {tags: [...], min_orders: N, ...}
  template_variables    jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at          timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  total_recipients      integer NOT NULL DEFAULT 0,
  sent_count            integer NOT NULL DEFAULT 0,
  failed_count          integer NOT NULL DEFAULT 0,
  opt_out_count         integer NOT NULL DEFAULT 0,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaigns_business ON public.bulk_campaigns(business_id);
CREATE INDEX idx_campaigns_status ON public.bulk_campaigns(status);

-- ============================================================================
-- Bulk Campaign Recipients (individual send tracking)
-- ============================================================================
CREATE TABLE public.bulk_campaign_recipients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL REFERENCES public.bulk_campaigns(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  conversation_id   uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  outbox_id         uuid REFERENCES public.message_outbox(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','opted_out','skipped')),
  error_message     text,
  sent_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, customer_id)
);
CREATE INDEX idx_recipients_campaign ON public.bulk_campaign_recipients(campaign_id);
CREATE INDEX idx_recipients_status ON public.bulk_campaign_recipients(status);

-- ============================================================================
-- Automation Rules
-- ============================================================================
CREATE TABLE public.automation_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  is_active         boolean NOT NULL DEFAULT true,
  trigger_type      text NOT NULL CHECK (trigger_type IN (
    'keyword_match', 'new_conversation', 'idle_timeout',
    'order_status_change', 'tag_added', 'business_hours_off',
    'customer_first_message'
  )),
  trigger_config    jsonb NOT NULL DEFAULT '{}'::jsonb, -- {keywords: [...], timeout_minutes: N, ...}
  action_type       public.automation_action_type NOT NULL,
  action_config     jsonb NOT NULL DEFAULT '{}'::jsonb, -- {reply_text: ..., tag: ..., assign_to: ..., template_id: ...}
  priority          integer NOT NULL DEFAULT 0,        -- Higher = runs first
  match_count       integer NOT NULL DEFAULT 0,        -- Stats counter
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_automation_business ON public.automation_rules(business_id, is_active);

-- ============================================================================
-- Agent Presence (ephemeral, backed by Realtime Presence, persisted for analytics)
-- ============================================================================
CREATE TABLE public.agent_presence_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('online', 'offline', 'away', 'busy')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);
CREATE INDEX idx_presence_user ON public.agent_presence_log(user_id, started_at DESC);

-- ============================================================================
-- Conversation Viewers (collision detection)
-- ============================================================================
CREATE TABLE public.conversation_viewers (
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- ============================================================================
-- Opt-Out Registry (for bulk messaging compliance)
-- ============================================================================
CREATE TABLE public.messaging_opt_outs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  channel_account_id uuid REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, channel_account_id)
);
```

### 2.3 RLS Policies

Following the exact pattern from `20260904000100_multi_business_foundation.sql`:

```sql
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'channel_accounts', 'conversations', 'messages', 'message_outbox',
    'conversation_orders', 'customer_tags', 'customer_notes',
    'quick_replies', 'message_templates', 'bulk_campaigns',
    'bulk_campaign_recipients', 'automation_rules',
    'agent_presence_log', 'messaging_opt_outs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    
    -- SELECT policy
    EXECUTE format('DROP POLICY IF EXISTS "Members can read %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Members can read %1$s" ON public.%1$I FOR SELECT TO authenticated
       USING (has_role(auth.uid(), ''admin''::app_role) OR is_business_member(business_id))', t);
    
    -- INSERT/UPDATE/DELETE policy
    EXECUTE format('DROP POLICY IF EXISTS "Members can write %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Members can write %1$s" ON public.%1$I FOR ALL TO authenticated
       USING (has_role(auth.uid(), ''admin''::app_role) OR is_business_member(business_id))
       WITH CHECK (has_role(auth.uid(), ''admin''::app_role) OR is_business_member(business_id))', t);
  END LOOP;
END $$;

-- Special: conversation_viewers uses conversation's business_id via join
ALTER TABLE public.conversation_viewers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can read viewers" ON public.conversation_viewers FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_viewers.conversation_id
        AND is_business_member(c.business_id)
    )
  );
```

Additional fine-grained policies:
- Agents with `staff` role can only see conversations where `assigned_agent_id = auth.uid()` OR `assigned_agent_id IS NULL` (unassigned). This is enforced via an additional restrictive policy or at the application level with TanStack Query filters.
- `viewer` role can SELECT only, no INSERT/UPDATE/DELETE.
- Edge functions use the service role key and bypass RLS, but must validate `business_id` scope manually.

### 2.4 Indexes for Scale

At 100-500 convos/day, after 1 year you will have ~100K-180K conversations and potentially millions of messages. Key indexes beyond those above:

```sql
-- Partition messages by month for long-term scale (optional, Phase 6)
-- CREATE TABLE public.messages_2026_09 PARTITION OF public.messages
--   FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

-- Covering index for conversation list query (most common query)
CREATE INDEX idx_conversations_list_covering ON public.conversations(
  business_id, status, last_message_at DESC
) INCLUDE (id, platform, customer_id, assigned_agent_id, unread_count, tags);

-- GIN index for full-text search on message content
CREATE INDEX idx_messages_fts ON public.messages USING GIN (to_tsvector('english', content));
```

### 2.5 Database Triggers

```sql
-- Auto-update conversations.last_message_at and unread_count on new message
CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations SET
    last_message_at = NEW.created_at,
    last_customer_message_at = CASE WHEN NEW.direction = 'inbound' THEN NEW.created_at ELSE last_customer_message_at END,
    last_agent_message_at = CASE WHEN NEW.direction = 'outbound' THEN NEW.created_at ELSE last_agent_message_at END,
    unread_count = CASE WHEN NEW.direction = 'inbound' AND NEW.is_read = false THEN unread_count + 1 ELSE unread_count END,
    status = CASE WHEN status = 'resolved' AND NEW.direction = 'inbound' THEN 'open'::public.conversation_status ELSE status END,
    updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_new_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_message();

-- Mark messages read when agent views conversation
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid, p_agent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.messages SET is_read = true, read_at = now()
  WHERE conversation_id = p_conversation_id AND direction = 'inbound' AND is_read = false;
  UPDATE public.conversations SET unread_count = 0 WHERE id = p_conversation_id;
END;
$$;
```

---

## 3. Meta/Facebook/Instagram API Integration

### 3.1 Meta Developer App Setup

1. Create Meta Business App at developers.facebook.com
2. Add products: **Messenger** (for Facebook) and **Instagram Messaging** (for Instagram)
3. Configure webhook URL: `https://<project-ref>.supabase.co/functions/v1/meta-webhook`
4. Subscribe to events: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`, `messaging_handovers`
5. Request permissions: `pages_messaging`, `instagram_basic`, `instagram_manage_messages`, `pages_show_list`
6. Generate App Secret for signature verification
7. Obtain Page Access Tokens (long-lived) for each connected page

### 3.2 Webhook Verification (GET handler)

Follow the exact pattern from `woo-webhook/index.ts`:

```typescript
// In meta-webhook/index.ts
if (req.method === "GET") {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  
  // Look up channel_account by verify_token
  const { data: account } = await supabase
    .from("channel_accounts")
    .select("id")
    .eq("webhook_verify_token", token)
    .maybeSingle();
  
  if (mode === "subscribe" && account) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}
```

### 3.3 Signature Verification (POST handler)

Mirror the `woo-webhook` HMAC pattern exactly:

```typescript
const signature = req.headers.get("x-hub-signature-256") || "";
const appSecret = account.app_secret; // Decrypted from channel_accounts

const key = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(appSecret),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
);
const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
const expected = "sha256=" + Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");

if (signature !== expected) {
  return jsonResp({ error: "invalid signature" }, 401);
}
```

### 3.4 Event Processing Pipeline

For each entry in the webhook payload:

1. Parse `sender.id` (PSID for FB, IG scoped ID for IG)
2. Find or create `conversations` row by `platform_conversation_id`
3. Resolve `customer_id` using the existing `resolveOrCreateCustomer` pattern from `woo-webhook` (phone lookup via `customer_aliases`, fallback to create)
4. Insert `messages` row (idempotent via `UNIQUE(platform_message_id)`)
5. Run automation rules matching `trigger_type`
6. If auto-reply matches, insert into `message_outbox`

### 3.5 24-Hour Rule Handling

This is the most critical Meta API constraint. Implementation:

- Track `last_customer_message_at` on every conversation (updated by trigger)
- Before sending any free-form message, compute: `now() - last_customer_message_at < 24 hours`
- If outside 24h window: block free-form sends in the UI (disable composer, show warning), force template message selection
- Template messages (pre-approved by Meta) can be sent anytime
- Store the computed `window_expires_at` as a virtual column for UI display
- Edge case: Meta's 24h clock starts from the LAST customer message, not the first. Multiple customer messages reset the window.

### 3.6 Instagram vs Facebook Differences

| Aspect | Facebook Messenger | Instagram |
|--------|--------------------|-----------|
| Sender ID | PSID (page-scoped) | IG scoped user ID |
| API endpoint | `/v20.0/me/messages` | `/v20.0/{ig-user-id}/messages` |
| Attachment types | All supported | Limited (no generic templates) |
| Product cards | Generic template | Media template with link |
| 24h rule | Applies | Applies |
| Handover protocol | Supported | Not supported |

Normalize both behind a unified `sendMessage(channelAccountId, recipientId, payload)` function in a shared module `supabase/functions/_shared/meta-api.ts`.

### 3.7 Token Management

- Store Page Access Tokens encrypted using `pgcrypto`:
  ```sql
  -- Encrypt: SELECT pgp_sym_encrypt(token, current_setting('app.encryption_key'))
  -- Decrypt: SELECT pgp_sym_decrypt(access_token_encrypted::bytea, current_setting('app.encryption_key'))
  ```
- Set `app.encryption_key` via Supabase Vault secrets
- Long-lived tokens expire in 60 days. Implement `meta-token-refresh` edge function on `pg_cron` schedule (daily)
- Alert admins via system notification when token expires within 7 days
- Provide reconnection flow in settings UI

### 3.8 Rate Limiting

Meta enforces 250 messages/second per page. Implementation:

- Token bucket algorithm stored in Redis-like fashion using a simple DB table:
  ```sql
  CREATE TABLE public.rate_limit_buckets (
    channel_account_id uuid PRIMARY KEY REFERENCES channel_accounts(id),
    tokens_remaining integer NOT NULL DEFAULT 250,
    last_refill_at timestamptz NOT NULL DEFAULT now()
  );
  ```
- Refill 250 tokens per second. Before each send, decrement. If 0, queue with `next_retry_at`.
- For bulk campaigns, batch sends at controlled rate (e.g., 200/sec to leave headroom)

---

## 4. Inbox UI

### 4.1 Three-Panel Layout

Using the existing `react-resizable-panels` dependency (confirmed in `package.json` line 66, wrapper at `src/components/ui/resizable.tsx`):

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

// OmniInbox.tsx
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

### 4.2 Component Architecture

| Component | File | Purpose | Reuses Existing |
|-----------|------|---------|-----------------|
| `OmniInbox` | `src/components/inbox/OmniInbox.tsx` | Page container, panel layout, route params | - |
| `ConversationList` | `src/components/inbox/ConversationList.tsx` | Filterable/searchable list with tabs (Open, Assigned, Unassigned, Closed) | `OrderFilters` pattern |
| `ConversationItem` | `src/components/inbox/ConversationItem.tsx` | Single row: avatar, name, preview, time, unread badge, tags, priority indicator | `OrderCard` pattern |
| `MessageThread` | `src/components/inbox/MessageThread.tsx` | Virtualized scrollable message list | `@tanstack/react-virtual` |
| `MessageBubble` | `src/components/inbox/MessageBubble.tsx` | Renders content based on `content_type` | Switch on type |
| `ComposerBar` | `src/components/inbox/ComposerBar.tsx` | Text input, attachment upload, send button, template picker trigger | `Textarea` from shadcn |
| `ContextSidebar` | `src/components/inbox/ContextSidebar.tsx` | Tabbed panel (Customer, Orders, Products, Notes) | `Tabs` from shadcn |
| `CustomerProfileCard` | `src/components/inbox/CustomerProfileCard.tsx` | Name, phone, tags, order count, LTV | - |
| `ProductQuickSend` | `src/components/inbox/ProductQuickSend.tsx` | Search products, send as rich card | **`MiniProductCatalog`** directly |
| `InvoiceQuickSend` | `src/components/inbox/InvoiceQuickSend.tsx` | Select/generate invoice, send PDF | **`invoiceHtml.ts`** |
| `CourierQuickSend` | `src/components/inbox/CourierQuickSend.tsx` | Enter tracking, format & send | **`CourierDispatchStation`** logic |
| `OrderLinker` | `src/components/inbox/OrderLinker.tsx` | Link existing or create new order | **`AddOrderDialog`** |
| `TagManager` | `src/components/inbox/TagManager.tsx` | Add/remove tags | `Badge` from shadcn |
| `QuickReplyPicker` | `src/components/inbox/QuickReplyPicker.tsx` | Slash-command or button insert | `Command` from shadcn |
| `TemplateMessagePicker` | `src/components/inbox/TemplateMessagePicker.tsx` | Select approved template, fill variables | `ResponsiveDialog` |
| `AssignmentDropdown` | `src/components/inbox/AssignmentDropdown.tsx` | Assign/reassign agent | `SearchableSelect` |
| `BulkActionBar` | `src/components/inbox/BulkActionBar.tsx` | Multi-select actions | **`OrderBulkActionsBar`** pattern |

### 4.3 State Management

Use TanStack Query (already in deps) for all data fetching:

```typescript
// hooks/useConversations.ts
export function useConversations(filters: ConversationFilters) {
  return useQuery({
    queryKey: ['conversations', filters],
    queryFn: () => supabase.from('conversations').select('...').eq('business_id', businessId)...,
  });
}

// hooks/useMessages.ts  
export function useMessages(conversationId: string) {
  return useQuery({...});
}

// Realtime subscription
export function useConversationRealtime(businessId: string) {
  useEffect(() => {
    const channel = supabase.channel(`conversations:${businessId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `business_id=eq.${businessId}` }, handleUpdate)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [businessId]);
}
```

### 4.4 Virtualization

For threads with 500+ messages, use `@tanstack/react-virtual` (confirm in package.json). Estimate ~40px per message bubble, render only visible viewport + overscan.

### 4.5 Keyboard Shortcuts

- `Cmd/Ctrl + K`: Focus search
- `Up/Down`: Navigate conversation list
- `Enter`: Open selected conversation
- `Cmd/Ctrl + Enter`: Send message
- `Escape`: Close sidebar / deselect
- `/`: Trigger quick reply picker in composer

---

## 5. Order Management from Inbox

### 5.1 Create Order from Chat

Reuse `AddOrderDialog` (`E:\Work\Web Development\DokanOS\shohozbiz\shohozbiz\src\components\orders\AddOrderDialog.tsx`) directly. The dialog accepts `Props { open, onOpenChange, onCreated }`. From the inbox sidebar:

1. Click "Create Order" button
2. Open `AddOrderDialog` with customer fields pre-filled from the conversation's resolved `customer_id`
3. Pre-fill `source` as `"fb/ig"` (matching existing `order_sources` which already has `'fb/ig'` per migration line 516)
4. After creation, auto-link the new order to the conversation via `conversation_orders` table
5. Post a system message to the chat: "Order #ORD-1234 created"

### 5.2 Link Existing Order

1. Search orders by order_number, customer name, or phone
2. Display results with status badges (reuse `OrderBadges` from `src/components/orders/OrderBadges.tsx`)
3. On select, insert into `conversation_orders`
4. Show linked orders in the Context Sidebar with status badges

### 5.3 Order Status Sync to Chat

When a linked order's status changes (detected via `order_timeline` insert or order UPDATE trigger):
1. Insert a system message into the conversation: "Your order #1234 has been shipped"
2. Optionally send to customer via Meta API (if within 24h window or using template)

### 5.4 AI-Powered Order Extraction

Leverage the existing `parse-order-text` edge function (`supabase/functions/parse-order-text/index.ts`). When an agent pastes a customer's chat message into the order form's AI parse field, it extracts name, phone, address, products. This already works in `AddOrderDialog` lines 675-752.

---

## 6. Product/Invoice/Courier Sharing

### 6.1 Product Cards

Reuse `MiniProductCatalog` (`E:\Work\Web Development\DokanOS\shohozbiz\shohozbiz\src\components\orders\MiniProductCatalog.tsx`):

1. Agent opens product picker in sidebar
2. Searches via Fuse.js (same as AddOrderDialog)
3. Selects product (handles variations via `VariationModal` from POS)
4. System formats a Meta-compatible product card payload:
   - FB: Generic template with image_url, title, subtitle (price), buttons (View Shop)
   - IG: Media template with image + link
5. Insert into `message_outbox`, send via Meta API

### 6.2 Invoice PDFs

Reuse `invoiceHtml.ts` (`E:\Work\Web Development\DokanOS\shohozbiz\shohozbiz\src\lib\invoiceHtml.ts`):

1. Agent selects an order in sidebar
2. System generates HTML via `invoiceHtml.ts`
3. Convert to PDF (using a client-side library like `html2pdf.js` or server-side via edge function with `deno-pdf`)
4. Upload to Supabase Storage bucket `inbox-attachments/{business_id}/{conversation_id}/`
5. Send as file attachment via Meta Send API
6. Update invoice status if applicable

### 6.3 Courier Tracking Info

Reuse courier data from `courier_shipments` table and `pathao_store_links` logic:

1. Agent selects linked order in sidebar
2. System pulls `consignment_id`, `provider`, `canonical_status` from `courier_shipments`
3. Format message: "Your order #[order_number] has been shipped via [provider]. Track here: [tracking_url]"
4. For Pathao: construct tracking URL from `pathao-courier` edge function patterns
5. Send as text message or template

---

## 7. Customer CRM

### 7.1 Customer Resolution

Follow the exact pattern from `woo-webhook/index.ts` `resolveOrCreateCustomer()` (lines 550-614):

1. On inbound message, extract sender platform ID
2. Check `customer_aliases` for existing match (type: `facebook_psid` or `instagram_id`)
3. If found, use existing `customer_id`
4. If not found, create new customer with source `facebook` or `instagram`
5. Insert alias: `{ customer_id, type: 'facebook_psid', value: psid, source_store_id: null }`

### 7.2 Cross-Platform Merge

If a customer contacts from both FB and IG and their phone number matches:
1. During customer resolution, also check by phone (global lookup, as done in woo-webhook line 563)
2. If phone matches existing customer, link both platform IDs to the same `customer_id` via `customer_aliases`
3. Manual merge UI: Admin can merge two customer records, combining aliases

### 7.3 Tagging System

- Manual: Agent adds tags via `TagManager` component, inserts into `customer_tags`
- Auto: Automation rules engine evaluates incoming messages against `automation_rules` where `trigger_type = 'keyword_match'` or `'tag_added'`
- Order-based: When order is created/linked, auto-tag customer with relevant tags
- Tags are business-scoped (different businesses can have different tag taxonomies)

### 7.4 Customer Profile Sidebar

Display in `ContextSidebar` > Customer tab:
- Name, phone, email, address (from `customers` table)
- Tags (from `customer_tags`)
- Order count and lifetime value (aggregated from `orders`)
- Notes (from `customer_notes`)
- Active conversations across platforms
- Last interaction timestamp

---

## 8. Bulk Promotional Messaging

### 8.1 Audience Builder

Filter customers by:
- Tags (intersection/union)
- Order count (min/max)
- Last order date range
- Last activity date
- Platform (FB/IG/both)
- Exclude opted-out customers (`messaging_opt_outs` table)

### 8.2 Template Approval Flow

1. Agent creates template in UI -> status `draft`
2. Admin reviews -> clicks "Submit to Meta" -> edge function calls Meta Template API
3. Meta returns `platform_template_id` -> status `pending_approval`
4. Meta webhook notifies approval/rejection -> update status
5. Only `approved` templates can be used for bulk sends

### 8.3 Batch Sending Engine

Implementation via `meta-bulk-send` edge function triggered by `pg_cron`:

1. Query `bulk_campaigns` where `status = 'scheduled' AND scheduled_at <= now()`
2. Build recipient list from `audience_filter` query against `customers` + `customer_tags`
3. Exclude recipients in `messaging_opt_outs`
4. Insert rows into `bulk_campaign_recipients` (status: `pending`)
5. For each recipient, insert into `message_outbox` with template variables substituted
6. Process outbox at controlled rate (200/sec per channel_account)
7. Update campaign stats as sends complete

### 8.4 Opt-Out Handling

- Monitor inbound messages for keywords: "STOP", "UNSUBSCRIBE", "OPT OUT"
- Auto-insert into `messaging_opt_outs`
- Exclude from all future campaigns
- Log in audit trail

---

## 9. Agent Collaboration

### 9.1 Assignment

- **Round-robin**: On new conversation, find agent with fewest open conversations in `user_business_access` where `business_id` matches. Assign via UPDATE.
- **Manual**: `AssignmentDropdown` using `SearchableSelect` populated with agents from `user_business_access`
- **Skill-based routing**: Future enhancement using `custom_roles` permissions

### 9.2 Internal Notes

- Messages with `content_type = 'internal_note'` are inserted into `messages` table
- These are NEVER sent to Meta API (filtered out in `meta-send`)
- Rendered differently in UI (yellow background, "Internal Note" badge)
- Support `@mentions` by parsing `@[agent_name](user_id)` syntax, triggering Realtime notification

### 9.3 Transfer

1. Agent clicks "Transfer" -> selects target agent
2. System inserts internal note: "Conversation transferred from @AgentA to @AgentB"
3. Updates `conversations.assigned_agent_id`
4. Realtime notifies both agents

### 9.4 Presence Indicators

- Use Supabase Realtime Presence channels: `presence:conversation:{conversation_id}`
- Agents broadcast their presence state (online/away/busy)
- UI shows green/yellow/red dots on agent avatars
- Persist to `agent_presence_log` for analytics

### 9.5 Collision Detection

- When agent opens a conversation, insert/update `conversation_viewers`
- Broadcast via Realtime Broadcast: "Agent X is viewing this conversation"
- Show banner: "Agent Y is also viewing this conversation" to prevent duplicate replies
- Remove viewer record on unmount (with heartbeat cleanup for stale entries)

---

## 10. Automation Rules

### 10.1 Rules Engine

Evaluated in the `meta-webhook` edge function after message insertion:

```typescript
async function evaluateAutomationRules(supabase: any, businessId: string, message: any, conversation: any) {
  const { data: rules } = await supabase
    .from("automation_rules")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("priority", { ascending: false });
  
  for (const rule of rules || []) {
    if (matchesTrigger(rule, message, conversation)) {
      await executeAction(rule, supabase, conversation);
      await supabase.from("automation_rules").update({ match_count: rule.match_count + 1 }).eq("id", rule.id);
    }
  }
}
```

### 10.2 Trigger Types

| Trigger | Config | Evaluation |
|---------|--------|------------|
| `keyword_match` | `{keywords: ["price", "cost"], match: "any"}` | Regex match on message content |
| `new_conversation` | `{}` | First message in new conversation |
| `idle_timeout` | `{timeout_minutes: 30}` | Cron job checks `last_message_at` |
| `order_status_change` | `{from_status, to_status}` | Listen to order_timeline inserts |
| `tag_added` | `{tag: "vip"}` | Listen to customer_tags inserts |
| `business_hours_off` | `{hours: {start: "18:00", end: "09:00"}}` | Time-of-day check |
| `customer_first_message` | `{}` | Customer has no prior conversations |

### 10.3 Action Types

| Action | Config | Effect |
|--------|--------|--------|
| `auto_reply` | `{text: "..."}` | Insert into message_outbox |
| `auto_tag` | `{tag: "interested"}` | Insert into customer_tags |
| `auto_assign` | `{strategy: "round_robin" \| agent_id}` | Update conversations.assigned_agent_id |
| `auto_close` | `{idle_hours: 48}` | Update conversations.status = 'closed' |
| `escalate` | `{to_role: "admin"}` | Change priority to urgent, notify admin |
| `send_template` | `{template_id: "..."}` | Insert into message_outbox with template |

### 10.4 SLA Timers

Implement via `pg_cron` running every 5 minutes:
- Query conversations where `status != 'closed'` and `last_message_at < now() - interval 'X minutes'`
- Escalate priority or auto-close based on rules
- Notify agents via Realtime Broadcast

---

## 11. Analytics and Reporting

### 11.1 Materialized Views

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

-- Refresh daily via pg_cron
SELECT cron.schedule('refresh-inbox-analytics', '0 2 * * *', 'REFRESH MATERIALIZED VIEW public.inbox_analytics_daily');
```

### 11.2 Key Metrics Dashboard

| Metric | Source | Calculation |
|--------|--------|-------------|
| Avg First Response Time | `conversations` | `first_agent_message_at - created_at` |
| Avg Resolution Time | `conversations` | `closed_at - created_at` |
| Messages/Day | `messages` | Count grouped by date |
| Conversations/Day | `conversations` | Count grouped by date |
| Agent Performance | `messages` + `user_roles` | Messages handled per agent, avg resolution |
| Conversion Rate | `conversation_orders` JOIN `conversations` | Count of conversations with linked orders / total |
| Peak Hours | `messages` | Heatmap by hour of day |
| Template Usage | `message_outbox` | Count by template_id |
| Opt-Out Rate | `messaging_opt_outs` | Count over time |

### 11.3 CSAT Surveys

After conversation is marked `resolved`:
1. Wait 1 hour
2. Send approved template message: "How was your experience? Reply 1-5"
3. Parse numeric response, store in `conversations.metadata->>'csat_score'`

---

## 12. Multi-Tenant Support

### 12.1 Architecture

The existing multi-business foundation (`20260904000100_multi_business_foundation.sql`) provides the exact isolation model:

- Every table has `business_id uuid NOT NULL REFERENCES businesses(id)`
- RLS enforced via `is_business_member(business_id)`
- A single business can have multiple `channel_accounts` (multiple FB pages, multiple IG accounts)
- `selling_points` table already supports `facebook` and `instagram` types

### 12.2 Multi-Account per Business

One business may connect:
- 3 Facebook Pages (e.g., different brands)
- 2 Instagram accounts
- Each is a separate `channel_accounts` row
- Conversations are scoped to `channel_account_id` but aggregated at `business_id` for the unified inbox

### 12.3 Cross-Business Isolation

- Edge functions authenticate via JWT, extract `business_id` from `user_business_access`
- Service role operations (webhook processing) include `business_id` in every query
- No cross-business data leakage possible due to RLS

---

## 13. Security

### 13.1 Token Encryption

Page Access Tokens are the most sensitive data. Implementation:

```sql
-- Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Store encryption key in Supabase Vault
-- vault.create_secret('your-encryption-key', 'inbox_token_key');

-- Encrypt on insert/update
CREATE OR REPLACE FUNCTION public.encrypt_channel_token()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'inbox_token_key';
  NEW.access_token_encrypted := pgp_sym_encrypt(NEW.access_token_encrypted, v_key);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_encrypt_token BEFORE INSERT OR UPDATE OF access_token_encrypted
  ON public.channel_accounts FOR EACH ROW EXECUTE FUNCTION public.encrypt_channel_token();
```

### 13.2 Webhook Signature Verification

Mandatory on every request. Follow the established pattern from `woo-webhook/index.ts` lines 86-120 exactly. Reject any request without valid `X-Hub-Signature-256`.

### 13.3 Rate Limiting on Send Endpoints

Prevent abuse of `meta-send` edge function:
- Require valid Supabase JWT
- Limit to 10 requests/second per user via edge function middleware
- Validate `business_id` matches caller's `user_business_access`

### 13.4 Audit Logging

Reuse existing `audit_log` table for all agent actions:
- Message sent, deleted, edited
- Conversation assigned, transferred, closed
- Template created, submitted, approved
- Bulk campaign created, started, paused
- Automation rule created, modified

### 13.5 PII Handling

- Customer phone numbers and emails already stored in `customers` table
- Apply same protection standards
- Consider encrypting `content` field in `messages` at rest for sensitive industries (future)
- GDPR: implement data export and deletion endpoints

---

## 14. Implementation Phases with Dependency Ordering

### Phase 1: Foundation (Week 1-2) -- BLOCKS ALL OTHER PHASES

Dependencies: None

- [ ] Migration: Create all enums, tables, indexes, triggers, RLS policies (Section 2)
- [ ] Migration: Enable Realtime publication for `conversations` and `messages` tables
- [ ] Edge Function: `meta-webhook` -- GET verification handler + POST signature verification skeleton
- [ ] Edge Function: `meta-send` -- Basic send with 24h check, no rate limiting yet
- [ ] Shared Module: `supabase/functions/_shared/meta-api.ts` -- Unified FB/IG send abstraction
- [ ] Settings UI: Channel account connection flow (OAuth redirect or manual token entry)
- [ ] Regenerate `types.ts` via `supabase gen types typescript`

### Phase 2: Core Messaging (Week 3-4) -- DEPENDS ON Phase 1

Dependencies: Phase 1 tables, webhook, send function

- [ ] Webhook: Full event parsing (messages, postbacks, deliveries, reads)
- [ ] Webhook: Customer resolution (reuse `resolveOrCreateCustomer` pattern)
- [ ] Webhook: Conversation upsert + message insert with idempotency
- [ ] React: `OmniInbox` page with 3-panel `Resizable` layout
- [ ] React: `ConversationList` with TanStack Query + Realtime subscription
- [ ] React: `MessageThread` with `@tanstack/react-virtual`
- [ ] React: `MessageBubble` rendering (text, images, files)
- [ ] React: `ComposerBar` with text send via `meta-send` edge function
- [ ] React: Unread count management, mark-as-read on view
- [ ] Routing: Add `/inbox` route to app router

### Phase 3: Agent Collaboration (Week 4-5) -- DEPENDS ON Phase 2

Dependencies: Conversation list, message thread

- [ ] Round-robin auto-assignment logic in webhook
- [ ] `AssignmentDropdown` component
- [ ] Manual assignment/reassignment
- [ ] Internal notes (`content_type = 'internal_note'`)
- [ ] Transfer flow with system message
- [ ] Supabase Realtime Presence for agent online/offline
- [ ] Collision detection via `conversation_viewers`
- [ ] Supervisor view (admin sees all conversations regardless of assignment)

### Phase 4: Commerce Integration (Week 5-7) -- DEPENDS ON Phase 2

Dependencies: Message thread, sidebar

- [ ] `ContextSidebar` with tabs (Customer, Orders, Products, Notes)
- [ ] `CustomerProfileCard` pulling from `customers` + aggregation queries
- [ ] `OrderLinker`: search and link existing orders (reuse `OrderCard`, `OrderBadges`)
- [ ] `OrderLinker`: create new order from chat (reuse `AddOrderDialog` with pre-filled customer)
- [ ] Order status change -> system message sync (DB trigger on `order_timeline`)
- [ ] `ProductQuickSend`: reuse `MiniProductCatalog`, format Meta product card
- [ ] `InvoiceQuickSend`: reuse `invoiceHtml.ts`, upload to Storage, send as attachment
- [ ] `CourierQuickSend`: pull from `courier_shipments`, format tracking message

### Phase 5: CRM and Tagging (Week 7-8) -- DEPENDS ON Phase 2

Dependencies: Conversation list, customer resolution

- [ ] `TagManager` component for manual tag add/remove
- [ ] `customer_tags` CRUD operations
- [ ] `customer_notes` CRUD operations
- [ ] Filter conversation list by customer tags
- [ ] Cross-platform customer merge UI
- [ ] `QuickReplyPicker` with slash-command trigger in composer
- [ ] Quick replies CRUD settings page

### Phase 6: Automation (Week 8-9) -- DEPENDS ON Phase 2, Phase 5

Dependencies: Webhook pipeline, tagging, templates

- [ ] Automation rules CRUD settings page
- [ ] Rules engine evaluation in `meta-webhook` edge function
- [ ] Keyword matching implementation
- [ ] Idle timeout cron job (`pg_cron`)
- [ ] Away messages (business hours check)
- [ ] SLA escalation timers
- [ ] Auto-close after inactivity

### Phase 7: Bulk Messaging (Week 9-11) -- DEPENDS ON Phase 1, Phase 6

Dependencies: Templates, customer tags, outbox

- [ ] Template management UI (create, submit to Meta, track approval)
- [ ] Edge Function: `meta-template-submit`
- [ ] Audience builder UI with filter builder
- [ ] Campaign creation and scheduling
- [ ] Edge Function: `meta-bulk-send` with rate-controlled processing
- [ ] Campaign progress dashboard (sent/failed/pending counters)
- [ ] Opt-out detection and registry
- [ ] Delivery report aggregation

### Phase 8: Analytics and Polish (Week 11-13) -- DEPENDS ON ALL ABOVE

Dependencies: All tables populated with real data

- [ ] Materialized views for analytics
- [ ] Analytics dashboard page (charts via Recharts or similar)
- [ ] Agent performance reports
- [ ] Conversation volume heatmaps
- [ ] Conversion rate tracking
- [ ] CSAT survey automation
- [ ] Performance optimization: message partitioning, query tuning
- [ ] E2E tests with Playwright
- [ ] Load testing with 500 concurrent conversations

### Phase 9: Hardening (Week 13-14) -- DEPENDS ON Phase 8

- [ ] Token refresh automation (`meta-token-refresh` cron)
- [ ] Dead letter queue for permanently failed outbox messages
- [ ] Webhook retry handling for Meta delivery failures
- [ ] Monitoring/alerting for edge function errors
- [ ] Documentation for business admins

---

## 15. Component Reuse Strategy

### 15.1 Direct Reuse (Import as-is)

| Existing Component | Location | Inbox Usage |
|--------------------|----------|-------------|
| `AddOrderDialog` | `src/components/orders/AddOrderDialog.tsx` | Open directly from inbox sidebar to create orders. Accepts `open`, `onOpenChange`, `onCreated` props. Pre-fill customer from conversation context. |
| `MiniProductCatalog` | `src/components/orders/MiniProductCatalog.tsx` | Embed in `ProductQuickSend` sidebar tab. Same Fuse.js search, variation selection, category filtering. |
| `OrderCard` | `src/components/orders/OrderCard.tsx` | Display linked orders in ContextSidebar with same visual treatment. |
| `OrderBadges` | `src/components/orders/OrderBadges.tsx` | Show order status badges next to linked orders in sidebar. |
| `VariationModal` | `src/components/pos/VariationModal.tsx` | Reuse when agent selects a variable product to send. |
| `ResponsiveDialog` | `src/components/ui/responsive-dialog.tsx` | Wrapper for all modal dialogs in inbox. |
| `SearchableSelect` | `src/components/ui/searchable-select.tsx` | Used in `AssignmentDropdown`, template variable pickers. |
| `Resizable` | `src/components/ui/resizable.tsx` | Three-panel layout container. |
| `invoiceHtml.ts` | `src/lib/invoiceHtml.ts` | Generate invoice HTML for PDF conversion before sending. |
| `auditLog.ts` | `src/lib/auditLog.ts` | `logAction()` for all inbox mutations. |
| `orderTimeline.ts` | `src/lib/orderTimeline.ts` | `addOrderTimeline()` when orders are created from inbox. |

### 15.2 Pattern Reuse (Follow established patterns)

| Existing Pattern | Source | Inbox Application |
|------------------|--------|-------------------|
| Webhook signature verification | `woo-webhook/index.ts` lines 86-120 | Identical HMAC-SHA256 pattern for Meta webhook |
| Customer resolution | `woo-webhook/index.ts` lines 550-614 | Phone-first global lookup, alias creation, fallback create |
| Idempotency via delivery ID | `woo-webhook/index.ts` lines 51-59 | Use `platform_message_id` UNIQUE constraint instead of `webhook_events` table |
| Order creation flow | `AddOrderDialog.tsx` lines 774-903 | Same sequence: resolve customer -> generate number -> insert order -> insert items -> log timeline |
| Bulk actions bar | `OrderBulkActionsBar.tsx` | Same multi-select + action dropdown pattern for conversation bulk operations |
| RLS policies | `20260904000100_multi_business_foundation.sql` lines 333-408 | Identical DO block pattern with `has_role()` + `is_business_member()` |
| Edge function structure | `woo-webhook/index.ts` | CORS headers, `jsonResp()`, `Deno.serve()`, service role client creation |
| Fuse.js search | `AddOrderDialog.tsx` lines 455-469 | Same configuration for product/conversation search |
| Pathao location cascading | `AddOrderDialog.tsx` lines 344-416 | Same city->zone->area cascade for order creation from inbox |

### 15.3 New Components Required

These have no existing equivalent and must be built from scratch:

- `OmniInbox` (page container)
- `ConversationList` + `ConversationItem`
- `MessageThread` + `MessageBubble`
- `ComposerBar`
- `ContextSidebar` (tabbed container)
- `CustomerProfileCard`
- `TagManager`
- `QuickReplyPicker`
- `TemplateMessagePicker`
- `AssignmentDropdown`
- `BulkCampaignBuilder`
- `AutomationRuleEditor`
- `AnalyticsDashboard`

All new components should use shadcn/ui primitives (`Button`, `Input`, `Badge`, `Card`, `Tabs`, `ScrollArea`, `Avatar`, `Tooltip`, `Popover`, `Command`, `Dialog`) to maintain design consistency.

---

## 16. Edge Cases and Failure Modes

### 16.1 Webhook Failures

| Scenario | Mitigation |
|----------|------------|
| Meta sends duplicate events | `UNIQUE(platform_message_id)` on messages table prevents double-insert |
| Webhook endpoint down | Meta retries with exponential backoff up to 24h. Our endpoint must respond 200 within 20 seconds. |
| Malformed payload | Try/catch around JSON.parse, return 400, log to `webhook_events` equivalent |
| Unknown channel_account | Return 404, do not crash |
| Token expired mid-processing | Catch Meta API 401, mark channel_account inactive, alert admin |

### 16.2 Send Failures

| Scenario | Mitigation |
|----------|------------|
| 24h window expired | Check before send, block in UI, suggest template |
| Rate limit hit (250/sec) | Token bucket queues excess, processes when capacity available |
| Customer blocked the page | Meta returns error code 200 (subcode 1540018). Mark conversation as blocked. |
| Network timeout to Meta API | Retry with exponential backoff (1s, 2s, 4s, max 3 retries) |
| Invalid attachment URL | Validate before queuing, reject in UI |
| Attachment too large (>8MB image, >25MB file) | Validate in ComposerBar before upload |

### 16.3 Concurrency Issues

| Scenario | Mitigation |
|----------|------------|
| Two agents send simultaneously | Outbox serializes sends. Both messages queued, sent sequentially. |
| Agent assigns while another transfers | Optimistic locking via `updated_at` check on UPDATE |
| Webhook arrives while agent is typing | Normal race condition. Both messages appear in thread. |
| Realtime subscription drops | TanStack Query refetches on reconnect. Implement reconnection handler. |

### 16.4 Data Integrity

| Scenario | Mitigation |
|----------|------------|
| Customer deletes their FB account | Meta sends `messaging_handovers` event. Mark conversation as closed. |
| Business disconnects page | Set `channel_accounts.is_active = false`. Stop processing webhooks for that account. |
| Cascade delete business | `ON DELETE CASCADE` on all foreign keys ensures clean removal |
| Orphaned outbox messages | Cron job cleans up `pending` messages older than 7 days |

---

## 17. Production Concerns

### 17.1 Cost Estimation (Supabase Pro)

- **Database**: ~10 new tables, estimated 500MB-2GB after 1 year at 500 convos/day
- **Edge Functions**: ~150K invocations/day (webhook) + ~50K (sends). Well within Pro limits.
- **Realtime**: ~20 concurrent connections x 3 channels each. Within limits.
- **Storage**: Invoice PDFs, images. Estimated 10-50GB/year depending on media volume.

### 17.2 Monitoring

- Log all edge function errors to `webhook_events` equivalent table
- Alert on: channel_account token expiry, outbox failure rate > 5%, webhook processing time > 10s
- Dashboard showing: outbox queue depth, active conversations, agent online count

### 17.3 Migration Safety

- All migrations must be idempotent (use `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`)
- Test migrations against production snapshot before applying
- Include rollback scripts for each migration
- Never drop columns from existing tables; only add nullable columns

### 17.4 Testing Strategy

- Unit tests: Automation rules engine, 24h window calculator, token bucket
- Integration tests: Webhook processing pipeline (mock Meta payloads)
- E2E tests: Full flow from webhook receipt to UI display to agent reply
- Load tests: Simulate 500 conversations/day with 20 concurrent agents

---

## 18. Files to Create (Summary)

### Migrations
- `supabase/migrations/202609XX_omni_inbox_schema.sql`

### Edge Functions
- `supabase/functions/meta-webhook/index.ts`
- `supabase/functions/meta-send/index.ts`
- `supabase/functions/meta-template-submit/index.ts`
- `supabase/functions/meta-bulk-send/index.ts`
- `supabase/functions/meta-token-refresh/index.ts`
- `supabase/functions/_shared/meta-api.ts`

### React Components (17 new files)
- `src/components/inbox/OmniInbox.tsx`
- `src/components/inbox/ConversationList.tsx`
- `src/components/inbox/ConversationItem.tsx`
- `src/components/inbox/MessageThread.tsx`
- `src/components/inbox/MessageBubble.tsx`
- `src/components/inbox/ComposerBar.tsx`
- `src/components/inbox/ContextSidebar.tsx`
- `src/components/inbox/CustomerProfileCard.tsx`
- `src/components/inbox/ProductQuickSend.tsx`
- `src/components/inbox/InvoiceQuickSend.tsx`
- `src/components/inbox/CourierQuickSend.tsx`
- `src/components/inbox/OrderLinker.tsx`
- `src/components/inbox/TagManager.tsx`
- `src/components/inbox/QuickReplyPicker.tsx`
- `src/components/inbox/TemplateMessagePicker.tsx`
- `src/components/inbox/AssignmentDropdown.tsx`
- `src/components/inbox/BulkActionBar.tsx`

### Hooks
- `src/hooks/useConversations.ts`
- `src/hooks/useMessages.ts`
- `src/hooks/useConversationRealtime.ts`
- `src/hooks/useAgentPresence.ts`

### Settings Pages
- `src/pages/InboxSettings.tsx` (channel accounts, templates, automation rules, quick replies)

---

This plan is designed to survive adversarial review. Every architectural decision is grounded in the existing codebase patterns. Every table follows the established multi-tenant RLS model. Every edge function mirrors the proven `woo-webhook` pattern. Every UI component either reuses an existing component directly or follows its established patterns. The phased approach ensures each phase builds on tested foundations from prior phases.
