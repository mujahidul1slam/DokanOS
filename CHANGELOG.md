# Changelog

All notable changes to DokanOS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2026-10-01]

### Added

- **Self-Serve Business Owner Sign-Up & Atomic Provisioning** (migrations `20260925120000_signup_support_tables.sql`, `20260925120100_signup_provision_fns.sql`, `20260925140000_signup_publish_and_delete_rpcs.sql`):
  - **Full Frontend Flow**: Self-serve registration (`/signup`), verification screen (`/check-email`), email link verification (`/auth/confirm`), welcome onboarding (`/welcome`), and error recovery (`/welcome/setup-failed`).
  - **Single Atomic Transaction (`signup_create_business_core`)**: Provisions the root business, brand, default location ('Main', showroom), disconnected store, inactive storefront, 4 parity rows (`connectors`, `selling_points`, `product_sources`, `customer_sources`), `user_business_access` with role `owner`, 1 store access row, and the 32-key tenant permission bundle.
  - **Strict Zero Global Roles**: Self-serve business owners receive strictly 0 rows in global `user_roles`. Multi-tenant access is scoped exclusively via Row-Level Security.
  - **Server-Side Audit & Consent Anchor**: Client generates a cryptographic `signup_nonce` paired with a server-written `signup_started` row in `signup_events` tracking IP, user-agent, and server-authoritative versions in `consent_records`.
  - **Disposable Email Protection**: Real-time screening against a client snapshot (`src/lib/disposableDomains.ts`) and authoritative PostgreSQL table `disposable_email_domains`.
  - **Password Hygiene**: Password strength meter via `zxcvbn` (minimum 10 characters, checks against breached top-10k passwords).
  - **Edge Functions**:
    - `signup-event`: Records server-side audit events with Cloudflare Turnstile verification.
    - `signup-provision`: Verifies caller JWT, enforces 24-hour setup window, validates nonce against server anchor, and calls `provision_owner_business`.
    - `auth-resend`: Canonical email lookup via `get_auth_signup_state`, unconfirmed check, rate limiting (3/h/email, 20/h/IP), and token forwarding.
    - `purge-unconfirmed`: Automated 26-hour purge for abandoned self-signups and 30-day sweep for unaccepted staff invitations.
    - `create-business`: Authenticated edge function allowing provisioned users and platform admins to create additional businesses (rate-limited to 3/day/user).
- **Member-Scoped Row Level Security (RLS)** (migration `20260929120000_member_scoped_rls.sql`):
  - New `public.user_can_access_store(p_store_id)` helper function (`STABLE SECURITY DEFINER SET search_path = ''`).
  - Multi-tenant isolation on operational tables: `stores`, `storefronts`, `products`, `orders`, `order_items`, and `customers`.
  - Grants access to platform `admin`/`staff`, direct `user_store_access` holders, and business owners/members through `brands` $\rightarrow$ `user_business_access`.
  - Shielding legacy orders (with `store_id IS NULL`) from tenant members while preserving platform staff visibility.
  - Integration test suite (`scripts/test_tenant_rls_isolation.sql`) verifying cross-tenant read/write isolation between distinct business owners.
- **Multi-Business Management & "Create New Business" Entry Points**:
  - **AppSidebar Business Switcher**: Top-left header dropdown is always interactive, showing all member businesses with role badges (`owner`, `admin`, `member`, `viewer`), active checkmark, brand counts, and a persistent `+ Create new business` action.
  - **Settings Business Account Tab**: New header card in **Settings $\rightarrow$ Business Account** displaying the active business with role badge and a prominent `+ Create new business` button, with full empty-state support for fresh accounts.
  - **`CreateBusinessDialog` component**: Modal prompting for business name, live slug generation, Cloudflare Turnstile token validation, and instant context refresh via `useBusinessContext`.
  - **Consumer Query Guards**: Scoped `useStoresList.ts` and `StorefrontsPage.tsx` to active business brands, preventing cross-tenant placeholder store leakage.
- **Operations & Runbook**:
  - Complete operations guide (`SIGNUP-OPERATIONS-AND-RUNBOOK.md`) covering conversion funnels, alert queries, retention sweeps, and Supabase dashboard checklists.
  - Policy documentation (`MEMBER-SCOPED-RLS-MATRIX.md`) detailing per-table scope paths and index plans.
- **Automated Tests**:
  - 19 new signup unit/flow tests in `src/test/signup.test.ts`. Full test suite passing (94/94 across 11 test suites).

### Changed

- **Login & Reset Password Security**:
  - Integrated invisible Cloudflare Turnstile tokens into `/login` and `/reset-password`.
  - Universal account enumeration defense via `src/lib/authErrors.ts`: merged `invalid_credentials` and `email_not_confirmed` into identical generic error messages.
  - Added universal "Didn't receive a confirmation email?" resend link to the login screen.
- **Team Management Edge Function**:
  - Replaced 4,000-user paginated `listUsers` scan with unpaginated, canonical SQL lookup `get_auth_signup_state`.
  - Implemented 5-route target resolution handling existing members, unconsumed anchors, and pending invitees safely without deleting in-flight self-signups.

