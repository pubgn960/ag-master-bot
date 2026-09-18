-- Migration 037: Ensure promotions table supports plain text bundle descriptions, loader costs, loss-guard, and image url
ALTER TABLE promotions
ADD COLUMN IF NOT EXISTS bundle_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS loader_cost NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS loss_guard_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS image_url VARCHAR(255),
ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_promotions_bundle_name ON promotions(bundle_name);
