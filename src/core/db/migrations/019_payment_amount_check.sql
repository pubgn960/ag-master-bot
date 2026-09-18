-- Allow payment amount to be 0 for screenshot payment proofs pending verification / manual entry
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_check;
ALTER TABLE payments ADD CONSTRAINT payments_amount_check CHECK (amount >= 0);
