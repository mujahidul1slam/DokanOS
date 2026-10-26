# SIGNUP-CRITIQUE-7 — Adversarial Review, Round 7

Reviewer: fresh-context agent (single-model). Reviewed artifact: `SIGNUP-PLAN.md` v7 + all prior critiques.
Verified: `stores.name TEXT NOT NULL` no default (20260407071618:14); `brands.name` NOT NULL (20260904000100:78); installed auth-js is 2.104.0 — admin API offers only `listUsers({page,perPage})` + `getUserById` (types.d.ts:1520; GoTrueAdminApi.d.ts:348) — **no by-email lookup**; no captcha/auth config anywhere in `supabase/config.toml`; `signUp` only reads `options.captchaToken` (GoTrueClient.js; types.d.ts:498–505); Turnstile tokens expire after 300 s; brands member write policy is `FOR ALL` no column restriction (20260904000100:339–346); storefronts anon SELECT exposes `store_id` (20260516201928:28–30).

All 12 findings validated against plan text. Classification: **12 × Valid + actionable**. Cumulative: 91 findings, 91 actionable.

## Dispositions

### BLOCKERS

1. **Provision still misses NOT NULL columns** (`stores.name`, `brands.name`, plus unenumerated `business_id` FKs) → transaction 100%-fails; round-6's "expanded" list was still incomplete.
   → ACTIONABLE: §3 now carries the full authoritative column list per table (stores: name/url/status; brands: business_id/name/slug/woo_store_id; locations: business_id/brand_id/name/type/is_default; storefronts: name/store_id/slug/is_active …), marked as verified-minimum with Task-0.1 completing any remainder.
2. **Resend pre-check has no implementable lookup** — auth-js lacks by-email admin fetch; listUsers scan silently misses users past page 1 → reintroduces round-6 BLOCKER #2 through the back door.
   → ACTIONABLE: new `get_auth_signup_state(p_email)` SECURITY DEFINER fn querying `auth.users WHERE lower(email)=lower($1)` returning `{id, email_confirmed_at, invited_at}`; listUsers-scan explicitly forbidden; §10.10 test with >50 users where the target sits past page 1.

### MAJORS

3. **GoTrue captcha enablement missing from §8** — forwarded tokens are no-ops if Turnstile isn't enabled in Auth settings (dashboard-only; confirmed absent from config.toml); mis-scoping it to login/recovery would regress existing flows.
   → ACTIONABLE: §8 launch-blocking item — enable GoTrue Turnstile scoped to signup + resend only, verify login/recovery untouched; §10.9 smoke: `signUp` without token rejected.
4. **§3 signUp call shape wrong** — `captchaToken` must be `options.captchaToken` (nested); top-level is silently discarded.
   → ACTIONABLE: call corrected (`{email, password, options:{captchaToken: t_signup, data:{marker, nonce}}}`); unit test asserts the token appears in the request body.
5. **Turnstile 300 s expiry + retry/widget lifecycle unhandled; failed-attempt anchors would burn the ≤3/day cap** → ACTIONABLE: architecture reordered — anchor is written **after** each successful `signUp` response (failed attempts never create anchors; the provision-time window already tolerates posting after `users.created_at`); widget re-executed per attempt (fresh `t_signup` + `t_event` every retry, alongside nonce); dwell-6-min retry case added to §10.1/§10.8.
6. **Consent versions were client-chosen** → ACTIONABLE: `tos_version`/`privacy_version` seeded into `app_config` (service-write); `signup-event` stamps SERVER versions into the anchor (client values = displayed-copy record at most); provision copies server values; §10.9 forged-version test.
7. **`publish_my_storefront()` assert exploitable while `brands.woo_store_id` uniqueness is unresolved** (nullable non-unique + member `FOR ALL` write on brands + anon-readable `store_id` ⇒ cross-tenant store attachment → foreign storefront publish) → ACTIONABLE: hard dependency — 1.6a lands the UNIQUE-partial-index decision + RPC rejects when >1 brand joins, **before** Task 1.7; assert path noted as brand-join AND selling_points cross-check.
8. **Parity set mismatch** — §1 said connectors + selling_points + product_sources; §3 inserted only two; backfill also writes `customer_sources` (20260904000100:562–573).
   → ACTIONABLE: §3 enumerates the full set (connectors channel/woocommerce, selling_points showroom_pos + storefront-linked dokanos_storefront, product_sources, customer_sources — statuses matching the disconnected placeholder); §10.3 asserts each row.
9. **Header "~3 weeks" contradicted the 25-person-day table** → ACTIONABLE: header corrected to **~5 weeks single-stream (25 pd)**; a 2-stream ~3-week critical path is named explicitly (backend core 1.1–1.5 & 1.7 ∥ 1.6a/1.6b gated, frontend 2.x after 1.1), with the note that streams need two engineers.

### MINORS

10. **Resend TOCTOU** (confirm races pre-check → 200/empty → false `resend` row) → ACTIONABLE: re-read `email_confirmed_at` after the GoTrue call; suppress row if flipped; race test in §10.10.
11. **No acceptance rows protecting existing UIs from placeholder stores** (`useStoresList` unfiltered; `StorefrontsPage` maybeSingle picks arbitrary store) → ACTIONABLE: §10.11 consumer-guard rows from the Task-0.1 inventory (each `stores` read site filtered or waived); DoD: no placeholder store appears in any pre-existing surface.
12. **Unactioned invitees accumulate forever** → ACTIONABLE: default invitee expiry in the purge fn at 30 d (`invited_at NOT NULL AND email_confirmed_at NULL AND invited_at > 30 d`, audited, ops-toggleable via `app_config`); runbook cleanup query documented; §13 residual updated.

Round-7 verdict: plan NOT acceptable as v7 → all fixes applied in v8. Round 8 reviews v8 + all critique files.