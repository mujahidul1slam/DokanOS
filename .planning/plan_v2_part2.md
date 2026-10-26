
---

## 4. Database Schema

Two migration files (enum additions are split out because a new enum value cannot be safely referenced by DDL in the same transaction that adds it):

- `supabase/migrations/20260911000100_omni_inbox_enums.sql` — `app_permission` additions only.
- `supabase/migrations/20260911000200_omni_inbox_schema.sql` — everything else.

All new tables carry `business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE` — **including `bulk_campaign_recipients`** (C1 fix) — and follow the foundation RLS pattern (§5).

### 4.1 Migration 1: `20260911000100_omni_inbox_enums.sql`

```sql
-- Enum additions ONLY. Referenced by the next migration file (separate transaction).
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.view';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.manage';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.send_messages';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.manage_automation';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.bulk_send';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.view_analytics';
```

Permission preset impact (verified from `has_permission()` in `20260420112330`): staff/viewer presets do NOT include these — members get inbox access only via custom-role grants or user overrides; admins always pass. This is the desired default: inbox read (`inbox.view`) must be granted explicitly per team.

### 4.2 Migration 2: `20260911000200_omni_inbox_schema.sql`

```sql
-- ============================================================================\n-- Extensions\n-- ============================================================================\nCREATE EXTENSION IF NOT EXISTS pgcrypto;\n\n-- ============================================================================\n-- Enums\n-- ============================================================================\nCREATE TYPE public.channel_platform AS ENUM ('facebook', 'instagram');\nCREATE TYPE public.conversation_status AS ENUM ('open', 'assigned', 'waiting', 'resolved', 'closed');\nCREATE TYPE public.conversation_priority AS ENUM ('low', 'normal', 'high', 'urgent');\nCREATE TYPE public.message_direction AS ENUM ('inbound', 'outbound');\nCREATE TYPE public.message_sender_type AS ENUM ('customer', 'agent', 'system', 'bot');\nCREATE TYPE public.message_content_type AS ENUM (\n  'text', 'image', 'video', 'audio', 'file',\n  'product_card', 'invoice_pdf', 'courier_info',\n  'order_confirmation', 'optin_prompt', 'quick_reply',\n  'internal_note'\n);\nCREATE TYPE public.outbox_status AS ENUM ('pending', 'sending', 'sent', 'failed', 'blocked_window', 'cancelled');\nCREATE TYPE public.campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'completed', 'paused', 'failed');\nCREATE TYPE public.automation_action_type AS ENUM (\n  'auto_reply', 'auto_tag', 'auto_assign', 'auto_close', 'escalate',\n  'send_saved_message', 'prompt_notification_optin'\n);\n```

Wait — that fence contains literal `\n` escapes from this drafting pass. The actual migration content is presented clean below; treat this as the source of truth.

