# Codebase Structure

**Analysis Date:** 2026-09-09

## Directory Layout

```
shohozbiz/
├── index.html              # SPA entry HTML
├── package.json            # Scripts: dev, build, lint, test (vitest)
├── vite.config.ts          # Vite + SWC + lovable-tagger; "@/" alias; no manualChunks
├── vitest.config.ts        # Test config
├── vercel.json             # SPA rewrite: all routes → index.html
├── components.json         # shadcn/ui config
├── tailwind.config.ts      # Tailwind theme tokens
├── tsconfig.json / .app.json / .node.json
├── src/                    # Frontend SPA (React 18 + TS)
│   ├── main.tsx            # Bootstrap: PWA hooks, chunk recovery
│   ├── App.tsx             # Providers, brand detection, all routes
│   ├── index.css           # Tailwind + CSS variables
│   ├── pages/              # Authenticated dashboard route pages
│   │   ├── orders/         # Orders-specific hooks/filters
│   │   └── posReports/     # POS report sections
│   ├── components/         # Dashboard + shared components
│   │   ├── ui/             # shadcn/ui primitives (do not hand-edit)
│   │   ├── pos/            # POS feature widgets
│   │   ├── orders/         # Order widgets/dialogs
│   │   ├── dashboard/      # Dashboard cards/charts
│   │   ├── analytics/  products/  integrations/  settings/  team/  measurements/
│   │   └── *.tsx           # Layout, guards, palette (root-level components)
│   ├── hooks/              # Context providers + shared hooks (*.tsx = providers)
│   ├── lib/                # Pure helpers (export CSV, invoice HTML, audit log…)
│   ├── integrations/
│   │   └── supabase/       # GENERATED client.ts + types.ts — do not edit
│   ├── storefront/         # Public storefront mini-app (own pages/components/lib/themes)
│   ├── test/               # Vitest unit tests + setup.ts
│   └── assets/             # Static images
├── supabase/               # Backend
│   ├── config.toml         # Project config; verify_jwt overrides per function
│   ├── migrations/         # 134 timestamped SQL migrations
│   └── functions/          # Deno Edge Functions, one folder per function
│       ├── _shared/        # courier-adapter.ts, woo-mapping.ts, deno.d.ts
│       ├── adapters/       # Courier implementations (pathao reference)
│       ├── sync-worker/  woo-sync/  woo-sync-all/  woo-push/  woo-webhook/  sync-alert/
│       ├── storefront-checkout/  generate-storefront-content/  get-orders/
│       └── pathao-courier/  pathao-location-refresh/  team-manage/  parse-order-text/
├── cloudflare/
│   └── dokanos-cron.js     # CF Worker cron scheduler (deployed via dashboard)
├── .github/workflows/      # sync-worker.yml, woo-sync-all.yml, pathao-tracking.yml
├── public/                 # Favicons, manifest, robots.txt
└── dist/                   # Build output (generated, committed by accident — see note)
```

Note: `dist/`, `bun.lockb`/`package-lock.json` (two lockfiles), `dokanos_260729.backup.zip`, and a stray `~/` directory exist at repo root; `~/` is unrelated tooling noise (gstack), not project code.

## Directory Purposes

**`src/pages/`:**
- Purpose: One file per authenticated route, matching `src/App.tsx` route table
- Contains: Route pages (`Dashboard.tsx`, `Orders.tsx`, `POS.tsx`, `Products.tsx`, `Customers.tsx`, `Analytics.tsx`, `Dispatch.tsx`, `Integrations.tsx`, `SettingsPage.tsx`, `TeamManagement.tsx`, `StorefrontsPage.tsx`, `StoresHub.tsx`, `PosReports.tsx`, `Login.tsx`, `ResetPassword.tsx`, `NotFound.tsx`, `Stores.tsx`, `Index.tsx`)
- Key files: `src/pages/orders/useOrderBulkActions.ts`, `src/pages/orders/tabFilters.ts`, `src/pages/posReports/PosOrdersLedger.tsx`

**`src/components/`:**
- Purpose: Feature widgets + shared chrome, grouped by domain
- Contains: `pos/` (CartPanel, ProductCatalog, InvoicePrint, ShiftDialog…), `orders/` (OrderTable, OrderDetailSheet, DispatchDialog, print slips…), `dashboard/` (KpiStats, RevenueTrendChart, SyncHealthCard…), `integrations/`, `products/`, `settings/`, `team/`, `measurements/`, `analytics/`, `ui/` (shadcn)
- Key files: `src/components/DashboardLayout.tsx`, `src/components/PermissionGuard.tsx`, `src/components/CommandPalette.tsx`, `src/components/ErrorBoundary.tsx`

