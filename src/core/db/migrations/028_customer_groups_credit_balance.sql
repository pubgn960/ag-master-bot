-- Migration 028: Add credit_balance to telegram_groups, image_hash to payment_records, and customer_groups view
ALTER TABLE telegram_groups ADD COLUMN IF NOT EXISTS credit_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00;

ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS image_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_payment_records_image_hash ON payment_records(image_hash);

CREATE OR REPLACE VIEW customer_groups AS 
SELECT 
    id,
    title,
    username,
    telegram_chat_id,
    is_supergroup,
    is_active,
    is_broadcast_enabled,
    credit_balance,
    migrated_to_group_id,
    created_at,
    updated_at
FROM telegram_groups;
