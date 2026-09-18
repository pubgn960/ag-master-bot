-- 017_broadcasts_updated_at.sql
-- Add updated_at column to broadcasts table

BEGIN;

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

COMMIT;
