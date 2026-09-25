# SIGNUP-PLAN — Self-Serve Sign-Up System for shohozbiz

> Status: DRAFT v12 (post-critique rounds 1–11 — see `SIGNUP-CRITIQUE-1..11.md`)
> Scope (user-confirmed): **New business owners self-register**; sign-up provisions, in ONE transaction: business + brand(linked) + default location + store + storefront(inactive, named, linked) + full parity rows (per 20260904000100 §§5–7, statuses adjusted to `disconnected`) + owner membership + permission bundle + one store-access row. Never a global role.
> Stack: Vite + React + TypeScript + shadcn/ui; Supabase (Auth, Postgres + RLS, Edge Functions).
> Effort: **~29.5 person-days ≈ 6 weeks single-stream**; two-stream critical path **~4 weeks, contingent** (2 engineers; streams in §12; round-9 repricing: 1.6a review loop + E2E).

---

## 1. Ground truth (verified against repo, rounds 1–8, migration/lib cites)

**Auth & UI**
- `src/pages/login.tsx` — login, TOTP MFA, reset; toasts **raw `error.message`**. Two planned edits: enumeration-safe mapper + **invisible Turnstile token** on login/reset (§6.1/§6.4) — user-visible behavior unchanged.
- `useauth.tsx` — `AuthProvider`: `user`, `session`, `role` from global `user_roles`.
- Auth config is **dashboard-managed**; `supabase/config.toml` has no auth/captcha sections.
- **GoTrue captcha is all-or-nothing** (`CaptchaConfiguration{Enabled,Provider,Secret}`; mounted on `/token` login, `/recover`, `/signup`, `/resend`) — no per-endpoint scope. Enabled globally as part of this plan; login/recovery adopt invisible tokens to stay functional (§8.3).
- **GoTrue login messages**: unknown email and wrong password are merged ("invalid login credentials"); **registered-but-unconfirmed returns `email_not_confirmed`** — an oracle, mapped to generic by the client (§6.4).
- `raw_user_meta_data` = user-writable anytime → **untrusted hint only**.
- **auth-js 2.104.0 facts**: `signUp({email, password, options:{captchaToken, data}})` — nested shape only; `auth.resend({type:'signup', email, options:{captchaToken}})` is the resend primitive; GoTrue `/resend` returns **200/empty for confirmed emails** (no send) → pre/post unconfirmed checks required; **no by-email admin lookup** (`listUsers({page,perPage})` scan / `getUserById` only) → `get_auth_signup_state` SQL fn (§4); `admin.generateLink` unusable for resends.
- Turnstile tokens: single-use, 300 s expiry → re-execute widgets per attempt.
- **Canonical email normalizer** (shared by ingest, gate, rate limits): `lower(trim(email))`, strip `+tag`, strip gmail dots.

