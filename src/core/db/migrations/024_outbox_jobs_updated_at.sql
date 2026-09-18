-- 024_outbox_jobs_updated_at.sql
-- Adds updated_at column to outbox_jobs for tracking status updates and worker claiming

ALTER TABLE outbox_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
