REVISE — 1 open item (server-side advance_percent clamp not delivered; brief's "already clamped" claim is factually wrong)

# CRITIC — Cycle 4 (final pass)

Scope: verify the 7 cycle-3 fixes landed (C3-F1..F7), and scan for regressions introduced by those fixes. Verified by direct file reads, grep sweeps, `tsc --noEmit -p tsconfig.app.json` (clean), and targeted ESLint (only pre-existing `no-explicit-any` errors; zero `no-unused-vars`/`no-unused-expressions` across all 7 touched files).

## MEDIUM

### C4-F1 — storefront-checkout — server still does not clamp `advance_percent` (C3-F7 only half-fixed)
- **File:** `supabase/functions/storefront-checkout/index.ts:209-211`
- **Defect:** The cycle-4 brief asserts the edge fn is "already clamped … min(pct,100)". It is not. Line 210: `const advancePct = advanceEnabled ? Number(sfSettings.delivery.advance_percent) : 0;` — no `Math.min/Math.max` anywhere in the compute region, and `validateSettings` (settings.ts:342-352) still has no advance bounds rule. Only the client was clamped (Checkout.tsx:169 `Math.min(delivery.advance_percent, 100)`).
- **Impact if settings hold pct > 100** (reachable: DeliveryTab:90 uses `Input max={50}`, which does not block typed input; nothing validates on save): client sends advance = 100% of total; server computes pct% → `|clientAdvance − serverAdvanceAmount| > 1` → 400 for every non-COD order (index.ts:217-219), and COD is 400 too (214-216). The store cannot check out at all until the merchant re-saves settings. Pre-fix behavior was a silent negative `amount_to_collect`; the half-fix traded silent corruption for a hard outage — correct direction, incomplete delivery.
- **Required fix (one line, index.ts:210):** `const advancePct = advanceEnabled ? Math.min(100, Math.max(0, Number(sfSettings.delivery.advance_percent))) : 0;` — optionmatch: with the server clamped identically to the client, pct>100 yields a consistent valid order. Optionally also add an advance bounds rule to `validateSettings` (belt-and-braces; the server clamp alone fully closes the defect).

## LOW

None new.

## New-bug scan (regressions introduced by cycle-3 fixes)

| Area changed | Check | Result |
|---|---|---|
| catalog.ts select strings (3 sites) | syntax, `.eq()` chains, mapProduct | OK — selects well-formed; `.eq("is_active", true)` etc. intact; `created_at: p.created_at \|\| ""` fallback sound |
| Shop.tsx sortFns table | Record completeness, mutation, stability | OK — full `Record<SortKey,…>`; `[...filtered]` copied before sort; `"featured": () => 0` relies on ES2019 stable sort, preserving server featured-first order |
| Shop.tsx `newest` NaN edge | `new Date("")` on missing created_at | Non-issue — `created_at` is now selected on every product list path; `tsc` enforces the type |
| Product.tsx handleShare | behavior + lint | OK — `await clipboard.writeText().catch(() => undefined)` then toast; not flagged by ESLint |
| AnimationsTab.tsx | import swap safety | OK — line 7 now imports `Slider`, legitimately used at :132 and :160; `Select` fully removed |
| Typecheck / lint | `tsc --noEmit`, ESLint on 7 files | tsc clean; ESLint shows only pre-existing `no-explicit-any` project-style errors |

## Cycle-3 resolution table

| # | Cycle-3 item | Verdict | Evidence |
|---|---|---|---|
| C3-F1 | newest sort by created_at | RESOLVED | Shop.tsx:24 `new Date(b.created_at) - new Date(a.created_at)`; catalog.ts: type :19, mapProduct :57, selects :72/:91/:129 all include `created_at` |
| C3-F2 | ProductCard unused `Heart` | RESOLVED | grep `Heart` in ProductCard.tsx: 0 matches |
| C3-F3 | DeliveryTab unused `Slider` | RESOLVED | grep `Slider` in DeliveryTab.tsx: 0 matches; ESLint clean of unused-vars |
| C3-F4 | AnimationsTab unused `Select` | RESOLVED | AnimationsTab.tsx:7 now imports `Slider` (used :132/:160); no `Select` references remain in file |
| C3-F5 | Product.tsx `ParsedAttr`/`loc`/expression | RESOLVED | grep: 0 hits for `ParsedAttr`, `useLocation`, `const loc`; handleShare rewritten (:129-133); ESLint unused/expression clean |
| C3-F6 | settings.ts unused `base` | RESOLVED | `const base` absent; only `DEFAULT_STOREFRONT_SETTINGS` definition remains (:326) |
| C3-F7 | advance_percent clamp 0–100 | PARTIAL | Client: RESOLVED (Checkout.tsx:169 `Math.min(...,100)`, `>0` gate :168). Server: NOT DONE (index.ts:210 unclamped; validateSettings 342-352 no advance rule) → C4-F1 |

**Cycle 3 tally: RESOLVED: 6, PARTIALLY: 1 (server half open as C4-F1), NOT: 0**

Convergence note: 4 cycles, trend 10 → 7 → 1. The sole remaining item is a one-line server-side clamp with an explicitly stated fix; once applied, parity work converges.
