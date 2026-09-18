-- Migration 021: Backfill linked_order_id on existing payments to oldest open order
UPDATE payments p
SET linked_order_id = (
  SELECT o.id FROM orders o
  WHERE o.group_id = p.group_id
    AND o.status NOT IN ('CANCELLED', 'REVERSED')
    AND (o.amount_remaining > 0 OR o.payment_amount_state IN ('UNPAID', 'PARTIAL') OR o.status IN ('PENDING', 'SENT_TO_LOADER', 'CREATED'))
  ORDER BY o.created_at ASC
  LIMIT 1
)
WHERE p.linked_order_id IS NULL AND p.group_id IS NOT NULL;