## [2026-08-31]

### Added

- **Attach / Replace Pathao parcel** — link any order to a Pathao consignment that was created outside DokanOS, or swap a wrong consignment for the right one.
  - New `AttachParcelDialog` component (`src/components/orders/AttachParcelDialog.tsx`): pick the Pathao account, enter the consignment ID, and the order is linked with its current tracking status fetched immediately; auto-tracking continues every 15 minutes.
  - New `attach_parcel` action in the `pathao-courier` edge function with input validation, replace-mode handling (detaches the old consignment), and an immediate tracking-status fetch.
  - Wired into the Orders page row actions ("Attach Pathao Parcel" / "Replace Pathao Parcel") and the order detail sheet header.
  - New `orders.attach_courier` app permission gating both entry points.
  - New unique index on `orders.consignment_id` to prevent two orders from ever linking to the same parcel.
- **Full-fidelity WooCommerce order push** (migration `20260831000200_order_push_full_sync.sql`):
  - The order push trigger now enqueues a push whenever **any** Woo-mirrored field changes — customer name / phone / address / city / email, discount, shipping cost, subtotal, total, notes, payment status — not just status. Customer-info and pricing edits in DokanOS now reach WooCommerce.
  - New `enqueue_order_push(order_id, reason)` SQL function for callers that edit related rows (order items); v2 (migration `20260831000400`) carries `include_items` so item edits rebuild Woo line items while routine status pushes never mass-rewrite them.
  - **Echo guard**: Woo-originated writes (webhook / sync) stamp `woo_updated_at`; the trigger skips those rows, ending the push → import → push echo loop on every 15-minute sync.
- **WooCommerce receipt confirmation notes** — newly synced orders get a `[DokanOS] ✅ Order synced to DokanOS — #N, X item(s), total ৳Y. Managed in DokanOS.` note in the Woo admin (posted by `woo-sync` and `woo-webhook`, best-effort, bounded-parallel).
- **Enriched Woo order notes** — DokanOS timeline events mirrored to Woo order notes now include the event's key facts (change lists, new totals, consignment IDs, courier statuses, item lists, amounts) instead of a bare description (`src/lib/orderTimeline.ts`).
- **Richer product sync** (migration `20260831000300_product_pricing_attributes.sql`):
  - New `products` columns: `regular_price`, `sale_price`, `sale_price_from`, `sale_price_to`, `short_description`, `attributes`, `tags`, `weight`, `dimensions`; new `product_variations` columns: `regular_price`, `sale_price`, `woo_updated_at`.
  - `woo-sync` and `woo-webhook` now import regular/sale prices, short description, parent attributes, tags, weight and dimensions, so pushes are lossless.
- **Durable product stock pushes** (migration `20260831000500_product_stock_triggers.sql`):
  - New `auto_push_product_stock` / `auto_push_variation_stock` triggers enqueue `push_stock` jobs into `sync_queue` whenever local stock changes (quantity / status / manage_stock). Every stock change now gets retry, backoff, dead-letter and circuit-breaker isolation — previously stock pushes were fire-and-forget UI invokes where one failure permanently drifted the store, and POS returns did not push at all.
  - `sync-worker` now drains `push_stock` rows alongside `push_order`.
  - Variation stock writes enqueue the parent product's push (keyed on the parent so concurrent variation edits coalesce).
- **Queue maintenance**:
  - Retention sweep in `sync-worker`: completed rows purged after 7 days, `dead_letter` after 30 days, with a supporting `(status, updated_at)` index.
  - New `recover_orphaned_sync_rows(stale_before)` RPC: atomic single-statement recovery of rows stranded in `processing`, with per-row attempt counting.
- **Unit tests** — new `src/test/tabFilters.test.ts` covering order tab matching (delivered / ready / new / pre-order / courier-tracking-delivered) and the Woo status + payment-status mapping.
- **Trigger verification harnesses** — temporary verify functions were created and exercised against live data during rollout, then dropped (migrations `20260831000380`–`00392` and `20260831000590`–`00596`).
- **Invoice live preview & full print customization** — the invoice now gets the same treatment as the pickup slip:
  - New shared builder `src/lib/invoiceHtml.ts` (`buildInvoiceInnerHtml` / `buildInvoiceCss` / `buildInvoicePrintDocument`) — the single source of truth the print popup and the preview both render through, so settings preview and printer output can never drift apart. `printInvoice` now renders through it (signature unchanged).
  - New `src/components/settings/InvoicePreview.tsx` iframe preview with sample cart data (multi-item table, variation labels, custom-tailoring tag, delivery shipping + discount, split payments with due, notes) — scaled A4 portrait page or thermal receipt strip, following the pickup slip preview.
  - New `InvoiceSizing` config inside `invoice_template` (deep-merged for existing rows — no migration needed): thermal roll width/height/padding, A4 page margin + content padding, per-element font sizes (business name, invoice number, customer, items, totals, payments, due, notes, terms, footer, custom fields), and barcode geometry.
  - Settings → Invoice now exposes "Invoice Dimensions (mm)", an 18-slider "Element Sizes (px)" grid with reset, an "Order Number Barcode" visibility toggle, and a live preview that follows the chosen default print format.
  - Barcode SVG generation extracted to shared `src/lib/barcodeSvg.ts` (viewBox-normalized, print-vector-safe) — used by both the pickup slip and invoice builders.
  - Unit tests `src/test/invoiceHtml.test.ts` covering visibility toggles, due-amount math, custom-field filtering, thermal/A4 geometry, and the print document skeleton.

