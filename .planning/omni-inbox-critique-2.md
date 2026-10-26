# Adversarial Critique Cycle 2 — Omni-Inbox Implementation Plan v2

**Critique date:** 2026-09-10
**Plan under review:** `.planning/omni-inbox-plan-v2.md` (2186 lines)
**Method:** Every v2 codebase claim was independently re-verified against the repository (migrations read where cited; component props, state helpers, insert paths read at cited line numbers; package.json, cron schedules, storage precedents, RLS policy history, and `has_permission()` body all checked). Cycle-1 issues (C1–C5, H1–H11, M1–M18, L1–L10) plus v2's self-reported new defects (A1, A2) were traced to their claimed resolutions. Meta platform claims assessed against 2024–2025 documented behavior.

**Bottom line:** v2 is a substantial, honest revision. 43 of 46 tracked issues are genuinely fixed. But the revision introduced **one CRITICAL runtime blocker** (the C4 fix was designed against the wrong pgcrypto schema layout — the Phase 1 migration itself fails), **three HIGH issues** (a factually wrong Recurring-Notifications opt-in mechanism, an order-from-inbox flow anchored on three wrong facts, and a cross-tenant send hole in the outbox RLS), and 29 medium/low defects.

---

## 0. What checked out (v2's verification pass is real)

Independently re-verified and confirmed accurate:

| v2 claim | Verdict |
|---|---|
| `customers` global (no `business_id`, nullable `store_id`, `name NOT NULL`) | OK — 20260407071618 |
| `customer_aliases` CHECK `('name','email','address')` — A1 discovery correct; default constraint name `customer_aliases_type_check` applies (unnamed inline CHECK) so `DROP CONSTRAINT IF EXISTS` works | OK — 20260418114108 |
| `has_role(uuid, app_role)` / `has_permission(uuid, app_permission)` both SECURITY DEFINER, admin bypass (function body read in full) | OK — 20260412161413, 20260420112330 |
| Foundation DO block, `is_business_member`, `user_business_access`, `'admin'::app_role` cast convention | OK — 20260904000100 |
| woo-webhook: 616 lines, base64 compare line 104, idempotency 50–59, service-role client line 48, `resolveOrCreateCustomer` 550–614 phone-first | OK — all exact |
| `AddOrderDialog` 1304 lines, Props `{open,onOpenChange,onCreated}` 89–93, no prefill, source default line 241, phone lookup 782, customer insert 796 | OK — all exact |
| `MiniProductCatalog` props 31–39 | OK |
| package.json: no `@tanstack/react-virtual`; has `vaul`, `fuse.js`, `react-resizable-panels`, `recharts`, `@tanstack/react-query` | OK |
| Vault getter precedent (`get_sync_worker_cron_token`, SECURITY DEFINER, `search_path = public, vault`, GRANT service_role) | OK — 20260901000000 |
| pg_cron → pg_net edge-function precedent with vault `x-cron-secret` | OK — 20260802065715 |
| `FOR UPDATE SKIP LOCKED` claiming precedent | OK — 20260829000000 |
| Realtime publication precedent | OK — 20260903000500 |
| `webhook_events` service-role-only | OK — 20260802065800 |
| `audit_log.entity_type` free text | OK — 20260412171140 |
| types.ts 3497 lines, `app_permission` 3454–3492, `app_role` 3493 | OK |
| `orders.source` CHECK dropped; `order_sources` exists | OK — 20260415171221, 20260415165743 |
| No table-name collisions for any of the 19 new tables | OK |
| `trigger_set_timestamp()` exists | OK — 20260803160000 |
| Pro tier ~500 realtime connections; INSERT-only avoids UPDATE echo | OK |
| Page tokens from long-lived user tokens: no fixed expiry; weekly probe | OK |
| HUMAN_AGENT 7-day tag on both platforms; generic template on both | OK |
| IG send endpoint `/v{X}/{ig-user-id}/messages` | OK |

One inherited claim is **wrong** (see LO-2): "`order_sources` has an 'fb/ig' row (foundation line 516)". Line 516 is a `SELECT ... WHERE name = 'fb/ig'` lookup, not evidence the row exists — no migration seeds it (the only seed inserts `online, pos, phone, social, wholesale`). Cycle 1 made the same error and v2 inherited it.

---

## 1. CRITICAL ISSUES

### CR-1. The pgcrypto token pipeline fails: `pgp_sym_encrypt`/`gen_random_bytes` are unresolvable under the plan's `search_path`. The Phase 1 migration aborts.

**Plan sections:** §13.1 (vault-key DO block, `encrypt_channel_token`, `get_channel_access_token`), Phase 1 Migration C.

**Evidence:** v2's functions declare `SET search_path = public, vault` (§13.1, lines 1815/1845). On Supabase, **pgcrypto is enabled in the `extensions` schema, not `public`** — verified: no migration in this repo references pgcrypto, pgp functions, or the `extensions` schema at all (nothing moved or pre-created it), so the hosted default applies, and v2's `CREATE EXTENSION IF NOT EXISTS pgcrypto;` (§13.1 note) is a silent no-op on an existing project — it does not relocate the functions. Postgres resolves `pgp_sym_encrypt`, `pgp_sym_decrypt`, `dearmor`, and `gen_random_bytes` through `search_path`, which is `public, vault` inside every function v2 writes. Consequences:

