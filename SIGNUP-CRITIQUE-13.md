# SIGNUP-CRITIQUE-13 — Adversarial Review, Round 13

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v13 + all prior critiques.
All round-12 fixes verified present; ground-truth spot-checks clean (trigger shape, parity migration, `stores` admin-only SELECT as tightened in 20260415001620, captcha pass-through on all four auth-js calls, profiles cascade, effort table sums to exactly 30.0). No fabricated ground truth. Bigger-looking candidate findings collapsed on analysis.

Classification: **6 × Valid + actionable (all MINOR)** — the first round with zero substantive-severity findings. Cumulative: 136 findings, 136 actionable.

## Dispositions (all MINOR)

1. **Route exhaustiveness final gap** — unconfirmed + no UBA + no anchor + no invite + age ≤48 h (anchor-post-failure cohort, anticipated by §10.8's own E2E) matched no route → ACTIONABLE: route (d) widened to "unconfirmed, no invite, AND (unconsumed anchor present OR age ≤ 48 h) ⇒ typed no-op"; §10.6 sub-state added.
2. **`signup_events.user_id` delete-action unspecified** — plain FK would throw on self-delete; CASCADE would erase the audit rows written around deletions → ACTIONABLE: §4 pins `user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL`; purge-written rows carry `user_id` NULLed at insert.
3. **Retention mechanism column contradicted for `self_deleted_unprovisioned`** (RPC-written, never passes the cron "in-job") → ACTIONABLE: self-delete RPC writes its audit row with `email := NULL` at insert; mechanism column split per producer.
4. **Password floor was client-only** (direct POST bypasses zod; GoTrue default min = 6) → ACTIONABLE: §8 checklist item — GoTrue min password length = 10 before Phase 1; §10.9 row: tokened direct-API 6-char signUp rejected.
5. **Anchor-cap recovery vs clocks unspecified** (bucket type; rolling-24h could make "next bucket" recovery dead-on-arrival against the 24 h provision epoch) → ACTIONABLE: rolling-24 h bucket pinned; rule added — locked-out already-created accounts with insufficient epoch left route to the gate-expiry restart path instead of waiting; §10.8/§13 aligned.
6. **Invite-side canonical lookup lacked the multi-match guard the resend side got in round 11** (gmail dot-variants distinct but canonicalize identically) → ACTIONABLE: exact-stored-email match wins; multiple canonical matches without exact ⇒ typed ambiguous-target error, never send/delete; §10.6 row.

Round-13 verdict: 6 MINOR fixed in v14. Round 14 = final confirmation pass (expected: nothing substantive).
