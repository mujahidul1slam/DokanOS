# Environment quirks (Windows workspace `accounts-8-15-integration`)

## esbuild "Access is denied" on `npm run build` (seen 2026-10-31)
- Symptom: `vite build` fails twice, esbuild's Go service cannot delete its temp files **outside** the workspace (`remove …: Access is denied`).
- Workaround that works: run the build with `TMP`/`TEMP` pointed at a workspace subdir (e.g. `.tmp/build`). No code change needed.
- Hit during Task 13 and Task 14 verification; both succeeded with the workaround.

## Docker Desktop / local Supabase
- Docker Desktop is NOT at the standard `C:\ProgramFiles` location; it lives at `C:\Users\mujah\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe` (as of 2026-10-31).
- The engine has died at least once mid-session (2026-10-31, during Task 13): restart the exe, then `supabase start`.
- `supabase db reset` (what `npm run test:rls` runs) wipes the local dev DB — seed test users only AFTER the last reset of a verification wave.
- Local service ports: Supabase API `http://127.0.0.1:54321`, dev server `8080` (`npm run dev`), Playwright's own webServer `4175` (see `playwright.accounts.config.ts`).

## Playwright
- Bundled Chromium download stalls in this environment; run with `PLAYWRIGHT_CHANNEL=chrome` (system Chrome). Recorded in [../plan.md](../plan.md) "Infrastructure" (2026-10-30).
- Account specs mock supabase at the network layer; their mock memberships lack `joined_via`, which (as of Task 13, commit `24246c6`) makes the onboarding gate fail closed — convenient for specs that expect `/onboarding → /`, but post-create landing assertions pinned the OLD `/` landing and needed updating (see [cutover-status.md](cutover-status.md)).

## Local verification techniques (2026-11-01)
- **Open the local signup gate:** `is_signup_open()` reads `app_config.key='signup_open'` (fail-closed default = no row). Flip with `DELETE + INSERT INTO app_config(key,value) VALUES ('signup_open','true'::jsonb)` on the local DB. Production stays closed until the catch-up batch + an explicit decision.
- **dsh_browser_execute wraps scripts as expressions** — statement sequences throw `SyntaxError: Unexpected token ';'`; wrap in an IIFE `(() => { …; return x; })()`.
- **Capture fast-disappearing toasts:** install a MutationObserver on `document.body` (collect added-node text under 300 chars into `window.__cap`), click, then read `window.__cap`. This is how two silent RLS failures were diagnosed (see [transitional-store-model.md](transitional-store-model.md)).
- **Upload files to file inputs:** construct `new File([...], 'x.csv', {type:'text/csv'})`, put it in a `DataTransfer`, assign `input.files = dt.files`, dispatch `change` with bubbles. Works in Chromium via execute.

## Test-count baselines (recorded as each task landed)
- Task 12: 394 passed, 3 skipped. Task 13: 408. Task 14: 431. Task 15 phase 1: 447 (uncommitted at the time).
