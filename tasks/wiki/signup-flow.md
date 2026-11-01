# Signup flow — gate, verification chain, duplicate handling

What the signup UX does and why (answers to user questions on 2026-11-01). Sibling of [onboarding-design.md](onboarding-design.md) (business onboarding comes AFTER this flow).

## The gate (kill switch)
- `is_signup_open()` reads `app_config.key='signup_open'` (migration `20261022120000_signup_config_accessor.sql`), **fail-closed** (no row ⇒ closed). The page shows "New registrations are currently restricted…" when closed. Local: flip the row open via SQL. Production: the function ships with the user-gated catch-up batch (#10/#11) — production signup is fail-closed until that lands (see [cutover-status.md](cutover-status.md)).

## Email verification chain
- Intended (production): signup → `signup-event` edge fn (consent + server-side controls: gate, disposable-email block, Turnstile, rate limits) → `auth.signUp` → **CheckEmail** ("we sent a confirmation link", resend via `auth-resend`) → link → `/auth/confirm` (AuthConfirm) → skippable "Set up your profile" (Task 3) → business flow.
- **Local dev auto-confirms emails** (`supabase/config.toml` has no `[auth.email] enable_confirmations` override; local default = off): `signUp` returns a live session instantly, and the logged-in route group bounces `/check-email` → `/accounts` (App.tsx authed routes). Verified 2026-11-01: test accounts got `email_confirmed_at` at creation. To walk the real chain locally: set `enable_confirmations = true` + restart the stack; verification links land in the local mail viewer (Inbucket, `:54324`).
- Known pre-existing quirk (Task 3 note): `getSession()` doesn't reliably return `email_confirmed_at`, so the live `/auth/confirm` gate redirect was Playwright-mock-verified only — **until the live debugging of 2026-11-01 (late)**, which found THREE stacked causes for "the profile setup screen never appears after confirming":
  1. **Dead redirect (root cause):** GoTrue silently replaces an unlisted `emailRedirectTo` with its SITE_URL — with defaults, every confirmation link ended at `http://127.0.0.1:3000` (nothing there). The token still verified server-side (accounts show confirmed) but the browser dead-ended. Fixed locally in `supabase/config.toml`: `[auth] site_url` + `additional_redirect_urls` for the app origins. **PRODUCTION CHECK (cutover-critical):** Supabase Auth → URL Configuration must list the production app origin, or every real user's verify/recovery link dies the same way.
  2. **Fragile gate:** `AuthConfirm.tsx` trusted `getSession()`'s cached `email_confirmed_at` and never exchanged the link's `token_hash`. Fixed `d3347bd`: explicit `verifyOtp`, authoritative `getUser()`, used-token fallback to an established session, decision order extracted to `authConfirmFlow.ts`.
  3. **Login path had no gate:** signing in skipped setup forever. Fixed `d3347bd`: shared `isProfileSetupOwed()` checked before the business landing (also covers "confirm on phone, sign in on laptop").
  - Live-verified 2026-11-01: confirm link → `/profile/setup` → skip stamps `profile_setup_completed_at`; login with owed setup → `/profile/setup`; second login → straight through. Pinned by 18 unit tests + Playwright `profile-setup.spec.ts` (9/9).

## Duplicate email at signup (probed live 2026-11-01)
- GoTrue returns **422 `{"code":422,"msg":"User already registered"}`** (body also has `error_code`) and creates **no second user** (probe: user count unchanged).
- Before the fix: `Signup.tsx` toasted `mapAuthError(err)` whose fallback passes the raw message through ⇒ **user enumeration** (anyone can probe which emails have accounts). Ironically `authErrors.ts` is the documented "enumeration hygiene mapper" (SIGNUP-PLAN §6.4) for LOGIN errors.
- **Fix (user-approved 2026-11-01, landed `8de78b2`):** treat the already-exists error exactly like success — same `/check-email` screen, no toast, no distinguishing param — via a pure `isExistingAccountError()` helper in `authErrors.ts` (detects `AuthApiError.code` `user_already_exists`/`email_exists` + message fallbacks; login-side mapper untouched). Verified live in the shared browser 2026-11-01: duplicate signup → `/check-email?email=…`, zero toasts, no leak text; pinned by 10 unit tests + 1 Playwright case (`personal-signup.spec.ts` 16/16). Follow-up copy is already safe ("Confirmation link re-sent if account exists").
- Elsewhere duplicates are handled explicitly and friendly: profile email change ("That email is already in use"), invites ("already member" / "open invitation exists").

## related
- [onboarding-design.md](onboarding-design.md) (post-signup wizard) · [foreign-worktree-state.md](foreign-worktree-state.md) (the gate's migrations were part of the deletion saga) · [environment-quirks.md](environment-quirks.md)
