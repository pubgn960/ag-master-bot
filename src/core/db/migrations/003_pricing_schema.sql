CREATE TABLE IF NOT EXISTS group_sale_prices (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES telegram_groups(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    bundle_id UUID NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
    sale_price NUMERIC(12,2) NOT NULL,
    loader_cost NUMERIC(12,2) NOT NULL,
    target_profit NUMERIC(12,2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unq_group_bundle UNIQUE (group_id, bundle_id)
);
