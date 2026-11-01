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

## Port 8080 squatting (seen 2026-11-01)
- After harness restarts, the Vite dev server is gone but **Steam** (`steamwebhelper.exe --remote-debugging-port=8080`) can grab `127.0.0.1:8080` first. Do NOT kill it (user's game client).
- Run the app on another port (`npx vite --port 8081 --strictPort`). The Supabase session lives in `localhost:8080`'s localStorage (`sb-127-auth-token`), so the login must be carried over: open any page on the old origin (Steam's debug page qualifies — same origin), stash the token in `window.name` (survives cross-origin same-tab navigation), navigate to the new port, `localStorage.setItem("sb-127-auth-token", window.name)`, clear `window.name`, reload. The token never passes through the agent's context this way.

## PostgreSQL RLS landmines (proven by DB probes, 2026-11-01)
- **`INSERT … RETURNING` re-checks the SELECT policy on the newborn row.** On `stores`, the SELECT policy is `user_can_access_store(id)`, which needs the `brands.woo_store_id` link written only in the NEXT statement — so `supabase-js .insert().select()` fails every member insert with `new row violates row-level security policy for table "stores"` (SQLSTATE 42501) even when WITH CHECK passes. Fix pattern: assign the id client-side and insert WITHOUT returning (see `src/lib/operationalStores.ts` `randomUuid`).
- **Permissive WITH CHECKs are OR'd** across policies (a false policy + a true policy passes), so dropping probe policies is unnecessary when bisecting.
- **RLS test files run as one implicit batch transaction** (`scripts/run-rls-tests.mjs:1011` sends the whole file as a single query): a stray `ROLLBACK;` anywhere rolls back EVERYTHING since the last `COMMIT;`, including cleanup statements written outside transaction blocks. Healing blocks and paired cleanups must each own a `BEGIN; … COMMIT;` (see `supabase/tests/rls/app_settings_test.sql`). The runner's own error path (`scripts/run-rls-tests.mjs:1018`) does `ROLLBACK; RESET ROLE;` — files must be self-contained after that.

## Test-count baselines (recorded as each task landed)
- Task 12: 394 passed, 3 skipped. Task 13: 408. Task 14: 431. Task 15 phase 1: 447 (uncommitted at the time).
