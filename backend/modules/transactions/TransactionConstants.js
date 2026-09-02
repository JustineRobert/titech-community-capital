'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Constants
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionConstants.js
 *
 * Purpose
 * -------
 * Central immutable transaction-domain configuration and policy constants.
 *
 * Provides:
 *   • Transaction lifecycle states
 *   • Distributed saga states
 *   • Transaction types
 *   • Transaction sources
 *   • Processing priority
 *   • Lifecycle transition policy
 *   • Retry policy
 *   • Timeout policy
 *   • Distributed lock policy
 *   • Idempotency policy
 *   • Compensation policy
 *   • Recovery policy
 *   • Audit actions/events
 *   • Financial boundaries
 *   • Error codes
 *   • Provider identifiers
 *
 * Design Principles
 * -----------------
 * • No secrets
 * • No network calls
 * • No mutable exported state
 * • Environment overrides belong in configuration/services, not constants
 * • Financial values should not be represented by floating-point arithmetic
 * • Constants describe policy; services enforce policy
 *
 * ============================================================================
 */


/**
 * ============================================================================
 * Deep Freeze
 * ============================================================================
 *
 * Object.freeze() is shallow. This helper protects nested arrays/objects such
 * as transition maps and retry state lists.
 * ============================================================================
 */

function deepFreeze(
    value,
    seen = new WeakSet()
) {

    if (
        !value ||
        typeof value !== 'object'
    ) {
        return value;
    }

    if (
        seen.has(value)
    ) {
        return value;
    }

    seen.add(value);

    for (
        const key
        of Reflect.ownKeys(value)
    ) {

        deepFreeze(
            value[key],
            seen
        );

    }

    return Object.freeze(
        value
    );
}


/**
 * ============================================================================
 * Transaction Lifecycle States
 * ============================================================================
 */

const TransactionStates = deepFreeze({

    /**
     * Initial lifecycle.
     */
    CREATED:
        'CREATED',

    VALIDATING:
        'VALIDATING',

    VALIDATED:
        'VALIDATED',

    /**
     * Awaiting actual execution.
     */
    PENDING:
        'PENDING',

    PROCESSING:
        'PROCESSING',

    AUTHORIZING:
        'AUTHORIZING',

    /**
     * Terminal business states.
     */
    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    CANCELLED:
        'CANCELLED',

    TIMEOUT:
        'TIMEOUT',

    /**
     * Compensation lifecycle.
     */
    ROLLBACK_PENDING:
        'ROLLBACK_PENDING',

    ROLLING_BACK:
        'ROLLING_BACK',

    ROLLED_BACK:
        'ROLLED_BACK',

    COMPENSATING:
        'COMPENSATING',

    COMPENSATED:
        'COMPENSATED',

    /**
     * Crash/recovery lifecycle.
     */
    RECOVERING:
        'RECOVERING'

});


/**
 * ============================================================================
 * Terminal Transaction States
 * ============================================================================
 */

const TerminalTransactionStates = deepFreeze([

    TransactionStates.COMPLETED,

    TransactionStates.CANCELLED,

    TransactionStates.ROLLED_BACK,

    TransactionStates.COMPENSATED

]);


/**
 * ============================================================================
 * Recoverable Transaction States
 * ============================================================================
 */

const RecoverableTransactionStates = deepFreeze([

    TransactionStates.FAILED,

    TransactionStates.TIMEOUT,

    TransactionStates.RECOVERING,

    TransactionStates.ROLLBACK_PENDING,

    TransactionStates.ROLLING_BACK,

    TransactionStates.COMPENSATING

]);


/**
 * ============================================================================
 * Failure States
 * ============================================================================
 */

const FailureTransactionStates = deepFreeze([

    TransactionStates.FAILED,

    TransactionStates.TIMEOUT

]);


/**
 * ============================================================================
 * Compensation States
 * ============================================================================
 */

const CompensationTransactionStates = deepFreeze([

    TransactionStates.ROLLBACK_PENDING,

    TransactionStates.ROLLING_BACK,

    TransactionStates.COMPENSATING,

    TransactionStates.ROLLED_BACK,

    TransactionStates.COMPENSATED

]);