1. The vault-key DO block (§13.1, line 1804) calls `gen_random_bytes(32)` → **Migration C fails outright** ("function gen_random_bytes does not exist") — the same launch-blocking failure mode as v1's C1, one level deeper.
2. Even if the key were seeded, `encrypt_channel_token` and `get_channel_access_token` throw on every invocation → the first `meta-connect-account` insert fails → no page can ever be connected; every send fails at token decryption.

The repo precedent v2 cites (`get_sync_worker_cron_token`) only SELECTs from `vault.decrypted_secrets` — it never invokes a pgcrypto function — so there is no in-repo evidence the pattern works with `search_path = public, vault`.

**Fix:** In the Phase 1 migration: `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;` and set all three `SET search_path` clauses to `public, vault, extensions` — or schema-qualify every call (`extensions.pgp_sym_encrypt(...)`). Add a Phase 1 checklist smoke test: round-trip encrypt/decrypt in the same transaction as the first account connect.

---

## 2. HIGH ISSUES

### HI-1. Recurring Notifications opt-in mechanism described wrong: there is no custom-CTA opt-in message and topics are a fixed taxonomy, not free-form. Phase 7's outreach flow as designed cannot elicit a real opt-in.

**Plan sections:** §2.2.10 (mechanism bullets), §10.2 (opt-in prompt flow), §8.3 (`request_optin`), §10.1 (audience "per topic").

**Evidence (Meta platform fact, 2024–2025):** RN opt-in is not elicited by a page-composed freeform message with a custom accept button. The page sends a platform-rendered **`notification_messages` template message** (`attachment.type = template`, `payload.template_type = notification_messages`) carrying `topic` and `re_prompt_interval`; Meta renders the prompt card with its own Allow/Manage controls, and only acceptance produces the `messaging_optins` webhook. §10.2's flow — "Business creates an opt-in prompt saved message (category `optin_prompt`) — e.g., 'Want updates on new arrivals? Tap below.' … Customer taps accept" — describes an impossible message: a freeform message with a custom button cannot produce an opt-in, and the webhook never fires from it. Further, **topics are not free-form**: Meta requires selecting from a fixed taxonomy (ACCOUNT_UPDATE, COMMUNITY_ALERT, EVENT_REMINDER, NEWSLETTER, ORDER_STATUS, SHIPPING_UPDATE, …). §2.2.10's example `'new_arrivals'` and §8.3's `{topic: "new_arrivals"}` are not valid RN topics — the nearest is NEWSLETTER. The audience-builder topic filter and campaign→subscription matching therefore key off a vocabulary that must mirror Meta's fixed list.

The `[VERIFY IN PHASE 0 SPIKE]` hedges cover payload shapes and limits — they do not cover that the plan's *UX flow and data-model examples* are built on the wrong mechanism. An implementer following §10.2 verbatim builds `OptInPromptCard` as a normal message sender and Phase 7's out-of-window channel ships dead.

**Fix:** (a) Rewrite §2.2.10/§10.2: the opt-in prompt is a structured `notification_messages` template send; `saved_messages` rows of category `optin_prompt` must store the template payload (topic, re_prompt_interval), not CTA copy. (b) Replace `topic text` with a fixed-vocabulary CHECK (values confirmed in the Phase 0 spike) and map UI labels to it ("New arrivals" → NEWSLETTER). (c) Specify OTN's distinct flow (send a `one_time_notif` post-back button template → optin webhook) instead of lumping it as "same family". (d) §10.6's fallback correctly covers "RN unavailable", not "RN works only via platform templates" — extend it.

### HI-2. The order-from-inbox flow (§6.1) cannot be implemented as specified — three factual anchors are wrong and two required modifications are missing.

**Plan sections:** §6.1, §7.2, §15.1, Phase 4 checklist (budgeted 0.5 day).

**Evidence (all verified in `src/components/orders/AddOrderDialog.tsx`):**

1. **"Scoping happens in the wrapper's data fetching. The dialog itself remains untouched for this part" — false.** The dialog self-fetches products, variations, order_sources, pathao geo data, stores, categories, and product_categories in a `Promise.all` on open (lines 285–315). It accepts no dataset props for these. A wrapper cannot inject a business-scoped catalog without a further dialog modification (data-injection or fetch-override props) that v2 does not specify. As written, inbox agents still see every business's products/stores — the exact H6 defect v2 claims to close, reopened by its own fix.
2. **`setSource(prefill.sourceId)` writes the wrong value.** `source` state holds the source row's **name** (`useState("phone")` line 241; `setSource(def.name)` line 303), and the name string is inserted into `orders.source` (line 817) and `customers.source` (line 803). Seeding it with a UUID corrupts both. The prop must carry the row **name** (and the `'fb/ig'` row doesn't exist yet — see LO-2), or the dialog must resolve id→name.
3. **`normalizePhone(prefill.customerPhone)` — no such helper exists in the dialog.** The actual normalizer is `normalizeBdPhone` (line 35), BD-format-specific; it will mangle non-BD numbers captured from chat. The spec cites an unverified helper.
4. **`onCreated: () => void` returns nothing.** §6.1 Flow step 3 ("On `onCreated`: insert into `conversation_orders`…") and §7.2 step 3 (compare the order's resolved `customer_id` with the conversation's to trigger the phone-merge) both require the created order's **id and customer_id** — which the dialog never exposes. Without a further modification (`onCreated: (result: {orderId, customerId}) => void`), `OrderLinker` cannot link, cannot fire the §2.5.3(b) trigger, and cannot compare customers. The chain "create order → link → `has_ordered` tag → phone merge" is broken at its first link.

