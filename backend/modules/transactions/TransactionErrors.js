'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Errors
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionErrors.js
 *
 * Purpose
 * -------
 * Central transaction error framework for financial workflow orchestration.
 *
 * Responsibilities
 * ----------------
 * • Standard error codes
 * • Financial error classification
 * • Severity classification
 * • Retry decisions
 * • Compensation decisions
 * • Provider error normalization
 * • HTTP/API-safe serialization
 * • Tenant/transaction correlation
 * • Error causality
 * • Safe metadata redaction
 * • Operational diagnostics
 *
 * Security
 * --------
 * Error objects must never expose:
 *
 * • client secrets
 * • access tokens
 * • refresh tokens
 * • passwords
 * • authorization headers
 * • private keys
 * • complete provider credentials
 *
 * ============================================================================
 */


const crypto = require('crypto');


/**
 * ============================================================================
 * Optional Domain Constants
 * ============================================================================
 */

let DomainConstants = null;

try {
    // eslint-disable-next-line global-require
    DomainConstants = require('./TransactionConstants');
}
catch (_) {
    DomainConstants = null;
}


/**
 * ============================================================================
 * Error Codes
 * ============================================================================
 */

const TransactionErrorCodes = Object.freeze({

    /**
     * Validation
     */
    VALIDATION_FAILED:
        'TX_VALIDATION_FAILED',

    INVALID_AMOUNT:
        'TX_INVALID_AMOUNT',

    INVALID_CURRENCY:
        'TX_INVALID_CURRENCY',

    INVALID_ACCOUNT:
        'TX_INVALID_ACCOUNT',

    INVALID_TRANSACTION_TYPE:
        'TX_INVALID_TRANSACTION_TYPE',

    TENANT_REQUIRED:
        'TX_TENANT_REQUIRED',

    TRANSACTION_ID_REQUIRED:
        'TX_TRANSACTION_ID_REQUIRED',

    IDEMPOTENCY_KEY_REQUIRED:
        'TX_IDEMPOTENCY_KEY_REQUIRED',

    /**
     * Idempotency
     */
    DUPLICATE_TRANSACTION:
        'TX_DUPLICATE_TRANSACTION',

    IDEMPOTENCY_CONFLICT:
        'TX_IDEMPOTENCY_CONFLICT',

    IDEMPOTENCY_IN_PROGRESS:
        'TX_IDEMPOTENCY_IN_PROGRESS',

    /**
     * State
     */
    INVALID_STATE:
        'TX_INVALID_STATE',

    INVALID_TRANSITION:
        'TX_INVALID_TRANSITION',

    ALREADY_COMPLETED:
        'TX_ALREADY_COMPLETED',

    ALREADY_ROLLED_BACK:
        'TX_ALREADY_ROLLED_BACK',

    /**
     * Concurrency / locking
     */
    LOCK_FAILED:
        'TX_LOCK_FAILED',

    LOCK_TIMEOUT:
        'TX_LOCK_TIMEOUT',

    LOCK_CONFLICT:
        'TX_LOCK_CONFLICT',

    VERSION_CONFLICT:
        'TX_VERSION_CONFLICT',

    /**
     * Execution
     */
    EXECUTION_FAILED:
        'TX_EXECUTION_FAILED',

    TIMEOUT:
        'TX_TIMEOUT',

    SERVICE_UNAVAILABLE:
        'TX_SERVICE_UNAVAILABLE',

    RETRY_EXHAUSTED:
        'TX_RETRY_EXHAUSTED',

    /**
     * Persistence
     */
    PERSISTENCE_FAILED:
        'TX_PERSISTENCE_FAILED',

    DATABASE_ERROR:
        'TX_DATABASE_ERROR',

    /**
     * Ledger
     */
    LEDGER_POST_FAILED:
        'TX_LEDGER_POST_FAILED',

    LEDGER_BALANCE_ERROR:
        'TX_LEDGER_BALANCE_ERROR',

    LEDGER_REVERSAL_FAILED:
        'TX_LEDGER_REVERSAL_FAILED',

    LEDGER_INTEGRITY_ERROR:
        'TX_LEDGER_INTEGRITY_ERROR',

    /**
     * Payment
     */
    PAYMENT_FAILED:
        'TX_PAYMENT_FAILED',

    PAYMENT_TIMEOUT:
        'TX_PAYMENT_TIMEOUT',

    PAYMENT_PROVIDER_ERROR:
        'TX_PAYMENT_PROVIDER_ERROR',

    PAYMENT_PROVIDER_UNAVAILABLE:
        'TX_PAYMENT_PROVIDER_UNAVAILABLE',

    PAYMENT_PROVIDER_REJECTED:
        'TX_PAYMENT_PROVIDER_REJECTED',

    PAYMENT_DUPLICATE:
        'TX_PAYMENT_DUPLICATE',

    /**
     * Settlement
     */
    SETTLEMENT_FAILED:
        'TX_SETTLEMENT_FAILED',

    SETTLEMENT_MISMATCH:
        'TX_SETTLEMENT_MISMATCH',

    SETTLEMENT_TIMEOUT:
        'TX_SETTLEMENT_TIMEOUT',

    /**
     * Recovery
     */
    RECOVERY_FAILED:
        'TX_RECOVERY_FAILED',

    ROLLBACK_FAILED:
        'TX_ROLLBACK_FAILED',

    COMPENSATION_FAILED:
        'TX_COMPENSATION_FAILED',

    COMPENSATION_INCOMPLETE:
        'TX_COMPENSATION_INCOMPLETE',

    RECOVERY_MAX_ATTEMPTS:
        'TX_RECOVERY_MAX_ATTEMPTS',

    /**
     * Security
     */
    UNAUTHORIZED:
        'TX_UNAUTHORIZED',

    FORBIDDEN:
        'TX_FORBIDDEN',

    SECURITY_VIOLATION:
        'TX_SECURITY_VIOLATION',

    /**
     * External dependency
     */
    PROVIDER_UNAVAILABLE:
        'TX_PROVIDER_UNAVAILABLE',

    NETWORK_ERROR:
        'TX_NETWORK_ERROR',

    EXTERNAL_SERVICE_ERROR:
        'TX_EXTERNAL_SERVICE_ERROR',

    /**
     * Unknown
     */
    UNKNOWN:
        'TX_UNKNOWN_ERROR'

});