/**
 * ============================================================================
 * Allowed State Transitions
 * ============================================================================
 *
 * State changes should only travel forward through the defined lifecycle.
 *
 * Reversal is a NEW financial operation, not an edit to historical state.
 * ============================================================================
 */

const TransactionTransitions = deepFreeze({

    [TransactionStates.CREATED]: [

        TransactionStates.VALIDATING,

        TransactionStates.CANCELLED,

        TransactionStates.FAILED

    ],

    [TransactionStates.VALIDATING]: [

        TransactionStates.VALIDATED,

        TransactionStates.FAILED

    ],

    [TransactionStates.VALIDATED]: [

        TransactionStates.PENDING,

        TransactionStates.FAILED,

        TransactionStates.CANCELLED

    ],

    [TransactionStates.PENDING]: [

        TransactionStates.PROCESSING,

        TransactionStates.AUTHORIZING,

        TransactionStates.CANCELLED,

        TransactionStates.TIMEOUT

    ],

    [TransactionStates.AUTHORIZING]: [

        TransactionStates.PROCESSING,

        TransactionStates.COMPLETED,

        TransactionStates.FAILED,

        TransactionStates.TIMEOUT,

        TransactionStates.ROLLBACK_PENDING

    ],

    [TransactionStates.PROCESSING]: [

        TransactionStates.COMPLETED,

        TransactionStates.FAILED,

        TransactionStates.TIMEOUT,

        TransactionStates.ROLLBACK_PENDING

    ],

    [TransactionStates.COMPLETED]: [],

    [TransactionStates.CANCELLED]: [],

    [TransactionStates.FAILED]: [

        TransactionStates.RECOVERING,

        TransactionStates.ROLLBACK_PENDING

    ],

    [TransactionStates.TIMEOUT]: [

        TransactionStates.RECOVERING,

        TransactionStates.ROLLBACK_PENDING

    ],

    [TransactionStates.RECOVERING]: [

        TransactionStates.PROCESSING,

        TransactionStates.AUTHORIZING,

        TransactionStates.COMPLETED,

        TransactionStates.FAILED,

        TransactionStates.TIMEOUT,

        TransactionStates.ROLLBACK_PENDING

    ],

    [TransactionStates.ROLLBACK_PENDING]: [

        TransactionStates.ROLLING_BACK,

        TransactionStates.COMPENSATING

    ],

    [TransactionStates.ROLLING_BACK]: [

        TransactionStates.ROLLED_BACK,

        TransactionStates.COMPENSATING

    ],

    [TransactionStates.COMPENSATING]: [

        TransactionStates.COMPENSATED,

        TransactionStates.ROLLED_BACK,

        TransactionStates.FAILED

    ],

    [TransactionStates.ROLLED_BACK]: [],

    [TransactionStates.COMPENSATED]: []

});


/**
 * ============================================================================
 * Distributed Saga States
 * ============================================================================
 *
 * Kept separate from business transaction lifecycle states.
 *
 * A distributed saga coordinates external operations; it is not itself the
 * accounting record.
 * ============================================================================
 */

const DistributedTransactionStates = deepFreeze({

    CREATED:
        'CREATED',

    RUNNING:
        'RUNNING',

    COMMITTED:
        'COMMITTED',

    ROLLING_BACK:
        'ROLLING_BACK',

    ROLLED_BACK:
        'ROLLED_BACK',

    COMPENSATION_FAILED:
        'COMPENSATION_FAILED',

    FAILED:
        'FAILED',

    ABORTED:
        'ABORTED'

});


/**
 * ============================================================================
 * Distributed Operation States
 * ============================================================================
 */

const DistributedOperationStates = deepFreeze({

    PENDING:
        'PENDING',

    RUNNING:
        'RUNNING',

    COMPLETED:
        'COMPLETED',

    FAILED:
        'FAILED',

    COMPENSATING:
        'COMPENSATING',

    COMPENSATED:
        'COMPENSATED',

    COMPENSATION_FAILED:
        'COMPENSATION_FAILED'

});


