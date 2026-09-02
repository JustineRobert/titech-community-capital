'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Constants
 * =============================================================================
 *
 * Enterprise Production Configuration Constants
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Centralized immutable definitions used across the MTN MoMo disbursement
 * bounded context.
 *
 * Provides:
 *
 * • Transaction lifecycle states
 * • Provider identifiers
 * • Operation types
 * • Event names
 * • Error codes
 * • Risk decision states
 * • Settlement states
 * • Idempotency states
 * • Audit actions
 *
 * Design Rules
 * -----------------------------------------------------------------------------
 * • No business logic
 * • No environment configuration
 * • No mutable runtime state
 * • Shared by services, workers, controllers and tests
 *
 * =============================================================================
 */


/**
 * =============================================================================
 * Provider
 * =============================================================================
 */


const PROVIDERS = Object.freeze({

    MTN:

        'MTN'

});





/**
 * =============================================================================
 * Payment Operations
 * =============================================================================
 */


const OPERATIONS = Object.freeze({

    DISBURSEMENT:

        'DISBURSEMENT',


    LOAN_PAYOUT:

        'LOAN_PAYOUT',


    SAVINGS_WITHDRAWAL:

        'SAVINGS_WITHDRAWAL',


    SUPPLIER_PAYMENT:

        'SUPPLIER_PAYMENT',


    BULK_PAYMENT:

        'BULK_PAYMENT',


    COMPENSATION:

        'COMPENSATION'


});







/**
 * =============================================================================
 * Transaction Lifecycle States
 * =============================================================================
 */


const TRANSACTION_STATUS = Object.freeze({

    CREATED:

        'CREATED',


    PENDING_APPROVAL:

        'PENDING_APPROVAL',


    APPROVED:

        'APPROVED',


    REJECTED:

        'REJECTED',


    SUBMITTED:

        'SUBMITTED',


    PENDING_CALLBACK:

        'PENDING_CALLBACK',


    SUCCESSFUL:

        'SUCCESSFUL',


    FAILED:

        'FAILED',


    CANCELLED:

        'CANCELLED',


    LEDGER_POSTED:

        'LEDGER_POSTED',


    SETTLED:

        'SETTLED'


});








/**
 * =============================================================================
 * Settlement States
 * =============================================================================
 */


const SETTLEMENT_STATUS = Object.freeze({

    PENDING:

        'PENDING',


    PROCESSING:

        'PROCESSING',


    SETTLED:

        'SETTLED',


    FAILED:

        'FAILED',


    REVERSED:

        'REVERSED',


    INVESTIGATION_REQUIRED:

        'INVESTIGATION_REQUIRED'


});








/**
 * =============================================================================
 * Idempotency States
 * =============================================================================
 */


const IDEMPOTENCY_STATUS = Object.freeze({

    RESERVED:

        'RESERVED',


    PROCESSING:

        'PROCESSING',


    COMPLETED:

        'COMPLETED',


    FAILED:

        'FAILED',


    EXPIRED:

        'EXPIRED'


});








/**
 * =============================================================================
 * Fraud Decision States
 * =============================================================================
 */


const FRAUD_STATUS = Object.freeze({

    ALLOWED:

        'ALLOWED',


    BLOCKED:

        'BLOCKED',


    REVIEW_REQUIRED:

        'REVIEW_REQUIRED',


    ESCALATED:

        'ESCALATED'


});








/**
 * =============================================================================
 * MTN Callback Events
 * =============================================================================
 */


const CALLBACK_EVENTS = Object.freeze({

    RECEIVED:

        'MTN_DISBURSEMENT_CALLBACK_RECEIVED',


    VALIDATED:

        'MTN_DISBURSEMENT_CALLBACK_VALIDATED',


    PROCESSED:

        'MTN_DISBURSEMENT_CALLBACK_PROCESSED',


    FAILED:

        'MTN_DISBURSEMENT_CALLBACK_FAILED'


});








/**
 * =============================================================================
 * Domain Events
 * =============================================================================
 */


