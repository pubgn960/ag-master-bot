-- Migration 039: Relax payment_profiles constraints to make all fields except name optional
-- 1. Remove NOT NULL constraint from code so it is optional, and assign a unique default generator
ALTER TABLE payment_profiles ALTER COLUMN code DROP NOT NULL;
ALTER TABLE payment_profiles ALTER COLUMN code SET DEFAULT ('PAY_' || substr(md5(random()::text), 1, 10));

-- 2. Add is_active column if not exists (referenced by group assignment checks)
ALTER TABLE payment_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
