# Adversarial Critique Cycle 3a — SQL/Schema Specialist

**Critique date:** 2026-09-11
**Plan under review:** `.planning/omni-inbox-plan-v3.md` (2866 lines)
**Scope:** Database SQL correctness only (schema, RLS, triggers, RPCs, migrations, retention DDL). UI/phasing/architecture are Critic B's.
**Method:** All SQL blocks read in full; every repo-precedent claim checked against the actual migrations (`claim_sync_queue_batch` body, foundation DO block + `is_business_member`, `customer_aliases` DDL, `order_sources` DDL + seed, `orders` DDL, `selling_points` DDL, extension conventions, `trigger_set_timestamp`). The three CRITICALs below are runtime failures of SQL the plan ships as final.

---

## 1. CRITICAL (migration/runtime failures)

### C3-1. `orders.business_id` migration placement is self-contradictory, and one of the two specified arrangements fails Migration 03 at `CREATE POLICY`.

**Plan sections:** §2.3 (lines 870–881), §2.5.3(a) (lines 1064–1075), §2.5.4 (lines 1108–1147), Phase 1 checklist (line 2506), §18 (line 2788).

The "Agents link orders" policy (line 878–880) contains `EXISTS (SELECT 1 FROM public.orders o WHERE o.id = conversation_orders.order_id AND o.business_id = conversation_orders.business_id)`, and trigger (a) `tag_customer_has_ordered_from_order` reads `NEW.business_id` (line 1067). Postgres validates the policy's subquery at `CREATE POLICY` time — a missing column is a hard parse-time error (42703), not a runtime deferral.

§18 (line 2788) puts `orders.business_id` + resolution trigger + backfill in **`202609XX06_omni_inbox_orders_business.sql`**, while the HI-3 policy and trigger live in **`202609XX03_omni_inbox_schema.sql`** (line 2785: "RLS incl. HI-3/ME-5/LO-3 consistency clauses, triggers/functions"). In that arrangement **Migration 03 aborts** on the policy referencing a column that does not exist until 06. The Phase 1 checklist (line 2506) says the opposite — "Migration C: … orders.business_id resolution + backfill" — an internal contradiction where one of the two arrangements is a guaranteed migration failure. §2.3's own comment (line 881) acknowledges the dependency ("orders.business_id is added by §2.5.4") without resolving which migration runs first.

**Fix:** Put the `ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_id …` + resolution trigger at the TOP of Migration 03 (before the policy DO blocks), or move the conversation_orders policy + trigger (a) into 06; delete the Phase-1-checklist/§18 contradiction.

### C3-2. `post_system_message` is dead on arrival: the `assert_message_sender` trigger rejects the RPC's own inserts. Every sanctioned system message throws.

**Plan sections:** §2.5.5 (lines 1153–1212), §2.3 comment (line 825–826), §6.1 step 5 (line 1969), §9.3 (line 2198).

`assert_message_sender` (lines 1158–1171) raises unless `NEW.sender_type = 'agent' AND NEW.sender_agent_id = auth.uid()` **whenever `auth.uid() IS NOT NULL`**. `post_system_message` is `SECURITY DEFINER`, `GRANT … TO authenticated` (line 2111), and inserts with `sender_type='system'` (line 1204). Supabase's `auth.uid()` reads the `request.jwt.claims` GUC — **it returns the calling user's id even inside a SECURITY DEFINER function** (role switching does not change session GUCs). So every call path is: authenticated agent → RPC → INSERT `sender_type='system'` → BEFORE INSERT trigger sees `auth.uid()` non-NULL → `RAISE EXCEPTION 'client inserts must be sender_type=''agent'''`.

Result: transfer notes (§9.3), order-confirmation notes (§6.1 step 5), order-status messages (§6.3) — the exact "sanctioned client system events" the RPC exists for (line 1174) — **all fail at runtime, 100% of the time**. The ME-5 fix's two halves defeat each other.

**Fix:** The trigger needs an escape hatch for the RPC's inserts. Options: (a) inside the trigger, allow rows where `current_user` is the function owner (`postgres`) — service-role connections (`service_role`) and SECURITY DEFINER RPCs owned by postgres both pass, direct client inserts still fail; or (b) set a trusted GUC inside `post_system_message` (e.g. `set_config('app.sanctioned_system_message','1', true)`) and check it in the trigger; or (c) have the RPC insert via a `session_replication_role` bypass. (a) or (b) are one-line changes; pick one and pin it.

### C3-3. `merge_chat_customers` UPDATEs a column that does not exist — `conversation_orders.customer_id` is not in the §2.2.5 DDL. Every merge call errors 42703.

