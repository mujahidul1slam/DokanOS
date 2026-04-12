
-- Function to merge duplicate customers by phone
CREATE OR REPLACE FUNCTION public.merge_duplicate_customers()
RETURNS TABLE(merged_phone text, kept_id uuid, deleted_count int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  dup RECORD;
  del_count int;
BEGIN
  FOR rec IN
    SELECT phone, MIN(created_at) AS earliest
    FROM customers
    WHERE phone IS NOT NULL AND phone != ''
    GROUP BY phone
    HAVING COUNT(*) > 1
  LOOP
    -- Get the keeper (oldest)
    SELECT id INTO dup FROM customers
      WHERE phone = rec.phone
      ORDER BY created_at ASC
      LIMIT 1;

    -- Move orders to the keeper
    UPDATE orders SET customer_id = dup.id
      WHERE customer_id IN (
        SELECT id FROM customers WHERE phone = rec.phone AND id != dup.id
      );

    -- Delete duplicates
    DELETE FROM customers WHERE phone = rec.phone AND id != dup.id;
    GET DIAGNOSTICS del_count = ROW_COUNT;

    merged_phone := rec.phone;
    kept_id := dup.id;
    deleted_count := del_count;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Run the merge now
SELECT * FROM merge_duplicate_customers();

-- Add unique index on phone (ignoring nulls and empty strings)
CREATE UNIQUE INDEX idx_customers_phone_unique ON customers (phone) WHERE phone IS NOT NULL AND phone != '';
