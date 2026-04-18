-- Backfill orders that have Pathao tracking statuses incorrectly mapped to main status
UPDATE public.orders
SET status = CASE
  WHEN tracking_status IN ('Pending','Pickup Requested','Assigned for Pickup','Picked','Picked Up','Pickup Cancel','Pickup Cancelled','Pickup Pending') THEN 'shipped'
  WHEN tracking_status IN ('At Sorting Hub','In Transit','On the Way To Delivery Hub','At Delivery Hub','Out for Delivery','On the Way To Delivery hub','On the way to Delivery Hub') THEN 'shipped'
  WHEN tracking_status IN ('Delivered','Partial Delivered','Payment Invoice') THEN 'delivered'
  WHEN tracking_status IN ('On Hold','Hold','Exchange') THEN 'processing'
  WHEN tracking_status IN ('Return','Returned','Delivery Failed','Customer Refused') THEN 'returned'
  WHEN tracking_status IN ('Cancelled','Canceled') THEN 'cancelled'
  ELSE status
END
WHERE tracking_status IS NOT NULL
  AND deleted_at IS NULL;