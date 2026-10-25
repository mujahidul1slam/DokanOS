# context-mode — MANDATORY routing rules

context-mode MCP tools available. Rules protect context window from flooding. One unrouted command dumps 56 KB into context.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via `context-mode_ctx_execute(language, code)`, `console.log()` only the answer. Do NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`). `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## BLOCKED — do NOT attempt

### curl / wget — BLOCKED
Shell `curl`/`wget` intercepted and blocked. Do NOT retry.
Use: `context-mode_ctx_fetch_and_index(url, source)` or `context-mode_ctx_execute(language: "javascript", code: "const r = await fetch(...)")`

### Inline HTTP — BLOCKED
`fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, `http.request(` — intercepted. Do NOT retry.
Use: `context-mode_ctx_execute(language, code)` — only stdout enters context

### Direct web fetching — BLOCKED
Use: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)`

## REDIRECTED — use sandbox

### Shell (>20 lines output)
Shell ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`.
Otherwise: `context-mode_ctx_batch_execute(commands, queries)` or `context-mode_ctx_execute(language: "javascript", code: "...")`. Use `language: "shell"` only when code matches the host shell.

### File reading (for analysis)
Reading to **edit** → reading correct. Reading to **analyze/explore/summarize** → `context-mode_ctx_execute_file(path, language, code)`.

### grep / search (large results)
Use `context-mode_ctx_execute(language: "javascript", code: "...")` in sandbox for portable filtering/counting.

## Tool selection

0. **MEMORY**: `context-mode_ctx_search(sort: "timeline")` — after resume, check prior context before asking user.
1. **GATHER**: `context-mode_ctx_batch_execute(commands, queries)` — runs all commands, auto-indexes, returns search. ONE call replaces 30+. Each command: `{label: "header", command: "..."}`.
2. **FOLLOW-UP**: `context-mode_ctx_search(queries: ["q1", "q2", ...])` — all questions as array, ONE call (default relevance mode).
3. **PROCESSING**: `context-mode_ctx_execute(language, code)` | `context-mode_ctx_execute_file(path, language, code)` — sandbox, only stdout enters context.
4. **WEB**: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` — raw HTML never enters context.
5. **INDEX**: `context-mode_ctx_index(content, source)` — store in FTS5 for later search.

## Parallel I/O batches

For multi-URL fetches or multi-API calls, **always** include `concurrency: N` (1-8):

- `context-mode_ctx_batch_execute(commands: [3+ network commands], concurrency: 5)` — gh, curl, dig, docker inspect, multi-region cloud queries
- `context-mode_ctx_fetch_and_index(requests: [{url, source}, ...], concurrency: 5)` — multi-URL batch fetch

**Use concurrency 4-8** for I/O-bound work (network calls, API queries). **Keep concurrency 1** for CPU-bound (npm test, build, lint) or commands sharing state (ports, lock files, same-repo writes).

GitHub API rate-limit: cap at 4 for `gh` calls.

## Output

Write artifacts to FILES — never inline. Return: file path + 1-line description.
Descriptive source labels for `search(source: "label")`.

## Session Continuity

Skills, roles, and decisions persist for the entire session. Do not abandon them as the conversation grows.

## Memory

Session history is persistent and searchable. On resume, search BEFORE asking the user:

| Need | Command |
|------|---------|
| What did we decide? | `context-mode_ctx_search(queries: ["decision"], source: "decision", sort: "timeline")` |
| What constraints exist? | `context-mode_ctx_search(queries: ["constraint"], source: "constraint")` |

DO NOT ask "what were we working on?" — SEARCH FIRST.
If search returns 0 results, proceed as a fresh session.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call `stats` MCP tool, display full output verbatim |
| `ctx doctor` | Call `doctor` MCP tool, run returned shell command, display as checklist |
| `ctx upgrade` | Call `upgrade` MCP tool, run returned shell command, display as checklist |
| `ctx purge` | Call `purge` MCP tool with confirm: true. Warns before wiping knowledge base. |

After /clear or /compact: knowledge base and session stats preserved. Use `ctx purge` to start fresh.

## Agent skills

### When to invoke a skill

Load the matching skill with the `skill` tool **before starting work** whenever a request matches a row below. These are expected behaviour, not suggestions — installed skills exist so they fire without being named.

| If the request is about… | Load |
| --- | --- |
| reviewing a branch, a PR, or work-in-progress changes ("review since X") | `code-review` |
| building a feature or fixing a bug test-first, "red-green-refactor" | `tdd` |
| something broken, throwing, failing or slow — "diagnose"/"debug" this | `diagnosing-bugs` |
| naming domain concepts, writing/editing `GLOSSARY.md`, recording an ADR | `domain-modeling` |
| designing or deepening a module's interface, seams, testability, AI-navigability | `codebase-design` |
| stress-testing a plan, decision or idea — any "grill" trigger | `grilling` |
| sanity-checking a state model or logic, or "what should this UI look like" | `prototype` |
| researching a topic against primary sources into a Markdown file | `research` |
| writing a PR body | `pr` |
| scaffolding exercise/course directory structures | `scaffold-exercises` |
| adding Husky + lint-staged pre-commit hooks | `setup-pre-commit` |
| blocking dangerous git commands via Claude Code hooks | `git-guardrails-claude-code` |
| replacing `as` assertions in tests with @total-typescript/shoehorn | `migrate-to-shoehorn` |
| generating a bash wizard for steps only a human can perform | `wizard` |
| writing or editing a skill, `AGENTS.md` or `CLAUDE.md` | `writing-for-agents` |

If nothing matches, work normally — don't force a skill.

### Slash-only skills

These carry `disable-model-invocation: true` upstream, so the `skill` tool refuses them (`skill "<name>" is not available for model invocation`). **Never call the `skill` tool with one of these names** — it wastes a call and cannot succeed:

`triage`, `to-spec`, `to-tickets`, `to-questionnaire`, `implement`, `implement-spec`, `wayfinder`, `improve-codebase-architecture`, `grill-me`, `grill-with-docs`, `handoff`, `claude-handoff`, `retro`, `loop-me`, `wait-what`, `teach`, `ask-matt`, `chief-of-staff`, `writing-beats`, `writing-fragments`, `writing-shape`, `setup-matt-pocock-skills`, `setup-ts-deep-modules`.

They run only on the user's explicit request. When a request clearly matches one, name the command and offer it ("that looks like `/triage` — want me to run it?"); once the user agrees, read `.agents/skills/<name>/SKILL.md` and follow it, which is the same fallback the slash command uses. Never start one unprompted.

### Issue tracker

Issues and specs live as GitHub issues in `mujahidul1slam/DokanOS` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles using the default strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