/**
 * ============================================================================
 * Transaction Types
 * ============================================================================
 */

const TransactionTypes = deepFreeze({

    DEPOSIT:
        'DEPOSIT',

    WITHDRAWAL:
        'WITHDRAWAL',

    TRANSFER:
        'TRANSFER',

    PAYMENT:
        'PAYMENT',

    LOAN_DISBURSEMENT:
        'LOAN_DISBURSEMENT',

    LOAN_REPAYMENT:
        'LOAN_REPAYMENT',

    SAVINGS_CONTRIBUTION:
        'SAVINGS_CONTRIBUTION',

    INTEREST_ACCRUAL:
        'INTEREST_ACCRUAL',

    FEE_CHARGE:
        'FEE_CHARGE',

    REFUND:
        'REFUND',

    REVERSAL:
        'REVERSAL',

    ADJUSTMENT:
        'ADJUSTMENT',

    SETTLEMENT:
        'SETTLEMENT',

    CHARGEBACK:
        'CHARGEBACK',

    WRITE_OFF:
        'WRITE_OFF',

    DISBURSEMENT_REVERSAL:
        'DISBURSEMENT_REVERSAL',

    REPAYMENT_REVERSAL:
        'REPAYMENT_REVERSAL'

});


/**
 * ============================================================================
 * Transaction Sources
 * ============================================================================
 */

const TransactionSources = deepFreeze({

    API:
        'API',

    MOBILE_APP:
        'MOBILE_APP',

    WEB:
        'WEB',

    ADMIN_PORTAL:
        'ADMIN_PORTAL',

    MTN_MOMO:
        'MTN_MOMO',

    AIRTEL_MONEY:
        'AIRTEL_MONEY',

    BANK:
        'BANK',

    CARD:
        'CARD',

    PAYMENT_GATEWAY:
        'PAYMENT_GATEWAY',

    SYSTEM:
        'SYSTEM',

    JOB:
        'JOB',

    SCHEDULED_JOB:
        'SCHEDULED_JOB',

    WEBHOOK:
        'WEBHOOK',

    INTERNAL:
        'INTERNAL'

});


/**
 * ============================================================================
 * Provider Identifiers
 * ============================================================================
 */

const TransactionProviders = deepFreeze({

    MTN:
        'MTN',

    MTN_MOMO:
        'MTN_MOMO',

    AIRTEL:
        'AIRTEL',

    AIRTEL_MONEY:
        'AIRTEL_MONEY',

    BANK:
        'BANK',

    STRIPE:
        'STRIPE',

    FLUTTERWAVE:
        'FLUTTERWAVE',

    PESAPAL:
        'PESAPAL',

    INTERNAL:
        'INTERNAL'

});


/**
 * ============================================================================
 * Processing Priority
 * ============================================================================
 */

const TransactionPriority = deepFreeze({

    LOW:
        1,

    NORMAL:
        5,

    HIGH:
        8,

    CRITICAL:
        10

});


/**
 * ============================================================================
 * Priority Names
 * ============================================================================
 */

const TransactionPriorityNames = deepFreeze({

    [TransactionPriority.LOW]:
        'LOW',

    [TransactionPriority.NORMAL]:
        'NORMAL',

    [TransactionPriority.HIGH]:
        'HIGH',

    [TransactionPriority.CRITICAL]:
        'CRITICAL'

});


/**
 * ============================================================================
 * Retry Configuration
 * ============================================================================
 */

const RetryConstants = deepFreeze({

    DEFAULT_ATTEMPTS:
        5,

    DEFAULT_MAX_ATTEMPTS:
        5,

    INITIAL_DELAY_MS:
        1000,

    MAX_DELAY_MS:
        60000,

    BACKOFF_FACTOR:
        2,

    JITTER:
        true,

    JITTER_RATIO:
        0.25,

    RETRYABLE_STATES:
        [

            TransactionStates.FAILED,

            TransactionStates.TIMEOUT

        ],

    RETRYABLE_HTTP_STATUS_CODES:
        [

            408,

            409,

            425,

            429,

            500,

            502,

            503,

            504

        ],

    NON_RETRYABLE_HTTP_STATUS_CODES:
        [

            400,

            401,

            403,

            404,

            405,

            409

        ],

    RETRYABLE_ERROR_CODES:
        [

            'ETIMEDOUT',

            'ECONNRESET',

            'ECONNREFUSED',

            'ECONNABORTED',

            'EAI_AGAIN',

            'ENETUNREACH',

            'EHOSTUNREACH',

            'NETWORK_ERROR',

            'TIMEOUT',

            'PROVIDER_UNAVAILABLE',

            'SERVICE_UNAVAILABLE'

        ]

});


