'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Callback Validator
 * ============================================================================
 *
 * File:
 * backend/modules/payment/mtn/callbacks/mtnCallbackValidator.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Strict validation boundary for normalized MTN MoMo callbacks.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Callback shape validation
 * - Provider validation
 * - Tenant context validation
 * - Callback identity validation
 * - Idempotency identity validation
 * - Transaction reference validation
 * - Provider reference validation
 * - Status validation
 * - Amount validation
 * - Currency validation
 * - Request/correlation validation
 * - Transaction correlation validation
 * - Cross-field consistency validation
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Signature verification
 * - Callback normalization
 * - Idempotency reservation
 * - Payment execution
 * - Ledger posting
 * - Reconciliation
 * - State transitions
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * Raw MTN callback
 *       │
 *       ▼
 * MTN Normalizer
 *       │
 *       ▼
 * THIS VALIDATOR
 *       │
 *       ├── identity
 *       ├── provider
 *       ├── amount
 *       ├── status
 *       ├── reference
 *       └── transaction correlation
 *       │
 *       ▼
 * Idempotency / Callback Processor
 *
 * ============================================================================
 */

const {
    MTNCallbackValidationError,
} = require('./mtnCallbackErrors');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_PROVIDER =
    'MTN_MOMO';

const MAX_TENANT_ID_LENGTH =
    256;

const MAX_CALLBACK_ID_LENGTH =
    256;

const MAX_IDEMPOTENCY_KEY_LENGTH =
    512;

const MAX_REFERENCE_LENGTH =
    256;

const MAX_PROVIDER_REFERENCE_LENGTH =
    256;

const MAX_CURRENCY_LENGTH =
    3;

const MAX_STATUS_LENGTH =
    128;

const MAX_TRANSACTION_ID_LENGTH =
    256;

const MAX_CORRELATION_ID_LENGTH =
    256;

const MAX_REQUEST_ID_LENGTH =
    256;

const MAX_AMOUNT_DIGITS =
    30;

const DEFAULT_MAX_AMOUNT =
    '999999999999999999999999999999.999999';

/**
 * ============================================================================
 * Supported Statuses
 * ============================================================================
 *
 * The normalizer may map raw MTN provider values into these canonical values.
 *
 * Unknown statuses can optionally be retained for forward compatibility, but
 * they should not proceed into financial execution unless the processor has
 * an explicit policy for them.
 * ============================================================================
 */

const KNOWN_STATUSES =
    Object.freeze([
        'SUCCESSFUL',
        'FAILED',
        'PENDING',
        'REVERSED',
        'CANCELLED',
        'UNKNOWN',
    ]);

const EXECUTABLE_SUCCESS_STATUSES =
    new Set([
        'SUCCESSFUL',
    ]);

const EXECUTABLE_FAILURE_STATUSES =
    new Set([
        'FAILED',
        'REVERSED',
        'CANCELLED',
    ]);

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function isPlainObject(
    value
) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

