
UPDATE order_payments op
SET created_at = d.delivered_at
FROM (
  SELECT op2.id,
    (SELECT MIN(ot.created_at) FROM order_timeline ot
       WHERE ot.order_id = op2.order_id
         AND ot.event = 'tracking_update'
         AND (ot.metadata->>'mapped_status' = 'delivered' OR ot.description ILIKE '%Delivered%')
    ) AS delivered_at
  FROM order_payments op2
  WHERE op2.notes ILIKE 'Auto-collected on Pathao delivery%backfill%'
) d
WHERE op.id = d.id AND d.delivered_at IS NOT NULL;

UPDATE order_timeline ot
SET created_at = d.delivered_at
FROM (
  SELECT ot2.id,
    (SELECT MIN(ot3.created_at) FROM order_timeline ot3
       WHERE ot3.order_id = ot2.order_id
         AND ot3.event = 'tracking_update'
         AND (ot3.metadata->>'mapped_status' = 'delivered' OR ot3.description ILIKE '%Delivered%')
    ) AS delivered_at
  FROM order_timeline ot2
  WHERE ot2.event = 'payment_logged'
    AND ot2.description ILIKE '%auto-cleared via Pathao COD delivery (backfill)%'
) d
WHERE ot.id = d.id AND d.delivered_at IS NOT NULL;
