# Adversarial Critique Cycle 3 — Critic B (Architecture / Meta API / UX / Phasing / Operations)

**Critique date:** 2026-09-11
**Plan under review:** `.planning/omni-inbox-plan-v3.md` (2866 lines)
**Scope:** architecture, Meta API facts, UI/UX, core requirements, internal consistency, phasing, operations, security flows. SQL DDL internals are Critic A's — the SQL issues reported here are cross-section integration failures (sections referencing schema that doesn't exist / contradicting each other), not DDL-internal nitpicks.
**Codebase spot-checks performed this session:** `AddOrderDialog.tsx` (Props 89–93; `normalizeBdPhone` 35–42; source state `useState("phone")` line 241, `setSource(def.name)` 303; self-fetch `Promise.all` lines 284–321 with zero dataset props; phone lookup 782; customer insert 796/803; orders insert 815–837/817; `onCreated()` with no arguments at line 897, with `order.id`/`orderNumber`(810)/`customerId`(778) all in scope — all plan claims verified exact), `woo-webhook/index.ts` (616 lines; base64 compare line 104; idempotency 50–59; service-role client line 48), `package.json` (vaul ^0.9.9, react-resizable-panels ^2.1.9, recharts, fuse.js, react-query present; @tanstack/react-virtual absent), `invoiceHtml.ts` (197 lines, HTML string only) / `InvoicePrint.tsx` (54 lines, `openPrintWindow` print popup — no PDF capability anywhere), `OrderBadges.tsx` (exists), `parse-order-text` (240 lines), `courier_shipments` (exists, 20260902000000), `stores` DDL (no business_id), `products` DDL (`store_id` present).

**Bottom line:** v3 is a genuinely strong revision — the cycle-2 fixes are real and the codebase facts are now accurate (all spot-checks passed, including the previously-wrong HI-2 anchors). But this cycle found **five HIGH issues**: a never-seeded rate-limit table that blocks every send on day one, a merge RPC that updates a column that does not exist, a direct self-contradiction between §2.5.4 and §6.1 about `orders.business_id`, a factually wrong `message_reads` matching claim, and an invoice-send chain whose PDF step has no mechanism anywhere in the repo or the plan.

---

## 1. CRITICAL

None. No migration aborts, no cross-tenant hole, no security regression found in my scope. (The five HIGHs below are guaranteed runtime failures or requirement-chain breaks, but each has a bounded, targeted fix and none requires architectural redesign.)

---

## 2. HIGH

### HI-B1. `rate_limit_buckets` is never seeded — every send fails check 4 on day one, forever.

**Plan sections:** §2.2.13 (table DDL only), §5.3 (`consume_rate_limit_token` UPDATE-only RPC), §5.2 (check 4), §4.7 (connect flow), Phase 1/2 checklists.

**Evidence:** `consume_rate_limit_token` is a single `UPDATE … WHERE channel_account_id = $1 AND (tokens_remaining + refill) >= 1 RETURNING true`. Nothing in the plan ever INSERTs a `rate_limit_buckets` row: §2.2.13 ships the table with no seed; §4.7's connect flow (steps 1–7) inserts `channel_accounts` and subscribes the app but never touches the bucket table; no trigger on `channel_accounts` is specified; the RPC contains no upsert. With no row, the UPDATE matches zero rows, `v_ok` is NULL, the RPC returns `false`, and §5.2 check 4 leaves every outbox row `pending` with `next_retry_at = now()+1s` — re-claimed and re-failed by the sweep until the §17.5 7-day pending cancellation. **All outbound messaging is dead as specified** — 1:1, automation, and campaign. The Phase 1 CR-1 smoke test covers token encrypt/decrypt but not the send path, so this ships silently into Phase 2's first manual test.

**Fix:** make the RPC self-seeding (INSERT … ON CONFLICT (channel_account_id) DO NOTHING before the UPDATE) or add an AFTER INSERT trigger on `channel_accounts`; add a Phase 2 smoke test that a fresh connected account can consume a token.