**Plan sections:** §7.2 (lines 2037–2102), §2.2.5 (lines 430–444).

Line 2082: `UPDATE public.conversation_orders SET customer_id = NULL WHERE customer_id = p_chat_customer_id;` — §2.2.5 defines `conversation_orders` as `(id, business_id, conversation_id, order_id, linked_by, created_at, UNIQUE(conversation_id, order_id))`. **There is no `customer_id` column.** plpgsql resolves the statement's plan on first execution; the missing column raises `42703` unconditionally — even with zero matching rows. Since the statement runs on every call, **every invocation of `merge_chat_customers` fails** after passing the ownership check: the Phase 4 phone-merge flow (§6.1 step 6) is broken, aliases/conversations are NOT repointed (the failing statement aborts the transaction), and the LO-14 duplicate-alias resolution never runs. The plan's own comment (line 2083: "defensive; column not used") guards a column it never verified.

**Fix:** Delete the statement (order links key orders, not customers — the comment already says so), or add the column to §2.2.5 if it's actually wanted.

---

## 2. HIGH

### H3-1. Migration C table ordering: `message_outbox` (§2.2.4) carries FKs to `saved_messages`, `notification_subscriptions`, and `bulk_campaigns` — all defined in LATER sections (§2.2.9–§2.2.11). Following the plan's own §2.2 order, Migration C fails at `CREATE TABLE message_outbox`.

**Plan sections:** §2.2.4 (lines 407, 411, 412), §2.2.9–§2.2.11, §18 (line 2785: Migration C = "all tables (§2.2)").

`saved_message_id … REFERENCES public.saved_messages(id)` (line 407), `subscription_id … REFERENCES public.notification_subscriptions(id)` (line 411), `campaign_id … REFERENCES public.bulk_campaigns(id)` (line 412) — targets that do not exist yet if tables are created in §2.2 document order (which is the order the plan presents and the order §18 points implementers at). FK constraints are validated at CREATE TABLE time → migration aborts. Every other table in the plan is dependency-ordered correctly; this one is not, and nothing in the plan flags it.

**Fix:** State explicitly that Migration C must create tables in dependency order — move `message_outbox` after `saved_messages`/`notification_subscriptions`/`bulk_campaigns` — or drop the three FKs to not-yet-existing tables (they are nullable SET-NULL/CASCADE refs; but ordering is the cleaner fix).

### H3-2. §5.1's meta-send claim predicate excludes every fresh pending row: `.lte("next_retry_at", "now()")` filters out NULL — the interactive send path never claims, and all agent sends degrade to sweep latency (5–35s), breaking the <1s budget.

**Plan sections:** §5.1 (lines 1702–1708) vs §1.5 step 2 (line 192), §3.6 retry affordance (line 1496).

The §5.1 "exact" code claims via PostgREST: `.in("status", ["pending", "failed"]).lte("next_retry_at", "now()")` → `WHERE status IN ('pending','failed') AND next_retry_at <= now()`. A freshly inserted pending row has `next_retry_at = NULL` (§2.2.4: nullable, no default; the client inserts `status:'pending'` only — §1.5 step 1). `NULL <= now()` is NULL → **the claim matches zero rows → `if (!row) return;` — the direct invoke is a silent no-op for every interactive send.** The row then waits for the 30s sweep (`claim_outbox_batch` handles pending rows correctly via the `created_at < now() - 5s` branch). §1.5 line 192 has the correct NULL-safe predicate (`next_retry_at IS NULL OR next_retry_at <= now()`), so the plan contradicts itself on the latency-critical path; §5.1 is the code an implementer copies. The same broken predicate also makes the §3.6 Retry affordance a no-op for `failed` rows whose backoff `next_retry_at` is in the future.

**Fix:** Align §5.1 with §1.5: `.or('next_retry_at.is.null,next_retry_at.lte.now')` (PostgREST compound), and have the Retry affordance clear `next_retry_at` (or pass a force flag) before re-invoking.

### H3-3. `merge_chat_customers` never repoints `messaging_opt_outs` — a customer who opted out (STOP) and is later phone-merged silently loses suppression; `bulk_campaign_recipients` also orphaned.

**Plan sections:** §7.2 (lines 2075–2092 — the repoint list), §2.2.15 (line 730: `messaging_opt_outs.customer_id NOT NULL`), §2.2.11 (line 612: `bulk_campaign_recipients.customer_id NOT NULL`), §5.2 check 2 (line 1765).