**Tenant & permission model (verified)**
- `user_roles` global (UNIQUE(user_id,role), 20260412161413); writes on operational tables use global `has_role('admin'|'staff')`; `stores` SELECT admin-only; `user_has_store_access` definition-only. **`has_permission()` is called by `app_settings` policies only (20260911000400:20/24/26)** — and is therefore a global-scope permission (`settings.manage`); owner bundles must exclude such keys (Task 0.2 acceptance).
- Read side open today (SELECT `USING(true)` for authenticated; 28 direct client writes) → Task 1.6 member-scoping is a launch blocker. `user_store_access` fail-open (zero rows = ALL) — resolved per-table in 1.6a.
- Business layer (20260904000100): `businesses` (INSERT platform-admin only), `user_business_access`, `brands` (member `FOR ALL` write, no column restriction → column-restricted in 1.6a; `woo_store_id` nullable/non-unique → 1.6a UNIQUE-partial-index decision), `locations`. **Parity set = exactly what migration §§5–7 produces per brand-with-store**: connectors (channel), selling_points (`showroom_pos`; `dokanos_storefront` carrying `storefront_id`; **`woocommerce`**), `product_sources`, `customer_sources` — statuses adjusted to `disconnected`. (facebook `order_sources`-dependent row: include/exclude decided in Task 0.1.)
- `create_business_with_owner` (20260911000130): caller-JWT; name ≤100; currency/timezone allow-lists; slug `^[a-z0-9]+(-[a-z0-9]+)*$` 2–60. Not granted to self-serve.
- Row shapes: `stores(name TEXT NOT NULL, url TEXT NOT NULL, status CHECK(connected|disconnected|syncing|error) default 'disconnected')`; `storefronts(name NOT NULL, store_id, slug NOT NULL UNIQUE, is_active default true; anon SELECT exposes store_id; only UPDATE policy is global-staff)`.
- Placeholder-store blast radius: existing UIs read `stores` unfiltered (`useStoresList.ts:15`, `StorefrontsPage.tsx:238` maybeSingle) → §10.11 consumer guards. woo-sync cron excludes `disconnected`; `profiles` cascade on delete.
- `handle_new_user` trigger (20260412161413): profile insert; invitation-consume branch; ELSE first-user ⇒ global admin.
- `team-manage`: `inviteUserByEmail` rejects registered emails; recovery-email fallback; synthetic `invitations` rows precedent (index.ts:158–163) — `accepted_at` lives on `invitations`, NOT `user_roles`; stale-deletes null-role users. Staff role = global by design.
- RPCs: `get_user_permissions(_user_id)`, `get_user_store_ids(_user_id)` — PUBLIC, read-only, arbitrary `_user_id` (pre-existing enumeration; separate phase). No grant RPC.
- `auth.users` fields: `email_confirmed_at`, `invited_at`, `raw_app_meta_data.provider` (Task 0.1 re-verifies).
- Cron pattern (20260824000000): pg_cron → edge fn + cron-secret, 300 s.
- **ASSUMED until Task 0.1**: owner permission-key bundle; residual NOT-NULL inventory; `stores` consumer list completion; repeat-signup metadata behavior (**no longer gate-critical** — nonce rides the provision request body, §3); `last_sign_in_at`; `invited_at`/`provider` semantics.

## 2. Goals and non-goals

**Goals**
1. Owner registers → one asserted transaction (§3 authoritative row list). **Zero** `user_roles` rows from self-serve.
2. Email verification before access.
3. No enumeration (incl. the `email_not_confirmed` login oracle); consent server-anchored/versioned; abuse-resistant; no unconfirmed zombies (26 h purge); invitee hygiene (30 d sweep).
4. Zero **user-visible** regression: login/MFA/reset behave identically (implementation gains invisible captcha tokens; MFA challenge untouched); `team-manage` invites unchanged in UX.
5. Runtime kill of signup in <1 min; full closure = dashboard step (§11.2 ordering).

**Non-goals (deliberate)**
- No OAuth, phone OTP, billing (v2+).
- No account-deletion flow for provisioned users in v1 (consent IP/UA scrub deferred to that phase — §9).
- Legacy `_user_id` RPC enumeration: separate phase.
- Platform `admin`/`staff` remain platform-wide by design; Task 1.6 member-scopes owner principals only.

## 3. Architecture

