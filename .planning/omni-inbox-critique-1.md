# Adversarial Critique: Omni-Inbox Implementation Plan v1

**Critique date:** 2026-09-10
**Plan under review:** `.planning/omni-inbox-plan-v1.md`
**Method:** Every codebase claim was verified directly against the repository (file existence, line numbers, prop signatures, migration contents, package.json). Meta API claims were checked against platform documentation and behavior.

---

## 0. Verification Summary (what checked out)

The plan's codebase citation hygiene is unusually good. Verified accurate:

| Claim | Verdict |
|---|---|
| `AddOrderDialog.tsx` exists (claimed "1200+ lines") | ✅ 1304 lines; props `{ open, onOpenChange, onCreated }` confirmed at lines 89–93 |
| `MiniProductCatalog.tsx` exists, Fuse.js-based | ✅ 246 lines, `new Fuse(...)` at line 75 |
| `woo-webhook/index.ts` HMAC verification at lines 86–120 | ✅ Exact match (signature block spans 86–120) |
| `woo-webhook` `resolveOrCreateCustomer` at lines 550–614 | ✅ Exact match |
| Idempotency via delivery ID at lines 51–59 | ✅ Exact match |
| `20260904000100_multi_business_foundation.sql` exists with `is_business_member()`, RLS DO block at lines 333–408 | ✅ All confirmed (`has_role` defined in 20260412161413, `trigger_set_timestamp` in 20260803160000 — both exist in schema) |
| `customer_aliases` table exists | ✅ Created 20260418114108, unique index `(customer_id, type, lower(value))` |
| `invoiceHtml.ts`, `OrderBadges.tsx`, `CourierDispatchStation.tsx`, `OrderFilters.tsx`, `OrderCard.tsx`, `OrderBulkActionsBar.tsx`, `VariationModal.tsx`, `responsive-dialog.tsx`, `searchable-select.tsx`, `resizable.tsx` all exist | ✅ |
| `react-resizable-panels` "confirmed in package.json line 66" | ✅ Line 66 |
| `pathao-courier/index.ts` (1259 lines), `parse-order-text/index.ts` (240 lines) exist | ✅ |
| Fuse.js config at AddOrderDialog 455–469, AI parse at 675–752, order creation at 774–903 | ✅ All line citations accurate |
| `order_sources` has 'fb/ig' (foundation migration line 516) | ✅ Verified; `orders_source_check` constraint was dropped (20260415171221), so the value is insertable |
| pg_cron available | ✅ Extensively used (18 cron.schedule call sites across migrations), with pg_net precedent for HTTP-calling edge functions |
| Vault precedent | ✅ `vault.decrypted_secrets` reads exist in cron-triggered SQL |
| Realtime publication precedent | ✅ `20260903000500_enable_realtime.sql` adds tables to `supabase_realtime` publication |
| `selling_points` has `facebook`/`instagram` enum values | ✅ Foundation lines 133, 216 |

The plan is not lazy — but it has structural design failures, several Meta API factual errors that invalidate major sections, and one schema bug that will fail the Phase 1 migration outright.

---

## 1. CRITICAL ISSUES (production failure or launch blocker)

### C1. Phase 1 migration fails: RLS DO block references `business_id` on a table that doesn't have it

**Plan section:** 2.2 (`bulk_campaign_recipients`), 2.3 (RLS DO block)

**Evidence:** The `bulk_campaign_recipients` table (plan lines 377–388) defines columns: `id, campaign_id, customer_id, conversation_id, outbox_id, status, error_message, sent_at, created_at` — **no `business_id` column**. But the RLS DO block (plan lines 459–485) applies this to every table in its list, including `bulk_campaign_recipients`:

```sql
CREATE POLICY "Members can read %1$s" ... USING (... is_business_member(business_id))
```

