-- 002_fix_schema_drift.sql
-- Fix outbox_jobs column drift (staging has queue_name, but we canonicalized on job_type)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'outbox_jobs' AND column_name = 'queue_name'
    ) THEN
        ALTER TABLE outbox_jobs RENAME COLUMN queue_name TO job_type;
    END IF;
END $$;
