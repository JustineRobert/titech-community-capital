// backend/migrations/create_mobile_money_transactions.sql
-- ============================================================================
-- TITech Community Capital
-- Mobile Money Transactions Migration
-- ============================================================================
--
-- Supports:
--  - MTN MoMo
--  - Airtel Money
--  - Banks
--  - Visa / Mastercard
--  - Flutterwave
--  - Pesapal
--  - Cellulant
--  - PesaLink
--  - MFS Africa
--
-- Features:
--  - Collections
--  - Withdrawals
--  - Loan Repayments
--  - Savings Contributions
--  - Loan Disbursements
--  - Bulk Disbursements
--  - Settlement Tracking
--  - Reconciliation
--  - Audit Compliance
--
-- ============================================================================

CREATE TABLE IF NOT EXISTS mobile_money_transactions (
    id BIGSERIAL PRIMARY KEY,

    -- =========================================================================
    -- IDENTIFIERS
    -- =========================================================================

    transaction_uuid UUID NOT NULL UNIQUE,

    reference VARCHAR(120) NOT NULL UNIQUE,

    external_reference VARCHAR(120),

    provider_reference VARCHAR(120),

    correlation_id VARCHAR(120),

    batch_id VARCHAR(120),

    idempotency_key VARCHAR(255),

    request_id VARCHAR(255),

    trace_id VARCHAR(255),

    -- =========================================================================
    -- PROVIDER INFORMATION
    -- =========================================================================

    provider VARCHAR(50) NOT NULL,

    provider_channel VARCHAR(50),

    provider_environment VARCHAR(20),

    provider_transaction_id VARCHAR(255),

    provider_account VARCHAR(120),

    provider_status VARCHAR(50),

    provider_response JSONB,

    -- =========================================================================
    -- TRANSACTION DETAILS
    -- =========================================================================

    transaction_type VARCHAR(50) NOT NULL,

    transaction_category VARCHAR(50),

    direction VARCHAR(20),

    amount NUMERIC(18,2) NOT NULL,

    fee_amount NUMERIC(18,2) DEFAULT 0,

    tax_amount NUMERIC(18,2) DEFAULT 0,

    net_amount NUMERIC(18,2) DEFAULT 0,

    currency VARCHAR(10) NOT NULL DEFAULT 'UGX',

    exchange_rate NUMERIC(18,8),

    -- =========================================================================
    -- MEMBER INFORMATION
    -- =========================================================================

    member_id BIGINT,

    account_id BIGINT,

    savings_account_id BIGINT,

    loan_id BIGINT,

    wallet_id BIGINT,

    group_id BIGINT,

    -- =========================================================================
    -- MOBILE MONEY DETAILS
    -- =========================================================================

    phone_number VARCHAR(30),

    recipient_phone VARCHAR(30),

    sender_name VARCHAR(255),

    recipient_name VARCHAR(255),

    msisdn VARCHAR(30),

    country_code VARCHAR(10),

    network VARCHAR(50),

    -- =========================================================================
    -- STATUS MANAGEMENT
    -- =========================================================================

    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',

    settlement_status VARCHAR(50) DEFAULT 'PENDING',

    reconciliation_status VARCHAR(50) DEFAULT 'PENDING',

    webhook_status VARCHAR(50),

    approval_status VARCHAR(50),

    risk_status VARCHAR(50),

    fraud_status VARCHAR(50),

    -- =========================================================================
    -- BUSINESS CONTEXT
    -- =========================================================================

    purpose TEXT,

    narration TEXT,

    notes TEXT,

    metadata JSONB,

    tags JSONB,

    custom_fields JSONB,

    -- =========================================================================
    -- WEBHOOKS
    -- =========================================================================

    webhook_received BOOLEAN DEFAULT FALSE,

    webhook_received_at TIMESTAMP,

    webhook_payload JSONB,

    callback_url TEXT,

    callback_attempts INTEGER DEFAULT 0,

    last_callback_at TIMESTAMP,

    -- =========================================================================
    -- SETTLEMENT
    -- =========================================================================

    settlement_batch_id VARCHAR(120),

    settlement_reference VARCHAR(120),

    settlement_date DATE,

    settled_amount NUMERIC(18,2),

    settled_at TIMESTAMP,

    settlement_metadata JSONB,

    -- =========================================================================
    -- RECONCILIATION
    -- =========================================================================

    reconciled BOOLEAN DEFAULT FALSE,

    reconciled_at TIMESTAMP,

    reconciliation_date DATE,

    reconciliation_batch VARCHAR(120),

    reconciliation_notes TEXT,

    variance_amount NUMERIC(18,2) DEFAULT 0,

    variance_reason TEXT,

    -- =========================================================================
    -- RISK / COMPLIANCE
    -- =========================================================================

    risk_score NUMERIC(8,2),

    aml_checked BOOLEAN DEFAULT FALSE,

    kyc_verified BOOLEAN DEFAULT FALSE,

    sanctions_checked BOOLEAN DEFAULT FALSE,

    compliance_notes TEXT,

    -- =========================================================================
    -- AUDIT TRAIL
    -- =========================================================================

    initiated_by BIGINT,

    approved_by BIGINT,

    rejected_by BIGINT,

    created_by BIGINT,

    updated_by BIGINT,

    approved_at TIMESTAMP,

    rejected_at TIMESTAMP,

    -- =========================================================================
    -- RETRY MANAGEMENT
    -- =========================================================================

    retry_count INTEGER DEFAULT 0,

    max_retries INTEGER DEFAULT 3,

    next_retry_at TIMESTAMP,

    last_retry_at TIMESTAMP,

    retry_reason TEXT,

    -- =========================================================================
    -- ERROR HANDLING
    -- =========================================================================

    error_code VARCHAR(120),

    error_message TEXT,

    failure_reason TEXT,

    last_error JSONB,

    -- =========================================================================
    -- TIMESTAMPS
    -- =========================================================================

    initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    processed_at TIMESTAMP,

    completed_at TIMESTAMP,

    failed_at TIMESTAMP,

    cancelled_at TIMESTAMP,

    expired_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mmt_reference
ON mobile_money_transactions(reference);

CREATE INDEX IF NOT EXISTS idx_mmt_provider_reference
ON mobile_money_transactions(provider_reference);

CREATE INDEX IF NOT EXISTS idx_mmt_external_reference
ON mobile_money_transactions(external_reference);

CREATE INDEX IF NOT EXISTS idx_mmt_provider
ON mobile_money_transactions(provider);

CREATE INDEX IF NOT EXISTS idx_mmt_transaction_type
ON mobile_money_transactions(transaction_type);

CREATE INDEX IF NOT EXISTS idx_mmt_status
ON mobile_money_transactions(status);

CREATE INDEX IF NOT EXISTS idx_mmt_settlement_status
ON mobile_money_transactions(settlement_status);

CREATE INDEX IF NOT EXISTS idx_mmt_reconciliation_status
ON mobile_money_transactions(reconciliation_status);

CREATE INDEX IF NOT EXISTS idx_mmt_member
ON mobile_money_transactions(member_id);

CREATE INDEX IF NOT EXISTS idx_mmt_loan
ON mobile_money_transactions(loan_id);

CREATE INDEX IF NOT EXISTS idx_mmt_account
ON mobile_money_transactions(account_id);

CREATE INDEX IF NOT EXISTS idx_mmt_batch
ON mobile_money_transactions(batch_id);

CREATE INDEX IF NOT EXISTS idx_mmt_phone
ON mobile_money_transactions(phone_number);

CREATE INDEX IF NOT EXISTS idx_mmt_created_at
ON mobile_money_transactions(created_at);

CREATE INDEX IF NOT EXISTS idx_mmt_settlement_date
ON mobile_money_transactions(settlement_date);

CREATE INDEX IF NOT EXISTS idx_mmt_reconciliation_date
ON mobile_money_transactions(reconciliation_date);

CREATE INDEX IF NOT EXISTS idx_mmt_provider_status
ON mobile_money_transactions(provider_status);

CREATE INDEX IF NOT EXISTS idx_mmt_correlation_id
ON mobile_money_transactions(correlation_id);

CREATE INDEX IF NOT EXISTS idx_mmt_idempotency_key
ON mobile_money_transactions(idempotency_key);

-- ============================================================================
-- JSONB INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mmt_metadata_gin
ON mobile_money_transactions
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_mmt_provider_response_gin
ON mobile_money_transactions
USING GIN(provider_response);

CREATE INDEX IF NOT EXISTS idx_mmt_webhook_payload_gin
ON mobile_money_transactions
USING GIN(webhook_payload);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_mobile_money_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mobile_money_updated_at
ON mobile_money_transactions;

CREATE TRIGGER trg_mobile_money_updated_at
BEFORE UPDATE
ON mobile_money_transactions
FOR EACH ROW
EXECUTE FUNCTION update_mobile_money_updated_at();

-- ============================================================================
-- CHECK CONSTRAINTS
-- ============================================================================

ALTER TABLE mobile_money_transactions
ADD CONSTRAINT chk_mmt_amount_positive
CHECK (amount >= 0);

ALTER TABLE mobile_money_transactions
ADD CONSTRAINT chk_mmt_fee_positive
CHECK (fee_amount >= 0);

ALTER TABLE mobile_money_transactions
ADD CONSTRAINT chk_mmt_net_positive
CHECK (net_amount >= 0);

ALTER TABLE mobile_money_transactions
ADD CONSTRAINT chk_mmt_retry_count
CHECK (retry_count >= 0);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE mobile_money_transactions IS
'Central mobile money transaction ledger supporting MTN, Airtel, Banks, Visa, Mastercard, Flutterwave, Pesapal, Cellulant, PesaLink and MFS Africa integrations.';