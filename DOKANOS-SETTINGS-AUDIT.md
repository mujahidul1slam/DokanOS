# DokanOS Settings & Account Structure Audit

**Scope:** User accounts, business accounts, profile settings, operational settings, overall structure, UI quality, and competitive comparison.
**Method:** Full static review of `src/` (258 files), 129 Supabase migrations (RLS policies), and 13 edge functions. September 2026.

---

## 1. Executive Summary

DokanOS is a well-built single-operator commerce OS (Vite + React 18 + shadcn/ui + Supabase + RLS) whose settings architecture is **stronger than typical WordPress/Dokan-era products** — grouped, searchable, mobile-aware settings; ~40 granular permissions; real audit logging; a genuine multi-business/org hierarchy with a sidebar switcher. Every settings tab I traced is **wired to real persistence** (no dead buttons), with two exceptions: the legacy "General" tab (localStorage-only) and one critical RLS flaw in the multi-business foundation.

**Scorecard (out of 10):**

| Area | Score | Notes |
|---|---|---|
| Settings IA & navigation | 8.5 | Grouped master-detail, search, mobile pattern |
| User account UI | 7.5 | Clean; no email change, no 2FA |
| Business account UI | 8 | Org switcher + fresh-install flow; duplicate-slug handled |
| Team/permissions | 9 | Granular perms, custom roles, per-store scoping, server-side RPCs |
| Settings correctness (do they work?) | 7 | All tabs persist; 4 overlapping "business identity" sources |
| Security of settings/data | 5.5 | One critical multi-tenant escalation; otherwise good hygiene |
| UI consistency & polish | 8 | SettingsSection standard, hints, skeletons, empty states |
| Parity vs Shopify/Dokan feature set | 6 | No tax/VAT, notifications, i18n, 2FA, billing, webhooks UI |

---

## 2. Overall Structure

### 2.1 Application map

```
/login, /reset-password          (public, Supabase Auth)
└── DashboardLayout (authed)
    ├── /            Dashboard        PermissionGuard(dashboard.view)
    ├── /orders      Orders (9 tabs)  PermissionGuard(orders.view)
    ├── /pos         POS              PermissionGuard(pos.use)
    ├── /pos/reports POS Reports      PermissionGuard(analytics.view)
    ├── /products    Products          PermissionGuard(products.view)
    ├── /customers   Customers         PermissionGuard(customers.view)
    ├── /analytics   Analytics         PermissionGuard(analytics.view)
    ├── /integrations Integrations     PermissionGuard(integrations.view)
    ├── /settings    Settings          PermissionGuard(settings.view)
    ├── /team        Team              PermissionGuard(team.view)
    ├── /stores      StoresHub         PermissionGuard(dashboard.view)
    └── /storefronts StorefrontsPage   ⚠ UNGUARDED (no permission check)
```

- Route-level guards via `PermissionGuard` + a `roles` array per sidebar item; `AppSidebar.tsx:36-69`.
- `/storefronts` renders for **any authenticated user** (even `viewer`); writes will fail on RLS for non-admins, but the management UI is exposed. Minor gap.
- `pages/Stores.tsx` (306 lines) is **dead code** — replaced by `StoresHub`, no longer imported by `App.tsx`.
- Sidebar extras: ⌘K command palette, theme toggle, business switcher dropdown, mobile bottom nav. Good.

### 2.2 Settings page IA (`SettingsPage.tsx`)

A custom two-pane master-detail with search (not Radix Tabs):

| Group | Tabs |
|---|---|
| Account | My Profile · Business Account · Brand Settings |
| Business | General & Business Profile |
| Operations | Inventory · POS · Orders · Pre-Orders · Measurements |
| Documents & Sources | Invoice / Pickup Slip · Order Sources |
| System | Activity Log |

Desktop shows list + content; mobile becomes list → detail with a back button (`SettingsPage.tsx:241-257`). Every tab has keywords for fuzzy search. This is **better than Dokan/Woo flat settings** and roughly matches Shopify's settings sidebar pattern.

### 2.3 Data model hierarchy (multi-business foundation, 2026-09-04 migration)

```
User ─< user_business_access >─ Business ─< Brand ─< {Locations, Selling Points,
                                    │         Connectors, Product/Customer Sources}
                                    └─ invoice_settings (legacy branding row)
```

- `useBusinessContext.tsx` loads memberships → businesses, persists active business in `localStorage`, subscribes to a realtime channel on `user_business_access` so membership changes propagate live. Brands load per active business with per-business brand persistence. Solid design.
- Sidebar falls back to legacy `invoice_settings` "profiles" when no businesses exist (`AppSidebar.tsx:92-101`) — a sensible Phase-1 bridge, but it means two sources of truth coexist today (see §5).

