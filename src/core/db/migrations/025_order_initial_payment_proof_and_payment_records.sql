-- Migration 025: Order initial payment proof and payment records
ALTER TABLE orders ADD COLUMN IF NOT EXISTS initial_payment_proof VARCHAR(255);

CREATE TABLE IF NOT EXISTS payment_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    file_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'REVIEW_REQUIRED',
    group_id UUID REFERENCES telegram_groups(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_records_order_id ON payment_records(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_status ON payment_records(status);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_verification_state_check;
ALTER TABLE payments ADD CONSTRAINT payments_verification_state_check CHECK (verification_state IN ('PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_REVIEW', 'ALREADY_USED', 'REVIEW_REQUIRED'));