/**
 * ============================================================================
 * Timeout Configuration
 * ============================================================================
 */

const TimeoutConstants = deepFreeze({

    DEFAULT_TRANSACTION_TIMEOUT_MS:
        30000,

    PAYMENT_TIMEOUT_MS:
        60000,

    PROVIDER_TIMEOUT_MS:
        60000,

    LEDGER_TIMEOUT_MS:
        10000,

    DATABASE_TIMEOUT_MS:
        10000,

    LOCK_TIMEOUT_MS:
        15000,

    COMPENSATION_TIMEOUT_MS:
        60000,

    RECOVERY_TIMEOUT_MS:
        60000,

    HEARTBEAT_INTERVAL_MS:
        10000,

    LEASE_TTL_MS:
        30000

});


/**
 * ============================================================================
 * Lock Configuration
 * ============================================================================
 */

const LockConstants = deepFreeze({

    DEFAULT_TTL_MS:
        30000,

    RETRY_INTERVAL_MS:
        250,

    MAX_RETRIES:
        20,

    ACQUIRE_TIMEOUT_MS:
        15000,

    PREFIX:
        'transaction:lock',

    OWNER_PREFIX:
        'transaction:lock:owner'

});


/**
 * ============================================================================
 * Idempotency Configuration
 * ============================================================================
 */

const IdempotencyConstants = deepFreeze({

    KEY_PREFIX:
        'transaction:idempotency',

    DEFAULT_TTL_SECONDS:
        86400,

    LOCK_TTL_SECONDS:
        300,

    STATUS_PROCESSING:
        'PROCESSING',

    STATUS_COMPLETED:
        'COMPLETED',

    STATUS_FAILED:
        'FAILED',

    STATUS_EXPIRED:
        'EXPIRED',

    MAX_KEY_LENGTH:
        512

});


/**
 * ============================================================================
 * Compensation Constants
 * ============================================================================
 */

const CompensationConstants = deepFreeze({

    STATES: {

        PENDING:
            'PENDING',

        EXECUTING:
            'EXECUTING',

        COMPLETED:
            'COMPLETED',

        FAILED:
            'FAILED',

        SKIPPED:
            'SKIPPED'

    },

    MAX_ATTEMPTS:
        5,

    INITIAL_DELAY_MS:
        500,

    MAX_DELAY_MS:
        10000,

    BACKOFF_FACTOR:
        2,

    JITTER:
        true

});


/**
 * ============================================================================
 * Recovery Constants
 * ============================================================================
 */

const RecoveryConstants = deepFreeze({

    MAX_RECOVERY_ATTEMPTS:
        10,

    DEFAULT_RECOVERY_DELAY_MS:
        5000,

    BATCH_SIZE:
        50,

    WORKER_LEASE_MS:
        30000,

    HEARTBEAT_INTERVAL_MS:
        10000,

    MAX_OPERATION_HISTORY:
        500,

    ACTIVE_RECOVERY_STATES:
        [

            DistributedTransactionStates.CREATED,

            DistributedTransactionStates.RUNNING,

            DistributedTransactionStates.ROLLING_BACK,

            DistributedTransactionStates.COMPENSATION_FAILED

        ],

    RECOVERABLE_STATES:
        [

            DistributedTransactionStates.RUNNING,

            DistributedTransactionStates.ROLLING_BACK,

            DistributedTransactionStates.COMPENSATION_FAILED

        ],

    TERMINAL_STATES:
        [

            DistributedTransactionStates.COMMITTED,

            DistributedTransactionStates.ROLLED_BACK,

            DistributedTransactionStates.FAILED,

            DistributedTransactionStates.ABORTED

        ]

});


