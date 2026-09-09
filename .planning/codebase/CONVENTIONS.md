# Coding Conventions

**Analysis Date:** 2026-09-09

## Naming Patterns

**Files:**
- Components: PascalCase — `src/components/StatusBadge.tsx`, `src/components/orders/OrderDetailSheet.tsx`
- Pages: PascalCase — `src/pages/Orders.tsx`, `src/pages/POS.tsx`
- Hooks: camelCase with `use` prefix — `src/hooks/useAuth.tsx`, `src/hooks/useDebounce.ts`
- Lib utilities: camelCase — `src/lib/auditLog.ts`, `src/lib/invoiceHtml.ts`, `src/lib/exportCsv.ts`
- Test files: `<moduleName>.test.ts` colocated in `src/test/` — `src/test/tabFilters.test.ts`
- Edge functions: kebab-case directories with `index.ts` — `supabase/functions/sync-worker/index.ts`
- Shadcn UI primitives: kebab-case — `src/components/ui/button.tsx`

**Functions:**
- `camelCase` verbs — `logAction`, `downloadCsv`, `matchesTab`, `buildInvoiceInnerHtml`
- React components: PascalCase — `StatusBadge`, `AuthProvider`
- Custom hooks: `useXxx` — `useAuth`, `useDebounce`, `useInvoiceSettings`

**Variables:**
- `camelCase` for locals and props
- Module-level constant lookup tables: `camelCase` or `SCREAMING_SNAKE` inconsistently — `statusStyles` in `src/components/StatusBadge.tsx`, `CANCELLED_TRACKING`/`DELIVERED_TRACKING` in `src/pages/orders/tabFilters.ts`

**Types:**
- PascalCase interfaces — `InvoiceTemplateConfig` in `src/hooks/useInvoiceSettings.ts`, `TabOrder` in `src/pages/orders/tabFilters.ts`, `AuthContextType` in `src/hooks/useAuth.tsx`
- Object properties that mirror database columns use `snake_case` (e.g., `show_item_qty`, `consignment_id`); UI-only state uses `camelCase`
- Discriminated string-literal unions for status vocabularies — `TabKey` in `src/pages/orders/tabFilters.ts`

## Code Style

**Formatting:**
- No Prettier or other formatter config detected. Formatting is 2-space indent, double quotes, semicolons — enforced only by consistency, not tooling. Match surrounding style.
- Max line width is soft; long import lines and JSX props are common (`src/components/pos/CartPanel.tsx`).

**Linting:**
- ESLint 9 flat config in `eslint.config.js`
- Extends `@eslint/js` recommended + `typescript-eslint` recommended
- Plugins: `eslint-plugin-react-hooks` (recommended rules), `eslint-plugin-react-refresh` (`only-export-components: warn`, `allowConstantExport: true`)
- `@typescript-eslint/no-unused-vars` is explicitly **off**
- Scope: `**/*.{ts,tsx}`, ignores `dist`; `supabase/` edge functions (Deno) are NOT linted by this config
- TypeScript is loose: `strict: false`, `noImplicitAny: false`, `strictNullChecks: false`, `noUnusedLocals`/`noUnusedParameters: false` (`tsconfig.json`, `tsconfig.app.json`). `any` and `as any` casts appear where Supabase types lag (`src/lib/auditLog.ts`).

## Import Organization

**Order (observed convention, no tooling enforcement):**
1. React / framework imports — `import { useEffect, useState } from "react"`
2. Router — `react-router-dom`
3. Third-party — `date-fns`, `lucide-react`, `@tanstack/react-query`
4. App hooks/aliases — `@/hooks/useAuth`, `@/lib/auditLog`
5. UI components — `@/components/ui/*`
6. Local relative imports — `./InvoicePrint`, `../../supabase/functions/_shared/woo-mapping`

**Path Aliases:**
- `@/*` → `src/*` — configured in `tsconfig.json` (`paths`), `vite.config.ts` (`resolve.alias`), and `vitest.config.ts`. Always use `@/` for cross-directory imports.

## Error Handling

**Patterns:**
- `try/catch` around async Supabase calls (~91 blocks in `src/`); errors are caught, logged, and swallowed — do not rethrow in UI-facing helpers (`src/lib/auditLog.ts` uses `console.warn` on failure)
- User-facing failure feedback via `sonner`/shadcn toast: `toast.success(...)`, `toast.error(...)` (~127 call sites). Prefer toast over `alert()` (`alert` appears only twice in `src/`).
- Supabase result-style: destructure `{ data, error }` and check `error` rather than throwing
- Auth/hook context misuse throws: `throw new Error("useAuth must be used within AuthProvider")` in `src/hooks/useAuth.tsx` — replicate this guard in new context hooks
- A top-level `ErrorBoundary` component exists at `src/components/ErrorBoundary.tsx`
- Edge functions (`supabase/functions/*/index.ts`): wrap handler in `try/catch` inside `Deno.serve`, return `new Response(JSON.stringify({ error: "..." }), { status: 4xx/5xx, headers: corsHeaders })` — see `supabase/functions/sync-alert/index.ts`
- Audit trail: use `logAction` / `logChange` (with object diffing) from `src/lib/auditLog.ts` for mutations that should be auditable