```
[Signup form] → zod → per attempt: re-execute Turnstile widgets (fresh t_event + t_signup)
      + fresh nonce N (minted client-side, PERSISTED in localStorage as signup_nonce)
  → supabase.auth.signUp({ email, password,
        options: { captchaToken: t_signup,             ← nested (only honored shape)
                   data: { owner marker, nonce } } })  ← metadata echo = DIAGNOSTIC ONLY
  → on response: POST signup-event {signup_started, email,
      meta:{consent versions = SERVER values, business_name≤100, nonce: N},
      captchaToken: t_event}
      (fn self-siteverifies t_event; stamps tos_version/privacy_version from app_config;
       ≤10/h/IP; ≤3/day/email scoped to signup_started; cap-reject → distinct /check-email
       rate-limited UI, §5.2)
  → trigger: profile; skip BOTH role branches for owner intent
  → generic success
  → email link → /auth/confirm (interactive; no-session → "Sign in to finish";
      typo-recipient: set-password → sign-in → delete_unprovisioned_self())
  → signup-event {email_confirmed} — bearer-bound (auth.getUser + email_confirmed_at)
  → POST signup-provision (verify_jwt ON; kill switch; throttle; id from gateway JWT;
      body: { nonce }  ← client re-reads persisted signup_nonce and submits it here)
      → RPC provision_owner_business(p_user_id) via service key:
          SECURITY DEFINER, SET search_path='', REVOKE PUBLIC/anon/authenticated,
          GRANT EXECUTE TO service_role; pg_advisory_xact_lock(hashtext(p_user_id))
          GATES (generic reject unless all true):
            user exists; email_confirmed_at NOT NULL; unprovisioned;
            users.created_at ≥ now() - interval '24 hours';
            provider='email'; invited_at IS NULL;
            canonical(user.email) NOT IN disposable_email_domains   ← 'BLOCKED_DOMAIN'
            UNCONSUMED server-written signup_started row with
            canonical(anchor.email) == canonical(user.email) AND
            anchor.meta.nonce == REQUEST-BODY nonce AND
            anchor.created_at ≥ users.created_at - interval '2 minutes' AND ≤ 24h before NOW
          (anchor = consent/attribution + cross-account binding; trust boundary =
            confirmed fresh email-provider account — same as signup itself; §13;
            the nonce lives on the client-submitted body, NEVER on mutable user metadata — §1)
          if provisioned → {slug} (idempotent)
          ONE transaction + post-insert assertions (authoritative):
            businesses(name≤100 from anchor, slug, 'BDT', 'Asia/Dhaka')
            stores(name=<business>, url='https://<slug>.' || app_config.storefront_domain,
                   status='disconnected')   ← domain sourced from app_config seed (§4)
            brands(business_id, name=<business>, slug, woo_store_id := stores.id)
            locations(business_id, brand_id, name='Main', type='showroom', is_default=true)
                       ← type matches backfill convention (20260904000100:490–491; 0.1 verifies)
            storefronts(name=<business>, store_id, slug, is_active=false)
            CONNECTORS + SELLING_POINTS + PRODUCT_SOURCES + CUSTOMER_SOURCES
                   = exactly 20260904000100 §§5–7 output for this brand,
                     statuses adjusted to 'disconnected' (facebook row decided in 0.1),
                     bindings set: showroom_pos.location_id := default location;
                     dokanos_storefront: storefront_id + woo_store_id := stores.id;
                     woocommerce point: woo_store_id := stores.id
            user_business_access('owner'); permission bundle; user_store_access (exactly 1)
            consent_records(SERVER versions; ip/ua := anchor's signup_started ip/ua
              — the ACCEPTANCE-time actor; provision-call IP stays in signup_events audit;
              UNIQUE(user_id,doc); ON CONFLICT DO NOTHING)
            audit 'provisioned'; mark anchor consumed
      → 200 {slug} | typed 4xx/5xx
  → /welcome → publish_my_storefront() (flip-only site_opened) → dashboard
```

**Resend flow**: client → `auth-resend` (verify_jwt=false; forwards token to GoTrue — never siteverifies GoTrue-consumed tokens; ≤3/h/email + ≤20/h/IP): (1) `get_auth_signup_state(email)` comparing **canonical-normalized** forms, multiple canonical matches ⇒ generic reject + `blocked` audit → proceed only if exactly one row, exists, unconfirmed, `invited_at IS NULL`; (2) anon-client `auth.resend(...)` called with the **STORED** email returned by the lookup — never the typed alias; (3) post-call re-check `email_confirmed_at` (TOCTOU suppression); write `resend` only for genuine dispatch; all paths return the SAME generic payload.

**Publish**: `publish_my_storefront()` SECURITY DEFINER (caller-JWT; §6.7 hygiene; membership assert = brand-join **cross-checked via the transaction-owned selling_points storefront link**; **rejects when >1 brand joins the store**; hard dep: 1.6a UNIQUE-partial-index decision landed; sets ONLY `is_active=true`; flip-only).