/**
 * ============================================================================
 * Audit Actions
 * ============================================================================
 */

const TransactionAuditActions = deepFreeze({

    CREATED:
        'TRANSACTION_CREATED',

    VALIDATED:
        'TRANSACTION_VALIDATED',

    STARTED:
        'TRANSACTION_STARTED',

    PROCESSING:
        'TRANSACTION_PROCESSING',

    AUTHORIZING:
        'TRANSACTION_AUTHORIZING',

    COMPLETED:
        'TRANSACTION_COMPLETED',

    FAILED:
        'TRANSACTION_FAILED',

    TIMEOUT:
        'TRANSACTION_TIMEOUT',

    CANCELLED:
        'TRANSACTION_CANCELLED',

    ROLLBACK_STARTED:
        'TRANSACTION_ROLLBACK_STARTED',

    ROLLBACK:
        'TRANSACTION_ROLLBACK',

    ROLLBACK_COMPLETED:
        'TRANSACTION_ROLLBACK_COMPLETED',

    ROLLBACK_FAILED:
        'TRANSACTION_ROLLBACK_FAILED',

    COMPENSATION_STARTED:
        'TRANSACTION_COMPENSATION_STARTED',

    COMPENSATION:
        'TRANSACTION_COMPENSATION',

    COMPENSATION_COMPLETED:
        'TRANSACTION_COMPENSATION_COMPLETED',

    COMPENSATION_FAILED:
        'TRANSACTION_COMPENSATION_FAILED',

    RECOVERY_STARTED:
        'TRANSACTION_RECOVERY_STARTED',

    RECOVERY:
        'TRANSACTION_RECOVERY',

    RECOVERY_COMPLETED:
        'TRANSACTION_RECOVERY_COMPLETED',

    IDEMPOTENCY_HIT:
        'TRANSACTION_IDEMPOTENCY_HIT',

    IDEMPOTENCY_CONFLICT:
        'TRANSACTION_IDEMPOTENCY_CONFLICT',

    LOCK_ACQUIRED:
        'TRANSACTION_LOCK_ACQUIRED',

    LOCK_RELEASED:
        'TRANSACTION_LOCK_RELEASED',

    LOCK_CONFLICT:
        'TRANSACTION_LOCK_CONFLICT'

});


/**
 * ============================================================================
 * Distributed Transaction Audit Events
 * ============================================================================
 */

const DistributedTransactionAuditActions = deepFreeze({

    CREATED:
        'DISTRIBUTED_TRANSACTION_CREATED',

    STARTED:
        'DISTRIBUTED_TRANSACTION_STARTED',

    COMMITTED:
        'DISTRIBUTED_TRANSACTION_COMMITTED',

    FAILED:
        'DISTRIBUTED_TRANSACTION_FAILED',

    ROLLBACK_STARTED:
        'DISTRIBUTED_TRANSACTION_ROLLBACK_STARTED',

    ROLLED_BACK:
        'DISTRIBUTED_TRANSACTION_ROLLED_BACK',

    COMPENSATION_FAILED:
        'DISTRIBUTED_TRANSACTION_COMPENSATION_FAILED',

    RECOVERY_CLAIMED:
        'DISTRIBUTED_TRANSACTION_RECOVERY_CLAIMED',

    RECOVERY_COMPLETED:
        'DISTRIBUTED_TRANSACTION_RECOVERY_COMPLETED',

    RECOVERY_FAILED:
        'DISTRIBUTED_TRANSACTION_RECOVERY_FAILED',

    OPERATION_STARTED:
        'DISTRIBUTED_TRANSACTION_OPERATION_STARTED',

    OPERATION_COMPLETED:
        'DISTRIBUTED_TRANSACTION_OPERATION_COMPLETED',

    OPERATION_FAILED:
        'DISTRIBUTED_TRANSACTION_OPERATION_FAILED',

    COMPENSATION_COMPLETED:
        'DISTRIBUTED_TRANSACTION_COMPENSATION_COMPLETED'

});