**`src/hooks/`:**
- Purpose: Cross-cutting state (Context providers) and shared behavior hooks
- Contains: `useAuth.tsx`, `usePermissions.tsx`, `useBusinessContext.tsx`, `useBusinessProfile.tsx`, `useTheme.tsx` (providers); `useDashboardData.ts`, `useBarcodeScanner.ts`, `useDebounce.ts`, `useInvoiceSettings.ts`, `useStoresList.ts`, `usePosSound.ts`, `use-toast.ts`, `use-mobile.tsx`
- Convention: `.tsx` extension = file contains JSX (Context providers)

**`src/lib/`:**
- Purpose: Framework-free helpers usable anywhere
- Contains: `chunkRecovery.ts`, `auditLog.ts`, `exportCsv.ts`, `exportOrdersCSV.ts`, `invoiceHtml.ts`, `pickupSlipHtml.ts`, `printWindow.ts`, `measurements.ts`, `orderTimeline.ts`, `dueCollection.ts`, `pathaoMatch.ts`, `slug.ts`, `utils.ts` (shadcn `cn()`), `mockData.ts`, `wooNotes.ts`, `barcodeSvg.ts`, `preOrderSettings.ts`, `stockSettings.ts`

**`src/integrations/supabase/`:**
- Purpose: Generated typed Supabase client
- Contains: `client.ts` (singleton client, env vars `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`), `types.ts` (Database schema types)
- Rule: Auto-generated — regenerate, never hand-edit

**`src/storefront/`:**
- Purpose: Fully self-contained public storefront app (does not import dashboard components)
- Contains: `StorefrontApp.tsx` (own route table), `BrandContext.tsx`, `pages/` (Home, Shop, Product, Cart, Checkout, CheckoutSuccess, Track, About, Contact, Policies), `components/` (StorefrontLayout, ProductCard), `lib/` (brand.ts, cart.ts, catalog.ts, theme.ts, useCurrency.ts, md.tsx), `themes/storefront.css`
- Key files: `src/storefront/lib/brand.ts` (slug/domain detection + cache)

**`supabase/functions/`:**
- Purpose: Backend logic as Deno Edge Functions; each subfolder = one deployable function with `index.ts`
- Contains: see layout above; shared code in `_shared/`, courier implementations in `adapters/`
- Key files: `supabase/functions/_shared/courier-adapter.ts` (adapter contract), `supabase/functions/_shared/woo-mapping.ts` (Woo field mapping), `supabase/functions/sync-worker/index.ts` (queue drain)

**`supabase/migrations/`:**
- Purpose: Full Postgres schema, RLS policies, RPCs, triggers, views
- Contains: 134 files named `YYYYMMDDNNNNNN_description.sql`
- Key files: `20260904000100_multi_business_foundation.sql`, `20260903000010_fair_claim_round_robin_v2.sql`, `20260902000000_courier_agnostic_core.sql`

