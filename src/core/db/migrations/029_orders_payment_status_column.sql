-- Migration 029: Add payment_status column to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'UNPAID';
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
