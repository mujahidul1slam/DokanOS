
ALTER TABLE public.invoice_settings
ADD COLUMN IF NOT EXISTS default_print_format text NOT NULL DEFAULT 'thermal',
ADD COLUMN IF NOT EXISTS invoice_template jsonb NOT NULL DEFAULT '{
  "show_logo": true,
  "show_tagline": true,
  "show_address": true,
  "show_contact": true,
  "show_customer": true,
  "show_customer_phone": true,
  "show_customer_address": true,
  "show_item_price": true,
  "show_item_qty": true,
  "show_item_total": true,
  "show_subtotal": true,
  "show_discount": true,
  "show_shipping": true,
  "show_tax": true,
  "show_total": true,
  "show_payments": true,
  "show_notes": true,
  "show_terms": true,
  "show_footer": true,
  "show_order_date": true,
  "show_fulfillment": true,
  "custom_fields": []
}'::jsonb,
ADD COLUMN IF NOT EXISTS pickup_slip_template jsonb NOT NULL DEFAULT '{
  "show_order_number": true,
  "show_customer_name": true,
  "show_customer_phone": true,
  "show_customer_address": true,
  "show_items": true,
  "show_item_qty": true,
  "show_total": true,
  "show_notes": false,
  "title": "PICKUP SLIP",
  "custom_fields": []
}'::jsonb;
