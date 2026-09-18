-- Migration 030: Add bundle_overrides JSONB column to price_profiles
-- Allows explicit bundle price overrides per CP quantity
ALTER TABLE price_profiles 
ADD COLUMN IF NOT EXISTS bundle_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;