/**
 * ============================================================================
 * Financial Precision
 * ============================================================================
 *
 * IMPORTANT:
 *
 * These boundaries are represented as strings so consumers can convert them
 * into Decimal128/BigInt/decimal.js without passing through JavaScript Number.
 * ============================================================================
 */

const FinancialConstants = deepFreeze({

    DEFAULT_CURRENCY:
        'UGX',

    DECIMAL_PLACES:
        2,

    MIN_TRANSACTION_AMOUNT:
        '0.01',

    MAX_TRANSACTION_AMOUNT:
        '1000000000.00',

    ZERO_AMOUNT:
        '0',

    /**
     * Monetary values should be persisted as Decimal128.
     */
    STORAGE_TYPE:
        'Decimal128',

    /**
     * API serialization convention.
     */
    SERIALIZATION_TYPE:
        'string'

});


/**
 * ============================================================================
 * Currency Rules
 * ============================================================================
 */

const CurrencyConstants = deepFreeze({

    DEFAULT:
        'UGX',

    ISO_CODE_LENGTH:
        3,

    ALLOWED_EXAMPLES:
        [

            'UGX',

            'USD',

            'KES',

            'TZS',

            'RWF',

            'NGN',

            'ZMW'

        ]

});


/**
 * ============================================================================
 * Audit Severity
 * ============================================================================
 */

const AuditSeverity = deepFreeze({

    INFO:
        'INFO',

    WARNING:
        'WARNING',

    CRITICAL:
        'CRITICAL',

    SECURITY:
        'SECURITY',

    FINANCIAL:
        'FINANCIAL'

});


/**
 * ============================================================================
 * Idempotency Lifecycle
 * ============================================================================
 */