**Login/reset forms**: add invisible Turnstile (`options.captchaToken`) — global GoTrue captcha is ON (§8.3). Mapper: `email_not_confirmed` and `invalid_credentials` → same generic error; universal "Didn't get a confirmation email?" link on login (oracle-free).

### 3.1 Trigger patch: owner marker ⇒ skip BOTH role branches; audit skip only when an invitation was pending. Everything else unchanged.

## 4. Data model

**New (Tasks 1.1/1.2):**
1. `consent_records(user_id, doc, version, accepted_at, ip, ua)` — UNIQUE(user_id,doc); RPC-only; select-own RLS; versions copied from `app_config` server values.
2. `signup_events(id, email text null, event CHECK-whitelist [signup_started|email_confirmed|provisioned|provision_failed|resend|blocked|purged_unconfirmed|owner_signup_trigger_skipped_invite|self_deleted_unprovisioned|site_opened|staff_role_attached|invitee_expired], user_id null, ip, ua, meta jsonb server-schema-validated incl. consumed flag, created_at)`. No client select/insert.
3. `disposable_email_domains(domain pk)` — seeded in 1.1 (maintained source + update cadence).
4. `app_config(key, value jsonb)` — seeds: `signup_open=false`, `tos_version`, `privacy_version`, `storefront_domain`, `invitee_expiry_enabled=true`; anon/auth select ONLY `signup_open`; service-write.
5. `rate_limit_hits(key, bucket, count, pk(key,bucket))`.
6. SQL fns: `provision_owner_business`, `publish_my_storefront`, `delete_unprovisioned_self`, `get_auth_signup_state(p_email)→{id, email (stored, for dispatch), email_confirmed_at, invited_at}` — all §6.7 hygiene.

**Reused:** business layer (§1). Slugs: candidate set `^[a-z0-9]+(-[a-z0-9]+)*$` (2–60); fallback `store-<4 random>`; retry ≤5 across all three UNIQUE columns.

## 5. Flows

### 5.1 Happy path
1. Validate email/password (≥10, top-10k, zxcvbn)/name ≤100/versioned consent (server-versioned at anchor time).
2. Per attempt: fresh `t_event` + `t_signup` (re-executed widgets) + fresh nonce → `signUp` → anchor post → generic success. **Anchor-cap rejection** (`signup-event` 429) → `/check-email` shows a distinct rate-limited state ("too many attempts today — try again after <bucket reset>"), not a dead retry loop.
3. Link → `/auth/confirm` → session: `email_confirmed` → provision → `/welcome` → publish → dashboard. No session → "Sign in to finish" (scanner-safe).
4. `/welcome`: confirm name → defaults → MFA nudge.

### 5.2 Edge cases
- Repeat signup (verified email): generic success; silent (accepted).
- Repeat (unconfirmed): generic success + Resend (fresh nonce/tokens/anchor per attempt); provision-time window covers resend-then-confirm within 24 h.
- Provision failure: typed codes → `/welcome/setup-failed` + idempotent Retry.
- **Gate expiry (>24 h)**: restart via `delete_unprovisioned_self()` → fresh signup (audited; E2E); email occupied meanwhile (residual §13).
- Orphan (<24 h): login → resume-setup guard; **resume-setup re-executes Turnstile + mints a fresh nonce + re-posts `signup_started` on demand** (covers anchor-post-failure after signup) then re-calls provision.
- Typo'd email: sender-side restart; recipient: confirm → recovery/set-password → session → `delete_unprovisioned_self()` (caller-JWT; self-only; zero tenant + zero roles; throttled; audited).
- Expired link → resend screen.
- Concurrent provisions → advisory lock + idempotency.
- Owner invited as staff later → §7.
- Purge (`purge-unconfirmed` cron edge fn; age-form predicates):
  - unconfirmed self-signups: `email_confirmed_at IS NULL AND invited_at IS NULL AND created_at < now() - interval '26 hours'`
  - invitee expiry (ops-toggle `invitee_expiry_enabled`): `invited_at IS NOT NULL AND email_confirmed_at IS NULL AND invited_at < now() - interval '30 days'` → audit `invitee_expired`
  - batched `admin.deleteUser` (≤300 s); audit emails NULLed.

