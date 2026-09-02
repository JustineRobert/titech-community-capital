// backend/migrations/create_mobile_money_reconciliation.sql
-- ============================================================================
-- TITech Community Capital
-- Mobile Money Reconciliation Migration
-- ============================================================================
--
-- Purpose:
--   Central reconciliation and settlement matching repository
--
-- Supports:
--   MTN MoMo
--   Airtel Money
--   Banks
--   Visa / Mastercard
--   Flutterwave
--   Pesapal
--   Cellulant
--   PesaLink
--   MFS Africa
--
-- Features:
--   Daily Reconciliation
--   Settlement Matching
--   Ledger Matching
--   Variance Detection
--   Exception Handling
--   Audit Reporting
--   Regulatory Compliance
--
-- PostgreSQL 14+
--
-- ============================================================================

CREATE TABLE IF NOT EXISTS mobile_money_reconciliation (

    -- =========================================================================
    -- PRIMARY IDENTIFIERS
    -- =========================================================================

    id BIGSERIAL PRIMARY KEY,

    reconciliation_uuid UUID NOT NULL UNIQUE,

    reconciliation_reference VARCHAR(120) NOT NULL UNIQUE,

    reconciliation_batch_id VARCHAR(120),

    reconciliation_run_id VARCHAR(120),

    correlation_id VARCHAR(120),

    trace_id VARCHAR(120),

    -- =========================================================================
    -- PROVIDER INFORMATION
    -- =========================================================================

    provider VARCHAR(50) NOT NULL,

    provider_channel VARCHAR(50),

    provider_environment VARCHAR(30),

    settlement_provider VARCHAR(50),

    source_system VARCHAR(100),

    -- =========================================================================
    -- RECONCILIATION DETAILS
    -- =========================================================================

    reconciliation_type VARCHAR(50) NOT NULL,

    reconciliation_scope VARCHAR(50),

    reconciliation_date DATE NOT NULL,

    settlement_date DATE,

    accounting_period VARCHAR(30),

    business_date DATE,

    -- =========================================================================
    -- COUNTS
    -- =========================================================================

    internal_transaction_count INTEGER DEFAULT 0,

    provider_transaction_count INTEGER DEFAULT 0,

    matched_transaction_count INTEGER DEFAULT 0,

    unmatched_internal_count INTEGER DEFAULT 0,

    unmatched_provider_count INTEGER DEFAULT 0,

    duplicate_transaction_count INTEGER DEFAULT 0,

    exception_count INTEGER DEFAULT 0,

    variance_count INTEGER DEFAULT 0,

    -- =========================================================================
    -- FINANCIAL TOTALS
    -- =========================================================================

    currency VARCHAR(10) NOT NULL DEFAULT 'UGX',

    internal_total_amount NUMERIC(20,2) DEFAULT 0,

    provider_total_amount NUMERIC(20,2) DEFAULT 0,

    matched_amount NUMERIC(20,2) DEFAULT 0,

    unmatched_internal_amount NUMERIC(20,2) DEFAULT 0,

    unmatched_provider_amount NUMERIC(20,2) DEFAULT 0,

    settlement_amount NUMERIC(20,2) DEFAULT 0,

    variance_amount NUMERIC(20,2) DEFAULT 0,

    fee_variance_amount NUMERIC(20,2) DEFAULT 0,

    tax_variance_amount NUMERIC(20,2) DEFAULT 0,

    -- =========================================================================
    -- RECONCILIATION STATUS
    -- =========================================================================

    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',

    reconciliation_status VARCHAR(50) DEFAULT 'PENDING',

    settlement_status VARCHAR(50) DEFAULT 'PENDING',

    approval_status VARCHAR(50) DEFAULT 'PENDING',

    review_status VARCHAR(50) DEFAULT 'PENDING',

    -- =========================================================================
    -- VARIANCE DETAILS
    -- =========================================================================

    variance_detected BOOLEAN DEFAULT FALSE,

    variance_threshold NUMERIC(20,2) DEFAULT 0,

    variance_reason TEXT,

    variance_notes TEXT,

    -- =========================================================================
    -- MATCHING RESULTS
    -- =========================================================================

    matching_algorithm VARCHAR(100),

    matching_version VARCHAR(50),

    auto_matched BOOLEAN DEFAULT FALSE,

    manual_review_required BOOLEAN DEFAULT FALSE,

    manual_review_reason TEXT,

    -- =========================================================================
    -- EXCEPTION MANAGEMENT
    -- =========================================================================

    exception_type VARCHAR(100),

    exception_category VARCHAR(100),

    exception_details JSONB,

    exception_resolution TEXT,

    resolved BOOLEAN DEFAULT FALSE,

    resolved_by BIGINT,

    resolved_at TIMESTAMP,

    -- =========================================================================
    -- SETTLEMENT MATCHING
    -- =========================================================================

    settlement_reference VARCHAR(120),

    settlement_batch_id VARCHAR(120),

    settlement_file_name VARCHAR(255),

    settlement_file_hash VARCHAR(255),

    settlement_verified BOOLEAN DEFAULT FALSE,

    settlement_verified_at TIMESTAMP,

    -- =========================================================================
    -- TRANSACTION REFERENCES
    -- =========================================================================

    matched_transactions JSONB,

    unmatched_internal_transactions JSONB,

    unmatched_provider_transactions JSONB,

    duplicate_transactions JSONB,

    variance_transactions JSONB,

    -- =========================================================================
    -- REPORTING
    -- =========================================================================

    report_generated BOOLEAN DEFAULT FALSE,

    report_reference VARCHAR(120),

    report_location TEXT,

    report_metadata JSONB,

    -- =========================================================================
    -- AUDIT / COMPLIANCE
    -- =========================================================================

    audit_reference VARCHAR(120),

    audited BOOLEAN DEFAULT FALSE,

    audit_notes TEXT,

    compliance_status VARCHAR(50),

    compliance_notes TEXT,

    regulatory_submission_required BOOLEAN DEFAULT FALSE,

    regulatory_submission_date DATE,

    -- =========================================================================
    -- PROCESSING
    -- =========================================================================

    processing_node VARCHAR(255),

    processor_version VARCHAR(100),

    processor_instance VARCHAR(255),

    processing_duration_ms BIGINT,

    retry_count INTEGER DEFAULT 0,

    max_retries INTEGER DEFAULT 5,

    -- =========================================================================
    -- METADATA
    -- =========================================================================

    metadata JSONB,

    provider_payload JSONB,

    reconciliation_payload JSONB,

    tags JSONB,

    custom_fields JSONB,

    -- =========================================================================
    -- USER TRACKING
    -- =========================================================================

    created_by BIGINT,

    approved_by BIGINT,

    reviewed_by BIGINT,

    updated_by BIGINT,

    approved_at TIMESTAMP,

    reviewed_at TIMESTAMP,

    -- =========================================================================
    -- TIMESTAMPS
    -- =========================================================================

    started_at TIMESTAMP,

    completed_at TIMESTAMP,

    failed_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- UNIQUE INDEXES
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_mmr_reference
ON mobile_money_reconciliation(reconciliation_reference);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mmr_uuid
ON mobile_money_reconciliation(reconciliation_uuid);

-- ============================================================================
-- STANDARD INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mmr_provider
ON mobile_money_reconciliation(provider);

CREATE INDEX IF NOT EXISTS idx_mmr_date
ON mobile_money_reconciliation(reconciliation_date);

CREATE INDEX IF NOT EXISTS idx_mmr_business_date
ON mobile_money_reconciliation(business_date);

CREATE INDEX IF NOT EXISTS idx_mmr_settlement_date
ON mobile_money_reconciliation(settlement_date);

CREATE INDEX IF NOT EXISTS idx_mmr_status
ON mobile_money_reconciliation(status);

CREATE INDEX IF NOT EXISTS idx_mmr_reconciliation_status
ON mobile_money_reconciliation(reconciliation_status);

CREATE INDEX IF NOT EXISTS idx_mmr_settlement_status
ON mobile_money_reconciliation(settlement_status);

CREATE INDEX IF NOT EXISTS idx_mmr_review_status
ON mobile_money_reconciliation(review_status);

CREATE INDEX IF NOT EXISTS idx_mmr_batch_id
ON mobile_money_reconciliation(reconciliation_batch_id);

CREATE INDEX IF NOT EXISTS idx_mmr_run_id
ON mobile_money_reconciliation(reconciliation_run_id);

CREATE INDEX IF NOT EXISTS idx_mmr_settlement_batch
ON mobile_money_reconciliation(settlement_batch_id);

CREATE INDEX IF NOT EXISTS idx_mmr_audit_reference
ON mobile_money_reconciliation(audit_reference);

CREATE INDEX IF NOT EXISTS idx_mmr_created_at
ON mobile_money_reconciliation(created_at);

CREATE INDEX IF NOT EXISTS idx_mmr_completed_at
ON mobile_money_reconciliation(completed_at);

CREATE INDEX IF NOT EXISTS idx_mmr_variance_detected
ON mobile_money_reconciliation(variance_detected);

CREATE INDEX IF NOT EXISTS idx_mmr_manual_review_required
ON mobile_money_reconciliation(manual_review_required);

-- ============================================================================
-- JSONB INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mmr_metadata_gin
ON mobile_money_reconciliation
USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_mmr_provider_payload_gin
ON mobile_money_reconciliation
USING GIN(provider_payload);

CREATE INDEX IF NOT EXISTS idx_mmr_reconciliation_payload_gin
ON mobile_money_reconciliation
USING GIN(reconciliation_payload);

CREATE INDEX IF NOT EXISTS idx_mmr_exception_details_gin
ON mobile_money_reconciliation
USING GIN(exception_details);

CREATE INDEX IF NOT EXISTS idx_mmr_report_metadata_gin
ON mobile_money_reconciliation
USING GIN(report_metadata);

CREATE INDEX IF NOT EXISTS idx_mmr_matched_transactions_gin
ON mobile_money_reconciliation
USING GIN(matched_transactions);

CREATE INDEX IF NOT EXISTS idx_mmr_variance_transactions_gin
ON mobile_money_reconciliation
USING GIN(variance_transactions);

-- ============================================================================
-- CHECK CONSTRAINTS
-- ============================================================================

ALTER TABLE mobile_money_reconciliation
ADD CONSTRAINT chk_mmr_retry_count
CHECK (retry_count >= 0);

ALTER TABLE mobile_money_reconciliation
ADD CONSTRAINT chk_mmr_max_retries
CHECK (max_retries >= 0);

ALTER TABLE mobile_money_reconciliation
ADD CONSTRAINT chk_mmr_internal_amount
CHECK (internal_total_amount >= 0);

ALTER TABLE mobile_money_reconciliation
ADD CONSTRAINT chk_mmr_provider_amount
CHECK (provider_total_amount >= 0);

ALTER TABLE mobile_money_reconciliation
ADD CONSTRAINT chk_mmr_variance_amount
CHECK (variance_amount >= 0);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_mobile_money_reconciliation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mobile_money_reconciliation_updated_at
ON mobile_money_reconciliation;

CREATE TRIGGER trg_mobile_money_reconciliation_updated_at
BEFORE UPDATE
ON mobile_money_reconciliation
FOR EACH ROW
EXECUTE FUNCTION update_mobile_money_reconciliation_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE mobile_money_reconciliation IS
'Enterprise reconciliation repository for MTN MoMo, Airtel Money, banking integrations, card networks, Flutterwave, Pesapal, Cellulant, PesaLink and MFS Africa. Supports settlement matching, ledger balancing, variance detection, audit workflows and regulatory reporting.';