# Omni-Inbox Implementation Plan

## Architecture Overview

```
Meta Webhook → Supabase Edge Function → messages table → Realtime → Inbox UI
Agent Reply  → Inbox UI → Supabase Edge Function → Meta Send API
```

**Why Supabase Edge Functions for webhooks:** Your frontend is Vite/React (no server runtime). Meta requires a server-side webhook endpoint. Supabase Edge Functions (Deno) are already in your stack (`supabase/` dir exists) and handle this without adding a separate backend.

---

## Database Schema (Supabase/PostgreSQL)

### New Tables

```sql
CREATE TABLE channel_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id),
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_name TEXT NOT NULL,
  page_id TEXT,
  ig_account_id TEXT,
  access_token_encrypted TEXT NOT NULL,
  webhook_verify_token TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id UUID REFERENCES channel_accounts(id),
  platform TEXT NOT NULL,
  platform_conversation_id TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id),
  assigned_agent_id UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'open' CHECK (status IN ('open','assigned','waiting','resolved','closed')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  tags TEXT[] DEFAULT '{}',
  last_message_at TIMESTAMPTZ,
  unread_count INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, platform_conversation_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','agent','system')),
  sender_id TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN ('text','image','video','audio','file','product_card','invoice','courier_info','order_confirmation','template')),
  content TEXT,
  attachments JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  platform_message_id TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversation_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  order_id UUID REFERENCES orders(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE customer_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(customer_id, tag)
);

CREATE TABLE quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id),
  shortcut TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id UUID REFERENCES channel_accounts(id),
  platform_template_id TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  language TEXT DEFAULT 'en',
  components JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Indexes
- `conversations(assigned_agent_id, status)` - agent inbox filtering
- `conversations(last_message_at DESC)` - sorting
- `messages(conversation_id, created_at)` - message thread loading
- `conversations(customer_id)` - customer lookup
- `conversation_orders(order_id)` - order lookup

### RLS Policies
- Agents see only conversations in their business
- Agents see assigned or unassigned conversations based on role
- Admins see everything in their business

---

## Feature Breakdown by Module

### 1. Meta Platform Integration

| Task | Detail |
|------|--------|
| Meta App Setup | Create Meta Developer App, add Messenger + Instagram products |
| Webhook Endpoint | Supabase Edge Function at `/functions/v1/meta-webhook` |
| Webhook Verification | GET handler for `hub.verify_token` challenge |
| Event Subscription | Subscribe to `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads` |
| Token Management | Store Page Access Tokens encrypted (Supabase vault or pgcrypto) |
| Rate Limit Handling | Meta enforces 250 messages/second per page. Queue outbound sends |
| Multi-Account | Support N channel_accounts per business |
| Re-auth Flow | Alert when tokens expire, guide reconnection |

### 2. Webhook Processing Pipeline

```
Meta POST -> Edge Function -> Validate signature (X-Hub-Signature-256)
  -> Parse event type
  -> Upsert conversation (match platform_conversation_id)
  -> Insert message
  -> Trigger Supabase Realtime broadcast
  -> If new conversation: auto-assign via round-robin
  -> If keyword match: auto-tag
