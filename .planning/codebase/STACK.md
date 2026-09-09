# Technology Stack

**Analysis Date:** 2026-09-09

## Languages

**Primary:**
- TypeScript ^5.8.3 (`package.json`) — React SPA frontend (`src/`), Supabase Edge Functions (`supabase/functions/`, Deno-flavored TS), shared courier/woo adapters (`supabase/functions/_shared/`)
- SQL — Postgres schema + business logic in `supabase/migrations/` (100+ migrations; RLS, triggers, RPCs, pg_cron jobs, vault secrets)

**Secondary:**
- JavaScript — Cloudflare Worker cron (`cloudflare/dokanos-cron.js`), PWA service-worker kill-switch (`public/sw.js`), build configs
- CSS — Tailwind CSS utilities + custom theme layers (`src/index.css`, `src/storefront/themes/storefront.css`)

## Runtime

**Environment:**
- Browser (client-side SPA) — build target ES2020 (`vite.config.ts`)
- Deno — Supabase Edge Functions runtime (`supabase/functions/`, uses `Deno.serve`, `npm:@supabase/supabase-js@2.49.4`)
- Node.js — toolchain only (Vite, Vitest, ESLint); `@types/node ^22.16.5`; no `engines` pinned
- Bun — lockfiles present (`bun.lock`, `bun.lockb`) alongside `package-lock.json`

**Package Manager:**
- npm (primary; `package-lock.json` committed)
- Lockfile: `package-lock.json` + `bun.lock`/`bun.lockb` (dual lockfiles — pick npm for reproducibility; keep both in sync or delete one)

## Frameworks

**Core:**
- React ^18.3.1 — UI framework (`src/App.tsx`, `src/main.tsx`)
- Vite ^5.4.19 — dev server + bundler (`vite.config.ts`; port 8080, `@` → `src/` alias, SWC plugin)
- Tailwind CSS ^3.4.17 — styling (`tailwind.config.ts`, `postcss.config.js`, shadcn `cssVariables: true` in `components.json`)
- shadcn/ui — component system on Radix primitives (`src/components/ui/*`, configured via `components.json`, style "default", baseColor "slate")
- react-router-dom ^6.30.1 — routing (`src/App.tsx`)
- TanStack React Query ^5.83.0 — server-state/data fetching
- react-hook-form ^7.61.1 + zod ^3.25.76 + @hookform/resolvers — forms & validation

**Testing:**
- Vitest ^3.2.4 — unit/component tests (`vitest.config.ts`: jsdom, globals, setup `src/test/setup.ts`, include `src/**/*.{test,spec}.{ts,tsx}`)
- @testing-library/react ^16 + @testing-library/jest-dom ^6 — component testing
- @playwright/test ^1.57.0 — E2E harness (`playwright.config.ts` uses `lovable-agent-playwright-config`)

**Build/Dev:**
- @vitejs/plugin-react-swc ^3.11.0 — React fast refresh via SWC
- lovable-tagger ^1.1.13 — Lovable platform component tagging (dev mode only, `vite.config.ts`)
- ESLint ^9 (flat config `eslint.config.js`) + typescript-eslint ^8.38 + react-hooks/react-refresh plugins
- autoprefixer ^10 + postcss ^8

## Key Dependencies

**Critical:**
- @supabase/supabase-js ^2.101.1 — entire backend access layer (DB, Auth, Realtime, Edge Function invocation); typed client at `src/integrations/supabase/client.ts` with generated `Database` types in `src/integrations/supabase/types.ts`
- recharts ^3.8.1 — all dashboard/analytics charts (`src/components/analytics/*`, `src/components/dashboard/RevenueTrendChart.tsx`); must NOT be split into a vendor chunk (module-eval `forwardRef` race — see comment in `vite.config.ts`)
- lucide-react ^1.7.0 — icon system

**Infrastructure:**
- @radix-ui/react-* (25+ packages) — headless primitives behind every shadcn/ui component
- embla-carousel-react, vaul, cmdk, input-otp, react-day-picker — shadcn/ui component engines
- date-fns ^3.6.0 — date math (reports, dashboards)
- fuse.js ^7.3.0 — fuzzy search (Command palette, catalogs)
- jsbarcode ^3.12.3 + `src/lib/barcodeSvg.ts` — barcode rendering
- sonner + custom toast — notifications
- next-themes ^0.3.0 — theme switching (`src/hooks/useTheme.tsx`)
- class-variance-authority + clsx + tailwind-merge — styling utilities (`src/lib/utils.ts`)
- react-resizable-panels — layout panels

## Configuration

**Environment:**
- `.env` file present at repo root (existence noted only — never committed values read); consumed via Vite `import.meta.env`
- Frontend vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (`src/integrations/supabase/client.ts`)
- Edge Function vars (`Deno.env.get`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `PATHAO_USERNAME`, `PATHAO_PASSWORD`, `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`
- Cron tokens: vault-stored `sync_worker_cron_token`, `woo_sync_cron_token`, `sync_alert_webhook_url` (Supabase vault, mirrored as GitHub repo secrets `SYNC_WORKER_CRON_TOKEN`, `WOO_SYNC_CRON_TOKEN`)

**Build:**
- `vite.config.ts` — ES2020 target, esbuild minify, `manualChunks: undefined` (deliberate — React/Recharts chunk-eval race), dev-mode `componentTagger`
- `vercel.json` — SPA rewrite `/(.*) → /index.html`
- `supabase/config.toml` — project `jiwndicvfkiltgageqwv`; `verify_jwt = false` for `woo-webhook`, `storefront-checkout`, `get-orders` (self-authenticating functions)
- `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` — project references; `strict: false`, `noImplicitAny: false`, `strictNullChecks: false`, path alias `@/* → src/*`
- `vitest.config.ts`, `playwright.config.ts` — test runners
- `supabase/functions/deno.d.ts` + `tsconfig.json` — Deno typing for edge functions

## Platform Requirements

**Development:**
- Node.js (LTS ~22 per @types/node) with npm; `npm run dev` (Vite on port 8080, host `::`)
- Supabase CLI for local edge functions/migrations (`supabase/config.toml` linked to project)
- No local Postgres required — Supabase cloud project

**Production:**
- Vercel — static SPA hosting (`vercel.json` rewrites; `.vercel/` directory present)
- Supabase — Postgres, Auth, Storage-adjacent edge functions, Realtime, pg_cron, Vault
- Cloudflare Workers — `dokanos-cron` scheduler worker with cron triggers (*/5 and */15 min), deployed via dashboard (no wrangler config in repo)
- GitHub Actions — 3 scheduled workflows (`.github/workflows/`) as external schedulers / dead-man's switches
- PWA — `public/manifest.webmanifest`, icons, service worker kill-switch (`public/sw.js` unregisters itself; manifest-only installability)

## Notable Stack Facts

- **Lovable-origin codebase** — scaffolded by Lovable (`lovable-tagger`, `components.json`, og:image on R2 bucket); functions like a standard Vite React project
- **Backend is database-centric** — most business logic lives in SQL (triggers, RPCs like `claim_sync_queue_batch`, `generate_pos_order_number`) under `supabase/migrations/`, not in app code
- **Dual scheduler setup** — Supabase pg_cron is broken (documented in `.github/workflows/sync-worker.yml` header), replaced by Cloudflare Worker cron + GitHub Actions
- Root contains `dokanos_260729.backup.zip` — a committed DB backup snapshot (see CONCERNS)

---

*Stack analysis: 2026-09-09*