/**
 * ============================================================================
 * Error Severity
 * ============================================================================
 */

const TransactionErrorSeverity = Object.freeze({

    LOW:
        'LOW',

    MEDIUM:
        'MEDIUM',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});


/**
 * ============================================================================
 * Error Categories
 * ============================================================================
 */

const TransactionErrorCategory = Object.freeze({

    VALIDATION:
        'VALIDATION',

    AUTHORIZATION:
        'AUTHORIZATION',

    IDEMPOTENCY:
        'IDEMPOTENCY',

    CONCURRENCY:
        'CONCURRENCY',

    EXECUTION:
        'EXECUTION',

    TIMEOUT:
        'TIMEOUT',

    LEDGER:
        'LEDGER',

    PAYMENT:
        'PAYMENT',

    SETTLEMENT:
        'SETTLEMENT',

    RECOVERY:
        'RECOVERY',

    COMPENSATION:
        'COMPENSATION',

    PERSISTENCE:
        'PERSISTENCE',

    PROVIDER:
        'PROVIDER',

    NETWORK:
        'NETWORK',

    SECURITY:
        'SECURITY',

    UNKNOWN:
        'UNKNOWN'

});


/**
 * ============================================================================
 * Sensitive Fields
 * ============================================================================
 */

const SENSITIVE_FIELDS = new Set([

    'password',
    'passwd',

    'secret',

    'clientSecret',
    'client_secret',

    'accessToken',
    'access_token',

    'refreshToken',
    'refresh_token',

    'authorization',
    'Authorization',

    'apiKey',
    'api_key',

    'privateKey',
    'private_key',

    'token',

    'credential',
    'credentials',

    'cookie',
    'set-cookie'

]);


/**
 * ============================================================================
 * Safe Metadata Redaction
 * ============================================================================
 */

