-- Migration 026: Create loader_costs view over loader_prices
CREATE OR REPLACE VIEW loader_costs AS
SELECT
    id,
    loader_id,
    product_id,
    bundle_id,
    cost,
    currency,
    is_active,
    version,
    effective_from,
    effective_until,
    source,
    source_message_id,
    created_by,
    created_at
FROM loader_prices;