`is_business_member(business_id)` on a table with no `business_id` column is a compile-time error in policy creation → the DO block aborts → **the entire Phase 1 migration fails, blocking every subsequent phase.** Every other table in the list carries `business_id`; this is the only one missed (verified by walking the plan's schema DDL table-by-table).

**Fix:** Add `business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE` to `bulk_campaign_recipients`, index it, and backfill it from `bulk_campaigns.business_id` in the recipient-creation code path (`meta-bulk-send` step 4, plan §8.3).

---

### C2. The template system is modeled on WhatsApp's API — it does not exist for Messenger/Instagram. Phase 7 as designed cannot ship.

**Plan sections:** 2.2 (`message_templates` with `category IN ('MARKETING','UTILITY','AUTHENTICATION')`), 3.5 ("Template messages (pre-approved by Meta) can be sent anytime"), 8.2 (Template Approval Flow), 1.3 (`meta-template-submit` edge function), 18

**Evidence (Meta platform fact):** The template categories MARKETING / UTILITY / AUTHENTICATION, per-template submission for approval, `platform_template_id`, and approval-status webhooks are the **WhatsApp Business API** flow. Messenger and Instagram DM have **no per-template approval system at all**. Outside the 24-hour window, Messenger supports only four **message tags** (`ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`, `HUMAN_AGENT`, `POST_PURCHASE`) passed as a `tag` field on the send payload — no pre-approval, and **no marketing tag**. Instagram supports the `HUMAN_AGENT` tag (7-day window). Sending bulk promotional messages to Messenger/IG users outside their individual 24h windows is **prohibited by Meta policy and rejected by the API** — there is no template category that unlocks it.

This invalidates, as designed:
- The `message_templates` table's category CHECK, approval status enum, and Meta-approval webhook flow (§8.2)
- The `meta-template-submit` edge function (§1.3, Phase 7)
- The core premise of §8 "Bulk Promotional Messaging": a campaign audience built from `audience_filter` will contain recipients whose last customer message is >24h old — those sends are simply not possible, tag or no tag
- §11.3 CSAT: "Wait 1 hour, send approved template message" — 1 hour after resolution, the customer's window may be expired, and a CSAT survey is not a permitted tag use outside the window
- §3.5's claim "Template messages can be sent anytime"

**Fix:** Re-scope Phase 7 to what the platform actually allows:
1. Rename `message_templates` to `saved_messages` / `message_tags` — local content library, no Meta approval workflow, no `platform_template_id`, no approval webhook.
2. Bulk campaigns must be **filtered to recipients inside their 24h window** at send time (join on `conversations.last_customer_message_at > now() - interval '24 hours'`), with the rest marked `skipped` and reported in the campaign dashboard. This is the honest version of bulk messaging on FB/IG.
3. If out-of-window proactive messaging is a hard business requirement, that is a WhatsApp channel (different product, different plan), or Meta's `CUSTOMER_FEEDBACK`/`HUMAN_AGENT` tags for their narrow permitted uses. State this explicitly to stakeholders before Phase 7 is built.
4. Add `tag` support to the outbox schema for permitted tag sends (`POST_PURCHASE` for order-status pushes from the inbox is the realistic proactive channel).

---

### C3. Webhook POST handler cannot resolve the channel account — chicken-and-egg unspecified, and `app_secret` is modeled at the wrong level

**Plan sections:** 3.3 (Signature Verification), 2.2 (`channel_accounts.app_secret`), 3.2 (GET handler)

**Evidence:** §3.3's code references `account.app_secret` — but the POST handler never defines how `account` is obtained. Meta webhook payloads do not carry your `verify_token` (that's only the GET subscription handshake). To find the account you must parse the raw body first and extract the recipient (`recipient.id` = page ID for `object: "page"`, or the IG account ID for `object: "instagram"`), then look up `channel_accounts` by `(platform, page_id/ig_account_id)`. The plan never states this, and never mentions the `object` field for FB-vs-IG routing (the same endpoint receives both).

More fundamentally: **`X-Hub-Signature-256` is signed with the Meta APP secret, which is app-level — one value for your entire developer app, shared by every page and IG account connected through it.** Storing `app_secret` per `channel_accounts` row (plan §2.2) is the wrong model: it duplicates app-level config per row, invites drift, and implies per-account verification that doesn't exist. (Meta does offer a per-page `app_secret` override in the advanced security settings — but the plan doesn't mention that distinction, and the default is the app-level secret.)

**Fix:**
1. Store the app secret once: as an edge-function environment secret (`META_APP_SECRET`) or a single vault row. Drop the per-row `app_secret` column.
2. Specify the POST pipeline explicitly: read raw body → determine `object` (page/instagram) → extract `recipient.id` → look up `channel_account` (indexed on `(platform, page_id)` / `(platform, ig_account_id)`) → verify HMAC against app-level secret → process. Parsing before verifying is the standard Meta pattern (the signature covers the raw body, so parse-then-verify is safe).
3. Add the `object` field routing to §3.4.
4. If a business ever connects through a different Meta app (per-app secrets), handle it then — a single-app assumption should be stated, not silently implied by wrong column modeling.

---

### C4. Page access tokens cannot be decrypted by `meta-send` as designed — the encryption plan is a psql-only pattern

**Plan sections:** 3.7 (Token Management), 13.1 (Token Encryption)

**Evidence:** §3.7 shows:
```sql
SELECT pgp_sym_decrypt(access_token_encrypted::bytea, current_setting('app.encryption_key'))
```
and §13.1 shows a trigger reading `vault.decrypted_secrets`. Three failures:

1. **`current_setting()` is unusable from edge functions.** Edge functions talk to Postgres via PostgREST (supabase-js with the service key). There is no mechanism to `SET app.encryption_key` on a PostgREST session — the GUC will never be set, and every decrypt call returns NULL or errors. This snippet works in psql and nowhere else.
2. **The trigger won't fire successfully.** `encrypt_channel_token()` is not `SECURITY DEFINER`. Rows are inserted by the edge function via PostgREST as `service_role`. The vault objects (`vault.decrypted_secrets`) are readable by the `postgres` role by default — the repo's own vault reads all occur inside `SECURITY DEFINER` functions invoked by pg_cron as postgres (verified in migrations 20260623184244, 20260802065715, 20260901000000). A plain trigger executing as `service_role` will hit a permission denied on `vault.decrypted_secrets` → **every channel-account insert fails**.
3. **No decrypt path is specified for `meta-send`.** The function needs the plaintext token to call the Graph API. Nothing in the plan defines the RPC that performs the decryption.