function redactMetadata(
    value,
    depth = 0,
    maxDepth = 8
) {

    if (
        depth > maxDepth
    ) {
        return '[MAX_DEPTH]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return new Date(value.getTime());
    }

    if (
        typeof value === 'string'
    ) {
        return value.slice(0, 5000);
    }

    if (
        typeof value !== 'object'
    ) {
        return value;
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            item =>
                redactMetadata(
                    item,
                    depth + 1,
                    maxDepth
                )
        );
    }

    const output = {};

    for (
        const [key, nestedValue]
        of Object.entries(value)
    ) {

        if (
            SENSITIVE_FIELDS.has(key)
        ) {
            output[key] = '[REDACTED]';
            continue;
        }

        output[key] =
            redactMetadata(
                nestedValue,
                depth + 1,
                maxDepth
            );
    }

    return output;
}


/**
 * ============================================================================
 * Base Transaction Error
 * ============================================================================
 */

class TransactionError extends Error {

    constructor(
        message = 'Transaction error',
        options = {}
    ) {

        super(
            String(message)
        );

        this.name =
            options.name ||
            'TransactionError';

        this.code =
            options.code ||
            TransactionErrorCodes.UNKNOWN;

        this.category =
            options.category ||
            TransactionErrorCategory.UNKNOWN;

        this.statusCode =
            Number.isInteger(
                options.statusCode
            )
                ? options.statusCode
                : 500;

        this.severity =
            options.severity ||
            TransactionErrorSeverity.MEDIUM;

        this.retryable =
            Boolean(
                options.retryable
            );

        this.requiresCompensation =
            Boolean(
                options.requiresCompensation
            );

        this.compensationRequired =
            Boolean(
                options.compensationRequired ??
                options.requiresCompensation
            );

        this.retryAfterMs =
            Number.isFinite(
                Number(options.retryAfterMs)
            )
                ? Number(options.retryAfterMs)
                : null;

        this.provider =
            options.provider ||
            null;

        this.providerCode =
            options.providerCode ||
            null;

        this.providerStatus =
            options.providerStatus ||
            null;

        this.operationId =
            options.operationId ||
            null;

        this.transactionId =
            options.transactionId ||
            null;

        this.correlationId =
            options.correlationId ||
            null;

        this.requestId =
            options.requestId ||
            null;

        this.tenantId =
            options.tenantId ||
            null;

        this.metadata =
            redactMetadata(
                options.metadata ||
                {}
            );

        this.timestamp =
            options.timestamp
                ? new Date(options.timestamp)
                : new Date();

        this.errorId =
            options.errorId ||
            crypto.randomUUID();

        /**
         * Preserve the original error without serializing it directly.
         */
        this.cause =
            options.cause ||
            null;

        Error.captureStackTrace(
            this,
            this.constructor
        );
    }


    /**
     * ========================================================================
     * API-safe serialization
     * ========================================================================
     */

    serialize(
        options = {}
    ) {

        const includeStack =
            options.includeStack === true;

        const includeMetadata =
            options.includeMetadata !== false;

        const includeInternal =
            options.includeInternal === true;

        const result = {

            name:
                this.name,

            code:
                this.code,

            category:
                this.category,

            message:
                this.message,

            severity:
                this.severity,

            retryable:
                this.retryable,

            requiresCompensation:
                this.requiresCompensation,

            compensationRequired:
                this.compensationRequired,

            statusCode:
                this.statusCode,

            retryAfterMs:
                this.retryAfterMs,

            transactionId:
                this.transactionId,

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            tenantId:
                this.tenantId,

            operationId:
                this.operationId,

            provider:
                this.provider,

            providerCode:
                this.providerCode,

            errorId:
                this.errorId,

            timestamp:
                this.timestamp

        };

        if (
            includeMetadata
        ) {

            result.metadata =
                redactMetadata(
                    this.metadata
                );

        }

        if (
            includeStack
        ) {

            result.stack =
                this.stack;

        }

        if (
            includeInternal
        ) {

            result.providerStatus =
                this.providerStatus;

        }

        return result;
    }


    /**
     * ========================================================================
     * toJSON
     * ========================================================================
     */

    toJSON() {

        return this.serialize({
            includeStack:
                false,

            includeMetadata:
                true,

            includeInternal:
                false

        });

    }
}


