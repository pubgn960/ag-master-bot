-- 035_promotions_loader_routing.sql
-- Add designated_loader_id and routing_mode to promotions table

ALTER TABLE promotions
ADD COLUMN IF NOT EXISTS designated_loader_id UUID REFERENCES loaders(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS routing_mode VARCHAR(30) NOT NULL DEFAULT 'CHEAPEST_AVAILABLE';
