# Task working conventions (this repo, as practiced through Task 15)

How tasks in [../todo.md](../todo.md) get implemented in this goal — the pattern observed from the Task 8–15 commits (`fb5f3b6`, `d7f6490`, `24246c6`, `1a7d2d9`, …) and enforced by the chief.

## Commits
- One `feat(...)`/`fix(...)` commit per task, message names the task ("(Task N)"); a separate `docs:` commit records verification + handoff in [../todo.md](../todo.md)/[../plan.md](../plan.md) afterwards.
- **Stage explicit paths only — never `git add -A`** (foreign uncommitted changes live in this checkout, see [foreign-worktree-state.md](foreign-worktree-state.md)).
- Subagents do NOT edit todo.md/plan.md; the chief records verification centrally.

## Verification battery (per task, reported with counts)
1. `npm run typecheck` — clean.
2. `npm test` (vitest) — all green, count recorded (baseline chain in [environment-quirks.md](environment-quirks.md)).
3. `npx eslint <touched files>` — 0 new problems (pre-existing problems in untouched code are named, not fixed).
4. `npm run build` — with the TMP/TEMP workaround ([environment-quirks.md](environment-quirks.md)).
5. `npm run test:rls` — only when migrations change; must be ALL GREEN including new RLS test files in `supabase/tests/rls/` (harness idioms: fixtures …004–…007, Shapes A/A′, value-pinned survival).
6. `npm run test:browser` (`PLAYWRIGHT_CHANNEL=chrome`) and real-browser checks in the shared `dsh_browser_*` window — run by the CHIEF after landing, not by implementation subagents.

## Quality bar
- No `@ts-ignore`/`@ts-expect-error`/`as any` to force green; the only accepted suppression seen so far is a documented `react-hooks/exhaustive-deps` on a manual reload effect (Task 14).
- Migrations: additive expand-phase unless the task says otherwise; regen `src/integrations/supabase/types.ts` via `supabase gen types typescript --local` and keep diffs purely additive even when foreign changes skew the schema.
- Parallel subagents on one worktree: disjoint file ownership; shared files (App.tsx, AppSidebar, Analytics) get one designated owner; concurrent `npm run build` is forbidden (dist/ collision).

## related
- [environment-quirks.md](environment-quirks.md) · [foreign-worktree-state.md](foreign-worktree-state.md) · [onboarding-design.md](onboarding-design.md)
