# Domain Revamp Spec — Accounts / Multi-Business / Brands / Order Sources

Status: **agreed in design interview (grill), 2026-10-29. Awaiting final user confirmation before implementation.**
Scope: hierarchy revamp, terminology consolidation, onboarding, signup, migration of the single real tenant.

---

## 1. The new hierarchy (the whole product in one picture)

```
Personal account (User)
 └─ member of → Business account(s)        [role chosen at invite time]
      ├─ Courier services                  (business level)
      ├─ Payment accounts                  (business level)
      ├─ Members & invites
      └─ Brand(s)
           ├─ Products                     (brand-level catalog)
           ├─ Customers                    (brand level)
           ├─ Warehouses                   (brand level, many; stock-only)
           └─ Order sources                (brand level, many)
                types: WooCommerce · Storefront (Dokan OS) · Showroom /
                       Physical store · Facebook · Instagram · WhatsApp ·
                       Manual (user-named: Phone, Wholesale, Referral, …)
```

**Rules that fall out of this:**
- One order source = one real-world place/channel orders come from. Nothing else represents that (see §2).
- Stock lives at **warehouses** and at **stock-holding order sources** (physical ones only). Warehouses are never order sources; digital order sources never hold stock.
- Products and customers live at **brand** level. Orders roll up source → brand → business.
- There is no "location" entity and no "integration"/"connector" entity. Ever.

## 2. Terminology consolidation — what dies into what

Five legacy tables describe one concept (`stores`, `selling_points`, `brand_stores`,
`order_sources` lookup, `storefronts`) plus sync registries (`product_sources`,
`customer_sources`) and connector rows (`connectors`). All of it collapses:

| Legacy | Fate |
|---|---|
| `stores` (Woo registry) | → order source, type `woocommerce` (config: URL + API keys) |
| `selling_points` | → order sources by type; `showroom_pos` merges into its showroom; POS binds to the showroom source |
| `brand_stores` (half-merge) | → absorbed; its `legacy_*` idea becomes the audit mapping (§7) |
| `order_sources` lookup (online/pos/phone/social/wholesale) | → dead; replaced by per-brand order source rows (manual channels are user-created) |
| `storefronts` | → order source, type `storefront` |
| `locations` (warehouse/showroom/store/online) | → warehouses (stock) + showroom order sources (demand). Entity removed |
| `connectors` | → channel configs live on their order source; courier configs → courier services (§4). Nothing else exists yet |
| `product_sources` / `customer_sources` | → sync config lives on the order source (direction, schedule, last-sync, errors) |

**Order sources come in two flavors:**
- **Connected** — WooCommerce, Storefront, Facebook, WhatsApp… orders arrive/sync through them.
- **Manual** — user-created and named ("Phone Orders", "Wholesale", "Referral"); staff pick the source when entering an order. Walk-in sales attach to the showroom/physical-store source itself.

**Orders** always name their source: `orders.order_source_id`. The `source` text column dies.

## 3. Stock model

- A brand-wide stock pool: every order source sees all of the brand's stock (across warehouses and stock-holding sources).
- Physical order sources (showroom, physical store) have a **stock-holding toggle** (default on); digital ones never hold stock.
- Each order source has a **fulfillment preference** (which stock to draw first; e.g. Warehouse 1 first, showrooms as fallback) and an explicit **ship-from-store toggle**.
- **Transfers in v1**: simple from-location → to-location, items + quantity (warehouse ↔ showroom ↔ showroom). Without them showroom stock is stranded.
- `product_locations` semantics stay (per-location stock rows), now pointing at warehouses and stock-holding order sources.

## 4. Shared business-level services

- **Courier services** (Pathao, Steadfast, RedX, eCourier…): business level — one courier account per business, enabled at fulfillment time. No per-brand duplication.
- **Payment accounts** (bKash, Nagad, Stripe, card…): business level credentials; each order source **toggles which methods it accepts** (COD for the showroom, gateways for the storefront, …). No separate integrations area — this and couriers are the only "connections" the product has.

## 5. Accounts, roles, default business

- **Signup**: name, email, password **+ confirm password** (added — currently missing), strength meter, consent, CAPTCHA. Rule: every password entry form has a confirm field (signup, reset, change).
- **Email verification is the hard gate.** Everything else (photo, name, phone) is prompted but skippable.
- **Personal setup screen** immediately after email verification: "Set up your profile" (photo, name, phone), skippable, completable later in profile settings.
- **Default business account** (personal profile settings):
  - Controls **post-login landing only**. Quick-create targets whichever business you are *currently* in. Search is scoped to the current business. Notifications merge across all your businesses, grouped/labelled per business.
  - Exactly one business → auto-selected everywhere; no picker, no prompt.
  - Default deleted / membership lost → silently fall back to the sole (or first) remaining business. No businesses at all → "create or join a business" screen (join = accept invite).
- **Roles** (business-wide ladder): **Owner → Admin → Manager → Staff**. The inviter picks the role on the invite; changeable later. Per-brand scoping is explicitly out of scope (possible later).

## 6. Onboarding