**Fix:**
1. Make the trigger function `SECURITY DEFINER` (owner `postgres`), so it reads the vault key regardless of the inserting role.
2. Create a companion `SECURITY DEFINER` function `get_channel_access_token(p_channel_account_id uuid) RETURNS text` that reads the vault key and returns `pgp_sym_decrypt(...)`. Grant `EXECUTE` to `service_role`. `meta-send` calls this RPC; it never touches the vault or the key directly.
3. Drop the `current_setting('app.encryption_key')` pattern entirely — the Vault IS the key store; there's no need for a second GUC indirection.
4. Note the trigger double-encryption hazard: if a token is ever written already-encrypted, it gets re-encrypted. Add a sentinel or document that inserts must always pass plaintext.

---

### C5. Meta App Review and business verification are absent from the plan — production launch is blocked for weeks without them

**Plan sections:** 3.1 (App Setup), 14 (Phases)

**Evidence:** §3.1 lists "Request permissions: pages_messaging, instagram_basic, instagram_manage_messages, pages_show_list" as a setup checkbox. But `pages_messaging` and `instagram_manage_messages` require **App Review with business verification** for standard access. Until review passes, the app is in Development Mode and webhooks/API sends only work for users with a role on the app (admin/developer/tester) — **real customers' messages will never arrive, and real sends will fail**. Phases 2 through 8 all assume live traffic. There is no phase, task, or timeline entry for review (screencasts, permission justifications, business doc verification), which routinely takes 1–5 weeks and can involve rejections and resubmission.

**Fix:** Add a Phase 0 / parallel track starting Week 1: submit the app for review with prepared screencasts of the inbox flows (built against dev-mode tester data), complete Business Verification, and treat review completion as a hard dependency gate for any phase that touches real customer traffic (Phase 2 onward). Add buffer to the schedule and a "dev-mode tester data" strategy for Phases 2–6 so development isn't blocked behind the review queue.

---

## 2. HIGH ISSUES (significant rework or technical debt)

### H1. `customer_tags UNIQUE(customer_id, tag)` is missing `business_id` — and `customers` is a verified global table

**Plan section:** 2.2, 7.3

**Evidence:** The plan's schema has `UNIQUE (customer_id, tag)` (§2.2) while §7.3 states "Tags are business-scoped (different businesses can have different tag taxonomies)." Verified in the codebase: the `customers` table (**migrations 20260407071618:55–68**) has **no `business_id`** — only nullable `store_id` — and the entire customer-resolution strategy (woo-webhook's global phone lookup, which this plan deliberately inherits per §7.1–7.2) **creates shared customer records across businesses**. So when Business A tags shared customer X as "vip" and Business B also wants customer X tagged "vip" for its own taxonomy, the second insert violates the unique constraint. The text and the schema directly contradict each other.

**Fix:** `UNIQUE (business_id, customer_id, tag)`. The `business_id` column already exists on the table — only the constraint is wrong. Also add `business_id` to `idx_customer_tags_tag` (or make it `(business_id, tag)`) so tag-filtered audience queries (§8.1) don't cross tenants.

---

### H2. Outbound delivery/read status has no schema, but Phase 2 subscribes to `message_deliveries` and `message_reads`

**Plan sections:** 2.2 (`messages`), 3.1 (event list), Phase 2 ("Full event parsing (messages, postbacks, deliveries, reads)"), 1.5 (step 6 "Update message delivery status")

**Evidence:** The `messages` table has `is_read` / `read_at` — but those describe **the agent reading inbound messages** (set by `mark_conversation_read`, §2.5). §1.5 step 6 says "Update message delivery status" and Meta's `message_deliveries`/`message_reads` webhooks report **the customer receiving/reading the page's outbound messages** — a completely different fact with no column to store it. There is no `delivery_status`, no `delivered_at`, no `customer_read_at`, and the `outbox_status` enum's terminal states (`sent`) can't represent delivered/read either.

**Fix:** Add to `messages` (or keep on `message_outbox` and copy through): `delivery_status text CHECK (delivery_status IN ('sent','delivered','read','failed'))`, `delivered_at timestamptz`, `customer_read_at timestamptz`. Must land in the Phase 1 migration — adding it later means webhook events arrive with nowhere to go and a Phase 2+ schema rework.

---

### H3. Inbound attachment URLs expire — nothing persists them; agent attachment upload is unspecified beyond invoices

**Plan sections:** 2.2 (`attachments jsonb [{url, type, size, storage_path}]`), 4.2 (`ComposerBar` "attachment upload"), 6.2 (invoice upload only)

**Evidence:** Meta's CDN URLs for Messenger/IG attachments are **temporary and require the page access token to fetch** — a thread rendered 6 months later shows broken images if you stored Meta's URL. The schema's `attachments` shape hints at `storage_path` but no pipeline in §3.4 or Phase 2 downloads the attachment at webhook time. Separately, the only agent-upload path described anywhere is invoices (§6.2); `ComposerBar`'s attachment flow (image/file send, size validation is mentioned in §16.2 but not the upload/storage/URL-generation flow) is never designed. Meta's Send API also requires attachment **attachment_id reuse or a publicly accessible URL** for outbound files — edge-hosted Storage public URLs or re-upload patterns are not addressed.

