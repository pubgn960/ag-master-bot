-- Migration 036: Payment Sessions for Running Balance & FIFO Consumption
CREATE TABLE IF NOT EXISTS payment_sessions (
    id SERIAL PRIMARY KEY,
    customer_group_id BIGINT,
    group_id UUID,
    initial_amount NUMERIC(10, 2) NOT NULL,
    available_balance NUMERIC(10, 2) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPLETED', 'EXPIRED')),
    txid VARCHAR(128),
    user_id VARCHAR(64),
    currency VARCHAR(16) NOT NULL DEFAULT 'USDT',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_sessions_customer_group_id ON payment_sessions(customer_group_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_expires_at ON payment_sessions(expires_at);