```

### 3. Inbox UI (React Components)

Three-panel design using `react-resizable-panels` (already in deps):

```
+-------------+------------------+--------------------+
| Conversation |   Message Thread |   Context Sidebar  |
|    List       |                  |                    |
|  [filters]  |  [messages...]   |  Customer Profile  |
|  [search]   |                  |  Order History     |
|  [convos]   |  [composer]      |  Linked Orders     |
|             |                  |  Product QuickSend |
|             |                  |  Tags              |
+-------------+------------------+--------------------+
```

**Components to create:**

| Component | Purpose |
|-----------|---------|
| `OmniInbox.tsx` | Main page, three-panel layout |
| `ConversationList.tsx` | Filterable, searchable conversation list |
| `ConversationItem.tsx` | Single row: avatar, name, preview, time, unread badge, tags |
| `MessageThread.tsx` | Scrollable message history with virtualized list |
| `MessageBubble.tsx` | Renders text/image/product/invoice/courier based on message_type |
| `ComposerBar.tsx` | Text input + attachment buttons + send |
| `ContextSidebar.tsx` | Tabbed panel: Customer, Orders, Products, Notes |
| `CustomerProfileCard.tsx` | Name, phone, tags, order count, lifetime value |
| `ProductQuickSend.tsx` | Search products -> send as rich card |
| `InvoiceQuickSend.tsx` | Select/generate invoice -> send as PDF link |
| `CourierQuickSend.tsx` | Enter tracking -> format & send courier info |
| `OrderLinker.tsx` | Link existing order or create new from chat |
| `TagManager.tsx` | Add/remove tags on customer or conversation |
| `QuickReplyPicker.tsx` | Slash-command or button to insert saved replies |
| `TemplateMessagePicker.tsx` | Send Meta-approved template messages |
| `AssignmentDropdown.tsx` | Assign/reassign conversation to agent |
| `BulkActionBar.tsx` | Select multiple conversations -> bulk close/tag/assign |

### 4. Order Management from Inbox

| Feature | Detail |
|---------|--------|
| Create Order | Button in sidebar opens `AddOrderDialog` (already exists) pre-filled with customer |
| Link Existing Order | Search orders by ID/customer -> link to conversation |
| View Linked Orders | Show linked orders in context sidebar with status badges |
| Order Status Updates | System message auto-posted when linked order status changes |
| Convert Chat to Order | Extract product mentions from chat -> pre-fill order form |
| Order Confirmation | Send formatted order summary card back to chat |

### 5. Product Sharing

| Feature | Detail |
|---------|--------|
| Product Search | Use existing `MiniProductCatalog` component |
| Send Product Card | Sends image + title + price + storefront link via Meta Send API |
| Product Carousel | Send multiple products as generic template carousel (FB) |
| Inventory Check | Show stock level before sending |
| Variant Selection | If product has variants, pick before sending |

### 6. Invoice Sharing

| Feature | Detail |
|---------|--------|
| Generate Invoice | Use existing `invoiceHtml.ts` to generate PDF |
| Send as Attachment | Upload to Supabase Storage -> send file URL in chat |
| Inline Preview | Show invoice thumbnail in message thread |
| Mark Sent | Update invoice status to "sent_via_chat" |

### 7. Courier / Tracking Info

| Feature | Detail |
|---------|--------|
| Manual Entry | Agent types tracking number + courier name |
| Auto-Fill from Order | Pull courier info from linked order's dispatch data |
| Formatted Message | Template: "Your order #[id] shipped via [courier]. Track: [url]" |
| Pathao Integration | Use existing `PathaoStoreLinks` logic to pull tracking |
| Delivery Status Sync | Periodic check -> update conversation if delivered |

### 8. Customer Tagging & CRM

| Feature | Detail |
|---------|--------|
| Manual Tags | Agent adds tags: "vip", "repeat-buyer", "complaint", etc. |
| Auto Tags | Rules engine: if customer ordered > 3 times -> auto-tag "loyal" |
| Order-Based Tags | Auto-tag when order placed: "has-ordered", "pending-payment" |
| Filter by Tag | Conversation list filterable by customer tags |
| Tag-Based Routing | Auto-assign VIP tagged customers to senior agents |
| Customer Notes | Free-text notes field on customer record |
| Merge Customers | Same person contacts from FB and IG -> merge profiles |

### 9. Bulk Promotional Messages

| Feature | Detail |
|---------|--------|
| Audience Builder | Filter customers by tags, order history, last activity |
| Template Selection | Must use Meta-approved message templates (24h rule compliance) |
| Variable Substitution | {{first_name}}, {{order_id}}, etc. |
| Scheduling | Pick date/time for campaign send |
| Rate Limiting | Batch sends respecting Meta's 250 msg/sec limit |
| Opt-Out Tracking | Log STOP/unsubscribe -> exclude from future campaigns |
| Delivery Reports | Track sent/delivered/read/failed per recipient |
| Campaign History | Log each bulk send with stats |

### 10. Agent Collaboration

| Feature | Detail |
|---------|--------|
| Round-Robin Assignment | Auto-assign new conversations evenly |
| Manual Assignment | Dropdown to pick specific agent |
| Internal Notes | Messages visible only to agents (not sent to Meta) |
| @Mentions | Notify another agent in internal note |
| Transfer | Move conversation to another agent with context |
| Collision Detection | Show who's currently viewing the conversation |
| Presence Indicators | Online/offline dots on agent avatars |
| Supervisor View | Admin sees all conversations, can barge into any |

### 11. Automation & Smart Features

| Feature | Detail |
|---------|--------|
| Auto-Replies | Keyword-triggered instant responses |
| Away Messages | Outside business hours -> send template |
| SLA Timers | Warn if conversation unanswered > X minutes |
| Auto-Close | Resolve after X hours of inactivity |
| Intent Detection | Simple keyword matching (future: AI-based) |
| Order Follow-Up | Auto-message 24h after delivery |
| Duplicate Detection | Flag if same customer messages from FB and IG |

### 12. Analytics & Reporting

| Metric | Detail |
|--------|--------|
| Response Time | Avg first response, avg resolution time |
| Volume | Messages/day, conversations/day, by platform |
| Agent Performance | Messages handled, avg resolution time per agent |
| Conversion Rate | Conversations that resulted in orders |
| Popular Products | Most shared/requested products |
| Peak Hours | Heatmap of message volume by hour |
| CSAT | Optional post-resolution survey via template message |

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Database schema migration
- [ ] Meta App setup + webhook Edge Function
- [ ] Basic conversation/message CRUD
- [ ] Supabase Realtime subscription for live messages
- [ ] Skeleton three-panel Inbox UI

### Phase 2: Core Messaging (Week 3-4)
- [ ] Full message thread rendering (text, images, files)
- [ ] Composer bar with text + attachment send
- [ ] Conversation list with search/filter/sort
- [ ] Unread counts + read receipts
- [ ] Agent assignment (manual + round-robin)

### Phase 3: Commerce Integration (Week 5-6)
- [ ] Product card sending (reuses `MiniProductCatalog`)
- [ ] Invoice generation + sharing (reuses `invoiceHtml.ts`)
- [ ] Courier info sending (integrates Pathao)
- [ ] Order creation/linking from inbox (reuses `AddOrderDialog`)
- [ ] Order status sync -> system messages

### Phase 4: CRM & Tagging (Week 7)
- [ ] Customer tagging system
- [ ] Auto-tag rules engine
- [ ] Customer profile sidebar
- [ ] Cross-platform customer merge (FB + IG -> same customer)
- [ ] Quick replies

### Phase 5: Bulk Messaging (Week 8)
- [ ] Audience builder UI
- [ ] Template management + Meta approval flow
- [ ] Bulk send engine with rate limiting
- [ ] Campaign scheduling
- [ ] Delivery tracking dashboard

### Phase 6: Polish & Scale (Week 9-10)
- [ ] Multi-account support (multiple businesses/pages)
- [ ] Internal notes + @mentions
- [ ] SLA timers + auto-close
- [ ] Analytics dashboard
- [ ] Performance optimization (virtualized lists, pagination)
- [ ] E2E tests with Playwright

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Webhook handler | Supabase Edge Function | No backend server needed; already in stack |
| Realtime updates | Supabase Realtime | Already using `@supabase/supabase-js`; no WebSocket infra |
| File storage | Supabase Storage | For invoice PDFs, images sent in chat |
| Token encryption | Supabase Vault / pgcrypto | Meta tokens must not be plaintext |
| Message queue for bulk | Supabase pg_cron + queue table | Avoid external queue dependency |
| Virtualization | `@tanstack/react-virtual` | 500+ message threads need virtual scroll |
| State management | TanStack Query | Already in deps; handles caching + realtime invalidation |
| UI components | shadcn/ui | Already in deps; consistent design system |

---

## Meta API Constraints to Handle

1. **24-Hour Rule:** Can only send free-form messages within 24h of customer's last message. After that, must use approved template messages.
2. **Rate Limits:** 250 msgs/sec per page. Implement token bucket.
3. **Webhook Deduplication:** Meta may send duplicate events. Idempotent message inserts via `platform_message_id` UNIQUE constraint.
4. **Attachment Size:** Images max 8MB, files max 25MB.
5. **Template Approval:** All proactive messages require pre-approved templates. Build template submission flow.
6. **IG vs FB Differences:** Instagram uses `ig_id`, Facebook uses `psid`. Normalize in `conversations` table.

---

## Security Considerations

- Webhook signature verification (HMAC SHA-256) on every request
- Encrypted access tokens at rest
- RLS policies scoped to business_id
- Audit log for all agent actions (send, delete, assign)
- PII handling: customer phone numbers/names encrypted
- Rate limiting on send endpoints to prevent abuse