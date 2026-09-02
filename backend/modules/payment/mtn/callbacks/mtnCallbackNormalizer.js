'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Callback Normalizer
 * ============================================================================
 *
 * File:
 * backend/modules/payment/mtn/callbacks/mtnCallbackNormalizer.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Converts provider-specific MTN MoMo callback payloads into one canonical
 * internal representation.
 *
 * This module is deliberately pure with respect to financial state.
 *
 * It does NOT:
 * - post to the ledger
 * - mutate balances
 * - execute payments
 * - update transactions
 * - perform idempotency claims
 * - perform reconciliation
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Provider field mapping
 * - Canonical status mapping
 * - Reference normalization
 * - Decimal amount normalization
 * - Currency normalization
 * - Timestamp normalization
 * - Callback identity generation
 * - Tenant/context propagation
 * - Raw payload preservation
 * - Payload fingerprinting
 * - Safe metadata handling
 *
 * ============================================================================
 */

const crypto = require('crypto');

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

const DEFAULT_CURRENCY =
    'UGX';

const MAX_PROVIDER_LENGTH =
    128;

const MAX_CALLBACK_ID_LENGTH =
    256;

const MAX_REFERENCE_LENGTH =
    256;

const MAX_EXTERNAL_ID_LENGTH =
    256;

const MAX_TENANT_ID_LENGTH =
    256;

const MAX_CUSTOMER_ID_LENGTH =
    256;

const MAX_LOAN_ID_LENGTH =
    256;

const MAX_SAVINGS_ACCOUNT_ID_LENGTH =
    256;

const MAX_PHONE_LENGTH =
    32;

const MAX_TRANSACTION_TYPE_LENGTH =
    128;

const MAX_REASON_LENGTH =
    2000;

const MAX_REQUEST_ID_LENGTH =
    256;

const MAX_CORRELATION_ID_LENGTH =
    256;

const MAX_RAW_PAYLOAD_KEYS =
    500;

const MAX_RAW_PAYLOAD_DEPTH =
    8;

const MAX_RAW_PAYLOAD_ARRAY_LENGTH =
    500;

/**
 * ============================================================================
 * Canonical Status
 * ============================================================================
 */

