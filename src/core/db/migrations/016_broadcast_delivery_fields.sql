-- 016_broadcast_delivery_fields.sql
-- Add telegram_chat_id and pin_error columns to broadcast_deliveries
-- Expand check constraints for broadcast and delivery statuses

BEGIN;

ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(64);
ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS pin_error TEXT;

-- Delivery per group: PENDING, QUEUED, SENT, FAILED
ALTER TABLE broadcast_deliveries DROP CONSTRAINT IF EXISTS broadcast_deliveries_send_status_check;
ALTER TABLE broadcast_deliveries ADD CONSTRAINT broadcast_deliveries_send_status_check 
  CHECK (send_status IN ('PENDING', 'QUEUED', 'SENT', 'FAILED', 'SEND_FAILED'));

-- Pin per group: PINNED, PIN_FAILED, PIN_SKIPPED, PENDING
ALTER TABLE broadcast_deliveries DROP CONSTRAINT IF EXISTS broadcast_deliveries_pin_status_check;
ALTER TABLE broadcast_deliveries ADD CONSTRAINT broadcast_deliveries_pin_status_check 
  CHECK (pin_status IN ('PENDING', 'PINNED', 'PIN_FAILED', 'PIN_SKIPPED', 'NOT_PINNED', 'UNPINNED', 'NOT_APPLICABLE'));

-- Broadcast main status: DRAFT, QUEUED, SENDING, SENT, PARTIAL_FAILED, FAILED
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_status_check 
  CHECK (status IN ('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'PARTIAL_FAILED', 'FAILED'));

COMMIT;