### HI-B2. `merge_chat_customers` updates a column that does not exist — the RPC aborts on every invocation, and the `has_ordered` badge stays invisible in the active conversation for exactly the returning-customer case.

**Plan sections:** §7.2 (merge RPC SQL), §2.2.5 (conversation_orders DDL), §6.1 Flow step 6, §2.5.3(b).

**Evidence:** §7.2's RPC contains `UPDATE public.conversation_orders SET customer_id = NULL WHERE customer_id = p_chat_customer_id;` — but §2.2.5's `conversation_orders` DDL has exactly `id, business_id, conversation_id, order_id, linked_by, created_at`. There is **no `customer_id` column** (the comment even says "column not used" — it doesn't exist at all). The statement raises `42703` and the SECURITY DEFINER transaction aborts, so **every phone-merge fails**.

Consequence chain: for a returning customer (existing phone-matched record — the majority case for an order-taking inbox), `AddOrderDialog` resolves the ORDER's `customer_id` to the phone-matched customer (line 782); trigger (b) tags `has_ordered` on `COALESCE(o.customer_id, c.customer_id)` = the **phone-matched** customer; the conversation in the UI displays the **alias-created chat customer** — so the badge never shows in the thread the agent is looking at, and the merge that would unify the two records (§6.1 step 6, the exact broken link HI-2 was supposed to fix) throws. The core requirement "mark customers who placed orders" silently fails for returning customers.

**Fix:** delete the bogus UPDATE statement (conversation_orders keys orders, not customers — exactly as the comment itself says), or add the column in §2.2.5 if the defensive update is actually wanted.

### HI-B3. §2.5.4 and §6.1 directly contradict each other on how inbox-created orders get `business_id` — and per §6.1's version, store-less inbox orders never do.

**Plan sections:** §2.5.4 scope statement vs §6.1 Flow step 3; consequences in §7.4, §10.1, §2.5.3(a).

**Evidence:** §2.5.4 states: "the §6.1 inbox order-creation path **sets business_id directly from the conversation**, so inbox-created orders always resolve." §6.1 Flow step 3 states the opposite: "The order insert carries the business_id set by OrderLinker? **No — the dialog's orders insert does not know the business**; … For orders created without a store, business_id resolves at the **link** step below" — but trigger (b) at the link step only writes `customer_tags`; **nothing in the link path writes `orders.business_id`**. So under §6.1's (correct, code-verified) account: an inbox order created without a Woo store keeps `business_id = NULL`, and per §2.5.4's own scope statement such orders are excluded from §7.4's order-count/LTV aggregates and §10.1's `min_orders` audience filter. §7.4's CustomerProfileCard — a Phase 4 deliverable — would show wrong numbers for the most common inbox order shape.

**Fix:** pick one and pin it. Cleanest: `OrderLinker` UPDATEs the order's `business_id` from the conversation after `onCreated` (it has `orderId` and the conversation in hand), or trigger (b) also backfills `orders.business_id` from the conversation. Then delete the false sentence in whichever section loses.

### HI-B4. `message_reads` "matched by mid" is factually wrong — read events carry a watermark only, no mids. Outbound read ticks never update.

**Plan sections:** §4.4 steps 3–4; §1.4 (30s status refetch premise); §2.2.3 (`customer_read_at`, `delivery_status='read'`).

**Evidence:** Meta's Messenger and Instagram `message_reads` webhook payloads deliver `{"read": {"watermark": <ms>, "seq": …}}` — **no mids array**. (Deliveries DO carry `mids[]`; §4.4 step 3 is correct.) Step 4's "update outbound `delivery_status='read', customer_read_at` (matched by mid)" can never match: there is no mid in the payload. As written, the UPDATE affects zero rows on every read event; `customer_read_at`/`is_read` for outbound never populate; the single/double-tick UI (§3.6, plus the 30-seconds-while-open refetch that reads these fields) never shows "read". This is stated as flat fact with no spike gate, and it silently degrades rather than erroring — the class of defect that ships. Cycle-2's H2 was marked FIXED on the strength of this same mapping; the read half of it is broken.

**Fix:** rewrite step 4 as watermark semantics: mark all outbound messages of that conversation with `created_at <= to_timestamp(watermark/1000)` as `delivery_status='read'`, `customer_read_at = to_timestamp(watermark/1000)`. Record the payload shape in the Phase 0 spike.

### HI-B5. InvoiceQuickSend has no PDF-generation mechanism — the "send invoices" core requirement is not concrete end-to-end.

**Plan sections:** Codebase Context Summary ("HTML invoice generation ready for PDF rendering"), §3.2 (`InvoiceQuickSend — Generate + send invoice PDF`), Phase 4 checklist ("invoiceHtml → PDF → Storage → attachment send").

**Evidence (verified):** `src/lib/invoiceHtml.ts` (197 lines) builds an **HTML document string**; `InvoicePrint.tsx` (54 lines) wraps `openPrintWindow(html)` — a browser print popup. There is **no PDF library in package.json** (verified: no jsPDF/pdfmake/canvas/puppeteer/anything matching pdf|print), and the plan's only new dependency is `@tanstack/react-virtual`. The chain "invoiceHtml → PDF" contains a step that exists nowhere: no client-side renderer, no edge-function renderer, no headless-browser path — and Meta's Send API accepts neither HTML nor a print popup; it needs a fetchable file/image URL or `attachment_id`. The reuse claim "ready for PDF rendering" is hollow. Products (generic template + Woo CDN `image_url`), product info (freeform/saved messages), and courier info (`courier_shipments` → tracking message, table verified) are concrete; invoices are the one flow of the four with a missing link.

**Fix (pick one, then re-budget Phase 4):** (a) agent-driven: render the existing HTML in a hidden iframe → `window.print()` → agent attaches the OS print-to-PDF output (zero new deps, manual but honest — spec it as such); (b) client-side image render (html-to-image/canvas) → send as image attachment; (c) add a real PDF dependency (jsPDF etc.) and an `invoicePdf.ts` module to §18. As written, an implementer discovers mid-Phase 4 that the deliverable is impossible.

---

## 3. MEDIUM

### ME-B1. `catalogScope`'s spec is flawed: `product_variations` scoped by the wrong column, and the products id-list filter is a URL-length hazard.

**Plan sections:** §6.1 Modification 2 comment ("products/products_variations/orders_sources/stores queries gain `.in('id', catalogScope.productIds)` / `.in('id', catalogScope.storeIds)`").

**Evidence:** (a) `product_variations` rows are keyed by their **own** ids with a `product_id` FK (verified in the dialog's own fetch, line 288) — `.in('id', productIds)` filters variations **by product ids**, matches zero rows, and silently breaks variation selection in the scoped dialog; it must be `.in('product_id', …)`. (b) `.in('id', catalogScope.productIds)` on `products` builds a PostgREST GET query string containing every product UUID — at a few hundred products that's already ~8–16KB of URL (header limits); at thousands it fails outright. The correct shape is in the plan's own Modification 2 prose: the wrapper knows `storeIds` — scope products/variations by `.in('store_id', storeIds)`, a handful of values (products carry `store_id`, verified in DDL). (c) `orders_sources` is listed among the scoped queries though `catalogScope` carries no source ids and sources shouldn't be scoped at all. This matters because catalogScope is the HI-2 fix's centerpiece.

### ME-B2. `conversations.tags` is orphaned — the filter UI reads a field nothing in the plan ever writes.

**Plan sections:** §2.2.2 (`tags text[]`), §3.3 (tag filter `.contains('tags', ['vip'])` + GIN index), §3.2 (ConversationItem renders tags).

**Evidence:** every tagging mechanism in the plan writes `customer_tags` (TagManager, automation `auto_tag`, `has_ordered` triggers); nothing ever writes `conversations.tags` — not the composer, not BulkActionBar, not automation, not campaigns. The §3.3 conversation-list tag filter therefore filters over a permanently-empty array. Either add a conversation-tag writer to the UI spec and say which component it is, or drop the column/filter pair.

### ME-B3. An outbox row cannot express "this is an RN/OTN opt-in prompt send" — meta-send would send it as freeform text.

**Plan sections:** §2.2.4 (outbox fields), §5.2 (decision matrix), §5.1 (`notificationTemplate` exists only on `sendMessage`, not in the row pipeline), §10.2 step 2, §8.3 (`send_optin_prompt`).

**Evidence:** the outbox schema carries `message_tag`, `subscription_id`, `campaign_id`, `saved_message_id` — and §2.2.4 says "meta-send derives the path per §5.2". §5.2's matrix has no row for template sends: an opt-in prompt row (no tag, no subscription) falls into check 3a as a plain freeform send — meta-send would POST `{message: {text: …}}` instead of the `notification_messages`/`one_time_notif` template attachment that §10.2 asserts it constructs. The reconstruction is *possible* (row carries `saved_message_id`; meta-send could look up the saved message, see `optin_config`, build the template body) but that derivation is specified nowhere in §5.1/§5.2. HI-1's redesign stopped one integration short of the send path. Fix: pin the derivation — "rows with `saved_message_id` → saved message of category `optin_prompt`/`optin_one_time` are built as template sends from `optin_config`" — in §5.1/§5.2, and state what `content` holds for such rows (agent-visible descriptive text, never sent).

### ME-B4. "Search spans the archive" is claimed but the search RPC never queries the archive.

**Plan sections:** §17.5 ("FTS so ConversationSearch spans the archive") vs §3.7 (RPC: `FROM public.messages m JOIN public.conversations c` — messages only).

**Evidence:** the new `idx_messages_archive_fts` index feeds a query that doesn't exist. Either add a `messages_archive` arm to `search_conversations` (mind the caps: 50 conversations across both tables, 2000-row scan ceiling split) or delete the "search spans the archive" sentence. As written, month-12+ history silently drops out of search the first time the archive job runs.

### ME-B5. The §5.1 claim sketch is broken in two ways and contradicts §1.5's correct prose.

**Plan sections:** §5.1 (`processOutboxRow` step 1) vs §1.5 step 2.

**Evidence:** (a) `.lte("next_retry_at", "now()")` — PostgREST filter values are literals; `now()` is not evaluated there, and the request errors on the cast. (b) Even with a correct ISO timestamp, `next_retry_at <= X` excludes the **NULL** `next_retry_at` of a fresh pending row — so the client-invoked claim matches nothing and the "< 1s interactive-send latency budget" (§1.5 step 4) silently degrades to ≥5s sweep latency for every agent send. §1.5's prose version is correct (`next_retry_at IS NULL OR next_retry_at <= now()`); the TypeScript sketch an implementer will copy is not. Fix: `.or('next_retry_at.is.null,next_retry_at.lte.' + new Date().toISOString())`.

### ME-B6. Accessibility is unspecified across the entire UI section.

**Plan sections:** §3.1–§3.7.

**Evidence:** keyboard shortcuts exist (§3.5) but there is no ARIA/screen-reader strategy for a realtime-updating message list (live-region semantics for incoming messages), no focus-management spec for the master-detail push navigation (§3.1.1), no reduced-motion or color-contrast note (priority/status colors carry meaning), and no labeled-composer/visible-focus spec. For a productivity surface an agent lives in all day this is a real gap, not polish. Add a short a11y contract to §3: live region for thread appends, focus return on back-navigation, labeled composer, visible focus on list navigation.

---

## 4. LOW

### LO-B1. §15.3 vs §18 file-list mismatch.
`AutomationRuleEditor` and `AnalyticsDashboard` are named in §15.3's new-components list but absent from §18's 21-file list (they presumably live inside `InboxSettings.tsx` / an analytics page — say so in §18).

### LO-B2. `search_conversations` RPC has no home.
Not in any §18 migration description (Migration 03's "RPCs incl. claim_outbox_batch" doesn't mention it) and no Phase 5 checklist item creates it — the Phase 5 UI item assumes it exists.

### LO-B3. Thread backward pagination keysets on `created_at` alone.
§3.7: "`created_at < oldest_loaded`" — the same same-timestamp skip class as LO-7, unfixed for the thread (campaign/bulk-inserted messages share timestamps). Use the `(created_at, id)` tuple like the list does.

### LO-B4. §4.1 cross-ref and the webhook→sweep auth token.
"META_CRON_TOKEN (vault-held, §5.7)" — §5.7 is profile-fetch rate limiting; the cron token is §5.6. And §5.6's "the non-blocking call's one-shot token from meta-webhook" is never specified (presumably the same vault secret via `x-cron-secret` — say that; "one-shot" implies a minting mechanism that doesn't exist).

### LO-B5. Phase 1 schedules the sweep cron before the sweep exists.
Phase 1 creates the vault token + 30s `cron.schedule`; `meta-outbox-sweep` is first built in Phase 2 — a week of guaranteed 404 pg_net calls. Harmless but noisy; create the function in Phase 1 or the schedule in Phase 2.

### LO-B6. The "Agents update outbox" FOR UPDATE policy is broader than any client flow needs.
Any member with `inbox.send_messages` can UPDATE any outbox row of the business — including a colleague's pending row's `content` before the sweep claims it. Client flows only need DELETE (cancel, already separate). Restrict the UPDATE policy to own rows (`created_by = auth.uid()`) or drop it (meta-send runs service-role).

### LO-B7. §2.5.1's "requires a prior customer message" guard exists only in the comment.
The trigger SQL for `first_agent_response_at` has no `last_customer_message_at IS NOT NULL` condition (the parenthetical below the trigger concedes it "self-guards" only via UPDATE-statement read timing); the MV FILTER (§11.1) is the only real guard. Either encode the guard in the CASE or delete the comment's claim — ME-11's trigger-side fix is weaker than its resolution table advertises (the MV still makes the analytics correct, so ME-11 remains fixed in effect).

### LO-B8. §4.7's CSRF state storage offers "signed cookie or a connect_sessions row" — the table doesn't exist.
`connect_sessions` is in no schema section and no §18 file. Pick the signed-cookie option (needs no schema) or design the table; leaving both options invites mid-implementation invention.

### Clean areas (checked, nothing to report)
Architecture data flow and edge-function responsibility split (§1.1–§1.5): coherent, non-overlapping, every outbox row has a processor, no orphaned components (ME-B2's tags column aside). Phasing: dependency graph correct, checklists reference only earlier-phase artifacts (LO-B5 aside); Phase 0 App Review path realistic (business verification, dev-mode screencasts, Advanced-Access usage submissions for HUMAN_AGENT/RN/OTN, LO-9 tester mechanics, slippage scoped to Phases 7–9 only); effort estimates sane for 100-500 convos/day; **nothing gold-plated** — the RN/OTN subsystem is the largest discretionary build but is requirement-driven and fully collapsible behind the §10.6 flag. Operations (§17): monitoring, alerting, retention, migration safety (incl. ME-15 CI assertion), honest 19–38K/day recount, cost estimate — complete and sane. Security flows: §4.7 OAuth (app secret server-side, state CSRF, JWT + `inbox.manage`), §5.1 cross-business re-assert, §2.6 storage policies, ME-13 opt-out enforcement on all outbound — complete. Bulk-messaging value: the within-24h fallback campaign path is complete (§10.3 eligibility, §10.1 live reachability preview, skip reasons, per-platform recipient rows), and RN out-of-window value is honestly framed as opt-in-bound with a full fallback — the requirement is served to the limit the platform allows.

---

## 5. CYCLE-2 FIX VERIFICATION (issues in my scope)

| Issue | Verdict | Note |
|---|---|---|
| HI-1 (RN redesign) | **FIXED (with one integration gap)** | Mechanism now factually correct: structured `notification_messages` template, fixed taxonomy, platform-rendered prompt, OTN as distinct `one_time_notif` flow, `optin_config` stores template payload — all sound. Residual gap is the send-path integration (ME-B3): the outbox/matrix can't express a template send. |
| HI-2 (AddOrderDialog facts + catalogScope) | **FIXED (with a spec bug)** | All code facts now verified exact (onCreated no-args at 897 with values in scope; sourceName not id; raw phone; self-fetch lines 284–321). catalogScope prop exists but its own filter spec is wrong for variations/URL length (ME-B1). |
| ME-2 (outbox realtime) | **FIXED** | Two postgres_changes handlers (INSERT+UPDATE) on one channel + REPLICA IDENTITY FULL on message_outbox — the transitions now reach the UI; churn bounded honestly. |
| ME-4 (window rewind guards) | **FIXED** | GREATEST on all three bookkeeping columns, NULL-safe; platform_timestamp basis retained. |
| ME-6/ME-7 (storage policies) | **FIXED** | Upload constrained to `{business}/{conversation}/` with EXISTS check; uuid-regex guards before the cast; volumes stated; client-side-only mime enforcement stated; Phase 2 smoke test added. |
| ME-8 (opt-out scope) | **FIXED** | Opt-out now suppresses all outbound (agent, automation, campaign) except ACCOUNT_UPDATE/POST_PURCHASE, wired into §5.2 row 2, composer banner included. |
| ME-10 (campaign↔topic linkage) | **FIXED** | `bulk_campaigns.notification_topic` + CHECK + pinned recipient JOIN with taxonomy key and active/expiry conditions. |
| ME-11 (OAuth flow) | **FIXED** | §4.7 complete: state CSRF, server-side exchange (app secret never crosses browser), page + linked-IG discovery, picker, subscribe POST, error surfaces, manual fallback. Residual nits LO-B8 (connect_sessions undefined) — minor. |
| ME-12 (attachment latency) | **FIXED** | Downloads fully off the critical path from day one: meta_url + download_pending at insert, sweep downloads (batch 25, 24h retry), only the insert is on the 20s path. |
| ME-13/14 (LO items) | **FIXED** | All 13 LOWs landed as claimed in §19's index — spot-verified LO-1 (numeric guard + typed queries), LO-2 (guarded 'fb/ig' seed), LO-5 (hand-written archive DDL, idempotent), LO-6 (timeout_unknown never auto-retried), LO-7 (tuple keyset), LO-10 (keepalive fetch close + force-close sweep), LO-11 (atomic counters), LO-12 (capped RPC), LO-13 (`.eq('updated_at')` stale-check), LO-14 (`.limit(2)` + full merge RPC — the RPC itself has the HI-B2 bug, but the LO-14 lookup/dedup design is correct). |

## 6. Issue Count (cycle 3, Critic B)

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 5 | HI-B1 … HI-B5 |
| MEDIUM | 6 | ME-B1 … ME-B6 |
| LOW | 8 | LO-B1 … LO-B8 |

## 7. What v4 must do (priority order)

1. Seed `rate_limit_buckets` (upsert-on-consume or trigger) + Phase 2 smoke test (HI-B1) — one statement, currently kills all sends.
2. Delete the nonexistent `conversation_orders.customer_id` UPDATE from `merge_chat_customers` (HI-B2) — one statement, currently aborts every merge.
3. Resolve the §2.5.4/§6.1 `orders.business_id` contradiction and make the link path actually backfill it (HI-B3).
4. Rewrite §4.4 step 4 as watermark-based read marking (HI-B4).
5. Pick an invoice PDF mechanism and spec it in §18 + Phase 4 (HI-B5).
6. Fix catalogScope's filter columns (`product_id`, `store_id`) (ME-B1); pin the opt-in template-send derivation in §5.1/§5.2 (ME-B3); resolve the archive-search claim (ME-B4); correct the §5.1 claim sketch (ME-B5); add the a11y contract (ME-B6); kill or wire `conversations.tags` (ME-B2).