**Fix:** Expand Modification 1: (a) `onCreated` result payload (backwards-compatible — existing callers ignore the arg); (b) `prefill.source` as the source **name**; (c) seed phone raw, not normalized (dialog normalizes on save, line 779); (d) data-injection or fetch-override prop for the business-scoped catalog, or a second explicit modification filtering the dialog's internal queries by the business's `selling_points` store set. Re-budget Phase 4 at 1–2 days plus regression.

### HI-3. Cross-tenant send hole: the outbox INSERT policy validates only `business_id` — `conversation_id` / `channel_account_id` may belong to a different business. A Business A agent can send a real message from Business B's page to B's customer.

**Plan sections:** §2.3 ("Agents enqueue outbox"), §1.5, §5.2, §13.3.

**Evidence:** The INSERT policy's `WITH CHECK` is `is_business_member(business_id) AND created_by = auth.uid() AND has_permission(...)` — it never asserts that the referenced `conversation_id` (and `channel_account_id`, which is what selects the page token in §5.1) belongs to the **same** business as the row's `business_id`. `meta-send` runs as service role (bypasses RLS — §2.3's own note) and its specified pipeline checks window/tag/subscription only. So an agent of Business A inserts an outbox row with `business_id = A` (their own — passes RLS) but `conversation_id`/`channel_account_id` pointing at Business B; `meta-send` claims it, decrypts **B's page token** via `get_channel_access_token(B_account)`, and delivers the agent's text to B's customer on B's page. This defeats §2.3's enforcement summary — the policies pass while the *effect* crosses tenants. The same unvalidated-FK pattern exists in `conversation_orders` (link an A-conversation to a B-order; pollutes the §2.5.3(b) trigger and the ContextSidebar), and the `messages` INSERT policy has a sibling problem (see ME-5).

**Fix:** Add relational-consistency `WITH CHECK` clauses — e.g. for the outbox: `AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.business_id = message_outbox.business_id) AND EXISTS (SELECT 1 FROM public.channel_accounts ca WHERE ca.id = channel_account_id AND ca.business_id = message_outbox.business_id)`; mirror for `conversation_orders`. Cheaper alternative: a BEFORE INSERT trigger raising on mismatch. Belt-and-braces: `meta-send` re-asserts `conversation.business_id = outbox.business_id` after claiming (one SELECT it already performs).

---

## 3. MEDIUM ISSUES

### ME-1. Outbox sweep claim SQL is unspecified — no `FOR UPDATE SKIP LOCKED`, no atomic status recheck. Concurrent sweeps are guaranteed, not hypothetical.
**§5.6, §1.5 step 5.** The sweep runs every 30s via pg_cron **and** is fired non-blocking by every inbound webhook — under load the two constantly overlap. v2 shows the atomic single-UPDATE claim for `meta-send` but only prose ("Claims `pending` rows older than 5 seconds…") for the sweep. A SELECT-then-UPDATE implementation double-sends (customer-visible duplicate messages); `UPDATE … WHERE id IN (subquery)` without the status predicate in the **outer** WHERE can double-claim under EvalPlanQual re-evaluation. Fix: pin the exact claim pattern in the plan: `UPDATE message_outbox SET status='sending' WHERE id IN (SELECT id FROM message_outbox WHERE status='pending' AND created_at < now() - interval '5 seconds' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100) AND status IN ('pending','failed') RETURNING *`. The repo's own `claim_sync_queue_batch` (20260829000000, verified `FOR UPDATE SKIP LOCKED`) is the precedent — cite it, as v2 does elsewhere.

### ME-2. Realtime contradiction: the INSERT-only `message_outbox` subscription (§1.4/§3.6) can never fire "sending → sent/failed" updates it promises.
**§1.4 vs §1.5/§3.6.** §1.4 subscribes to `message_outbox` **INSERT events only** to drive the "sending → sent/failed" inline affordance — but those are UPDATEs to the outbox row (claim sets `sending`; completion sets `sent`), which an INSERT-only subscription never delivers. Either the status changes must flow through the `messages` INSERT (agent's own `messages` row arrives when send completes — plausible), or the outbox subscription must include UPDATEs for the user's own rows. As written, the optimistic bubble sticks on "sending" gray ticks until a manual refetch. Fix: state the actual mechanism — outbox INSERT gives the immediate `pending` echo; the transition to sent/failed arrives via the `messages` INSERT event; `blocked_window`/`failed` terminal states reach the UI via the conversations channel refetch. Or subscribe UPDATEs filtered server-side is impossible with postgres_changes filters — say which.

### ME-3. Sweep-handoff race: `meta-outbox-sweep` both hands campaigns to `meta-bulk-send` and `meta-bulk-send` runs on its own 1-minute cron — double engine start.
**§5.6 step 3 vs §1.3.** §1.3 lists `meta-bulk-send` on "pg_cron every minute; picks up scheduled campaigns", and §5.6 has the sweep *also* scanning `bulk_campaigns WHERE status='scheduled' AND scheduled_at <= now()` and invoking `meta-bulk-send` for each. Two triggers, one engine, no campaign-claim step specified. Two concurrent engines for the same campaign double-send to every recipient (UNIQUE recipient rows prevent duplicates only if the engine inserts outbox rows transactionally with a status guard; §10.4 step 1 "Mark campaign `sending`" implies a claim, but no atomic claim SQL is given and both invocations can read `status='scheduled'` before either writes). Fix: drop the 1-minute cron for `meta-bulk-send` (single trigger via sweep), or specify the atomic campaign claim: `UPDATE bulk_campaigns SET status='sending', started_at=now() WHERE id=$1 AND status='scheduled' RETURNING *` — the winner proceeds, the loser gets zero rows.

### ME-4. `handle_new_message` race: concurrent webhook inserts (inbound burst) read-modify-write the same conversation row.
**§2.5.1.** Two rapid inbound messages (Meta batches deliveries; webhook and sweep can overlap) run `UPDATE conversations SET unread_count = unread_count + 1 …` — this is actually safe per-statement (the UPDATE is atomic and re-reads the current value under row lock), but the `status` CASE and `first_agent_response_at` COALESCE are also fine per-statement. The real race: the trigger fires per message insert while a webhook *batch* inserts multiple messages — each fires the trigger serially — acceptable. The genuine gap: `last_customer_message_at = NEW.created_at` uses the per-message value with no `GREATEST(old, new)` guard, so a delayed Meta retry delivering an **older** timestamp after a newer message **rewinds the window backwards** (worse: rewinds `last_message_at` ordering). Fix: `last_customer_message_at = GREATEST(last_customer_message_at, NEW.created_at)` (and same for `last_message_at`, `last_agent_message_at`); `first_agent_response_at` logic is already idempotent via COALESCE.

### ME-5. `messages` INSERT policy has the same unvalidated-FK hole as the outbox (HI-3) plus a sender spoofing gap.
**§2.3.** `WITH CHECK` verifies `is_business_member(business_id)` but not that `conversation_id` belongs to that business — an A-business agent can insert a message row (including `internal_note` and fake `system` rows) into B's conversation, polluting B's thread and trigger-updated counters. Also, `sender_type IN ('system','bot')` is client-insertable by any sender: any member with `inbox.send_messages` can forge system/bot-authored rows in their own business (misleading but lower stakes). Fix: add `EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.business_id = messages.business_id)` to the CHECK; consider a trigger asserting only service-role may insert sender_type system/bot (e.g. via a session GUC the edge functions set, or restrict those types to the sweep path via a separate SECURITY DEFINER RPC).

### ME-6. Storage read policy is unbounded across conversations: any member can read *every* attachment of the business — acceptable — but the *upload* policy lets any sender write into any conversation folder and there's no object-size/mime enforcement at the storage layer.
**§2.6.** The INSERT policy checks only the business folder prefix — any member with `inbox.send_messages` can upload into any `{business_id}/{anything}` path inside the bucket (not conversation-constrained). Minor, but combined with 25MB file_size_limit and "type allowlist … extension check" (client-side only per §5.5), a malicious member can stuff the bucket with arbitrary content under other conversations' folders. Fix: constrain upload paths to `{business_id}/{conversation_id}/` with an EXISTS check on the conversation (same pattern as HI-3), and state that mime/extension enforcement is client-side only (acceptable if stated).

### ME-7. `storage.foldername(name)[1]` and the EXISTS-subquery storage policies: performance hazard unexamined, and no in-repo precedent.
**§2.6.** Verified: no migration in this repo uses `storage.foldername` (the only storage policies are simple bucket_id checks on the public `invoice-assets` bucket). Storage RLS policies evaluate per object per request; the plan's SELECT policy runs `EXISTS (channel_accounts WHERE business_id::text = foldername...)` with **no index support on the expression** and a cast — for a 50-object gallery page that's 50 subselects. Works at this scale, but v2 presents it as precedent-following when it is new territory. Fix: add the standard `(storage.foldername(name))[1] = business_id::text` fast-path pre-filter before the EXISTS; state expected volumes; smoke-test in Phase 2.

### ME-8. HUMAN_AGENT window arithmetic is wrong in the decision matrix: `last_customer_message_at + 7d` ignores that HUMAN_AGENT can only be sent within 7 days **after the user's last message** — but only if the page also has HUMAN_AGENT Advanced Access and the message is human-support; the matrix omits the eligibility nuance and the permission flow.
**§5.2.** The matrix row "HUMAN_AGENT: `now() < last_customer_message_at + 7d`" is the right core rule, but §4.5 says "requires `inbox.send_tagged`" (our permission) while omitting that HUMAN_AGENT requires **Meta Advanced Access approval** on the app — a Phase 0 review item not listed in §14's permission set (§14 lists `pages_messaging` etc. only). If HUMAN_AGENT is not approved, tagged sends fail with a permission error in live mode. Fix: add HUMAN_AGENT (and any tag) usage to the Phase 0 review submission list; add a capability check (app metadata / trial behavior) to the spike.

### ME-9. `orders` table has no `business_id` — the audience builder's "min_orders / has_ordered" filters and §7.4's "order count and LTV aggregated from business-scoped orders" have no business-scoped orders source to aggregate from.
**§10.1, §7.4, §2.5.3(a).** Verified: `orders` carries only `store_id` (20260407071618), is business-scoped only indirectly via `selling_points.woo_store_id` (Woo channels), and the orders page does not business-scope queries. §2.5.3(a)'s trigger resolves business via `selling_points WHERE woo_store_id = NEW.store_id` — which misses: (1) orders with `store_id IS NULL` (inbox-created orders, POS), (2) multi-brand businesses with several Woo stores (no wait — `LIMIT 1` picks an arbitrary business if a store maps ambiguously; today `selling_points` has no UNIQUE on `(type, woo_store_id)` — verified), (3) any storefront/POS channel order. The audience filter "min_orders" and CustomerProfileCard order count would aggregate **cross-tenant** unless they join through `selling_points`, which only covers Woo. Fix: state the order→business resolution table explicitly (orders→store_id→selling_points for Woo; conversation_orders→conversation for inbox orders; storefront/POS orders → undefined until orders get a business_id — or add `orders.business_id` in this project's migrations, which §17.3's "never drop" policy permits as an additive column with a backfill trigger). At minimum, define audience "min_orders" as counting orders via conversation_orders + selling_points only and label storefront/POS orders out of scope for Phase 7.

### ME-10. Campaign audience SQL for subscriptions: `notification_subscriptions` is keyed by (channel_account, token) with conversation FK — the eligibility query (§10.3) matches "subscription active for the campaign's topic" but campaigns don't carry a topic, only `saved_message_id`.
**§10.3, §2.2.10, §10.4.** `bulk_campaigns` has no `topic` column; §10.3's `subscription active for the campaign's topic` implies the campaign topic comes from... the saved message's category? Undefined. §10.1 offers "active notification subscription (per topic)" as an audience filter, but the join key from campaign→topic is never defined. Fix: add `topic` to `bulk_campaigns` (or define it as a property of the opt-in saved message the campaign references), and define the recipient-build JOIN: subscriptions with `status='active' AND (expires_at IS NULL OR expires_at > now()) AND topic = campaign.topic AND channel_account_id = campaign.channel_account_id`.

### ME-11. `first_agent_response_at` analytics: MV formula `AVG(c.first_agent_response_at - c.created_at)` counts conversations with zero agent responses as NULL — fine — but conversations created by **outbound** campaigns (no customer message yet, `last_customer_message_at NULL`) have a `first_agent_response_at` set by the *campaign* message while `created_at` is campaign time → first-response-time ≈ 0, skewing the metric.
**§11.1, §2.5.1.** The trigger sets `first_agent_response_at` on any outbound agent-sender message, including bulk campaign sends routed through `messages` rows. Fix: either the trigger excludes `sender_type='bot'`/campaign-originated rows (distinguishable via outbox `campaign_id` → `messages.metadata`), or the MV filters `WHERE c.last_customer_message_at IS NOT NULL`.

### ME-12. Attachment download inside the webhook vs the 20-second response budget: §5.5 downloads at webhook time, but §16.1 requires response < 20s — a batch of image messages with slow CDN fetches will breach it; the "non-blocking failure" path (§5.5 failure handling) covers download *failure*, not download *latency*.
**§5.5, §16.1, Phase 9.** Phase 9 mentions "enqueue-then-process for heavy entries" as hardening, but §4.4's pipeline step 6 ("Persist attachments to Storage") sits on the critical path for every inbound media message. Meta retries non-200s and disables endpoints with sustained failures — the budget must be engineered in Phase 2, not Phase 9. Fix: make attachment persistence explicitly asynchronous from day one (insert message immediately with `download_pending` flag — the §5.5 failure path already defines the schema — and let the sweep perform downloads; only the *message insert* is on the critical path).

### ME-13. Opt-out enforcement gap for opt-in keyword detection: §10.5 detects "STOP" keywords in the webhook — but nothing applies opt-outs to **interactive sends** (§5.2 decision matrix). A customer who opted out can still receive 1:1 agent replies and automation auto-replies.
**§5.2, §10.3, §10.5.** The eligibility function (§10.3) is campaign-only. `meta-send`'s matrix checks window/tag/subscription — never `messaging_opt_outs`. Meta itself doesn't enforce our DB-level opt-out for 1:1 replies (policy-wise, opt-out conventions are our responsibility). Decision needed: is opt-out campaign-only (then say so explicitly in §10.5) or all outbound (then add the check to §5.2 and the automation engine)? Fix: add the opt-out check to the §5.2 matrix for all non-tag sends, or explicitly scope opt-outs to campaigns in both sections.

### ME-14. `meta-connect-account` is listed in §18 (edge functions) and referenced in §13.1, but has **no design section** — no spec of the FB Login/OAuth flow that obtains the long-lived page token client-side.
**§18, §13.1, Phase 1 checklist.** "Manual token entry fallback: paste long-lived page token" is specified, but the primary flow (how the settings UI gets a page token — FB Login JS SDK? OAuth redirect through an edge function? which permissions? exchange short→long→page token where?) is unspecified. Token exchange requires the app secret or a long-lived user token — doing it in an edge function means the **app secret** (or user token) crosses the client briefly, or the edge function performs the exchange server-side; the plan never says. Fix: a short §4.7 specifying: OAuth URL construction, redirect handling, short-lived→long-lived exchange (server-side in `meta-connect-account` with app secret from env), page token derivation, page selection step, and error surfaces.

### ME-15. `ALTER TYPE ... ADD VALUE` in its own migration file but v2 doesn't state that **policies referencing new enum values in the same migration file will fail** if enum and policy ship together — `'inbox.send_messages'::app_permission` casts in Migration C's RLS policies require the enum values committed first.
**§2.1, §2.3, Phase 1 Migration A/C split.** v2 correctly splits the ALTER TYPE into Migration A and tables/policies into Migration C. But supabase migration runs each file in its own transaction: fine. The residual risk v2 leaves unstated: **if the migration tool applies files in lexicographic order in a single transaction (or if files get merged), ADD VALUE + usage in one transaction fails** ("unsafe use of new value"). The plan's split is right; the plan should add a hard note: "Migration A must never be merged with C; the `IF NOT EXISTS` guard does NOT make ADD VALUE safe inside a transaction with subsequent casts." Minor but it's exactly the kind of silent merge a refactor does.

### ME-16. Cost estimate: "sweep 2.9K/day" at 30-second pg_cron = 2,880 invocations — correct — but pg_net HTTP calls per sweep plus webhook non-blocking sweep fires **per inbound message** (§1.5 step 5) add an uncounted invocation per message (~5-10K/day more).
**§17.1 vs §1.5.** The non-blocking sweep trigger is a second edge-function invocation for every automation-eligible inbound message; §17.1 counts only "webhook invocations" + "sends" + sweep cron. Understates by up to ~50% at automation-heavy businesses. Fix: recount including per-message sweep fires, or fire the sweep only when outbox rows were actually inserted (§1.5 already says "after inserting any outbox rows" — make that the sole trigger and say so in §17.1).

---

## 4. LOW ISSUES

### LO-1. Webhook entry loop `.or()` filter with a text ID: `page_id.eq.${recipientId}` string interpolation is safe only if recipientId is numeric — a crafted `entry.id` containing commas/dots breaks the PostgREST `.or()` syntax or matches unintended rows.
**§4.3 step 3.** PostgREST `.or()` builds a query string; a malicious payload (post-signature-verification, so from Meta or a leaked-secret attacker) with crafted `entry.id` could inject filter syntax. Fix: validate `recipientId` is numeric (`/^\d+$/`) before the query; use two typed queries (one per platform) instead of `.or()`.

### LO-2. `order_sources` 'fb/ig' row does not exist — foundation line 516 *looks it up* (may yield NULL) and no migration seeds it.
**§6.1 prefill example (`sourceId: <fb/ig order_source id>`), preamble table.** Verified: the only `order_sources` seed inserts `online, pos, phone, social, wholesale` (20260415165743); foundation line 516 is a SELECT that tolerates absence. The prefill flow's example value is unobtainable until a Phase 4 migration seeds an 'fb/ig' (or 'social' is reused — it exists). Fix: seed the row in the Phase 1 or 4 migration, or use the existing 'social' source name.

### LO-3. `conversation_viewers` FOR ALL policy with `USING (user_id = auth.uid())` allows any authenticated user to **insert viewer rows for arbitrary conversations** (they own the row) — harmless data-wise but pollutes collision detection across tenants (Business A agent can make Business B agents see "X is viewing").
**§2.3.** The WITH CHECK doesn't assert the conversation's business. Fix: add the EXISTS-conversation-business check to the INSERT (UPDATE/DELETE of own rows is fine).

### LO-4. `messaging_opt_outs` has no UPDATE policy — `quota_remaining`... actually that's subscriptions. Opt-out rows: agents can insert (senders) and managers can delete, but there's no way to *view* opt-outs except member-read (fine) — and the opt-out keyword detection (§10.5) runs in the webhook as service role (fine). No issue beyond noting the DELETE-only lifecycle means a mistaken opt-out must be deleted, not toggled — acceptable; not a defect. Withdrawn — listed only to record it was checked.

### LO-5. `messages_archive` DDL: `CREATE TABLE ... (LIKE ... INCLUDING DEFAULTS)` does **not** include indexes, constraints, or the generated column `window_expires_at`... actually `messages` has no generated column — correct — but LIKE also drops nothing here; however `LIKE ... INCLUDING DEFAULTS` won't copy CHECK constraints (`delivery_status` CHECK) or the `platform_message_id` UNIQUE. Search over archived text then hits no FTS index and no constraints. Fix: state explicitly that the archive is constraint-free by design and add `(LIKE messages INCLUDING ALL)` minus FKs, or hand-write the archive DDL. Minor.

### LO-6. `idx_messages_delivery_pending` on `messages(platform_message_id) WHERE direction='outbound' AND delivery_status='sent'` — delivery webhook updates flip rows out of the partial index (fine), but the **UNIQUE(platform_message_id)** on messages makes `meta-send`'s insert of the outbound row require the mid — which arrives only after the Graph call succeeds; retry after a network timeout (send succeeded at Meta but response lost) inserts a **second outbound message row**? No — on retry the send is attempted again at Meta (duplicate customer message), because no idempotency key is passed to the Graph API. Meta's Send API supports `messaging_type` + no client-supplied dedup id for normal sends; duplicates on timeout-retry are a real edge. Fix: on Graph timeout errors specifically, mark the row `failed` with a distinct error code and surface "possibly sent — verify in thread" instead of auto-retrying (auto-retry of 5xx-but-unknown outcomes duplicates).

### LO-7. `useConversations` keyset uses `.lt('last_message_at', pageParam)` — two conversations with identical timestamps skip one (keyset must be `(last_message_at, id)` tuple).
**§3.3.** Fix: order by both, paginate on the tuple (standard).

### LO-8. `conversation_tags` GIN index exists, but the plan's filter UI (§10.1 audience, conversation filter) never specifies array-contains queries — minor mismatch between index and query shapes; fine.

### LO-9. Phase 0 "dev-mode … ~100 roles" — Meta development-mode limits describe app-role users (admin/developer/tester/tester); also **Instagram testers must also follow/interact with the IG professional account**, and Messenger testers must have a page role in some configurations — the tester-strategy checklist should include "each tester messages the page from their personal account" plus "IG tester must be able to DM the professional account (must follow it first)".
**§14 Phase 0.** Fix: add these mechanics to the Phase 0 checklist.

### LO-10. `agent_presence_log` retention "purge > 90 days" (§17.5) vs §9.4's "90-day retention" — consistent; but the presence table has no UPDATE policy and the "ended_at" close-out path is unspecified (who writes `ended_at` when a tab closes?). Heartbeat cleanup deletes `conversation_viewers`; presence rows need an equivalent sweep to close dangling intervals. Minor: specify the presence-close sweep in §17.5.

### LO-11. Campaign counters update per send (§10.4 step 3) — concurrent counter increments across a 10-20 promise pool should be `sent_count = sent_count + 1` per-statement (atomic), not read-modify-write in the engine; plan should pin that (same class as H5, trivially avoided). Also `total_recipients` is set at build time and `skipped` re-checks happen at send time — `skipped_count` updates need the same atomicity note.

### LO-12. §3.7 search: `websearch_to_tsquery` against a GIN index on `to_tsvector('english', content)` — good — but the RPC returning "highlighted snippets" needs `ts_headline`, which is expensive over large result sets; plan should cap results (e.g. LIMIT 50 conversations) — currently uncapped.

### LO-13. §16.3 "Assign vs transfer race: optimistic `updated_at` check" — the conversation UPDATE policy doesn't include any optimistic-concurrency mechanism and supabase-js would need `.eq('updated_at', priorValue)` per-update; the plan never shows this. Either spec the stale-check or drop the claim.

### LO-14. A1 fix alters `customer_aliases` CHECK — but the *unique index* `uq_customer_alias_value (customer_id, type, lower(value))` means a PSID alias for customer X plus a *second* PSID for the same customer (customer gives a new PSID after re-install) inserts a new row — fine — however the webhook alias lookup (§7.1 step 1) `lower(value) = lower(senderId)` can then match **two different customers** if the same platform ID was somehow attached to two customers (e.g. phone-merge race before aliases migrate — §7.2's merge window). `LIMIT 1`-less lookup returning multiple rows → `maybeSingle()` throws. Fix: `merge_chat_customers` must delete/move aliases transactionally, and the webhook lookup should use `.limit(2)` + explicit conflict handling rather than maybeSingle.

---

## 5. Verification Table — Cycle-1 Issues

| ID | Verdict | Justification |
|---|---|---|
| C1 | **FIXED** | `bulk_campaign_recipients` now carries `business_id` + `channel_account_id` (§2.2.11); DO-block list matches; code path backfills both (§10.4 step 2) |
| C2 | **PARTIALLY FIXED** | Template system correctly removed; within-24h campaigns + tags + subscriptions redesign is sound — but the RN/OTN opt-in mechanism itself is factually wrong (HI-1) and campaign↔topic linkage undefined (ME-10) |
| C3 | **FIXED** | App-level secret in env; verify-first pipeline with exact code; `object` routing; per-row `app_secret` deleted (§4.3, §2.2.1) |
| C4 | **NOT FIXED** | The vault+SECURITY DEFINER design is the right shape, but as written it fails at runtime: pgcrypto functions unresolvable under `search_path = public, vault` (CR-1) — Migration C aborts |
| C5 | **FIXED** | Phase 0 with 3-week review track, screencasts, Advanced Access, dev-mode tester strategy, review gate (§14) — minor tester-mechanics gaps (LO-9) |
| H1 | **FIXED** | `UNIQUE (business_id, customer_id, tag)` + `(business_id, tag)` index (§2.2.6); global-customers fact verified |
| H2 | **FIXED** | `delivery_status/delivered_at/customer_read_at` on messages + partial pending index + event→status mapping (§2.2.3, §4.4) |
| H3 | **FIXED** | Webhook-time download to Storage, signed URLs on read, agent upload path, attachment_id reuse, size gates (§5.5, §2.6) — latency placement criticized in ME-12 |
| H4 | **FIXED** | Outbox-first with atomic claim + 30s pg_cron sweep; pg_notify gone; latency budgets stated (§1.5, §5.6) — sweep claim SQL itself unspecified (ME-1) |
| H5 | **FIXED** | Single-statement atomic bucket RPC + honest 5-20/30-100/sec figures (§5.3) |
| H6 | **PARTIALLY FIXED** | Prefill prop spec exists, but source seeding is wrong-typed (name vs id), normalizePhone helper doesn't exist, `onCreated` can't return the created order, and "dialog untouched" scoping claim is false (HI-2) |
| H7 | **FIXED** | Per-class write policies in final shape via verified `has_permission()`; viewer member read-only is real (§2.3) — residual cross-tenant FK hole is new (HI-3) |
| H8 | **FIXED** | Ownership assertion inside SECURITY DEFINER body (§2.5.2) |
| H9 | **FIXED** | `platform_timestamp` basis, generated `window_expires_at`, NULL=closed defined, HUMAN_AGENT 7d (§2.2.2/§4.5) — new GREATEST-guard gap (ME-4) |
| H10 | **FIXED** | `(channel_account_id, platform_recipient_id)` UNIQUE upsert key; group chats out of scope (§2.2.2) |
| H11 | **FIXED** | Alias-first resolution only; phone merge moved to order creation with explicit RPC (§7.1/§7.2) — dependent on HI-2's broken callback chain |
| M1 | **FIXED** | Install task in Phase 2 checklist; absence re-verified (§3.4) |
| M2 | **FIXED** | Correct path/lines cited (preamble) |
| M3 | **FIXED** | Version pinned at Phase 0 from env constant + upgrade policy (§5.0) |
| M4 | **FIXED** | Token facts corrected; probe replaces refresh cron (§5.4) |
| M5 | **FIXED** | RLS enabled, no policies, service-role-only grants (§2.2.13) |
| M6 | **FIXED** | Complete storage policies per operation (§2.6) — new concerns ME-6/ME-7 |
| M7 | **FIXED** | Generic template on both platforms (§4.6) |
| M8 | **FIXED** | ~500 Pro figure; INSERT-only on messages (§1.4) — new contradiction ME-2 |
| M9 | **FIXED** | Profile fetch first-message-only, fallback names, avatar persisted (§7.1, §5.7) |
| M10 | **FIXED** | Breakpoint strategy with vaul drawer (§3.1.1); vaul re-verified in deps |
| M11 | **FIXED** | Empty/loading/failure states, keyset pagination, search component + FTS RPC (§3.6, §3.7) — keyset tuple nit LO-7 |
| M12 | **FIXED** | Two triggers + badge surfacing (§2.5.3) — trigger (a) has a resolution gap (ME-9) |
| M13 | **FIXED** | Retention jobs + 12-month archive table (§17.5) — archive DDL nit LO-5 |
| M14 | **FIXED** | NULL=global opt-out with partial unique indexes; per-platform recipient rows (§2.2.15, §2.2.11) |
| M15 | **FIXED** | Immediate CSAT on resolution + in-thread fallback (§11.3) |
| M16 | **FIXED** | `UNIQUE (webhook_verify_token)` (§2.2.1) |
| M17 | **FIXED** | Column deleted; env/vault only (§2.2.1, §4.3) |
| M18 | **FIXED** | `meta_webhook_events` defined, service-role-only, 30-day purge (§2.2.14) |
| L1 | **FIXED** | Encoding difference called out (§1.2, §5.3, §15.2) |
| L2 | **FIXED** | `GENERATED ALWAYS AS ... STORED` (§2.2.2) |
| L3 | **FIXED** | Partial FTS index `WHERE content_type='text'` (§2.4) |
| L4 | **FIXED** | Explicit `updated_at` set removed (§2.5.1) |
| L5 | **FIXED** | "managed PostgreSQL 15.x" (header) |
| L6 | **FIXED** | Handover row rewritten (§16.4) |
| L7 | **FIXED** | Retry schedule unstated; 20s contract kept (§16.1) |
| L8 | **FIXED** | Caller-supplied data documented (§15.1) |
| L9 | **FIXED** | Free-text constants module (§13.4) |
| L10 | **FIXED** | 10-20K/day webhook invocations (§17.1) — recount nit ME-16 |

**Summary of cycle-1 verification:** 43 FIXED, 2 PARTIALLY FIXED (C2, H6), 1 NOT FIXED (C4). v2's self-reported A1/A2 were also verified as correctly fixed (A1: CHECK extension + lookup index — correct; A2: `first_agent_response_at` column added and trigger-populated — correct, with a new analytics skew noted in ME-11). Total: 44 cycle-1 issues + A1/A2 = 46 tracked; 43 fixed.

---

## 6. Issue Count (cycle 2)

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 1 | CR-1 |
| HIGH | 3 | HI-1, HI-2, HI-3 |
| MEDIUM | 16 | ME-1 … ME-16 |
| LOW | 13 | LO-1, LO-2, LO-3, LO-5 … LO-14 (LO-4 withdrawn; 13 active) |

Notes on scope: ME-14 (connect-account flow unspecified) borders high if the manual-token fallback is deemed unacceptable for production onboarding; ME-9 (orders business-scoping) borders high if Phase 7 audience filters are a launch requirement. LO-4 was withdrawn during verification and is retained only as an audit record.

## 7. What v3 must do (priority order)

1. Fix the pgcrypto `search_path` (CR-1) — one line, but it currently blocks the entire migration.
2. Rewrite the RN/OTN opt-in mechanism per HI-1 and define campaign↔topic linkage (ME-10).
3. Re-spec §6.1 against the dialog's actual internals (source-name seeding, onCreated payload, catalog injection) per HI-2.
4. Add relational-consistency checks to the outbox/messages/conversation_orders/conversation_viewers policies (HI-3, ME-5, LO-3) and the meta-send re-assert.
5. Pin the sweep claim SQL (ME-1), fix the outbox realtime contradiction (ME-2) and campaign double-trigger (ME-3), add GREATEST window guards (ME-4).
6. Decide the order→business resolution strategy (ME-9) and the opt-out scope (ME-13); specify `meta-connect-account`'s OAuth exchange (ME-14).

