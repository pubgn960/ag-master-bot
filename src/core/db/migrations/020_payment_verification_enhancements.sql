-- Migration 020: Payment verification enhancements
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_verification_state_check;
ALTER TABLE payments ADD CONSTRAINT payments_verification_state_check CHECK (verification_state IN ('PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_REVIEW', 'ALREADY_USED'));

ALTER TABLE payments ADD COLUMN IF NOT EXISTS linked_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS verification_reason VARCHAR(100);