### 6a. Business creation onboarding (created from scratch; invited members never see it)
Order: **business profile → first brand → order sources → warehouses → product import → (optional) storefront**.

1. **Business profile** — name, currency, contact basics.
2. **First brand** — explicit step: name it, optional logo (never mandatory). No ghost/untitled brands.
3. **Connect order sources** — WooCommerce (with connection push → **import products**), Storefront, Facebook, WhatsApp, Showroom/physical store, or manual channels.
4. **Warehouses** — add one or more (brand level).
5. **Product import** — WooCommerce import (if that source was connected), **CSV import**, or manual. (CSV is an *action*, not an entity.)
6. **Storefront creation** — only if the customer chose Storefront as an order source. Launches the **storefront sub-onboarding** (name/slug, theme, payments, publish).

Properties: **skippable** at any step, **resumable** (persistent checklist), **re-runnable** from settings.
**Storefront sub-onboarding runs the same way whenever a storefront is created**, at any time, not just during onboarding.

### 6b. Invited members
No business onboarding at all — only the personal profile setup.

## 7. Migration — single real tenant, one maintenance window

**Real tenant (keep):** business `de31fd60-…` "Enveil Vincent" (created 2026-09-03, onboarded 2026-10-14), brands **Vincent** `ca061912-…` and **Enveil** `3eb99fc9-…`, owners Tasmim-Manager `e97cb5a0-…` and `6c96f0ad-…`.
**Wipe:** 7 test businesses (incl. the duplicate "Enveil Vincent" `13e888dc-…` — a 2-minute onboarding skeleton with zero data), 6 test brands/stores, 7 storefronts, 4 locations, 14 selling points, 1 connector, 7 access rows.

⚠ **Name traps — everything by UUID, never by name:** two businesses are named "Enveil Vincent"; and `Enveil Woocommerce` `9d2cc780-…` (junk, under Vincent — delete) vs `Enveil WooCommerce` `9a3fb6c0-…` (real, under Enveil — keep).
⚠ The test storefront "AGS" points at the **real Enveil store** — sever that link before deleting test data.

**Junk rows inside the real business (delete, all verified zero child rows):** brand `safsdfsafsd` + its storefront (+2 pages), selling points `Badda Showroom` `7df6baea-…` and `Enveil Woocommerce` `9d2cc780-…`.

### Row-level mapping (per brand)

| Legacy rows | New row |
|---|---|
| Woo `store` + `selling_points` woocommerce + `connectors` channel/woocommerce + brand_stores row + product/customer_sources | **1 order source · WooCommerce** (config = URL + keys; sync config on the source) |
| `storefront` + `selling_points` dokanos_storefront | **1 order source · Storefront** |
| `locations` "Main" (showroom) + `selling_points` showroom_pos | **1 order source · Showroom** (stock-holding ON; POS binds here) |
| `selling_points` facebook/instagram | **1 order source · Facebook/Instagram** |
| `locations` "Warehouse" (Vincent) | **warehouse** (stock-only, brand setting) |

→ Result: **4 order sources + 0–1 warehouses per brand.** (Vincent: Main showroom, Warehouse. Enveil: Main showroom, no warehouse yet — fine.)

### Data mapping

| Data | Mapping |
|---|---|
| Products 225 (V 133 / E 92) + 1,204 variations | brand catalog; **provenance = their WooCommerce order source** |
| Customers 2,020 store-bound | brand level; **provenance = their source** (order source + how: woo sync / CSV / POS / manual / legacy) |
| Customers 1,202 unattributed | 2 phone/alias-matched → merge into the brand customer; **1,200 → "Legacy / unattributed" pool at business level** (tagged `legacy migration`, reassignable from the UI) |
| Orders 3,201 attributed (V 2,310 / E 891) | → the mapped order source of their store/selling point |
| Orders 849 unattributed (842 pos, 6 fb/ig, 1 exchange) | **96 inferred** via customer phone/id match (73 Vincent / 23 Enveil); **753 → Legacy / unattributed pool** (same tagging/reassignment) |
| Stock 205 rows (Enveil Main 81/0 · Vincent Main 124/61 · Warehouse 0) | stay put — showrooms keep their stock rows; warehouse stays empty |
| Pathao: 2 global integrations + courier tables | → **business-level courier services** (§4) |
| Roles `owner/admin/member/viewer` | → `Owner/Admin/Manager/Staff` (owner→Owner, admin→Admin, member→Manager, viewer→Staff) |

Migration is **one-shot in a short maintenance window** (brief read-only freeze), **strictly by id**. Rollback: the pre-migration backup. Post-migration audit report before removing legacy tables (legacy ids kept in a `legacy_*` mapping column on the new rows).

## 8. UI surface changes (consequences, not decisions)

- `/stores` StoresHub (7 tabs) dissolves → **Order Sources** page per brand + **Warehouses** in brand settings.
- `/integrations` dies entirely. Couriers + payment accounts live under business settings.
- Signup gains confirm-password; profile gains default-business selector.
- Orphaned code (`src/components/onboarding/` Step1–4, `Dispatch.tsx`) is not resurrected; new onboarding is built fresh against §6.