## 6. Security & abuse controls

1. **Turnstile discipline** (single-use, 300 s): per attempt re-execute widgets; `t_event` siteverified by `signup-event`; `t_signup`/resend/login/recovery tokens forwarded nested to GoTrue (captcha globally ON). No double siteverify.
2. Kill switch: `signup-provision`, `signup-event`, `auth-resend` + runtime UI read `signup_open` live → generic closed errors.
3. Rate limits (canonical-normalized keys): provision ≤5/h/IP; resend ≤3/h/email + ≤20/h/IP; `signup-event` ≤10/h/IP + ≤3/day/email (`signup_started` only); `delete_unprovisioned_self` ≤3/h/actor.
4. Enumeration hygiene — per-call mapping (unit-tested): signup/resend/reset generic; **login: invalid-credentials AND `email_not_confirmed` → same generic error; captcha-rejection errors (ALL FOUR calls: login/reset/signup/resend) → "Refresh and try again"** (oracle-free); MFA untouched; provision typed codes only.
5. Disposable domains: authoritative gate in provision RPC (seeded list); **client pre-check uses a build-time bundled snapshot** of that list (staleness documented — may lag server truth; the RPC gate is the enforcement point).
6. Passwords never logged/`meta`; leak-protection if tier.
7. RPC hygiene — ALL four new SQL fns: SECURITY DEFINER, `SET search_path=''`, REVOKE PUBLIC/anon/authenticated, per-fn grants; full rollback; assertions.
8. `signup-event`: verify_jwt=false + `t_event` siteverify; whitelist {`signup_started`, `email_confirmed`}; `email_confirmed` needs valid bearer + `email_confirmed_at`, no client email; terminal events server-only; **server-stamped consent versions**.
9. Consent: single writer = provision RPC (server versions); UNIQUE + ON CONFLICT.
10. Audit + retention (§9).

## 7. Integration with existing auth

- `useAuth` gains `permissions`/`storeIds`/`businesses` via existing read RPCs; role logic untouched.
- Routes: `/signup`, `/check-email`, `/auth/confirm`, `/welcome`, `/welcome/setup-failed` — runtime `signup_open`-aware; login/reset forms gain invisible Turnstile tokens (§6.1).
- MFA untouched; nudge in `/welcome`. Login: "Create account" link (runtime flag) + universal resend link.
- Zero-permission users → resume-setup guard.
- **Task 2.4 team-manage spec (five routes, exhaustive)** — input = invited email resolves to existing user:
  a. User WITH `user_business_access` ⇒ skip `deleteUser`/`inviteUserByEmail`; insert `user_roles('staff')` (**if a staff row already exists ⇒ typed no-op success**, never a UNIQUE-violation 500); write synthetic `invitations` row with `accepted_at=now()` (audit parity, precedent team-manage/index.ts:158–163); audit `staff_role_attached` (inviter, ts); recovery-email copy "you were granted staff access" (platform-wide disclosed in invite UI).
  b. **Confirmed user, no UBA, no owner marker** ⇒ direct attach (same as (a), incl. duplicate-role no-op).
  c. Stale-delete ONLY when: no UBA AND no owner marker AND **`invited_at IS NULL`** AND unconfirmed AND (age > 48 h OR no unconsumed `signup_started` anchor).
  d. **No UBA AND owner marker present** ⇒ no delete, no attach — typed error "account has a pending self-serve setup" (admin waits for 26 h purge or support).
  e. **Pending invitee re-invite** (`invited_at IS NOT NULL`, unconfirmed) ⇒ pass through to `inviteUserByEmail` (native re-send), never delete, never attach.

## 8. Emails & config (dashboard checklist; ■ = launch blocker)

