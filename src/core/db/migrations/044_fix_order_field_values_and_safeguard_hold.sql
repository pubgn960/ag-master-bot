-- Migration 044: Add updated_at to order_field_values and drop NOT NULL from orders.safeguard_hold
ALTER TABLE order_field_values ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE orders ALTER COLUMN safeguard_hold DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN safeguard_hold SET DEFAULT 'NONE';
