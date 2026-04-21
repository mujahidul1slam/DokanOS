-- Backfill: orders whose Pathao tracking_status indicates a return should have status='returned'
UPDATE public.orders
SET status = 'returned'
WHERE tracking_status IN (
  'Paid Return','Return Requested','Return In Transit',
  'Returned to Merchant','Merchant Return','Return Delivered',
  'Delivery Failed','Customer Refused','Return','Returned'
)
AND status NOT IN ('returned','cancelled');