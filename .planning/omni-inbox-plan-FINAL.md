# Omni-Inbox — Final Plan (Readable Digest)

> Full SQL + every detail: `.planning/omni-inbox-plan-v4.md` (reference doc).
> This file = what you're getting and in what order. 4 critique cycles, ~119 issues fixed.

---

## What You Get — Features

### Core (your original asks)
1. **One inbox for FB Messenger + Instagram DMs** — both platforms, multiple pages/accounts, one screen.
2. **Take orders from the chat** — click "Create Order", form opens pre-filled with the customer's name/phone, order auto-links to the conversation, "Order #X created" posts into the thread.
3. **Send products** — pick from your catalog, customer gets a rich card (image + price + shop link).
4. **Send invoices** — invoice rendered to image, sent as an attachment in the chat.
5. **Send courier info** — pull tracking from a linked order (Pathao), send "shipped via X, track here" in one click.
6. **Mark customers who ordered** — automatic `has_ordered` badge on the customer, visible in the chat sidebar.

### Team inbox
7. **Agent assignment** — new chats auto-assigned round-robin; reassign by dropdown.
8. **Internal notes + @mentions** — yellow notes teammates see; never sent to the customer.
9. **Collision detection** — "Ana is also viewing this chat" banner stops double replies.
10. **Presence** — online/away/busy dots on agent avatars.
11. **Transfer** — hand a chat to another agent with an automatic handover note.

### Speed tools
12. **Quick replies** — type `/hours`, `/price` to insert saved answers.
13. **Saved messages** — reusable drafts with variables.
14. **Tags** — VIP, repeat-buyer, complaint; filter the inbox by tag; VIPs can route to senior agents.
15. **Search** — full-text across all messages (including archived).

### Automation
16. **Auto-reply** — keyword triggers ("price" → price list).
17. **Auto-tag / auto-assign / auto-close** — rules engine, you configure in settings.
18. **Away message** — outside business hours, customers get a template reply.
19. **SLA escalation** — chat unanswered too long → priority bump + alert.
20. **CSAT survey** — after resolution, customer gets "rate 1–5", score stored.

### Marketing (bulk)
21. **Bulk promotional messages** — audience builder (by tag, order count, last activity), scheduled sends.
   - Within 24h of a customer's message: free — always allowed.
   - Outside 24h: only to customers who **opted in** (Recurring Notifications / one-time opt-in — Meta rules).
   - Opt-in prompts sendable from the chat in 2 clicks.
22. **Opt-out handling** — customer says STOP → auto-suppressed everywhere, compliance-safe.
23. **Campaign dashboard** — sent / failed / pending per campaign.

### Platform & scale
24. **Delivery ticks** — sent ✓, delivered ✓✓, read ✓✓ (like WhatsApp).
25. **Multi-account** — N Facebook pages + N Instagram accounts per business.
26. **Multi-tenant** — businesses fully isolated (RLS); agents see only their business.
27. **Analytics** — response times, conversion rate (chat → order), agent performance, peak hours.
28. **Attachments both ways** — customers send photos; you send files/images (persisted — Meta URLs expire).

---

## Architecture (30-second version)

```
Meta webhook → Supabase Edge Function (meta-webhook)
  → verify signature → find conversation → save message → run automations
Supabase Realtime → Inbox UI updates live (React + TanStack Query)
Agent hits send → outbox queue → meta-send (24h check, rate limit) → Meta API
```

- No separate backend — your existing Supabase does everything.
- All outbound goes through a **queue** (retries, rate limits, audit).

---

## Database (16 new tables)

| Table | What it does |
|---|---|
| `channel_accounts` | FB/IG page connections + encrypted tokens |
| `conversations` | One row per customer chat (status, assignment, 24h window) |
| `messages` | Every message (all types, delivery ticks) |
| `message_outbox` | Send queue (retry, rate-limit, 24h-block states) |
| `conversation_orders` | Links chats ↔ orders |
| `customer_tags` / `customer_notes` | CRM marking |
| `saved_messages` / `quick_replies` | Speed tools |
| `notification_subscriptions` | Who opted in to promo messages |
| `bulk_campaigns` / `bulk_campaign_recipients` | Bulk sends + per-recipient tracking |
| `automation_rules` | The rules engine config |
| `messaging_opt_outs` | STOP registry |
| `conversation_viewers` / `agent_presence_log` | Collision + presence |
| `meta_webhook_events` / `messages_archive` | Observability + 12-month archive |

Security built in: token encryption (pgcrypto), signature-verified webhooks, RLS on every table, cross-tenant send prevention (double-checked in DB + edge function).

---

## Meta API Rules You Must Know