```sql
-- ============================================================================
-- Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Enums
-- ============================================================================
CREATE TYPE public.channel_platform AS ENUM ('facebook', 'instagram');
CREATE TYPE public.conversation_status AS ENUM ('open', 'assigned', 'waiting', 'resolved', 'closed');
CREATE TYPE public.conversation_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE public.message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE public.message_sender_type AS ENUM ('customer', 'agent', 'system', 'bot');
CREATE TYPE public.message_content_type AS ENUM (
  'text', 'image', 'video', 'audio', 'file',
  'product_card', 'invoice_pdf', 'courier_info',
  'order_confirmation', 'optin_prompt', 'quick_reply',
  'internal_note'
);
CREATE TYPE public.outbox_status AS ENUM ('pending', 'sending', 'sent', 'failed', 'blocked_window', 'cancelled');
CREATE TYPE public.campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'completed', 'paused', 'failed');
CREATE TYPE public.automation_action_type AS ENUM (
  'auto_reply', 'auto_tag', 'auto_assign', 'auto_close', 'escalate',
  'send_saved_message', 'prompt_notification_optin'
);

-- ============================================================================
-- Existing-table fixes
-- ============================================================================

-- customer_aliases.type constraint only allows name/email/address (verified:
-- migration 20260418114108). Platform-ID alias types would be REJECTED without
-- this extension. (Defect found in v2 verification; not in the critique.)
ALTER TABLE public.customer_aliases
  DROP CONSTRAINT IF EXISTS customer_aliases_type_check;
ALTER TABLE public.customer_aliases
  ADD CONSTRAINT customer_aliases_type_check
  CHECK (type IN ('name', 'email', 'address', 'facebook_psid', 'instagram_id'));
-- The existing unique index uq_customer_alias_value on
-- (customer_id, type, lower(value)) is harmless for numeric PSIDs/IGSIDs.

-- ============================================================================
-- Storage bucket for inbox attachments (private; signed URLs on read)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('inbox-attachments', 'inbox-attachments', false, 26214400, null)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Channel Accounts (app-level secret lives in edge-function env, NOT here — C3/M17)
-- ============================================================================
CREATE TABLE public.channel_accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform                 public.channel_platform NOT NULL,
  account_name             text NOT NULL,
  page_id                  text,                    -- FB Page ID
  ig_account_id            text,                    -- Instagram account ID
  access_token_encrypted   bytea NOT NULL,          -- pgp_sym_encrypt with vault key (§4.4)
  webhook_verify_token     text NOT NULL,
  is_active                boolean NOT NULL DEFAULT true,
  supports_recurring_notifications boolean NOT NULL DEFAULT false, -- set by spike S1 per platform
  token_validated_at       timestamptz,
  last_webhook_at          timestamptz,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, page_id),
  UNIQUE (platform, ig_account_id),
  UNIQUE (webhook_verify_token)                     -- M16: unambiguous lookup + indexed
);
CREATE INDEX idx_channel_accounts_business ON public.channel_accounts(business_id);
CREATE TRIGGER set_channel_accounts_updated_at BEFORE UPDATE ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ============================================================================
-- Notification Topics (Recurring Notifications — C2 redesign)
-- ============================================================================
CREATE TABLE public.notification_topics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  slug               text NOT NULL,                 -- e.g. 'new-arrivals', 'restock-alerts'
  title              text NOT NULL,                 -- shown in the opt-in prompt
  frequency          text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, slug)
);
CREATE INDEX idx_notification_topics_business ON public.notification_topics(business_id);
CREATE TRIGGER set_notification_topics_updated_at BEFORE UPDATE ON public.notification_topics
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ============================================================================
-- Notification Opt-Ins (customer subscribed to a topic — the opt-in token is
-- the ONLY way to message outside the 24h window, apart from policy tags)
-- ============================================================================
CREATE TABLE public.notification_opt_ins (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id  uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  customer_id         uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  topic_id            uuid NOT NULL REFERENCES public.notification_topics(id) ON DELETE CASCADE,
  notification_token  text NOT NULL,                -- Meta recurring-notification token
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'expired', 'revoked')),
  opted_in_at         timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,                  -- per Meta frequency semantics (spike S1)
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, topic_id)
);
CREATE INDEX idx_optins_customer ON public.notification_opt_ins(customer_id, status);
CREATE INDEX idx_optins_account ON public.notification_opt_ins(channel_account_id, topic_id, status);

-- ============================================================================
-- Conversations — 1:1 DM model (H10): keyed by (channel_account_id,
-- platform_recipient_id). Meta webhooks deliver no durable conversation/thread
-- ID; the PSID/IGSID IS the thread identity per account. Group chats are OUT
-- OF SCOPE for v1 (a group model needs a different key — documented, not built).
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
  customer_avatar_path      text,                   -- persisted profile pic (Meta URLs expire — H3)
  last_message_at           timestamptz,
  last_customer_message_at  timestamptz,            -- 24h window clock (H9); NULL = window closed
  last_agent_message_at     timestamptz,
  first_agent_reply_at      timestamptz,            -- analytics (set by trigger)
  unread_count              integer NOT NULL DEFAULT 0,
  snoozed_until             timestamptz,
  closed_at                 timestamptz,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb, -- thread key if Meta ever sends one
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  window_expires_at         timestamptz GENERATED ALWAYS AS
                             (last_customer_message_at + interval '24 hours') STORED,      -- L2: STORED generated, not "virtual"
  human_agent_window_expires_at timestamptz GENERATED ALWAYS AS
                             (last_customer_message_at + interval '7 days') STORED,
  UNIQUE (channel_account_id, platform_recipient_id)
);
CREATE INDEX idx_conversations_business_status ON public.conversations(business_id, status);
CREATE INDEX idx_conversations_assigned_agent ON public.conversations(assigned_agent_id, status) WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX idx_conversations_last_message ON public.conversations(business_id, last_message_at DESC);
CREATE INDEX idx_conversations_customer ON public.conversations(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_conversations_tags ON public.conversations USING GIN (tags);
CREATE INDEX idx_conversations_unread ON public.conversations(business_id) WHERE unread_count > 0;
-- Keyset-pagination cursor index (M11): list queries ORDER BY (last_message_at DESC, id DESC)
CREATE INDEX idx_conversations_list_cursor ON public.conversations(business_id, last_message_at DESC, id DESC);
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
  sender_id             text,                       -- platform sender ID or auth.users.id
  sender_agent_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content_type          public.message_content_type NOT NULL DEFAULT 'text',
  content               text,                       -- text body (structured types use metadata)
  attachments           jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{type, size, storage_path}]
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb, -- raw platform data, original CDN URL, Meta timestamp
  platform_message_id   text,                       -- Meta mid; UNIQUE prevents duplicate processing
  is_read               boolean NOT NULL DEFAULT false,     -- AGENT read of INBOUND (distinct fact from H2 below)
  read_at               timestamptz,
  delivery_status       text CHECK (delivery_status IN ('sent', 'delivered', 'read', 'failed')), -- OUTBOUND lifecycle (H2)
  delivered_at          timestamptz,
  customer_read_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(), -- inbound: set from Meta payload timestamp (H9)
  UNIQUE (platform_message_id)
);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at ASC);
CREATE INDEX idx_messages_business_time ON public.messages(business_id, created_at DESC);
CREATE INDEX idx_messages_sender_agent ON public.messages(sender_agent_id) WHERE sender_agent_id IS NOT NULL;
CREATE INDEX idx_messages_unread ON public.messages(conversation_id) WHERE is_read = false AND direction = 'inbound';
CREATE INDEX idx_messages_delivery ON public.messages(conversation_id, delivery_status) WHERE direction = 'outbound';
-- FTS on text content ONLY (L3): content can carry JSON for structured types;
-- a partial index keeps JSON syntax out of the lexemes.
CREATE INDEX idx_messages_fts ON public.messages
  USING GIN (to_tsvector('english', content)) WHERE content_type = 'text';

-- ============================================================================
-- Saved Messages (internal canned drafts — NO Meta approval flow, C2)
-- Replaces v1's message_templates entirely. Usable within the 24h window
-- (or with a policy-permitted tag).
-- ============================================================================
CREATE TABLE public.saved_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name          text NOT NULL,
  category      text NOT NULL DEFAULT 'support' CHECK (category IN ('promo', 'support', 'utility', 'order')),
  content       text NOT NULL,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
CREATE INDEX idx_saved_messages_business ON public.saved_messages(business_id, category);
CREATE TRIGGER set_saved_messages_updated_at BEFORE UPDATE ON public.saved_messages
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ============================================================================
-- Message Outbox (see §2.5 for the trigger design)
-- ============================================================================
CREATE TABLE public.message_outbox (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  content_type          public.message_content_type NOT NULL DEFAULT 'text',
  content               text,
  attachments           jsonb NOT NULL DEFAULT '[]'::jsonb,
  saved_message_id      uuid REFERENCES public.saved_messages(id) ON DELETE SET NULL,
  -- Meta message tag for permitted out-of-window sends (policy-limited uses only)
  tag                   text CHECK (tag IN ('ACCOUNT_UPDATE', 'CONFIRMED_EVENT_UPDATE', 'HUMAN_AGENT', 'POST_PURCHASE')),
  status                public.outbox_status NOT NULL DEFAULT 'pending',
  error_message         text,
  retry_count           integer NOT NULL DEFAULT 0,
  next_retry_at         timestamptz,
  sent_at               timestamptz,
  platform_message_id   text,                       -- Meta mid after send
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_pending ON public.message_outbox(status, next_retry_at) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_outbox_conversation ON public.message_outbox(conversation_id);
CREATE INDEX idx_outbox_channel ON public.message_outbox(channel_account_id, status);
CREATE TRIGGER set_message_outbox_updated_at BEFORE UPDATE ON public.message_outbox
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

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
-- Customer Tags — business-scoped uniqueness (H1: customers is a GLOBAL table,
-- verified: no business_id, only nullable store_id; shared customers across
-- businesses are this codebase's deliberate model)
-- ============================================================================
CREATE TABLE public.customer_tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tag           text NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id, tag)
);
CREATE INDEX idx_customer_tags_customer ON public.customer_tags(customer_id);
CREATE INDEX idx_customer_tags_business_tag ON public.customer_tags(business_id, tag);

-- ============================================================================
-- Customer Notes
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
-- Quick Replies
-- ============================================================================
CREATE TABLE public.quick_replies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  shortcut      text NOT NULL,                     -- e.g. "/hours"
  content       text NOT NULL,
  category      text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, shortcut)
);

-- ============================================================================
-- Bulk Campaigns (see §12 for the redesigned engine)
-- ============================================================================
CREATE TABLE public.bulk_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  saved_message_id      uuid REFERENCES public.saved_messages(id) ON DELETE SET NULL,
  notification_topic_id uuid REFERENCES public.notification_topics(id) ON DELETE SET NULL, -- NULL = window-only campaign
  name                  text NOT NULL,
  status                public.campaign_status NOT NULL DEFAULT 'draft',
  audience_filter       jsonb NOT NULL DEFAULT '{}'::jsonb, -- {tags:[...], min_orders:N, last_order_days:N}
  scheduled_at          timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  total_recipients      integer NOT NULL DEFAULT 0,
  sent_count            integer NOT NULL DEFAULT 0,
  failed_count          integer NOT NULL DEFAULT 0,
  skipped_count         integer NOT NULL DEFAULT 0, -- out-of-window, no opt-in
  opt_out_count         integer NOT NULL DEFAULT 0,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaigns_business ON public.bulk_campaigns(business_id);
CREATE INDEX idx_campaigns_status ON public.bulk_campaigns(status);
CREATE TRIGGER set_bulk_campaigns_updated_at BEFORE UPDATE ON public.bulk_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ============================================================================
-- Bulk Campaign Recipients — business_id PRESENT (C1 fix); one row per
-- (campaign, customer, channel_account) so a customer on both FB and IG gets
-- independent rows with independent window checks (M14)
-- ============================================================================
CREATE TABLE public.bulk_campaign_recipients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE, -- C1
  campaign_id        uuid NOT NULL REFERENCES public.bulk_campaigns(id) ON DELETE CASCADE,
  channel_account_id uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  conversation_id    uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  outbox_id          uuid REFERENCES public.message_outbox(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sent','failed','opted_out',
                                       'skipped_out_of_window','skipped_no_optin','skipped')),
  send_mode          text CHECK (send_mode IN ('window', 'recurring_notification', 'tag')),
  error_message      text,
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, customer_id, channel_account_id)  -- M14
);
CREATE INDEX idx_recipients_campaign ON public.bulk_campaign_recipients(campaign_id, status);
CREATE INDEX idx_recipients_business ON public.bulk_campaign_recipients(business_id);
-- Consistency: recipient's business_id must equal the campaign's business (denormalized guard)
CREATE FUNCTION public.bulk_recipient_business_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.business_id <> (SELECT business_id FROM public.bulk_campaigns WHERE id = NEW.campaign_id) THEN
    RAISE EXCEPTION 'recipient business_id does not match campaign business_id';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_bulk_recipient_business_check BEFORE INSERT OR UPDATE
  ON public.bulk_campaign_recipients FOR EACH ROW
  EXECUTE FUNCTION public.bulk_recipient_business_check();

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
    'order_status_change', 'order_created', 'tag_added',
    'business_hours_off', 'customer_first_message', 'notification_optin'
  )),
  trigger_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type       public.automation_action_type NOT NULL,
  action_config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority          integer NOT NULL DEFAULT 0,
  match_count       integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_automation_business ON public.automation_rules(business_id, is_active);
CREATE TRIGGER set_automation_rules_updated_at BEFORE UPDATE ON public.automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ============================================================================
-- Agent Presence Log / Conversation Viewers
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

CREATE TABLE public.conversation_viewers (
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- ============================================================================
-- Opt-Out Registry — channel_account_id NULL means GLOBAL opt-out (M14)
-- ============================================================================
CREATE TABLE public.messaging_opt_outs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  channel_account_id uuid REFERENCES public.channel_accounts(id) ON DELETE CASCADE, -- NULL = all channels
  reason             text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- NULL-safe uniqueness: a NULL-channel row (global) and per-channel rows are distinct
-- facts, but each fact exists exactly once. Sentinel uuid in COALESCE treats NULL as a value.
CREATE UNIQUE INDEX uq_messaging_opt_outs ON public.messaging_opt_outs (
  customer_id, COALESCE(channel_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX idx_opt_outs_customer ON public.messaging_opt_outs(customer_id);
-- Campaign exclusion check (M14) excludes a recipient on account X when a row exists
-- where channel_account_id IS NULL OR channel_account_id = X (audience SQL in §12.3).

-- ============================================================================
-- Rate Limit Buckets (service-role only — RLS enabled with no policies, M5)
-- ============================================================================
CREATE TABLE public.rate_limit_buckets (
  channel_account_id uuid PRIMARY KEY REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  tokens_remaining   integer NOT NULL DEFAULT 40,
  last_refill_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;  -- no policies: PostgREST-inaccessible

-- ============================================================================
-- Meta Webhook Events (idempotency + observability, M18) — purged at 30 days
-- (webhook_events precedent, 20260802065800)
-- ============================================================================
CREATE TABLE public.meta_webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id   uuid REFERENCES public.channel_accounts(id) ON DELETE SET NULL,
  object_type         text NOT NULL,                -- 'page' | 'instagram'
  event_type          text NOT NULL,                -- 'messages', 'message_deliveries', ...
  platform_message_id text,                        -- mid when present
  watermark           bigint,                       -- delivery/read watermark when present
  recipient_id        text,                         -- psid/igsid
  status_code         integer NOT NULL,
  error               text,
  payload_size        integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_meta_webhook_events_created ON public.meta_webhook_events(created_at DESC);
CREATE INDEX idx_meta_webhook_events_account ON public.meta_webhook_events(channel_account_id, created_at DESC);

-- ============================================================================
-- Triggers
-- ============================================================================

-- Conversation rollup on new message.
-- NOTE (L4): does NOT set updated_at explicitly — the BEFORE UPDATE
-- set_conversations_updated_at trigger handles it.
CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations SET
    last_message_at = NEW.created_at,
    last_customer_message_at = CASE WHEN NEW.direction = 'inbound' THEN NEW.created_at
                                    ELSE last_customer_message_at END,
    last_agent_message_at = CASE WHEN NEW.direction = 'outbound' THEN NEW.created_at
                                 ELSE last_agent_message_at END,
    first_agent_reply_at = CASE WHEN NEW.direction = 'outbound'
                                   AND NEW.sender_type IN ('agent','bot')
                                   AND first_agent_reply_at IS NULL THEN NEW.created_at
                                ELSE first_agent_reply_at END,
    unread_count = CASE WHEN NEW.direction = 'inbound' AND NEW.is_read = false
                        THEN unread_count + 1 ELSE unread_count END,
    status = CASE WHEN status = 'resolved' AND NEW.direction = 'inbound'
                  THEN 'open'::public.conversation_status ELSE status END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_new_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_message();

-- has_ordered auto-indicator (M12 — explicit user requirement).
-- Business scoping via orders.selling_point_id -> selling_points.business_id
-- (foundation lines 321-323). Orders without a resolvable selling point are skipped.
CREATE OR REPLACE FUNCTION public.tag_customer_has_ordered()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_id uuid;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  SELECT sp.business_id INTO v_business_id
  FROM public.selling_points sp
  WHERE sp.id = NEW.selling_point_id;
  IF v_business_id IS NOT NULL THEN
    INSERT INTO public.customer_tags (business_id, customer_id, tag)
    VALUES (v_business_id, NEW.customer_id, 'has_ordered')
    ON CONFLICT (business_id, customer_id, tag) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_orders_has_ordered AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tag_customer_has_ordered();

-- Backfill for existing orders (one-time, idempotent)
INSERT INTO public.customer_tags (business_id, customer_id, tag)
SELECT DISTINCT sp.business_id, o.customer_id, 'has_ordered'
FROM public.orders o
JOIN public.selling_points sp ON sp.id = o.selling_point_id
WHERE o.customer_id IS NOT NULL
ON CONFLICT (business_id, customer_id, tag) DO NOTHING;

-- Mark-read RPC with ownership check (H8 fix — v1's unchecked SECURITY DEFINER
-- let any authenticated user reset any business's read state)
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid, p_agent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id FROM public.conversations WHERE id = p_conversation_id;
  IF v_business_id IS NULL THEN RETURN; END IF;
  IF NOT (has_role(auth.uid(), 'admin'::app_role)
          OR is_business_member(v_business_id)) THEN
    RAISE EXCEPTION 'forbidden: not a member of this business';
  END IF;
  UPDATE public.messages SET is_read = true, read_at = now()
  WHERE conversation_id = p_conversation_id AND direction = 'inbound' AND is_read = false;
  UPDATE public.conversations SET unread_count = 0 WHERE id = p_conversation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid, uuid) TO authenticated;
-- Read semantics with multiple viewers: any member viewing marks the thread read for
-- everyone (accepted simplification, documented; per-agent read state is a future change).

-- Atomic rate-limit consume (§3.5) — service role only
CREATE OR REPLACE FUNCTION public.consume_send_tokens(p_channel_account_id uuid, p_count integer DEFAULT 1)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tokens integer;
BEGIN
  INSERT INTO public.rate_limit_buckets (channel_account_id)
  VALUES (p_channel_account_id) ON CONFLICT (channel_account_id) DO NOTHING;

  UPDATE public.rate_limit_buckets
  SET last_refill_at = clock_timestamp(),
      tokens_remaining = LEAST(40, tokens_remaining
          + floor(extract(epoch FROM (clock_timestamp() - last_refill_at)) * 40)) - p_count
  WHERE channel_account_id = p_channel_account_id
    AND LEAST(40, tokens_remaining
          + floor(extract(epoch FROM (clock_timestamp() - last_refill_at)) * 40)) >= p_count
  RETURNING tokens_remaining INTO v_tokens;

  RETURN v_tokens;  -- NULL = insufficient tokens (caller queues with next_retry_at)
END;
$$;
REVOKE ALL ON FUNCTION public.consume_send_tokens(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_send_tokens(uuid, integer) TO service_role;

-- ============================================================================
-- Storage policies for inbox-attachments (M6, H3)
-- Path convention: inbox-attachments/{business_id}/{conversation_id}/{uuid}.{ext}
-- ============================================================================
CREATE POLICY "Business members read inbox attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'inbox-attachments'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR is_business_member(((storage.foldername(name))[1])::uuid)
    )
  );
CREATE POLICY "Business members upload inbox attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inbox-attachments'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR is_business_member(((storage.foldername(name))[1])::uuid)
    )
  );
-- Inbound attachment uploads happen in the edge function with the service key
-- (bypasses storage RLS — service role is trusted).
-- DELETE policy: none for authenticated — retention cleanup is a service-role
-- pg_cron job (§21.2).

-- ============================================================================
-- Realtime publication (20260903000500 precedent)
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_outbox;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_orders;

-- ============================================================================
-- Cron: outbox sweep (30s) — safety net (§2.5); secret from vault per
-- 20260802065715 precedent. meta_cron_secret created via ops step §4.4.
-- ============================================================================
DO $$
BEGIN
  PERFORM cron.unschedule('inbox-outbox-sweep');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'inbox-outbox-sweep',
  '30 seconds',
  $job$
  SELECT net.http_post(
    url := 'https://jiwndicvfkiltgageqwv.supabase.co/functions/v1/meta-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meta_cron_secret' LIMIT 1)
    ),
    body := jsonb_build_object('mode', 'sweep', 'limit', 50)
  );
  $job$
);
```