### Changed

- **Unified terminal status: "completed" is gone — "delivered" is the single fulfilled/terminal status.**
  - Backfill migration `20260831000100_backfill_completed_orders_to_delivered.sql` converts every existing `completed` order to `delivered`.
  - Woo mapping (`_shared/woo-mapping.ts`): Woo `completed` imports as `delivered`; `delivered` derives payment status `paid`.
  - POS walk-in orders are created directly as `delivered` instead of `completed`.
  - Status selectors, bulk actions, tab filters, fulfillment badges, exchange/return eligibility, POS reports, store backfill, and the Dispatch page all treat `delivered` as the only terminal-fulfilled status; `completed` removed everywhere.
  - `woo-sync` / `woo-webhook`: `delivered` is now treated as a terminal incoming status and local `delivered` orders are protected from Woo overwrites.
- **Faster Pathao tracking** — `track_orders` now runs a concurrency-8 worker pool instead of a serial loop (~15–20× throughput; per-request retry/backoff retained), so at high order volume each parcel's status is minutes stale instead of a day.
- **Deterministic Pathao credential selection** — default integration lookup is now ordered by `created_at` (oldest active = stable default) instead of an arbitrary `limit 1`; multi-merchant setups no longer get random credentials for default-token calls (location lists, price checks, token bootstrap).

### Fixed

- **Double parcel / double COD on dispatch retry** — Pathao `create_order` and bulk `create_orders` now skip any order that already has a `consignment_id`. Previously a Pathao timeout plus a user retry (or a double-invoke) created **two** physical parcels and **two** COD collections for one order.
- **Silently dropped re-pushes** — the push idempotency key was `order_id:status` with `ON CONFLICT DO NOTHING` against rows that are never deleted, so once a key existed, any future transition to the same status was dropped forever (e.g. delivered → processing → delivered never re-pushed). Keys now carry a minute-resolution timestamp: rapid bursts coalesce, deliberate re-edits always re-push.
- **Echo loops between DokanOS and WooCommerce** — Woo-originated writes now stamp `woo_updated_at`; both order and stock push triggers skip those rows, so the 15-minute product/order sync no longer pushes its own imports back.
- **Woo sale structures destroyed by mid-sale edits** — the importer stored Woo's *effective* price (the sale price while on sale) into `price`, and pushes wrote it back as `regular_price`. Regular and sale prices are now stored separately; `price` remains the effective price POS depends on.
- **Short/long description mix-up** — Woo's short description was being pushed into the long-description field; both are now stored and pushed to the correct fields.
- **Stranded sync-queue rows** — rows flipped to `processing` by a worker that died mid-batch were recovered by a slow client-side loop that could mis-count attempts; recovery is now one atomic SQL statement with correct per-row attempts (a row that reliably kills the worker still dead-letters).
- **Queue bloat** — completed and dead-letter queue rows accumulated forever, slowing the claim query and bloating the idempotency index (also what made old per-status keys block re-pushes); the retention sweep now purges them.

### Removed

- **`pathao-track` edge function** — tracking is consolidated into `pathao-courier` (`track_orders` action); one function to deploy and auth instead of two.
- **"Completed" status** — removed from every selector, filter, bulk action, badge, and report.

### Database migrations

| Migration | Purpose |
| --- | --- |
| `20260831000000_attach_pathao_parcel.sql` | `orders.attach_courier` permission; unique index on `consignment_id` |
| `20260831000100_backfill_completed_orders_to_delivered.sql` | Legacy `completed` → `delivered` backfill |
| `20260831000200_order_push_full_sync.sql` | Full-fidelity order push trigger, echo guard, `enqueue_order_push` |
| `20260831000300_product_pricing_attributes.sql` | Product pricing / attribute / variation columns |
| `20260831000380`–`20260831000392` | Temporary push-trigger verification harness (created + dropped) |
| `20260831000400_enqueue_push_include_items.sql` | `enqueue_order_push` v2 with `include_items` |
| `20260831000500_product_stock_triggers.sql` | Stock push triggers, retention index, `recover_orphaned_sync_rows` |
| `20260831000590`–`20260831000596` | Temporary stock-trigger verification harness (created + dropped) |

> **Upgrade note:** apply the migrations above (`supabase db push`) before deploying this build — the new triggers and the `delivered` backfill must exist before the app and edge functions rely on them.
