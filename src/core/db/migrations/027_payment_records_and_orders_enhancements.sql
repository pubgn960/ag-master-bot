-- Migration 027: Payment records enhancements and ROUTED_TO_LOADER status
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS txid VARCHAR(100);
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS raw_evidence JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_payment_records_txid ON payment_records(txid);
CREATE INDEX IF NOT EXISTS idx_payment_records_file_id ON payment_records(file_id);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('INCOMPLETE', 'PENDING', 'SENT_TO_LOADER', 'ROUTED_TO_LOADER', 'PROCESSING', 'DONE', 'CANCELLED', 'REVERSED'));