**Fix:** At webhook time (for each inbound attachment): fetch the Meta URL with the page token → upload to `inbox-attachments/{business_id}/{conversation_id}/` → store `storage_path` + signed-URL generation on read; keep Meta's URL in `metadata` for debugging. For agent uploads: upload to the same bucket from `ComposerBar`, then either pass the public/signed URL to Meta's Send API or use `attachment_id` reuse. Specify the bucket policies (see M6).

---

### H4. Outbox trigger mechanism is self-contradictory: `pg_notify` is impossible for edge functions, and Phase 2 contradicts §1.5

**Plan sections:** 1.5 (step 2: "meta-send polls **or** is triggered via pg_notify"), 4.3/Phase 2 ("ComposerBar with text send **via meta-send edge function**"), 10.1 (automation inserts into outbox)

**Evidence:** Three unresolved ambiguities:
1. **Edge functions cannot `LISTEN` on Postgres channels.** They are short-lived HTTP-invoked isolates with no persistent Postgres connection — `pg_notify` has no consumer in this architecture. The mention is a technical impossibility (verified: no edge function in this repo uses LISTEN/pg_notify).
2. §1.5 says sends go outbox-first ("Agent clicks send → insert row into message_outbox with status pending"), but Phase 2 has `ComposerBar` invoking `meta-send` directly. Which is it? If outbox-first, the UI insert path and the trigger for processing are undefined (and per-send latency includes a poll interval — unspecified). If direct-invoke, the outbox is written by `meta-send` itself and §1.5 step 1 is wrong.
3. Automation auto-replies (§10.1) insert into the outbox from the webhook with **no processor**: who picks those rows up, and with what latency? pg_cron's practical minimum granularity in this repo is tens of seconds (verified existing schedules), which is fine for retries but means auto-replies ("price" keyword → instant answer) silently sit queued.

**Fix:** Pick one architecture and write it down: (a) Client inserts outbox row via supabase-js (RLS-valid) → client invokes `meta-send?outbox_id=...` → function claims the row (status `sending`), processes, updates; (b) pg_cron + pg_net sweep every 10–30s as the retry/auto-reply processor (repo has exact precedent: cron schedules calling edge functions with `x-cron-secret` headers — verified in 20260802065715 and 20260830000500). Drop `pg_notify` entirely. State the auto-reply latency budget.

---

### H5. Token bucket has a read-modify-write race across isolates, and the DB roundtrip caps throughput far below the claimed rate

**Plan sections:** 3.8, 8.3 (step 6: "200/sec per channel_account"), 16.2

**Evidence:** "Before each send, decrement" — `meta-send` invocations are separate isolates with no shared memory. A naive read (`tokens_remaining`), decrement, write from two concurrent invocations loses updates (both read 250, both write 249 → limit bypassed). The refill computation ("Refill 250 tokens per second") as described is similarly racy. Worse for throughput: one atomic UPDATE + one Graph API call per message means each send costs a DB roundtrip (~5–50 ms) plus Meta latency (~100–300 ms) — a single-instance loop realistically sustains **5–20 sends/sec**, not 200/sec. The "200/sec to leave headroom" bulk claim (§8.3) is unexamined arithmetic.

**Fix:** Make the bucket atomic in one statement: `UPDATE rate_limit_buckets SET tokens_remaining = LEAST(250, tokens_remaining + floor(extract(epoch from (now() - last_refill_at)) * 250) - 1), last_refill_at = now() WHERE channel_account_id = $1 AND <computed tokens> >= 1 RETURNING tokens_remaining` — refill and decrement in one atomic UPDATE, no lost updates. For bulk throughput, run bounded concurrency inside `meta-bulk-send` (e.g., Promise pool of 10–20 in-flight Graph calls, each holding one atomic token) and re-derive the realistic achievable rate from measured latencies; at target scale (500 convos/day) this is more than adequate, but state it.

---

### H6. "Direct reuse, import as-is" of `AddOrderDialog` is false — no prefill capability exists, and the dialog has no business scoping

**Plan sections:** 5.1, 15.1 ("Accepts `open`, `onOpenChange`, `onCreated` props. Pre-fill customer from conversation context"), 4.2 (`OrderLinker`)

**Evidence (verified):** `AddOrderDialog`'s `Props` interface is exactly `{ open, onOpenChange, onCreated }` (lines 89–93). There is **no prop to pre-fill a customer** — the dialog's `handleCreate` resolves the customer by looking up the typed phone number (line 782). There is no prop to pre-select the order source either; the source comes from the dialog's own selector over `order_sources`. §5.1's "Open AddOrderDialog with customer fields pre-filled" therefore requires **modifying the component** (new optional props like `initialCustomerPhone`/`initialCustomerName`/`initialSourceId` + a `useEffect` to seed state) — contradicting §15.1's "Import as-is / Direct Reuse" framing. Additionally, the dialog fetches products/stores with no business filter (the legacy `customers`/`products`/`orders` tables carry permissive `USING (true)` RLS — verified in migration 20260407071618), so an agent of Business A creating an order from the inbox can select Business B's products/stores. The plan inherits this blind.