/**
 * ============================================================================
 * Validation Error
 * ============================================================================
 */

class ValidationError extends TransactionError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                name:
                    'ValidationError',

                code:
                    options.code ||
                    TransactionErrorCodes.VALIDATION_FAILED,

                category:
                    TransactionErrorCategory.VALIDATION,

                statusCode:
                    400,

                severity:
                    options.severity ||
                    TransactionErrorSeverity.MEDIUM,

                retryable:
                    false,

                requiresCompensation:
                    false

            }
        );
    }
}


/**
 * ============================================================================
 * Duplicate Transaction Error
 * ============================================================================
 */

class DuplicateTransactionError extends TransactionError {

    constructor(
        message =
            'Duplicate transaction detected',
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                name:
                    'DuplicateTransactionError',

                code:
                    options.code ||
                    TransactionErrorCodes.DUPLICATE_TRANSACTION,

                category:
                    TransactionErrorCategory.IDEMPOTENCY,

                statusCode:
                    409,

                retryable:
                    false

            }
        );
    }
}


/**
 * ============================================================================
 * Idempotency Conflict Error
 * ============================================================================
 */

class IdempotencyConflictError extends TransactionError {

    constructor(
        message =
            'Idempotency conflict detected',
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                name:
                    'IdempotencyConflictError',

                code:
                    options.code ||
                    TransactionErrorCodes.IDEMPOTENCY_CONFLICT,

                category:
                    TransactionErrorCategory.IDEMPOTENCY,

                statusCode:
                    409,

                retryable:
                    false

            }
        );
    }
}


/**
 * ============================================================================
 * Timeout Error
 * ============================================================================
 */

class TimeoutError extends TransactionError {

    constructor(
        message =
            'Transaction timeout',
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                name:
                    'TimeoutError',

                code:
                    options.code ||
                    TransactionErrorCodes.TIMEOUT,

                category:
                    TransactionErrorCategory.TIMEOUT,

                statusCode:
                    options.statusCode ||
                    504,

                severity:
                    options.severity ||
                    TransactionErrorSeverity.HIGH,

                retryable:
                    options.retryable ??
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Ledger Error
 * ============================================================================
 */

class LedgerError extends TransactionError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message ||
                'Ledger operation failed',
            {

                ...options,

                name:
                    'LedgerError',

                code:
                    options.code ||
                    TransactionErrorCodes.LEDGER_POST_FAILED,

                category:
                    TransactionErrorCategory.LEDGER,

                statusCode:
                    options.statusCode ||
                    500,

                severity:
                    options.severity ||
                    TransactionErrorSeverity.CRITICAL,

                retryable:
                    options.retryable ??
                    false,

                requiresCompensation:
                    options.requiresCompensation ??
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Ledger Reversal Error
 * ============================================================================
 */

class LedgerReversalError extends LedgerError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message ||
                'Ledger reversal failed',
            {

                ...options,

                name:
                    'LedgerReversalError',

                code:
                    options.code ||
                    TransactionErrorCodes.LEDGER_REVERSAL_FAILED,

                requiresCompensation:
                    false,

                retryable:
                    options.retryable ??
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Payment Error
 * ============================================================================
 */

class PaymentError extends TransactionError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message ||
                'Payment operation failed',
            {

                ...options,

                name:
                    'PaymentError',

                code:
                    options.code ||
                    TransactionErrorCodes.PAYMENT_FAILED,

                category:
                    TransactionErrorCategory.PAYMENT,

                statusCode:
                    options.statusCode ||
                    502,

                severity:
                    options.severity ||
                    TransactionErrorSeverity.HIGH,

                retryable:
                    options.retryable ??
                    true,

                provider:
                    options.provider ||
                    null

            }
        );
    }
}


/**
 * ============================================================================
 * Payment Provider Error
 * ============================================================================
 */

class PaymentProviderError extends PaymentError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message ||
                'Payment provider error',
            {

                ...options,

                name:
                    'PaymentProviderError',

                code:
                    options.code ||
                    TransactionErrorCodes.PAYMENT_PROVIDER_ERROR,

                category:
                    TransactionErrorCategory.PROVIDER

            }
        );
    }
}