1. ■ **Confirm signup** + **recovery/set-password** templates (recovery copy covers typo-recipient path). No "already-registered" template exists.
2. ■ SITE_URL per env; redirect allow-list: `/auth/confirm`, `/welcome`, `/check-email`, `/reset-password`, `/welcome/setup-failed`.
3. ■ **GoTrue captcha ON (global — only mode available)**: Turnstile configured in Auth settings; login/reset forms updated to supply tokens (§6.1) BEFORE the toggle flips; MFA path verified post-flip; §10.9 asserts tokenless signUp rejected. Sequencing: ship tokenged forms first, then enable.
4. ■ **SMTP** quota + deliverability tested.
5. ■ **Edge-fn env / config seeds**: service key, cron secret, Turnstile secret, `storefront_domain` (app_config seed read by provision for `stores.url`).
6. Resend UX: cooldown countdown; server throttles authoritative.

## 9. Analytics & retention

- Funnel: `signup_started` (anonymous, Turnstile-gated, server-stamped versions) → `email_confirmed` (session-bound) → `provisioned` (RPC) → `site_opened` (publish, flip-only). Activation = `last_sign_in_at`.
- Alerts: `provision_failed` >5%/h; turnstile fail >30%; purge failures; resend GoTrue-error >20%.

| Store | Data | Retention | Mechanism |
|---|---|---|---|
| `signup_events` ip/ua | 30 d → NULL | purge edge fn |
| `signup_events` email (live rows) | 400 d → delete | same |
| `signup_events` email on purge/self-delete/invitee-expired rows | NULL immediately | in-job |
| `consent_records` ip/ua | consent lifetime (v1 has no account-deletion path; scrub deferred to that phase) | future deletion phase |
| `rate_limit_hits` | 24 h | same job |

## 10. Testing plan

1. **Unit**: zod schemas; slug generator (Bengali/emoji fallback; regex); canonical normalizer + gate-equality; per-call mapper (incl. email_not_confirmed→generic; **captcha-error class for each of login/reset/signup/resend**); runtime-flag guards; **`options.captchaToken` request-body assertions for signUp/resend/login/reset**; widget re-execute per attempt; nonce flow.
2. **RLS (test:rls)**: A/B owner principals — no cross-tenant read/write via real-client-shaped queries; platform roles intact (by design); storefront unlisted pre-publish; per-1.6a-matrix acceptance rows; table reachability checks.
3. **SQL/integration**: provision success with **full parity assertions** (businesses/stores/brands/locations/storefronts columns as specced + connectors, selling_points incl. storefront+woo-linked dokanos_storefront, woo-linked woocommerce, **showroom_pos bound to the default location_id** (location type 'showroom'), product_sources, customer_sources); idempotent re-call; concurrent double-invoke; 3-table slug retry; blocked domain (seeded); mid-tx error → zero rows; kill-switch 403; anchor gates (missing/expired/cross-account/forged-nonce/consumed → reject); retry-fresh-anchor succeeds; resend +2 h/+23 h → provision succeeds. `publish_my_storefront()`: owner ok; non-owner reject; >1-brand-join reject; flip-only `site_opened`; 1.6a-dependency asserted. `delete_unprovisioned_self()`: tenant/role/foreign-id rejects; clean self ok; **throttle enforced (§6.3 ≤3/h/actor → 4th call rejected)**. Consent idempotent retry + **ip/ua equal to the anchor's acceptance-time values, not the provision call's** (assertion). (Recorded: empty `user_store_access` fail-open — mitigated by assertion + 1.6b.)
4. **Trigger**: owner marker skips both branches (wiped-`auth.users` case → no role); unmarked invite consumed; profile always created.
5. **Regression**: login (WITH token), MFA, reset (WITH token), legacy team-manage invites — all unchanged post-captcha-enable. **Post-captcha-flip staging smoke**: email-confirm link redemption (`/verify`), session refresh, invite set-password acceptance — adjacent endpoint mount-scope verified live, not assumed.
6. **Team-manage fix**: all **five** routes (a/b attach incl. duplicate-role no-op + `staff_role_attached` audit + copy; c refuses owner-marker users AND pending invitees; d owner-marker-no-UBA → typed pending-setup error, both sub-states; **e pending-invitee re-invite → native inviteUserByEmail re-send**); invited user survives ≥8 d.
7. **Purge**: resend doesn't extend lifetime; resent-daily purged at 26 h; invited exempt <30 d; invitee sweep audited + toggle respected; NULL-email audits.
8. **E2E**: full funnel (4 event rows; 3 anchors then confirm still records `email_confirmed`); resend; expired link; wrong-email restart; typo-recipient self-delete; >24 h restart; dwell-6-min retry; **anchor post-fails-after-signup → resume-setup re-runs token+nonce+anchor and recovers**; **anchor-cap 4th-attempt → rate-limit state, next-day success**; runtime kill-switch; storefront unpublished until publish.
9. **Security smoke**: tokenless signUp/resend/login/reset **rejected** (captcha ON); replayed token rejected; resend hammer → 429; 4th anchor/day/email rejected; forged `email_confirmed`/terminal events rejected+audited; forged consent version → server version wins; cross-channel (invite/OAuth-shaped) fresh accounts → gate reject; cross-account anchor use → reject.
10. **Resend negatives**: confirmed-email → generic, no row; GoTrue error → no row, generic; unconfirmed 2xx → one row; TOCTOU flip → suppressed; **>50-user past-page-1 lookup resolves** via `get_auth_signup_state`; **alias-typed resend dispatches to the STORED email** (dispatch target asserted == stored); **>1 canonical match → generic reject + blocked audit**; **invitee resend** → generic response, no `resend` row (`invited_at IS NULL` gate).
11. **Consumer guard**: per entry in the 0.1 `stores`-consumer inventory — filtered/member-scoped after 1.6b, or explicit waiver; DoD: no placeholder store visible in any pre-existing UI.