1. **24-hour rule** — free-form replies only within 24h of the customer's *last* message. After that: template/opt-in messages only. The UI enforces this (composer disables + countdown).
2. **Rate limit** — ~250 msg/sec per page. Your bucket: 200/sec, self-seeding.
3. **Templates ≠ WhatsApp** — Messenger/IG use message tags + opt-in notifications, NOT pre-approved templates. Plan designs for this correctly.
4. **App Review takes weeks** — start it in Phase 0, build in Dev Mode meanwhile (your team = testers, no waiting).
5. **Attachment URLs expire** — webhook downloads media to your Storage asynchronously.

---

## Build Order (10 phases, ~14 weeks)

### Phase 0 — Meta App + App Review ⏱ weeks 1–3 (parallel, start TODAY)
1. Create Meta app: add Messenger + Instagram products
2. Submit for business verification + permissions review (`pages_messaging`, `instagram_manage_messages`, RN/OTN usages)
3. Webhook URL → your Supabase Edge Function
4. Spike: verify Recurring Notifications payload shapes (1 day)
- **Launch path:** ship internally in Dev Mode while review is pending. Review blocks *live* traffic only.

### Phase 1 — Database foundation ⏱ weeks 1–2
1. Migrations: 6 files — enums → alias types → **03a orders.business_id (FIRST)** → schema (dependency-ordered tables) → storage → realtime
2. Token encrypt/decrypt + rate-limit seeding + smoke tests (1 day)
3. `npm i @tanstack/react-virtual`

### Phase 2 — Core messaging ⏱ weeks 3–4
1. Webhook: full event parsing + customer resolution + idempotent inserts
2. Inbox UI: 3-panel layout (list / thread / sidebar), mobile = swipe drawer
3. Send path: composer → outbox → meta-send; delivery ticks; unread counts
- **Milestone: you can chat with a real customer from your site.**

### Phase 3 — Team features ⏱ weeks 4–5
1. Round-robin + manual assignment
2. Internal notes, transfer, presence, collision detection

### Phase 4 — Commerce (your core asks) ⏱ weeks 5–7
1. Create order from chat (prefilled + catalog-scoped + auto-link)
2. Product cards, invoice send (`html-to-image`), courier info
3. Order status → auto system message in the thread
4. Phone-merge returning customers
- **Milestone: the order-taking workflow works end to end.**

### Phase 5 — CRM ⏱ weeks 7–8
1. Tags + notes + `has_ordered` badge
2. Quick replies + saved messages
3. Cross-platform customer merge UI

### Phase 6 — Automation ⏱ weeks 8–9
1. Rules editor + engine (keyword, tag, assign, close)
2. Away messages + SLA timers (pg_cron)

### Phase 7 — Bulk messaging ⏱ weeks 9–11
1. Opt-in prompt flow + subscription tracking
2. Audience builder + scheduled campaigns + rate-controlled sender
3. Opt-out + campaign dashboard

### Phase 8 — Analytics + polish ⏱ weeks 11–13
1. Dashboard (Recharts): response times, conversion, agents, peaks
2. Accessibility pass, E2E tests, load test (500 convos/day)

### Phase 9 — Hardening ⏱ weeks 13–14
1. Token probe (weekly), dead-letter queue, monitoring alerts, admin docs

---

## Reuse (don't rebuild)

| Existing | Used for |
|---|---|
| `AddOrderDialog` | Order-from-chat (small mod: prefill + scoped catalog + return orderId) |
| `MiniProductCatalog` | Product picker in sidebar |
| `invoiceHtml.ts` | Invoice rendering before send |
| `CourierDispatchStation` logic | Tracking info messages |
| `woo-webhook` pattern | Signature verification + idempotency (copy the pattern) |
| `customer_aliases` | Cross-platform identity (FB + IG = one customer) |
| shadcn/ui + TanStack Query | All UI |

---

## Top 5 Risks

1. **App Review delay** → mitigated: Dev Mode launch path, review runs in parallel from day 1.
2. **Promo reach is opt-in-bound** → mitigated: 24h-window campaigns always work; opt-in prompts build the out-of-window audience.
3. **Rate-limit table empty = all sends dead** → fixed: self-seeding + trigger + smoke test.
4. **Migration order bugs** → fixed: 03a runs first, dependency-ordered tables, CI assertion.
5. **Cross-tenant leaks** → fixed: RLS + DB-level consistency checks + edge-function re-assert (three layers).

---

## Start Here

1. Run Phase 0 step 1 today: create the Meta app (30 min, free).
2. Tell me "start Phase 1" and I'll generate the 6 migration files from v4's SQL.
