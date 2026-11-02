# SIGNUP-CRITIQUE-4 — Adversarial Review, Round 4

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v4 + all prior critiques.
Reviewer additionally disproved two *plan-side* worries itself (woo-sync cron excludes `disconnected` stores; `profiles` cascades on delete) and verified the RPC gate is implementable as specced.

All 11 findings validated against plan text. Classification: **11 × Valid + actionable**. Cumulative: 56 findings, 56 actionable; severity converging (BLOCKERS 3→2→4→**0**; MAJORS 8→8→5).

## Dispositions

### MAJORS

1. **Task 1.6 join path unimplementable as written** — verified: operational tables carry nullable `store_id … ON DELETE SET NULL` (20260407071618), leaf tables (`order_items` etc.) have no store_id, and the only store→business link is nullable non-unique `brands.woo_store_id`; also my §1 cite was wrong — 20260911000400 is *global* `has_permission` gating, not a member-scoped pattern.
   → ACTIONABLE: Task 1.6 rewritten around a required **policy matrix** (per table: scope path, NULL-store rule, leaf-table join strategy, `brands.woo_store_id` uniqueness/singleton decision, EXISTS-join perf budget); Task 0.1 gains that join-chain inventory; §1 cite corrected.
2. **Task 1.6 vs global staff contradiction** (DoD "cross-tenant denied" vs global `staff` writes).
   → ACTIONABLE: explicit product decision recorded — platform `admin`/`staff` are **company employees with platform-wide scope by design** (existing system semantics retained); Task 1.6 member-scopes *owner-type* principals; DoD reworded to "cross-tenant denied for member principals; platform roles global by design"; disclosed in §13.
3. **Purge grace attacker-controllable via anonymous `resend` events** → ACTIONABLE: resend moved into edge fn `auth-resend` (Turnstile + per-IP/per-email throttle, server-side GoTrue `admin.generateLink`, **server-writes the `resend` event**); `resend` removed from client whitelist; purge predicate now depends on server-written events only; new test "foreign resend events never extend grace".
4. **Anchor channel-blind** — any fresh account (invite-accept/OAuth/admin-created) could self-anchor within 24 h.
   → ACTIONABLE: `signup-event` gets its own Turnstile; provision additionally asserts `raw_app_meta_data.provider='email'` AND `invited_at IS NULL`; residual documented (admin-created <24 h edge case requires an admin — trust boundary intact).
5. **`email_confirmed` mechanism unspecified in a verify_jwt=false fn** → ACTIONABLE: payload `{event:'email_confirmed'}` only; fn calls `auth.getUser(bearer)`, verifies `email_confirmed_at` set + user matches; generic reject + `blocked` audit otherwise; forged-token test added §10.9.

### MINORS

6. **Anchor window breaks on retried `signUp`** → ACTIONABLE: fresh nonce + fresh `signup_started` before every signUp attempt; §10.3 test.
7. **Repeat-signup metadata-overwrite semantics unverified** → ACTIONABLE: Task 0.1 item; client auto re-mints/re-posts anchor on repeat (pairs with #6).
8. **Recipient escape impossible without password** → ACTIONABLE: flow = confirm → set-password (recovery template) → session → `delete_unprovisioned_self()`; §8 copy item; §10.8 E2E.
9. **Provisioned storefront is public by default** (`is_active=true`, anon-selectable) → ACTIONABLE: provision with `is_active=false`, flipped in `/welcome`; §10.2 test.
10. **Fresh-environment bootstrap leaves no platform admin** → ACTIONABLE: runbook step (seed admin before `signup_open=true`); DoD SQL assertion scoped to envs with a pre-existing admin.
11. **Acceptance-criteria gaps for round-3 machinery** → ACTIONABLE: five explicit test lines added to §10.

Round-4 verdict: plan NOT acceptable as v4 → all fixes applied in v5. Round 5 reviews v5 + all critique files.
