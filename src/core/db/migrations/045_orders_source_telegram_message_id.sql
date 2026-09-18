-- Migration 045: Add source_telegram_message_id to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_telegram_message_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_orders_source_telegram_message_id ON orders(source_telegram_message_id);

-- Backfill from order_messages if present
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'order_messages') THEN
        UPDATE orders o
        SET source_telegram_message_id = m.telegram_message_id
        FROM (
            SELECT order_id, telegram_message_id,
                   ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at ASC) as rn
            FROM order_messages
        ) m
        WHERE o.id = m.order_id AND m.rn = 1 AND o.source_telegram_message_id IS NULL;
    END IF;
END $$;
