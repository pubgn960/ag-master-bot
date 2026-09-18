-- 015_broadcast_deliveries_pin_status.sql
-- Relax check constraints on broadcast_deliveries to support complete broadcast lifecycle (QUEUED, SENT, SEND_FAILED, PENDING, PINNED, PIN_FAILED, NOT_PINNED)

ALTER TABLE broadcast_deliveries DROP CONSTRAINT IF EXISTS broadcast_deliveries_send_status_check;
ALTER TABLE broadcast_deliveries ADD CONSTRAINT broadcast_deliveries_send_status_check 
  CHECK (send_status IN ('QUEUED', 'SENT', 'SEND_FAILED', 'FAILED'));

ALTER TABLE broadcast_deliveries DROP CONSTRAINT IF EXISTS broadcast_deliveries_pin_status_check;
ALTER TABLE broadcast_deliveries ADD CONSTRAINT broadcast_deliveries_pin_status_check 
  CHECK (pin_status IN ('PENDING', 'PINNED', 'PIN_FAILED', 'NOT_PINNED', 'UNPINNED', 'NOT_APPLICABLE'));