## 11. Rollout

1. Flags: `VITE_FEATURE_SIGNUP` (deploy-time) + `signup_open` (runtime, seeded **false**). Kill = set false.
2. **Existing-environment captcha rollout (a CURRENT-login outage risk, handle first)**: ship tokened login/reset forms as their own release → wait a cache/tab-propagation window → monitor GoTrue captcha-rejection rate → then flip captcha ON. **Honest window note**: stale pre-token tabs show GoTrue's generic (non-enumerative) captcha-rejection text until refreshed — the mapped "refresh and try again" applies to new bundles only; a deploy-version forced-reload check during the window is optional hardening.
3. **Fresh-environment runbook (order matters)**: 1) at project creation, dashboard "disable email signups" ON (GoTrue signup is on by default; the first-user-admin trigger branch must never fire for strangers); 2) seed platform admin via SQL/service key; 3) deploy app dark; 4) enable captcha after tokened forms ship; 5) Phase 1 flip re-enables GoTrue signups + `signup_open=true`.
4. **Phase 0**: dark; exit gate = 1.6a reviewed + 1.6b merged + §10.2 + §10.11 green. **Phase 1**: flip; 72 h watch. **Phase 2**: OAuth (separate milestone; provider-gate redesign).
5. Full closure: `signup_open=false` + dashboard "disable email signups".

## 12. Task breakdown (~29.5 person-days)

