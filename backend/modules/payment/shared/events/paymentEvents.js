'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Shared Payment Domain Events
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Centralized immutable event definitions for the payment domain.
 *
 * Used by:
 *
 * • MTN MoMo
 * • Airtel Money
 * • Bank integrations
 * • Payment orchestration services
 * • Callback processors
 * • Settlement engines
 * • Ledger integration workflows
 * • Notification systems
 * • Analytics pipelines
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Define payment domain event names
 * • Prevent event string duplication
 * • Maintain event naming consistency
 * • Support event-driven architecture
 * • Enable audit and observability correlation
 *
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Publish events
 * ✗ Store events
 * ✗ Process events
 * ✗ Contain business logic
 *
 * =============================================================================
 */



/**
 * =============================================================================
 * Payment Lifecycle Events
 * =============================================================================
 */


const PAYMENT_EVENTS = Object.freeze({



    /**
     * Payment Creation
     */

    PAYMENT_CREATED:

        'PAYMENT_CREATED',



    PAYMENT_VALIDATION_STARTED:

        'PAYMENT_VALIDATION_STARTED',



    PAYMENT_VALIDATED:

        'PAYMENT_VALIDATED',



    PAYMENT_VALIDATION_FAILED:

        'PAYMENT_VALIDATION_FAILED',





    /**
     * Authorization
     */

    PAYMENT_APPROVAL_REQUIRED:

        'PAYMENT_APPROVAL_REQUIRED',



    PAYMENT_APPROVED:

        'PAYMENT_APPROVED',



    PAYMENT_REJECTED:

        'PAYMENT_REJECTED',





    /**
     * Provider Execution
     */

    PAYMENT_SUBMITTED_TO_PROVIDER:

        'PAYMENT_SUBMITTED_TO_PROVIDER',



    PAYMENT_PROVIDER_ACCEPTED:

        'PAYMENT_PROVIDER_ACCEPTED',



    PAYMENT_PROVIDER_REJECTED:

        'PAYMENT_PROVIDER_REJECTED',





    /**
     * Callback Processing
     */

    PAYMENT_CALLBACK_RECEIVED:

        'PAYMENT_CALLBACK_RECEIVED',



    PAYMENT_CALLBACK_VALIDATED:

        'PAYMENT_CALLBACK_VALIDATED',



    PAYMENT_CALLBACK_PROCESSED:

        'PAYMENT_CALLBACK_PROCESSED',



    PAYMENT_CALLBACK_FAILED:

        'PAYMENT_CALLBACK_FAILED',






    /**
     * Completion
     */

    PAYMENT_SUCCESSFUL:

        'PAYMENT_SUCCESSFUL',



    PAYMENT_FAILED:

        'PAYMENT_FAILED',



    PAYMENT_CANCELLED:

        'PAYMENT_CANCELLED',



    PAYMENT_REVERSED:

        'PAYMENT_REVERSED'



});








/**
 * =============================================================================
 * MTN MoMo Events
 * =============================================================================
 */


const MTN_PAYMENT_EVENTS = Object.freeze({



    MTN_COLLECTION_CREATED:

        'MTN_COLLECTION_CREATED',



    MTN_COLLECTION_SUBMITTED:

        'MTN_COLLECTION_SUBMITTED',



    MTN_COLLECTION_CALLBACK_RECEIVED:

        'MTN_COLLECTION_CALLBACK_RECEIVED',



    MTN_COLLECTION_SUCCESSFUL:

        'MTN_COLLECTION_SUCCESSFUL',



    MTN_COLLECTION_FAILED:

        'MTN_COLLECTION_FAILED',





    MTN_DISBURSEMENT_CREATED:

        'MTN_DISBURSEMENT_CREATED',



    MTN_DISBURSEMENT_APPROVAL_CREATED:

        'MTN_DISBURSEMENT_APPROVAL_CREATED',



    MTN_DISBURSEMENT_APPROVED:

        'MTN_DISBURSEMENT_APPROVED',



    MTN_DISBURSEMENT_SUBMITTED:

        'MTN_DISBURSEMENT_SUBMITTED',



    MTN_DISBURSEMENT_CALLBACK_RECEIVED:

        'MTN_DISBURSEMENT_CALLBACK_RECEIVED',



    MTN_DISBURSEMENT_SUCCESSFUL:

        'MTN_DISBURSEMENT_SUCCESSFUL',



    MTN_DISBURSEMENT_FAILED:

        'MTN_DISBURSEMENT_FAILED',



    MTN_DISBURSEMENT_COMPENSATED:

        'MTN_DISBURSEMENT_COMPENSATED'



});








