# Evidence Labeling Standard

Every line in an evidence record (verification doc, PR body, check log) that claims a test result MUST name both the harness and the backend using this format: `<harness>/<backend>`.

## Canonical harness names

- `vitest` — Node unit/integration tests via Vitest
- `playwright` — Browser tests via Playwright
- `rls-battery` — SQL/pgTAP RLS tests run via supabase db reset + scripts/run-rls-tests.mjs
- `manual` — Human-driven browser interaction
- `api-script` — Node --test scripts hitting real Auth/PostgREST

## Canonical backend names

- `mocked` — Supabase API intercepted/mocked (no real DB)
- `real-stack` — Real local Supabase stack (Auth + PostgREST + edge functions + PostgreSQL)
- `cloud` — Production/staging hosted Supabase project

## Examples

| Label | Meaning |
| --- | --- |
| vitest/mocked | Unit tests with mocked Supabase client |
| playwright/mocked | Playwright browser tests with intercepted API routes |
| playwright/real-stack | Playwright browser tests against real local Supabase |
| rls-battery/real-stack | SQL RLS tests against fresh disposable database |
| api-script/real-stack | Node test scripts using real GoTrue + PostgREST |
| manual/real-stack | Human drove the browser against the real local app |
| manual/cloud | Human tested against deployed production |

## Rules

1. **Reserve bare "browser checks" for real-stack runs only.** If you ran Playwright with mocked routes, label it `playwright/mocked`, never just "browser checks".
2. **Never omit the backend.** A passing test against mocks proves nothing about authorization or data isolation.
3. **"Smoke on real stack green"** is a required line in any evidence record that claims UI behavior works end-to-end. Without it, the evidence is incomplete.
4. **Verification checklist entries** in PR bodies must use these labels. Example:
   ```
   | Check | Harness/Backend | Result |
   | --- | --- | --- |
   | Typecheck | tsc | PASS |
   | Unit suite | vitest/mocked | 477 passed |
   | Accounts browser | playwright/mocked | 30 passed |
   | Smoke journey | playwright/real-stack | 8 passed |
   | RLS battery | rls-battery/real-stack | 19 passed |
   ```
5. **Evidence artifacts must be committed**, not left in machine-local temp directories. See docs/verification/issue-15-release-rehearsal.md for the pattern: commands + results in a Markdown file under docs/verification/, committed to the branch.

</parameter name="content">