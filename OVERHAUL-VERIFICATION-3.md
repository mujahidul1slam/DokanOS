# OVERHAUL VERIFICATION — ROUND 3 (FINAL)

**Verdict: ALL VERIFIED — 14/14**

Scope: verify the round-2 gap (3.3: inner `path="*"` catch-all hijacked `/lp/` landing routes back to home) as fixed by commit `1b13932` (CatchAllGuard), plus confirmation that the rest of the matrix is unaffected. Method: direct read of `src/storefront/StorefrontApp.tsx` + the same empirical repro the round-2 verifier used (vitest 3.2.4 + jsdom 20 + @testing-library/react 16, project's own `react-router-dom@6.30.1`), updated with the fix applied.

## Verification matrix

| # | Claim | Result | Evidence |
|---|-------|--------|----------|
| 1 | Inner catch-all renders null for `/lp/` paths (no Navigate hijack) | PASS | `StorefrontApp.tsx:30-34` — `CatchAllGuard` returns `null` when `loc.pathname.startsWith(basePath + "/lp/")`; `<Navigate>` only in the else branch |
| 2 | `useLocation` imported; guard wired | PASS | `StorefrontApp.tsx:2` — `import { Route, Routes, Navigate, useLocation } from "react-router-dom"`; wired at `:75` — `<Route path="*" element={<CatchAllGuard basePath={basePath} />} />` |
| 3 | `/lp/:slug` renders CustomPage standalone OUTSIDE StorefrontLayout | PASS | `StorefrontApp.tsx:53-57` — own `<Routes>` block, `${basePath}/lp/:slug` → `<Suspense><LandingPage standalone /></Suspense>`, placed before `<StorefrontLayout>` (line 58); `LandingPage = lazy(CustomPage)` (line 20); `standalone` suppresses title header (`CustomPage.tsx:63`) |
| 4 | Repro: `/lp/test` and `/store/lp/test` no longer redirect home; unknown paths still redirect | PASS | 3/3 tests passed (below) |

Rest of matrix (unchanged by 1b13932 — the diff touched only the import line and the catch-all route): BrandProvider wraps both Routes blocks (`:50`); all 12 main routes inside `<StorefrontLayout>` (`:58-78`); 3.3 standalone chain intact (`CustomPage.tsx:14,63`).

## Repro results (3/3 passed)

Structural replica of the fixed `StorefrontApp.tsx:53-76` (sibling `<Routes>` blocks with the verbatim `CatchAllGuard`), rendered with `MemoryRouter`:

| Case | initialEntries | basePath | Result |
|------|----------------|----------|--------|
| /lp/ not hijacked | `/lp/test` | `""` | PASS — LANDING_RENDERED present, HOME_RENDERED absent |
| /lp/ not hijacked (nested basePath) | `/store/lp/test` | `/store` | PASS — LANDING_RENDERED present, HOME_RENDERED absent |
| Control: unknown path → home | `/unknown` | `""` | PASS — HOME_RENDERED present |

```
✓ src/tmp-catchall-guard-repro.test.tsx (3 tests) 32ms
Test Files 1 passed (1) — Tests 3 passed (3)
```

Round 2's failure mode (Navigate fires on mount → URL replaced → Home renders) is eliminated: for `/lp/` URLs the guard returns `null`, the inner Routes render nothing, and the sibling `/lp/:slug` route's landing page survives. Works for both `basePath=""` (`/lp/`) and `basePath="/store"` (`/store/lp/`).

## Notes

- Temp repro file deleted after run (same hygiene as round 2). Round 2's optional recommendation to keep a permanent regression test at `src/storefront/storefront-app-routes.test.tsx` was not applied — no test file exists in `src/`. Not blocking: all 4 verification points pass by code read + repro.
- Known acceptable edge (from round 2): `/lp` without a slug still falls through to the catch-all and redirects home.