### 4.3 Covering index note

`idx_conversations_list_cursor` (above) is the primary list-query index — keyset pagination with `(business_id, last_message_at DESC, id DESC)` serves the filter+order+cursor pattern directly (M11). v1's wide INCLUDE covering index is dropped: at this scale it adds write amplification for marginal gain.

### 4.4 Token Encryption with Vault (C4 fix — the working design)

**Key creation (one-time ops step, NOT in a migration — never commit key material):**

```sql
-- Run once from the Supabase dashboard SQL editor or psql:
SELECT vault.create_secret('<random-32-byte-string>', 'inbox_token_key');
SELECT vault.create_secret('<random-secret>', 'meta_cron_secret');
```

```bash
# And via CLI (edge function env):
supabase secrets set META_APP_SECRET=<app secret> META_APP_ID=<app id>
```

**Write/decrypt paths — SECURITY DEFINER RPCs owned by postgres** (matching the repo's verified precedent: every existing vault read happens inside a SECURITY DEFINER context or postgres-run cron SQL), **granted ONLY to `service_role`**:

```sql
-- Append to migration 20260911000200:

-- Connect a channel account. Takes the token in PLAINTEXT, encrypts inside the DB
-- with the vault key; plaintext is never stored. The edge function calls this via
-- PostgREST with the service key. (No trigger, no double-encryption hazard: this
-- function is the ONLY write path for access_token_encrypted.)
CREATE OR REPLACE FUNCTION public.connect_channel_account(
  p_business_id uuid, p_platform text, p_account_name text,
  p_page_id text, p_ig_account_id text, p_access_token text, p_verify_token text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_id uuid;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'inbox_token_key';
  IF v_key IS NULL THEN RAISE EXCEPTION 'vault secret inbox_token_key is missing'; END IF;
  INSERT INTO public.channel_accounts (
    business_id, platform, account_name, page_id, ig_account_id,
    access_token_encrypted, webhook_verify_token
  ) VALUES (
    p_business_id, p_platform::public.channel_platform, p_account_name,
    p_page_id, p_ig_account_id,
    pgp_sym_encrypt(p_access_token, v_key), p_verify_token
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.connect_channel_account(uuid, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connect_channel_account(uuid, text, text, text, text, text, text) TO service_role;

-- Rotate a token (reconnection flow). Plaintext in, encrypted at rest.
CREATE OR REPLACE FUNCTION public.rotate_channel_token(p_channel_account_id uuid, p_access_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'inbox_token_key';
  IF v_key IS NULL THEN RAISE EXCEPTION 'vault secret inbox_token_key is missing'; END IF;
  UPDATE public.channel_accounts
  SET access_token_encrypted = pgp_sym_encrypt(p_access_token, v_key),
      token_validated_at = now()
  WHERE id = p_channel_account_id;
END;
$$;
REVOKE ALL ON FUNCTION public.rotate_channel_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_channel_token(uuid, text) TO service_role;

-- Decrypt for the send path. meta-send / meta-bulk-send call this RPC; they never
-- touch the vault or the key. (Replaces v1's current_setting() GUC pattern, which
-- only works in psql — there is no mechanism to SET a GUC on a PostgREST session.)
CREATE OR REPLACE FUNCTION public.get_channel_access_token(p_channel_account_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_token text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'inbox_token_key';
  IF v_key IS NULL THEN RAISE EXCEPTION 'vault secret inbox_token_key is missing'; END IF;
  SELECT pgp_sym_decrypt(access_token_encrypted, v_key) INTO v_token
  FROM public.channel_accounts WHERE id = p_channel_account_id;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.get_channel_access_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_channel_access_token(uuid) TO service_role;
```

Why this works where v1's design didn't: (1) no GUC is ever needed — the Vault IS the key store; (2) SECURITY DEFINER owned by postgres reads `vault.decrypted_secrets` exactly as the repo's existing cron SQL does (verified precedent, six call sites); (3) the only decrypt path is an RPC executable by `service_role` alone, so `meta-send` (holding the service key) gets the plaintext token via `supabase.rpc('get_channel_access_token', ...)` and nothing else can. The "encrypt trigger" from v1 is deleted entirely — all writes flow through `connect_channel_account` / `rotate_channel_token`, which take plaintext only (documented contract), eliminating the double-encryption hazard.
