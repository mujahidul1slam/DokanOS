-- Allow multiple customer records with the same phone across different stores.
-- Each store keeps its own customer rows; the per-order snapshot columns on `orders`
-- remain the authoritative checkout history.
DROP INDEX IF EXISTS public.idx_customers_phone_unique;

-- Within a single store, prevent duplicate phone entries so we still dedupe within store.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_phone_per_store
  ON public.customers (phone, store_id)
  WHERE phone IS NOT NULL AND phone <> '';