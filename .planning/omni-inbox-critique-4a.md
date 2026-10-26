# Adversarial Critique Cycle 4a (FINAL) — SQL/Schema Specialist

**Critique date:** 2026-09-14
**Plan under review:** `.planning/omni-inbox-plan-v4.md` (3094 lines)
**Scope:** Verify all cycle-3a SQL/schema fixes (`.planning/omni-inbox-critique-3a.md`, 18 issues) are genuinely correct; scan the fixes for regressions. Method: every fix marker grepped, each fix region read in full, every new SQL statement checked against the plan's own DDL (§2.2.13 rate_limit_buckets, §2.2.15 opt-out unique indexes, §2.3 policies, §17.5 archive).

---

## 1. NEW SQL Issues

### NEW-1. HIGH — The Phase 1 checklist still contradicts §18 on `orders.business_id` placement: the surviving half of C3-1.

**Plan section:** Phase 1 checklist line 2675.

§18 is now correct (line 2966: `202609XX03a_omni_inbox_orders_business.sql` **FIRST**, "ordered before ANY statement that references orders.business_id"). But the Phase 1 checklist (line 2675) still reads: "Migration C: all tables (§2.2), indexes (§2.4), RLS policies …, triggers + functions (§2.5 — **incl. … `orders.business_id` resolution + backfill**)" — and lists **no Migration 03a item at all** (`03a` appears only at lines 2966 and 3055). An implementer following Phase 1 puts the column + backfill inside Migration 03, the same file whose §2.3 policy DO block ("Agents link orders", lines 896–906) references `orders.business_id` — the exact C3-1 failure mode (42703 at `CREATE POLICY` when the policy precedes the §2.5.4 `ALTER TABLE`). The §20 changelog (line 3055) claims "§18 + Phase 1 updated; contradiction deleted" — **Phase 1 was not updated; the claim is false.**

**Fix:** Add a `- [ ] Migration 03a: orders.business_id column + resolve_order_business trigger + business_id backfill + has_ordered tag backfill (§2.5.3/§2.5.4 — BEFORE Migration C)` item to Phase 1 and strike "`orders.business_id` resolution + backfill" from the Migration C line.

### NEW-2. HIGH — `seed_rate_limit_bucket` is SECURITY INVOKER, but `rate_limit_buckets` is REVOKE'd from `authenticated` with RLS and no policies: every client-side `channel_accounts` INSERT fails, breaking the manual connect flow.

**Plan sections:** lines 1924–1936 (trigger), 675–685 (table), 912–928 (Class B policy).

`seed_rate_limit_bucket()` (line 1925) is `LANGUAGE plpgsql` with **no `SECURITY DEFINER`**. The trigger fires `AFTER INSERT ON public.channel_accounts` — a specified client path (Class B "Managers write" FOR ALL policy includes `channel_accounts`, line 917; the manual-token connect fallback is settings-UI-driven, lines 2683/2978). `rate_limit_buckets` ships with `REVOKE ALL … FROM … authenticated` (line 684) and RLS with no policies (line 683). A SECURITY INVOKER trigger runs as the invoking role → its `INSERT INTO public.rate_limit_buckets` (line 1927) raises `permission denied for table rate_limit_buckets` → the **entire `channel_accounts` INSERT aborts** → managers cannot connect a page via the UI. The OAuth edge-function path (service_role, BYPASSRLS) is unaffected, but the RLS-shipped client write path and the seed trigger are mutually exclusive as written. (The Phase 2 smoke test, line 2695, would catch this loudly — but the shipped SQL is broken.)

**Fix:** `CREATE OR REPLACE FUNCTION public.seed_rate_limit_bucket() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ …` (the assert_message_sender/post_system_message pattern already used elsewhere in the plan).

### NEW-3. MEDIUM — merge opt-out dedup NULL-branch is over-broad: a canonical global opt-out in ANY business deletes the chat customer's global opt-outs in OTHER businesses (suppression lost).

**Plan section:** lines 2240–2247.

The dedup predicate's first branch — `o2.channel_account_id IS NULL AND public.messaging_opt_outs.channel_account_id IS NULL` — compares **only `channel_account_id`**, not `business_id`. The matching unique index, `uq_opt_out_global (customer_id, business_id) WHERE channel_account_id IS NULL` (lines 747–749), keys on `business_id`. Scenario: chat customer has a global opt-out in business B; canonical has a global opt-out in business C (≠ B). The dedup matches (both NULL channels) → `NOT EXISTS` false → the B row is skipped in the UPDATE → then deleted by the survivor sweep (line 2247, "rest were dupes" — it is not a dupe). Canonical ends up with **no opt-out row in B → messages resume to a customer who said STOP in B** (the ME-13 harm class H3-3 was written to prevent). The second branch (`o2.channel_account_id = …`) is correctly broad because `business_id` is not in `uq_opt_out_per_channel`; only the NULL branch is wrong.