/**
 * ============================================================================
 * Provider Unavailable Error
 * ============================================================================
 */

class ProviderUnavailableError extends PaymentProviderError {

    constructor(
        message =
            'Payment provider unavailable',
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                name:
                    'ProviderUnavailableError',

                code:
                    options.code ||
                    TransactionErrorCodes.PAYMENT_PROVIDER_UNAVAILABLE,

                category:
                    TransactionErrorCategory.PROVIDER,

                statusCode:
                    options.statusCode ||
                    503,

                retryable:
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Settlement Error
 * ============================================================================
 */

class SettlementError extends TransactionError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message ||
                'Settlement failed',
            {

                ...options,

                name:
                    'SettlementError',

                code:
                    options.code ||
                    TransactionErrorCodes.SETTLEMENT_FAILED,

                category:
                    TransactionErrorCategory.SETTLEMENT,

                severity:
                    options.severity ||
                    TransactionErrorSeverity.HIGH,

                retryable:
                    options.retryable ??
                    true,

                requiresCompensation:
                    options.requiresCompensation ??
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Lock Error
 * ============================================================================
 */

class LockError extends TransactionError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message ||
                'Transaction lock failed',
            {

                ...options,

                name:
                    'LockError',

                code:
                    options.code ||
                    TransactionErrorCodes.LOCK_FAILED,

                category:
                    TransactionErrorCategory.CONCURRENCY,

                statusCode:
                    options.statusCode ||
                    409,

                retryable:
                    options.retryable ??
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Version Conflict Error
 * ============================================================================
 */

class VersionConflictError extends TransactionError {

    constructor(
        message =
            'Transaction version conflict',
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                name:
                    'VersionConflictError',

                code:
                    options.code ||
                    TransactionErrorCodes.VERSION_CONFLICT,

                category:
                    TransactionErrorCategory.CONCURRENCY,

                statusCode:
                    409,

                retryable:
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Recovery Error
 * ============================================================================
 */

class RecoveryError extends TransactionError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message ||
                'Transaction recovery failed',
            {

                ...options,

                name:
                    'RecoveryError',

                code:
                    options.code ||
                    TransactionErrorCodes.RECOVERY_FAILED,

                category:
                    TransactionErrorCategory.RECOVERY,

                statusCode:
                    500,

                severity:
                    options.severity ||
                    TransactionErrorSeverity.CRITICAL,

                retryable:
                    options.retryable ??
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Compensation Error
 * ============================================================================
 */

class CompensationError extends TransactionError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message ||
                'Transaction compensation failed',
            {

                ...options,

                name:
                    'CompensationError',

                code:
                    options.code ||
                    TransactionErrorCodes.COMPENSATION_FAILED,

                category:
                    TransactionErrorCategory.COMPENSATION,

                statusCode:
                    500,

                severity:
                    TransactionErrorSeverity.CRITICAL,

                retryable:
                    options.retryable ??
                    true,

                requiresCompensation:
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Persistence Error
 * ============================================================================
 */

class PersistenceError extends TransactionError {

    constructor(
        message,
        options = {}
    ) {

        super(
            message ||
                'Transaction persistence failed',
            {

                ...options,

                name:
                    'PersistenceError',

                code:
                    options.code ||
                    TransactionErrorCodes.PERSISTENCE_FAILED,

                category:
                    TransactionErrorCategory.PERSISTENCE,

                statusCode:
                    500,

                severity:
                    TransactionErrorSeverity.HIGH,

                retryable:
                    options.retryable ??
                    true

            }
        );
    }
}


/**
 * ============================================================================
 * Authorization Errors
 * ============================================================================
 */

class UnauthorizedError extends TransactionError {

    constructor(
        message =
            'Unauthorized transaction request',
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                name:
                    'UnauthorizedError',

                code:
                    TransactionErrorCodes.UNAUTHORIZED,

                category:
                    TransactionErrorCategory.AUTHORIZATION,

                statusCode:
                    401,

                retryable:
                    false

            }
        );
    }
}


class ForbiddenError extends TransactionError {

    constructor(
        message =
            'Transaction operation forbidden',
        options = {}
    ) {

        super(
            message,
            {

                ...options,

                name:
                    'ForbiddenError',

                code:
                    TransactionErrorCodes.FORBIDDEN,

                category:
                    TransactionErrorCategory.SECURITY,

                statusCode:
                    403,

                retryable:
                    false

            }
        );
    }
}


/**
 * ============================================================================
 * Error Utilities
 * ============================================================================
 */

class TransactionErrorUtils {

    /**
     * Determine retryability.
     */
    static isRetryable(
        error
    ) {

        if (
            error?.retryable === true
        ) {

            return true;

        }


        if (
            error?.retryable === false
        ) {

            return false;

        }


        const statusCode =
            Number(
                error?.statusCode ||
                error?.status ||
                error?.response?.status
            );


        if (
            [
                408,
                409,
                425,
                429,
                500,
                502,
                503,
                504
            ].includes(
                statusCode
            )
        ) {

            return true;

        }


        const errorCode =
            String(
                error?.code ||
                ''
            )
                .toUpperCase();


        return [

            'ETIMEDOUT',
            'ECONNRESET',
            'ECONNREFUSED',
            'ECONNABORTED',
            'EAI_AGAIN',
            'ENETUNREACH',
            'EHOSTUNREACH',
            'NETWORK_ERROR',
            'TIMEOUT',
            'SERVICE_UNAVAILABLE',
            'PROVIDER_UNAVAILABLE'

        ].includes(
            errorCode
        );

    }


    /**
     * Determine whether compensation is necessary.
     */
    static requiresRollback(
        error
    ) {

        return Boolean(

            error?.requiresCompensation ||
            error?.compensationRequired

        );

    }


    /**
     * Determine whether compensation itself failed.
     */
    static isCompensationFailure(
        error
    ) {

        return (

            error?.code ===
                TransactionErrorCodes.COMPENSATION_FAILED ||

            error?.code ===
                TransactionErrorCodes.COMPENSATION_INCOMPLETE ||

            error?.category ===
                TransactionErrorCategory.COMPENSATION

        );

    }


    /**
     * Normalize unknown errors into the common framework.
     */
    static normalize(
        error,
        context = {}
    ) {

        if (
            error instanceof TransactionError
        ) {

            /**
             * Fill missing propagation context without changing the
             * original classification.
             */
            if (
                !error.transactionId &&
                context.transactionId
            ) {

                error.transactionId =
                    context.transactionId;

            }


            if (
                !error.correlationId &&
                context.correlationId
            ) {

                error.correlationId =
                    context.correlationId;

            }


            if (
                !error.requestId &&
                context.requestId
            ) {

                error.requestId =
                    context.requestId;

            }


            if (
                !error.tenantId &&
                context.tenantId
            ) {

                error.tenantId =
                    context.tenantId;

            }


            if (
                !error.operationId &&
                context.operationId
            ) {

                error.operationId =
                    context.operationId;

            }


            return error;

        }


        const normalizedMessage =
            error?.message ||
            'Unknown transaction error';


        const normalizedCode =
            TransactionErrorUtils.mapUnknownErrorCode(
                error
            );


        const retryable =
            TransactionErrorUtils.isRetryable(
                error
            );


        const normalized =
            new TransactionError(
                normalizedMessage,
                {

                    code:
                        normalizedCode,

                    category:
                        TransactionErrorUtils.mapCategory(
                            normalizedCode,
                            error
                        ),

                    statusCode:
                        TransactionErrorUtils.mapStatusCode(
                            error,
                            normalizedCode
                        ),

                    severity:
                        TransactionErrorUtils.mapSeverity(
                            normalizedCode
                        ),

                    retryable,

                    requiresCompensation:
                        Boolean(
                            context.requiresCompensation
                        ),

                    transactionId:
                        context.transactionId ||
                        error?.transactionId ||
                        null,

                    correlationId:
                        context.correlationId ||
                        error?.correlationId ||
                        null,

                    requestId:
                        context.requestId ||
                        error?.requestId ||
                        null,

                    tenantId:
                        context.tenantId ||
                        error?.tenantId ||
                        null,

                    operationId:
                        context.operationId ||
                        error?.operationId ||
                        null,

                    provider:
                        context.provider ||
                        error?.provider ||
                        null,

                    metadata: {

                        originalError:
                            error?.name,

                        originalCode:
                            error?.code

                    },

                    cause:
                        error

                }
            );


        return normalized;

    }


    /**
     * Provider error normalization.
     */
    static fromProviderError(
        error,
        provider,
        context = {}
    ) {

        const statusCode =
            Number(
                error?.statusCode ||
                error?.status ||
                error?.response?.status
            );


        const providerCode =
            error?.providerCode ||
            error?.response?.data?.code ||
            error?.response?.data?.error ||
            error?.code ||
            null;


        const retryable =
            TransactionErrorUtils.isRetryable(
                error
            );


        let ErrorClass =
            PaymentProviderError;


        if (
            statusCode ===
            408
        ) {

            ErrorClass =
                TimeoutError;

        }
        else if (
            statusCode ===
            429
        ) {

            ErrorClass =
                PaymentProviderError;

        }
        else if (
            statusCode >=
            500
        ) {

            ErrorClass =
                ProviderUnavailableError;

        }


        const normalized =
            new ErrorClass(
                `Payment provider failure: ${provider}`,
                {

                    ...context,

                    provider,

                    providerCode,

                    providerStatus:
                        statusCode ||
                        null,

                    retryable,

                    statusCode:
                        statusCode >= 400 &&
                        statusCode <= 599
                            ? statusCode
                            : undefined,

                    metadata: {

                        provider,

                        providerCode,

                        providerStatus:
                            statusCode ||
                            null

                    },

                    cause:
                        error

                }
            );


        return normalized;

    }


    /**
     * Database/Mongoose error normalization.
     */
    static fromDatabaseError(
        error,
        context = {}
    ) {

        if (
            error?.code ===
            11000
        ) {

            return new DuplicateTransactionError(
                'Transaction uniqueness conflict',
                {

                    ...context,

                    metadata: {

                        duplicateKey:
                            error?.keyValue ||
                            null

                    }

                }
            );

        }


        if (
            error?.name ===
            'VersionError'
        ) {

            return new VersionConflictError(
                'Transaction record was modified concurrently',
                {

                    ...context,

                    cause:
                        error

                }
            );

        }


        return new PersistenceError(
            error?.message ||
                'Database operation failed',
            {

                ...context,

                metadata: {

                    originalError:
                        error?.name,

                    originalCode:
                        error?.code

                },

                cause:
                    error

            }
        );

    }


    /**
     * Error code mapping for unknown errors.
     */
    static mapUnknownErrorCode(
        error
    ) {

        if (
            error?.name ===
            'ValidationError'
        ) {

            return TransactionErrorCodes.VALIDATION_FAILED;

        }


        if (
            error?.name ===
            'TimeoutError' ||
            error?.code ===
            'ETIMEDOUT'
        ) {

            return TransactionErrorCodes.TIMEOUT;

        }


        if (
            error?.name ===
            'VersionError'
        ) {

            return TransactionErrorCodes.VERSION_CONFLICT;

        }


        if (
            error?.code ===
            11000
        ) {

            return TransactionErrorCodes.DUPLICATE_TRANSACTION;

        }


        return TransactionErrorCodes.UNKNOWN;

    }


    /**
     * Error category mapping.
     */
    static mapCategory(
        code,
        error
    ) {

        if (
            String(code).includes(
                'LEDGER'
            )
        ) {

            return TransactionErrorCategory.LEDGER;

        }


        if (
            String(code).includes(
                'PAYMENT'
            ) ||
            String(code).includes(
                'PROVIDER'
            )
        ) {

            return TransactionErrorCategory.PAYMENT;

        }


        if (
            String(code).includes(
                'COMPENSATION'
            )
        ) {

            return TransactionErrorCategory.COMPENSATION;

        }


        if (
            String(code).includes(
                'RECOVERY'
            )
        ) {

            return TransactionErrorCategory.RECOVERY;

        }


        if (
            String(code).includes(
                'SETTLEMENT'
            )
        ) {

            return TransactionErrorCategory.SETTLEMENT;

        }


        if (
            String(code).includes(
                'TIMEOUT'
            )
        ) {

            return TransactionErrorCategory.TIMEOUT;

        }


        if (
            String(code).includes(
                'LOCK'
            ) ||
            String(code).includes(
                'VERSION'
            )
        ) {

            return TransactionErrorCategory.CONCURRENCY;

        }


        if (
            String(code).includes(
                'IDEMPOTENCY'
            ) ||
            String(code).includes(
                'DUPLICATE'
            )
        ) {

            return TransactionErrorCategory.IDEMPOTENCY;

        }


        return (
            error?.category ||
            TransactionErrorCategory.EXECUTION
        );

    }


    /**
     * HTTP status mapping.
     */
    static mapStatusCode(
        error,
        code
    ) {

        if (
            Number.isInteger(
                error?.statusCode
            )
        ) {

            return error.statusCode;

        }


        if (
            error?.name ===
            'ValidationError'
        ) {

            return 400;

        }


        if (
            code ===
            TransactionErrorCodes.UNAUTHORIZED
        ) {

            return 401;

        }


        if (
            code ===
            TransactionErrorCodes.FORBIDDEN
        ) {

            return 403;

        }


        if (
            code ===
            TransactionErrorCodes.DUPLICATE_TRANSACTION ||
            code ===
            TransactionErrorCodes.IDEMPOTENCY_CONFLICT ||
            code ===
            TransactionErrorCodes.VERSION_CONFLICT ||
            code ===
            TransactionErrorCodes.LOCK_CONFLICT
        ) {

            return 409;

        }


        if (
            code ===
            TransactionErrorCodes.TIMEOUT
        ) {

            return 504;

        }


        return 500;

    }


    /**
     * Severity mapping.
     */
    static mapSeverity(
        code
    ) {

        const criticalCodes = [

            TransactionErrorCodes.LEDGER_INTEGRITY_ERROR,

            TransactionErrorCodes.LEDGER_BALANCE_ERROR,

            TransactionErrorCodes.LEDGER_REVERSAL_FAILED,

            TransactionErrorCodes.COMPENSATION_FAILED,

            TransactionErrorCodes.COMPENSATION_INCOMPLETE,

            TransactionErrorCodes.SECURITY_VIOLATION

        ];


        const highCodes = [

            TransactionErrorCodes.LEDGER_POST_FAILED,

            TransactionErrorCodes.PAYMENT_FAILED,

            TransactionErrorCodes.PAYMENT_PROVIDER_ERROR,

            TransactionErrorCodes.SETTLEMENT_FAILED,

            TransactionErrorCodes.RECOVERY_FAILED,

            TransactionErrorCodes.PERSISTENCE_FAILED,

            TransactionErrorCodes.TIMEOUT

        ];


        if (
            criticalCodes.includes(code)
        ) {

            return TransactionErrorSeverity.CRITICAL;

        }


        if (
            highCodes.includes(code)
        ) {

            return TransactionErrorSeverity.HIGH;

        }


        return TransactionErrorSeverity.MEDIUM;

    }


    /**
     * API-safe serialization.
     */
    static serialize(
        error,
        options = {}
    ) {

        const normalized =
            TransactionErrorUtils.normalize(
                error,
                options
            );


        return normalized.serialize({

            includeStack:
                false,

            includeMetadata:
                options.includeMetadata === true,

            includeInternal:
                false

        });

    }

}


/**
 * ============================================================================
 * Backward Compatibility Alias
 * ============================================================================
 */

TransactionErrorUtils.requiresCompensation =
    TransactionErrorUtils.requiresRollback;


/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {

    TransactionError,

    ValidationError,

    DuplicateTransactionError,

    IdempotencyConflictError,

    TimeoutError,

    LedgerError,

    LedgerReversalError,

    PaymentError,

    PaymentProviderError,

    ProviderUnavailableError,

    SettlementError,

    LockError,

    VersionConflictError,

    RecoveryError,

    CompensationError,

    PersistenceError,

    UnauthorizedError,

    ForbiddenError,

    TransactionErrorCodes,

    TransactionErrorSeverity,

    TransactionErrorCategory,

    TransactionErrorUtils

};