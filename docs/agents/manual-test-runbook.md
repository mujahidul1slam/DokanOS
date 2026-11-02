# Manual Test Runbook

Quick-reference for local development and testing. Compresses tribal knowledge into actionable steps.

## 1. Worktrees

| Purpose | Path / Branch |
|---------|---------------|
| Main working directory | `E:\Work\Web Development\DokanOS\shohozbiz\shohozbiz` (branch `Frontpage`) |
| Integration work | Temp worktree on branch `integration/accounts-8-15` |

List all active worktrees:

```bash
git worktree list
```

## 2. Environment Variables

`.env` points `VITE_SUPABASE_URL` at the cloud project. For local testing, override it.

Create a `.env.local` file or export these in your shell before `npm run dev`:

```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key from supabase status>
```

## 3. Start the Stack

```bash
supabase start
```

If port 54322 conflicts (stale disposable stack), kill it first:

```bash
supabase stop --project-id <stale-id>
```

Verify containers with `docker ps`.

## 4. Apply Migrations

```bash
supabase db reset
```

**WARNING:** This destroys all local data.

## 5. Mailpit

Local email confirmation links land here:

- **UI:** http://127.0.0.1:54324
- **API:** http://127.0.0.1:54324/api/v1/messages

The smoke suite reads confirmation links from this API.

## 6. signup_open Flag

Seeded as `false` by migration. Flip it to test local signups:

```sql
UPDATE public.app_config SET value = 'true'::jsonb WHERE key = 'signup_open';
```

Or via psql:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "UPDATE public.app_config SET value = 'true'::jsonb WHERE key = 'signup_open';"
```

## 7. Edge Runtime

Sometimes crashes on Windows. Restart it:

```bash
supabase stop && supabase start
```

If it keeps crashing, start without it (note: edge functions like `signup-event` will not work):

```bash
supabase start -x edge-runtime
```

## 8. Two Store Concepts (Issue #38)

These are different tables serving different purposes:

| Table | Purpose | Managed Under |
|-------|---------|---------------|
| `public.stores` | Legacy WooCommerce connector registry (`woo_store_id`, `consumer_key`, etc.) | `/integrations` |
| `public.brand_stores` | New-model customer-facing store (physical/online, belongs to a brand) | `/stores` or `create_my_brand_store` RPC |

## 9. Verification Checklist

Before any manual browser session, run:

```bash
npm run verify:env
```

Paste its output into your evidence record. Required checks:

- [ ] Worktree valid
- [ ] App files present
- [ ] Vite serving
- [ ] Supabase containers up
- [ ] Edge runtime up
- [ ] Functions count matches
- [ ] `signup-event` responds

## 10. Running Tests

| Command | Description |
|---------|-------------|
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest unit tests |
| `npm run test:browser` | Playwright mocked API accounts suite (requires `PLAYWRIGHT_CHANNEL=chrome` on Windows) |
| `npm run test:smoke` | Real-stack smoke journey (requires running stack + Vite + Mailpit) |
| `npm run test:rls` | RLS SQL battery (resets DB first) |

</content>