const STATUS = Object.freeze({
    SUCCESSFUL:
        'SUCCESSFUL',

    FAILED:
        'FAILED',

    PENDING:
        'PENDING',

    REVERSED:
        'REVERSED',

    CANCELLED:
        'CANCELLED',

    UNKNOWN:
        'UNKNOWN',
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isPlainObject(value) {
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
        throw new MTNCallbackValidationError(
            `${field} is required.`,
            {
                code:
                    'MTN_CALLBACK_FIELD_REQUIRED',
            }
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw new MTNCallbackValidationError(
            `${field} exceeds maximum length.`,
            {
                code:
                    'MTN_CALLBACK_FIELD_TOO_LONG',
            }
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
        throw new MTNCallbackValidationError(
            `${field} must be a string.`,
            {
                code:
                    'MTN_CALLBACK_FIELD_INVALID',
            }
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
        throw new MTNCallbackValidationError(
            `${field} exceeds maximum length.`,
            {
                code:
                    'MTN_CALLBACK_FIELD_TOO_LONG',
            }
        );
    }

    return normalized;
}

function normalizeCurrency(
    value
) {
    const currency =
        normalizeRequiredString(
            value,
            'currency',
            3
        ).toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            currency
        )
    ) {
        throw new MTNCallbackValidationError(
            'currency must be a valid three-letter currency code.',
            {
                code:
                    'MTN_CALLBACK_INVALID_CURRENCY',
            }
        );
    }

    return currency;
}

/**
 * ============================================================================
 * Decimal Amount Normalization
 * ============================================================================
 *
 * Do not convert payment amounts through JavaScript floating-point arithmetic.
 *
 * Canonical output is a decimal string.
 * ============================================================================
 */

function normalizeAmount(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    let amount;

    if (
        typeof value === 'number'
    ) {
        if (
            !Number.isFinite(value)
        ) {
            throw new MTNCallbackValidationError(
                'Callback amount must be finite.',
                {
                    code:
                        'MTN_CALLBACK_INVALID_AMOUNT',
                }
            );
        }

        if (
            value < 0
        ) {
            throw new MTNCallbackValidationError(
                'Callback amount cannot be negative.',
                {
                    code:
                        'MTN_CALLBACK_INVALID_AMOUNT',
                }
            );
        }

        /**
         * Number inputs are accepted for compatibility, but the canonical
         * representation is still converted to a string.
         */
        amount =
            String(value);

    } else if (
        typeof value === 'string'
    ) {

        amount =
            value.trim();

    } else if (
        value &&
        typeof value.toString ===
            'function'
    ) {

        amount =
            String(
                value.toString()
            ).trim();

    } else {

        throw new MTNCallbackValidationError(
            'Callback amount has an unsupported type.',
            {
                code:
                    'MTN_CALLBACK_INVALID_AMOUNT',
            }
        );
    }

    /**
     * Reject scientific notation because it makes canonical financial
     * comparison less explicit.
     */
    if (
        /e/i.test(
            amount
        )
    ) {
        throw new MTNCallbackValidationError(
            'Callback amount must use decimal notation.',
            {
                code:
                    'MTN_CALLBACK_INVALID_AMOUNT',
            }
        );
    }

    if (
        !/^(?:0|[0-9]+)(?:\.[0-9]+)?$/.test(
            amount
        )
    ) {
        throw new MTNCallbackValidationError(
            'Callback amount must be a valid non-negative decimal.',
            {
                code:
                    'MTN_CALLBACK_INVALID_AMOUNT',
            }
        );
    }

    const [
        integerPart,
        fractionPart = '',
    ] =
        amount.split('.');

    const normalizedInteger =
        integerPart.replace(
            /^0+(?=\d)/,
            ''
        );

    /**
     * Preserve fractional precision supplied by the provider while ensuring
     * canonical leading-zero handling.
     */
    return fractionPart.length > 0
        ? `${normalizedInteger}.${fractionPart}`
        : normalizedInteger;
}

/**
 * ============================================================================
 * Timestamp Normalization
 * ============================================================================
 */

function parseTimestamp(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw new MTNCallbackValidationError(
            'Callback timestamp is invalid.',
            {
                code:
                    'MTN_CALLBACK_INVALID_TIMESTAMP',
            }
        );
    }

    return date;
}

/**
 * ============================================================================
 * Safe Raw Payload Snapshot
 * ============================================================================
 *
 * Raw provider evidence is retained, but dangerous prototype keys and
 * pathological nested structures are rejected.
 *
 * Credentials/signatures are not modified here because this is a canonical
 * source snapshot; the callback storage layer should control which raw fields
 * are persisted.
 * ============================================================================
 */

function validateRawPayloadShape(
    value,
    depth = 0,
    seen = new WeakSet()
) {
    if (
        value === null ||
        value === undefined
    ) {
        return;
    }

    if (
        depth >
        MAX_RAW_PAYLOAD_DEPTH
    ) {
        throw new MTNCallbackValidationError(
            'Callback payload exceeds maximum nesting depth.',
            {
                code:
                    'MTN_CALLBACK_PAYLOAD_TOO_DEEP',
            }
        );
    }

    if (
        typeof value !== 'object'
    ) {
        return;
    }

    if (
        seen.has(value)
    ) {
        throw new MTNCallbackValidationError(
            'Callback payload contains a circular reference.',
            {
                code:
                    'MTN_CALLBACK_PAYLOAD_CIRCULAR',
            }
        );
    }

    seen.add(value);

    if (
        Array.isArray(value)
    ) {
        if (
            value.length >
            MAX_RAW_PAYLOAD_ARRAY_LENGTH
        ) {
            throw new MTNCallbackValidationError(
                'Callback payload array is too large.',
                {
                    code:
                        'MTN_CALLBACK_PAYLOAD_TOO_LARGE',
                }
            );
        }

        for (
            const item of value
        ) {
            validateRawPayloadShape(
                item,
                depth + 1,
                seen
            );
        }

        return;
    }

    const keys =
        Object.keys(value);

    if (
        keys.length >
        MAX_RAW_PAYLOAD_KEYS
    ) {
        throw new MTNCallbackValidationError(
            'Callback payload contains too many fields.',
            {
                code:
                    'MTN_CALLBACK_PAYLOAD_TOO_LARGE',
            }
        );
    }

    for (
        const key of keys
    ) {
        if (
            key === '__proto__' ||
            key === 'prototype' ||
            key === 'constructor'
        ) {
            throw new MTNCallbackValidationError(
                `Unsafe callback payload field: ${key}`,
                {
                    code:
                        'MTN_CALLBACK_UNSAFE_FIELD',
                }
            );
        }

        validateRawPayloadShape(
            value[key],
            depth + 1,
            seen
        );
    }
}

/**
 * ============================================================================
 * Stable Serialization
 * ============================================================================
 */

function stableSerialize(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        value instanceof Date
    ) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return `[${value
            .map(
                stableSerialize
            )
            .join(',')}]`;
    }

    if (
        typeof value ===
            'object'
    ) {
        return `{${Object.keys(
            value
        )
            .sort()
            .map(
                key =>
                    `${JSON.stringify(
                        key
                    )}:${stableSerialize(
                        value[key]
                    )}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(
        value
    );
}

