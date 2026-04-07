

# WooCommerce Multi-Store Sync

## Overview

Build an edge function that connects to WooCommerce stores via their REST API, fetches products/orders/customers, and syncs them into the database. Add a "Sync Now" button on the Stores page and a webhook endpoint for live order capture.

## What You Need

Each WooCommerce store requires a **Consumer Key** and **Consumer Secret** (generated in WooCommerce > Settings > REST API). These are already columns on the `stores` table (`consumer_key`, `consumer_secret`).

## Plan

### 1. Add Store Management UI
- Add an "Add Store" dialog on the Stores page with fields: Name, URL, Consumer Key, Consumer Secret
- Add a "Sync Now" button on each store card
- Add a "Delete Store" option
- Show sync status and last synced timestamp

### 2. Create `woo-sync` Edge Function
- Accepts a `store_id` parameter
- Reads the store's URL, consumer key, and consumer secret from the `stores` table
- Calls WooCommerce REST API v3 endpoints:
  - `GET /wp-json/wc/v3/products` — upserts into `products` table (matched by `woo_product_id`)
  - `GET /wp-json/wc/v3/orders` — upserts into `orders` + `order_items` tables (matched by `woo_order_id`)
  - `GET /wp-json/wc/v3/customers` — upserts into `customers` table (matched by `woo_customer_id`)
- Handles pagination (WooCommerce returns 10 per page by default, we request 100)
- Updates `stores.last_synced_at` and sets `status = 'connected'` on success
- Returns sync summary (counts of created/updated records)

### 3. Create `woo-webhook` Edge Function
- Endpoint for WooCommerce webhook (Topic: "Order created")
- Receives order payload, maps it to our schema, inserts into `orders` + `order_items` + `customers`
- Validates the webhook signature using the store's consumer secret
- No JWT verification needed (external webhook)

### 4. Wire Up Frontend
- Stores page: "Sync Now" button calls `supabase.functions.invoke('woo-sync', { body: { store_id } })`
- Show loading spinner during sync, toast on success/failure
- After sync completes, refresh store data

### Technical Details

- Edge functions use `Deno.serve` with CORS headers
- WooCommerce API auth: Basic Auth with consumer key/secret
- Pagination: loop with `?page=N&per_page=100` until response has fewer than 100 items
- Upsert strategy: use Supabase's `.upsert()` with `onConflict` on the woo ID columns (requires unique constraints on `woo_product_id`, `woo_order_id`, `woo_customer_id`)

### 5. Database Migration
- Add unique indexes on `products.woo_product_id`, `orders.woo_order_id`, `customers.woo_customer_id` (filtered where not null) to support upserts

### Files Changed/Created
- `supabase/functions/woo-sync/index.ts` — new
- `supabase/functions/woo-webhook/index.ts` — new
- `src/pages/Stores.tsx` — add Store dialog, Sync button
- Migration for unique indexes

