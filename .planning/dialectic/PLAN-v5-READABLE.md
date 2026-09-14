# PLAN-v5 — Readable Version (ADHD edition)

**Short version of the approved plan. Full detail +SQL lives in `PLAN-v5.md` — section numbers (§) below point into it. This file can never supersede it.**

---

## The whole plan in 60 seconds

3 releases, ~17–19 dev-days (~3.5 weeks solo).

1. **R1 — Security.** Close the critical hole: today any logged-in user can make themselves *owner of any business*. Also locks business edits to owners.
2. **R2 — Identity.** Kill the "which business-name page is real?" confusion. One source: `businesses` table.
3. **R3 — Polish.** Settings validation, unsaved-changes guard, per-business team roles, email change, optional 2FA.

Nothing ships without its tests passing.

---

## Start here (first 30 min)

1. Start Docker Desktop → run `supabase start`
2. Run W0 step-0: replay all 134 migrations locally (§4.1). **If replay fails → use the schema-dump fallback. Do not fight it, note it, move on.**
3. Run step-0.6 negative control: the harness must catch the *original* bug, proving tests can't be fooled.

---

## Release 1 — Close the security hole (3–3.5 days, ONE deploy window)

**Goal: no user can self-grant access to a business.**

1. **W1a** — Migration `…00100`: rewrite `user_business_access` policies (4 policies + `can_manage_business_access` helper + last-owner guards). ~1 day. SQL ready: §2.1.
2. **W1b** — Migration `…00110`: `create_business_with_owner` RPC (SECURITY DEFINER, admin-only) + realtime publication fix. ~0.5 day. §2.3 + §2.5.
3. **W1c** — Frontend: `CreateBusinessForm` calls the RPC instead of doing 2 client inserts. ~0.5 day. One file: `BusinessAccountTab.tsx`. §2.4.
4. **W1d** — Migration `…00130`: `businesses` writable by owner/admin only + frontend 0-row guard. ~0.5 day. §2.2.
5. **Gate:** RLS battery green — 15 assertions, incl. "staff inserts into another business = denied" and "last owner can't be removed."
6. **Deploy:** `supabase db push` first, *then* Vercel promote. Exact runbook: §2.6.

**Done when:** a staff account can't add themselves to another business (error 42501), and an admin can still create a business in one click.

**You get:** the #1 audit vulnerability is closed. Users on old cached JS just see an error toast — nothing breaks.

---

## Release 2 — One identity, one currency (3–3.75 days, frontend-only)

**Goal: business name/logo/contact exists in exactly one place.**

1. **W2a** — General tab keeps only *theme + PWA install*. Business fields removed; a redirect card points to Business Account. ~0.5–1 day. `SettingsPage.tsx`. §3.1.
2. **W2b** — The invoice-side business info gets relabeled **"Print Header"** + a one-click *"Sync from Business Account"* button. ~0.5 day. §3.2.
3. **W2c** — Delete dead file `src/pages/Stores.tsx` (imported nowhere). ~15 min.
4. **W2d** — One currency source: new `src/lib/currency.ts` + `useCurrency` hook; sweep ~204 hardcoded `৳` across 49 files in 5 small PRs. ~2 days. §3.4.

**Gate:** BDT screenshots have **zero** visual difference after the currency sweep.

**Done when:** editing the business in Business Account changes it everywhere; General no longer "saves" business data (it was silently writing to your browser's localStorage — per-device, invisible to other devices).

**You get:** no more "I saved it but the invoice still shows the old name."

---

## Release 3 — Polish & lockdown (~9 days, mostly parallel)

**Goal: settings feel finished.**

1. **W3** — Guard the `/storefronts` route (it was open to any logged-in user). ~2 hours. §5.1.
2. **W4** — Only settings managers may write global `app_settings`. Run the 90-day `audit_log` census **before merging** (today only 2 writers exist). ~0.5 day. §5.2.
3. **W5** — Real inline validation (red text as you type) on all 10 settings tabs — react-hook-form + zod. ~2.5 days. §5.3.
4. **W6** — "You have unsaved changes" guard on tab switch + page close (4 spots). ~1.5 days. §5.4.
5. **W7** — Team access becomes per-business: "Business Access" tab in the dialog, backed by 2 RPCs. ~2 days. §5.5.
6. **W8** — Email change (re-enter password → confirm both emails). ~1 day. §5.6.
7. **W9** — Optional 2FA (TOTP: QR enroll + code at login). ~3 days. §5.7.

**You get:** settings that behave like Shopify's — validate as you type, warn before losing edits, and team roles scoped per business.

---

## Hard rules (order you cannot skip)

1. **W0 before anything.** No tests harness = no R1.
2. R1 ships **all four migrations in one window**, in order: `00100 → 00110 → 00120 → 00130`.
3. W2a before W2b. W2d before W5/W6 (same files). W5 before W6. W8 before W9.
4. A migration merges to `main` only inside its own release window — `db push` applies whatever main holds.

---

## Top 5 risks (and what to do)

1. **Old migrations might not replay** → W0 step-0 checks first; fallback ready.
2. **Some hidden writer might break under tighter RLS** → pre-deploy search of the built JS bundle + audit-log census.
3. **Users on old JS versions** → writes error out (insert) or silently no-op (update); same-window deploy + 0-row guard covers both.
4. **W4 locks out a real staff writer** → census runs *before merge*, and there are only 2 writers today.
5. **Two owners editing access simultaneously (race)** → row-lock (`FOR UPDATE`); one side gets a deadlock error rather than corrupted state.

## Deliberately NOT doing

Per-business granular permissions · forced 2FA · recovery codes · router migration · self-serve (non-admin) business creation · CI gating · P3 items (tax/VAT, notifications, Bangla, payment gateways) · pgTAP · editing old migrations. Full list: §11.

---

## Lost your place? 

- Working on security → §2 (deploy runbook: §2.6)
- Working on identity/currency → §3
- Don't know what's next → open the Hard Rules list, take the top unblocked item, do that one thing.
