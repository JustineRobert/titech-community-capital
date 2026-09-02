// backend/migrations/create_mobile_money_callbacks.sql
-- ============================================================================
-- TITech Community Capital
-- Mobile Money Callbacks / Webhooks
-- ============================================================================
--
-- Supports:
--  MTN MoMo
--  Airtel Money
--  Banks
--  Visa
--  Mastercard
--  Flutterwave
--  Pesapal
--  Cellulant
--  PesaLink
--  MFS Africa
--
-- Features:
--  Callback Persistence
--  Webhook Processing
--  Signature Verification
--  Idempotency
--  Replay Protection
--  Audit Trails
--  Event Sourcing
--  Dead Letter Queue Support
--
-- PostgreSQL Production Migration
--
-- ============================================================================

CREATE TABLE IF NOT EXISTS mobile_money_callbacks (
    id BIGSERIAL PRIMARY KEY,

    -- =========================================================================
    -- EVENT IDENTIFIERS
    -- =========================================================================

    callback_uuid UUID NOT NULL UNIQUE,

    event_id VARCHAR(255),

    notification_id VARCHAR(255),

    webhook_id VARCHAR(255),

    request_id VARCHAR(255),

    trace_id VARCHAR(255),

    correlation_id VARCHAR(255),

    idempotency_key VARCHAR(255),

    -- =========================================================================
    -- TRANSACTION REFERENCES
    -- =========================================================================

    transaction_reference VARCHAR(120),

    provider_reference VARCHAR(120),

    external_reference VARCHAR(120),

    batch_reference VARCHAR(120),

    transaction_uuid UUID,

    -- =========================================================================
    -- PROVIDER DETAILS
    -- =========================================================================

    provider VARCHAR(50) NOT NULL,

    provider_channel VARCHAR(50),

    provider_transaction_id VARCHAR(255),

    provider_status VARCHAR(50),

    provider_environment VARCHAR(20),

    event_type VARCHAR(100),

    event_category VARCHAR(100),

    -- =========================================================================
    -- SECURITY
    -- =========================================================================

    signature VARCHAR(1000),

    signature_algorithm VARCHAR(50),

    signature_verified BOOLEAN DEFAULT FALSE,

    replay_verified BOOLEAN DEFAULT FALSE,

    source_ip VARCHAR(100),

    source_host VARCHAR(255),

    user_agent TEXT,

    request_method VARCHAR(20),

    -- =========================================================================
    -- CALLBACK PAYLOADS
    -- =========================================================================

    headers JSONB,

    payload JSONB NOT NULL,

    raw_payload TEXT,

    normalized_payload JSONB,

    provider_response JSONB,

    metadata JSONB,

    -- =========================================================================
    -- PROCESSING STATUS
    -- =========================================================================

    processing_status VARCHAR(50)
        DEFAULT 'RECEIVED',

    callback_status VARCHAR(50)
        DEFAULT 'PENDING',

    processing_result VARCHAR(50),

    transaction_status_before VARCHAR(50),

    transaction_status_after VARCHAR(50),

    -- =========================================================================
    -- ERROR MANAGEMENT
    -- =========================================================================

    error_code VARCHAR(100),

    error_message TEXT,

    error_stack TEXT,

    failure_reason TEXT,

    last_error JSONB,

    -- =========================================================================
    -- RETRY MANAGEMENT
    -- =========================================================================

    retry_count INTEGER DEFAULT 0,

    max_retries INTEGER DEFAULT 5,

    next_retry_at TIMESTAMP,

    last_retry_at TIMESTAMP,

    retry_reason TEXT,

    -- =========================================================================
    -- DEAD LETTER QUEUE
    -- =========================================================================

    moved_to_dlq BOOLEAN DEFAULT FALSE,

    dlq_reason TEXT,

    dlq_timestamp TIMESTAMP,

    dlq_payload JSONB,

    -- =========================================================================
    -- AUDIT / COMPLIANCE
    -- =========================================================================

    audited BOOLEAN DEFAULT FALSE,

    compliance_flag BOOLEAN DEFAULT FALSE,

    investigation_required BOOLEAN DEFAULT FALSE,

    investigation_notes TEXT,

    reviewed_by BIGINT,

    reviewed_at TIMESTAMP,

    -- =========================================================================
    -- EVENT PROCESSING
    -- =========================================================================

    event_sequence BIGINT,

    processing_node VARCHAR(255),

    processor_version VARCHAR(100),

    processor_instance VARCHAR(255),

    -- =========================================================================
    -- TIMESTAMPS
    -- =========================================================================

    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    validated_at TIMESTAMP,

    processed_at TIMESTAMP,

    acknowledged_at TIMESTAMP,

    failed_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mmc_event_id
ON mobile_money_callbacks(event_id);

CREATE INDEX IF NOT EXISTS idx_mmc_notification_id
ON mobile_money_callbacks(notification_id);

CREATE INDEX IF NOT EXISTS idx_mmc_transaction_reference
ON mobile_money_callbacks(transaction_reference);

CREATE INDEX IF NOT EXISTS idx_mmc_provider_reference
ON mobile_money_callbacks(provider_reference);

CREATE INDEX IF NOT EXISTS idx_mmc_external_reference
ON mobile_money_callbacks(external_reference);

CREATE INDEX IF NOT EXISTS idx_mmc_provider
ON mobile_money_callbacks(provider);

CREATE INDEX IF NOT EXISTS idx_mmc_provider_status
ON mobile_money_callbacks(provider_status);

CREATE INDEX IF NOT EXISTS idx_mmc_event_type
ON mobile_money_callbacks(event_type);

CREATE INDEX IF NOT EXISTS idx_mmc_processing_status
ON mobile_money_callbacks(processing_status);

CREATE INDEX IF NOT EXISTS idx_mmc_callback_status
ON mobile_money_callbacks(callback_status);

CREATE INDEX IF NOT EXISTS idx_mmc_signature_verified
ON mobile_money_callbacks(signature_verified);

CREATE INDEX IF NOT EXISTS idx_mmc_replay_verified
ON mobile_money_callbacks(replay_verified);

CREATE INDEX IF NOT EXISTS idx_mmc_received_at
ON mobile_money_callbacks(received_at);

CREATE INDEX IF NOT EXISTS idx_mmc_processed_at
ON mobile_money_callbacks(processed_at);

CREATE INDEX IF NOT EXISTS idx_mmc_idempotency_key
ON mobile_money_callbacks(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_mmc_correlation_id
ON mobile_money_callbacks(correlation_id);

CREATE INDEX IF NOT EXISTS idx_mmc_trace_id
ON mobile_money_callbacks(trace_id);

-- ============================================================================
-- JSONB INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mmc_payload_gin
ON mobile_money_callbacks
USING GIN(payload);

CREATE INDEX IF NOT EXISTS idx_mmc_headers_gin
ON mobile_money_callbacks
USING GIN(headers);

CREATE INDEX IF NOT EXISTS idx_mmc_metadata_gin
ON mobile_money_callbacks
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_mmc_provider_response_gin
ON mobile_money_callbacks
USING GIN(provider_response);

CREATE INDEX IF NOT EXISTS idx_mmc_normalized_payload_gin
ON mobile_money_callbacks
USING GIN(normalized_payload);

-- ============================================================================
-- UNIQUE CONSTRAINTS
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_mmc_event_provider
ON mobile_money_callbacks (
    provider,
    event_id
)
WHERE event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mmc_notification_provider
ON mobile_money_callbacks (
    provider,
    notification_id
)
WHERE notification_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mmc_webhook_provider
ON mobile_money_callbacks (
    provider,
    webhook_id
)
WHERE webhook_id IS NOT NULL;

-- ============================================================================
-- CHECK CONSTRAINTS
-- ============================================================================

ALTER TABLE mobile_money_callbacks
ADD CONSTRAINT chk_mmc_retry_count
CHECK (retry_count >= 0);

ALTER TABLE mobile_money_callbacks
ADD CONSTRAINT chk_mmc_max_retries
CHECK (max_retries >= 0);

ALTER TABLE mobile_money_callbacks
ADD CONSTRAINT chk_mmc_event_sequence
CHECK (
    event_sequence IS NULL
    OR event_sequence >= 0
);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_mobile_money_callbacks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mobile_money_callbacks_updated_at
ON mobile_money_callbacks;

CREATE TRIGGER trg_mobile_money_callbacks_updated_at
BEFORE UPDATE
ON mobile_money_callbacks
FOR EACH ROW
EXECUTE FUNCTION update_mobile_money_callbacks_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE mobile_money_callbacks IS
'Central callback/webhook event store for MTN MoMo, Airtel Money, Banking APIs, Flutterwave, Pesapal, Visa, Mastercard, Cellulant, PesaLink and MFS Africa integrations. Supports event sourcing, audit trails, replay protection, idempotency, reconciliation and regulatory compliance.';