/**
 * ============================================================================
 * Normalizer
 * ============================================================================
 */

class MTNCallbackNormalizer {

    constructor(
        options = {}
    ) {

        this.provider =
            normalizeRequiredString(
                options.provider ||
                    DEFAULT_PROVIDER,
                'provider',
                MAX_PROVIDER_LENGTH
            )
                .toUpperCase();

        this.defaultCurrency =
            normalizeCurrency(
                options.defaultCurrency ||
                DEFAULT_CURRENCY
            );

        /**
         * Client-supplied tenant identifiers should normally NOT be trusted.
         *
         * The trusted tenant comes from authenticated context.
         *
         * default:
         * use context.tenantId
         */
        this.allowPayloadTenant =
            options.allowPayloadTenant === true;

        this.requireTenant =
            options.requireTenant !==
                undefined
                ? Boolean(
                    options.requireTenant
                )
                : true;
    }

    /**
     * =========================================================================
     * Normalize
     * =========================================================================
     */

    normalize(
        payload = {},
        context = {}
    ) {

        if (
            !isPlainObject(
                payload
            )
        ) {
            throw new MTNCallbackValidationError(
                'MTN callback payload must be an object.',
                {
                    code:
                        'MTN_CALLBACK_PAYLOAD_INVALID',
                }
            );
        }

        validateRawPayloadShape(
            payload
        );

        const trustedTenantId =
            normalizeOptionalString(
                context.tenantId,
                'tenantId',
                MAX_TENANT_ID_LENGTH
            );

        const payloadTenantId =
            this.allowPayloadTenant
                ? normalizeOptionalString(
                    payload.tenantId,
                    'tenantId',
                    MAX_TENANT_ID_LENGTH
                )
                : null;

        if (
            trustedTenantId &&
            payloadTenantId &&
            trustedTenantId !==
                payloadTenantId
        ) {
            throw new MTNCallbackValidationError(
                'Callback tenant does not match trusted execution context.',
                {
                    code:
                        'MTN_CALLBACK_TENANT_MISMATCH',
                }
            );
        }

        const tenantId =
            trustedTenantId ||
            payloadTenantId ||
            null;

        if (
            this.requireTenant &&
            !tenantId
        ) {
            throw new MTNCallbackValidationError(
                'Trusted tenant context is required.',
                {
                    code:
                        'MTN_CALLBACK_TENANT_REQUIRED',
                }
            );
        }

        /**
         * ---------------------------------------------------------------------
         * Provider reference
         * ---------------------------------------------------------------------
         */

        const providerReference =
            this.firstDefined(
                payload.referenceId,
                payload.referenceID,
                payload.reference,
                payload.providerReference,
                payload['X-Reference-Id'],
                context.providerReference
            );

        const normalizedProviderReference =
            normalizeOptionalString(
                providerReference,
                'providerReference',
                MAX_REFERENCE_LENGTH
            );

        /**
         * ---------------------------------------------------------------------
         * External transaction identity
         * ---------------------------------------------------------------------
         */

        const externalId =
            this.firstDefined(
                payload.externalId,
                payload.externalID,
                payload.external_id,
                payload.transactionId,
                payload.transactionID,
                payload.financialTransactionId,
                payload.financialTransactionID
            );

        const normalizedExternalId =
            normalizeOptionalString(
                externalId,
                'externalId',
                MAX_EXTERNAL_ID_LENGTH
            );

        /**
         * ---------------------------------------------------------------------
         * Provider status
         * ---------------------------------------------------------------------
         */

        const providerStatus =
            this.firstDefined(
                payload.status,
                payload.transactionStatus,
                payload.financialTransactionStatus,
                payload.result,
                payload.responseCode
            );

        const normalizedStatus =
            this.normalizeStatus(
                providerStatus
            );

        /**
         * ---------------------------------------------------------------------
         * Amount
         * ---------------------------------------------------------------------
         */

        const amount =
            normalizeAmount(
                this.firstDefined(
                    payload.amount,
                    payload.amountValue,
                    payload.amountPaid,
                    payload.financialTransactionAmount
                )
            );

        /**
         * ---------------------------------------------------------------------
         * Currency
         * ---------------------------------------------------------------------
         */

        const currencyValue =
            this.firstDefined(
                payload.currency,
                payload.currencyCode,
                payload.financialTransactionCurrency
            );

        const currency =
            currencyValue
                ? normalizeCurrency(
                    currencyValue
                )
                : this.defaultCurrency;

        /**
         * ---------------------------------------------------------------------
         * Callback identity
         * ---------------------------------------------------------------------
         */

        const suppliedCallbackId =
            this.firstDefined(
                payload.callbackId,
                payload.callbackID,
                payload.eventId,
                payload.eventID,
                payload.eventReference,
                context.callbackId
            );

        const callbackId =
            normalizeOptionalString(
                suppliedCallbackId,
                'callbackId',
                MAX_CALLBACK_ID_LENGTH
            ) ||
            this.generateCallbackId({
                tenantId,
                providerReference:
                    normalizedProviderReference,
                externalId:
                    normalizedExternalId,
                providerStatus,
                payload,
            });

        /**
         * ---------------------------------------------------------------------
         * References
         * ---------------------------------------------------------------------
         */

        const reference =
            normalizeOptionalString(
                this.firstDefined(
                    payload.reference,
                    payload.externalReference,
                    normalizedExternalId,
                    normalizedProviderReference
                ),
                'reference',
                MAX_REFERENCE_LENGTH
            );

        /**
         * ---------------------------------------------------------------------
         * Phone number
         * ---------------------------------------------------------------------
         */

        const phoneNumber =
            normalizeOptionalString(
                this.firstDefined(
                    payload.phoneNumber,
                    payload.msisdn,
                    payload.payer?.partyId,
                    payload.payee?.partyId,
                    payload.payer?.phoneNumber,
                    payload.payee?.phoneNumber
                ),
                'phoneNumber',
                MAX_PHONE_LENGTH
            );

        /**
         * ---------------------------------------------------------------------
         * Transaction type
         * ---------------------------------------------------------------------
         */

        const transactionType =
            normalizeOptionalString(
                this.firstDefined(
                    payload.transactionType,
                    payload.type,
                    payload.serviceType,
                    context.transactionType
                ),
                'transactionType',
                MAX_TRANSACTION_TYPE_LENGTH
            );

        /**
         * ---------------------------------------------------------------------
         * Customer / account context
         * ---------------------------------------------------------------------
         */

        const customerId =
            normalizeOptionalString(
                this.firstDefined(
                    payload.customerId,
                    payload.customerID,
                    context.customerId
                ),
                'customerId',
                MAX_CUSTOMER_ID_LENGTH
            );

        const loanId =
            normalizeOptionalString(
                this.firstDefined(
                    payload.loanId,
                    payload.loanID,
                    context.loanId
                ),
                'loanId',
                MAX_LOAN_ID_LENGTH
            );

        const savingsAccountId =
            normalizeOptionalString(
                this.firstDefined(
                    payload.savingsAccountId,
                    payload.savingsAccountID,
                    context.savingsAccountId
                ),
                'savingsAccountId',
                MAX_SAVINGS_ACCOUNT_ID_LENGTH
            );

        /**
         * ---------------------------------------------------------------------
         * Reason / provider message
         * ---------------------------------------------------------------------
         */

        const reason =
            normalizeOptionalString(
                this.firstDefined(
                    payload.reason,
                    payload.message,
                    payload.errorMessage,
                    payload.financialTransactionStatus
                ),
                'reason',
                MAX_REASON_LENGTH
            );

        /**
         * ---------------------------------------------------------------------
         * Timestamp
         * ---------------------------------------------------------------------
         */

        const timestamp =
            parseTimestamp(
                this.firstDefined(
                    payload.timestamp,
                    payload.createdAt,
                    payload.updatedAt,
                    payload.eventTime,
                    payload.eventTimestamp
                )
            );

        /**
         * ---------------------------------------------------------------------
         * Request / correlation
         * ---------------------------------------------------------------------
         */

        const requestId =
            normalizeOptionalString(
                context.requestId ||
                    payload.requestId ||
                    payload.requestID,
                'requestId',
                MAX_REQUEST_ID_LENGTH
            );

        const correlationId =
            normalizeOptionalString(
                context.correlationId ||
                    payload.correlationId ||
                    payload.correlationID,
                'correlationId',
                MAX_CORRELATION_ID_LENGTH
            );

        /**
         * ---------------------------------------------------------------------
         * Build canonical representation
         * ---------------------------------------------------------------------
         */

        const normalized = {
            callbackId,

            provider:
                this.provider,

            tenantId,

            providerReference:
                normalizedProviderReference,

            externalId:
                normalizedExternalId,

            reference,

            status:
                normalizedStatus,

            providerStatus:
                providerStatus
                    ? String(
                        providerStatus
                    ).trim()
                    : null,

            amount,

            currency,

            phoneNumber,

            transactionType,

            customerId,

            loanId,

            savingsAccountId,

            reason,

            timestamp,

            receivedAt:
                new Date(),

            /**
             * Raw evidence is preserved.
             *
             * Persistence/security policy decides what is eventually stored.
             */
            rawPayload:
                payload,

            context: {
                requestId,

                correlationId,

                /**
                 * The signature itself should generally NOT be persisted into
                 * the canonical callback object. Keep only verification state
                 * and algorithm/result in the verification layer.
                 */
                signaturePresent:
                    Boolean(
                        context.signature
                    ),

                signatureVerified:
                    context.signatureVerified === true,
            },
        };

        /**
         * ---------------------------------------------------------------------
         * Canonical fingerprint
         * ---------------------------------------------------------------------
         *
         * Excludes the raw object ordering and transient receivedAt value.
         */
        normalized.payloadFingerprint =
            this.createPayloadFingerprint(
                payload
            );

        /**
         * ---------------------------------------------------------------------
         * Canonical idempotency key
         * ---------------------------------------------------------------------
         */

        normalized.idempotencyKey =
            this.generateIdempotencyKey(
                normalized
            );

        return Object.freeze(
            normalized
        );
    }

