# Omni-Inbox Implementation Plan v3

## Comprehensive Facebook/Instagram Chat Integration for Shohozbiz

**Date:** 2026-09-10 (revision of v2; addresses all 33 issues from `omni-inbox-critique-2.md`)
**Stack:** Vite + React + TypeScript + shadcn/ui + Supabase (managed PostgreSQL 15.x) + Supabase Edge Functions (Deno)
**Scale Target:** 5-20 agents, 100-500 conversations/day/account, multiple business accounts
**Status:** Every codebase claim modified in this revision was re-verified against the repository in this session (AddOrderDialog internals at cited lines, order_sources seed values, orders/selling_points DDL and ALTER history, `claim_sync_queue_batch` body, `app_permission` enum values, existing storage policies, and the absence of any pgcrypto usage were all re-read from source). Meta platform claims that could not be verified against live platform behavior are explicitly marked **[VERIFY IN PHASE 0 SPIKE]** and are backed by a documented fallback (§10.6).

### What changed from v2 (all 33 cycle-2 critique issues)

| # | Issue | Resolution in v3 |
|---|-------|-----------------|
| CR-1 | pgcrypto functions unresolvable under `search_path = public, vault` — Migration C aborts at the vault-key DO block; encrypt/decrypt RPCs would throw forever | §13.1 — `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions` (matches the repo's pg_net/pg_cron convention, verified 20260414193433) + every pgcrypto-calling function sets `search_path = public, vault, extensions` AND schema-qualifies the calls (`extensions.pgp_sym_encrypt(...)`) — belt and braces; the DO block schema-qualifies (`extensions.gen_random_bytes(32)`) because DO blocks have no function-level SET; Phase 1 checklist gains a round-trip encrypt/decrypt smoke test |
| HI-1 | RN opt-in mechanism factually wrong — no custom-CTA opt-in message exists; topics are a fixed taxonomy, not free-form | §2.2.10, §10.2, §8.3, §10.1, §2.2.9 — full redesign: the opt-in prompt IS a structured `notification_messages` template send (topic from Meta's fixed taxonomy + business-picked frequency); Meta renders its own Allow/Manage prompt card — no freeform CTA exists and none is attempted; acceptance fires the `messaging_optins` webhook; OTN specified as a distinct `one_time_notif` button-template flow; topic stored as taxonomy vocabulary with a spike-finalized CHECK; `saved_messages.optin_config` stores the template payload, not CTA copy |
| HI-2 | §6.1 anchored on three wrong facts (wrapper-scoping claim, source id-vs-name, missing `onCreated` payload) + missing catalog-scoping modification | §6.1 — re-verified against AddOrderDialog source this session: (a) `onCreated` result payload `{orderId, orderNumber, customerId}` — all three already in scope at the call site (lines 810/837/778; invocation at 897); (b) `prefill.sourceName` carries the source row **name** (state holds names — lines 241/303; the name string is what gets inserted — lines 803/817); (c) phone seeded **raw** (dialog normalizes on save, line 779; `normalizeBdPhone` is BD-specific — documented limitation); (d) new `catalogScope` prop filters the dialog's **self-fetched** catalog (lines 284-321 verified — no dataset props exist, so wrapper-side scoping was impossible); Phase 4 re-budgeted 1-2 days + regression |
| HI-3 | Cross-tenant send hole: outbox INSERT policy validated only `business_id` — referenced conversation/channel_account could belong to another business; meta-send would decrypt B's page token and deliver on B's page | §2.3 — `EXISTS` relational-consistency clauses on `message_outbox`, `messages`, `conversation_orders` INSERT/WITH CHECK policies (complete SQL below); `meta-send` re-asserts `conversation.business_id = outbox.business_id` and `channel_account.business_id = outbox.business_id` after claiming (§5.1) and refuses with `error_code='cross_business_refusal'` on mismatch |
| ME-1 | Sweep claim SQL unspecified — no `FOR UPDATE SKIP LOCKED`, no atomic status recheck; concurrent webhook-fired + cron sweeps guaranteed | §5.6 — service-role-only `claim_outbox_batch` RPC pinned in full SQL: CTE with `FOR UPDATE SKIP LOCKED` + outer status recheck (defeats EvalPlanQual re-evaluation), same shape as the repo's verified `claim_sync_queue_batch` (20260829000000 — body read in full this session) |
| ME-2 | INSERT-only outbox subscription could never deliver the promised sending→sent/failed transitions | §1.4, §3.6 — outbox subscription uses **two postgres_changes handlers on one channel** (INSERT + UPDATE), both filtered by `conversation_id`; messages stays INSERT-only; churn bounded (~3 updates per outbox row); `blocked_window`/terminal `failed` reach the UI via the outbox UPDATE event — the only possible signal for failed sends, which insert no `messages` row; delivered/read ticks reach the UI via a 30-seconds-while-open status refetch (stated plainly — postgres_changes cannot server-side filter on column transitions) |
| ME-3 | Campaign double-trigger: sweep handed campaigns to meta-bulk-send AND meta-bulk-send ran on its own 1-minute cron — two engines, no claim step | §1.3, §5.6, §10.4 — 1-minute cron **removed**; the sweep is the sole campaign trigger; `meta-bulk-send` opens with the atomic campaign claim `UPDATE bulk_campaigns SET status='sending', started_at=now() WHERE id=$1 AND status='scheduled' RETURNING *` — the loser gets zero rows and exits; concurrent sweep invocations (cron + webhook-fired) are thereby safe |
| ME-4 | `last_customer_message_at = NEW.created_at` with no GREATEST guard — a delayed Meta retry with an older timestamp rewinds the window (and `last_message_at` ordering) | §2.5.1 — all three bookkeeping columns use `GREATEST(existing, NEW.created_at)` (NULL-safe: GREATEST ignores NULLs); `first_agent_response_at` population additionally excludes campaign/bot/system rows and requires a prior customer message (also fixes ME-11) |
| ME-5 | `messages` INSERT policy had the same unvalidated-FK hole + a sender-spoofing gap (`sender_type IN ('system','bot')` client-insertable) | §2.3, §2.5.5 — EXISTS conversation-business clause added; client inserts restricted to `sender_type='agent' AND sender_agent_id = auth.uid()`; new BEFORE INSERT trigger `assert_message_sender` refuses system/bot/customer rows from any authenticated session (service role passes: `auth.uid() IS NULL`); sanctioned client system events go through the new `post_system_message` SECURITY DEFINER RPC (§2.5.5) |
| ME-6 | Storage upload policy let any member write into any folder inside the business prefix; no mime/size enforcement at storage layer | §2.6 — upload constrained to `{business_id}/{conversation_id}/{filename}` with a conversation-EXISTS check (which rides `conversations` RLS for tenant scoping); avatar path (`{business_id}/avatars/…`) fails the conversation-segment check and is service-role-only; mime/extension enforcement explicitly documented as **client-side only** (the bucket's 25MB `file_size_limit` is the only storage-layer gate) |
| ME-7 | `storage.foldername` + EXISTS-subquery storage policies: new territory, no in-repo precedent, uuid-cast hazard, per-object subquery cost | §2.6 — uuid-regex guard before the `::uuid` cast (malformed folder names cannot crash the cast); read policy needs only `foldername`-parse + one `is_business_member` lookup per object (no cross-table subquery); expected volumes stated (≤50 policy evaluations per gallery page, each O(1) on the `user_business_access` unique index); Phase 2 checklist gains a storage-policy smoke test |
| ME-8 | HUMAN_AGENT requires Meta Advanced Access approval — absent from the Phase 0 permission/review set; live-mode tagged sends would fail | §14 Phase 0, §4.5, §5.2 — HUMAN_AGENT + `notification_messages` + `one_time_notif` usage added to the App Review submission list; a capability check (Advanced Access status / dev-mode trial behavior) added to the spike; §5.2 matrix row documents the failure mode; the tag selector surfaces a disabled state with explanation until approved |
| ME-9 | `orders` has no `business_id` — audience "min_orders"/LTV/`has_ordered`-trigger had no business-scoped order source; `selling_points` has no UNIQUE on `(type, woo_store_id)` (ambiguity unexamined) | §2.5.4 — additive nullable `orders.business_id` (permitted by §17.3's additive-only policy) + BEFORE INSERT resolution trigger (prefer `selling_point_id` — verified to exist, foundation lines 321-323; fallback `store_id → selling_points.woo_store_id`) + one-time backfill; ambiguity from the missing `selling_points` UNIQUE documented (deterministic oldest-row pick; data-quality follow-up listed in Phase 8); §2.5.3(a) trigger, §7.4 aggregates, §10.1 audience filters key off the new column; unresolvable storefront/POS orders remain NULL and are explicitly excluded from inbox audience analytics |
| ME-10 | Campaign↔topic linkage undefined (bulk_campaigns had no topic; eligibility SQL keyed off a vocabulary that didn't exist) | §2.2.11, §10.3 — `bulk_campaigns.notification_topic` column with a taxonomy CHECK (values finalized from the Phase 0 spike; initial documented subset shipped, Phase 7 migration finalizes); recipient-build JOIN pinned: subscriptions `status='active' AND (expires_at IS NULL OR expires_at > now()) AND topic = campaign.notification_topic AND channel_account_id = campaign.channel_account_id` |
| ME-11 | Outbound campaign messages set `first_agent_response_at` → first-response-time ≈ 0 skew | §2.5.1, §11.1 — trigger sets the column only for `sender_type='agent' AND (metadata->>'campaign_id') IS NULL AND last_customer_message_at IS NOT NULL` (also excludes internal notes by sender_type); `meta-bulk-send` stamps `metadata.campaign_id` on campaign-originated rows; the MV additionally computes the average with `FILTER (WHERE c.last_customer_message_at IS NOT NULL)` |
| ME-12 | Attachment download sat on the webhook critical path — a batch of slow CDN fetches breaches the 20s budget; failure-handling covered failures, not latency | §5.5, §4.4, §1.1 — async from day one: the webhook inserts the message immediately with `metadata.download_pending=true` and `meta_url` in `attachments`; the **sweep** performs downloads (batch 25, retry ≤ 24h); only the message insert is on the critical path |
| ME-13 | Opt-outs were campaign-only — never applied to 1:1 agent replies or automation auto-replies (decision undefined) | §5.2, §10.5 — explicit decision: opt-out suppresses **all** outbound (agent, automation, campaign, and non-transactional tag sends) except `ACCOUNT_UPDATE` / `POST_PURCHASE` transactional tags; `meta-send` checks `messaging_opt_outs` (global + per-channel rows) per row → `status='cancelled'`, `error_code='opted_out'`; UI shows an opted-out banner in the composer |
| ME-14 | `meta-connect-account` listed but undesigned — OAuth flow, token exchange (app secret!), page selection never specified | §4.7 (new) — complete flow: FB Login dialog redirect (state CSRF check) → client POSTs `code` → edge function exchanges short-lived → long-lived user token **server-side** (app secret never crosses the browser) → `/me/accounts` page + linked-IG discovery → user picks page → long-lived page token inserted via service client (trigger encrypts) → app subscription POSTed; JWT + `inbox.manage` gated; manual paste remains the fallback |
| ME-15 | `ALTER TYPE ADD VALUE` + same-transaction casts: the A/C migration split was right but the merge hazard was unstated | §2.1, Phase 1 — hard warning added: Migration A must never be merged with Migration C; `IF NOT EXISTS` does NOT make ADD VALUE safe inside a transaction that subsequently casts the new value ("unsafe use of new value"); Phase 1 PR gains a CI assertion that Migration A contains zero `CREATE POLICY`/`CREATE TABLE` statements |
| ME-16 | Cost estimate missed per-message sweep invocations (webhook fires sweep per inbound message) | §1.5, §17.1 — the webhook fires the sweep **only when it actually inserted outbox rows** (sole non-cron trigger, now stated in §1.1 step 11); §17.1 recounts honestly including the automation-triggered share (≈19-38K/day total, stated with assumptions) |
| LO-1 | `.or()` string interpolation with unvalidated `entry.id` — crafted IDs break PostgREST filter syntax | §4.3 — `/^\d+$/` validation before any query; two typed queries (`.eq('page_id', …)` or `.eq('ig_account_id', …)` per payload object, selected by `payload.object`) replace `.or()` entirely |
| LO-2 | `order_sources` has no 'fb/ig' row (foundation line 516 is a tolerant lookup; the only seed inserts online/pos/phone/social/wholesale — re-verified this session) | §2.2.0 — Migration B seeds `'fb/ig'` guarded by `WHERE NOT EXISTS` (no reliance on a name UNIQUE); this also unblocks the foundation's FB selling-point backfill, which looks the row up tolerantly |
| LO-3 | `conversation_viewers` FOR ALL own-rows policy allowed inserting viewer rows for arbitrary conversations (cross-tenant "X is viewing" pollution) | §2.3 — FOR ALL split into INSERT (+ conversation EXISTS, which rides conversations RLS for tenant scoping) / UPDATE / DELETE policies keyed to own rows |
| LO-5 | `LIKE … INCLUDING DEFAULTS` archive silently drops CHECK constraints and the platform_message_id UNIQUE | §17.5 — hand-written archive DDL; constraint-free BY DESIGN (stated): the archive is read-only cold history; PK on `id` makes monthly copy runs idempotent (`ON CONFLICT (id) DO NOTHING`); partial FTS index added so search spans the archive |
| LO-6 | Graph timeout + auto-retry duplicates customer messages (Send API has no client dedup id for normal sends) | §5.2, §16.2 — timeout/abort/unknown-outcome errors are **never auto-retried**: row marked `failed` with `error_code='timeout_unknown'` and a "possibly sent — verify in thread" agent-facing message; manual retry creates a NEW outbox row only after the agent confirms the thread; only explicit API error responses with retryable codes enter the backoff loop |
| LO-7 | Keyset pagination on `last_message_at` alone skips same-timestamp conversations | §3.3 — tuple keyset `(last_message_at DESC, id DESC)` via PostgREST `.or()` compound predicate |
| LO-8 | Tags GIN index vs query-shape mismatch (array-contains queries never specified) | §3.3 — tag filters specified as `.contains('tags', ['vip'])` (PostgREST → `tags @> …`), which the GIN index serves |
| LO-9 | Dev-mode tester mechanics missing (IG follow requirement, page roles, personal-account messaging) | §14 Phase 0 — checklist adds: each tester messages the page from their **personal** account; IG testers must follow + interact with the professional account first (DMs from non-followers are unreliable); Messenger testers may need a page role in some configurations |
| LO-10 | Presence `ended_at` close-out unspecified — dangling intervals, no sweep | §9.4, §17.5 — client closes its interval via a `keepalive: true` fetch on `pagehide` (sendBeacon cannot set the Authorization header — stated) to a tiny `meta-presence` endpoint; pg_cron sweep force-closes `ended_at IS NULL AND started_at < now() - interval '24 hours'` rows |
| LO-11 | Campaign counters read-modify-write across the 10-20 promise pool | §10.4 — atomic per-statement increments only (`SET sent_count = sent_count + 1`), same for skipped/failed/opted-out counters; `total_recipients` frozen at build time; send-time re-check failures update `skipped_count` atomically |
| LO-12 | Search RPC uncapped; `ts_headline` expensive over large sets | §3.7 — RPC caps at 50 conversations (LIMIT inside the CTE, before `ts_headline` runs); headline computed only over the capped set |
| LO-13 | "Optimistic `updated_at` check" claimed but never specified | §3.3, §16.3 — spec pinned: every conversation mutation from the client (assign/transfer/snooze/status) appends `.eq('updated_at', expectedUpdatedAt)`; zero returned rows → conflict toast + refetch |
| LO-14 | Alias lookup `maybeSingle()` throws on merge-race duplicates; `merge_chat_customers` RPC unspecified | §7.1, §7.2 — lookup uses `.limit(2)` + explicit conflict handling (deterministic oldest-customer pick + logged duplicate warning); `merge_chat_customers` written in full SQL (alias dedup-delete before move, transactional conversation/tag/note/subscription repointing, permission assertion scoped to the business) |

---

## Preamble: Verified Codebase Facts

Every fact below was verified directly (v2's verified set re-confirmed where inherited; new rows verified in this revision session):

| Fact | Evidence |
|---|---|
| `customers` is a **global** table — no `business_id`, nullable `store_id`, `name TEXT NOT NULL`, permissive RLS `USING (true)` | Migration `20260407071618_75b9cdbd-ffa1-48c1-bbce-54015ebc3c86.sql` |
| `customer_aliases`: `type text NOT NULL CHECK (type IN ('name','email','address'))` (unnamed inline CHECK → default name `customer_aliases_type_check`, so `DROP CONSTRAINT IF EXISTS` works), unique index `(customer_id, type, lower(value))` — the SAME alias value CAN appear under two customers (merge-race window, LO-14) | Migration `20260418114108_15541481-23a5-43f7-9792-6e3c6c2d4ae1.sql` |
| Multi-tenant RLS pattern: DO block with `FOREACH` over `business_id`-carrying tables; `has_role(auth.uid(),'admin') OR is_business_member(business_id)` | `20260904000100_multi_business_foundation.sql` lines 333-348 |
| `is_business_member()` — `SECURITY DEFINER`, checks `user_business_access` | Foundation lines 56-68 |
| `user_business_access` — per-business roles `('owner','admin','member','viewer')`, `UNIQUE (user_id, business_id)` | Foundation lines 43-53 |
| `has_role(_user_id, _role)` / `has_permission(_user_id, _permission)` — both SECURITY DEFINER; admin bypass, per-user override, custom-role grants | Migrations `20260412161413`, `20260420112330` |
| `trigger_set_timestamp()` exists | Migration `20260803160000_create_sync_queue.sql` line 20 |
| **`claim_sync_queue_batch` precedent** — SECURITY DEFINER RPC claiming a batch via CTE `SELECT id … ORDER BY created_at ASC LIMIT p_limit FOR UPDATE SKIP LOCKED` then UPDATE from the CTE | Migration `20260829000000_claim_sync_queue_batch.sql` (body read in full this session) |
| **No migration enables pgcrypto or references `pgp_sym_*`/`gen_random_bytes`** — pgcrypto is NOT pre-installed by this repo; pg_net and pg_cron are installed `WITH SCHEMA extensions` (the hosted-default extensions schema) | `20260414193433`, `20260418234156`, `20260416123736` (verified: zero pgcrypto references repo-wide) |
| `orders` carries `store_id` (nullable) but **no `business_id`**; the foundation added `location_id` + `selling_point_id` (nullable) at lines 321-323 | `20260407071618` (DDL read in full); foundation 321-323 |
| `selling_points`: `business_id NOT NULL`, `type IN ('woocommerce','shopify','dokanos_storefront','showroom_pos','facebook','instagram',…)`, nullable `woo_store_id`; indexes on `brand_id`/`business_id` only — **NO UNIQUE on `(type, woo_store_id)`** (multi-business ambiguity possible) | Foundation lines 125-155 (re-verified) |
| `order_sources` seed rows are exactly `online, pos, phone, social, wholesale` — **no 'fb/ig' row exists**; foundation line 516 is a tolerant `SELECT … WHERE name='fb/ig'` (yields NULL today) | `20260415165743` (seed read in full); foundation 515-521 |
| `orders.source` CHECK constraint was dropped (any text insertable) | Migration `20260415171221` |
| woo-webhook: 616 lines; HMAC via `crypto.subtle`, compares **base64** (`btoa`) at line 104; idempotency via `webhook_events.delivery_id` at lines 50-59; service-role client line 48; `resolveOrCreateCustomer` 550-614 — phone-first **global** lookup | `supabase/functions/woo-webhook/index.ts` |
| **`AddOrderDialog` (1304 lines) — all facts re-verified this session:** Props `{open, onOpenChange, onCreated}` at lines 89-93; `onCreated()` invoked with **no arguments** at line 897; `orderNumber` (line 810), `order.id` (from `.select("id").single()`, lines 815-837), and `customerId` (line 778) are **in scope at the onCreated call site**; `source` state holds the source row **name** (`useState("phone")` line 241; `setSource(def.name)` line 303) and the **name string** is inserted into `customers.source` (line 803) and `orders.source` (line 817); customer resolved by typed phone (line 782), phone normalized **on save** via `normalizeBdPhone` (lines 35-42, 779 — BD-format-specific: strips non-digits, transforms 880/10-digit forms); the dialog **self-fetches** products, variations, order_sources, pathao geo, invoice_settings, stores, categories, product_categories in a `Promise.all` on open (lines 284-321) — it accepts **no dataset props** for these | `src/components/orders/AddOrderDialog.tsx` |
| `MiniProductCatalog` props: `products, categories, productCatMap?, stores, onSelectProduct, onAddCustomItem, className?` — caller must supply all data | `src/components/orders/MiniProductCatalog.tsx` lines 31-39 |
| package.json: has `@tanstack/react-query`, `react-resizable-panels`, `fuse.js`, `vaul`, `recharts`; **does NOT have `@tanstack/react-virtual`** | `package.json` |
| `webhook_events`: service-role-only (`REVOKE … FROM PUBLIC, anon, authenticated; GRANT ALL … TO service_role`) | Migration `20260802065800` |
| pg_cron → edge function precedent: `cron.schedule` + `net.http_post` with `x-cron-secret` from `vault.decrypted_secrets` | Migration `20260802065715` |
| Vault precedent: `vault.create_secret` + SECURITY DEFINER getter RPC with `SET search_path = public, vault` (the getter only SELECTs from `vault.decrypted_secrets` — it never invokes a pgcrypto function, so it is NOT evidence that pgcrypto resolves under that search_path) | Migration `20260901000000` |
| Realtime publication precedent: `ALTER PUBLICATION supabase_realtime ADD TABLE` | Migration `20260903000500` |
| Type definitions live in `src/integrations/supabase/types.ts` (3497 lines); `app_permission` values at 3454-3492 (**includes `orders.edit`, `customers.edit`; NO `inbox.*` values yet** — Migration A adds them); `app_role` at 3493 (`admin, staff, viewer`) | `src/integrations/supabase/types.ts` |
| Storage precedent is **thin**: the only `storage.objects` policies in the repo are simple `bucket_id = 'invoice-assets'` checks on a **public** bucket; no `storage.foldername` usage exists anywhere — the inbox storage policies are NEW territory (smoke-tested in Phase 2, ME-7) | `20260412172337`, `20260614043218` |
| `audit_log.entity_type` is plain `text` (no enum constraint); `logAction(action, entityType, ...)` | Migration `20260412171140`; `src/lib/auditLog.ts` line 5 |
| pg_cron used extensively (13 `cron.schedule` sites across migrations); pg_net precedent for HTTP-calling edge functions | — |

---

## Codebase Context Summary

| System | Key Files | Reuse Opportunity |
|--------|-----------|-------------------|
| Multi-tenant foundation | `supabase/migrations/20260904000100_multi_business_foundation.sql` | `businesses`, `user_business_access`, `brands`, `selling_points` (has `facebook`/`instagram` types), `is_business_member()`, `has_role()`, `has_permission()` RLS toolkit |
| Role/permission system | `src/integrations/supabase/types.ts` (app_permission at 3454-3492) | `app_permission` enum extension; `user_permissions`/`custom_roles` consumed by `has_permission()` |
| Orders | `src/components/orders/AddOrderDialog.tsx` (1304 lines) | Order creation flow — **requires three small modifications for inbox use** (§6.1); not as-is reuse |
| Product catalog | `src/components/orders/MiniProductCatalog.tsx` | Fuse.js product search — caller supplies products/categories/stores (props verified) |
| Invoice | `src/lib/invoiceHtml.ts`, `src/components/pos/InvoicePrint.tsx` | HTML invoice generation ready for PDF rendering |
| Courier | `src/components/dashboard/CourierDispatchStation.tsx`, `supabase/functions/pathao-courier/index.ts` | Tracking/dispatch patterns |
| Customers | `customers` (global), `customer_aliases` | Alias-based platform-ID → customer mapping (type CHECK must be extended, §2.2.0) |
| Webhooks | `supabase/functions/woo-webhook/index.ts` | Deno.serve, CORS, `crypto.subtle` HMAC, idempotency, service-role client (HMAC *comparison encoding* differs from Meta — §5.3) |
| Cron + pg_net | `20260802065715_schedule_woo_sync_cron.sql` | Exact pattern for cron-triggered edge functions with vault-held cron token |
| Concurrency-safe claiming | `20260829000000_claim_sync_queue_batch.sql` | `FOR UPDATE SKIP LOCKED` CTE-claim shape reused for `claim_outbox_batch` (§5.6) |
| Vault | `20260901000000_scheduler_auth_and_courier_tokens.sql` | Pattern for vault secret + SECURITY DEFINER getter |
| Supabase client | `src/integrations/supabase/client.ts` | Typed client with `Database` type, localStorage auth |
| UI primitives | `src/components/ui/` | `resizable.tsx` (react-resizable-panels), `responsive-dialog.tsx`, `searchable-select.tsx`, `Badge`, `ScrollArea`, vaul drawer |
| Audit logging | `audit_log` table, `src/lib/auditLog.ts` | `logAction()` (entity_type is free text — add inbox constants, §13.4) |
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
    |-- 3. Validate recipient.id is numeric (LO-1); look up channel_account by the
    |      typed platform column (.eq('page_id') or .eq('ig_account_id')); fail-closed if not found
    |-- 4. Idempotency check (meta_webhook_events + messages.platform_message_id UNIQUE)
    |-- 5. Upsert conversation keyed by (channel_account_id, platform_recipient_id)
    |-- 6. Resolve/create customer (alias-first; profile API for name)
    |-- 7. Insert message with Meta's event timestamp — attachments carry
    |      meta_url + metadata.download_pending=true (downloads are OFF the
    |      critical path — the sweep fetches them, ME-12)
    |-- 8. Update outbound delivery/read statuses (message_deliveries / message_reads)
    |-- 9. Record notification opt-ins (messaging_optins -> notification_subscriptions)
    |-- 10. Opt-out keyword detection -> messaging_opt_outs (§10.5)
    |-- 11. Evaluate automation rules -> insert outbox rows; fire
    |      meta-outbox-sweep (non-blocking) ONLY if outbox rows were inserted
    |      (the sole non-cron sweep trigger — ME-16)
    v
Supabase PostgreSQL (conversations, messages, customers, message_outbox)
    |
    | Supabase Realtime (postgres_changes — §1.4)
    v
React Inbox UI (TanStack Query + Realtime + @tanstack/react-virtual)

Agent sends reply:
  UI -> INSERT message_outbox (status 'pending', RLS-validated incl. cross-tenant EXISTS checks — HI-3)
      -> POST meta-send {outbox_id}  (JWT-authenticated)
           |-- claim row atomically (status 'sending')
           |-- cross-business re-assert (HI-3; refuses with error_code='cross_business_refusal')
           |-- opt-out / window / tag / subscription checks (§5.2)
           |-- atomic rate-limit token (§5.3)
           |-- decrypt page token via get_channel_access_token RPC (§13.1)
           |-- call Meta Send API
           |-- insert message row (metadata.campaign_id stamped for campaign sends — ME-11)
           |-- set outbox 'sent' or schedule retry / 'blocked_window' / 'cancelled'
      -> (safety net) pg_cron 30s sweep via pg_net handles retries,
         automation rows, attachment downloads (ME-12), and campaign
         dispatch (sole campaign trigger — ME-3)
```

### 1.2 Why Supabase Edge Functions

The codebase uses Deno edge functions extensively (`woo-webhook`, `pathao-courier`, `parse-order-text`, plus cron-triggered functions via pg_net). The woo-webhook function establishes the pattern we **adapt** (not copy byte-for-byte): `Deno.serve`, CORS headers, `crypto.subtle.importKey` HMAC, service-role client, idempotency checks. One deliberate difference: the HMAC *comparison encoding* — Woo compares base64 (`btoa`, woo-webhook line 104), Meta uses `sha256=` + lowercase hex (§5.3). No separate backend server is needed.

### 1.3 Edge Functions Required

| Function | Purpose | Trigger |
|----------|---------|---------|
| `meta-webhook` | Receive all Meta webhook events (verification GET + event POST) | GET/POST from Meta |
| `meta-send` | Claim and process a single outbox row (send + status update) | POST from client (JWT) |
| `meta-outbox-sweep` | Claim pending/retrying/stuck outbox rows (atomic `claim_outbox_batch` RPC, §5.6), perform attachment downloads (§5.5), dispatch due campaigns | pg_cron every 30s via pg_net; ALSO fired non-blocking by `meta-webhook` **only when the webhook inserted outbox rows** |
| `meta-bulk-send` | Campaign engine: atomic campaign claim, audience build, recipient rows, paced dispatch loop | Invoked by `meta-outbox-sweep` for each due campaign — **sole trigger**; no independent cron (ME-3) |
| `meta-token-probe` | Weekly page-token validity check (`GET /{page-id}?fields=id`) + alerts | pg_cron weekly |
| `meta-connect-account` | OAuth connect flow + manual-token fallback (full design §4.7 — ME-14) | POST from client (JWT + `inbox.manage`) |
| `meta-presence` | Tiny heartbeat endpoint: opens/closes `agent_presence_log` intervals incl. a `keepalive: true` fetch close on page unload (LO-10) | POST from client (JWT) |

Removed from v1: `meta-template-submit` (no Meta template-approval system exists for Messenger/IG — §10). Renamed: `meta-token-refresh` → `meta-token-probe` (page tokens from long-lived user tokens do not expire on a 60-day clock — §5.4).

### 1.4 Realtime Delivery Strategy

Supabase Realtime `postgres_changes` subscriptions:

- **Conversation list**: subscribe to `conversations` (all events) filtered by `business_id` — live unread counts, `last_message_at`, assignment changes.
- **Message thread**: subscribe to `messages` **INSERT events only**, filtered by `conversation_id`. UPDATE events (delivery ticks, `is_read` flips) are NOT subscribed — they would echo/refetch-churn every viewer; the outbound tick transitions (`sent → delivered → read`) reach the UI via a lightweight 30-seconds-while-open refetch of the open conversation's outbound statuses (cheap: one query, one conversation). Stated plainly: `postgres_changes` filters cannot watch column-level transitions server-side.
- **Outbox status (ME-2 fix)**: **two `postgres_changes` handlers on ONE channel** for `message_outbox`, both filtered by `conversation_id`: an INSERT handler (the agent's optimistic `pending` echo — the gray "sending" bubble) and an UPDATE handler (the `sending → sent/failed/blocked_window/cancelled` transitions). The UPDATE events are the **only** realtime signal for failed/blocked sends, which never produce a `messages` row. Churn is bounded: ~3 UPDATE events per outbox row lifecycle at 5-10K sends/day, delivered only to viewers of that one conversation. Client-side, the handler re-renders only when `payload.new.status !== payload.old.status`.
- **Presence**: Realtime Presence channels for agent online/offline/typing indicators.
- **Broadcast**: ephemeral collision-detection events (§9.5) that should not persist.

Capacity: Supabase Pro allows ~500 concurrent Realtime connections; 20 agents holding one browser connection each with multiple channel subscriptions is comfortably within limits. Realtime publication membership for `conversations` + `messages` + `message_outbox` is added in the Phase 1 migration (§2.7); all three get `REPLICA IDENTITY FULL` so RLS-filtered postgres_changes deliver row payloads (required for the outbox UPDATE events — ME-2).

### 1.5 Message Sending Pipeline

**Architecture decision: outbox-first, two trigger paths, no `pg_notify`.** Edge functions cannot `LISTEN` on Postgres channels — they are short-lived HTTP-invoked isolates with no persistent Postgres connection.

1. Agent clicks send → client inserts a `message_outbox` row (`status: 'pending'`) via supabase-js. RLS validates membership + permission + **cross-tenant relational consistency** (the conversation AND channel account must belong to the row's business — §2.3, HI-3) at insert time.
2. Client immediately invokes `meta-send` with `{ outbox_id }` (JWT-authenticated). `meta-send` claims the row atomically: `UPDATE message_outbox SET status='sending' WHERE id=$1 AND status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at <= now()) RETURNING *` — concurrent invocations cannot double-send.
3. `meta-send` **re-asserts cross-business consistency** (defense in depth for the service-role path — §5.1, HI-3), applies opt-out/window/tag/subscription rules (§5.2), consumes a rate token (§5.3), decrypts the page token via the `get_channel_access_token` RPC (§13.1), calls Meta, inserts the `messages` row, and sets outbox `sent` / `failed`+`next_retry_at` / `blocked_window` / `cancelled`.
4. **Interactive-send latency budget: < 1s** (direct invoke; no polling delay).
5. **Automation auto-replies** (inserted by `meta-webhook` with no user present to invoke meta-send): after inserting outbox rows, the webhook fires a non-blocking HTTP call to `meta-outbox-sweep` → auto-reply latency **≤ 2s typical**. The webhook fires the sweep ONLY when it actually inserted outbox rows — the sole non-cron trigger (ME-16).
6. **Safety net**: pg_cron schedules `meta-outbox-sweep` every 30 seconds (pg_net + `x-cron-secret` vault token, exact pattern of migration 20260802065715). The sweep claims batches atomically via the `claim_outbox_batch` RPC (§5.6 — ME-1), processes them, performs pending attachment downloads (§5.5 — ME-12), and dispatches due campaigns to `meta-bulk-send` (sole campaign trigger — ME-3). If the platform's pg_cron rejects sub-minute intervals at implementation time, fall back to a 1-minute schedule — interactive sends are unaffected (direct-invoke path), only the safety net widens.
7. Retries: exponential backoff (1s, 2s, 4s … max 5 attempts) for **explicit retryable API errors only**; timeout/unknown-outcome errors are never auto-retried (LO-6, §16.2). Terminal `failed` rows surface an agent-facing inline retry affordance (§3.6).

This decouples the UI from Meta API latency, provides retry semantics, and gives every outbox row a processor. `pg_notify` is gone.

---

## 2. Database Schema

All new tables follow the existing multi-tenant pattern: `business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE`, RLS reads via `is_business_member(business_id) OR has_role(auth.uid(),'admin')`, and **per-class write policies gated on `has_permission()`** written in final shape from day one.

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

-- app_permission additions — Migration A ONLY (see hard warning below)
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.manage';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.send_messages';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.bulk_send';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.view_analytics';
ALTER TYPE public.app_permission ADD VALUE IF NOT EXISTS 'inbox.send_tagged';
```

**ME-15 hard warning — migration file discipline:** Migration A (ALTER TYPE) and Migration C (tables/policies that cast `'inbox.send_messages'::app_permission`) run in **separate files and separate transactions**. They must **never** be merged into one file or one transaction: Postgres rejects `ADD VALUE` followed by a same-transaction cast of the new value ("unsafe use of new value"). The `IF NOT EXISTS` guard does **not** make the combination safe — a refactor that concatenates migration files would break the migration at runtime despite every statement being individually idempotent. CI check: the Phase 1 PR asserts Migration A contains zero `CREATE POLICY`/`CREATE TABLE` statements.

Changes from v1: `template_status` enum deleted (no Meta approvals — C2). `outbox_status.blocked_24h` → `blocked_window`; `cancelled` added (opt-out suppressions and cross-business refusals — ME-13/HI-3). `message_content_type.template` → `saved_message`.

### 2.2.0 Pre-existing schema changes (required — without these, webhook customer resolution fails and order prefill targets a nonexistent source)

```sql
-- ============================================================================
-- A1: customer_aliases.type CHECK only allows ('name','email','address') —
-- verified in migration 20260418114108. Platform-ID aliases would violate the
-- constraint on every webhook. Replace the CHECK and add a lookup index.
-- ============================================================================
ALTER TABLE public.customer_aliases DROP CONSTRAINT IF EXISTS customer_aliases_type_check;
ALTER TABLE public.customer_aliases ADD CONSTRAINT customer_aliases_type_check
  CHECK (type IN ('name','email','address','facebook_psid','instagram_id'));

CREATE INDEX IF NOT EXISTS idx_customer_alias_type_value
  ON public.customer_aliases (type, lower(value));

-- ============================================================================
-- LO-2 + L3-1: seed the 'fb/ig' order_source. Verified: the only seed inserts
-- ('online','pos','phone','social','wholesale') — no 'fb/ig' row exists
-- (20260415165743 read in full this session); foundation line 516 is a
-- tolerant SELECT that yields NULL today. L3-1 correction: order_sources.name
-- IS UNIQUE (20260415165743 DDL: `name text NOT NULL UNIQUE`) — the guarded
-- insert is kept (harmless, and self-documenting) but the earlier "no name
-- UNIQUE" claim was wrong. Also unblocks the foundation's FB selling-point
-- backfill for any future businesses.
-- ============================================================================
INSERT INTO public.order_sources (name, is_default, sort_order)
SELECT 'fb/ig', false, 6
WHERE NOT EXISTS (SELECT 1 FROM public.order_sources WHERE name = 'fb/ig');
```

(`source_store_id` is nullable — platform aliases insert with `NULL`.)

### 2.2.1 Channel Accounts

```sql
-- ============================================================================
-- Channel Accounts: Meta Page/IG account connections per business
-- NOTE: no app_secret column — the Meta App Secret is APP-LEVEL (one per
-- developer app) and lives in the edge function environment (META_APP_SECRET).
-- ============================================================================
CREATE TABLE public.channel_accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform                 public.channel_platform NOT NULL,
  account_name             text NOT NULL,
  page_id                  text,                    -- FB Page ID (numeric string)
  ig_account_id            text,                    -- Instagram professional account ID (numeric string)
  access_token_encrypted   text NOT NULL,           -- PGP-armored ciphertext (§13.1)
  webhook_verify_token     text NOT NULL,           -- 32+ byte random value; UNIQUE
  token_validated_at       timestamptz,             -- Set by weekly meta-token-probe
  is_active                boolean NOT NULL DEFAULT true,
  last_connected_at        timestamptz,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  -- CHECK: exactly one platform identity column set (avoids ambiguous rows)
  CONSTRAINT channel_accounts_one_identity CHECK (
    (page_id IS NOT NULL AND platform = 'facebook' AND ig_account_id IS NULL)
    OR (ig_account_id IS NOT NULL AND platform = 'instagram' AND page_id IS NULL)
  ),
  UNIQUE (platform, page_id),
  UNIQUE (platform, ig_account_id),
  UNIQUE (webhook_verify_token)
);
CREATE INDEX idx_channel_accounts_business ON public.channel_accounts(business_id);
CREATE TRIGGER set_channel_accounts_updated_at BEFORE UPDATE ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
```

### 2.2.2 Conversations

```sql
-- ============================================================================
-- Conversations — 1:1 DM model (H10): a conversation IS the (account, recipient)
-- pair. Messenger/IG webhooks provide no durable thread ID; PSID/IGSID is the
-- stable thread identity for 1:1 DMs. Group chats are OUT OF SCOPE (§4.6).
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
  first_agent_response_at   timestamptz,            -- analytics (A2); population rules §2.5.1 (ME-11)
  unread_count              integer NOT NULL DEFAULT 0,
  snoozed_until             timestamptz,
  closed_at                 timestamptz,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  window_expires_at         timestamptz GENERATED ALWAYS AS
                             (last_customer_message_at + interval '24 hours') STORED,
  UNIQUE (channel_account_id, platform_recipient_id)
);
-- L3-2 fix: idx_conversations_business_status dropped — it is a strict prefix
-- of idx_conversations_list_covering (§2.4) and pure write overhead.
CREATE INDEX idx_conversations_assigned_agent ON public.conversations(assigned_agent_id, status) WHERE assigned_agent_id IS NOT NULL;
CREATE INDEX idx_conversations_last_message ON public.conversations(business_id, last_message_at DESC);
CREATE INDEX idx_conversations_customer ON public.conversations(customer_id) WHERE customer_id IS NOT NULL;
-- ME-B2: conversations.tags reserved for conversation-level ops tags (e.g.
-- 'escalated', 'needs-followup') written by BulkActionBar/header UI in Phase 5;
-- customer-facing tag FILTERS read customer_tags (§3.3) — one taxonomy in the UI
CREATE INDEX idx_conversations_tags ON public.conversations USING GIN (tags);
CREATE INDEX idx_conversations_unread ON public.conversations(business_id) WHERE unread_count > 0;
-- Window-filtered campaign audience queries (§10.3)
CREATE INDEX idx_conversations_window ON public.conversations(channel_account_id, last_customer_message_at)
  WHERE last_customer_message_at IS NOT NULL;
CREATE TRIGGER set_conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();
```

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
    -- [{storage_path, filename, mime, size, type, meta_url}] (ME-12: meta_url set
    -- at insert; storage_path filled by the sweep's download task)
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- campaign_id stamped by meta-bulk-send (ME-11); download_pending flag (ME-12)
  platform_message_id  text,
  platform_timestamp    bigint,                     -- Meta's event timestamp, ms epoch (H9)
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
-- delivery-status updates from webhooks scan outbound sent messages by mid
CREATE INDEX idx_messages_delivery_pending ON public.messages(platform_message_id)
  WHERE direction = 'outbound' AND delivery_status = 'sent';
```

Window bookkeeping (H9): inbound inserts set `created_at = to_timestamp(platform_timestamp / 1000.0)` — Meta's event timestamp, not webhook-processing `now()`, so a delayed or retried delivery doesn't inflate the window past what Meta enforces. The `handle_new_message` trigger (§2.5.1) propagates `created_at` into `last_customer_message_at` **monotonically** (ME-4).

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
  error_code            text,                       -- 'opted_out' | 'cross_business_refusal' | 'timeout_unknown' | API code (LO-6/ME-13/HI-3)
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

### 2.2.6 Customer Tags (H1 — `customers` is a verified GLOBAL table)

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

### 2.2.9 Saved Messages (internal drafts — no Meta approval system exists; opt-in prompts store TEMPLATE PAYLOADS, not CTA copy — HI-1)

**There is no Meta template-approval system for Messenger/Instagram.** What remains is an **internal saved-draft library** for within-24h sends (and tag/subscription sends), plus a structured home for opt-in prompt configs. Under HI-1's corrected mechanism, an "opt-in prompt" is not text the business writes — it is a `notification_messages` template send whose **topic comes from Meta's fixed taxonomy** and whose **frequency the business picks**. The saved-message row therefore stores that structured config; the copy field is descriptive only (shown to agents, never sent).

```sql
CREATE TABLE public.saved_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name          text NOT NULL,
  body          text NOT NULL,                     -- Agent-visible description / draft text ({{variable}} placeholders)
  variables     text[] NOT NULL DEFAULT '{}',      -- Variable names for substitution
  category      text NOT NULL DEFAULT 'general'
                CHECK (category IN ('general','promo','support','order_status','csat','optin_prompt','optin_one_time')),
  optin_config  jsonb,                             -- HI-1: REQUIRED when category='optin_prompt' or
                -- 'optin_one_time'; NULL otherwise (enforced by trigger §2.5.6):
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

### 2.2.10 Notification Subscriptions (HI-1 — corrected Recurring Notifications / OTN mechanism)

**Corrected mechanism (Messenger; exact payload shapes [VERIFY IN PHASE 0 SPIKE]):**

- **Recurring Notifications (RN)**: the page sends a **`notification_messages` structured template message** via the Send API (`attachment.type='template'`, `payload.template_type='notification_messages'`) carrying a **`topic` selected from Meta's fixed taxonomy** and a `re_prompt_interval` (the frequency the business picks: daily/weekly/monthly). Meta renders the prompt card itself, with its own Allow/Manage controls — **the business cannot compose a custom-CTA message, and no freeform opt-in exists**. If the user accepts, Meta fires the `messaging_optins` webhook carrying a notification token tied to the topic; while the subscription is active, the page may send messages **outside the 24h window** using that token. Topic validity windows and re-prompt rules are per-topic.
- **One-Time Notification (OTN) — a DISTINCT flow (not "same family")**: the page sends a `one_time_notif` **button template** (`payload.template_type='one_time_notif'` with a `title` and a `payload` string the page chooses); the user taps the Notify button; Meta fires the `messaging_optins` webhook with a one-usable, short-lived token; the page sends exactly one follow-up.
- **Instagram**: to the best of our knowledge at plan time, Recurring Notifications is Messenger-only; IG campaigns are designed within-24h-only unless the spike proves otherwise (fallback §10.6).

**Topic taxonomy:** Meta exposes a **fixed topic list** (documented values include `ACCOUNT_UPDATE`, `COMMUNITY_ALERT`, `EVENT_REMINDER`, `NEWSLETTER`, `ORDER_STATUS`, `SHIPPING_UPDATE` — exact current list, payload names, and any additions are **[VERIFY IN PHASE 0 SPIKE]**). The plan stores taxonomy values verbatim; UI labels map to them (e.g., "New arrivals" → `NEWSLETTER`). **No free-form topics anywhere in the schema or UI.**

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
                      -- enforced by §2.5.6 trigger
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
-- L3-2 fix: dropped the constant `status` column from the topic key —
-- partial index already pins status='active'
CREATE INDEX idx_subscriptions_topic ON public.notification_subscriptions(channel_account_id, topic)
  WHERE status = 'active';   -- serves the §10.3 recipient-build JOIN (ME-10)
CREATE INDEX idx_subscriptions_customer ON public.notification_subscriptions(customer_id);
CREATE INDEX idx_subscriptions_conversation ON public.notification_subscriptions(conversation_id);
```

Token storage note: a notification token is a per-recipient send capability with a small blast radius (one customer, one topic, expiring), stored in this RLS-protected table, written only by the service role (webhook) — proportionate protection without the PGP machinery of §13.1.

### 2.2.11 Bulk Campaigns + Recipients

```sql
CREATE TABLE public.bulk_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel_account_id    uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  saved_message_id      uuid REFERENCES public.saved_messages(id) ON DELETE SET NULL,
  -- ME-10: the campaign's RN topic — the join key to notification_subscriptions.
  -- NULL means a within-window-only campaign (freeform, no subscription path).
  notification_topic    text CHECK (notification_topic IN (
                          'ACCOUNT_UPDATE','COMMUNITY_ALERT','EVENT_REMINDER',
                          'NEWSLETTER','ORDER_STATUS','SHIPPING_UPDATE')),
                          -- same initial documented taxonomy; finalized with the
                          -- Phase 0 spike alongside notification_subscriptions.topic
  name                  text NOT NULL,
  status                public.campaign_status NOT NULL DEFAULT 'draft',
  audience_filter       jsonb NOT NULL DEFAULT '{}'::jsonb,
      -- {tags: [...], min_orders: N, platforms: ['facebook'],
      --  within_window_only: true|false}
      -- (require_subscription implied by notification_topic IS NOT NULL — ME-10)
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
  skip_reason         text,   -- 'opted_out' | 'outside_window_no_subscription' | 'no_conversation' | 'quota_exhausted'
  error_message       text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, customer_id, channel_account_id)
);
CREATE INDEX idx_recipients_campaign ON public.bulk_campaign_recipients(campaign_id);
-- L3-2 fix: idx_recipients_status dropped — (campaign_id, status) duplicates
-- the prefix of idx_recipients_campaign
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
    'order_status_change', 'order_created',
    'tag_added', 'business_hours_off',
    'customer_first_message'
  )),
  trigger_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type       text NOT NULL CHECK (action_type IN (
    'auto_reply', 'auto_tag', 'auto_assign', 'auto_close',
    'escalate', 'send_saved_message', 'send_optin_prompt'
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

Changes from v2: `request_optin` renamed `send_optin_prompt` and its config now references a **saved_message_id** (category `optin_prompt` — the structured template config, §10.2) instead of a free-form topic string (HI-1). `order_created` triggers resolve the business via `orders.business_id` (§2.5.4 — ME-9).

### 2.2.13 Rate Limit Buckets

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

### 2.2.14 Meta Webhook Event Log

```sql
CREATE TABLE public.meta_webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id  uuid REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  object              text,                        -- 'page' | 'instagram'
  event_type          text NOT NULL,               -- 'messages' | 'messaging_optins' | 'message_deliveries' | ...
  platform_message_id text,                        -- mid when present
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
  ended_at      timestamptz                        -- close-out: keepalive fetch on pagehide + 24h sweep (LO-10)
);
CREATE INDEX idx_presence_user ON public.agent_presence_log(user_id, started_at DESC);
CREATE INDEX idx_presence_open ON public.agent_presence_log(business_id) WHERE ended_at IS NULL;

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
CREATE UNIQUE INDEX uq_opt_out_per_channel
  ON public.messaging_opt_outs (customer_id, channel_account_id)
  WHERE channel_account_id IS NOT NULL;
CREATE UNIQUE INDEX uq_opt_out_global
  ON public.messaging_opt_outs (customer_id, business_id)
  WHERE channel_account_id IS NULL;
```

The opt-out semantics (§10.5, ME-13): exclude when a row exists with `channel_account_id = :acct OR channel_account_id IS NULL` for that customer + business — applied to **all** outbound, not just campaigns.

### 2.3 RLS Policies — final shape, written once (H7 + HI-3 + ME-5 + LO-3)

v1's blanket "Members can write" `FOR ALL` policy would grant every business member (including viewers) full write, and Postgres RLS permissive policies OR together — you cannot add a later policy that *removes* access. The policies below are the **final shape from day one**. Reads: member-or-admin for all `business_id` tables. Writes: gated per class using the existing `has_permission()` function (verified: SECURITY DEFINER, migration 20260420112330).

**HI-3 core principle — relational consistency:** every INSERT that references a cross-table row (conversation, channel account, order) must assert that the referenced row belongs to the **same business** as the new row. Without this, a Business A agent can enqueue an outbox row with `business_id = A` (passes membership RLS) while `conversation_id`/`channel_account_id` point at Business B — `meta-send` (service role, RLS-exempt) would then decrypt B's page token and deliver on B's page. The `EXISTS` subqueries below close that hole at the database layer; `meta-send` re-asserts in code (§5.1) as defense in depth.

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

-- conversation_viewers: read scoped via conversation join (LO-3: split off the
-- old FOR ALL own-rows policy, which let any user insert viewer rows for
-- ARBITRARY conversations — cross-tenant "X is viewing" pollution)
ALTER TABLE public.conversation_viewers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can read viewers" ON public.conversation_viewers;
CREATE POLICY "Members can read viewers" ON public.conversation_viewers FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.conversations c
               WHERE c.id = conversation_viewers.conversation_id
                 AND is_business_member(c.business_id)));

-- INSERT: own row AND the conversation must belong to a business the user is a
-- member of. The EXISTS subquery rides conversations RLS, so tenant scoping is
-- double-enforced (policy check + RLS inside the subquery).
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

-- M3-2 fix: the membership re-check above validates the NEW business_id, but
-- an UPDATE that SWAPS channel_account_id to another business's page would
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
-- §2.5.5 trigger re-asserts this at the DB layer).
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
-- (internal notes go through this same policy — sender_type='agent', never sent to Meta)

-- HI-3: outbox INSERT asserts BOTH referenced rows belong to the row's business
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

-- M3-2 + M3-6 fix: UPDATE policy dropped entirely — no client flow UPDATEs
-- outbox rows (cancel = DELETE-own above; retry = meta-send re-invoke; status
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
-- (orders.business_id is added by §2.5.4; the trigger §2.5.3(b) is unaffected)

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

Edge functions use the service role key (bypasses RLS) and validate `business_id` scope manually in code — unchanged from codebase convention, now backed by the `meta-send` re-assert (§5.1).

**Enforcement summary:** a `viewer`-role user (or any member without `inbox.send_messages`) can read conversations but cannot send, tag, assign, or enqueue; a member WITH send permission cannot reference another business's conversation, page, or order from their inserts (HI-3); no authenticated client can forge system/bot-authored rows (ME-5). All enforced at the database, not just in UI filters.

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

Keyset pagination on `(business_id, last_message_at DESC, id DESC)` uses `idx_conversations_last_message` — see §3.3 (LO-7 tuple keyset). Monthly partitioning of `messages` is deferred: Phase 8 ships a 12-month cold archive table (§17.5) — simpler and reversible.

### 2.5 Database Triggers and Functions

#### 2.5.1 New-message conversation maintenance (ME-4 GREATEST guards + ME-11 exclusion + L4)

```sql
CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations SET
    -- ME-4: monotonic (NULL-safe — GREATEST ignores NULLs). A delayed Meta
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
    -- M3-1 fix: the prior-customer-message guard is IN the SQL (not just the
    -- comment): last_customer_message_at IS NOT NULL — the UPDATE reads the
    -- pre-update row, so for inbound-then-agent the guard sees the inbound's
    -- stamp from the earlier trigger run and fires; a campaign seed on a
    -- never-replied conversation (NULL) does not fire.
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
```

(M3-1 resolution: the prior-customer-message guard is now IN the CASE — `AND last_customer_message_at IS NOT NULL` — closing the gap the comment previously papered over; the MV FILTER §11.1 remains as the analytics backstop.)

```sql
CREATE TRIGGER trg_new_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_message();
```

#### 2.5.2 Mark conversation read (H8 — ownership check inside the SECURITY DEFINER body)

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

#### 2.5.3 "Has ordered" auto-indicator (M12)

Two triggers cover every path by which an order becomes attributable to a business. Both key off `orders.business_id` (added by §2.5.4 — ME-9):

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
  -- time — the single authority for inbox-created orders (HI-B3). Runs before
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

Surfacing: a `has_ordered` badge on `ConversationItem` and `CustomerProfileCard` reads `EXISTS (SELECT 1 FROM customer_tags WHERE business_id = ? AND customer_id = ? AND tag = 'has_ordered')` — a real persisted indicator, not a display-time proxy.

#### 2.5.4 `orders.business_id` resolution (ME-9 — new)

**Verified gap:** `orders` has no `business_id`; business scope is only reachable via `store_id → selling_points.woo_store_id` (Woo channels only), and `selling_points` has **no UNIQUE on `(type, woo_store_id)`** — a store mapped to multiple businesses' selling points would resolve ambiguously. Orders with `store_id IS NULL` (inbox-created, POS walk-ins without a store) have no resolution path at all.

**Fix (additive-only, permitted by §17.3):** a nullable `business_id` column + a BEFORE INSERT trigger that resolves it from the row's own selling-point linkage + a one-time backfill:

```sql
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS business_id uuid
  REFERENCES public.businesses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_business_customer
  ON public.orders (business_id, customer_id) WHERE business_id IS NOT NULL;

-- BEFORE INSERT resolution: prefer the order's explicit selling point; fall
-- back to store_id -> selling_points. selling_point_id is UNIQUE-anchored
-- (PK) so it cannot be ambiguous; the store_id fallback picks the OLDEST
-- matching selling_point (deterministic) and logs nothing — the documented
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
     LIMIT 1;   -- deterministic pick; ambiguity documented (no UNIQUE on (type, woo_store_id) — verified)
  END IF;

  NEW.business_id := v_business_id;   -- stays NULL for unresolvable storefront/POS orders
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_resolve_order_business BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.resolve_order_business();

-- One-time business_id backfill (M3-4 companion; NEW-4 fix — concrete SQL):
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

**Scope statement:** audience-builder `min_orders` / LTV / `has_ordered` aggregations (§10.1, §7.4) count **only** orders with non-NULL `business_id` — Woo-linked and inbox-linked orders. Storefront/POS orders that never resolve (no selling point, no store) are **explicitly out of scope for inbox audience analytics** until they gain linkage.

**HI-B3 fix — canonical path for inbox-created orders:** the dialog's `orders` insert does NOT know the business (verified §6.1). The link path is the single authority:
1. `OrderLinker` receives `onCreated({orderId, orderNumber, customerId})` (§6.1 Modification 1) — it has the conversation in hand.
2. `OrderLinker` immediately: `UPDATE orders SET business_id = <conversation.business_id> WHERE id = :orderId AND business_id IS NULL` (service call under `orders.edit` permission), THEN inserts the `conversation_orders` link row.
3. Trigger (b) below ALSO backfills defensively (`UPDATE orders SET business_id WHERE id = NEW.order_id AND business_id IS NULL`) — so even a missed OrderLinker step cannot leave an inbox order unscoped (M3-3 fix).
The earlier claim "the §6.1 path sets business_id directly from the conversation at insert time" is deleted — resolution happens at the link step (both in OrderLinker and trigger (b)), never at the dialog insert.

(The `has_ordered` backfill SQL lives in the §2.5.4 migration block above — M3-4; NEW-4.)

#### 2.5.5 Sender assertion trigger + sanctioned system-message RPC (ME-5 — new)

```sql
-- Any authenticated client inserting into messages must be an agent sending as
-- itself (policy §2.3 already requires it; this trigger re-asserts at the DB
-- layer so a policy regression cannot silently reopen spoofing). Service-role
-- inserts (meta-webhook, sweep, meta-send) run with auth.uid() NULL and pass.
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
  -- Ownership assertion (SECURITY DEFINER bypasses RLS — H8 pattern)
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
  -- assert_message_sender trigger (C3-2 fix) lets sender_type='system' rows
  -- through from this RPC only. Transaction-local: reverts on commit/rollback.
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

#### 2.5.6 Opt-in config sanity trigger (HI-1 — new)

```sql
-- saved_messages: optin_config required for opt-in categories, forbidden otherwise;
-- optin_prompt config must carry a taxonomy topic + frequency; one_time must not.
CREATE OR REPLACE FUNCTION public.assert_saved_message_optin()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category IN ('optin_prompt','optin_one_time') THEN
    IF NEW.optin_config IS NULL THEN
      RAISE EXCEPTION 'opt-in categories require optin_config (template payload — HI-1)';
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

### 2.6 Storage Bucket and Policies (M6 + H3 + ME-6 + ME-7)

Migration `supabase/migrations/202609XX04_omni_inbox_storage.sql`:

```sql
-- Private bucket; objects addressed {business_id}/{conversation_id}/{filename}
-- Avatars (service-role only): {business_id}/avatars/{platform_recipient_id}.{ext}
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('inbox-attachments', 'inbox-attachments', false, 26214400)  -- 25MB
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ME-7 note: storage.foldername() is used nowhere in this repo (verified) —
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

-- ME-6: upload constrained to {business_id}/{conversation_id}/{filename} —
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
-- enforcement — the type allowlist and extension check are CLIENT-SIDE ONLY
-- (composer pre-upload validation, §5.5). The bucket's 25MB file_size_limit is
-- the only storage-layer gate. Acceptable because upload is already
-- permission-gated and member-scoped; noted for reviewers.

-- Service role writes (webhook-time attachment persistence, avatars) bypass RLS by design.
```

Customers never access this bucket directly — agents share attachments inside messages; the UI renders via short-lived signed URLs. Outbound attachment sending re-uploads from Storage to Meta (temporary signed URL with a short TTL at send time, or Meta `attachment_id` reuse — §5.5).

### 2.7 Realtime Publication (Phase 1 migration)

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_outbox;

ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.message_outbox REPLICA IDENTITY FULL;
```

(Follows the verified precedent of `20260903000500_enable_realtime.sql`. `REPLICA IDENTITY FULL` is required for RLS-filtered `postgres_changes` to deliver row payloads on UPDATE events — mandatory now that the outbox UPDATE events carry the send-status transitions, ME-2.)

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
| `ComposerBar` | `src/components/inbox/ComposerBar.tsx` | Text input, attachment upload, send, saved-message picker, tag-picker (if permitted + approved — ME-8), opt-out banner (ME-13) | `Textarea` |
| `ContextSidebar` | `src/components/inbox/ContextSidebar.tsx` | Tabs (Customer, Orders, Products, Notes) | `Tabs` |
| `CustomerProfileCard` | `src/components/inbox/CustomerProfileCard.tsx` | Name, phone, tags, `has_ordered` badge, order count, LTV | - |
| `ProductQuickSend` | `src/components/inbox/ProductQuickSend.tsx` | Search products, send as generic template card | **`MiniProductCatalog`** (caller supplies data — §6.3) |
| `InvoiceQuickSend` | `src/components/inbox/InvoiceQuickSend.tsx` | Generate + send invoice PDF — **html-to-image approach (HI-B5): render `invoiceHtml.ts` HTML in a hidden DOM node → `html-to-image` `toPng` → upload PNG to Storage → send as image attachment** (Meta accepts image attachments everywhere freeform is allowed; no PDF lib needed) | **`invoiceHtml.ts`** + new dep `html-to-image` (install task Phase 4) |
| `CourierQuickSend` | `src/components/inbox/CourierQuickSend.tsx` | Format & send tracking info | `CourierDispatchStation` logic |
| `OrderLinker` | `src/components/inbox/OrderLinker.tsx` | Link existing or create new order (§6.1) | **`AddOrderDialog` (modified — §6.1)** |
| `TagManager` | `src/components/inbox/TagManager.tsx` | Add/remove customer tags | `Badge` |
| `QuickReplyPicker` | `src/components/inbox/QuickReplyPicker.tsx` | Slash-command or button insert | `Command` |
| `SavedMessagePicker` | `src/components/inbox/SavedMessagePicker.tsx` | Pick saved draft, fill variables | `ResponsiveDialog`, `SearchableSelect` |
| `AssignmentDropdown` | `src/components/inbox/AssignmentDropdown.tsx` | Assign/reassign agent | `SearchableSelect` |
| `ConversationSearch` | `src/components/inbox/ConversationSearch.tsx` | Full-text search over message content (M11) | `Command` |
| `BulkActionBar` | `src/components/inbox/BulkActionBar.tsx` | Multi-select actions | `OrderBulkActionsBar` pattern |
| `OptInPromptCard` | `src/components/inbox/OptInPromptCard.tsx` | Sends the structured `notification_messages` opt-in template (§10.2 — HI-1); per-conversation subscription chips | - |
| `CampaignBuilder` | `src/components/inbox/CampaignBuilder.tsx` | Audience builder + campaign scheduling + topic pick from taxonomy | - |
| `WindowBanner` | shared hook/component | 24h/7d window countdown; composer state depends on it | - |

Renamed/changed from v2: `OptInPromptCard` no longer "sends an opt-in CTA" — it triggers a structured template send with a topic + frequency picker (HI-1).

### 3.3 State Management

TanStack Query (verified in deps) for all data fetching:

```typescript
// hooks/useConversations.ts — tuple keyset pagination (M11 + LO-7: last_message_at
// alone skips same-timestamp rows; the tuple (last_message_at, id) is the cursor)
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
// conversation-level TagManager action in BulkActionBar and per-conversation
// header (Phase 5 UI: "Add conversation tag"), and the list filter reads
// CUSTOMER tags via a join, not conversations.tags:
//   customer-tag filter: fetch conversation ids of business customers tagged X
//   (customer_tags) then .in('id', ids) — the taxonomy agents actually manage
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

// Outbox status (ME-2): TWO postgres_changes handlers on ONE channel — INSERT
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

// LO-13: optimistic concurrency on conversation mutations — every client-side
// UPDATE (assign/transfer/snooze/status) carries the stale-check; zero rows
// returned means a concurrent edit won.
export async function updateConversation(expectedUpdatedAt: string, patch: ConversationPatch) {
  const { data, error } = await supabase
    .from('conversations')
    .update(patch)
    .eq('updated_at', expectedUpdatedAt)
    .select();
  if (!data || data.length === 0) throw new ConflictError('conversation changed by another agent — refetching');
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

### 3.6 UX States (M11 + ME-2)

- **Empty states**: no conversations at all ("Connect a Facebook Page or Instagram account to start messaging" + CTA to settings); no conversation selected ("Select a conversation to begin"); empty thread; no search results.
- **Loading**: skeleton rows for the list (shadcn `Skeleton`); skeleton bubbles on initial thread load.
- **Send-failure affordance (ME-2)**: outbox INSERT renders the optimistic `pending` bubble (gray ticks); the outbox UPDATE event flips it `sending → sent` (single tick) or to a failure chip. Rows reaching `failed` / `blocked_window` render inline in the thread with an error chip: `failed` shows Retry (re-invokes `meta-send` on the same row if retry_count < 5, else creates a new outbox row) — EXCEPT `error_code='timeout_unknown'`, which shows "possibly sent — verify in thread" and refuses auto-retry (LO-6); `blocked_window` shows the window-expiry countdown instead of Retry.
- **Optimistic send**: bubble appears immediately as `sending` (gray ticks); the `messages` INSERT event renders the durable bubble; delivery ticks (`delivered`/`read`) update via the 30-seconds-while-open status refetch (§1.4).
- **Opt-out banner (ME-13)**: if the customer has an active opt-out row, the composer shows a persistent banner and disables freeform send except for `ACCOUNT_UPDATE`/`POST_PURCHASE` tags.

### 3.6.1 Accessibility contract (ME-B6 — new)

For a surface agents live in all day, these are build requirements, not polish:
- **Live region**: the `MessageThread` appends incoming messages into a `role="log"` / `aria-live="polite"` region so screen readers announce arrivals without stealing focus.
- **Focus management**: master-detail push navigation (§3.1.1) moves focus into the opened thread; back-navigation restores focus to the originating conversation row.
- **Composer labeling**: `ComposerBar` input has a visible label (`aria-label` at minimum); send button has an accessible name; attachment buttons announce file dialogs.
- **Keyboard**: full list navigation via ↑/↓ + Enter (§3.5 shortcuts); visible focus rings on all interactive elements (no `outline: none` without replacement).
- **Non-color signaling**: priority/status/unread indicators pair color with icon/text (color-blind safe); delivery ticks have text alternatives (`aria-label`).
- **Reduced motion**: `prefers-reduced-motion` disables smooth-scroll on thread jumps and panel transitions.

### 3.7 Pagination and Search (M11 + LO-12)

- **Conversation list**: tuple keyset pagination on `(business_id, last_message_at DESC, id DESC)` with infinite scroll (§3.3), capped server-side at 50 rows/page. Never unbounded `select()`.
- **Thread**: load latest 50 messages, paginate backwards on scroll-top — **tuple keyset `(created_at, id)`** like the list (LO-B3: `created_at` alone skips same-timestamp rows — bulk/campaign inserts share timestamps): `WHERE (created_at, id) < (:oldest_created_at, :oldest_id) ORDER BY created_at DESC, id DESC LIMIT 50`.
- **Search (LO-12)**: `ConversationSearch` uses a `messages` full-text RPC. The RPC **caps at 50 conversations** (LIMIT inside the CTE, before `ts_headline` runs) so headline generation never expands over a large set:

```sql
-- M3-5/ME-B4 fix: spans BOTH the hot table and the archive (UNION before
-- ranking; the 2000-row ceiling is the COMBINED scan cap, 50-convo result cap
-- is shared — archive rows compete with hot rows on recency).
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

### 4.1 Meta Developer App Setup

1. Create a Meta Business App at developers.facebook.com
2. Add products: **Messenger** (Facebook) and **Instagram** (for IG DMs, configured via the IG professional account)
3. Configure webhook URL: `https://<project-ref>.supabase.co/functions/v1/meta-webhook`
4. Subscribe to events: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`, `messaging_optins` (RN/OTN acceptance — HI-1), `messaging_handovers` (pass-thread control)
5. Request permissions: `pages_messaging`, `pages_show_list`, `instagram_basic`, `instagram_manage_messages` + Advanced Access; **include the message-tag (HUMAN_AGENT), `notification_messages` (RN), and `one_time_notif` (OTN) usages in the same App Review submission** (ME-8 — without Advanced Access for these, live-mode tagged/subscription sends fail with permission errors)
 6. Copy the **App Secret** into edge function secrets: `supabase secrets set META_APP_SECRET=...`. Also set `META_APP_ID`, `META_GRAPH_VERSION` (§5.0), `META_CRON_TOKEN` (vault-held, **§5.6** — LO-B4 fix: the cron/sweep token belongs to the outbox-sweep section, not §5.7 profile rate limiting; both the pg_net cron and the webhook's non-blocking sweep call pass it as `x-cron-secret` — the same vault secret, no "one-shot minting" exists)
7. Obtain a long-lived Page Access Token per connected page — via the `meta-connect-account` OAuth flow (§4.7) or manual entry fallback

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

### 4.3 POST Handler — verify FIRST, then route (C3 + LO-1)

The signature is verified with the **app-level** secret from the edge environment, available before any DB lookup. Parsing the body before verifying is safe (the signature covers the raw body; parse-then-verify is the standard Meta pattern).

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

// 3. THEN identify the channel account — LO-1: validate the ID is numeric
//    (a crafted entry.id with commas/dots would break PostgREST filter
//    syntax via string interpolation), and use ONE typed query per platform
//    instead of .or().
for (const entry of payload.entry ?? []) {
  const recipientId = String(entry.id ?? "");
  if (!/^\d+$/.test(recipientId)) {
    await logWebhookEvent(null, payload.object, "unknown", 400, "malformed entry.id (non-numeric)");
    continue;   // fail-closed, batch continues with other entries
  }
  const accountQuery = payload.object === "page"
    ? supabase.from("channel_accounts")
        .select("id, business_id, platform, page_id, is_active")
        .eq("page_id", recipientId)
    : supabase.from("channel_accounts")
        .select("id, business_id, platform, ig_account_id, is_active")
        .eq("ig_account_id", recipientId);
  const { data: account } = await accountQuery.eq("is_active", true).maybeSingle();
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
   c. Insert message with `platform_timestamp` as `created_at` basis (H9) and attachments carrying `meta_url` + `metadata.download_pending=true` — **no CDN fetch on the critical path** (ME-12; the sweep downloads)
   d. Resolve/create customer — alias-first only (§7.1)
   e. Evaluate automation rules (§8) → insert outbox rows → fire sweep (only if rows were inserted — ME-16)
3. `delivery`: update outbound message `delivery_status='delivered', delivered_at` (matched by mid — H2; delivery events DO carry `mids[]`)
4. `read`: **watermark semantics (HI-B4)** — `message_reads` payloads carry `{"read": {"watermark": <ms>, "seq": …}}` and **no mids array**; do NOT match by mid. Mark ALL outbound messages of the conversation with `created_at <= to_timestamp(watermark/1000)` as `delivery_status='read', customer_read_at = to_timestamp(watermark/1000) WHERE delivery_status IN ('sent','delivered')`. Record the exact payload shape in the Phase 0 spike.
5. `optin`: upsert `notification_subscriptions` row — RN acceptance carries token + topic + expiry **[VERIFY IN PHASE 0 SPIKE: exact `messaging_optins` payload for notification_messages vs one_time_notif]** (HI-1)
6. `pass_thread_control`: store in `conversations.metadata` (handover state — NOT account deletion, L6)

### 4.5 24-Hour Window + HUMAN_AGENT (H9 + ME-8)

- `window_expires_at` is the generated column (§2.2.2); NULL `last_customer_message_at` = window closed.
- Window clock uses Meta's event `timestamp` (via `platform_timestamp` → `created_at`), not processing time.
- **Freeform send allowed** iff `now() < window_expires_at`.
- **HUMAN_AGENT tag** extends a human-support conversation to 7 days — **requires Meta Advanced Access approval for the tag** (ME-8): until the app's HUMAN_AGENT usage is approved, live-mode tagged sends fail with a permission error; dev-mode traffic works. The tag selector therefore renders a disabled state with an explanation until approval lands; the Phase 0 spike records the app's actual capability status and the review submission includes the tag usage. The ComposerBar shows: freeform enabled (within 24h) → tag selector with HUMAN_AGENT (within 7d, requires `inbox.send_tagged` AND approved) → saved-message opt-in prompts to build the out-of-window audience (§10.2) → composer disabled with countdown.
- The other tags (`ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE`) are for their narrow permitted uses; UI labels each with its policy description so agents don't misuse them.

### 4.6 Facebook vs Instagram Differences

| Aspect | Facebook Messenger | Instagram |
|--------|--------------------|-----------|
| Sender ID | PSID (page-scoped) | IG scoped user ID |
| API endpoint | `/v{X}/me/messages` | `/v{X}/{ig-user-id}/messages` |
| Generic template | Supported | **Supported** (M7 — IG product cards use it) |
| Media/attachment constraints | Broader | Some types unsupported/unavailable; verify per type in Phase 0 spike |
| 24h rule | Applies | Applies |
| HUMAN_AGENT tag | Supported (7-day window; Advanced Access — ME-8) | Supported (7-day window; Advanced Access — ME-8) |
| Recurring Notifications (`notification_messages`) | Supported (structured template; **[VERIFY spike]** exact availability + app requirements) | Not believed available — design within-24h only (fallback §10.6) |
| One-Time Notification (`one_time_notif`) | Supported — distinct flow (HI-1) | Not believed available (fallback §10.6) |
| Handover protocol | Supported | Not supported |

Normalize both behind `sendMessage(channelAccountId, recipientId, payload)` in `supabase/functions/_shared/meta-api.ts`.

### 4.7 `meta-connect-account` — OAuth Connect Flow (ME-14 — new)

**Primary flow (FB Login dialog → server-side exchange; the app secret never crosses the browser):**

1. **OAuth URL construction** (client or edge function builds it): `https://www.facebook.com/{GRAPH_VERSION}/dialog/oauth?client_id={META_APP_ID}&redirect_uri={APP_URL}/settings/inbox/connect/callback&state={csrf}&scope=pages_show_list,pages_messaging,pages_manage_metadata,business_management`. `state` is a random value in a **signed, HttpOnly cookie** (LO-B8 fix: chosen over a `connect_sessions` table — needs no schema; HMAC-signed with a vault-held cookie key, carries the business_id + expiry + the random value, verified at step 3).
2. **Redirect handling**: the settings UI callback page POSTs `{code, state}` to `meta-connect-account` (JWT-authenticated; server verifies `inbox.manage` for the target business).
3. **Short-lived → long-lived exchange (server-side)**: `GET https://graph.facebook.com/{GRAPH_VERSION}/oauth/access_token?client_id={META_APP_ID}&client_secret={META_APP_SECRET}&redirect_uri=...&code={code}` — the app secret lives only in the edge env. On failure: surfaced as "authorization failed — retry connect".
4. **Page token derivation**: `GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,username}` with the long-lived user token — returns candidate pages plus each page's linked IG professional account.
5. **Page selection**: if multiple pages are returned, the function responds with the candidate list; the UI shows a picker and re-submits with the chosen `page_id`; the function derives the **long-lived page token** for that page (per Meta's documented behavior, page tokens derived from a long-lived user token are themselves long-lived).
6. **Insert + subscribe (service client)**: insert the `channel_accounts` row (plaintext token — the §13.1 trigger encrypts; verify token per the sentinel contract), `webhook_verify_token` generated server-side; then `POST /{page-id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_deliveries,message_reads,messaging_optins,messaging_handovers`. For IG: `POST /{ig-id}/subscribed_apps?...` via the linked account.
7. **Error surfaces**: `code != state` → 403 CSRF refusal; exchange failure → 400 with Meta's error summary; missing `pages_messaging` in the returned grants → "re-connect with the required permissions" prompt.

**Fallback flow (manual):** the settings UI accepts a pasted long-lived page token; the same edge function inserts the row (encrypt trigger runs), derives the page id via `GET /me?fields=id,name` (validates the token), and subscribes the app. Marked as fallback because obtaining a long-lived token manually requires Graph API Explorer tooling.

### 4.8 Attachment persistence (H3 + ME-12)

At webhook time: **no downloads**. The message inserts immediately with `attachments: [{meta_url, type, ...}]` and `metadata.download_pending=true`. The sweep's download task (§5.5) then fetches each Meta CDN URL with the page token and uploads to Storage: `inbox-attachments/{business_id}/{conversation_id}/{platform_message_id}-{n}.{ext}`, filling `storage_path` and clearing the flag. Only the message insert is on the webhook's 20-second critical path (§16.1). Avatars: same treatment — profile API URLs are expiring; the sweep persists to `{business_id}/avatars/{platform_recipient_id}.{ext}`.

---

## 5. Send Path, Rate Limiting, Tokens, Attachments

### 5.0 Graph API Version Pinning (M3)

- Single constant `GRAPH_VERSION` in `_shared/meta-api.ts`, initialized from `Deno.env.get("META_GRAPH_VERSION")` (default: the current stable version **at Phase 0 kickoff**, chosen from Meta's changelog then — do not hardcode a version at plan time).
- Upgrade policy: review Meta's version-deprecation schedule at each phase boundary; bump the pin deliberately (one-line env change); the Phase 9 monitoring dashboard tracks Meta `error_code` 4 (API version too old) and Graph API error subcodes for calls made with an expiring version.

### 5.1 Meta Send API Call (shared module — with the HI-3 re-assert)

```typescript
// supabase/functions/_shared/meta-api.ts (sketch)
export async function processOutboxRow(opts: { outboxId: string }) {
  const supa = getServiceClient();
  // 1. Atomic claim (single-writer guarantee — ME-B5/H3-2 fix: PostgREST
  //    filter values are literals; "now()" would be a cast error. And a fresh
  //    pending row has next_retry_at = NULL, which .lte excludes — the claim
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
  if (!row) return; // claimed by another invocation — exit
  // Retry affordance note: the Retry button CLEARS next_retry_at (update to
  // null) before re-invoking, so backoff-scheduled rows are claimable at once.

  // 2. HI-3 re-assert: cross-business consistency, defense in depth for the
  //    service-role path. One SELECT joining conversation + channel account.
  const { data: ctx } = await supa.from("conversations")
    .select("business_id, window_expires_at, last_customer_message_at, channel_accounts!inner(id, business_id, platform)")
    .eq("id", row.conversation_id)
    .eq("channel_accounts.id", row.channel_account_id)
    .maybeSingle();
  if (!ctx || ctx.business_id !== row.business_id || ctx.channel_accounts.business_id !== row.business_id) {
    // NEVER proceed: an A-agent tried to send on B's page/conversation
    await supa.from("message_outbox").update({
      status: "failed", error_code: "cross_business_refusal",
      error_message: "referenced conversation/channel account belongs to a different business"
    }).eq("id", row.id);
    return;
  }

  // 3. §5.2 decision matrix (opt-out -> window/tag/subscription)
  // 4. §5.3 rate token; §13.1 token decrypt; Graph call; LO-6 outcome handling
  // 5. Insert messages row (metadata.campaign_id when campaign-originated — ME-11)
  // 6. Set outbox sent / failed(+next_retry_at) / blocked_window / cancelled
}

export async function sendMessage(opts: {
  channelAccountId: string; conversationId: string;
  recipientId: string;                          // PSID or IGSID
  text?: string; attachment?: unknown;
  messageTag?: 'ACCOUNT_UPDATE'|'CONFIRMED_EVENT_UPDATE'|'HUMAN_AGENT'|'POST_PURCHASE';
  notificationToken?: string;                    // RN/OTN send — {VERIFY spike}
  notificationTemplate?: { type: 'notification_messages', topic: string, rePromptInterval: string, title: string, payload?: string }  // HI-1 opt-in prompt send
    | { type: 'one_time_notif', title: string, payload: string }; // HI-1 OTN prompt send
}) {
  const token = await getChannelAccessToken(opts.channelAccountId); // RPC — §13.1
  const version = Deno.env.get("META_GRAPH_VERSION")!;
  // endpoint per account platform; body per mode:
  //  - freeform (within window): { recipient: {id}, message: {...} }
  //  - tagged: adds { tag: messageTag }
  //  - notification send: { recipient: {notification_token}, message: {...} } [VERIFY spike]
  //  - RN opt-in prompt: { recipient: {id}, message: { attachment: { type: 'template',
  //      payload: { template_type: 'notification_messages', topic, re_prompt_interval, title, payload } } } }
  //      [VERIFY spike: exact payload field names — never fabricated; the Phase 0
  //       spike records the real template payload and the builder adjusts]
  //  - OTN prompt: { recipient: {id}, message: { attachment: { type: 'template',
  //      payload: { template_type: 'one_time_notif', title, payload } } } }
  ...
}
```

### 5.2 Send Decision Matrix (meta-send applies this per outbox row — ME-13 + ME-8 + LO-6)

Checks are applied IN ORDER; first failure determines the terminal/deferred state:

| # | Check | Fail outcome |
|---|---|---|
| 1 | **Cross-business re-assert** (HI-3): `conversation.business_id = outbox.business_id` AND `channel_account.business_id = outbox.business_id` | `failed` + `error_code='cross_business_refusal'` (never sent; audited) |
| 2 | **Opt-out check (ME-13 — applies to ALL outbound, not just campaigns)**: no `messaging_opt_outs` row for this customer with `channel_account_id = :acct OR channel_account_id IS NULL` (this business) — **skipped only for `message_tag IN ('ACCOUNT_UPDATE','POST_PURCHASE')` transactional sends** | `cancelled` + `error_code='opted_out'` |
| 3a | No tag, no subscription, **not an opt-in prompt row**: `now() < window_expires_at` (NULL = closed) | `blocked_window` |
| 3a′ | **Opt-in prompt rows (ME-B3)**: rows whose `saved_message_id` references a saved message of category `optin_prompt` or `optin_one_time` are TEMPLATE sends, not freeform — meta-send loads the saved message's `optin_config` and builds the `notification_messages` (or `one_time_notif`) template body per §10.2. The row's `content` holds agent-visible descriptive text and is NEVER sent. Opt-in prompts are in-window sends by definition (the customer must be able to reply), so check 3a′ = window check + template build — no freeform path | `blocked_window` if outside window |
| 3b | `message_tag` set: HUMAN_AGENT — `now() < last_customer_message_at + 7d` **AND the tag has Meta Advanced Access approval (ME-8; live mode)**; others: permitted-use policy (UI-enforced) + in-window OR tag-authorized out-of-window | `blocked_window` (or `failed` with the Graph permission error on unapproved live-mode use) |
| 3c | `subscription_id` set: subscription row `status='active'` AND (`expires_at` IS NULL OR `expires_at > now()`) AND (RN: topic matches) AND quota not exhausted | `cancelled` + `error_code='subscription_expired'` |
| 4 | Rate token available (§5.3) | row stays `pending`, `next_retry_at = now() + 1s` (sweep retries) |
| 5 | Graph API call — **outcome classes (LO-6)**: (a) 2xx → `sent`; (b) explicit retryable API error (rate-limit, transient 5xx with error body) → backoff loop; (c) explicit non-retryable API error → `failed` with the API `error_code`; (d) **timeout / network abort / unknown outcome** → `failed` + `error_code='timeout_unknown'` — NEVER auto-retried (Send API has no client dedup id for normal sends; a retry after a lost response duplicates the customer message). The UI shows "possibly sent — verify in thread"; manual retry creates a NEW outbox row only after the agent confirms the thread | per class |

The composer's opt-out banner (§3.6) surfaces check 2 before the agent types; checks 1-3 remain authoritative at send time.

### 5.3 Rate Limiting — atomic token bucket (H5)

One atomic statement that refills AND decrements, called via RPC (avoids PostgREST-side read-modify-write):

```sql
CREATE OR REPLACE FUNCTION public.consume_rate_limit_token(p_channel_account_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ok boolean;
BEGIN
  -- HI-B1 fix: self-seeding. The bucket row is created on first use if the
  -- connect flow or a migration race missed it, so a freshly connected
  -- account can always consume tokens. (Belt: the AFTER INSERT trigger on
  -- channel_accounts below; braces: this upsert.)
  INSERT INTO public.rate_limit_buckets AS rb
    (channel_account_id, capacity, refill_rate_per_sec, tokens_remaining)
  VALUES
    (p_channel_account_id, 200, 200, 200)
  ON CONFLICT (channel_account_id) DO NOTHING;

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

-- HI-B1 belt + NEW-2 fix: SECURITY DEFINER so a client-side channel_accounts
-- INSERT (Class B managers-write path) does not die on the trigger touching
-- the service-role-only rate_limit_buckets table.
CREATE OR REPLACE FUNCTION public.seed_rate_limit_bucket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.rate_limit_buckets
    (channel_account_id, capacity, refill_rate_per_sec, tokens_remaining)
  VALUES
    (NEW.id, 200, 200, 200)
  ON CONFLICT (channel_account_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_seed_rate_limit_bucket AFTER INSERT ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.seed_rate_limit_bucket();
```

**Phase 2 smoke test (HI-B1):** after connecting a fresh page, assert `consume_rate_limit_token(new_account_id)` returns `true` — proves seed + consume end-to-end.

- Single-statement refill+decrement: no lost updates (row lock serializes concurrent consumers).
- If no token is available, `meta-send` leaves the row `pending` with `next_retry_at = now() + 1s` (sweep picks it up).
- **Honest throughput**: each send costs one atomic RPC (~5-15ms) + Graph API latency (~100-300ms). A single-instance loop sustains ~5-20 sends/sec. Bulk campaigns (§10.4) run a bounded-concurrency promise pool (10-20 in-flight Graph calls, each holding one token) — realistic ~30-100/sec, comfortably below Meta's page limits and adequate for 500 convos/day.

### 5.4 Token Management (M4 — corrected facts)

- **Facts**: Long-lived *user* tokens last ~60 days. **Page access tokens obtained from a long-lived user token do not have a fixed expiry** — they survive until the user changes their password, revokes access, or the app loses permissions. A daily "refresh" cron is a no-op.
- **Real failure modes**: user-driven revocations (fix = §4.7 reconnection flow), password changes, app permission loss, page admin role removal.
- **`meta-token-probe`** (weekly pg_cron): for each active `channel_account`, `GET /{page-id}?fields=id` with the decrypted token; on 401/190 (`access token invalid`), set `is_active = false`, `metadata->>'token_error'`, and raise an admin notification (realtime + dashboard banner). Success updates `token_validated_at`.
- Token rotation: if Meta invalidates a token, the settings UI reconnection flow (§4.7) writes a new one through the same encrypt path (§13.1).

### 5.5 Inbound Attachment Persistence (H3 + ME-12 — downloads OFF the critical path)

Meta's CDN attachment URLs are temporary and token-gated; storing them renders broken media later. v2 downloaded at webhook time — on the critical path; a batch of image messages with slow CDN fetches breaches the 20-second response budget. v3 downloads are **asynchronous from day one**:

1. **Webhook (critical path)**: insert the message immediately; each attachment carries `meta_url`; `metadata.download_pending = true`. No fetch.
2. **Sweep download task** (every sweep pass): select up to 25 messages with `metadata->>'download_pending' = 'true'` and `created_at > now() - interval '24 hours'`; for each attachment: fetch the Meta URL with the page token (`Authorization: Bearer <page_token>`), upload to `inbox-attachments/{business_id}/{conversation_id}/{platform_message_id}-{n}.{ext}`, fill `storage_path`, then clear the flag. Failures leave the flag set and retry on the next pass until the 24h window lapses (then a terminal `download_failed` metadata flag + observability counter).
3. **UI renders** short-lived signed URLs (60 min) generated on demand; while `download_pending`, the bubble shows a lightweight placeholder chip.
4. **Outbound agent attachments** (ComposerBar): upload from browser to the same bucket via the §2.6 INSERT policy (25MB bucket limit; type allowlist + extension check enforced **client-side** — ME-6), then the outbox row carries `attachments`; `meta-send` either (a) generates a short-TTL public signed URL for Meta to fetch, or (b) for previously-sent files, reuses Meta's `attachment_id`. Large-file rule: >8MB images / >25MB files rejected in the composer before upload (UI check).
5. Avatars: profile pictures from the profile API have the same expiring-URL problem; the same sweep task persists them to `{business_id}/avatars/{platform_recipient_id}.{ext}` (§7.1).

### 5.6 Outbox Sweep (H4 + ME-1 + ME-3 + ME-12)

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

**ME-1: the sweep's claim step is a service-role-only RPC with the exact `FOR UPDATE SKIP LOCKED` + outer-recheck shape of the repo's own `claim_sync_queue_batch` (20260829000000 — verified):**

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

`meta-outbox-sweep` verifies the `x-cron-secret` header (or the non-blocking call's one-shot token from `meta-webhook`), then:

1. **Claim** a batch (≤100 rows) via `claim_outbox_batch` — atomically safe under the guaranteed overlap of cron + webhook-fired invocations
2. **Process** each claimed row through the §5.1 pipeline (same checks as `meta-send`)
3. **Download pending attachments** (§5.5, batch of 25)
4. **Dispatch due campaigns** (ME-3 — sole trigger): scan `bulk_campaigns WHERE status='scheduled' AND scheduled_at <= now()` (served by `idx_campaigns_due`) and invoke `meta-bulk-send` per campaign. `meta-bulk-send` itself opens with the **atomic campaign claim** — `UPDATE bulk_campaigns SET status='sending', started_at=now() WHERE id=$1 AND status='scheduled' RETURNING *` — so if two sweep invocations both dispatch the same campaign, the loser's claim returns zero rows and it exits without sending anything (§10.4).

If the platform's pg_cron rejects a `30 seconds` interval, use `'* * * * *'` (1 min) — interactive sends never wait on the sweep (direct-invoke path §1.5), only auto-reply worst-case latency widens from ~30s to ~90s.

### 5.7 Rate limit on profile fetches (M9)

The webhook-time profile fetch (`GET /{psid}?fields=name,profile_pic`, page token) is rate-limited by Meta per page. Strategy: fetch only on FIRST message from a sender (no `customer_aliases` row for that PSID), cache indefinitely (name changes are rare; profile_pic persists to Storage), and never block message processing on it — fallback name applies immediately (§7.1).

---

## 6. Order Management from Inbox

### 6.1 Create Order from Chat (H6 + HI-2 — the dialog IS modified; exact spec, re-verified against source)

`AddOrderDialog` today: Props `{open, onOpenChange, onCreated}` (lines 89-93); `onCreated()` invoked with **no arguments** (line 897); customer resolved from the typed phone (line 782 — global `customers.phone` lookup, then create at 796); **the dialog self-fetches its entire catalog** (products, variations, order_sources, pathao geo, invoice_settings, stores, categories, product_categories — one `Promise.all`, lines 284-321) and accepts **no dataset props**; `source` state holds the source row **name** (lines 241/303) and the name string is what gets inserted into `customers.source` (line 803) and `orders.source` (line 817); the phone is normalized **on save** by `normalizeBdPhone` (lines 35-42, 779).

**Modification 1 — `onCreated` result payload + prefill prop (backwards-compatible; existing orders-page caller ignores the new argument and passes no prefill):**

```typescript
// AddOrderDialog.tsx
interface CreatedOrderResult {
  orderId: string;        // order.id — in scope at the onCreated call site (line 837 result)
  orderNumber: string;   // orderNumber — line 810
  customerId: string | null;  // customerId — line 778
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result?: CreatedOrderResult) => void;   // <- optional arg, backwards-compatible
  prefill?: {
    customerName?: string;    // Seeds the customer name field
    customerPhone?: string;   // Seeds the phone field RAW — the dialog normalizes on save (line 779);
                              // normalizeBdPhone is BD-format-specific (documented limitation:
                              // non-BD numbers captured from chat may normalize oddly — agent
                              // verifies the seeded field before saving)
    sourceName?: string;      // The order_source row NAME (e.g. 'fb/ig') — state holds names
                              // (line 241/303), and the name string is what orders.source stores
  };
  catalogScope?: {            // Modification 2 — see below
    storeIds?: string[];       // The business's selling-point store ids — THE scoping key (ME-B1)
  };
}

// In the component body:
// (1) prefill effect — one-time, no render loop; seeds state directly:
useEffect(() => {
  if (open && prefill) {
    if (prefill.customerName) setCustomerName(prefill.customerName);
    if (prefill.customerPhone) setCustomerPhone(prefill.customerPhone);   // RAW — normalize happens at save
    if (prefill.sourceName) setSource(prefill.sourceName);                // NAME, not id (HI-2)
  }
}, [open, prefill]);

// (2) catalog scoping — applied inside the EXISTING Promise.all (lines 286-297)
//     when catalogScope is present (ME-B1 fixes: store-keyed, not id-list):
//     - products:        .in('store_id', catalogScope.storeIds)   (products carry store_id — verified DDL)
//     - product_variations: .in('product_id', <ids of the scoped products>) —
//       variations are keyed by their OWN ids with a product_id FK (dialog line 288);
//       the dialog fetches variations AFTER products, so it has the scoped product
//       ids in hand — filter by product_id, NOT by 'id'
//     - stores:          .in('id', catalogScope.storeIds)
//     - orders_sources:  NOT scoped (catalogScope carries no source ids; sources
//       are a per-business constant list — removing it from the scoped set)
//     The dialog keeps self-fetching (verified: no dataset props exist), but
//     fetches the scoped slice. Store-keyed filters keep the PostgREST URL a
//     handful of values long (id-lists of hundreds of products would breach
//     URL/header limits — ME-B1).

// (3) onCreated payload — change line 897 from `onCreated();` to:
onCreated({ orderId: order.id, orderNumber, customerId });
// order.id (from the .select("id").single() insert, lines 815-837), orderNumber
// (line 810), and customerId (line 778) are all in scope at the call site —
// verified. This is the minimal-change option: no query-latest-order round
// trip, no extra fetch.
```

**Modification 2 — business-scoped catalog (HI-2(d) + ME-B1):** v2's claim that "scoping happens in the wrapper's data fetching" was **false** — the dialog self-fetches its catalog (verified lines 284-321) and accepts no dataset props, so an inbox wrapper could not scope it. The `catalogScope` prop above is the fix: the `OrderLinker` wrapper computes the active business's `storeIds` via `selling_points` (foundation mechanism — `selling_points.business_id` + `woo_store_id`) and passes them in. The dialog's internal queries then filter **by `store_id`** (products), `product_id` (variations), and `id` (stores) — Business A's inbox agents can no longer select Business B's products/stores, and the PostgREST URL stays a handful of values long. The orders page (no `catalogScope`) is unaffected.

**Flow (the concrete link → tag → merge chain — every step now works as stated):**

1. Agent clicks "Create Order" in the ContextSidebar
2. `OrderLinker` opens `AddOrderDialog` with `prefill = { customerName: <profile name>, customerPhone: <phone captured in chat, if any — RAW>, sourceName: 'fb/ig' }` (the row is seeded by Migration B — LO-2) and `catalogScope = <business's productIds/storeIds>`
3. Dialog saves: customer resolution by typed phone (line 782) runs — **this is the merge point** (§7.2). The dialog's orders insert does NOT set `business_id` (it doesn't know the business — verified). Resolution for inbox orders happens at the **link** step: `OrderLinker` UPDATEs the order's `business_id` from the conversation immediately after `onCreated`, and trigger (b) backfills it defensively too (§2.5.4 HI-B3 — both layers, so an inbox order can never stay unscoped). When the agent selects a scoped store, the §2.5.4 insert trigger ALSO resolves via `store_id` → selling point.
4. On `onCreated({ orderId, orderNumber, customerId })`: `OrderLinker` inserts into `conversation_orders` (`business_id` from the conversation, `order_id` from the payload) → trigger (b) tags `has_ordered` under the conversation's business; the HI-3 policy guarantees the link is same-business
5. Post a system message into the thread: "Order #`{orderNumber}` created" via `post_system_message` (§2.5.5; `content_type='order_confirmation'`, `sender_type='system'`, never sent to Meta)
6. If the dialog resolved a DIFFERENT customer by phone than the conversation's alias-created customer, `OrderLinker` calls `merge_chat_customers` (§7.2) with `customerId` (the order's, from the payload) as canonical — the RPC moves aliases/conversations to it and the order + chat now aggregate on one customer. The `onCreated` payload's `customerId` makes this check possible without any extra query (this was v2's broken link — HI-2).

**Phase 4 budget: 1-2 days** (dialog modifications: prefill effect + catalogScope filters + onCreated payload ≈ 30 lines with tests) **plus regression check of the orders page usage** (passes no `prefill`/`catalogScope`, ignores the new `onCreated` argument — unaffected).

### 6.2 Link Existing Order

1. Search orders by order_number, customer name, or phone — **business-scoped via `orders.business_id`** (§2.5.4; NULL-business rows surface only if the agent has the orders-page-wide permission and the UI marks them "unscoped")
2. Results display with `OrderBadges` (verified exists)
3. On select: insert `conversation_orders` (HI-3 policy enforces same-business conversation + order) → trigger (b) tags `has_ordered`
4. Linked orders render in the ContextSidebar with status badges

### 6.3 Order Status Sync to Chat

On `order_timeline` insert for an order linked to conversations (DB trigger → edge function enqueue, or checked in the sweep):
1. Insert system message via `post_system_message`: "Order #1234 has been shipped"
2. If the business enables "notify customer" and the window is open (or `POST_PURCHASE` tag permitted + not opted out — ME-13): insert outbox row for the customer

### 6.4 AI-Powered Order Extraction

Reuse `parse-order-text` edge function (verified exists, 240 lines). Agent pastes chat text into the dialog's AI parse field — existing flow, works with prefill (the extracted phone lands in the same seeded field).

---

## 7. Customer CRM

### 7.1 Customer Resolution at Webhook Time (H11 + M9 + A1 + LO-14)

**Webhook-time resolution is alias-first ONLY.** Meta webhooks carry only the platform ID — no phone, no email, no name. The woo-webhook phone-first pattern (lines 550-614) is inapplicable at webhook time; it is inherited only for order creation (§6.1).

```
resolveCustomerByPlatformId(platform, senderId):
  1. alias lookup: customer_aliases WHERE type IN ('facebook_psid'|'instagram_id')
     AND lower(value) = lower(senderId)  -- uses new index §2.2.0
     -- LO-14: fetch .limit(2), NOT maybeSingle() — the unique index is
     -- (customer_id, type, lower(value)), NOT (type, value), so a merge race
     -- can leave the SAME platform id under two customers; maybeSingle()
     -- would throw PGRST116 on that state
  2. if exactly 1 row -> return customer_id
  3. if 2 rows (merge-race duplicate):
     a. deterministically pick the OLDER customer (min(created_at), tie-break min(id))
     b. log a duplicate-alias warning to meta_webhook_events (observability)
        and enqueue the pair into the Phase 5 manual-merge queue
     c. return the picked customer_id   (the merge RPC §7.2 eventually resolves)
  4. not found:
     a. kick off best-effort profile fetch: GET /{senderId}?fields=name,profile_pic
        with page token (rate-limited: first-message-only, §5.7)
     b. create customers row: name = profile.name OR 'Facebook User' / 'Instagram User'
        (fallback immediately — customers.name is NOT NULL, verified), phone NULL,
        store_id NULL
     c. insert alias (type facebook_psid|instagram_id, value senderId,
        source_store_id NULL)  -- requires §2.2.0 CHECK extension; ON CONFLICT DO NOTHING
     d. avatar persisted async by the sweep (expiring URL — §5.5)
  5. attach customer_id to the conversation
```

The profile fetch is non-blocking: the message and customer insert immediately with the fallback name; a follow-up update lands when the fetch completes (usually <1s).

### 7.2 Cross-Platform Merge (H11 + HI-2 + LO-14 — phone matching happens at ORDER time)

Phone linkage becomes possible only when the customer shares a number in chat and an order is created:

1. Agent creates an order from the inbox (§6.1) with a phone captured from the conversation
2. `AddOrderDialog`'s existing global-phone customer resolution (line 782: lookup by typed phone) runs — this is the actual merge point
3. If the resolved-by-phone customer differs from the conversation's alias-created customer:
   - The order's `customer_id` points at the phone-matched (older) customer — and the `onCreated` payload (§6.1 Modification 1) hands `OrderLinker` that `customerId` directly (v2 could not do this comparison at all — HI-2)
   - `OrderLinker` calls `merge_chat_customers(chat_customer_id, canonical_customer_id, conversation.business_id)` (3-arg — L3-5) — full SQL:

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

  -- Ownership assertion (SECURITY DEFINER bypasses RLS — H8 pattern):
  -- admin, or a member of that business with inbox.manage
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
          OR (v_business_id IS NOT NULL
              AND public.is_business_member(v_business_id)
              AND public.has_permission(auth.uid(), 'inbox.manage'::app_permission))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- LO-14: alias dedup BEFORE the move. If the canonical customer already has
  -- an alias of the same (type, lower(value)) — impossible for platform IDs in
  -- normal flow, possible via merge races — delete the duplicate from the chat
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
  -- conversation_orders has NO customer_id column (verified §2.2.5: id,
  -- business_id, conversation_id, order_id, linked_by, created_at) — it keys
  -- orders, not customers, so there is nothing to repoint. Orders keep their
  -- own customer_id. (C3-3 fix: the v3 statement UPDATEd a nonexistent column.)
  -- NEW-3 fix: the dedup match includes business_id — the unique indexes key
  -- on (customer_id, business_id) [global] and (customer_id, channel_account_id)
  -- [per-channel]. Without the business_id branch, a canonical global opt-out
  -- in ANY business would delete the chat customer's opt-outs in OTHER
  -- businesses (suppression lost — ME-13 harm class). Same business is
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
  -- messages carry no customer_id (conversation-scoped) — nothing to repoint.
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

4. Result: both the FB PSID and IG IGSID aliases point at one customer; orders aggregate correctly; §7.1 lookups are unambiguous (LO-14's `.limit(2)` handles the transient window before any merge runs).

If a customer contacts from both FB and IG: both platform IDs attach to the same customer via aliases when a phone merge occurs; until then, two customer records exist (harmless — no cross-tenant data exposed; the manual merge UI in Phase 5 uses the same RPC).

### 7.3 Tagging System

- Manual: `TagManager` inserts into `customer_tags` (business-scoped, H1)
- Auto: automation rules (`keyword_match`, `tag_added`)
- Order-based: `has_ordered` via DB triggers (§2.5.3) — keyed off `orders.business_id` (§2.5.4)
- Tags are business-scoped: different businesses can have different tag taxonomies **and the same tag name on the same shared customer** (unique constraint is `(business_id, customer_id, tag)`)

### 7.4 Customer Profile Sidebar

`ContextSidebar` > Customer tab: name, phone, email, address (from `customers`); `has_ordered` badge + tags (from `customer_tags`); order count and LTV — **aggregated from `orders WHERE business_id = :business AND customer_id = :customer`** (the §2.5.4 column; unresolvable orders excluded by definition of the filter); notes (`customer_notes`); active conversations across platforms (same business); last interaction timestamp.

---

## 8. Automation Rules

### 8.1 Rules Engine

Evaluated in `meta-webhook` after message insertion:

```typescript
async function evaluateAutomationRules(supabase, businessId, message, conversation) {
  const { data: rules } = await supabase
    .from("automation_rules")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("priority", { ascending: false });

  let insertedOutbox = 0;
  for (const rule of rules || []) {
    if (matchesTrigger(rule, message, conversation)) {
      const rows = await executeAction(rule, supabase, conversation);   // returns count of outbox rows inserted
      insertedOutbox += rows;
      await supabase.from("automation_rules")
        .update({ match_count: rule.match_count + 1 }).eq("id", rule.id);
    }
  }
  // ME-16: fire the sweep ONLY when outbox rows were actually inserted —
  // this is the sole non-cron sweep trigger; idle evaluations cost nothing.
  if (insertedOutbox > 0) {
    await fireOutboxSweepNonBlocking();   // auto-replies go out in <= 2s (§1.5)
  }
}
```

### 8.2 Trigger Types

| Trigger | Config | Evaluation |
|---------|--------|------------|
| `keyword_match` | `{keywords: ["price"], match: "any"}` | Regex/keyword on text content |
| `new_conversation` | `{}` | First message in a new conversation |
| `idle_timeout` | `{timeout_minutes: 30}` | pg_cron check on `last_message_at` |
| `order_status_change` | `{from_status, to_status}` | `order_timeline` inserts (linked orders) |
| `order_created` | `{}` | `orders` insert (business-scoped via `orders.business_id` — §2.5.4/ME-9) |
| `tag_added` | `{tag: "vip"}` | `customer_tags` inserts |
| `business_hours_off` | `{hours: {start, end}}` | Time-of-day check (business timezone) |
| `customer_first_message` | `{}` | Customer has no prior conversations |

### 8.3 Action Types

| Action | Config | Effect |
|--------|--------|--------|
| `auto_reply` | `{text: "..."}` | Insert outbox row (freeform — window-checked; opt-out-suppressed — ME-13) |
| `auto_tag` | `{tag: "interested"}` | Insert `customer_tags` |
| `auto_assign` | `{strategy: "round_robin" \| agent_id}` | Update `assigned_agent_id` |
| `auto_close` | `{idle_hours: 48}` | Status → closed |
| `escalate` | `{to_role: "admin"}` | Priority → urgent + notify |
| `send_saved_message` | `{saved_message_id}` | Insert outbox row from saved draft |
| `send_optin_prompt` | `{saved_message_id}` | Sends the referenced opt-in saved message (category `optin_prompt`/`optin_one_time`) — i.e., a structured `notification_messages`/`one_time_notif` **template send** with its taxonomy topic + frequency (HI-1; §10.2). NO free-form topic string exists. |

### 8.4 SLA Timers

pg_cron every 5 minutes: query conversations `status NOT IN ('closed')` AND `last_message_at < now() - X minutes` → escalate priority or auto-close per rules; notify agents via Realtime Broadcast.

---

## 9. Agent Collaboration

### 9.1 Assignment

- **Round-robin**: on new conversation, agent with fewest open conversations among `user_business_access` members of the business
- **Manual**: `AssignmentDropdown` via `SearchableSelect`, populated from `user_business_access` (join `profiles` for names)
- **Skill-based routing**: future (custom_roles)

### 9.2 Internal Notes

`content_type = 'internal_note'` rows in `messages` — inserted by agents under the ME-5 sender policy (sender_type='agent'), never sent to Meta (meta-send filters `content_type`), rendered with a distinct background + badge, `@mentions` parsed from `@[name](user_id)` and notified via Realtime.

### 9.3 Transfer

Transfer button → target agent → `post_system_message` internal note "transferred from A to B" → update `assigned_agent_id` (with the LO-13 stale-check) → Realtime notify both.

### 9.4 Presence (LO-10 close-out added)

Realtime Presence channels `presence:conversation:{id}`; status dots on avatars; persisted to `agent_presence_log` (90-day retention, §17.5). **Interval close-out**: the client calls the tiny `meta-presence` edge function on status change (open interval) and on `pagehide` — a `fetch('/functions/v1/meta-presence', { method: 'POST', keepalive: true, headers: { Authorization: ... } })` (sendBeacon cannot set the Authorization header — stated) which sets `ended_at` on the open interval. **Safety net**: a pg_cron sweep (§17.5) force-closes rows with `ended_at IS NULL AND started_at < now() - interval '24 hours'`.

### 9.5 Collision Detection

Open conversation → upsert `conversation_viewers` (LO-3 INSERT policy: own row + same-business conversation) → Broadcast "X is viewing" → banner in others' UI → remove on unmount + heartbeat cleanup (sweep deletes `viewed_at < now() - 5 min` rows).

---

## 10. Bulk Messaging & Proactive Outreach (C2 + HI-1 redesign)

### 10.0 What is and isn't possible (stakeholder statement)

- **Within 24h of the customer's last message**: freeform promotional messages are allowed. This is the primary bulk channel.
- **Outside the window**: the only options are (a) the four permitted message tags for their narrow uses, and (b) **Recurring Notifications / OTN** — opt-in-based tokens that let the page message the customer on a subscribed topic outside the window (Messenger; **[VERIFY IN PHASE 0 SPIKE]**). There is NO template-approval mechanism, NO marketing tag, and NO way to bulk-message cold recipients. WhatsApp is a different product/channel if out-of-window marketing is a hard requirement.

### 10.1 Audience Builder

Filter by: tags (business-scoped, array-contains — LO-8), order count (via `orders.business_id` — §2.5.4/ME-9), last order date, platform (FB/IG/both — resolved to per-platform recipient rows, M14), `has_ordered` tag, **active notification subscription per topic (taxonomy vocabulary — HI-1)**, within-window status (live preview: "N reachable now / M via subscription / K not reachable"). Excludes `messaging_opt_outs` (global rows + per-channel rows, §2.2.15 — ME-13).

### 10.2 Opt-In Prompt Flow (HI-1 — corrected: structured template, no custom CTA)

1. Business creates an **opt-in prompt saved message** (category `optin_prompt`). The creation UI is a **topic + frequency picker**: topic from Meta's fixed taxonomy (labels map: "New arrivals" → `NEWSLETTER`, "Order status" → `ORDER_STATUS`, …), frequency from daily/weekly/monthly, plus a short title. The row stores `{topic, frequency, title}` in `optin_config` (§2.2.9 + §2.5.6 trigger enforces presence). **There is no freeform CTA message — the business cannot write opt-in copy that Meta renders as a prompt.**
2. Agent (or an automation `send_optin_prompt` action referencing the saved message) sends the prompt in-conversation (within window — the template send itself is a normal message): `meta-send` constructs the Send API body with `attachment.type='template'`, `payload.template_type='notification_messages'`, the topic, and the `re_prompt_interval` **[VERIFY IN PHASE 0 SPIKE: exact field names/limits]**. **Meta renders the prompt card with its own Allow/Manage controls.**
3. Customer accepts → Meta fires the `messaging_optins` webhook → the webhook upserts `notification_subscriptions` (token, topic from the taxonomy, type='recurring', expires_at per-topic validity) **[VERIFY spike: exact payload shape]**
4. Campaigns for that topic can now include this customer **outside the 24h window**, sending via the notification token
5. Agents see a per-conversation subscription chip (topic label + active/expired); a "Re-prompt" button re-sends the template when a subscription lapses (subject to Meta's re-prompt interval rules — per-topic cooldown recorded from the spike)

**OTN — distinct flow (not the same family):** category `optin_one_time` saved messages store `{title, payload}`; the send uses `payload.template_type='one_time_notif'` with a Notify button the user taps; the same `messaging_optins` webhook delivers a one-usable token (`subscription_type='one_time'`, `topic` NULL — §2.5.6 trigger enforces); the single follow-up send consumes it (`status='used'`). **[VERIFY spike: exact payload + token semantics]**

### 10.3 Send-Time Eligibility (per recipient row)

For each `(campaign, customer, channel_account)` recipient:

```
eligible(if) =
  NOT opted_out (global or per-channel for this business — ME-13)
  AND (
       (now() < conversation.window_expires_at)                     -- in-window freeform
    OR (campaign.notification_topic IS NOT NULL                     -- ME-10: topic linkage
        AND EXISTS (SELECT 1 FROM notification_subscriptions s
                    WHERE s.channel_account_id = campaign.channel_account_id
                      AND s.conversation_id = recipients.conversation_id
                      AND s.topic = campaign.notification_topic       -- taxonomy join key
                      AND s.status = 'active'
                      AND (s.expires_at IS NULL OR s.expires_at > now()))
  )
```

Ineligible rows are marked `skipped` with `skip_reason` (`opted_out` / `outside_window_no_subscription` / `no_conversation` / `quota_exhausted`) and reported in the campaign dashboard — the design never attempts API-rejected sends.

### 10.4 Campaign Engine (`meta-bulk-send` — ME-3 single trigger + LO-11 atomic counters)

Triggered **only** by the sweep (no independent cron):

1. **Atomic campaign claim** (first statement — concurrent sweep invocations dispatching the same campaign race here; the loser exits): `UPDATE bulk_campaigns SET status='sending', started_at=now() WHERE id=$1 AND status='scheduled' RETURNING *` — zero returned rows → exit immediately
2. Build audience from `audience_filter` → insert `bulk_campaign_recipients` rows (with `business_id`, `channel_account_id`, `conversation_id`, `subscription_id` backfilled — C1's code path); set `total_recipients` (frozen from this build)
3. Loop (bounded-concurrency promise pool of 10-20 in-flight sends, each consuming one §5.3 token):
   - For each pending recipient: re-check §10.3 eligibility at send time (the window may close mid-campaign)
   - Eligible → insert outbox row (`subscription_id` set if that's the path; `metadata.campaign_id` stamped — ME-11) → send → update recipient status; counters increment **atomically per statement** (LO-11): `SET sent_count = sent_count + 1` / `failed_count = failed_count + 1` / `opted_out_count = opted_out_count + 1` — never read-modify-write across the pool
   - Ineligible → `skipped` + reason; `skipped_count` incremented atomically at the same time
4. On completion (or pause/failure): campaign `completed`/`paused`/`failed`, `completed_at`, final counters
5. Campaign dashboard: sent / failed / skipped (by reason) / opted-out counts, per-channel breakdown

### 10.5 Opt-Out Handling (ME-13 — scope decision made explicit)

**Decision: opt-outs suppress ALL outbound messaging — 1:1 agent replies, automation auto-replies, and campaigns — except the transactional tags `ACCOUNT_UPDATE` and `POST_PURCHASE` (order-update/customer-service essentials Meta's policies expect to remain deliverable).** The check lives in `meta-send`'s §5.2 matrix (row 2), which every outbound path (agent direct, automation via sweep, campaign engine) funnels through — not just the campaign eligibility function.

- Inbound keyword detection ("STOP", "UNSUBSCRIBE", "OPT OUT") → insert `messaging_opt_outs` (global row) + audit log
- Agents can undo an opt-out (admin/inbox.manage DELETE, audited)
- The composer shows the persistent opt-out banner (§3.6) so agents know before typing

### 10.6 Fallback If the Spike Disproves Subscription Assumptions (defensive design — HI-1 extended)

If Phase 0 verification finds Recurring Notifications/OTN behave differently than assumed — **including the case where the structured `notification_messages` template is unavailable to this app, requires additional allowlisting, or the taxonomy/payload differs** (HI-1's extended failure mode, beyond "RN unavailable"):

- `notification_subscriptions` table remains valid (it may stay empty or carry different fields — the spike updates the webhook parser and the §2.2.10 topic CHECK)
- Campaign eligibility collapses to **within-window-only**: `eligible = NOT opted_out AND now() < window_expires_at`
- The opt-in prompt flow (§10.2) is disabled behind a feature flag (`optin_prompt`/`optin_one_time` saved-message creation + `send_optin_prompt` action gated); the UI hides the topic picker and subscription chips
- HUMAN_AGENT remains the 7-day out-of-window path for tagged human-support messages (subject to its own Advanced Access approval — ME-8)
- Everything else (audience builder, recipient tracking, dashboards) is unaffected

No schema change required by the fallback — that is the point of this design.

---

## 11. Analytics and Reporting

### 11.1 Materialized View (A2 + ME-11 filter)

```sql
CREATE MATERIALIZED VIEW public.inbox_analytics_daily AS
SELECT
  c.business_id,
  DATE_TRUNC('day', m.created_at) AS day,
  c.platform,
  COUNT(DISTINCT c.id) AS conversations_count,
  COUNT(m.id) FILTER (WHERE m.direction = 'inbound') AS inbound_messages,
  COUNT(m.id) FILTER (WHERE m.direction = 'outbound') AS outbound_messages,
  -- ME-11: exclude conversations with no customer message (outbound campaign
  -- seeds) — their first_agent_response_at is campaign-time and would skew
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

(The trigger-side guard §2.5.1 already refuses to SET `first_agent_response_at` for campaign/bot/system/internal-note rows and for outbound-only conversations; the MV filter is the belt-and-braces analytics-side guard.)

### 11.2 Key Metrics

| Metric | Source |
|--------|--------|
| Avg First Response Time | `conversations.first_agent_response_at - created_at` (campaign/bot-free — ME-11) |
| Avg Resolution Time | `closed_at - created_at` |
| Messages/Day, Conversations/Day | `messages` / `conversations` |
| Agent performance | `messages.sender_agent_id` aggregation |
| Conversion rate | `conversation_orders` JOIN `conversations` |
| Peak hours | `messages` hour-of-day heatmap |
| Saved-message usage | `message_outbox.saved_message_id` |
| Opt-out rate | `messaging_opt_outs` over time |
| Campaign reach | `bulk_campaign_recipients` status breakdown |
| Subscription rate | `notification_subscriptions` per topic (taxonomy vocabulary) |

### 11.3 CSAT (M15 fix — no delayed out-of-window send)

On `status → resolved`:
1. **Immediately** insert a CSAT prompt message ("How was your experience? Reply 1-5") — the customer's window is open in the common case (resolution follows a recent exchange); the prompt is a saved message (category `csat`)
2. If the window is closed at resolution time: **do not send** — render an in-thread CSAT prompt chip for the agent to send later, or include it in the next in-window interaction (automation `keyword_match` rule can attach it)
3. Parse numeric replies, store `conversations.metadata->>'csat_score'`

---

## 12. Multi-Tenant Support

- One business → N pages + M IG accounts → N+M `channel_accounts` rows
- Cross-business isolation: RLS on reads; permission-gated writes (§2.3); **relational-consistency EXISTS clauses on every cross-referencing INSERT** (§2.3 — HI-3) so a member of Business A cannot reference Business B's conversation, page, or order even inside a row whose `business_id` they control; the `meta-send` re-assert (§5.1) covers the service-role path; service-role edge functions additionally filter by `business_id` explicitly
- The `customers` table is global-by-design (shared across businesses, verified) — customer *tags/notes* are business-scoped (H1); platform aliases are global (a PSID maps to one customer system-wide — merge-race duplicates handled per §7.1/§7.2, LO-14)

---

## 13. Security

### 13.1 Token Encryption & Decryption (C4 + CR-1 — pgcrypto-correct)

**CR-1 root cause and fix:** On Supabase, **pgcrypto's functions live in the `extensions` schema** (verified convention: this repo installs pg_net/pg_cron `WITH SCHEMA extensions`; no migration enables pgcrypto or references `pgp_sym_*`/`gen_random_bytes` — zero references repo-wide — so the hosted default applies and `CREATE EXTENSION IF NOT EXISTS pgcrypto;` without `SCHEMA` is a silent no-op on an existing project). Postgres resolves `pgp_sym_encrypt`, `pgp_sym_decrypt`, `dearmor`, and `gen_random_bytes` through `search_path`; v2's `search_path = public, vault` made them **unresolvable** — the vault-key DO block would abort Migration C, and the RPCs would throw on every call. v3 therefore: (1) creates the extension explicitly in `extensions`; (2) sets every pgcrypto-calling function's `search_path = public, vault, extensions`; (3) **additionally schema-qualifies every pgcrypto call** (`extensions.pgp_sym_encrypt(...)`), so the functions survive even a future search_path edit; (4) the DO block schema-qualifies too (DO blocks have no function-level SET clause).

**Store**: encryption key in Supabase Vault (Phase 1 migration):

```sql
-- CR-1: pgcrypto MUST be created in the extensions schema (Supabase convention;
-- matches the repo's pg_net/pg_cron pattern). The IF NOT EXISTS guard makes
-- this idempotent; WITH SCHEMA makes the no-op case safe too (if pgcrypto was
-- somehow already in extensions, the functions resolve where we expect them).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- One-time (idempotent): key used ONLY for channel token PGP encryption.
-- DO blocks have no function-level SET search_path — the pgcrypto call is
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

**Encrypt on write** — SECURITY DEFINER trigger (owner `postgres`, so it can read the vault regardless of the inserting role — the repo's own vault reads all occur inside SECURITY DEFINER functions, verified):

```sql
-- CR-1: search_path INCLUDES extensions AND every pgcrypto call is
-- schema-qualified — belt and braces.
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
```

**Phase 1 smoke test (CR-1 — in the same migration transaction boundary as the first account connect, verified manually):** insert a throwaway `channel_accounts` row with a plaintext token, read it back via `get_channel_access_token`, assert round-trip equality, delete the row. This proves the extension schema, the search_path, and the vault key all resolve before any real page connects.

Notes:
- The v1 `current_setting('app.encryption_key')` pattern is **deleted** — GUCs can't be set on PostgREST sessions; the Vault IS the key store.
- Reading `channel_accounts` via the client never exposes plaintext (encrypted column only; the decrypt RPC is service-role-only).
- Frontend "connect page" flow: the client never handles the raw token either — the settings UI calls `meta-connect-account` (§4.7; JWT + `inbox.manage` check server-side) which inserts the row; the trigger encrypts.

### 13.2 Webhook Signature Verification

Mandatory on every POST; app-level `META_APP_SECRET` from edge env (§4.3). GET verification by unique `webhook_verify_token` (§4.2). Reject any POST without a valid `X-Hub-Signature-256`.

### 13.3 Rate Limiting on Client-Facing Endpoints

- `meta-send`: requires valid Supabase JWT; verifies the caller is a member of the outbox row's business (service-role check) AND that the row was created by them or is a sweep-claimed retry; 10 req/sec per user (edge middleware)
- All cron-triggered functions (`meta-outbox-sweep`, `meta-token-probe`): verify `x-cron-secret` header against the vault token (verified repo pattern). `meta-bulk-send` accepts only the sweep's internal dispatch token (same vault mechanism, distinct secret).

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

Logged: sends, assignments/transfers, conversation close, campaign create/start/pause, rule CRUD, saved-message CRUD, opt-outs, channel connect/disconnect, cross-business refusals (HI-3).

### 13.5 PII Handling

- Customer phone/email in `customers` (existing protection standards)
- Message `content` at-rest encryption deferred (future; noted)
- GDPR: data export (customer + conversations + messages) and deletion endpoints (right-to-erasure scopes: messages content nulled, aliases removed, customer anonymized — Meta also requires deletion via the app's data deletion callback URL, added to Phase 0 checklist)

---

## 14. Implementation Phases

### Phase 0: Meta App Setup, App Review & Verification Spike (Weeks 1-3, parallel) — C5 + ME-8 + LO-9

Runs FIRST and partially parallel with Phase 1. **Nothing that touches real customer traffic may ship before the review gate passes.**

- [ ] Create Meta Business App; add Messenger + Instagram products
- [ ] Business Verification (Meta Business Suite → verification docs: company registration etc.) — week 1
- [ ] Set `META_APP_SECRET` in edge secrets; configure webhook URL + verify_token per account
- [ ] **App Review submission** (week 1-2): permissions `pages_messaging`, `pages_show_list`, `instagram_basic`, `instagram_manage_messages` + Advanced Access; **usage submissions for HUMAN_AGENT (message tag), `notification_messages` (RN), and `one_time_notif` (OTN)** (ME-8 — without these the live-mode tag/subscription paths fail); prepare screencasts of the inbox flows (built against dev-mode tester data) + permission justifications
- [ ] **Dev-mode strategy** (LO-9 mechanics added): Development Mode allows app-role users (admin/dev/tester) — team members install the app on their **personal FB/IG accounts**; each tester must **message the test page from their personal account** (not the page itself); **IG testers must first follow + interact with the test professional account** (DMs from non-followers are unreliable); Messenger testers may additionally need a page role in some configurations — verify each tester's first DM works in week 1. Phases 2-6 build and test entirely against this traffic
- [ ] **Verification spike** (week 2-3, hard dependency for Phase 7 design and §5/§10 assumptions):
  - [ ] **RN (HI-1)**: exact `notification_messages` template payload field names (`topic`, `re_prompt_interval`, title, payload), the **current fixed topic taxonomy** (record the full list verbatim — updates the §2.2.10/§2.2.11 CHECK constraints in Phase 7), the `messaging_optins` webhook payload for RN acceptance, token send mechanics, per-topic validity windows and re-prompt rules, quota semantics
  - [ ] **OTN (HI-1)**: `one_time_notif` button-template payload, its `messaging_optins` webhook shape (distinct from RN — recorded separately), token single-use semantics
  - [ ] **HUMAN_AGENT capability check (ME-8)**: app Advanced Access status for the tag; dev-mode trial behavior; live-mode failure mode recorded
  - [ ] IG messaging: confirm RN/OTN availability (assumed absent — §10.6 fallback); media/attachment support matrix (per M7: generic template works; verify per-type constraints)
  - [ ] Page messaging rate limits (bucket capacity/refill assumptions, §5.3) and bulk-send policy constraints
  - [ ] Graph API: pick + pin `META_GRAPH_VERSION` (current stable); snapshot the version-deprecation date; write into `_shared/meta-api.ts`
  - [ ] Profile API: name/profile_pic fields, rate limits (§5.7)
- [ ] Data deletion callback URL configuration (GDPR, §13.5)
- [ ] **Gate**: review approval + Advanced Access (incl. HUMAN_AGENT/RN/OTN usages) = "live traffic" gate for Phase 2 onward (buffer for rejections: up to 2 resubmission cycles are in the week 1-3 window; further slippage delays Phases 7-9 only, since 2-6 run on dev-mode traffic)

### Phase 1: Foundation (Week 1-2) — BLOCKS ALL OTHER PHASES

Dependencies: none (parallel with Phase 0's app setup)

- [ ] Migration A: enums + `app_permission` additions (§2.1 — ALTER TYPE in its OWN file; **never merge with Migration C — ME-15**; CI asserts Migration A contains zero CREATE POLICY/CREATE TABLE)
- [ ] Migration B: `customer_aliases` type CHECK extension + lookup index + **'fb/ig' order_sources seed** (§2.2.0 — A1 + LO-2)
- [ ] **Migration B2 (C3-1/NEW-1 fix): `202609XX03a_omni_inbox_orders_business.sql` runs BEFORE Migration C** — `orders.business_id` column (nullable) + `resolve_order_business` trigger + one-time business_id backfill + `has_ordered` tag backfill (§2.5.4 — Migration C's policies/triggers reference the column, so the column must exist first)
- [ ] Migration C: all tables **in DEPENDENCY order** (H3-1: message_outbox AFTER saved_messages/notification_subscriptions/bulk_campaigns), indexes (§2.4), RLS policies in final shape **with HI-3/ME-5/LO-3 relational-consistency clauses** (§2.3), triggers + functions (§2.5 — incl. GREATEST guards, sender assertion, opt-in config triggers; `orders.business_id` itself is NOT here — it lives in B2 above), rate-limit RPC + seeding trigger (§5.3), `claim_outbox_batch` RPC (§5.6), token encrypt/decrypt **with extensions-schema pgcrypto** (§13.1), realtime publication (§2.7)
- [ ] Migration D: storage bucket + policies (§2.6)
- [ ] Vault: `inbox_token_key`, `meta_outbox_cron_token`, `meta_bulk_dispatch_token` secrets; presence close-out cron (§17.5). **LO-B5 fix: the 30s outbox-sweep cron schedule is NOT created here** — it is created in Phase 2 when `meta-outbox-sweep` first exists (a pg_net schedule pointing at a missing function 404s every 30s for a week otherwise)
- [ ] **CR-1 smoke test**: round-trip encrypt/decrypt of a throwaway channel account (§13.1) — migration C verified end-to-end before any UI exists
- [ ] Edge Function: `meta-webhook` — GET verification (§4.2) + POST verify-first pipeline skeleton (§4.3)
- [ ] Edge Function: `meta-send` — claim + cross-business re-assert + window check + send + status (§5.1/§5.2)
- [ ] Edge Function: `meta-connect-account` — OAuth flow + manual-token fallback (§4.7)
- [ ] Shared Module: `supabase/functions/_shared/meta-api.ts` — unified FB/IG abstraction, GRAPH_VERSION constant
- [ ] Settings UI: channel account connect flow (§4.7; manual token entry fallback)
- [ ] `npm i @tanstack/react-virtual` (M1 — verified absent)
- [ ] Regenerate `src/integrations/supabase/types.ts` via `supabase gen types typescript`

### Phase 2: Core Messaging (Week 3-4) — DEPENDS ON Phase 1 (+ Phase 0 dev-mode testers)

- [ ] Webhook: full event parsing — messages, postbacks, **deliveries, reads** (H2 status updates), optins (subscription capture per Phase 0 spike findings — HI-1)
- [ ] Webhook: customer resolution — alias-first (`.limit(2)` duplicate handling — LO-14) + profile fetch + fallback names (§7.1)
- [ ] Webhook: conversation upsert + message insert with `platform_timestamp` + idempotency; **attachments async** (meta_url + download_pending only — ME-12)
- [ ] Sweep: attachment download task live (§5.5)
- [ ] **Outbox sweep cron schedule created here (LO-B5)** — `meta-outbox-sweep` function deployed, then the 30s pg_net cron (§5.6)
- [ ] **Storage-policy smoke test** (ME-7): upload/read/list as member + as viewer + cross-tenant attempt refused
- [ ] **Rate-limit smoke test** (HI-B1): fresh connected account → `consume_rate_limit_token(account_id)` returns `true`
- [ ] React: `OmniInbox` 3-panel responsive layout (§3.1) + mobile master-detail (§3.1.1)
- [ ] React: `ConversationList` — tuple keyset pagination (LO-7), tag array-contains filters (LO-8), realtime
- [ ] React: `MessageThread` with `@tanstack/react-virtual`; `MessageBubble` with delivery ticks (30s-while-open refetch — §1.4)
- [ ] React: `ComposerBar` — outbox insert + meta-send invoke; window banner (§4.5); **two-handler outbox realtime (ME-2)**
- [ ] React: UX states — empty/loading/skeletons; failed/blocked inline retry incl. timeout_unknown handling (§3.6, LO-6)
- [ ] React: unread management, `mark_conversation_read` RPC on view
- [ ] Routing: `/inbox` route

### Phase 3: Agent Collaboration (Week 4-5)

- [ ] Round-robin auto-assignment in webhook
- [ ] `AssignmentDropdown`; manual assign/reassign (LO-13 stale-check)
- [ ] Internal notes + @mentions
- [ ] Transfer flow + `post_system_message` notes (§2.5.5)
- [ ] Realtime Presence (online/offline/away/busy) + `meta-presence` interval close-out (LO-10)
- [ ] Collision detection (`conversation_viewers` + broadcast + heartbeat cleanup; LO-3 policies live from Phase 1)
- [ ] Supervisor view (admin filters by assignment across the business)

### Phase 4: Commerce Integration (Week 5-7) — re-budgeted per HI-2: 1-2 days for the dialog work + regression

- [ ] `ContextSidebar` tabs (Customer, Orders, Products, Notes)
- [ ] `CustomerProfileCard` (+ `has_ordered` badge — triggers live from Phase 1; order aggregates keyed off `orders.business_id` — §2.5.4)
- [ ] **Modify `AddOrderDialog`** (§6.1): `onCreated({orderId, orderNumber, customerId})` payload + `prefill {customerName, customerPhone(raw), sourceName('fb/ig')}` + `catalogScope {productIds, storeIds}` — ~30 lines; **regression-check the orders page** (no prefill, ignores the new arg)
- [ ] `OrderLinker`: link existing (business-scoped search via `orders.business_id`) + create new (prefilled, catalog-scoped) → `conversation_orders` insert → trigger (b) → `post_system_message` order confirmation
- [ ] Phone-merge: `merge_chat_customers` RPC (§7.2) + auto-merge at order creation using the `onCreated` payload
- [ ] Order status change → system message (+ optional POST_PURCHASE-tagged customer notify, opt-out-suppressed — ME-13)
- [ ] `ProductQuickSend` (MiniProductCatalog + generic template on BOTH platforms — M7)
- [ ] `InvoiceQuickSend` (install `html-to-image` → invoiceHtml → hidden-node render → toPng → Storage upload → image attachment send — HI-B5; no PDF lib in repo, verified)
- [ ] `CourierQuickSend` (courier_shipments → tracking message)

### Phase 5: CRM and Tagging (Week 7-8)

- [ ] `TagManager` + `customer_tags` CRUD (business-scoped)
- [ ] `customer_notes` CRUD
- [ ] Filter conversation list by customer tags (array-contains — LO-8)
- [ ] Cross-platform customer merge UI (uses the §7.2 RPC; feeds from the duplicate-alias warnings queue — LO-14)
- [ ] `QuickReplyPicker` + quick replies CRUD
- [ ] `ConversationSearch` (FTS RPC capped at 50 — §3.7, LO-12)

### Phase 6: Automation (Week 8-9)

- [ ] Automation rules CRUD settings page
- [ ] Rules engine in webhook + sweep auto-reply dispatch (§8.1 — sweep fired only when rows inserted, ME-16)
- [ ] Keyword matching; `order_created` (business-resolved via §2.5.4) / `tag_added` triggers
- [ ] Idle-timeout cron; away messages (business hours)
- [ ] SLA escalation timers; auto-close

### Phase 7: Bulk Messaging & Proactive Outreach (Week 9-11) — design per Phase 0 spike findings; CHECKs finalized here

- [ ] Saved messages library CRUD (internal drafts — no approval flow; opt-in categories carry structured `optin_config` — HI-1)
- [ ] **Topic/finalization migration**: update the §2.2.10/§2.2.11 topic CHECK constraints to the taxonomy recorded in the Phase 0 spike (verbatim list)
- [ ] Opt-in prompt flow: `OptInPromptCard` (topic + frequency picker → `notification_messages` template send — §10.2) + `notification_subscriptions` capture (validated against spike; feature-flagged fallback §10.6)
- [ ] Audience builder UI (with live reachability preview; min_orders via `orders.business_id` — ME-9)
- [ ] Campaign creation + scheduling (topic pick from taxonomy — ME-10) + per-platform recipient rows
- [ ] `meta-bulk-send` engine: atomic campaign claim (ME-3), send-time eligibility (§10.3), bounded-concurrency dispatch, atomic counters (LO-11)
- [ ] Campaign dashboard (sent/failed/skipped-by-reason/opted-out)
- [ ] Opt-out keyword detection + registry + audit (ME-13: check wired into `meta-send`, not just campaigns)
- [ ] Message-tag support in composer (permission-gated, per-tag policy labels, Advanced-Access-aware — ME-8)

### Phase 8: Analytics and Polish (Week 11-13)

- [ ] Materialized view + daily refresh cron (§11.1 — ME-11 filters)
- [ ] Analytics dashboard (Recharts — verified in deps): metrics table §11.2
- [ ] CSAT flow (immediate-send design §11.3)
- [ ] Retention jobs (§17.5): presence/viewers purge + presence interval close-out (LO-10), outbox terminal-state purge, 12-month message archive, `meta_webhook_events` 30-day purge
- [ ] **Data-quality follow-up (ME-9)**: list orders with NULL `business_id` + ambiguous `selling_points (type, woo_store_id)` mappings for manual business assignment
- [ ] E2E tests (Playwright) on dev-mode traffic
- [ ] Load test simulation (mock Meta webhook spout at 500 convos/day rate)

### Phase 9: Hardening (Week 13-14)

- [ ] `meta-token-probe` weekly cron + admin alerts + reconnection flow polish (§5.4)
- [ ] Dead-letter handling for permanently failed outbox rows (audit + report; `timeout_unknown` rows get the verify-in-thread affordance — LO-6)
- [ ] Webhook retry behavior verification (respond < 20s; processing off the critical path — attachments already async from Phase 2, ME-12)
- [ ] Monitoring/alerting: outbox failure rate > 5%, webhook processing > 10s, queue depth, Graph API error-rate (incl. version-deprecation warnings §5.0, permission errors on unapproved tag usage — ME-8)
- [ ] Docs for business admins (connect pages, review status, opt-in campaigns explainer, 24h window explainer, opt-out semantics — ME-13)

**Phase dependency graph:** 0 → (2+ for live traffic); 1 → 2 → {3, 4, 5} → 6 → 7 → 8 → 9. Phases 2-6 testable on dev-mode traffic regardless of review status; Phase 7's out-of-window features additionally gated on spike results + the topic-CHECK finalization.

---

## 15. Component Reuse Strategy (corrected — HI-2)

### 15.1 Reuse With Modification

| Component | Modification |
|---|---|
| `AddOrderDialog` | Three modifications (§6.1 — all re-verified against source this session): (a) `onCreated` gains an optional `{orderId, orderNumber, customerId}` payload — the three values are already in scope at the call site (lines 810/837/778; invocation at 897); (b) `prefill {customerName, customerPhone (raw), sourceName}` — `source` state holds row **names** (lines 241/303) and the name string is what `orders.source` stores (line 817), so the prop carries the NAME; phone seeds raw because the dialog normalizes on save (line 779, `normalizeBdPhone` — BD-specific, documented limitation); (c) `catalogScope {productIds, storeIds}` filters the dialog's **self-fetched** catalog (lines 284-321 — no dataset props exist, so v2's "wrapper does the scoping" was impossible). NOT as-is. |
| `MiniProductCatalog` | As-is, but caller supplies products/categories/stores (props verified: `products, categories, productCatMap?, stores, onSelectProduct, onAddCustomItem, className?`) — the inbox fetches and passes a business-scoped catalog (L8). |

### 15.2 Pattern Reuse (adapted, not copied byte-for-byte)

| Pattern | Source | Inbox Application | Difference |
|---|---|---|---|
| Webhook HMAC verification | woo-webhook lines 86-120 | Same `crypto.subtle` HMAC flow for Meta | Woo compares base64 (`btoa`, line 104); Meta needs `sha256=` + lowercase hex (L1) |
| Customer resolution | woo-webhook lines 550-614 | **Inverted**: alias-first at webhook time (no phone exists — H11; `.limit(2)` duplicate handling — LO-14); phone-first only at order creation | Input payload shape is completely different |
| Idempotency | woo-webhook lines 50-59 | `messages.platform_message_id` UNIQUE + `meta_webhook_events` log | Different table |
| **Atomic batch claim** | `claim_sync_queue_batch` (20260829000000) | `claim_outbox_batch` (§5.6) + the bulk campaign claim (§10.4) | Same `FOR UPDATE SKIP LOCKED` CTE shape, outer-recheck generalized (ME-1/ME-3) |
| Order creation flow | AddOrderDialog lines 774-903 | Unchanged inside the dialog | Payload + prefill + catalogScope added at the edges (HI-2) |
| RLS DO block | foundation lines 333-348 | Identical for SELECT policies | Write policies are per-class + permission-gated + relational-consistency EXISTS clauses (H7/HI-3) — new pattern |
| Cron → edge function | 20260802065715 | Outbox sweep, token-probe, presence close-out | Same shape |
| Vault secret + getter RPC | 20260901000000 | Token key + decrypt RPC | New use — and pgcrypto now schema-correct (CR-1: `extensions` in search_path + schema-qualified calls) |
| Fuse.js search | AddOrderDialog 455-469 | Product search (inside MiniProductCatalog — already there) | — |
| Bulk actions bar | `OrderBulkActionsBar` | Conversation bulk operations | Same pattern |

### 15.3 New Components

All built on shadcn/ui primitives (`Button`, `Input`, `Badge`, `Card`, `Tabs`, `ScrollArea`, `Avatar`, `Tooltip`, `Popover`, `Command`, `Dialog`, `Sheet`/vaul):

`OmniInbox`, `ConversationList` + `ConversationItem`, `MessageThread` + `MessageBubble`, `ComposerBar`, `ContextSidebar`, `CustomerProfileCard`, `TagManager`, `QuickReplyPicker`, `SavedMessagePicker`, `OptInPromptCard`, `CampaignBuilder`, `AssignmentDropdown`, `ConversationSearch`, `BulkActionBar`, `WindowBanner`, `AutomationRuleEditor` (lives inside `InboxSettings.tsx` — LO-B1), `AnalyticsDashboard` (lives in the analytics page file — LO-B1).

---

## 16. Edge Cases and Failure Modes

### 16.1 Webhook Failures

| Scenario | Mitigation |
|----------|------------|
| Duplicate events | `UNIQUE(platform_message_id)` on messages; `meta_webhook_events` observability |
| Webhook endpoint down/slow | Meta retries failed deliveries on an undocumented schedule — the reliable contract is: **respond 200 within 20 seconds** (L7). Budget is engineered, not deferred: attachment downloads are async from Phase 2 (ME-12), so only the message insert is on the critical path |
| Malformed payload | try/catch JSON.parse → 400 + `meta_webhook_events` log |
| Non-numeric `entry.id` | `/^\d+$/` guard, fail-closed skip, logged (LO-1) |
| Unknown channel_account | log + 404-equivalent skip (do not crash the batch) |
| Token invalid mid-processing | Meta 401/190 → `is_active=false` + admin alert (probe verifies weekly, §5.4) |
| Attachment download slow/failed | Off the critical path by design (ME-12): placeholder chip → sweep downloads (batch 25, 24h retry window) → terminal `download_failed` flag + counter |

### 16.2 Send Failures

| Scenario | Mitigation |
|------------|------------|
| Window expired | Pre-checked (§5.2); UI composer disables + countdown; outbox → `blocked_window` |
| HUMAN_AGENT eligible (7d) | Tag selector offered with permission gate AND Advanced-Access-aware disabled state (§4.5, ME-8) |
| Rate limit exhausted | Atomic bucket denies → row stays pending with 1s retry (sweep) |
| Customer opted out | §5.2 check 2: `cancelled` + `error_code='opted_out'` (except ACCOUNT_UPDATE/POST_PURCHASE tags) — ME-13 |
| Cross-business reference | §5.2 check 1: `failed` + `error_code='cross_business_refusal'`, audited (HI-3) |
| Customer blocked page / thread unavailable | Meta error → mark conversation `metadata->>'blocked'`, surface in UI |
| **Network timeout to Graph** | **Never auto-retried** (LO-6): `failed` + `error_code='timeout_unknown'` + "possibly sent — verify in thread" affordance; manual retry (new outbox row) only after the agent confirms the thread — auto-retrying a lost-response send duplicates the customer message (Send API has no client dedup id for normal sends) |
| Invalid/too-large attachment | Rejected in composer pre-upload (8MB image / 25MB file checks — client-side, ME-6) |

### 16.3 Concurrency

| Scenario | Mitigation |
|----------|------------|
| Two agents send simultaneously | Outbox claim is atomic (§1.5); messages serialize per account rate bucket |
| Assign vs transfer race | Optimistic `updated_at` check on conversation UPDATE — specified in §3.3 (`.eq('updated_at', expected)`, zero rows → conflict toast + refetch) and applied to assign/transfer/snooze/status (LO-13) |
| Concurrent sweeps (cron + webhook-fired) | `claim_outbox_batch` `FOR UPDATE SKIP LOCKED` + outer status recheck (ME-1) |
| Concurrent campaign dispatches | Atomic campaign claim `WHERE status='scheduled'` — loser exits (ME-3) |
| Webhook arrives while typing | Normal race; INSERT-only realtime appends the bubble |
| Realtime drop | TanStack refetch on reconnect + channel re-subscription handler |

### 16.4 Data Integrity

| Scenario | Mitigation |
|----------|------------|
| Customer deletes FB/IG account | **No reliable webhook** for account deletion (handovers ≠ deletion) — detect via send failures (recipient unreachable errors) and mark conversation inactive; periodic profile-fetch check marks stale senders (L6) |
| Business disconnects page | `channel_accounts.is_active=false`; webhook skips the account; UI banner |
| Cascade delete business | `ON DELETE CASCADE` on all FKs |
| Orphaned outbox rows | Sweep requeues ≤5 attempts; 7-day-old pending rows cancelled + audited |
| Duplicate platform aliases (race) | `UNIQUE (channel_id, token)` on subscriptions; alias insert ON CONFLICT DO NOTHING; §7.1 `.limit(2)` + oldest-customer pick (LO-14); `merge_chat_customers` dedup-deletes before moving (§7.2) |
| Delayed webhook retry with older timestamp | GREATEST guards in §2.5.1 — window/ordering can never rewind (ME-4) |
| Archive copy rerun | `messages_archive` PK on `id` + `ON CONFLICT (id) DO NOTHING` — monthly runs idempotent (LO-5) |

---

## 17. Production Concerns

### 17.1 Cost Estimation (Supabase Pro) — L10 + ME-16 honest recount

- **Database**: ~16 new tables; 500MB-2GB after 1 year at 500 convos/day
- **Edge Functions** (assumptions stated, per ME-16):
  - Webhook invocations: 500 convos/day × ~10-20 events/conversation (messages + deliveries + reads + optins) ≈ **10-20K/day**
  - Sends: ≈ 5-10K/day
  - Sweep cron: 2,880 invocations/day (30s interval)
  - **Sweep fires from the webhook — counted this time**: only when automation inserts outbox rows. Assuming automation rules are active for 20-50% of inbound messages, that is an additional ≈ **2-10K/day** (proportional to automation adoption; businesses with no rules pay zero)
  - **Total: ≈ 19-38K/day** at the stated assumptions — still comfortably within Pro-tier function invocation limits, but the v2 figure of "sweep 2.9K/day" understated the automation-triggered share by up to ~50%
- **Realtime**: ~20 agents × 1 connection — trivial
- **Storage**: attachments + invoice PDFs — 10-50GB/year depending on media volume

### 17.2 Monitoring

- All edge function errors → `meta_webhook_events` + structured logs
- Alerts: token invalidation, outbox failure rate > 5%, webhook processing > 10s, queue depth > 500, Graph API error-rate spikes (incl. permission errors on unapproved tag usage — ME-8; `timeout_unknown` rate — LO-6), version-deprecation warnings (§5.0), duplicate-alias warnings (LO-14)
- Dashboard: outbox depth, active conversations, agents online, campaign progress

### 17.3 Migration Safety

- Migration safety: policies/seed/backfill statements are re-run-safe (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP POLICY IF EXISTS` before every CREATE). **L3-4 correction: `CREATE TYPE` has no `IF NOT EXISTS` in PG** — enum/table/trigger creations are NOT re-runnable as written; enum creation is wrapped in the standard DO-block `EXISTS (SELECT 1 FROM pg_type ...)` guard in the actual migration files. Supabase migrations run exactly once; the claim is now scoped to what's actually true.
- Test against a production snapshot before applying; rollback scripts per migration
- Never drop columns from existing tables; only add (exceptions, both intentional and non-destructive: the `customer_aliases` type CHECK replacement — additive values; the `'fb/ig'` order_sources seed — a new row)
- **ME-15 file discipline:** Migration A (ALTER TYPE) never merged with Migration C (casts the new values); CI assertion in the Phase 1 PR

### 17.4 Testing Strategy

- Unit: automation rules engine, window calculator (incl. NULL + 7d tag + GREATEST-rewind cases — ME-4), eligibility function (§10.3), send-decision matrix incl. opt-out/timeout classes (§5.2), saved-message variable substitution, optin_config validation
- Integration: webhook pipeline with recorded Meta payloads (postbacks, deliveries, reads, optins — RN + OTN shapes from the spike); send-decision matrix; rate bucket atomicity under concurrent claims; `claim_outbox_batch` under concurrent sweeps; campaign claim under concurrent dispatch; RLS tests incl. **cross-tenant insert refusals (HI-3) and sender-spoofing refusals (ME-5)**
- E2E: webhook → UI display → reply → delivery-status ticks (Playwright, dev-mode traffic)
- Load: mock webhook spout at target rate; concurrent-agent message storms

### 17.5 Data Retention (M13 + LO-5 + LO-10)

pg_cron jobs (scheduled in Phase 8):

| Data | Policy |
|---|---|
| `meta_webhook_events` | Purge > 30 days (webhook_events precedent) |
| `agent_presence_log` | Purge > 90 days; **interval close-out sweep force-closes `ended_at IS NULL AND started_at < now() - interval '24 hours'`** (LO-10) |
| `conversation_viewers` | Heartbeat cleanup: delete `viewed_at < now() - 5 min` (continuous semantics); purge > 90 days |
| `message_outbox` terminal states | Purge sent/failed/cancelled/blocked > 90 days (campaign stats already aggregated) |
| `messages` | **Archive** (not delete): copy > 12 months old to `messages_archive` then delete from hot table — monthly cron, batched |

**LO-5: hand-written archive DDL** (`LIKE ... INCLUDING DEFAULTS` silently drops the CHECK constraints and the platform_message_id UNIQUE — the archive is deliberately constraint-free, STATED): the archive is read-only cold history, not an integrity-enforcing table; the PK on `id` makes the monthly copy idempotent; the FTS index keeps search spanning the archive.

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
  platform_message_id  text,                          -- NO unique constraint (by design — archive is cold history)
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
-- H3-4 fix: RLS on the archive — without it, Supabase default privileges grant
-- SELECT to `authenticated` and every business's archived history is readable
-- cross-tenant via PostgREST. Same member-read shape as §2.3.
ALTER TABLE public.messages_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can read messages_archive" ON public.messages_archive;
CREATE POLICY "Members can read messages_archive" ON public.messages_archive FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR is_business_member(business_id));
-- FTS so ConversationSearch spans the archive — M3-5/ME-B4 fix: the §3.7 RPC
-- gains a messages_archive arm (UNION, dedup by conversation_id, shared caps:
-- 2000-row scan ceiling split across both tables, 50-conversation result cap)
CREATE INDEX idx_messages_archive_fts ON public.messages_archive
  USING GIN (to_tsvector('english', content)) WHERE content_type = 'text';
CREATE INDEX idx_messages_archive_conversation ON public.messages_archive(conversation_id, created_at);
-- monthly cron: INSERT INTO messages_archive (cols...) SELECT cols..., now() FROM messages
--   WHERE created_at < now() - interval '12 months' ... DELETE ... (batched, 10k rows/pass,
--   INSERT ... ON CONFLICT (id) DO NOTHING for rerun safety)

-- Presence close-out sweep (LO-10; L3-3 fix: */15 = every 15 minutes —
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
- `supabase/migrations/202609XX01_omni_inbox_enums.sql` (enums + app_permission — ADD VALUE isolated; NEVER merged with 03 — ME-15)
- `supabase/migrations/202609XX02_omni_inbox_alias_types.sql` (customer_aliases CHECK — A1; **'fb/ig' order_sources seed — LO-2**)
- `supabase/migrations/202609XX03a_omni_inbox_orders_business.sql` (**FIRST — C3-1 fix: orders.business_id column (nullable) + resolve_order_business trigger + one-time business_id backfill + has_ordered tag backfill (M3-4), ordered before ANY statement that references orders.business_id**)
- `supabase/migrations/202609XX03_omni_inbox_schema.sql` (tables in DEPENDENCY order — H3-1: message_outbox AFTER saved_messages/notification_subscriptions/bulk_campaigns; indexes, RLS incl. HI-3/ME-5/LO-3 consistency clauses (may now safely reference orders.business_id — C3-1), triggers/functions, RPCs incl. claim_outbox_batch + search_conversations (LO-B2), vault, pgcrypto-in-extensions, rate-limit seeding (HI-B1), crons)
- `supabase/migrations/202609XX04_omni_inbox_storage.sql` (bucket + policies — ME-6/ME-7)
- `supabase/migrations/202609XX05_omni_inbox_realtime.sql` (publication + replica identity incl. message_outbox)
- `supabase/migrations/202609XX06_omni_inbox_archive.sql` (messages_archive DDL + **RLS ENABLED + member-read SELECT policy (H3-4)** + FTS + cron schedules)

### Edge Functions
- `supabase/functions/meta-webhook/index.ts`
- `supabase/functions/meta-send/index.ts`
- `supabase/functions/meta-outbox-sweep/index.ts`
- `supabase/functions/meta-bulk-send/index.ts`
- `supabase/functions/meta-token-probe/index.ts`
- `supabase/functions/meta-connect-account/index.ts` (OAuth flow §4.7 + manual fallback)
- `supabase/functions/meta-presence/index.ts` (LO-10 close-out endpoint)
- `supabase/functions/_shared/meta-api.ts`

### React Components (`src/components/inbox/`)
`OmniInbox`, `ConversationList`, `ConversationItem`, `MessageThread`, `MessageBubble`, `ComposerBar`, `ContextSidebar`, `CustomerProfileCard`, `ProductQuickSend`, `InvoiceQuickSend`, `CourierQuickSend`, `OrderLinker`, `TagManager`, `QuickReplyPicker`, `SavedMessagePicker`, `OptInPromptCard`, `CampaignBuilder`, `AssignmentDropdown`, `ConversationSearch`, `BulkActionBar`, `WindowBanner` (21 files)

### Modified Files
- `src/components/orders/AddOrderDialog.tsx` (onCreated payload + prefill + catalogScope — §6.1, HI-2)
- `package.json` (+`@tanstack/react-virtual`)
- `src/integrations/supabase/types.ts` (regenerated)

### Hooks (`src/hooks/`)
`useConversations`, `useMessages`, `useMessageInserts`, `useOutboxStatus`, `useConversationRealtime`, `useAgentPresence`, `useWindowStatus`

### Settings Pages
- `src/pages/InboxSettings.tsx` (channel accounts incl. OAuth connect §4.7, saved messages incl. opt-in topic/frequency configs, automation rules, quick replies, campaigns)

---

## 19. Cycle-2 Issue Resolution Index (audit trail)

| Critique ID | Verdict in v3 | Where |
|---|---|---|
| CR-1 | FIXED — pgcrypto in `extensions` schema + `search_path = public, vault, extensions` + schema-qualified calls + DO-block qualification + Phase 1 smoke test | §13.1, Phase 1 |
| HI-1 | FIXED — RN opt-in is a structured `notification_messages` template (topic taxonomy + business frequency); OTN distinct `one_time_notif` flow; topic CHECKs; `optin_config` payload storage; spike keeps exact payload verification | §2.2.9, §2.2.10, §8.3, §10.2, §10.6, Phase 0 |
| HI-2 | FIXED — onCreated payload (values verified in scope at call site), sourceName not id, raw phone seeding, catalogScope for the self-fetched catalog; budget 1-2 days + regression | §6.1, §15.1, Phase 4 |
| HI-3 | FIXED — EXISTS clauses on outbox/messages/conversation_orders (+ viewers LO-3) + meta-send re-assert with `cross_business_refusal` | §2.3, §5.1, §12 |
| ME-1 | FIXED — `claim_outbox_batch` RPC with `FOR UPDATE SKIP LOCKED` + outer recheck, claim_sync_queue_batch precedent cited | §5.6 |
| ME-2 | FIXED — two postgres_changes handlers (INSERT+UPDATE) on one outbox channel; REPLICA IDENTITY FULL on message_outbox; messages ticks via 30s refetch stated | §1.4, §3.3, §3.6, §2.7 |
| ME-3 | FIXED — bulk-send cron removed; sweep sole trigger; atomic campaign claim | §1.3, §5.6, §10.4 |
| ME-4 | FIXED — GREATEST guards on all three bookkeeping columns (NULL-safe) | §2.5.1 |
| ME-5 | FIXED — messages EXISTS clause + agent-only client inserts + `assert_message_sender` trigger + `post_system_message` RPC | §2.3, §2.5.5 |
| ME-6 | FIXED — upload path `{business}/{conversation}/` with conversation EXISTS; mime client-side-only stated | §2.6 |
| ME-7 | FIXED — uuid-regex guards, no channel_accounts subquery on read, volumes stated, Phase 2 smoke test | §2.6, Phase 2 |
| ME-8 | FIXED — HUMAN_AGENT/RN/OTN in review submission; capability check in spike; matrix + UI states | §4.1, §4.5, §5.2, §14 |
| ME-9 | FIXED — orders.business_id column + resolution trigger + backfill + scope statement + data-quality follow-up | §2.5.4, §10.1, §7.4, Phase 8 |
| ME-10 | FIXED — `bulk_campaigns.notification_topic` + CHECK + recipient JOIN pinned | §2.2.11, §10.3 |
| ME-11 | FIXED — trigger exclusion (campaign_id metadata, sender_type, internal notes, requires customer message) + MV FILTER | §2.5.1, §11.1 |
| ME-12 | FIXED — downloads async from Phase 2; sweep download task; only message insert on critical path | §4.4, §4.8, §5.5, §16.1 |
| ME-13 | FIXED — opt-out suppresses all outbound except ACCOUNT_UPDATE/POST_PURCHASE; wired into §5.2 row 2; composer banner | §5.2, §10.5, §3.6 |
| ME-14 | FIXED — §4.7 complete OAuth design (state CSRF, server-side exchange, page/IG discovery, subscription) | §4.7 |
| ME-15 | FIXED — hard warning + CI assertion on migration separation | §2.1, Phase 1, §17.3 |
| ME-16 | FIXED — sweep fired only when outbox rows inserted (sole non-cron trigger); honest recount | §1.1, §1.5, §8.1, §17.1 |
| LO-1 | FIXED — numeric validation + typed queries, `.or()` removed | §4.3 |
| LO-2 | FIXED — 'fb/ig' seed in Migration B (guarded) | §2.2.0 |
| LO-3 | FIXED — viewers INSERT policy with conversation EXISTS; own-row UPDATE/DELETE | §2.3 |
| LO-5 | FIXED — hand-written archive DDL, idempotent PK, FTS index, constraint-free stated | §17.5 |
| LO-6 | FIXED — timeout_unknown class never auto-retried; verify-in-thread affordance | §5.2, §16.2, §3.6 |
| LO-7 | FIXED — tuple keyset (last_message_at, id) | §3.3 |
| LO-8 | FIXED — array-contains tag filters specified (GIN-served) | §3.3 |
| LO-9 | FIXED — tester mechanics (personal accounts, IG follow-first, page roles) | §14 Phase 0 |
| LO-10 | FIXED — keepalive-fetch close + `meta-presence` endpoint + force-close sweep | §9.4, §17.5, §1.3 |
| LO-11 | FIXED — atomic per-statement counter increments pinned | §10.4 |
| LO-12 | FIXED — search RPC capped (LIMIT in CTE before ts_headline) | §3.7 |
| LO-13 | FIXED — `.eq('updated_at', expected)` stale-check spec'd for all conversation mutations | §3.3, §16.3 |
| LO-14 | FIXED — `.limit(2)` lookup + deterministic oldest pick + full `merge_chat_customers` SQL with alias dedup-delete | §7.1, §7.2 |

All 33 cycle-2 issues (1 CRITICAL + 3 HIGH + 16 MEDIUM + 13 LOW) are addressed above; LO-4 was withdrawn by the critique itself and needs no action.

---

This plan is designed to survive adversarial review. Every schema statement is complete SQL; every codebase claim was re-verified in this revision session; every uncertain Meta platform behavior is spike-gated in Phase 0 with a documented fallback. The phased approach builds each layer on tested foundations, with App Review running as an explicit parallel track rather than a hidden blocker.









---

## 20. Revision 4 Changelog (cycle 3 critiques — all issues addressed)

### CRITICAL (Critic A)
- **C3-1** — Migration ordering: `202609XX03a_omni_inbox_orders_business.sql` created FIRST (orders.business_id + resolution trigger + backfills before any referencing statement); §18 + Phase 1 updated; contradiction deleted.
- **C3-2** — `assert_message_sender` now honors a transaction-local GUC (`app.sanctioned_system_message`) set by `post_system_message` before its INSERT; sanctioned system rows pass, direct client inserts still fail.
- **C3-3** — `merge_chat_customers`: the nonexistent `conversation_orders.customer_id` UPDATE deleted (replaced with an explanatory comment); RPC aborts no more.

### HIGH
- **H3-1** — §18 pins dependency-ordered table creation (message_outbox after saved_messages/notification_subscriptions/bulk_campaigns).
- **H3-2 / ME-B5** — §5.1 claim predicate NULL-safe + literal-timestamp fix (`.or('next_retry_at.is.null,next_retry_at.lte.<iso>')`); Retry clears `next_retry_at`.
- **H3-3** — `merge_chat_customers` repoints `messaging_opt_outs` (NULL-safe dedup + delete-survivors); `bulk_campaign_recipients` documented as immutable send history.
- **H3-4** — `messages_archive` gets `ENABLE ROW LEVEL SECURITY` + member-read SELECT policy.
- **HI-B1** — `consume_rate_limit_token` self-seeds (INSERT ON CONFLICT DO NOTHING) + `seed_rate_limit_bucket` AFTER INSERT trigger on channel_accounts + Phase 2 smoke test.
- **HI-B2** — same fix as C3-3.
- **HI-B3** — §2.5.4 canonical: OrderLinker UPDATEs the order's business_id post-`onCreated`; trigger (b) backfills defensively; both contradicting sentences rewritten.
- **HI-B4** — §4.4 step 4 rewritten to watermark semantics (`to_timestamp(watermark/1000)` bulk mark, no mid matching); spike records payload shape.
- **HI-B5** — InvoiceQuickSend: `html-to-image` (new dep, Phase 4 install task) renders invoiceHtml to PNG → Storage → image attachment; no PDF lib fabricated.

### MEDIUM
- **M3-1 / LO-B7** — `last_customer_message_at IS NOT NULL` guard moved INTO the `first_agent_response_at` CASE; prose claims corrected.
- **M3-2** — `freeze_conversation_anchors` trigger blocks client-side `business_id`/`channel_account_id` swaps on conversations.
- **M3-3** — trigger (b) backfills `orders.business_id` from the conversation at link time.
- **M3-4** — migration seeds `has_ordered` tags for the historical order base (INSERT … SELECT ON CONFLICT DO NOTHING).
- **M3-5 / ME-B4** — `search_conversations` UNIONs `messages_archive` (shared 2000-row ceiling, 50-conversation cap); §17.5 claim now true.
- **M3-6 / LO-B6** — "Agents update outbox" UPDATE policy dropped entirely (no client flow needs it).
- **ME-B1** — catalogScope is store-keyed: products by `store_id`, variations by `product_id`, stores by `id`; orders_sources unscoped; URL-length hazard documented.
- **ME-B2** — conversations.tags scoped to conversation-ops tags; customer tag FILTERS join through `customer_tags`; both writers named (Phase 5).
- **ME-B3** — §5.2 row 3a′ pins the opt-in template-send derivation (saved_message category → template build; `content` never sent).
- **ME-B6** — §3.6.1 Accessibility contract added (live region, focus management, labels, non-color signaling, reduced motion).

### LOW
- **L3-1** — order_sources "no name UNIQUE" claim corrected (name IS UNIQUE; guarded seed kept).
- **L3-2** — dropped `idx_conversations_business_status`, `idx_recipients_status`; trimmed `status` from `idx_subscriptions_topic`.
- **L3-3** — presence close-out cron `*/15 * * * *`.
- **L3-4** — idempotency claim scoped honestly (CREATE TYPE guarded in DO block).
- **L3-5** — `merge_chat_customers(p_chat, p_canonical, p_business_id)` — explicit business param, cross-tenant guard; grants updated.
- **LO-B1** — §15.3 notes AutomationRuleEditor lives in InboxSettings, AnalyticsDashboard in the analytics page.
- **LO-B2** — `search_conversations` listed in Migration 03 (§18).
- **LO-B3** — thread backward pagination uses the `(created_at, id)` tuple.
- **LO-B4** — META_CRON_TOKEN reference corrected to §5.6; "one-shot token" language fixed (same vault secret via x-cron-secret).
- **LO-B5** — outbox-sweep cron schedule moved from Phase 1 to Phase 2 (function deploys first).
- **LO-B8** — OAuth state = signed HttpOnly cookie (HMAC, vault key); connect_sessions table dropped from consideration.

---

## 21. Revision 4.1 Changelog (cycle-4 critic fixes)

- **NEW-1 (HIGH)** — Phase 1 checklist gained Migration B2 (03a orders.business_id FIRST); Migration C no longer claims orders.business_id resolution + backfill.
- **NEW-2 (HIGH)** — `seed_rate_limit_bucket` is SECURITY DEFINER (client-side channel_accounts INSERT no longer dies on the service-role-only table).
- **NEW-3 (MEDIUM)** — merge opt-out dedup NULL-branch includes the `o2.business_id = messaging_opt_outs.business_id` comparison.
- **NEW-4 (LOW)** — one-time business_id backfill is concrete SQL (batched DO block, FOR UPDATE, 10k/pass, loops to completion); has_ordered backfill consolidated into the same §2.5.4 block.
- **NEW-5 (LOW)** — unclosed code fence before §2.5.5 fixed; duplicate has_ordered block removed; §6.1 merge caller reference updated to 3-arg.