The merge repoints aliases, conversations, notification_subscriptions, customer_tags, customer_notes — but not `messaging_opt_outs`. Opt-out rows keyed to the chat customer keep pointing at it after the chat customer is "neutralized"; the §5.2 check resolves the customer from `conversation.customer_id` → canonical → finds no opt-out row → **messages resume to a customer who explicitly said STOP** (the exact harm ME-13 was written to prevent; opt-out is a policy/compliance obligation, and the sequence — opt out in chat, then place an order with a phone number → merge — is the plan's own primary flow). Same class: `bulk_campaign_recipients.customer_id` (NOT NULL) still points at the neutralized customer, orphaning campaign history from the canonical customer.

**Fix:** Add `UPDATE messaging_opt_outs SET customer_id = p_canonical_customer_id WHERE customer_id = p_chat_customer_id` (dedup-safe: the unique indexes are `(customer_id, channel_account_id)` / `(customer_id, business_id)` — an `ON CONFLICT DO NOTHING` + delete-survivors pattern like customer_tags handles collisions), and decide recipient-row policy (repoint or document as historical).

### H3-4. `messages_archive` ships with no `ENABLE ROW LEVEL SECURITY` and no policies — any authenticated user can read every business's archived message content via PostgREST.

**Plan sections:** §17.5 (lines 2738–2776), §16.4 (line 2686).

The archive DDL creates the table, sets autovacuum, adds indexes, schedules the cron — and never enables RLS. Supabase's default privileges GRANT `SELECT` on new public-schema tables to `authenticated` (that is precisely why every other table in this plan gets `ENABLE ROW LEVEL SECURITY`, and why `meta_webhook_events`/`rate_limit_buckets` get explicit REVOKE+GRANT treatment — §2.2.13/§2.2.14). With no RLS and no REVOKE, `GET /messages_archive` returns rows from **all businesses** — a cross-tenant read hole over 12+ months of message history, the same class of defect as cycle-2's HI-3. The two service-role-only tables show the plan knows the hazard; the archive missed the treatment.

**Fix:** `ALTER TABLE public.messages_archive ENABLE ROW LEVEL SECURITY;` + member-read SELECT policy (same shape as the §2.3 DO block — it carries `business_id`), or the §2.2.14 REVOKE-to-service-role treatment if the archive is never client-read (it must be, for search — M3-5 makes the same decision point).

---

## 3. MEDIUM

### M3-1. The §2.5.1 trigger SQL does NOT contain the "requires a prior customer message" guard on `first_agent_response_at` that the plan claims (three times) it has — comment describes a self-guard that isn't in the SQL.

§2.5.1 lines 1005–1011: the CASE checks direction/sender_type/content_type/campaign_id only — no `last_customer_message_at IS NOT NULL` condition. The trailing comment (line 1022) says "The first_agent_response_at CASE additionally self-guards: it only fires when `last_customer_message_at` is already non-NULL" — **no such clause exists in the SQL shown**; the ME-4/ME-11 resolution table (line 21: "requires a prior customer message (also fixes ME-11)") and §19 (line 2834) make the same claim. Consequence: outbound-initiated conversations (campaign seeds, agent-first DMs) still get `first_agent_response_at` = first agent message ≈ `created_at` → the ≈0-skew ME-11 defect persists in the column; only the MV `FILTER (WHERE c.last_customer_message_at IS NOT NULL)` (§11.1) saves the analytics. Add `AND last_customer_message_at IS NOT NULL` to the CASE (the pre-update row value is correct for the reply-after-inbound sequence) or fix the three prose claims.

### M3-2. UPDATE policies don't mirror the HI-3 INSERT consistency checks — `business_id`, `conversation_id`, `channel_account_id` remain mutable on UPDATE for dual-membership agents.

"Agents update conversations" (lines 813–820) and "Agents update outbox" (lines 855–862) re-validate only `is_business_member(business_id)` in WITH CHECK. An agent who is a member of businesses A and B can UPDATE a conversation's `channel_account_id` to B's page (breaking conversation/messages business coherence: messages keep business_id A while the conversation moves to B), and can UPDATE an outbox row's `conversation_id`/`channel_account_id` to B's rows — the INSERT-side EXISTS clauses do not re-run on UPDATE, so HI-3 re-opens via the UPDATE path (the meta-send re-assert catches the actual cross-tenant send, but the stored state is corrupted, and the conversation channel swap has no downstream guard at all). Fix: add the same EXISTS clauses to UPDATE WITH CHECKs, or make the FK columns immutable to clients (trigger raising on change of `business_id`/`conversation_id`/`channel_account_id` when `auth.uid()` IS NOT NULL — the assert_message_sender pattern generalizes).

### M3-3. Inbox-created orders without a scoped store never get `business_id` — contradicting §2.5.4's "inbox-created orders always resolve"; the primary inbox analytics flow stays unscoped.

§2.5.4 line 1149: "the §6.1 inbox order-creation path sets `business_id` directly from the conversation, so inbox-created orders always resolve." But §6.1 line 1967 admits the opposite: "the dialog's orders insert does not know the business; `OrderLinker` sets `business_id` on the conversation_orders link" — and trigger (b) (§2.5.3, lines 1079–1097) only inserts a `customer_tags` row; it never UPDATEs `orders.business_id`. So an inbox order saved without selecting one of the scoped stores (the dialog's store field is optional) keeps `business_id = NULL` forever and is excluded from order count / LTV / min_orders (§7.4, §10.1) — the exact ME-9 gap for the flow that motivated the column. Fix: have trigger (b) also `UPDATE orders SET business_id = NEW.business_id WHERE id = NEW.order_id AND business_id IS NULL`, or set the column in OrderLinker's order insert via the dialog.

### M3-4. `has_ordered` is never backfilled for existing orders — trigger (a) is INSERT-only and the §2.5.4 backfill fills `business_id` without tagging.

Trigger (a) (lines 1064–1075) fires `AFTER INSERT ON orders` only. The one-time backfill (lines 1144–1147) UPDATEs existing rows' `business_id` — no insert, no tag. Every pre-launch order (the entire historical order base — the main population the `has_ordered` badge and min_orders/LTV audience filters are meant to serve) remains untagged. Add a backfill INSERT … SELECT with `ON CONFLICT DO NOTHING` in the same migration.

### M3-5. The archive FTS index is dead code as specified: §3.7's search RPC queries `public.messages` only — the §17.5 claim "ConversationSearch spans the archive" is false.

§17.5 line 2762: "FTS so ConversationSearch spans the archive (§3.7 RPC already caps results)" — but the §3.7 RPC (lines 1507–1532) reads `FROM public.messages m` with no reference to `messages_archive`. Search silently loses all >12-month-old messages. Either UNION the archive in the RPC (same LIMIT, dedup by conversation) or delete the spanning claim and the index.

### M3-6. "Agents update outbox" FOR UPDATE policy is business-wide and unrestricted — no client flow needs it, and it lets any send-permission member rewrite any of the business's outbox rows.

Lines 855–862: USING/WITH CHECK = member + `inbox.send_messages`, no own-row restriction, no column restriction. Any member can UPDATE a colleague's pending row (content, attachments, `status='sent'`, `sent_at`, `platform_message_id`) — forging "sent" ticks in the thread or altering a queued message's content before the sweep dispatches it. No specified client flow UPDATEs outbox rows (cancel is DELETE-own; retry re-invokes meta-send). Drop the policy or restrict it (own rows + a no-op-ish column set).

---

## 4. LOW

### L3-1. Wrong verified-fact, twice: `order_sources.name` IS UNIQUE — the plan's "no name UNIQUE — verified" claim is false (harmless to the SQL).

§2.2.0 lines 258–259 and the LO-2 row (line 35) state the `WHERE NOT EXISTS` guard exists because "order_sources has no name UNIQUE — verified." Actual DDL (20260415165743, line 4): `name text NOT NULL UNIQUE`. The guarded seed is safe either way; the "verified" claim is wrong and should be corrected (it also means an `ON CONFLICT (name)` variant would have worked).

### L3-2. Redundant/duplicated indexes.

`idx_conversations_business_status` (line 338, `(business_id, status)`) is a strict prefix of `idx_conversations_list_covering` (lines 970–972, `(business_id, status, last_message_at DESC) INCLUDE …`) — pure write overhead. `idx_recipients_status` (line 625, `(campaign_id, status)`) duplicates the prefix of `idx_recipients_campaign` (line 624). `idx_subscriptions_topic` (lines 561–562) carries the constant `status` column in the key under `WHERE status = 'active'`. Drop the two redundant ones; drop `status` from the subscriptions key.

### L3-3. Presence close-out cron schedule `15 * * * *` is hourly-at-minute-15, not "every 15 minutes."

Lines 2771–2775. If the intent is a 15-minute sweep, the expression is `*/15 * * * *`. Functionally adequate either way given the 24h force-close threshold — but the comment and LO-10 narrative imply a sweep, and the expression doesn't deliver one.

### L3-4. §17.3's "All migrations idempotent" claim is overbroad — `CREATE TYPE` (no `IF NOT EXISTS` exists in PG for it), the plain `CREATE TABLE`s, and plain `CREATE TRIGGER`s in §2.1–§2.5 are not re-runnable as written.

Line 2712 claims idempotency via `IF NOT EXISTS` / `ON CONFLICT` / `DROP POLICY IF EXISTS`; none of those apply to the enum/table/trigger creations the plan shows. Since Supabase migrations run once, this is a claim-accuracy nit — but either soften §17.3 or wrap enum creation in the standard DO-block guard.

### L3-5. `merge_chat_customers` signature/doc mismatch: the comment says "the caller (OrderLinker) passes [the business] via the conversation's customer" — the two-arg signature accepts no business or conversation parameter (lines 2048–2053), and the business is derived heuristically from "any one" of the chat customer's conversations.

If the chat customer has conversations in two businesses, the ownership check validates against the most recent one only. Pass `p_business_id` explicitly (the caller has the conversation in hand) instead of the heuristic.

---

## 5. CYCLE-2 FIX VERIFICATION

| Issue | Verdict | One line |
|---|---|---|
| CR-1 (pgcrypto search_path/extensions) | **FIXED** | `CREATE EXTENSION … WITH SCHEMA extensions` + `search_path = public, vault, extensions` + schema-qualified calls in both RPCs and the DO block (§13.1, lines 2362–2432); repo convention confirmed (pg_net `WITH SCHEMA extensions`, 20260414193433; zero pgcrypto references repo-wide — re-verified). |
| HI-3 (EXISTS consistency on INSERT) | **PARTIALLY** | INSERT-side EXISTS clauses landed on `message_outbox` (848–853), `messages` (834–836), `conversation_orders` (875–880), `conversation_viewers` (789–795) + meta-send re-assert (1713–1725) — but UPDATE policies don't mirror the checks and FK columns stay mutable (M3-2), and the conversation_orders policy itself is migration-blocked (C3-1). |
| ME-1 (SKIP LOCKED sweep RPC) | **FIXED** | `claim_outbox_batch` (1854–1885) pins CTE `FOR UPDATE SKIP LOCKED` + outer status recheck, service-role-only grants; matches the verified `claim_sync_queue_batch` shape (20260829000000, body re-read). The §5.1 single-row claim predicate bug is a NEW defect (H3-2), not ME-1's. |
| ME-3 (atomic campaign claim) | **FIXED** | 1-minute cron removed; sweep is sole trigger; claim `UPDATE … WHERE status='scheduled' RETURNING *` is atomic and the loser exits (lines 168, 1892, 2256). |
| ME-5 (sender spoofing + post_system_message RPC) | **PARTIALLY** | Policy (sender_type='agent' + own agent id) and trigger both landed — but the trigger kills the sanctioned RPC on every call (C3-2); as shipped the system-message path does not exist. |
| ME-9 (orders.business_id + backfill) | **PARTIALLY** | Column + BEFORE INSERT resolution + deterministic oldest-pick + backfill specified (1108–1147) — but the migration placement contradicts itself and one arrangement fails (C3-1), the backfill never tags `has_ordered` (M3-4), and inbox orders without a store never resolve (M3-3). |
| LO-5 (archive DDL) | **PARTIALLY** | Hand-written constraint-free DDL + PK-idempotent copy + FTS index landed (2738–2768) — but the search RPC never reads the archive ("spans the archive" is false — M3-5), and the table ships with no RLS (cross-tenant read hole — H3-4). |

Adjacent trigger items verified while in the area: **ME-4 FIXED** (GREATEST guards on all three columns, lines 993–999, NULL-safe as claimed); **ME-11 PARTIALLY** (campaign/bot/note exclusions present; the claimed prior-customer-message guard is missing from the SQL — M3-1).

---

## 6. Issue Count (cycle 3a — SQL/schema only)

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 3 | C3-1, C3-2, C3-3 |
| HIGH | 4 | H3-1, H3-2, H3-3, H3-4 |
| MEDIUM | 6 | M3-1 … M3-6 |
| LOW | 5 | L3-1 … L3-5 |

What checked out clean: pgcrypto/CR-1 mechanics, `claim_outbox_batch` claim SQL, the atomic campaign claim, RLS DO-block syntax (correct `%1$s`/`%1$I` and `''admin''` escaping per foundation pattern), the GREATEST guards, the generated `window_expires_at` column (PG15-valid, immutable expression), opt-out unique-index pair, storage `foldername` regex-guard + uuid-cast ordering, `consume_rate_limit_token` atomicity (WHERE prevents negative tokens), `search_conversations` SECURITY INVOKER + RLS composition, trigger loop analysis (no recursion: `handle_new_message` → conversations → `trigger_set_timestamp` terminates), and the Class A–E policy permission gating (verified `orders.edit`/`customers.edit`/`inbox.*` usage against the Migration A value list).
