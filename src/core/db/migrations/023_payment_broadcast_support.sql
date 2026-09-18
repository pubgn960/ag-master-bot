-- 023_payment_broadcast_support.sql
-- Adds payment profile tracking support for Payment Details broadcasts

ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS payment_profile_id UUID;
ALTER TABLE broadcast_deliveries ADD COLUMN IF NOT EXISTS payment_profile_name VARCHAR(100);