**Fix:** Add `AND o2.business_id = public.messaging_opt_outs.business_id` to the first branch.

### NEW-4. LOW — §2.5.4's one-time `business_id` backfill is now comment-only; v3 shipped the SQL.

Lines 1184–1187 describe the backfill ("same resolution logic … 10k rows/pass in the migration's DO block, updating only rows where business_id IS NULL") but contain **no SQL** — v3 had the backfill written (critique-3a cited it at v3 lines 1144–1147), and the §2.5.4 block now ends on a comment. The plan's closing claim "Every schema statement is complete SQL" (line 3040) no longer holds for this migration component. Not a runtime defect (logic fully described, trivially derivable), but a completeness regression.

### NEW-5. LOW — The `has_ordered` backfill code fence is never closed; the §2.5.5 header is swallowed into the block.

The ```sql fence opened at line 1199 runs to line 1210 (`ON CONFLICT DO NOTHING;`); line 1211 is empty and line 1212 is the `#### 2.5.5` header — no closing fence. In rendered markdown the header (and the first lines of §2.5.5's SQL) merge into the backfill code block. Cosmetic; add ``` after line 1210.

### NEW-6. LOW — The merge caller prose still shows the 2-arg call.

Line 2183: "`OrderLinker` calls `merge_chat_customers(chat_customer_id, canonical_customer_id)`" — the function takes three required params (lines 2186–2192) and RAISEs `'p_business_id is required'` on NULL (2198–2199). An implementer copying the prose call gets a clean, immediate runtime error in the Phase 4 phone-merge flow. Update the prose to `merge_chat_customers(chat_customer_id, canonical_customer_id, business_id)`.

---

## 2. VERIFICATION TABLE (cycle-3a fixes)