/**
 * =============================================================================
 * Settlement Events
 * =============================================================================
 */


const SETTLEMENT_EVENTS = Object.freeze({



    SETTLEMENT_CREATED:

        'SETTLEMENT_CREATED',



    SETTLEMENT_MATCH_STARTED:

        'SETTLEMENT_MATCH_STARTED',



    SETTLEMENT_MATCH_COMPLETED:

        'SETTLEMENT_MATCH_COMPLETED',



    SETTLEMENT_MISMATCH_DETECTED:

        'SETTLEMENT_MISMATCH_DETECTED',



    SETTLEMENT_FAILED:

        'SETTLEMENT_FAILED',



    SETTLEMENT_COMPLETED:

        'SETTLEMENT_COMPLETED'



});








/**
 * =============================================================================
 * Ledger Integration Events
 * =============================================================================
 */


const LEDGER_EVENTS = Object.freeze({



    PAYMENT_LEDGER_POSTING_STARTED:

        'PAYMENT_LEDGER_POSTING_STARTED',



    PAYMENT_LEDGER_POSTED:

        'PAYMENT_LEDGER_POSTED',



    PAYMENT_LEDGER_POSTING_FAILED:

        'PAYMENT_LEDGER_POSTING_FAILED',



    PAYMENT_REVERSAL_CREATED:

        'PAYMENT_REVERSAL_CREATED'



});








/**
 * =============================================================================
 * Security Events
 * =============================================================================
 */


const SECURITY_EVENTS = Object.freeze({



    PAYMENT_SIGNATURE_VERIFICATION_FAILED:

        'PAYMENT_SIGNATURE_VERIFICATION_FAILED',



    PAYMENT_FRAUD_DETECTED:

        'PAYMENT_FRAUD_DETECTED',



    PAYMENT_BENEFICIARY_BLOCKED:

        'PAYMENT_BENEFICIARY_BLOCKED',



    PAYMENT_IDENTITY_VALIDATION_FAILED:

        'PAYMENT_IDENTITY_VALIDATION_FAILED'



});








/**
 * =============================================================================
 * Reliability Events
 * =============================================================================
 */


const RELIABILITY_EVENTS = Object.freeze({



    PAYMENT_RETRY_STARTED:

        'PAYMENT_RETRY_STARTED',



    PAYMENT_RETRY_COMPLETED:

        'PAYMENT_RETRY_COMPLETED',



    PAYMENT_RETRY_FAILED:

        'PAYMENT_RETRY_FAILED',



    PAYMENT_DLQ_CREATED:

        'PAYMENT_DLQ_CREATED',



    PAYMENT_DLQ_REPLAY_STARTED:

        'PAYMENT_DLQ_REPLAY_STARTED',



    PAYMENT_DLQ_RESOLVED:

        'PAYMENT_DLQ_RESOLVED'



});








/**
 * =============================================================================
 * Event Categories
 * =============================================================================
 */


const EVENT_CATEGORIES = Object.freeze({



    PAYMENT:

        'PAYMENT',



    COLLECTION:

        'COLLECTION',



    DISBURSEMENT:

        'DISBURSEMENT',



    CALLBACK:

        'CALLBACK',



    SETTLEMENT:

        'SETTLEMENT',



    LEDGER:

        'LEDGER',



    SECURITY:

        'SECURITY',



    RELIABILITY:

        'RELIABILITY'



});








/**
 * =============================================================================
 * Export
 * =============================================================================
 */


module.exports = Object.freeze({


    PAYMENT_EVENTS,


    MTN_PAYMENT_EVENTS,


    SETTLEMENT_EVENTS,


    LEDGER_EVENTS,


    SECURITY_EVENTS,


    RELIABILITY_EVENTS,


    EVENT_CATEGORIES


});