function normalizeRequiredString(
    value,
    field,
    maxLength
) {
    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {
        throw new TypeError(
            `${field} is required`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizeOptionalString(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value !== 'string'
    ) {
        throw new TypeError(
            `${field} must be a string`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length === 0
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizeStatus(
    value
) {
    if (
        typeof value !== 'string'
    ) {
        return null;
    }

    return value
        .trim()
        .toUpperCase();
}

function normalizeCurrency(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const currency =
        normalizeRequiredString(
            value,
            'currency',
            MAX_CURRENCY_LENGTH
        ).toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            currency
        )
    ) {
        throw new TypeError(
            'currency must be a valid three-letter currency code'
        );
    }

    return currency;
}

/**
 * ============================================================================
 * Decimal Amount Validation
 * ============================================================================
 *
 * For financial values, Number/float validation is intentionally avoided.
 *
 * The normalized callback may contain:
 * - string
 * - Decimal128-like value
 * - number
 *
 * This method validates shape without introducing floating-point rounding.
 * ============================================================================
 */

function normalizeDecimalString(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    if (
        typeof value === 'number'
    ) {
        if (
            !Number.isFinite(value)
        ) {
            return null;
        }

        return String(value);
    }

    if (
        typeof value === 'string'
    ) {
        const normalized =
            value.trim();

        return normalized ||
            null;
    }

    if (
        typeof value.toString ===
            'function'
    ) {
        return String(
            value.toString()
        ).trim();
    }

    return null;
}

function validateAmount(
    value,
    {
        required = false,
    } = {}
) {
    const amount =
        normalizeDecimalString(
            value
        );

    if (
        amount === null
    ) {
        if (required) {
            return {
                valid: false,
                message:
                    'valid transaction amount is required',
                code:
                    'MTN_CALLBACK_AMOUNT_REQUIRED',
            };
        }

        return {
            valid: true,
            normalized:
                null,
        };
    }

    /**
     * Reject scientific notation to keep canonical financial input
     * deterministic.
     */
    if (
        /e/i.test(
            amount
        )
    ) {
        return {
            valid: false,
            message:
                'amount must use decimal notation',
            code:
                'MTN_CALLBACK_INVALID_AMOUNT',
        };
    }

    /**
     * Positive decimal:
     *
     * 1
     * 1.5
     * 1000000.25
     */
    if (
        !/^(?:0|[0-9]+)(?:\.[0-9]+)?$/.test(
            amount
        )
    ) {
        return {
            valid: false,
            message:
                'amount must be a valid non-negative decimal',
            code:
                'MTN_CALLBACK_INVALID_AMOUNT',
        };
    }

    /**
     * Remove leading zeros safely for canonical comparison.
     */
    const parts =
        amount.split('.');

    const integerPart =
        parts[0].replace(
            /^0+(?=\d)/,
            ''
        );

    const fractionPart =
        parts[1] || '';

    if (
        integerPart.length >
        MAX_AMOUNT_DIGITS
    ) {
        return {
            valid: false,
            message:
                'amount exceeds the permitted precision',
            code:
                'MTN_CALLBACK_AMOUNT_TOO_LARGE',
        };
    }

    /**
     * Zero is valid only when explicitly permitted by the caller.
     *
     * For financial payment callbacks, normally require > 0.
     */
    const numericZero =
        integerPart === '0' &&
        /^0*$/.test(
            fractionPart
        );

    const normalized =
        fractionPart.length > 0
            ? `${integerPart}.${fractionPart}`
            : integerPart;

    return {
        valid:
            true,

        normalized,

        zero:
            numericZero,
    };
}

/**
 * ============================================================================
 * Error Construction
 * ============================================================================
 */

function validationError(
    message,
    options = {}
) {
    return new MTNCallbackValidationError(
        message,
        {
            code:
                options.code ||
                'MTN_CALLBACK_VALIDATION_FAILED',

            reference:
                options.reference ||
                null,

            providerReference:
                options.providerReference ||
                null,

            callbackId:
                options.callbackId ||
                null,

            tenantId:
                options.tenantId ||
                null,

            correlationId:
                options.correlationId ||
                null,

            cause:
                options.cause ||
                undefined,

            retryable:
                options.retryable !== undefined
                    ? Boolean(
                        options.retryable
                    )
                    : false,
        }
    );
}

/**
 * ============================================================================
 * Validator
 * ============================================================================
 */

class MTNCallbackValidator {

    constructor(options = {}) {

        this.provider =
            (
                options.provider ||
                DEFAULT_PROVIDER
            )
                .trim()
                .toUpperCase();

        this.requireAmount =
            options.requireAmount !==
                undefined
                ? Boolean(
                    options.requireAmount
                )
                : false;

        /**
         * Forward compatibility.
         *
         * Unknown statuses may be persisted but should not automatically be
         * treated as financially executable.
         */
        this.allowUnknownStatus =
            options.allowUnknownStatus !==
                undefined
                ? Boolean(
                    options.allowUnknownStatus
                )
                : true;

        this.requireTenant =
            options.requireTenant !==
                undefined
                ? Boolean(
                    options.requireTenant
                )
                : true;

        this.requireIdempotencyKey =
            options.requireIdempotencyKey !==
                undefined
                ? Boolean(
                    options.requireIdempotencyKey
                )
                : true;

        this.requireCorrelationId =
            options.requireCorrelationId !==
                undefined
                ? Boolean(
                    options.requireCorrelationId
                )
                : false;

        this.allowedStatuses =
            new Set(
                Array.isArray(
                    options.allowedStatuses
                ) &&
                options.allowedStatuses.length
                    ? options.allowedStatuses.map(
                        status =>
                            String(
                                status
                            )
                                .trim()
                                .toUpperCase()
                    )
                    : KNOWN_STATUSES
            );

        this.maxAmount =
            options.maxAmount ||
            DEFAULT_MAX_AMOUNT;
    }

    /**
     * =========================================================================
     * Main Validation
     * =========================================================================
     */

    validate(
        callback,
        context = {}
    ) {

        if (
            !isPlainObject(
                callback
            )
        ) {
            throw validationError(
                'Normalized callback is required.',
                {
                    code:
                        'MTN_NORMALIZED_CALLBACK_REQUIRED',
                }
            );
        }

        const errors = [];

        /**
         * ---------------------------------------------------------------------
         * Tenant
         * ---------------------------------------------------------------------
         */

        const tenantId =
            callback.tenantId ||
            context.tenantId ||
            null;

        if (
            this.requireTenant &&
            !tenantId
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_TENANT_REQUIRED',

                message:
                    'tenantId is required',
            });
        } else if (
            tenantId
        ) {
            try {
                normalizeRequiredString(
                    tenantId,
                    'tenantId',
                    MAX_TENANT_ID_LENGTH
                );
            } catch (
                error
            ) {
                errors.push({
                    code:
                        'MTN_CALLBACK_INVALID_TENANT',

                    message:
                        error.message,
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Provider
         * ---------------------------------------------------------------------
         */

        const provider =
            normalizeStatus(
                callback.provider
            );

        if (
            provider !==
            this.provider
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_PROVIDER_MISMATCH',

                message:
                    `Unexpected provider: ${callback.provider}`,
            });
        }

        /**
         * ---------------------------------------------------------------------
         * Callback identity
         * ---------------------------------------------------------------------
         */

        try {
            normalizeRequiredString(
                callback.callbackId,
                'callbackId',
                MAX_CALLBACK_ID_LENGTH
            );
        } catch (
            error
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_ID_REQUIRED',

                message:
                    'callbackId is required',
            });
        }

        /**
         * ---------------------------------------------------------------------
         * Idempotency identity
         * ---------------------------------------------------------------------
         */

        if (
            this.requireIdempotencyKey &&
            !callback.idempotencyKey
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_IDEMPOTENCY_KEY_REQUIRED',

                message:
                    'idempotencyKey is required',
            });
        } else if (
            callback.idempotencyKey
        ) {
            try {
                normalizeRequiredString(
                    callback.idempotencyKey,
                    'idempotencyKey',
                    MAX_IDEMPOTENCY_KEY_LENGTH
                );
            } catch (
                error
            ) {
                errors.push({
                    code:
                        'MTN_CALLBACK_INVALID_IDEMPOTENCY_KEY',

                    message:
                        error.message,
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * References
         * ---------------------------------------------------------------------
         */

        let reference = null;

        let providerReference = null;

        try {
            reference =
                normalizeOptionalString(
                    callback.reference,
                    'reference',
                    MAX_REFERENCE_LENGTH
                );

            providerReference =
                normalizeOptionalString(
                    callback.providerReference,
                    'providerReference',
                    MAX_PROVIDER_REFERENCE_LENGTH
                );
        } catch (
            error
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_INVALID_REFERENCE',

                message:
                    error.message,
            });
        }

        if (
            !reference &&
            !providerReference
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_REFERENCE_REQUIRED',

                message:
                    'transaction reference is required',
            });
        }

        /**
         * ---------------------------------------------------------------------
         * Status
         * ---------------------------------------------------------------------
         */

        const status =
            normalizeStatus(
                callback.status
            );

        if (
            !status
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_STATUS_REQUIRED',

                message:
                    'callback status is required',
            });
        } else {

            if (
                !this.allowedStatuses.has(
                    status
                )
            ) {
                if (
                    this.allowUnknownStatus
                ) {
                    /**
                     * Preserve it as UNKNOWN semantics for downstream policy.
                     */
                } else {
                    errors.push({
                        code:
                            'MTN_CALLBACK_UNKNOWN_STATUS',

                        message:
                            `Unsupported callback status: ${status}`,
                    });
                }
            }

            /**
             * Unknown provider status must not be silently treated as a
             * successful payment.
             */
            if (
                status === 'UNKNOWN' &&
                this.allowUnknownStatus !==
                    true
            ) {
                errors.push({
                    code:
                        'MTN_CALLBACK_UNKNOWN_STATUS',

                    message:
                        'unknown provider status is not allowed',
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Amount
         * ---------------------------------------------------------------------
         */

        const amountResult =
            validateAmount(
                callback.amount,
                {
                    required:
                        this.requireAmount,
                }
            );

        if (
            !amountResult.valid
        ) {
            errors.push({
                code:
                    amountResult.code,

                message:
                    amountResult.message,
            });
        } else if (
            this.requireAmount &&
            amountResult.zero
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_AMOUNT_MUST_BE_POSITIVE',

                message:
                    'transaction amount must be greater than zero',
            });
        }

        /**
         * Optional maximum amount.
         */
        if (
            amountResult.valid &&
            amountResult.normalized
        ) {

            const comparison =
                this.compareDecimals(
                    amountResult.normalized,
                    String(
                        this.maxAmount
                    )
                );

            if (
                comparison > 0
            ) {
                errors.push({
                    code:
                        'MTN_CALLBACK_AMOUNT_EXCEEDS_LIMIT',

                    message:
                        'transaction amount exceeds the permitted maximum',
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Currency
         * ---------------------------------------------------------------------
         */

        if (
            callback.currency !==
                undefined &&
            callback.currency !==
                null
        ) {
            try {
                normalizeCurrency(
                    callback.currency
                );
            } catch (
                error
            ) {
                errors.push({
                    code:
                        'MTN_CALLBACK_INVALID_CURRENCY',

                    message:
                        error.message,
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Correlation
         * ---------------------------------------------------------------------
         */

        const correlationId =
            callback.correlationId ||
            context.correlationId ||
            null;

        if (
            this.requireCorrelationId &&
            !correlationId
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_CORRELATION_ID_REQUIRED',

                message:
                    'correlationId is required',
            });
        } else if (
            correlationId
        ) {
            try {
                normalizeRequiredString(
                    correlationId,
                    'correlationId',
                    MAX_CORRELATION_ID_LENGTH
                );
            } catch (
                error
            ) {
                errors.push({
                    code:
                        'MTN_CALLBACK_INVALID_CORRELATION_ID',

                    message:
                        error.message,
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Request ID
         * ---------------------------------------------------------------------
         */

        if (
            callback.requestId
        ) {
            try {
                normalizeRequiredString(
                    callback.requestId,
                    'requestId',
                    MAX_REQUEST_ID_LENGTH
                );
            } catch (
                error
            ) {
                errors.push({
                    code:
                        'MTN_CALLBACK_INVALID_REQUEST_ID',

                    message:
                        error.message,
                });
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Provider/reference consistency
         * ---------------------------------------------------------------------
         */

        if (
            callback.providerReference &&
            callback.reference &&
            String(
                callback.providerReference
            ) ===
                String(
                    callback.reference
                )
        ) {
            /**
             * This is not necessarily invalid, but it is generally suspicious
             * because provider and merchant references should normally be
             * distinct identifiers.
             *
             * Keep as diagnostic metadata rather than rejecting compatibility.
             */
        }

        /**
         * ---------------------------------------------------------------------
         * Signature requirement
         * ---------------------------------------------------------------------
         */

        if (
            context.requireSignatureVerified &&
            callback.signatureVerified !==
                true
        ) {
            errors.push({
                code:
                    'MTN_CALLBACK_SIGNATURE_NOT_VERIFIED',

                message:
                    'Callback signature verification is required before processing',
            });
        }

        /**
         * ---------------------------------------------------------------------
         * Validate errors
         * ---------------------------------------------------------------------
         */

        if (
            errors.length > 0
        ) {

            throw validationError(
                errors
                    .map(
                        entry =>
                            entry.message
                    )
                    .join('; '),
                {
                    code:
                        'MTN_CALLBACK_VALIDATION_FAILED',

                    reference:
                        reference ||
                        providerReference,

                    providerReference,

                    callbackId:
                        callback.callbackId,

                    tenantId,

                    correlationId,

                    retryable:
                        false,
                }
            );
        }

        /**
         * Return normalized validation information rather than only true.
         *
         * Existing consumers can continue treating truthy return as success.
         */
        return {
            valid:
                true,

            provider:
                this.provider,

            tenantId,

            callbackId:
                callback.callbackId,

            idempotencyKey:
                callback.idempotencyKey ||
                null,

            reference,

            providerReference,

            status,

            amount:
                amountResult.normalized,

            currency:
                callback.currency
                    ? normalizeCurrency(
                        callback.currency
                    )
                    : null,

            correlationId,

            executable:
                EXECUTABLE_SUCCESS_STATUSES.has(
                    status
                ) ||
                EXECUTABLE_FAILURE_STATUSES.has(
                    status
                ),
        };
    }

    /**
     * =========================================================================
     * Reference Correlation
     * =========================================================================
     *
     * This performs strict correlation against a resolved internal transaction.
     *
     * Preferred correlation:
     *
     * callback.providerReference
     *       ↕
     * transaction.providerReference
     *
     * Secondary correlation:
     *
     * callback.reference
     *       ↕
     * transaction.reference
     * =========================================================================
     */

    validateReferenceCorrelation(
        callback,
        transaction,
        context = {}
    ) {

        if (
            !callback ||
            typeof callback !==
                'object'
        ) {
            throw validationError(
                'Callback is required for transaction correlation.',
                {
                    code:
                        'MTN_CALLBACK_REQUIRED',

                    retryable:
                        false,
                }
            );
        }

        if (
            !transaction ||
            typeof transaction !==
                'object'
        ) {
            throw validationError(
                'Callback transaction could not be correlated.',
                {
                    code:
                        'MTN_CALLBACK_TRANSACTION_NOT_FOUND',

                    reference:
                        callback.reference ||
                        callback.providerReference,

                    providerReference:
                        callback.providerReference,

                    callbackId:
                        callback.callbackId,

                    tenantId:
                        callback.tenantId ||
                        context.tenantId ||
                        null,

                    correlationId:
                        callback.correlationId ||
                        context.correlationId ||
                        null,

                    retryable:
                        false,
                }
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Tenant consistency
         * ---------------------------------------------------------------------
         */

        const callbackTenant =
            callback.tenantId ||
            context.tenantId ||
            null;

        const transactionTenant =
            transaction.tenantId ||
            null;

        if (
            callbackTenant &&
            transactionTenant &&
            String(
                callbackTenant
            ) !==
                String(
                    transactionTenant
                )
        ) {
            throw validationError(
                'Callback tenant does not match the persisted transaction tenant.',
                {
                    code:
                        'MTN_CALLBACK_TENANT_MISMATCH',

                    reference:
                        callback.reference,

                    providerReference:
                        callback.providerReference,

                    callbackId:
                        callback.callbackId,

                    tenantId:
                        callbackTenant,

                    retryable:
                        false,
                }
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Provider consistency
         * ---------------------------------------------------------------------
         */

        if (
            transaction.provider
        ) {
            const transactionProvider =
                String(
                    transaction.provider
                )
                    .trim()
                    .toUpperCase();

            if (
                transactionProvider !==
                this.provider
            ) {
                throw validationError(
                    'Persisted transaction provider does not match MTN MoMo.',
                    {
                        code:
                            'MTN_CALLBACK_TRANSACTION_PROVIDER_MISMATCH',

                        reference:
                            callback.reference,

                        providerReference:
                            callback.providerReference,

                        callbackId:
                            callback.callbackId,

                        retryable:
                            false,
                    }
                );
            }
        }

        /**
         * ---------------------------------------------------------------------
         * Provider reference correlation
         * ---------------------------------------------------------------------
         */

        if (
            callback.providerReference &&
            transaction.providerReference
        ) {

            if (
                String(
                    callback.providerReference
                ) !==
                    String(
                        transaction.providerReference
                    )
            ) {
                throw validationError(
                    'Provider reference does not match the persisted transaction.',
                    {
                        code:
                            'MTN_CALLBACK_PROVIDER_REFERENCE_MISMATCH',

                        reference:
                            callback.reference,

                        providerReference:
                            callback.providerReference,

                        callbackId:
                            callback.callbackId,

                        retryable:
                            false,
                    }
                );
            }

        }

        /**
         * ---------------------------------------------------------------------
         * Merchant/internal reference correlation
         * ---------------------------------------------------------------------
         */

        if (
            callback.reference &&
            transaction.reference
        ) {

            if (
                String(
                    callback.reference
                ) !==
                    String(
                        transaction.reference
                    )
            ) {
                throw validationError(
                    'Transaction reference does not match the persisted transaction.',
                    {
                        code:
                            'MTN_CALLBACK_REFERENCE_MISMATCH',

                        reference:
                            callback.reference,

                        providerReference:
                            callback.providerReference,

                        callbackId:
                            callback.callbackId,

                        retryable:
                            false,
                    }
                );
            }

        }

        /**
         * ---------------------------------------------------------------------
         * Internal transaction identity
         * ---------------------------------------------------------------------
         *
         * If both sides expose a transaction ID, ensure they agree.
         * ---------------------------------------------------------------------
         */

        if (
            callback.transactionId &&
            transaction._id
        ) {

            if (
                String(
                    callback.transactionId
                ) !==
                    String(
                        transaction._id
                    )
            ) {
                throw validationError(
                    'Callback transaction ID does not match the persisted transaction.',
                    {
                        code:
                            'MTN_CALLBACK_TRANSACTION_ID_MISMATCH',

                        reference:
                            callback.reference,

                        providerReference:
                            callback.providerReference,

                        callbackId:
                            callback.callbackId,

                        retryable:
                            false,
                    }
                );
            }

        }

        /**
         * ---------------------------------------------------------------------
         * Amount correlation
         * ---------------------------------------------------------------------
         */

        if (
            callback.amount !==
                undefined &&
            callback.amount !==
                null &&
            transaction.amount !==
                undefined &&
            transaction.amount !==
                null
        ) {

            const callbackAmount =
                normalizeDecimalString(
                    callback.amount
                );

            const transactionAmount =
                normalizeDecimalString(
                    transaction.amount
                );

            if (
                callbackAmount &&
                transactionAmount &&
                this.compareDecimals(
                    callbackAmount,
                    transactionAmount
                ) !== 0
            ) {

                throw validationError(
                    'Callback amount does not match the persisted transaction amount.',
                    {
                        code:
                            'MTN_CALLBACK_AMOUNT_MISMATCH',

                        reference:
                            callback.reference,

                        providerReference:
                            callback.providerReference,

                        callbackId:
                            callback.callbackId,

                        retryable:
                            false,
                    }
                );
            }

        }

        /**
         * ---------------------------------------------------------------------
         * Currency correlation
         * ---------------------------------------------------------------------
         */

        if (
            callback.currency &&
            transaction.currency
        ) {

            const callbackCurrency =
                normalizeCurrency(
                    callback.currency
                );

            const transactionCurrency =
                normalizeCurrency(
                    transaction.currency
                );

            if (
                callbackCurrency !==
                transactionCurrency
            ) {
                throw validationError(
                    'Callback currency does not match the persisted transaction currency.',
                    {
                        code:
                            'MTN_CALLBACK_CURRENCY_MISMATCH',

                        reference:
                            callback.reference,

                        providerReference:
                            callback.providerReference,

                        callbackId:
                            callback.callbackId,

                        retryable:
                            false,
                    }
                );
            }

        }

        return {
            valid:
                true,

            transactionId:
                transaction._id ||
                transaction.id ||
                null,

            tenantId:
                transaction.tenantId ||
                callback.tenantId ||
                context.tenantId ||
                null,
        };
    }

    /**
     * =========================================================================
     * Status Policy
     * =========================================================================
     */

    isExecutableSuccessStatus(
        status
    ) {
        return EXECUTABLE_SUCCESS_STATUSES.has(
            normalizeStatus(
                status
            )
        );
    }

    isExecutableFailureStatus(
        status
    ) {
        return EXECUTABLE_FAILURE_STATUSES.has(
            normalizeStatus(
                status
            )
        );
    }

    isTerminalProviderStatus(
        status
    ) {
        const normalized =
            normalizeStatus(
                status
            );

        return (
            this.isExecutableSuccessStatus(
                normalized
            ) ||
            this.isExecutableFailureStatus(
                normalized
            )
        );
    }

    /**
     * =========================================================================
     * Decimal Comparison
     * =========================================================================
     *
     * Compares non-negative decimal strings without using floating-point
     * arithmetic.
     * =========================================================================
     */

    compareDecimals(
        left,
        right
    ) {

        const normalize =
            value => {

                const stringValue =
                    String(
                        value
                    )
                        .trim();

                if (
                    !/^(?:0|[0-9]+)(?:\.[0-9]+)?$/.test(
                        stringValue
                    )
                ) {
                    throw new TypeError(
                        'Invalid decimal value'
                    );
                }

                const [
                    integer,
                    fraction = '',
                ] =
                    stringValue.split('.');

                return {
                    integer:
                        integer.replace(
                            /^0+(?=\d)/,
                            ''
                        ) || '0',

                    fraction:
                        fraction.replace(
                            /0+$/,
                            ''
                        ),
                };
            };

        const a =
            normalize(
                left
            );

        const b =
            normalize(
                right
            );

        /**
         * Integer component.
         */
        if (
            a.integer.length !==
            b.integer.length
        ) {

            return a.integer.length >
                b.integer.length
                ? 1
                : -1;
        }

        if (
            a.integer !==
            b.integer
        ) {

            return a.integer >
                b.integer
                ? 1
                : -1;
        }

        /**
         * Normalize fractional precision.
         */
        const maxLength =
            Math.max(
                a.fraction.length,
                b.fraction.length
            );

        const fractionA =
            a.fraction.padEnd(
                maxLength,
                '0'
            );

        const fractionB =
            b.fraction.padEnd(
                maxLength,
                '0'
            );

        if (
            fractionA ===
            fractionB
        ) {
            return 0;
        }

        return fractionA >
            fractionB
            ? 1
            : -1;
    }

}

/**
 * ============================================================================
 * Public Constants
 * ============================================================================
 */

MTNCallbackValidator.PROVIDER =
    DEFAULT_PROVIDER;

MTNCallbackValidator.KNOWN_STATUSES =
    KNOWN_STATUSES;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    MTNCallbackValidator;