    /**
     * =========================================================================
     * Status Normalization
     * =========================================================================
     */

    normalizeStatus(
        status
    ) {

        const normalized =
            String(
                status || ''
            )
                .trim()
                .toUpperCase();

        if (
            [
                'SUCCESS',
                'SUCCESSFUL',
                'COMPLETED',
                'COMPLETE',
                'SUCCESSFULL',
                'SUCCESSFULLY_COMPLETED',
                'SUCCESSFUL_TRANSACTION',
            ].includes(
                normalized
            )
        ) {
            return STATUS.SUCCESSFUL;
        }

        if (
            [
                'FAILED',
                'FAILURE',
                'REJECTED',
                'DECLINED',
                'CANCELLED',
                'CANCELED',
            ].includes(
                normalized
            )
        ) {
            return STATUS.FAILED;
        }

        if (
            [
                'REVERSED',
                'REVERSAL',
                'REVERSED_TRANSACTION',
            ].includes(
                normalized
            )
        ) {
            return STATUS.REVERSED;
        }

        if (
            [
                'PENDING',
                'PROCESSING',
                'IN_PROGRESS',
                'IN-PROGRESS',
                'QUEUED',
                'ACCEPTED',
            ].includes(
                normalized
            )
        ) {
            return STATUS.PENDING;
        }

        return STATUS.UNKNOWN;
    }

