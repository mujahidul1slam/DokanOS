# NEXT PATCH — Implementation Plan

Agreed scope from the `/grill-with-docs` design interview, 2026-10-26.  
Issue tracker: [mujahidul1slam/DokanOS#17](https://github.com/mujahidul1slam/DokanOS/issues/17) (epic).  
Decisions: [GLOSSARY.md](GLOSSARY.md) (Ordering), [ADR-0001](docs/adr/0001-woo-online-payment-gate.md), [ADR-0002](docs/adr/0002-order-merge-split-payment-semantics.md).

## Release shape

| Patch | Contents | When |
| --- | --- | --- |
| **A** | Fixes + workflow/UX work | Ships first |
| **B** | Domain changes (payment gate, measurements, merge/split, duplicate, search) | After A |
| **Deferred** | AI product search (own spec), weekly/monthly POS reports, automated payment webhooks | Later |

## Issue map

### Patch A

| Issue | Scope |
| --- | --- |
| [#16](https://github.com/mujahidul1slam/DokanOS/issues/16) | Pre-commit cleanup: finish Analytics scoping, remove stray deps, quarantine artifacts, delete dead `Dispatch.tsx` (separate commit). **Do first — unblocks the rest.** |
| [#18](https://github.com/mujahidul1slam/DokanOS/issues/18) | Parcel cancel/replace: adopt WIP, verify replace/skip, edge cases |
| [#4](https://github.com/mujahidul1slam/DokanOS/issues/4) | SS/message parsing: restore `LOVABLE_API_KEY` (**human/ops**), surface config errors |
| [#19](https://github.com/mujahidul1slam/DokanOS/issues/19) | Add Order fixes: product images (`referrerPolicy`), customer autofill by phone |
| [#3](https://github.com/mujahidul1slam/DokanOS/issues/3) | City/Area autofill: contains-matching, fuzzy areas, fixtures |
| [#20](https://github.com/mujahidul1slam/DokanOS/issues/20) | Size/variation selection in Order Info picker + ExchangeDialog |
| [#21](https://github.com/mujahidul1slam/DokanOS/issues/21) | Brand/Selling Point/Pathao Account: selection rules, settings defaults, brand column |
| [#22](https://github.com/mujahidul1slam/DokanOS/issues/22) | Branded identity selector (Add Order + Dispatch), smart Pathao Account dispatch, batch X-remove |
| [#23](https://github.com/mujahidul1slam/DokanOS/issues/23) | Create & Dispatch + optional courier product descriptions |
| [#24](https://github.com/mujahidul1slam/DokanOS/issues/24) | Print: slip branding/customization, thermal mono + bold, POS daily print |
| [#25](https://github.com/mujahidul1slam/DokanOS/issues/25) | Settings: sticky save bar + route-away guard |
| [#26](https://github.com/mujahidul1slam/DokanOS/issues/26) | Products page hover/tap image preview |

### Patch B

| Issue | Scope |
| --- | --- |
| [#27](https://github.com/mujahidul1slam/DokanOS/issues/27) | Payment gate (Woo online only) + Payment Needs Confirmation rename (ADR-0001) |
| [#28](https://github.com/mujahidul1slam/DokanOS/issues/28) | Measurements: deferred entry, category cascade/exclusions, product overrides |
| [#29](https://github.com/mujahidul1slam/DokanOS/issues/29) | Duplicate-order warning (phone + product + brand, 48h, warn-only) |
| [#30](https://github.com/mujahidul1slam/DokanOS/issues/30) | Same-customer grouping + merge (pre-entry only, ADR-0002) |
| [#31](https://github.com/mujahidul1slam/DokanOS/issues/31) | Order split with payment transfer + charge allocation (ADR-0002) |
| [#32](https://github.com/mujahidul1slam/DokanOS/issues/32) | Change order Brand/Selling Point from Order Info |
| [#33](https://github.com/mujahidul1slam/DokanOS/issues/33) | Fuzzy product search upgrade (AI search deferred) |

## Cross-cutting rules

- **Language** (glossary): Brand ≠ Selling Point ≠ Pathao Account. `store_id` stores the Selling Point internally; UI copy says "Selling Point". Use glossary terms everywhere.
- **POS screen** is untouched by brand-selection behavior.
- **Duplicate rule**: same customer (normalized phone) + same product + same brand within 48h; stores/selling points may differ; warn-only, dismissible.
- **Payment gate** (ADR-0001): WooCommerce online-payment orders only; manual/POS/COD never gated; label-only rename; manual permission-controlled confirmation.
- **Merge/split** (ADR-0002): merge pre-entry only; split distinguishes COD / new payment / transferred payment; charges allocated per resulting order; existing money never duplicated.
- **Slips**: pickup slip elements customizable (brand, selling point, source, Pathao account); thermal formats monochrome + bold option.

## WIP disposition (accepted)

Branch `Frontpage`, 13 modified files (+5,069/−151):

- **Keep** (lands with #18): `pathao-courier` replace flow, DispatchDialog replace/skip, envelope-unwrap fixes in AttachParcelDialog/OrderDetailSheet.
- **Finish before commit** (#16): Analytics store-scoping (empty guard, effect deps, `prevQuery`).
- **Remove**: `opencode-models-discovery`, `headroom-ai` (never imported).
- **Leave untracked**: `.audit-ux/`, `.scratch/`, `test-results/`, `.gitattributes`, `.graphifyignore`, `.planning/`.
- **Delete separately**: unrouted `src/pages/Dispatch.tsx` (1,040 lines) — its WIP diff becomes moot.

## Out of scope (explicitly)

- AI/semantic product search — separate spec.
- Weekly/monthly POS reports — daily only for now.
- Automated payment webhooks — manual confirmation only.
- Payment-status stored-value migration — display-only rename.

## Fix root causes (verified in code)

1. **Product images**: `MiniProductCatalog.tsx` lacks `referrerPolicy="no-referrer"` (Products/POS have it) — hotlinked CDN URLs reject referrer-bearing requests.
2. **SS/message parsing**: `parse-order-text` 500s when `LOVABLE_API_KEY` is missing in deployed Edge Function secrets.
3. **City/Area**: cmdk prefix-only dropdown search + strict-only area matching + zone fuzzy disabled (`pathaoMatch.ts`).
4. **Customer autofill**: never implemented on Add Order (POS-only lookup).
5. **Size selection**: Order Detail add-product picker shows base products only; ExchangeDialog items are free text.