const EVENTS = Object.freeze({

    DISBURSEMENT_CREATED:

        'MTN_DISBURSEMENT_CREATED',


    DISBURSEMENT_SUBMITTED:

        'MTN_DISBURSEMENT_SUBMITTED',


    DISBURSEMENT_SUCCESSFUL:

        'MTN_DISBURSEMENT_SUCCESSFUL',


    DISBURSEMENT_FAILED:

        'MTN_DISBURSEMENT_FAILED',


    DISBURSEMENT_SETTLED:

        'MTN_DISBURSEMENT_SETTLED',


    LEDGER_POSTED:

        'MTN_DISBURSEMENT_LEDGER_POSTED',


    FRAUD_BLOCKED:

        'MTN_DISBURSEMENT_FRAUD_BLOCKED',


    IDEMPOTENCY_RESERVED:

        'MTN_DISBURSEMENT_IDEMPOTENCY_RESERVED',


    IDEMPOTENCY_COMPLETED:

        'MTN_DISBURSEMENT_IDEMPOTENCY_COMPLETED'


});








/**
 * =============================================================================
 * Audit Actions
 * =============================================================================
 */


const AUDIT_ACTIONS = Object.freeze({

    CREATED:

        'MTN_DISBURSEMENT_CREATED',


    SUBMITTED:

        'MTN_DISBURSEMENT_SUBMITTED',


    FRAUD_BLOCKED:

        'MTN_DISBURSEMENT_FRAUD_BLOCKED',


    CALLBACK_PROCESSED:

        'MTN_DISBURSEMENT_CALLBACK_PROCESSED',


    LEDGER_POSTED:

        'MTN_DISBURSEMENT_LEDGER_POSTED',


    SETTLEMENT_REGISTERED:

        'MTN_SETTLEMENT_REGISTERED',


    COMPENSATED:

        'MTN_DISBURSEMENT_COMPENSATED'


});








/**
 * =============================================================================
 * Error Codes
 * =============================================================================
 */


const ERROR_CODES = Object.freeze({

    VALIDATION_ERROR:

        'MTN_DISBURSEMENT_VALIDATION_ERROR',


    DUPLICATE_REQUEST:

        'MTN_DISBURSEMENT_DUPLICATE_REQUEST',


    FRAUD_BLOCKED:

        'MTN_DISBURSEMENT_FRAUD_BLOCKED',


    APPROVAL_REQUIRED:

        'MTN_DISBURSEMENT_APPROVAL_REQUIRED',


    PROVIDER_FAILURE:

        'MTN_PROVIDER_FAILURE',


    CALLBACK_FAILURE:

        'MTN_CALLBACK_PROCESSING_FAILURE',


    LEDGER_FAILURE:

        'MTN_LEDGER_POSTING_FAILURE',


    SETTLEMENT_FAILURE:

        'MTN_SETTLEMENT_FAILURE'


});








/**
 * =============================================================================
 * MTN Response Status Mapping
 * =============================================================================
 */


const MTN_STATUS = Object.freeze({

    SUCCESSFUL:

        'SUCCESSFUL',


    FAILED:

        'FAILED',


    PENDING:

        'PENDING'


});








/**
 * =============================================================================
 * Default Configuration Values
 * =============================================================================
 */


const DEFAULTS = Object.freeze({

    CURRENCY:

        'UGX',


    PARTY_ID_TYPE:

        'MSISDN',


    PROVIDER:

        'MTN',


    IDEMPOTENCY_TTL_SECONDS:

        86400,


    CALLBACK_TIMEOUT_SECONDS:

        30


});








/**
 * =============================================================================
 * Export Public Constants
 * =============================================================================
 */


module.exports = Object.freeze({

    PROVIDERS,

    OPERATIONS,

    TRANSACTION_STATUS,

    SETTLEMENT_STATUS,

    IDEMPOTENCY_STATUS,

    FRAUD_STATUS,

    CALLBACK_EVENTS,

    EVENTS,

    AUDIT_ACTIONS,

    ERROR_CODES,

    MTN_STATUS,

    DEFAULTS

});