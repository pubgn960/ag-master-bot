-- Migration 042: Allow promotions to be created without requiring product_id (e.g. custom bundles or standalone promos)
ALTER TABLE promotions ALTER COLUMN product_id DROP NOT NULL;