    /**
     * =========================================================================
     * First Defined
     * =========================================================================
     */

    firstDefined(
        ...values
    ) {
        for (
            const value of values
        ) {
            if (
                value !== undefined &&
                value !== null &&
                value !== ''
            ) {
                return value;
            }
        }

        return null;
    }

    /**
     * =========================================================================
     * Number Compatibility Helper
     * =========================================================================
     *
     * Kept for backward compatibility.
     *
     * New code should use normalizeAmount(), which preserves decimal
     * representation rather than forcing a floating-point number.
     * =========================================================================
     */

    toNumber(
        value
    ) {
        if (
            value === undefined ||
            value === null ||
            value === ''
        ) {
            return null;
        }

        const amount =
            Number(value);

        return Number.isFinite(
            amount
        )
            ? amount
            : null;
    }

    /**
     * =========================================================================
     * Timestamp Compatibility Helper
     * =========================================================================
     */

    parseTimestamp(
        value
    ) {
        return parseTimestamp(
            value
        );
    }

    /**
     * =========================================================================
     * Generate Callback ID
     * =========================================================================
     *
     * Callback IDs must be deterministic for replayed callbacks with the same
     * canonical identity.
     * =========================================================================
     */

    generateCallbackId(
        data
    ) {

        const canonical = {
            provider:
                this.provider,

            tenantId:
                data.tenantId ||
                null,

            providerReference:
                data.providerReference ||
                null,

            externalId:
                data.externalId ||
                null,

            providerStatus:
                data.providerStatus ||
                null,
        };

        return crypto
            .createHash(
                'sha256'
            )
            .update(
                stableSerialize(
                    canonical
                ),
                'utf8'
            )
            .digest('hex');
    }