**Fix:** Budget a modification task (new optional prefill props — backwards-compatible) instead of claiming as-is reuse, and scope product/store/customer queries in the dialog by the active business (via `selling_points.business_id` — the verified mechanism the foundation migration uses to business-scope legacy orders). Alternatively, keep the dialog untouched and have the inbox pass phone via a controlled wrapper that seeds the phone field through the DOM-level API only if a prefill prop is added — but pick one and write it down.

---

### H7. The fine-grained role policies are unimplementable as described — permissive RLS OR-semantics make "additional restrictive policy" a dead end

**Plan sections:** 2.3 ("Agents with `staff` role can only see conversations where assigned... enforced via an additional restrictive policy **or** at the application level"; "viewer role can SELECT only")

**Evidence:** Postgres RLS policies are **permissive by default**: multiple permissive policies OR together. The blanket "Members can write" `FOR ALL` policy (§2.3 DO block) grants every business member — including `viewer` — full write on all 14 tables. You cannot add a second policy that *removes* access; only `AS RESTRICTIVE` policies AND against permissive ones, and mixing permissive+restrictive for this pattern requires rewriting the blanket policy set. So "we'll add the viewer/staff restriction later" doesn't work — the base policies must be written per-role from day one. The fallback ("application level with TanStack Query filters") is cosmetic: any authenticated member can query `conversations` directly via supabase-js and read every business's conversations server-side (staff scoping via app filters = no server enforcement at all).