**`.github/workflows/`:**
- Purpose: Scheduled function invocations (backup scheduler / dead-man's-switch)
- Contains: `sync-worker.yml`, `woo-sync-all.yml`, `pathao-tracking.yml`

**`src/test/`:**
- Purpose: Unit tests (Vitest + Testing Library)
- Contains: `example.test.ts`, `invoiceHtml.test.ts`, `tabFilters.test.ts`, `setup.ts`

## Key File Locations

**Entry Points:**
- `index.html` → `src/main.tsx` → `src/App.tsx`: SPA bootstrap chain
- `src/storefront/StorefrontApp.tsx`: storefront route table (rendered when brand detected)
- `supabase/functions/<name>/index.ts`: each edge function entry (`Deno.serve`)
- `cloudflare/dokanos-cron.js`: cron worker entry

**Configuration:**
- `vite.config.ts` (build, `@` alias), `tsconfig.app.json` (paths), `tailwind.config.ts`, `components.json` (shadcn), `vitest.config.ts`, `vercel.json` (SPA rewrites), `supabase/config.toml` (function `verify_jwt` flags), `eslint.config.js`, `postcss.config.js`

**Core Logic:**
- Auth/permissions/business context: `src/hooks/useAuth.tsx`, `src/hooks/usePermissions.tsx`, `src/hooks/useBusinessContext.tsx`
- Brand detection: `src/storefront/lib/brand.ts`
- Sync pipeline: `supabase/functions/sync-worker/index.ts`, `woo-push/`, `woo-sync/`, `woo-webhook/`
- Courier abstraction: `supabase/functions/_shared/courier-adapter.ts`, `supabase/functions/adapters/`

**Testing:**
- `src/test/*.test.ts` (Vitest); `playwright.config.ts` + `playwright-fixture.ts` exist at root for E2E scaffolding

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` — e.g., `OrderDetailSheet.tsx`, `SyncHealthCard.tsx`
- Hooks: `useThing.ts(x)` camelCase — e.g., `useBusinessContext.tsx`
- Lib helpers: `camelCase.ts` — e.g., `chunkRecovery.ts`, `exportOrdersCSV.ts`
- Edge functions: `kebab-case/` folders with `index.ts` — e.g., `sync-worker/`, `storefront-checkout/`
- Migrations: `YYYYMMDDNNNNNN_snake_case_description.sql`
- Tests: `*.test.ts` co-located in `src/test/`

**Directories:**
- `src/components/<domain>/` by feature domain (pos, orders, dashboard…)
- `src/storefront/` mirrors the dashboard structure at smaller scale (pages/components/lib/themes)

**Exports:**
- Mix of default exports (pages, layouts: `export default function Dashboard`) and named exports (hooks, guards: `export const PermissionGuard`, `export function useAuth`)

## Where to Add New Code

**New Dashboard Page:**
1. Create `src/pages/MyPage.tsx`
2. Add lazy import + `<Route path="/my-page" element={<PermissionGuard permission="..."><MyPage /></PermissionGuard>} />` in `src/App.tsx`
3. Add permission string to DB enum `app_permission` via a new migration in `supabase/migrations/` if a new permission is needed
4. Add nav entry in `src/components/AppSidebar.tsx` and/or `src/components/BottomNav.tsx`

**New Feature Widget/Dialog (existing domain):**
- Implementation: `src/components/<domain>/ThingName.tsx` (e.g., `src/components/orders/`)
- Wire it into the owning page under `src/pages/`

**New Hook (shared state or behavior):**
- Provider (context): `src/hooks/useThing.tsx` — follow the `createContext` + `useContext` + `Provider` pattern in `src/hooks/usePermissions.tsx`; mount the provider inside `Root` in `src/App.tsx`
- Plain hook: `src/hooks/useThing.ts`

**New Utility:**
- Framework-free helper: `src/lib/thingName.ts` (camelCase)
- Supabase query group for one page: co-locate as `src/pages/<domain>/useThing.ts` (pattern of `src/pages/orders/useOrderBulkActions.ts`)

**New Edge Function:**
1. Create `supabase/functions/my-function/index.ts` with `Deno.serve(...)`; copy the CORS header block from `supabase/functions/storefront-checkout/index.ts`
2. Register in `supabase/config.toml` (set `verify_jwt = false` ONLY if the function self-authenticates)
3. Put reusable mapping/adapters in `supabase/functions/_shared/`
4. If it needs cron, add an invocation to `cloudflare/dokanos-cron.js` or a workflow in `.github/workflows/`

**New Courier Integration:**
- Add `supabase/functions/adapters/<courier>.ts` implementing the interfaces in `supabase/functions/_shared/courier-adapter.ts`; do not modify the dispatch core

**New Storefront Page:**
- Create `src/storefront/pages/Thing.tsx`, add a lazy route in `src/storefront/StorefrontApp.tsx` under `basePath`

**New Migration:**
- `supabase/migrations/YYYYMMDDNNNNNN_description.sql` (timestamp > latest existing, currently > `20260906000000`); include RLS policies for any new table; follow the verify/drop-oracle pattern only for one-off verification migrations

**New shadcn Component:**
- `src/components/ui/` (generated via shadcn CLI, configured by `components.json`)

**Tests:**
- Unit: `src/test/<name>.test.ts` (registered by `vitest.config.ts`)

## Special Directories

**`src/components/ui/`:**
- Purpose: shadcn/ui primitives (Radix + CVA)
- Generated: Yes (CLI) — customize via props/className, not by rewriting internals
- Committed: Yes

**`src/integrations/supabase/`:**
- Purpose: Generated DB types + client
- Generated: Yes (Supabase CLI)
- Committed: Yes

**`supabase/migrations/`:**
- Purpose: Append-only schema history
- Generated: No (hand-written SQL)
- Committed: Yes — never edit an applied migration; add a new one

**`dist/`:**
- Purpose: Vite build output
- Generated: Yes
- Committed: Present in repo (should be gitignored)

**`~/` (repo root):**
- Purpose: Unrelated tooling artifacts (gstack) accidentally created at repo root
- Generated: Yes (tooling)
- Committed: Noise — safe to exclude from any analysis or work

**`.planning/`, `.lovable/`, `.tmp/`, `.vercel/`:**
- Purpose: GSD planning docs, Lovable metadata, temp scripts, Vercel CLI state
- Generated: Tooling
- Committed: Mixed; ignore for feature work

---

*Structure analysis: 2026-09-09*