const IdempotencyStates = deepFreeze({

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
 * ============================================================================
 * Lock Lifecycle
 * ============================================================================
 */

const LockStates = deepFreeze({

    AVAILABLE:
        'AVAILABLE',

    ACQUIRED:
        'ACQUIRED',

    BUSY:
        'BUSY',

    EXPIRED:
        'EXPIRED',

    RELEASED:
        'RELEASED'

});


/**
 * ============================================================================
 * Transaction Error Codes
 * ============================================================================
 */

const TransactionErrorCodes = deepFreeze({

    INVALID_TRANSACTION:
        'TRANSACTION_INVALID',

    INVALID_STATE:
        'TRANSACTION_INVALID_STATE',

    INVALID_TRANSITION:
        'TRANSACTION_INVALID_TRANSITION',

    INVALID_AMOUNT:
        'TRANSACTION_INVALID_AMOUNT',

    INVALID_CURRENCY:
        'TRANSACTION_INVALID_CURRENCY',

    TENANT_REQUIRED:
        'TRANSACTION_TENANT_REQUIRED',

    TRANSACTION_ID_REQUIRED:
        'TRANSACTION_ID_REQUIRED',

    IDEMPOTENCY_KEY_REQUIRED:
        'TRANSACTION_IDEMPOTENCY_KEY_REQUIRED',

    IDEMPOTENCY_CONFLICT:
        'TRANSACTION_IDEMPOTENCY_CONFLICT',

    DUPLICATE_TRANSACTION:
        'TRANSACTION_DUPLICATE',

    LOCK_ACQUISITION_FAILED:
        'TRANSACTION_LOCK_ACQUISITION_FAILED',

    LOCK_TIMEOUT:
        'TRANSACTION_LOCK_TIMEOUT',

    OPERATION_TIMEOUT:
        'TRANSACTION_OPERATION_TIMEOUT',

    TRANSACTION_TIMEOUT:
        'TRANSACTION_TIMEOUT',

    RETRY_EXHAUSTED:
        'TRANSACTION_RETRY_EXHAUSTED',

    PROVIDER_UNAVAILABLE:
        'TRANSACTION_PROVIDER_UNAVAILABLE',

    LEDGER_FAILURE:
        'TRANSACTION_LEDGER_FAILURE',

    PERSISTENCE_FAILURE:
        'TRANSACTION_PERSISTENCE_FAILURE',

    RECOVERY_FAILED:
        'TRANSACTION_RECOVERY_FAILED',

    COMPENSATION_FAILED:
        'TRANSACTION_COMPENSATION_FAILED',

    COMPENSATION_INCOMPLETE:
        'TRANSACTION_COMPENSATION_INCOMPLETE',

    VERSION_CONFLICT:
        'TRANSACTION_VERSION_CONFLICT',

    ALREADY_COMPLETED:
        'TRANSACTION_ALREADY_COMPLETED',

    ALREADY_ROLLED_BACK:
        'TRANSACTION_ALREADY_ROLLED_BACK'

});


/**
 * ============================================================================
 * Operation Names
 * ============================================================================
 */

const TransactionOperations = deepFreeze({

    VALIDATION:
        'VALIDATION',

    AUTHORIZATION:
        'AUTHORIZATION',

    LEDGER_POSTING:
        'LEDGER_POSTING',

    WALLET_DEBIT:
        'WALLET_DEBIT',

    WALLET_CREDIT:
        'WALLET_CREDIT',

    COLLECTION:
        'COLLECTION',

    DISBURSEMENT:
        'DISBURSEMENT',

    SETTLEMENT:
        'SETTLEMENT',

    RECONCILIATION:
        'RECONCILIATION',

    NOTIFICATION:
        'NOTIFICATION',

    PROVIDER_CALLBACK:
        'PROVIDER_CALLBACK',

    AUDIT:
        'AUDIT'

});


/**
 * ============================================================================
 * Helper Functions
 * ============================================================================
 */

/**
 * Determine whether a state is terminal.
 */
function isTerminalState(
    state
) {

    return TerminalTransactionStates.includes(
        state
    );

}


/**
 * Determine whether a state is recoverable.
 */
function isRecoverableState(
    state
) {

    return RecoverableTransactionStates.includes(
        state
    );

}


/**
 * Determine whether a state is a failure state.
 */
function isFailureState(
    state
) {

    return FailureTransactionStates.includes(
        state
    );

}


/**
 * Determine whether a transition is allowed.
 */
function canTransition(
    from,
    to
) {

    if (
        !from ||
        !to
    ) {

        return false;

    }


    if (
        from === to
    ) {

        return true;

    }


    const allowed =
        TransactionTransitions[from];


    if (
        !Array.isArray(
            allowed
        )
    ) {

        return false;

    }


    return allowed.includes(
        to
    );

}


/**
 * Assert transition.
 */
function assertTransition(
    from,
    to
) {

    if (
        canTransition(
            from,
            to
        )
    ) {

        return true;

    }


    const error =
        new Error(

            `Invalid transaction transition: ${from} -> ${to}`

        );


    error.code =
        TransactionErrorCodes.INVALID_TRANSITION;


    error.from =
        from;


    error.to =
        to;


    throw error;

}


/**
 * ============================================================================
 * Public Export
 * ============================================================================
 */

module.exports = {

    /**
     * Lifecycle
     */
    TransactionStates,

    TransactionTransitions,

    TerminalTransactionStates,

    RecoverableTransactionStates,

    FailureTransactionStates,

    CompensationTransactionStates,

    /**
     * Distributed saga
     */
    DistributedTransactionStates,

    DistributedOperationStates,

    /**
     * Domain
     */
    TransactionTypes,

    TransactionSources,

    TransactionProviders,

    TransactionOperations,

    /**
     * Priority
     */
    TransactionPriority,

    TransactionPriorityNames,

    /**
     * Policies
     */
    RetryConstants,

    TimeoutConstants,

    LockConstants,

    IdempotencyConstants,

    CompensationConstants,

    RecoveryConstants,

    /**
     * Audit
     */
    TransactionAuditActions,

    DistributedTransactionAuditActions,

    AuditSeverity,

    /**
     * Financial
     */
    FinancialConstants,

    CurrencyConstants,

    /**
     * Runtime state
     */
    IdempotencyStates,

    LockStates,

    /**
     * Errors
     */
    TransactionErrorCodes,

    /**
     * Helpers
     */
    isTerminalState,

    isRecoverableState,

    isFailureState,

    canTransition,

    assertTransition

};