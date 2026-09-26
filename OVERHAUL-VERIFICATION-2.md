# OVERHAUL VERIFICATION — ROUND 2

**Verdict: GAPS FOUND — 13/14**

Scope: re-verify the round-1 gap (3.3: `/lp` landing route rendered inside StorefrontLayout) as fixed by commit `78dbba9`, plus re-scan of the full 14-item matrix. Method: direct read of `src/storefront/StorefrontApp.tsx` + empirical repro test (vitest + jsdom + react-testing-library, project's own `react-router-dom@6.30.1`).

## Verification matrix

| # | Claim | Result | Evidence |
|---|-------|--------|----------|
| 1 | `/lp/:slug` route OUTSIDE `<StorefrontLayout>` (no header/footer) | PASS | `StorefrontApp.tsx:46-50` — own `<Routes>` block with `${basePath}/lp/:slug` → `<Suspense><LandingPage standalone /></Suspense>`, placed before `<StorefrontLayout>` (line 51) |
| 2 | Main routes (home/shop/product/collections/cart/checkout/checkout-success/track/about/contact/policies/pages) INSIDE StorefrontLayout | PASS | `StorefrontApp.tsx:51-69` — all 12 routes inside `<StorefrontLayout>`; chrome intact |
| 3 | BrandProvider wraps both | PASS | `StorefrontApp.tsx:43-70` — both Routes blocks are children of `<BrandProvider>` |
| 4 | Inner `<Route path="*" Navigate>` catch-all does NOT hijack `/lp/` routes | **FAIL** | Empirical repro (below): `/lp/foo` redirects to home before the landing page renders, for both `basePath=""` and `basePath="/store"` |
| 5 | 3.3 chain: standalone prop suppresses title header; scaffold + landing type + AI sections intact | PASS | `CustomPage.tsx:14` (`standalone` prop), `:63-66` (`{!standalone && (<h1>title</h1>)}`), `:68` (`PublishedPageView sections={data.sections}`); `StorefrontApp.tsx:20,48` (`LandingPage = lazy(CustomPage)`, rendered with `standalone`) |

## Gap detail (claim 4 — 3.3 regression)

The 78dbba9 structural move is correct but ineffective at runtime. `react-router-dom@6.30.1` matches each sibling `<Routes>` independently against the current URL. For `/lp/:slug` URLs, the second `<Routes>` block's `path="*"` is the best match, so it renders `<Navigate to={basePath} replace />` (StorefrontApp.tsx:66). `<Navigate>` navigates in an effect on mount → URL is replaced with `basePath` → the landing page unmounts and `Home` renders. In production, every `/lp/<slug>` page redirects to the storefront home immediately and is never visible.

Repro test (run against the project's node_modules; exact same router version):

```tsx
// Two sibling Routes blocks, structurally identical to StorefrontApp.tsx:46-67
function App({ basePath }: { basePath: string }) {
  return (
    <>
      <Routes>
        <Route path={`${basePath}/lp/:slug`} element={<Suspense fallback={null}><div>LANDING_RENDERED</div></Suspense>} />
      </Routes>
      <Routes>
        <Route path={`${basePath}`} element={<div>HOME_RENDERED</div>} />
        <Route path="*" element={<Navigate to={basePath} replace />} />
      </Routes>
    </>
  );
}
// MemoryRouter initialEntries={["/lp/foo"]} → FAILS: body shows HOME_RENDERED,
// LANDING_RENDERED never present (Navigate fired). Same at basePath="/store".
// Control: initialEntries={["/"]} → PASSES (Home renders).
```

Result: 2/3 tests failed — both `/lp/` cases hijacked; home control passed. Temp test file deleted after run (would break `npm test` while red).

## Recommended fix

Guard the catch-all against `/lp/` paths in `src/storefront/StorefrontApp.tsx`:

```tsx
import { useLocation } from "react-router-dom";

function CatchAll({ to }: { to: string }) {
  const { pathname } = useLocation();
  if (pathname.startsWith(`${to}/lp/`)) return null;
  return <Navigate to={to} replace />;
}
```

Replace `StorefrontApp.tsx:66` with `<Route path="*" element={<CatchAll to={basePath} />} />`. Works for both `basePath=""` (`/lp/`) and `basePath="/store"` (`/store/lp/`). Note: `/lp` without a slug still falls through to the catch-all and redirects home — acceptable.

## Next step

Apply the CatchAll guard, then re-run the repro above as a regression test (`src/storefront/storefront-app-routes.test.tsx`) — it should pass 3/3. Then re-run verifier round 3.