**Fix:** In the Phase 1 migration, write the policies in their final shape: read policies for all members; write policies gated on the new `inbox.*` permissions via a `has_permission()`-style check or role check (e.g., `has_role(auth.uid(),'admin') OR (is_business_member(business_id) AND <sender permission check>)`); staff-visibility scoping (assigned-or-unassigned) either as a restrictive policy pair or — simpler and consistent with this codebase — accept that all members see all conversations of their business (that's what the existing foundation pattern does for orders) and drop the assigned-only claim from the plan.

---

### H8. `mark_conversation_read` is a SECURITY DEFINER hole — any authenticated user can mutate any business's conversations

**Plan sections:** 2.5

**Evidence:** The function is `SECURITY DEFINER` (bypasses RLS) with **no membership check inside the body**. Any authenticated user from any business calls it with any conversation UUID and resets `unread_count` / marks messages read. The plan's own RLS model (§2.3) exists precisely to prevent this, and then §2.5 pierces it with an unchecked definer function.

**Fix:** Add an ownership assertion inside the body: `IF NOT (has_role(auth.uid(),'admin'::app_role) OR is_business_member((SELECT business_id FROM conversations WHERE id = p_conversation_id))) THEN RAISE EXCEPTION 'forbidden'; END IF;` — or make it a normal (non-definer) function so RLS applies on the UPDATEs. Also decide who "reads" a conversation when multiple agents view it (currently any viewer zeroes the count for everyone — see also collision detection §9.5).

---

### H9. 24h window bookkeeping uses insert-time `now()` instead of Meta's event timestamps, NULL window is undefined, and the `HUMAN_AGENT` tag is omitted

**Plan sections:** 2.2 (`last_customer_message_at`), 2.5 (trigger sets it to `NEW.created_at`), 3.5, 16.1 (Meta retries up to 24h)

**Evidence:** Three gaps:
1. `messages.created_at DEFAULT now()` and the trigger propagates it into `last_customer_message_at`. But webhook delivery can be delayed (Meta retries — the plan itself relies on retries in §16.1). If a customer's message was sent at 10:00 but our webhook processes the retry at 14:00, our window clock says the window closes at 14:00+24h while Meta's clock says 10:00+24h → **we permit a send Meta rejects** (agent-facing failure) or block prematurely on the other side. Meta's payload includes the message `timestamp` — store it (use it for `created_at` on inbound messages, or at minimum compute the window from `metadata->timestamp`).
2. A conversation initiated by an **outbound** template/tag send has `last_customer_message_at = NULL` — every window comparison (`now() - last_customer_message_at < 24h`) is NULL → the plan never defines NULL-as-outside-window. It must.
3. Messenger's `HUMAN_AGENT` tag gives a **7-day** window for human-support conversations; the plan's composer "disable + force template" UX (§3.5) is more restrictive than the platform allows and omits a genuinely useful escape hatch.

**Fix:** Use `metadata->>'timestamp'` for inbound message timing; define `NULL last_customer_message_at` = window closed; add HUMAN_AGENT tag support (with permission gating) to the composer and the window calculation.

---

### H10. `platform_conversation_id` is not well-defined — Meta webhooks have no stable conversation ID

**Plan sections:** 1.1 ("match platform_conversation_id"), 2.2 (conversations.platform_conversation_id "Meta's conversation/thread ID"), 3.4 (step 2)

**Evidence:** Messenger and IG webhook payloads provide: sender PSID/IGSID, recipient page/IG ID, message `mid`, and (sometimes) `thread_id`-adjacent fields — **there is no durable "conversation ID"** delivered with message events in the way the plan assumes. The schema's `UNIQUE (channel_account_id, platform_conversation_id)` upsert key (§2.2) and §3.4 step 2 depend on a value the platform doesn't hand you. (The prompt's instinct here is correct.)

**Fix:** Define it explicitly: `platform_conversation_id = platform_recipient_id` (the PSID/IGSID) — since `channel_account_id` already scopes the page, `(channel_account_id, psid)` is the de-facto thread identity for 1:1 Messenger/IG DM. One row per (account, customer). Document that group threads (IG group DMs, if ever supported) need a different key and are out of scope, or store Meta's thread key in `metadata` when present.

---

### H11. Webhook-time phone-based customer matching is impossible — Meta provides no phone number

**Plan sections:** 7.1 (step: "also check by phone"), 7.2 (Cross-Platform Merge: "if their phone number matches")

**Evidence:** Messenger/IG webhooks carry only the PSID/IGSID; the Messenger Profile API returns name and profile photo — **never phone or email**. §7.2's flow ("during customer resolution, also check by phone") cannot execute at webhook time; the phone-first `resolveOrCreateCustomer` pattern from woo-webhook (which the plan claims to follow "exactly") is inapplicable — its input is a Woo order payload full of PII, whereas a Meta webhook input is a bare platform ID. Phone linkage only becomes possible later, when the customer gives a phone number in chat and an agent creates an order (§5.1) — and *that* flow (update the resolved customer's phone, merge on global-phone match, per the verified global unique index `uq_customers_phone_global` from 20260418114108) is the actual cross-platform merge point.

**Fix:** Rewrite §7.1/7.2: webhook-time resolution is **alias-first only** (PSID/IGSID → customer, create with profile name or fallback). Phone-based merge happens at order-creation time from the inbox: when `AddOrderDialog` captures a phone, link the conversation's customer via global-phone lookup and attach both platform aliases. Also see M9 — `customers.name` is NOT NULL and the webhook has no name.

---

## 3. MEDIUM ISSUES (should fix, not blocking)

### M1. `@tanstack/react-virtual` is not in package.json — the plan's own hedge ("confirm in package.json") was never resolved
**Section 4.4 / Phase 2.** Verified: dependencies include `@tanstack/query-core` and `@tanstack/react-query` but **not** `@tanstack/react-virtual`. Phase 2 lists `MessageThread with @tanstack/react-virtual` with no install task. Fix: add `npm i @tanstack/react-virtual` to Phase 2's checklist (or pick a different virtualizer — but decide).

### M2. Wrong `types.ts` citation
**Section "Codebase Context Summary" / "Role system | types.ts lines 3323+".** There is no root `types.ts`. The file is `src/integrations/supabase/types.ts` (3497 lines); the `app_permission` enum values are at lines 3454–3492 and `app_role` at 3493 (line 3323 is inside the Functions section). Fix the path/line citation.

### M3. Graph API version v20.0 is past its supported life at plan time
**Section 3.6 table.** v20.0 shipped July 2024; Meta guarantees versions for ~2 years → it expires mid-2026, before the plan's own date (2026-09-10) and before Phase 2 ships. All endpoint examples use `/v20.0/`. Fix: pin to the current version at implementation time and add a one-line upgrade policy (e.g., "bump the pinned version at each phase boundary; track deprecations in Phase 9 monitoring").

### M4. "Long-lived tokens expire in 60 days" is wrong
**Section 3.7.** Long-lived **user** tokens last 60 days; **page** access tokens derived from a long-lived user token do not expire (they die on password change/revocation/deauthorization). The daily `meta-token-refresh` cron is therefore mostly a no-op — the real failure modes are user-driven revocations, which a cron can't fix (needs the reconnection flow the plan does mention). Fix the claim; keep a lightweight weekly validity probe (`GET /me?fields=id` per account) instead of a refresh cron.

### M5. `rate_limit_buckets` is absent from the RLS enablement list — writable by any authenticated user
**Sections 3.8 vs 2.3.** The DO block enumerates 14 tables; `rate_limit_buckets` isn't among them, so it ships with default schema privileges (readable/writable via PostgREST by `authenticated`). Any signed-in user could zero out tokens or spam rows. Fix: `ENABLE ROW LEVEL SECURITY` with no policies (service-role only).

### M6. Storage bucket policies for `inbox-attachments` are unspecified
**Sections 6.2, H3 above.** A bucket path convention is given but no storage-layer RLS (objects keyed `{business_id}/{conversation_id}/` need ownership policies so one tenant can't read another's attachments, and customers should never access them directly — agents share via signed URLs inside messages). Fix: specify bucket policies in the Phase 1 or 4 migration mirroring the path convention.

### M7. "Instagram: no generic templates" is wrong
**Section 3.6 table.** IG Messaging supports the generic template (that's how IG product cards/ice breakers work). The row "Product cards: FB Generic / IG Media+link" should be "generic template on both; IG media constraints differ." Minor factual fix, but it changes the `ProductQuickSend` payload design (§6.1).

### M8. Realtime claims need updating: Pro connection limit, UPDATE-event echo
**Section 1.4 ("max ~200 concurrent connections per project on Pro plan").** Supabase Pro allows ~500 concurrent Realtime connections (200 is the Free tier figure); 20 agents is comfortably within either, so the number is harmless — but the plan misses a real design issue: subscribing to `messages` for `event: '*'` means every `UPDATE` (e.g., `mark_conversation_read` flipping `is_read`) broadcasts to every subscriber of that conversation → echo/refetch churn. Fix: subscribe `INSERT`-only on messages; handle read-state via the conversations channel or a targeted refetch.

### M9. New-customer creation will fail at the NOT NULL name — the webhook payload has no name
**Sections 3.4, 7.1.** `customers.name TEXT NOT NULL` (verified in schema). A brand-new sender's webhook event has no name (profile API requires an extra fetch and `pages_messaging`/IG permissions). Fix: specify the profile-API fetch step (`GET /{psid}?fields=name,profile_pic` with page token, non-blocking, best-effort) with fallback name `Facebook User` / `Instagram User`, and update later when the profile fetch lands. Also specify avatar handling (same expiring-URL problem as H3).

### M10. No mobile/responsive strategy for the 3-panel layout
**Section 4.1.** `react-resizable-panels` with a 3-column horizontal group is a desktop pattern. The plan never states mobile behavior (stack panels? master-detail navigation? hide ContextSidebar behind a sheet — `ResponsiveDialog`/vaul exist in the codebase). Fix: one paragraph in §4.1 defining breakpoints (<md: single panel + push navigation).

### M11. Missing UX states and pagination/search UI
**Section 4 generally.** No empty states (zero conversations / nothing selected), no loading skeletons, no send-failure display in the thread (outbox `failed`/`blocked_24h` needs an inline retry affordance — §1.5 says "notify agent" only), no conversation-list pagination strategy (at 500/day, an unbounded list query with the covering index works only so long — needs keyset pagination on `last_message_at` or infinite scroll), and the FTS index (§2.4) exists with no search UI component anywhere in §4.2. Fix: add tasks for these to Phases 2 and 8.

### M12. "Mark customers if they have placed orders" — the explicit user requirement — is not implemented anywhere
**Sections 7.3, 10.2.** §7.3 lists "Order-based: When order is created/linked, auto-tag customer" as a category, but: no `order_created` trigger type exists in `automation_rules.trigger_type` (only `order_status_change`), no DB trigger on `orders` INSERT → `customer_tags` is specified, and no phase checklist contains the task. The `CustomerProfileCard` order count (§7.4) is a display-time proxy, not the requested indicator. Fix: either a tiny DB trigger (order insert → upsert tag `has_ordered` / `ordered_N_times`) or an `order_created` automation trigger type + a Phase 4/5 task; and surface it as a badge on `ConversationItem`/`CustomerProfileCard`.

### M13. No data-retention policy for the high-volume tables
**Sections 2.4, 17.** The plan predicts millions of messages but defines no purge/archival (contrast the existing precedent: `webhook_events` auto-purges at 30 days — verified in 20260802065800). `agent_presence_log` (per agent per status change) and `conversation_viewers` also grow unboundedly. Fix: add retention jobs to the Phase 9 hardening list (e.g., presence/viewers 90 days, messages archived not deleted, outbox terminal states 90 days).

### M14. Opt-out + campaign recipient semantics are ambiguous
**Sections 2.2 (`messaging_opt_outs UNIQUE(customer_id, channel_account_id)` with nullable channel; `bulk_campaign_recipients UNIQUE(campaign_id, customer_id)`).** (a) Postgres UNIQUE treats NULLs as distinct: a NULL-channel row and a per-channel row coexist — is NULL "all channels"? Not stated; the §8.3 exclusion query must define it. (b) A customer present on both FB and IG (two conversations) matches `UNIQUE(campaign_id, customer_id)` once — which conversation gets the send? Undecided, though §8.1's audience filter includes "Platform (FB/IG/both)". Fix: define NULL = global opt-out (and make the exclusion check `channel_account_id IS NULL OR channel_account_id = :acct`), and add a platform-preference rule (or per-platform recipient rows keyed `(campaign_id, customer_id, channel_account_id)`).

### M15. CSAT delivery violates the 24h window in most cases
**Section 11.3.** "Wait 1 hour" after resolution — the customer's last message may be 20+ hours old at that point, and there is no approved-category escape (see C2). Fix: send CSAT immediately upon resolution (within window in the common case), or drop to an in-thread prompt rendered only if the window is open.

### M16. `webhook_verify_token` is not UNIQUE and not indexed
**Sections 2.2, 3.2.** The GET handler does `.eq('webhook_verify_token', token).maybeSingle()` — with no unique constraint, two accounts can share a token (ambiguous `maybeSingle`) and every GET is a sequential scan (table is small, but the endpoint is unauthenticated and trivially spammable). Fix: `UNIQUE (webhook_verify_token)` (creates the index) — also gives the enumeration-resistance of a random 32+ byte token for free; consider a constant-time comparison if you ever do it in code.

### M17. `app_secret` stored plaintext while tokens get pgcrypto
**Section 2.2.** Even after C3 moves it to app level, if it stays in a table: it can forge inbound webhooks (inject fake customer messages into threads). Whatever store it lands in should get the same protection as tokens. Fix: vault/env only, never a plaintext column.

### M18. The "webhook_events equivalent" log table is never defined
**Sections 16.1, 17.2.** "Log to webhook_events equivalent" — the existing `webhook_events` (verified schema: `store_id` FK, Woo-shaped columns) doesn't fit Meta events. A `meta_webhook_events` table (channel_account_id, event_type, mid, status, payload summary, purged at 30 days per precedent) needs to be in the Phase 1 migration, not implied. Also needed for §17.2's monitoring alert thresholds to be computable.

---

## 4. LOW ISSUES (nits)

### L1. "Mirror the woo-webhook HMAC pattern **exactly**" — encoding differs
**§3.3 vs verified woo-webhook:104.** Woo compares base64 (`btoa(...)`) of the HMAC; Meta uses `sha256=` + lowercase hex. The plan's own sample is correct — just don't say "exactly."

### L2. `window_expires_at` "as a virtual column"
**§3.5.** Postgres has no virtual columns (generated columns are stored). Use `GENERATED ALWAYS AS (last_customer_message_at + interval '24 hours') STORED`, or compute it in the query layer.

### L3. FTS index over a JSON-bearing column
**§2.4.** `to_tsvector('english', content)` runs over `content` which per §2.2 is "Text body **or JSON** for structured types" — JSON syntax pollutes the index. Use a `to_tsvector(... )` expression that switches on `content_type = 'text'` (partial index `WHERE content_type = 'text'`).

### L4. Double `updated_at` write on conversation updates
**§2.5 vs §2.2.** `handle_new_message` sets `updated_at = now()` explicitly while the `BEFORE UPDATE` `set_conversations_updated_at` trigger will also fire — same value, harmless, but drop the explicit set for consistency with the codebase pattern.

### L5. "PostgreSQL 14.5" is stale
**Header.** Supabase in 2026 provisions PG15/17. Harmless, but the plan shouldn't pin a wrong version in writing.

### L6. `messaging_handovers` ≠ customer account deletion
**§16.4.** Handover events pass thread control between apps — they are not deletion notices. Account deletion generally produces no webhook (you may see send failures). Rewrite the mitigation row.

### L7. "Meta retries with exponential backoff up to 24h"
**§16.1.** Meta retries failed deliveries, but the 24h duration is not a documented figure — don't state specifics the platform doesn't publish. The 20-second response requirement is correct and the important one.

### L8. `MiniProductCatalog` is not self-sufficient — caller must supply its data
**§15.1.** Verified props: `products, categories, productCatMap, stores, onSelectProduct, onAddCustomItem` — the inbox ContextSidebar must fetch and pass the full product/category/store datasets (and in multi-business terms, which "stores" list is passed is undefined — see H6's scoping problem). Reuse is real but not free; the plan should note the data-fetch dependency.

### L9. `audit_log` entity types need extending
**§13.4.** `logAction`'s `entityType` union (verified in `src/lib/auditLog.ts`) has no inbox entity types (conversation, message, campaign, ...) — a small enum/type union extension task, unlisted.

### L10. Cost estimate inflated
**§17.1.** "~150K invocations/day (webhook)" — at 500 conversations/day × ~10–20 events per conversation (messages + deliveries + reads), 10–20K/day is the right order; 150K is off ~10x. Harmless but signals the estimates weren't derived.

---

## 5. Cross-cutting observations

1. **Phasing has a hidden dependency graph on Meta review (C5) and on the send-path decision (H4).** Phase 1's `meta-send` "basic send" cannot be tested end-to-end without a real page token, a real conversation, and (in production) app review. Build Phase 1–2 against dev-mode tester accounts and say so.
2. **The plan's reuse claims are directionally honest but oversold in three places:** AddOrderDialog prefill (H6), MiniProductCatalog data deps (L8), and "woo-webhook pattern exactly" (L1, H11). Every other citation verified clean — including all four line-number claims.
3. **The template confusion (C2) is the single largest strategic risk**: it's not just Phase 7 — it shaped the schema (`message_templates`, `template_status`, `platform_template_id`), two edge functions, the approval webhook subscription, and the CSAT flow. Fixing it early (saved-message library + window-filtered campaigns) is cheap; fixing it after Phase 6 is a rebuild.
4. **Two schema bugs (C1, H2) must be fixed before the Phase 1 migration is written at all** — one fails the migration, the other forces a re-migration later.
5. **Security posture has three small holes that each take minutes to fix but are real**: `mark_conversation_read` (H8), `rate_limit_buckets` (M5), attachment storage policies (M6).

---

## Issue Count

| Severity | Count |
|---|---|
| CRITICAL | 5 |
| HIGH | 11 |
| MEDIUM | 18 |
| LOW | 10 |