| # | Task | Size | Stream |
|---|------|------|--------|
| 0.1 | Discovery (**day-0 shared deliverable for both streams**): owner perm keys; residual NOT-NULL inventory; `stores` consumer list (+waivers); **1.6a join inventory**; facebook selling-point decision; repeat-signup metadata; `last_sign_in_at`; `invited_at`/`provider` semantics | 1 d | A+B shared |
| 0.2 | Owner bundle decision record + acceptance: excludes permissions referenced by global-scope policies (e.g. `settings.manage`) | 0.5 d | A |
| 1.1 | Migration: 5 new tables + RLS + seeds (`signup_open=false`, versions, invitee-expiry toggle, blocklist) + verify | 1 d | A |
| 1.2 | Migration: trigger patch + `provision_owner_business` + `get_auth_signup_state` + SQL tests | 2 d | A |
| 1.3 | Edge fn `signup-provision` | 1 d | A |
| 1.4 | Edge fn `signup-event` (siteverify, server version stamping, whitelist, session-bound `email_confirmed`, dual caps, meta schema) | 1 d | A |
| 1.5 | Edge fn `auth-resend` (token forward, pre/post unconfirmed checks, throttles, truthful events) + `purge-unconfirmed` (26 h + 30 d invitee sweep) + cron | 1 d | A |
| **1.6a** | **Policy matrix deliverable (per-table scope path, NULL-store rules, leaf joins, `woo_store_id` UNIQUE-partial + brands column-restricted policy, recursion-safe helpers, fail-open/closed per table, p95 + EXPLAIN ANALYZE + index plan). REVIEWED before migrations — review/fix loop budgeted inside** | 3 d | B |
| **1.6b** | **Member-scoped RLS implementation + per-domain cutover + consumer-query fixes + rollout — LAUNCH BLOCKER** | 8 d | B |
| 1.7 | `delete_unprovisioned_self()` + `publish_my_storefront()` — **hard dep: 1.6a landed** | 0.5 d | A (after B milestone) |
| 2.1 | Frontend pages + routes + runtime flags + mapper + nonce/dual-token/re-execute + login/reset invisible Turnstile | 2.5 d | A |
| 2.2 | `useAuth` extension + guards + login links | 0.5 d | A |
| 2.3 | Emails + SMTP + dashboard/env checklist + captcha sequencing | 0.5 d | A |
| 2.4 | `team-manage` three-branch fix per §7 + tests | 1 d | A |
| 3.1 | Unit + RLS + SQL integration | 3 d | A |
| 3.2 | Playwright + regression (captcha-on staging env; 8+ flows incl. rate-limit/dwell/restart states) | 2.5 d | joint |
| 4.1 | Flags/runbook, retention jobs, alerts, funnel query | 0.5 d | A |

## 13. Risks (pre-mortem)

1. **Task 1.6 critical path** (matrix-first, phased merge, test:rls).
2. Owner bundle keys wrong → 0.1/0.2 (+ global-permission exclusion test).
3. Trigger patch regressions → §10.4/10.5.
4. Deliverability → §8.4.
5. Legal/consent jurisdiction → record-only v1 (server-versioned).
6. **Accepted residuals**: GoTrue silent repeat-signup; signup timing side-channel; legacy `_user_id` RPC enumeration; platform staff global by design; confirmed-incomplete accounts squat the email until self-delete/support; invitees reaped at 30 d (toggleable); anchor trust boundary = confirmed fresh email-provider account (same as signup); resend TOCTOU ≈ one request lifetime (post-check suppressed); no account-deletion for provisioned users in v1 (consent scrub deferred); **brief stale-bundle captcha window during the toggle** (stale tabs show GoTrue's generic non-enumerative rejection until refresh; §11.2); **targeted daily-anchor lockout against a known email** (3 anon posts burn the day's budget; recovery = next bucket; mitigations = per-IP caps + abuse alerting).

## 14. Definition of done

- New email → usable published dashboard < 3 min; every failure state has UI + retry + audit (gate-expiry restart, typo-recipient self-delete, dwell-retry, anchor-cap state — all E2E).
- Signup UI + all edge fns killable <1 min at runtime; full closure steps documented (§11.2).
- §10 fully green incl. legacy suites (§10.5) + consumer guards (§10.11).
- Zero `user_roles` rows from self-serve (SQL-asserted).
- Gate holds: cross-account/forged/tampered/cross-channel attempts reject (§10.3/10.9); consent versions server-authoritative.
- Lifetimes coherent: unconfirmed purged 26 h; invitees 30 d; invited users never wrongly purged (§10.7).
- Cross-tenant read/write denied for owner principals post-1.6b (§10.2).
- Concurrent provisions → one store (§10.3); resend events truthful incl. TOCTOU (§10.10).