---

## 3. User Accounts

### 3.1 Sign-in (`Login.tsx`) — works

- Email + password, show/hide password toggle, inline "Forgot password?" mode switch.
- Reset uses `supabase.auth.resetPasswordForEmail` with `redirectTo: /reset-password`; `ResetPassword.tsx` validates min-6-char, confirm-match, then `updateUser`. Functional end-to-end.
- Missing: MFA/2FA, magic link/social login, sign-in rate-limit feedback, "remember me".

### 3.2 My Profile (`ProfileSettingsTab.tsx`) — works

| Element | Verdict |
|---|---|
| Photo upload (≤2MB, image/*, upsert to `invoice-assets`, public URL) | Works; remove button; initials fallback avatar |
| Full Name → `profiles` table (insert-own or update-own by `profileId`) | Works; RLS `user_id = auth.uid()` enforces ownership |
| Email (disabled) | Correctly read-only; **no email-change flow exists** (Shopify/Woo have one) |
| Role badge + "Member since" | Works (`user_roles`, `user.created_at`) |
| Change password (min 8, confirm, error mapping incl. "must be different") | Works via `supabase.auth.updateUser`; audit-logged as `password_change` |
| Session → Sign Out | Works |

UX details done right: draft/original dirty tracking, save button disabled while saving, upload-then-"remember to save" toast. No inline field validation (no react-hook-form/zod here — zod is a dependency but unused in settings); errors surface as toasts on save only.

### 3.3 Team management (`TeamManagement.tsx` + `UserAccessDialog.tsx` + `team-manage` edge fn) — works

- **Invite Member** dialog with two modes: Email invite (Supabase `inviteUserByEmail`) or Set Password (admin `createUser` — realistic for BD shops where staff have no email). Role select: admin/staff/viewer. Password mode enforces 8-char minimum client-side.
- All mutations go through the `team-manage` edge function using the **service-role key**, gated by a verified caller `user_roles.role = 'admin'` check (`team-manage/index.ts`) — the right pattern, since client-side role writes are impossible.
- Invitations tab: resend email, delete invite (with confirm dialog).
- **User Access Dialog** (per member, 4 tabs):
  - Preset role baseline
  - Custom roles (checkbox list from `custom_roles`, counts shown)
  - ~40 granular permissions in 8 groups (Dashboard, Orders×10, Pre-orders, Customers, Products×6, POS×6, Analytics, Integrations & Stores, Settings & Team) with tri-state grant/revoke/default overrides
  - Per-store access checkboxes (`user_store_access`)
- Permissions resolve server-side via RPCs `get_user_permissions` / `get_user_store_ids` (cannot be spoofed client-side). Large-discount thresholds come from `permission_settings`.
- Wipe-and-reinsert saving pattern for roles/overrides/store access is simple and works, though it's not atomic (partial failure leaves mixed state; error is toasted).

**Verdict:** This permission system is *more granular than Dokan's fixed vendor roles* and approaches Shopify's staff-permission model. Gaps: no per-business scoping in the dialog yet (permissions are still platform-global, not `user_business_access`-role driven), and no invite expiry.

### 3.4 Account-related RLS findings

| Table | Policy state | Risk |
|---|---|---|
| `profiles` | SELECT: all authenticated; INSERT/UPDATE: own row | OK (names visible cross-tenant is acceptable for team pages) |
| `user_roles` | SELECT: authenticated; ALL: admin | OK |
| `user_permissions` | SELECT: admin or own user (2026-06-14 tightening) | OK — and UI reads via RPC anyway |
| `user_business_access` | **"Users can write own access" FOR ALL: `user_id = auth.uid()` OR admin** | 🔴 **CRITICAL — see §6** |

---

## 4. Business Accounts

### 4.1 Sidebar business switcher — works

Dropdown with logos/initials, "Switch business" label, brand count footer ("N brands · manage in Stores"). Only shows the chevron switcher when `hasMultiple` or always for management. Switching persists via `localStorage` and reloads brands. Same visual shape as Shopify's org/store switcher.

### 4.2 Business Account tab (`BusinessAccountTab.tsx`) — works

- Fields: Logo (≤2MB upload), Name, Slug (auto-slugified, hint tooltip explains uniqueness), Currency (8 options + passthrough for legacy values), Timezone (8 zones + passthrough), Address, Phone, Email.
- Save → `businesses.update` keyed by id; **duplicate slug (PG 23505) is caught and surfaced** ("That slug is already taken by another business"). Draft re-seeds only when `active.id` changes, so mid-typing edits survive context refreshes — thoughtful.
- Loading skeleton; audit-logged (`business_account`, before/after diff).
- **Fresh-install path:** if no businesses exist, the tab becomes a Create Business form (name + auto-slug), inserts the business then a `user_business_access` owner row for the creator, with clear error copy if RLS blocks staff ("only account admins can provision new businesses"). Good onboarding fallback.

### 4.3 Brand Settings tab (`BrandSettingsTab.tsx`) — works

Per-brand cards under the active business: name, slug (validated, duplicate-safe), logo upload, active toggle, Woo store link. Saves per-brand to `brands` with audit diffs. Correctly scoped `business_id`.

### 4.4 Stores hub (`StoresHub.tsx`)

Accordion per brand with tabs: Locations (warehouse/showroom, default flag), Selling Points (POS channels bound to locations), Connectors, Product/Customer Sources, Suppliers (with factory flag + activate toggle). This mirrors a lightweight **Shopify Locations model**. Forms are functional inserts with toasts; no edit-in-place (add + toggle only), which is a reasonable v1.

**Verdict:** Business account UI/UX is genuinely good — better than Dokan's vendor dashboard and close to Shopify organization management, minus billing/plan management.

---

## 5. Profile Settings — The Fragmentation Problem

There are **four overlapping definitions of "business identity"**, and this is the biggest structural weakness in settings:

| # | Where | Persists to | Consumed by |
|---|---|---|---|
| 1 | Settings › *General & Business Profile* ("General Settings" card) | **localStorage only** (`omnisync-business-name`, `omnisync-currency`, `omnisync-timezone`) + audit log | Nothing else reads these keys except this tab |
| 2 | Settings › Business Account | `businesses` table | Sidebar (primary), new flows |
| 3 | Settings › General → *BusinessProfileTab* | `invoice_settings` row (business_name, tagline, address, phone, email, logo) | Invoices, legacy fallback in sidebar |
| 4 | Settings › Brand Settings | `brands` table | Stores hub, storefronts |

Consequences:

1. **The "General" tab lies to users.** `handleSaveGeneral` writes only to localStorage yet toasts "Settings saved" (`SettingsPage.tsx:122-134`). A user who changes their business name here sees no effect anywhere else, and it silently diverges per device. This is the single most misleading settings surface in the app.
2. **Currency has four lives**: `businesses.currency` (BDT…), the localStorage symbol (৳), ~50 files with hardcoded `৳`, and a `useCurrency` hook used only by the storefront. Setting "Currency Symbol" in General does not change what POS/Analytics display.
3. Editing your logo in three places (Profile-of-business tab, Business Account tab, Brand tab) stores three different copies in `invoice-assets`.

**Recommendation:** Delete the General tab's business fields (keep theme + PWA install there), migrate `BusinessProfileTab`'s invoice-facing copy to read from `businesses` (or explicitly relabel it "Invoice Header"), and route all currency display through one hook.

---

## 6. Security Finding (Critical)

**Self-service business membership escalation.**
`20260904000100_multi_business_foundation.sql`:

```sql
CREATE POLICY "Users can write own access" ON public.user_business_access
FOR ALL TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
WITH CHECK (user_id = auth.uid() OR has_role(...));
```

`WITH CHECK` only verifies the *row's* `user_id` is the caller — **not the business or the role**. Any authenticated user (e.g., a `viewer` invited to business A) can run:

```js
supabase.from("user_business_access").insert({
  user_id: <self>, business_id: <any business on the platform>, role: "owner"
});
```

…and instantly become an **owner of a business they were never invited to**, gaining write access to its orders, products, connectors, and the ability to edit the `businesses` row itself (the "Members can write businesses" policy admits any `is_business_member`). This breaks multi-tenant isolation completely on a shared Supabase project. (No later migration tightens it — verified through 2026-09-06.)

**Fix:** restrict INSERT to admins or existing *owners of that same business*:

```sql
CREATE POLICY "Owners can add members" ON public.user_business_access
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM user_business_access a
             WHERE a.business_id = business_id  -- same target business
               AND a.user_id = auth.uid()
               AND a.role IN ('owner','admin'))
);
-- UPDATE/DELETE: own row (leave) or admin/target-business owner only
```

Also stop the client-side insert in `CreateBusinessForm` from requiring this hole: create the access row in a SECURITY DEFINER function or the `team-manage` edge function instead.

Secondary findings:
- `app_settings`: any `staff` can INSERT/UPDATE (2026-04-29 policy) — global stock, pre-order categories, and other platform settings bypass `settings.manage` at the DB layer. Medium.
- `/storefronts` route lacks `PermissionGuard`. Low (RLS still blocks writes).
- Historical hygiene is otherwise good: early 2026-04 "anyone can manage stores" policies were progressively dropped and replaced; `pathao_integrations` credentials were locked to admin with a safe view for staff (2026-06-14); `stores` anon access removed. The trajectory is right — the `user_business_access` policy is just the one that slipped through.

---

## 7. Other Settings — Tab-by-Tab

| Tab | Persists to | Works? | UI notes |
|---|---|---|---|
| **Inventory** | `app_settings.global_stock_enabled` (DB + localStorage mirror + change event) | ✅ Cross-device | Toggle + warning banner when disabled ("products will show unlimited availability") — honest about consequences |
| **POS** | `invoice_settings.shipping_presets` | ✅ | Shipping-charge presets (80/150 ৳ defaults = Inside/Outside Dhaka) |
| **Orders** | `invoice_settings.pos_/manual_order_prefix/suffix` | ✅ | Order number format with live preview; simple and clear |
| **Pre-Orders** | `app_settings.preorder_category_ids` | ✅ | Category picker dialog scoped per store; event-driven sync |
| **Measurements** | `invoice_settings.pos_custom_measurements` (JSONB) | ✅ | Group editor: duplicate group, delete group, per-group unit/format/print fields, enable-in-POS toggle. 511 lines — powerful but the heaviest tab; would benefit from collapsible groups |
| **Invoice / Pickup Slip** | `invoice_settings` (single row) | ✅ | **Deepest feature**: business header, footer text, T&C, custom fields, thermal/A4 formats, mm-precision dimensions, margins, element sizes, roll width, slip layout, delivery-charge presets — with **live InvoicePreview + PickupSlipPreview** components. Exceeds Dokan/Woo invoice plugins |
| **Order Sources** | `order_sources` CRUD + default flag | ✅ | Small, does its job |
| **Activity Log** | `audit_log` (admin-only read RLS) | ✅ | Change-summary table with before/after diffs, CSV export. Every settings tab calls `logChange` with diffs — best-in-class for an app this size |
| **Integrations page** | `stores` (Woo), `pathao_integrations` | ✅ | Add WooCommerce store / Pathao integration; credentials admin-only w/ safe view for staff dispatch flows; sync-health cards |
| **Theme** | `localStorage.dokanos-liquid-theme` + documentElement class | ✅ | Light/dark toggle in sidebar and General tab; reasonable for a per-device preference |
| **PWA install** | `InstallAppButton` in General | ✅ | Nice touch for shop-floor tablets |

Cross-cutting quality observations:

- **`SettingsSection` standardizes** every tab: title + description + icon, consistent padding, sticky footer `SaveButton` with saving state, `LabelWithHint` tooltips for jargon fields. This is why the settings feel cohesive despite 15 files.
- **No inline validation**: all validation happens on save with toasts (zod is installed but unused in settings). Slug/currency duplicates are caught only at the DB error code level — functional but not polished.
- **No unsaved-changes guard** when switching tabs mid-edit (draft is discarded silently except in BusinessAccountTab, which re-seeds on id change but still loses edits on tab switch).
- **Optimistic UX absent** — every save round-trips then refetches; fine at this scale.

---

## 8. UI Assessment (against the platform's own bar)

**Strengths**

1. Consistent design system (shadcn + Radix) with real responsive behavior: settings master-detail collapses to stack on mobile; orders table becomes cards; bottom nav for phones.
2. Loading skeletons and empty states everywhere (`loading-states.tsx`), toast feedback on every mutation, confirm dialogs for destructive actions.
3. Audit logging with diffs on nearly all settings saves — Shopify-level discipline.
4. Command palette (⌘K) and deep sidebar sub-navigation (9 order pipeline tabs) make a dense product navigable.

**Weaknesses**

1. The redundant General tab (§5) creates genuine "which screen is real?" confusion.
2. No field-level errors; toast-only validation.
3. `OrderDetailSheet` (2102 lines) / `AddOrderDialog` (1304 lines) hint at component size strain, though that's outside settings scope.
4. English-only, no i18n scaffolding (0 locale files) — for a Bangladesh-first product, Bangla toggle would be a differentiator vs. Shopify.
5. No notification center or email preferences (0 hits) — order-status webhooks exist server-side but users can't configure alerts.

---

## 9. Comparison vs Other E-Commerce Platforms

### 9.1 vs Dokan (WordPress multi-vendor) / WooCommerce

| Dimension | Dokan/Woo | DokanOS |
|---|---|---|
| Settings IA | Scattered WP-admin pages, vendor dashboard separate | **Single searchable settings hub with groups** — clearly better |
| Account model | Many vendors, one store | One operator, **many businesses/orgs** — a different problem, closer to Shopify Plus organizations |
| Vendor/staff permissions | Fixed roles (vendor, staff, admin) | **~40 granular perms + custom roles + per-store scoping + per-user overrides** — far beyond Dokan |
| Invoice/receipt customization | Plugin territory (paid PDF plugins) | **Built-in designer with mm-precision print controls** — best-in-class |
| Tax/VAT | Full tax classes/zones | ❌ None (only 6 incidental "tax" refs, no settings surface) |
| Shipping | Zones, rates, classes | Two presets (Inside/Outside Dhaka) + per-order charge — local reality, minimal config |
| Payment gateways | Dozens | COD + payment *labels* (bKash/Nagad appear as POS payment methods), **no gateway integration settings** |
| Multi-channel sync | — | **Woo bidirectional sync + Pathao native dispatch** — the actual reason to use DokanOS |
| Audit trail | Activity log via plugins | **Built-in with diffs** |

### 9.2 vs Shopify

| Dimension | Shopify | DokanOS |
|---|---|---|
| Org/store switcher | Organizations + locations | ✅ Business switcher + brands + locations — **parity on core model** |
| Staff permissions | Granular + SSO + MFA available | Granular ✅, but ❌ no 2FA, no email change, no SSO |
| Settings depth | Checkout, taxes, domains, billing, shipping, notifications, apps | Subset: no checkout customization (own storefront checkout is fixed), ❌ taxes, ❌ notifications, ❌ billing/plan, ❌ domains UI |
| Onboarding | Setup checklist | Fresh-install create-business fallback only |
| Mobile | Native apps | PWA install button — pragmatic |
| Local market fit | Generic | **Pathao city/zone/area, COD, ৳, measurement slips (tailoring), BDT/Dhaka defaults** — this is where Shopify loses in BD and DokanOS wins |

### 9.3 Feature-gap list (what competitors have that DokanOS lacks)

1. Tax/VAT configuration (BD VAT is 7.5%/15% — currently impossible to add to an invoice)
2. Notification center / email preferences / order-alert routing
3. Two-factor authentication and email-address change
4. Shipping zones & rate tables beyond two presets
5. Payment gateway configuration (bKash/Nagad/SSLCommerz) — labels exist, integrations don't
6. Webhook/API key management UI ( Woo webhook is one-way and hardcoded )
7. Localization/i18n (Bangla)
8. Billing/subscription management (irrelevant while free, relevant if multi-tenant)

### 9.4 What DokanOS does better than all of them

1. Unified Woo sync + Pathao courier + POS + measurement workflows in one app — no competitor has this for BD.
2. Print/document customization depth (invoice + pickup slip, mm-level).
3. Permission granularity + custom roles + per-store scoping at this price point (free).
4. Settings information architecture (grouped, searchable, mobile master-detail).
5. Audit logging with before/after diffs on settings changes.

---

## 10. Prioritized Recommendations

**P0 — Security**
1. Fix `user_business_access` write policy (§6) — self-grant of `owner` on any business. Move the create-business access insert server-side.

**P1 — Structure/trust**
2. Retire the General tab's business fields (localStorage) or make it write to `businesses`; keep theme + install there. Stop toasting "Settings saved" for a localStorage write that affects nothing.
3. Collapse identity to two concepts: `businesses` (account) + `invoice_settings` (print header, explicitly labeled). Delete dead `pages/Stores.tsx`.
4. Single currency source: `businesses.currency` → one `useCurrency` hook; de-hardcode the 50 files.

**P2 — UX parity**
5. Inline field validation (react-hook-form + zod are already dependencies); dirty-state guard on tab switch.
6. Add `PermissionGuard` to `/storefronts`; scope the User Access Dialog per active business using `user_business_access.role`.
7. Email change flow + optional TOTP 2FA (Supabase supports both).

**P3 — Competitive gaps**
8. VAT settings on the invoice template + order-level tax.
9. Notification settings (order events → email/SMS/Telegram is the BD norm).
10. bKash/Nagad/SSLCommerz gateway config surface before chasing anything Shopify has.

---

*Report generated from static code analysis; runtime behavior inferred from wiring (Supabase calls, RLS policies, edge functions). No live credentials or databases were accessed.*
