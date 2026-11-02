-- Spec §3: stock lives at warehouses and at PHYSICAL order sources only
-- (showroom, physical_store). Digital sources (woocommerce, storefront,
-- facebook, instagram, whatsapp) and manual channels never hold stock.
--
-- The INSERT trigger (20261031090000) already defaults is_stock_holding by
-- type and the UI only exposes the toggle for physical types, but nothing at
-- the database blocked UPDATE ... SET is_stock_holding = true on a digital
-- source. This CHECK closes that gap at the contract level.

ALTER TABLE public.order_sources
  ADD CONSTRAINT order_sources_stock_holding_physical_only
  CHECK (is_stock_holding IS DISTINCT FROM TRUE OR type IN ('showroom', 'physical_store'));
