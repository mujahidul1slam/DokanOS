
-- Clear stuck sync locks
UPDATE stores SET status = 'connected' WHERE status = 'syncing';

-- Fix Mujahidul Islam (Enveil orders 8234, 8235 — phone 01776712495)
UPDATE customers SET
  name = 'Mujahidul Islam',
  email = 'mujahidulislam.gg@gmail.com',
  address = 'Cha-33/34 Rayhan Lakeview, Besides Badda Girls High School. Uttar Badda, Dhaka',
  woo_customer_id = 2
WHERE id = 'fc6b80c4-6508-4a7f-8358-a15166fc313a';

-- Fix Vincent order 9643 — should also point to Mujahidul Islam (same phone 01776712495), not "SM rohom"
-- First, find or create the right customer for Vincent store
DO $$
DECLARE
  target_id uuid;
BEGIN
  -- Reuse the existing customer with phone 01776712495 (now correctly named)
  SELECT id INTO target_id FROM customers WHERE phone = '01776712495' LIMIT 1;
  
  -- Re-link order 9643 to the correct customer
  UPDATE orders SET customer_id = target_id
  WHERE order_number = '9643' AND store_id = '1e69bece-51f8-414c-ab8b-341702e008f5';
END $$;
