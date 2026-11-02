# SIGNUP-CRITIQUE-8 — Adversarial Review, Round 8

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v8 + all prior critiques.
Verified: GoTrue `CaptchaConfiguration` = `{Enabled, Provider, Secret}` only — **no per-endpoint scope**; `verifyCaptcha` mounted on `/token` (password login), `/recover`, `/signup`, `/resend`. GoTrue login returns `email_not_confirmed` for registered-unconfirmed emails but merges unknown-email/wrong-password into one message. `user_roles` has no `accepted_at` column; only `invitations` does (20260412161413; precedent: synthetic rows, team-manage/index.ts:158–163). `app_settings` policies DO call `has_permission()` (20260911000400:20/24/26). Backfill also writes a `woocommerce` selling_point per brand with `woo_store_id` (20260904000100:505–520).

All 11 findings validated against plan text. Classification: **11 × Valid + actionable**. Cumulative: 102 findings, 102 actionable.

## Dispositions

### BLOCKER

1. **§8.3 "captcha scoped to signup+resend" unimplementable — GoTrue captcha is all-or-nothing**, mounted on login/recovery too; both clauses of §8.3 were mutually unsatisfiable.
   → ACTIONABLE: adopted option (a): GoTrue captcha ON globally; login + reset-password forms gain **invisible Turnstile tokens** (UX unchanged; implementation-only change); Goal-4 wording amended ("zero user-visible regression; login/MFA/reset behavior identical, now captcha-tokened"); §10.9's tokenless-rejection test now valid; zero-regression suites re-assert login/reset WITH token pass.

### MAJORS

2. **Login leaked the `email_not_confirmed` oracle** (the one distinction GoTrue actually emits — registered+unconfirmed) → ACTIONABLE: §6.4 mapping corrected — `email_not_confirmed` ALSO maps to the generic credential error; unconfirmed users get a universal "Didn't get a confirmation email?" link on login (no oracle, available to everyone); unit-tested §10.1.
3. **§7 stale-delete had silently dropped round-3's guards** (no owner-marker check, no age/anchor floor — could annihilate a mid-flight owner signup) → ACTIONABLE: full predicate restored: `no UBA AND no owner marker AND unconfirmed AND (age > 48 h OR no unconsumed anchor)`.
4. **§7 void branch + `accepted_at` column mismatch** (confirmed-null-role-no-UBA users fell through to an always-rejecting inviteUserByEmail; `accepted_at` lives on `invitations`, not `user_roles`) → ACTIONABLE: third branch spec'd (confirmed & no UBA ⇒ direct attach — admin explicitly invited); `accepted_at=now()` written into a **synthetic invitations row** (create_with_password precedent cited).
5. **Parity set STILL incomplete** — `woocommerce` selling_point per brand-with-store (per the cited backfill) omitted; facebook row undecided → ACTIONABLE: parity defined *by reference* ("exactly what 20260904000100 §§5–7 produces for this `woo_store_id`, statuses adjusted to disconnected") + `woocommerce` point enumerated; facebook row decision delegated to Task 0.1 with an explicit include/exclude record; §10.3 assertions updated.

### MINORS

6. **`has_permission()` claim false** (app_settings policies do call it) → ACTIONABLE: §1 sentence corrected + Task-0.2 acceptance: owner bundle must exclude every permission referenced by a global-scope policy (`settings.manage` explicitly excluded).
7. **Anchor-cap exhaustion was a silent dead-end** → ACTIONABLE: `/check-email` gains a distinct rate-limited state ("try again after <bucket reset>"); §10.8 case: 4th anchor rejected → rate-limit UI; same user succeeds next day.
8. **Purge predicates read backwards** (timestamp vs interval) → ACTIONABLE: age form (`created_at < now() - interval '26 hours'`; `invited_at < now() - interval '30 days'`).
9. **Consent scrub had no owner/task** → ACTIONABLE: honestly scoped — v1 has no account-deletion path; retention table row reworded ("retained for consent lifetime; scrub deferred to the future account-deletion phase"); removed from 4.1.
10. **Fresh-env runbook window left open** (GoTrue signup is enabled regardless of app flag; first-user-admin branch reachable pre-seed) → ACTIONABLE: runbook reordered — 1) dashboard "disable email signups" at project creation, 2) seed platform admin via SQL/service key, 3) deploy app dark, 4) re-enable at Phase 1 flip.
11. **Estimates never repriced for the added test blocks** → ACTIONABLE: 1.4 → 1 d; 3.1/3.2 → 4 d combined; program now **~26.5 person-days ≈ 5+ weeks single-stream**; two-stream critical path ~3.5 weeks.

Round-8 verdict: plan NOT acceptable as v8 → all fixes applied in v9. Round 9 reviews v9 + all critique files.
