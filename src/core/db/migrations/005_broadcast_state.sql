BEGIN;

ALTER TABLE broadcasts ADD COLUMN status VARCHAR(32) DEFAULT 'DRAFT' NOT NULL;
ALTER TABLE broadcasts ADD COLUMN idempotency_key VARCHAR(128) UNIQUE;

-- We don't drop existing ones, but new ones use this status
COMMIT;
