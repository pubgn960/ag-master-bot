-- =========================================================
-- ITECH AVENGERS BOT ENGINE DATABASE SCHEMA v1.0
-- FULL POSTGRESQL SCHEMA WITH INTEGRITY CONSTRAINTS
-- =========================================================

-- Core Users & Permissions
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('OWNER', 'STAFF', 'LOADER')),
    telegram_user_id BIGINT UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(100) PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id VARCHAR(100) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by UUID REFERENCES users(id),
    PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS feature_flags (
    key VARCHAR(100) PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

-- Telegram Groups & Identity
CREATE TABLE IF NOT EXISTS telegram_groups (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    username VARCHAR(100),
    is_supergroup BOOLEAN NOT NULL DEFAULT FALSE,
    migrated_to_group_id VARCHAR(64),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY,
    telegram_user_id BIGINT UNIQUE NOT NULL,
    first_name VARCHAR(150),
    last_name VARCHAR(150),
    username VARCHAR(100),
    display_name VARCHAR(255) NOT NULL,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Dynamic Products & Bundles
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_fields (
    id UUID PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    field_name VARCHAR(50) NOT NULL,
    field_label VARCHAR(100) NOT NULL,
    field_type VARCHAR(30) NOT NULL DEFAULT 'text',
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    validation_regex VARCHAR(255),
    helper_text TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT unq_product_field_name UNIQUE (product_id, field_name)
);

CREATE TABLE IF NOT EXISTS product_bundles (
    id UUID PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    cp_quantity INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    default_target_profit NUMERIC(12,2) NOT NULL DEFAULT 3.00,
    CONSTRAINT unq_product_bundle_cp UNIQUE (product_id, cp_quantity)
);

-- Loaders & Routing
CREATE TABLE IF NOT EXISTS loaders (
    id UUID PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(150) NOT NULL,
    telegram_user_id BIGINT,
    telegram_chat_id BIGINT,
    username VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    availability_status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE' CHECK (availability_status IN ('AVAILABLE', 'BUSY', 'OFFLINE')),
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_loader_routes (
    id UUID PRIMARY KEY,
    group_id VARCHAR(64) UNIQUE NOT NULL REFERENCES telegram_groups(id) ON DELETE CASCADE,
    assigned_loader_id UUID REFERENCES loaders(id) ON DELETE SET NULL,
    fulfillment_rule VARCHAR(40) NOT NULL DEFAULT 'PAYMENT_REQUIRED' CHECK (fulfillment_rule IN ('PAYMENT_REQUIRED', 'FULFILL_REGARDLESS_OF_PAYMENT')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Price Profiles & Item Margins
CREATE TABLE IF NOT EXISTS price_profiles (
    id UUID PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    pricing_mode VARCHAR(30) NOT NULL DEFAULT 'AUTO_PROFIT' CHECK (pricing_mode IN ('AUTO_PROFIT', 'FIXED_PRICE')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_profile_items (
    id UUID PRIMARY KEY,
    price_profile_id UUID NOT NULL REFERENCES price_profiles(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    bundle_id UUID NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
    target_profit NUMERIC(12,2) NOT NULL DEFAULT 3.00,
    fixed_sale_price NUMERIC(12,2),
    rounding_rule VARCHAR(30) NOT NULL DEFAULT 'HALF_UP_2',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT unq_profile_bundle UNIQUE (price_profile_id, bundle_id)
);

CREATE TABLE IF NOT EXISTS group_price_profile_assignments (
    id UUID PRIMARY KEY,
    group_id VARCHAR(64) UNIQUE NOT NULL REFERENCES telegram_groups(id) ON DELETE CASCADE,
    price_profile_id UUID NOT NULL REFERENCES price_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Loader Price Books & History
CREATE TABLE IF NOT EXISTS loader_price_books (
    id UUID PRIMARY KEY,
    loader_id UUID UNIQUE NOT NULL REFERENCES loaders(id) ON DELETE CASCADE,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    current_version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loader_prices (
    id UUID PRIMARY KEY,
    loader_id UUID NOT NULL REFERENCES loaders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    bundle_id UUID NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
    cost NUMERIC(12,2) NOT NULL CHECK (cost > 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    effective_until TIMESTAMPTZ,
    source VARCHAR(30) NOT NULL DEFAULT 'DASHBOARD' CHECK (source IN ('DASHBOARD', 'TELEGRAM_COMMAND', 'TELEGRAM_MESSAGE')),
    source_message_id BIGINT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loader_price_history (
    id UUID PRIMARY KEY,
    loader_id UUID NOT NULL REFERENCES loaders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    bundle_id UUID NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
    old_cost NUMERIC(12,2),
    new_cost NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    version INTEGER NOT NULL,
    source VARCHAR(50) NOT NULL,
    source_message_id BIGINT,
    changed_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loader_price_update_proposals (
    id UUID PRIMARY KEY,
    loader_id UUID NOT NULL REFERENCES loaders(id) ON DELETE CASCADE,
    source_type VARCHAR(30) NOT NULL CHECK (source_type IN ('TEXT', 'IMAGE', 'COMMAND')),
    raw_text TEXT,
    image_ref VARCHAR(255),
    parsed_payload JSONB NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPLIED', 'COOLDOWN_BATCHED', 'BLOCKED_BY_ANOMALY')),
    risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence NUMERIC(5,4) NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sale_price_history (
    id UUID PRIMARY KEY,
    group_id VARCHAR(64) REFERENCES telegram_groups(id) ON DELETE SET NULL,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    bundle_id UUID NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
    old_sale_price NUMERIC(12,2),
    new_sale_price NUMERIC(12,2) NOT NULL,
    loader_cost NUMERIC(12,2) NOT NULL,
    target_profit NUMERIC(12,2) NOT NULL,
    reason VARCHAR(100) NOT NULL,
    price_profile_id UUID REFERENCES price_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Promotions
CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    bundle_id UUID REFERENCES product_bundles(id) ON DELETE SET NULL,
    sale_price NUMERIC(12,2) NOT NULL CHECK (sale_price > 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    image_ref VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    pause_reason VARCHAR(255),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Payment Details / Profiles
CREATE TABLE IF NOT EXISTS payment_profiles (
    id UUID PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    binance_name VARCHAR(150),
    binance_id VARCHAR(100),
    bybit_name VARCHAR(150),
    bybit_uid VARCHAR(100),
    trc20_address VARCHAR(150),
    bep20_address VARCHAR(150),
    custom_instructions TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_payment_profile_assignments (
    id UUID PRIMARY KEY,
    group_id VARCHAR(64) UNIQUE NOT NULL REFERENCES telegram_groups(id) ON DELETE CASCADE,
    payment_profile_id UUID NOT NULL REFERENCES payment_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Orders Core
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY,
    order_number VARCHAR(30) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    group_id VARCHAR(64) NOT NULL REFERENCES telegram_groups(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    bundle_id UUID NOT NULL REFERENCES product_bundles(id) ON DELETE RESTRICT,
    cp_quantity INTEGER NOT NULL,
    status VARCHAR(30) NOT NULL CHECK (status IN ('INCOMPLETE', 'PENDING', 'SENT_TO_LOADER', 'PROCESSING', 'DONE', 'CANCELLED', 'REVERSED')),
    sale_price_snapshot NUMERIC(12,2) NOT NULL,
    loader_cost_snapshot NUMERIC(12,2) NOT NULL,
    target_profit_snapshot NUMERIC(12,2) NOT NULL,
    currency_snapshot VARCHAR(10) NOT NULL DEFAULT 'USD',
    exchange_rate_snapshot NUMERIC(12,6) NOT NULL DEFAULT 1.000000,
    fulfillment_rule_snapshot VARCHAR(40) NOT NULL,
    price_profile_id UUID REFERENCES price_profiles(id) ON DELETE SET NULL,
    promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL,
    assigned_loader_id UUID REFERENCES loaders(id) ON DELETE SET NULL,
    amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    amount_remaining NUMERIC(12,2) NOT NULL,
    payment_amount_state VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (payment_amount_state IN ('UNPAID', 'PARTIAL', 'PAID', 'OVERPAID')),
    payment_verification_state VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (payment_verification_state IN ('PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_REVIEW')),
    manual_payment_override VARCHAR(30) NOT NULL DEFAULT 'NONE' CHECK (manual_payment_override IN ('NONE', 'MANUALLY_MARKED_PAID', 'MANUALLY_MARKED_UNPAID')),
    manual_override_by VARCHAR(100),
    manual_override_at TIMESTAMPTZ,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_field_values (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    field_name VARCHAR(50) NOT NULL,
    field_value_cipher TEXT NOT NULL,
    field_value_masked VARCHAR(255) NOT NULL,
    encryption_key_version VARCHAR(20) NOT NULL DEFAULT 'v1',
    is_redacted BOOLEAN NOT NULL DEFAULT FALSE,
    redacted_at TIMESTAMPTZ,
    CONSTRAINT unq_order_field UNIQUE (order_id, field_name)
);

CREATE TABLE IF NOT EXISTS order_messages (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    telegram_message_id BIGINT NOT NULL,
    telegram_user_id BIGINT NOT NULL,
    message_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_images (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    image_ref VARCHAR(255) NOT NULL,
    image_type VARCHAR(30) NOT NULL DEFAULT 'CREDENTIAL_OR_CODE',
    extracted_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_edit_history (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    actor VARCHAR(100) NOT NULL,
    field_changed VARCHAR(50) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_cancellations (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    cancelled_by VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    previous_status VARCHAR(30) NOT NULL,
    loader_void_notified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Loader Delivery Lifecycle & Durable Outbox
CREATE TABLE IF NOT EXISTS loader_deliveries (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    loader_id UUID NOT NULL REFERENCES loaders(id) ON DELETE RESTRICT,
    delivery_status VARCHAR(30) NOT NULL DEFAULT 'READY' CHECK (delivery_status IN ('READY', 'QUEUED', 'SENDING', 'TELEGRAM_ACCEPTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'NEEDS_RECONCILIATION')),
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    telegram_message_id BIGINT,
    delivered_fields_snapshot JSONB NOT NULL,
    sale_price_snapshot NUMERIC(12,2) NOT NULL,
    loader_cost_snapshot NUMERIC(12,2) NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    completion_screenshot_ref VARCHAR(255),
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS outbox_jobs (
    id UUID PRIMARY KEY,
    job_type VARCHAR(50) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'NEEDS_RECONCILIATION')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error TEXT,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

-- Payments & Allocations
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    group_id VARCHAR(64) REFERENCES telegram_groups(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    amount_state VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (amount_state IN ('UNPAID', 'PARTIAL', 'PAID', 'OVERPAID')),
    verification_state VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (verification_state IN ('PENDING', 'VERIFIED', 'REJECTED', 'NEEDS_REVIEW')),
    source VARCHAR(30) NOT NULL CHECK (source IN ('EXCHANGE_API', 'SCREENSHOT', 'MANUAL', 'BLOCKCHAIN')),
    txid VARCHAR(255) UNIQUE,
    manual_override VARCHAR(30) NOT NULL DEFAULT 'NONE' CHECK (manual_override IN ('NONE', 'MANUALLY_MARKED_PAID', 'MANUALLY_MARKED_UNPAID')),
    manual_override_by VARCHAR(100),
    match_state VARCHAR(30) NOT NULL DEFAULT 'UNMATCHED' CHECK (match_state IN ('UNMATCHED', 'PARTIALLY_ALLOCATED', 'ALLOCATED')),
    allocated_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    unallocated_amount NUMERIC(12,2) NOT NULL,
    raw_evidence JSONB,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY,
    payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT,
    ledger_transaction_id UUID,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    amount_allocated NUMERIC(12,2) NOT NULL CHECK (amount_allocated > 0),
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_allocation_provenance CHECK (
        (payment_id IS NOT NULL AND ledger_transaction_id IS NULL) OR
        (payment_id IS NULL AND ledger_transaction_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS payment_images (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    image_ref VARCHAR(255) NOT NULL,
    ocr_extracted_text TEXT,
    ocr_confidence NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_reversals (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    reversed_by VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    reversal_amount NUMERIC(12,2) NOT NULL,
    unwound_allocations JSONB NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Customer Balance Ledger (Append-Only)
CREATE TABLE IF NOT EXISTS customer_balances (
    customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    current_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_balance_transactions (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    type VARCHAR(30) NOT NULL CHECK (type IN ('CREDIT', 'DEBIT', 'REVERSAL_CREDIT', 'REVERSAL_DEBIT')),
    amount NUMERIC(12,2) NOT NULL,
    balance_before NUMERIC(12,2) NOT NULL,
    balance_after NUMERIC(12,2) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    source_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    source_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    actor VARCHAR(100) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Profit Ledger (Idempotent Realization & Offsetting)
CREATE TABLE IF NOT EXISTS profit_ledger (
    id UUID PRIMARY KEY,
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    realized_profit NUMERIC(12,2) NOT NULL,
    sale_price NUMERIC(12,2) NOT NULL,
    loader_cost NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
    reversal_offset_id UUID,
    realized_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profit_ledger_offsets (
    id UUID PRIMARY KEY,
    profit_ledger_id UUID NOT NULL REFERENCES profit_ledger(id) ON DELETE RESTRICT,
    offset_amount NUMERIC(12,2) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    reversed_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Telegram Webhook Logs & Correlation
CREATE TABLE IF NOT EXISTS telegram_update_log (
    id UUID PRIMARY KEY,
    update_id BIGINT UNIQUE NOT NULL,
    raw_payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Broadcasts & Messages
CREATE TABLE IF NOT EXISTS broadcasts (
    id UUID PRIMARY KEY,
    title VARCHAR(255),
    message_text TEXT NOT NULL,
    image_ref VARCHAR(255),
    target_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broadcast_deliveries (
    id UUID PRIMARY KEY,
    broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
    group_id VARCHAR(64) NOT NULL REFERENCES telegram_groups(id) ON DELETE CASCADE,
    send_status VARCHAR(20) NOT NULL DEFAULT 'SENT' CHECK (send_status IN ('SENT', 'SEND_FAILED')),
    pin_status VARCHAR(20) NOT NULL DEFAULT 'NOT_PINNED' CHECK (pin_status IN ('PINNED', 'PIN_FAILED', 'NOT_PINNED')),
    telegram_message_id BIGINT,
    error TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_templates (
    id UUID PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(150) NOT NULL,
    body_template TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY,
    level VARCHAR(20) NOT NULL DEFAULT 'INFO' CHECK (level IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Audit & Credential Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY,
    actor VARCHAR(100) NOT NULL,
    telegram_user_id BIGINT,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(255),
    previous_state JSONB,
    new_state JSONB,
    source_surface VARCHAR(50) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credential_access_log (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    field_name VARCHAR(50) NOT NULL,
    revealed_by VARCHAR(100) NOT NULL,
    purpose VARCHAR(255) NOT NULL,
    ip_address VARCHAR(50),
    revealed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Reconciliation Runs & Issues
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id UUID PRIMARY KEY,
    run_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL CHECK (status IN ('SUCCESS', 'DISCREPANCIES_FOUND', 'FAILED')),
    items_checked INTEGER NOT NULL DEFAULT 0,
    issues_found INTEGER NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reconciliation_issues (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
    issue_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    entity_type VARCHAR(50),
    entity_id VARCHAR(255),
    description TEXT NOT NULL,
    suggested_action TEXT,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AI Extraction Provenance & Audit
CREATE TABLE IF NOT EXISTS ai_extractions (
    id UUID PRIMARY KEY,
    source_type VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    model_name VARCHAR(50) NOT NULL,
    prompt_version VARCHAR(20) NOT NULL,
    schema_version VARCHAR(20) NOT NULL,
    raw_prompt_sanitized TEXT,
    raw_output JSONB NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    estimated_cost NUMERIC(8,5) NOT NULL DEFAULT 0.00000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Database Indexes for high performance query lookups
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_group_id ON orders(group_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_txid ON payments(txid);
CREATE INDEX IF NOT EXISTS idx_payments_verification_state ON payments(verification_state);
CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_audit_correlation_id ON audit_logs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_telegram_update_id ON telegram_update_log(update_id);
ALTER TABLE payment_allocations ADD CONSTRAINT fk_payment_allocations_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES customer_balance_transactions(id) ON DELETE RESTRICT;
