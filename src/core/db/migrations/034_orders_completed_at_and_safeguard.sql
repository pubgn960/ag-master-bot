-- 034_orders_completed_at_and_safeguard.sql
-- Add completed_at and safeguard_hold columns to orders table

ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS safeguard_hold VARCHAR(50) NOT NULL DEFAULT 'NONE';

-- Backfill completed_at from loader_deliveries where order is DONE
UPDATE orders o
SET completed_at = ld.completed_at
FROM loader_deliveries ld
WHERE ld.order_id = o.id
  AND ld.delivery_status = 'COMPLETED'
  AND o.status = 'DONE'
  AND o.completed_at IS NULL;

-- Backfill remaining completed orders from updated_at where status is DONE
UPDATE orders
SET completed_at = updated_at
WHERE status = 'DONE' AND completed_at IS NULL;

-- Index for fast 24-hour completed order lookup
CREATE INDEX IF NOT EXISTS idx_orders_completed_at_status ON orders(status, completed_at);
