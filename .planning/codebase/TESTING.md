# Testing Patterns

**Analysis Date:** 2026-09-09

## Test Framework

**Runner:**
- Vitest 3.2.4
- Config: `vitest.config.ts` — `environment: "jsdom"`, `globals: true`, `setupFiles: ["./src/test/setup.ts"]`, `include: ["src/**/*.{test,spec}.{ts,tsx}"]`
- `vitest/globals` types enabled in `tsconfig.app.json`

**Assertion Library:**
- Vitest `expect` + `@testing-library/jest-dom` matchers (loaded in `src/test/setup.ts`)

**Run Commands:**
```bash
npm test              # vitest run (all tests, single pass)
npm run test:watch    # vitest (watch mode)
```
No coverage script or coverage config exists.

## Current Test Suite (small)

The suite is minimal — **3 real files, all in `src/test/`**:

- `src/test/example.test.ts` — trivial placeholder (`expect(true).toBe(true)`)
- `src/test/tabFilters.test.ts` — pure-logic tests: orders tab predicates (`src/pages/orders/tabFilters.ts`) + WooCommerce status mapping (`supabase/functions/_shared/woo-mapping.ts`)
- `src/test/invoiceHtml.test.ts` — invoice HTML builders (`src/lib/invoiceHtml.ts`) with template/currency/section-flag assertions

**What is NOT tested:** React components, hooks, pages, edge functions (Deno runtime), SQL/RPC logic, the storefront subtree. No component tests exist despite `@testing-library/react` 16 being installed.

## Test File Organization

**Location:**
- Centralized: `src/test/` (not colocated with source). `vitest.config.ts` includes any `src/**/*.test.ts(x)` if you colocate instead, but current convention is the central folder.

**Naming:**
- `<moduleName>.test.ts` — one test file per extracted module

**Structure:**
```
src/
  test/
    setup.ts                  # jest-dom + matchMedia polyfill
    <moduleName>.test.ts      # unit tests for pure modules
```

## Test Structure

**Suite Organization:**
```typescript
// src/test/tabFilters.test.ts
import { describe, it, expect } from "vitest";
import { matchesTab, type TabOrder } from "@/pages/orders/tabFilters";
import { mapWooStatus, derivePaymentStatus } from "../../supabase/functions/_shared/woo-mapping";

describe("tabFilters - Delivered and other tabs", () => {
  const preOrderOrderIds = new Set<string>();

  it("should match delivered status in delivered tab", () => {
    const order: TabOrder = { id: "ord-1", status: "delivered", consignment_id: null, tracking_status: null };
    expect(matchesTab(order, "delivered", preOrderOrderIds)).toBe(true);
    expect(matchesTab(order, "all", preOrderOrderIds)).toBe(true);
    expect(matchesTab(order, "new", preOrderOrderIds)).toBe(false);
  });
});
```

**Patterns:**
- Plain `describe`/`it` — no `beforeEach`/`afterEach` used anywhere; setup is inline consts per test or shared per-suite consts
- Assertions are direct value comparisons (`.toBe`, `.toContain`, `.not.toContain`) on returned strings/booleans
- Group related modules in one file with multiple `describe` blocks (`src/test/tabFilters.test.ts` covers both `tabFilters` and `woo-mapping`)

**Setup:**
- `src/test/setup.ts` imports `@testing-library/jest-dom` and polyfills `window.matchMedia` (needed by Radix/tailwind consumers). Extend this file when a new browser global is needed (e.g., `ResizeObserver`).

## Mocking

**Framework:** Vitest `vi` built-ins

**Patterns:**
```typescript
// src/test/invoiceHtml.test.ts — module-level mock with deterministic stub
vi.mock("@/lib/barcodeSvg", () => ({
  makeBarcodeSvg: vi.fn((value: string) => (value ? `<svg>stub-${value}</svg>` : "")),
}));
```

**What to Mock:**
- Impure side-effect modules whose output is layout/environment-dependent (`@/lib/barcodeSvg`)
- Browser globals in `src/test/setup.ts` (`matchMedia`)

**What NOT to Mock:**
- The module under test's pure logic — `src/pages/orders/tabFilters.ts` is deliberately dependency-free (no React, no Supabase) precisely so it needs no mocks (stated in its header comment). Keep extracted modules that way.
- Supabase is not mocked in any existing test; tests only exercise code that doesn't touch the client

## Fixtures and Factories

**Test Data:**
```typescript
// src/test/invoiceHtml.test.ts — inline literal fixtures + tiny factory helper
const biz: InvoiceBizInfo = { business_name: "DokanOS", tagline: "Shop Smart", /* ... */ };
const cart: Cart = { id: "cart-1", label: "TEST", items: [ /* ... */ ], /* ... */ };
const tpl = (over: Partial<InvoiceTemplateConfig> = {}): InvoiceTemplateConfig => ({
  ...defaultInvoiceTemplate, ...over,
  sizing: { ...defaultInvoiceSizing, ...(over.sizing || {}) },
});
```

**Location:**
- Inline in the test file. No fixtures directory, no factory library. Follow this pattern: typed literal + spread-override factory function.

## Coverage

**Requirements:** None enforced (no coverage config, no thresholds)

**View Coverage:**
```bash
npx vitest run --coverage    # ad hoc; @vitest/coverage-v8 not installed
```

## Test Types

**Unit Tests:**
- Pure TypeScript functions only (predicates, HTML builders, mapping functions). Current scope: order tab logic, Woo status mapping, invoice print HTML/CSS.

**Integration Tests:**
- None in Vitest. The closest thing is SQL "verification oracle" migrations — temporary `verify_*` SQL functions created then dropped by paired migrations (e.g., `supabase/migrations/20260901000190_verify_phase1_final_v2.sql`, `20260904000200_verify_foundation.sql`) that assert DB invariants. These run against the live database via `supabase db push`, not in CI.

**E2E Tests:**
- **Configured but non-functional.** `playwright.config.ts` imports `lovable-agent-playwright-config/config`, but that package is not in `package.json` nor installed in `node_modules` — Playwright E2E cannot currently run. `playwright-fixture.ts` just re-exports the package fixture. Ad-hoc E2E scripts exist as scratch files in `.tmp/*.cjs` (run manually against production; not a committed framework).

## Common Patterns

**Async Testing:**
- Not exercised yet — existing tests are all synchronous. Use `await expect(...)` / `waitFor` from `@testing-library/react` when adding async tests.

**Error Testing:**
- Not exercised yet. Supabase error-result code (`{ data, error }` destructuring) is best tested by extracting the decision logic into a pure function first (the `tabFilters.ts` pattern).

## Establishing Precedent — How to Test New Code

1. **Extract business logic into a pure, dependency-free module** (like `src/pages/orders/tabFilters.ts`): no React, no Supabase imports, typed inputs via minimal interfaces (`TabOrder`).
2. **Write the test in `src/test/<moduleName>.test.ts`** using `describe`/`it`, `@/` alias imports, inline typed fixtures.
3. **Verify with `npm test`** — the suite must stay green; it runs in seconds with no DB or network.
4. For component/hook work, `@testing-library/react` + `@testing-library/jest-dom` are installed and configured — follow React Testing Library conventions (query by role/label, no internals) if adding component tests.
5. Do not rely on Playwright until `lovable-agent-playwright-config` is added to `package.json`.

---

*Testing analysis: 2026-09-09*