## Logging

**Framework:** `console` (no logging library)

**Patterns:**
- `console.warn` for recoverable failures in lib helpers (`src/lib/auditLog.ts`)
- Minimal `console.log`/`error` usage (~19 sites total in `src/`) — do not add verbose logging to UI code
- Edge functions print structured JSON results instead of prose logs (`supabase/functions/sync-worker/index.ts` pattern)

## Comments

**When to Comment:**
- Header block comments explaining **why** a module exists and non-obvious constraints — see `vite.config.ts` (chunking race explanation), `.github/workflows/sync-worker.yml` (scheduler history and caveats), `src/pages/orders/tabFilters.ts` (behavior-must-match-Orders.tsx contract)
- JSDoc one-liners on exported pure helpers — `src/lib/slug.ts`, `src/hooks/useDebounce.ts`, `src/lib/auditLog.ts`
- Inline comments for business rules (COD payment logic in `supabase/functions/_shared/woo-mapping.ts`)

**JSDoc/TSDoc:**
- Used for exported utility functions; not systematically used on components. Do not add ceremonial JSDoc to obvious props.

## Function Design

**Size:** No enforced guideline; page components are large (biggest: `src/components/orders/OrderDetailSheet.tsx` ~2100 lines, `src/pages/Orders.tsx` ~930 lines). **When extracting logic, follow the `src/pages/orders/tabFilters.ts` pattern: pull pure, dependency-free predicates into a small module so they can be unit-tested.**

**Parameters:** Plain positional for 1–2 args; single options object with 3+ — `diffObjects(before, after, options)` in `src/lib/auditLog.ts`

**Return Values:** Helpers return values or `null` for "nothing to do" (`diffObjects` returns `null` when no changes); async mutations return result objects `{ error }` (`signIn` in `src/hooks/useAuth.tsx`)

## Module Design

**Exports:**
- **Mixed, by category** (~120 default vs ~66 named across `src/`):
  - Page/feature components: `export default` — `src/components/StatusBadge.tsx`
  - Lib helpers, hooks, types, shared logic: named exports — `src/lib/*.ts`, `src/hooks/useAuth.tsx` (exports both `AuthProvider` and `useAuth`)
  - Shadcn UI primitives: named exports (`export { Button, buttonVariants }` in `src/components/ui/button.tsx`) — never edit these
- When adding a new pure-logic module, use named exports and keep it React/Supabase-free (see `src/pages/orders/tabFilters.ts`)

**Barrel Files:**
- None. Import directly from module paths.

## Stack-Specific Conventions

**Styling:** Tailwind CSS with shadcn/ui design tokens via CSS variables (`tailwind.config.ts`, `src/index.css`, `components.json`). Compose conditional classes with `cn()` from `src/lib/utils.ts`. Semantic colors (`bg-success`, `text-destructive`) over raw palette for status UI — see `src/components/StatusBadge.tsx`.

**Data fetching:** Supabase client singleton from `src/integrations/supabase/client.ts`; TanStack React Query (`@tanstack/react-query`) for server state; custom hooks wrap domains (`src/hooks/useDashboardData.ts`, `src/hooks/useBusinessProfile.tsx`). Generated DB types in `src/integrations/supabase/types.ts`.

**Forms:** `react-hook-form` + `@hookform/resolvers` + `zod` validation.

**Edge functions (Deno):**
- Entry: `Deno.serve(async (req) => ...)` in `supabase/functions/<name>/index.ts`
- Define `corsHeaders` const at top; answer `OPTIONS` with `new Response("ok", { headers: corsHeaders })`
- Auth pattern: service-role bearer OR `x-cron-secret` checked against a vault token via RPC — copy from `supabase/functions/sync-alert/index.ts`
- Shared logic goes in `supabase/functions/_shared/` (e.g., `woo-mapping.ts`, `courier-adapter.ts`) — these are TypeScript and importable by tests

**Documentation:** `CLAUDE.md` mandates: simplicity first, surgical changes (touch only what the task requires, match existing style), goal-driven execution with verification.

---

*Convention analysis: 2026-09-09*
