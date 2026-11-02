# SIGNUP-CRITIQUE-1 — Adversarial Review, Round 1

Reviewer: fresh-context agent (single-model). Cross-model second opinion: **skipped by user choice**.
Reviewed artifact: `SIGNUP-PLAN.md` v1 (initial draft).
Method: adversarial issues-only review against contract + verification of factual claims against repo (login.tsx, useauth.tsx, usePermissions.tsx, supabase/functions/, supabase/migrations/ — esp. 20260412161413).

All 15 findings validated against the plan text by the orchestrator. Classification: **15 × Valid + actionable** (0 contract-misread, 0 trade-off, 0 noise).

## Dispositions

### BLOCKERS

1. **Global-admin grant to self-signups** — Verified: `user_roles` is global (`UNIQUE(user_id,role)`, no tenant scope), `usePermissions.tsx` short-circuits on `isAdmin`, and RLS write policies use `has_role(auth.uid(),'admin')` with no store predicate.
   → DISPOSITION: ACTIONABLE. Plan rewritten: owner gets **per-store owner permissions** via existing per-store RPCs (`get_user_permissions`/`get_user_store_ids`), never a global `user_roles` row. Plan now forbids global role assignment in the provisioning path.
2. **Fabricated ground truth + ignored `handle_new_user` trigger** — Verified: no `workspaces`/`memberships` tables; `stores` has no slug/owner column; `20260412161413` already fires `AFTER INSERT ON auth.users` → creates profile, assigns role (null if uninvited), auto-consumes pending invitations.
   → DISPOSITION: ACTIONABLE. §1 rewritten with only verified facts; trigger interaction is now a first-class design section (§3.1), including the owner-intent metadata guard.
3. **Turnstile token "re-verification" breaks provisioning** — Turnstile tokens are single-use (`timeout-or-duplicate`).
   → DISPOSITION: ACTIONABLE. Re-verify deleted. Single verification by Supabase at `signUp`; provision is JWT-gated instead, rationale documented.

### MAJORS

4. **`app_config` didn't exist** → ACTIONABLE: added to schema list (task 1.1) with RLS (anon-read, service-write) + seed row.
5. **Kill switch only in UI** → ACTIONABLE: `signup-provision` checks `signup_open` on every request; returns generic closed error. UI flag is UX-only.
6. **Phantom "already registered" notice email** (not a GoTrue feature — fake-success, silence) → ACTIONABLE: §5.2 rewritten; UX consequence (existing user finds out via login/forgot-password) documented; §8 template list corrected.
7. **`signup_events` unwritable by client-originated events under its own RLS** → ACTIONABLE: added tiny insert-only `signup-event` edge function (rate-limited); all other rows written server-side via service role.
8. **SECURITY DEFINER language pasted onto an edge function; RLS INSERT policies missing** → ACTIONABLE: single execution mode specified — edge function (HTTP/auth/flags/rate-limit) calling one atomic `provision_owner_account()` Postgres SECURITY DEFINER function (`SET search_path=''`) via service-role RPC. No direct client inserts into tenant tables.
9. **Pending invitation auto-consumed by self-signup trigger** → ACTIONABLE: trigger patched to skip invitation consumption when `raw_user_meta_data->>'signup_intent'='owner'`; event audited; regression tests for staff-invite path required.
10. **"Reuse login page's enumeration-safe pattern" was false** (login toasts raw `error.message`) → ACTIONABLE: enumeration-safe response mapper is new build work (with unit tests); noted as a hardening util, not a reuse.
11. **Missing journeys: typo'd email, expired link, unconfirmed-account cleanup** → ACTIONABLE: three explicit flows added (restart-with-corrected-email; expired-link → resend; scheduled purge of unconfirmed users > 7 days incl. trigger-created profile rows; all audited).

### MINORS

12. **"ONE transaction" vs `202 in_progress` poll contradiction** → ACTIONABLE: provision is synchronous — `200 {store_slug}` or typed 4xx/5xx; no polling.
13. **`citext` + `config.toml` auth sections don't match repo** → ACTIONABLE: citext dropped; auth URL/redirect/settings config recorded as dashboard-managed with a written checklist (local `config.toml` is functions-only).
14. **Incoherent PII retention + unverified "matches existing patterns" claim** → ACTIONABLE: single retention table in §9 (field / retention / purge mechanism), plus pg_cron purge job added to tasks.
15. **Per-email throttles defeated by aliasing; unprovable timing claim** → ACTIONABLE: alias normalization (strip `+tag`, gmail dots) before throttle/dedupe keys; timing claim downgraded to "identical response text/status; timing uncontrolled — residual risk noted."

Round-1 verdict: plan NOT acceptable. All 15 fixes applied → `SIGNUP-PLAN.md` v2. Round 2 reviewer gets v2 + this file (to avoid repeat findings).
