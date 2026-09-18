-- 018_price_broadcast_support.sql
-- Adds profile support and audit tracking for multi-profile Price Broadcasts

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS broadcast_type VARCHAR(50) DEFAULT 'GENERAL';
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(50) DEFAULT 'DASHBOARD';
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS message_text TEXT;
ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS price_profile_id UUID;
ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS price_profile_name VARCHAR(100);
