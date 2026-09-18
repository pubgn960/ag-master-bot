-- Migration 038: Add credit_limit to telegram_groups
ALTER TABLE telegram_groups ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) DEFAULT 0.00;