| Issue | Verdict | One line |
|---|---|---|
| C3-1 (03a orders.business_id FIRST) | **FIXED** | §18 line 2966 pins `202609XX03a` FIRST with the exact fix language ("before ANY statement that references orders.business_id"); 03a is self-contained on pre-existing tables (businesses, selling_points, orders, customer_tags). Residual: the Phase-1-checklist half of the contradiction survives → NEW-1. |
| C3-2 (assert_message_sender GUC escape hatch) | **FIXED** | Trigger honors `current_setting('app.sanctioned_system_message', true) = '1'` for `sender_type='system'` rows (1225–1228); `post_system_message` sets it transaction-locally via `PERFORM set_config(…, '1', true)` before the INSERT (1271); direct client inserts cannot set the GUC via PostgREST; NULL-unset falls through to the auth.uid() check correctly. |
| C3-3 (merge touches nonexistent conversation_orders.customer_id) | **FIXED** | Statement deleted; replaced with a verified-fact comment (2236–2239: "conversation_orders has NO customer_id column (verified §2.2.5) … nothing to repoint"). |
| H3-1 (§18 dependency-ordered tables) | **FIXED** | Line 2967: Migration 03 "tables in DEPENDENCY order — H3-1: message_outbox AFTER saved_messages/notification_subscriptions/bulk_campaigns". |
| H3-2/ME-B5 (§5.1 NULL-safe claim predicate) | **FIXED** | `.or('next_retry_at.is.null,next_retry_at.lte.${nowIso}')` with client-computed ISO timestamp (1811, 1816) — "now()" cast hazard documented (1806–1810); Retry affordance clears `next_retry_at` (1820–1821, 3061). |
| H3-3 (merge repoints messaging_opt_outs) | **FIXED** | Repoint with dedup + delete-survivors (2240–2247); `bulk_campaign_recipients` documented as immutable send history (2258–2262). Residual: NULL-branch over-breadth → NEW-3. |
| H3-4 (messages_archive RLS) | **FIXED** | `ENABLE ROW LEVEL SECURITY` (2936) + member-read SELECT policy, same shape as the §2.3 DO block (2938–2939); archived CTE in search works under SECURITY INVOKER + RLS. |
| HI-B1 (rate-limit self-seed + trigger) | **FIXED** | Self-seed `INSERT … ON CONFLICT (channel_account_id) DO NOTHING` (1901–1905 — PK verified at line 676) + `seed_rate_limit_bucket` AFTER INSERT trigger (1924–1936) + Phase 2 smoke test (1939, 2695). Residual: trigger privilege defect → NEW-2. |
| M3-1/LO-B7 (prior-customer-message guard in CASE) | **FIXED** | `AND last_customer_message_at IS NOT NULL` is IN the CASE (1040); the UPDATE reads the pre-update row so inbound-then-agent fires and campaign seeds don't (1029–1033); prose claims corrected (1052, 3071). |
| M3-2 (UPDATE-side anchor mutability) | **FIXED** | `freeze_conversation_anchors` BEFORE UPDATE trigger blocks client-side `business_id`/`channel_account_id` swaps (835–848, auth.uid()-gated so service rows pass); the outbox half is closed by the dropped UPDATE policy (M3-6) — no client can UPDATE outbox FK columns. |
| M3-3 (trigger b UPDATEs orders.business_id) | **FIXED** | Trigger (b) `UPDATE public.orders o SET business_id = c.business_id … AND o.business_id IS NULL` runs before the tag insert (1117–1122); contradictory prose deleted and rewritten (1191–1195, 2115). |
| M3-4 (has_ordered backfill) | **FIXED** | Migration seeds tags for the historical base: `INSERT … SELECT DISTINCT … WHERE business_id IS NOT NULL AND customer_id IS NOT NULL AND NOT EXISTS … ON CONFLICT DO NOTHING` (1197–1210); `created_by` NULL is safe (trigger (a) omits the column, 1098–1099). §18 line 2966 carries it in 03a. |
| M3-5/ME-B4 (search UNIONs archive) | **FIXED** | §3.7 RPC reads `hot` + `archived` CTEs, `UNION ALL` with 2000-row combined ceiling and 50-convo result cap, SECURITY INVOKER (1603–1636); archive DDL has `business_id`/`content_type` matching the CTE (2912, 2918); §17.5 spanning claim now true (2940–2942). |
| M3-6/LO-B6 ("Agents update outbox" dropped) | **FIXED** | No CREATE POLICY … FOR UPDATE on message_outbox; rationale comment with the Supabase no-policy = deny semantics (883–888); DELETE-own cancel policy intact (890–893); meta-send service-role unaffected. |
| L3-1 (order_sources name UNIQUE claim) | **FIXED** | §2.2.0 corrected: "order_sources.name IS UNIQUE (20260415165743 DDL: `name text NOT NULL UNIQUE`) — the earlier 'no name UNIQUE' claim was wrong"; guarded seed kept (253–262). |
| L3-2 (redundant indexes) | **FIXED** | `idx_conversations_business_status` dropped with explanatory comment (340–341); `idx_recipients_status` dropped (633–634); `idx_subscriptions_topic` key trimmed to `(channel_account_id, topic)` under `WHERE status='active'` (567–570). |
| L3-3 (presence cron */15) | **FIXED** | `cron.schedule('close-presence-intervals', '*/15 * * * *', …)` with the hourly-vs-sweep correction documented (2950–2952). |
| L3-4 (idempotency claim scoped) | **FIXED** | §17.3 now states CREATE TYPE has no IF NOT EXISTS, enum creation wrapped in the pg_type DO-block guard, and "the claim is now scoped to what's actually true" (2883). |
| L3-5 (merge 3-arg consistency) | **PARTIALLY** | SQL, ownership/cross-tenant guard, and grants are 3-arg (`uuid, uuid, uuid`, 2186–2270, 2269–2270; explicit `p_business_id IS NULL → RAISE`, 2198–2200) — but the caller prose at 2183 still shows the 2-arg call → NEW-6. |

---

## 3. VERDICT

**NOT CONVERGED.**

All 18 cycle-3a fixes are mechanically present and the three CRITICALs are genuinely resolved in their primary locations (§18 ordering, GUC escape hatch, merge statement deletion). The fixes introduced two new HIGH defects: NEW-1 (the C3-1 contradiction survives in the Phase 1 checklist — the changelog's "Phase 1 updated" claim is false) and NEW-2 (the seed trigger breaks the client connect flow via REVOKE + SECURITY INVOKER). One more iteration: apply the six fixes above (two are one-word changes: "03a" into the Phase 1 checklist, "SECURITY DEFINER" onto the trigger); the remaining four are comment/prose-level.

CRITIQUE_A_SUMMARY: new_critical=0 new_high=2 fixed=18 partial=1 not_fixed=0 verdict=NOT CONVERGED