    /**
     * =========================================================================
     * Generate Idempotency Key
     * =========================================================================
     *
     * CallbackId is preferred because it is the canonical provider callback
     * identity.
     * =========================================================================
     */

    generateIdempotencyKey(
        normalized
    ) {

        const canonical = {
            provider:
                this.provider,

            tenantId:
                normalized.tenantId ||
                null,

            callbackId:
                normalized.callbackId,

            providerReference:
                normalized.providerReference ||
                null,

            externalId:
                normalized.externalId ||
                null,
        };

        return [
            this.provider,
            'CALLBACK',
            crypto
                .createHash(
                    'sha256'
                )
                .update(
                    stableSerialize(
                        canonical
                    ),
                    'utf8'
                )
                .digest('hex')
        ].join(':');
    }

    /**
     * =========================================================================
     * Payload Fingerprint
     * =========================================================================
     */

    createPayloadFingerprint(
        payload
    ) {

        return crypto
            .createHash(
                'sha256'
            )
            .update(
                stableSerialize(
                    payload
                ),
                'utf8'
            )
            .digest('hex');
    }

    /**
     * =========================================================================
     * Static Validation Helpers
     * =========================================================================
     */

    static isSuccessful(
        status
    ) {

        return (
            this.STATUS.SUCCESSFUL ===
            String(
                status || ''
            )
                .trim()
                .toUpperCase()
        );
    }

    static isFailed(
        status
    ) {

        return (
            this.STATUS.FAILED ===
            String(
                status || ''
            )
                .trim()
                .toUpperCase()
        );
    }

    static isPending(
        status
    ) {

        return (
            this.STATUS.PENDING ===
            String(
                status || ''
            )
                .trim()
                .toUpperCase()
        );
    }

}

/**
 * ============================================================================
 * Public Constants
 * ============================================================================
 */

MTNCallbackNormalizer.STATUS =
    STATUS;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    MTNCallbackNormalizer;