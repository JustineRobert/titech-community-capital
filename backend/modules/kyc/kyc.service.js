
/**
 * ============================================================================
 * TITech Community Capital LTD
 * KYC Identity Verification Service
 * ============================================================================
 *
 * File:
 * services/kyc.service.js
 *
 * Enterprise KYC Provider Integration
 *
 * Responsibilities:
 *   - Validate identity verification requests.
 *   - Integrate with external KYC providers.
 *   - Normalize provider responses.
 *   - Protect personally identifiable information (PII).
 *   - Classify provider failures.
 *   - Support safe retries for transient failures.
 *   - Support request/correlation tracing.
 *   - Provide deterministic service responses.
 *
 * Design Principles:
 *   - Provider agnostic at the service boundary.
 *   - No persistence logic.
 *   - No raw NIN logging.
 *   - No provider response leakage.
 *   - Explicit timeout handling.
 *   - Retry only transient failures.
 *   - Backward-compatible verifyIdentity() API.
 *
 * ============================================================================
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');

const logger = require('../../utils/logger');

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const SERVICE_NAME = 'KYCService';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

const BASE_URL = (
    process.env.KYC_PROVIDER_URL || ''
).trim().replace(/\/+$/, '');

const API_KEY = (
    process.env.KYC_API_KEY || ''
).trim();

const TIMEOUT_MS = normalizePositiveInteger(
    process.env.KYC_PROVIDER_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
);

const MAX_RETRIES = normalizeNonNegativeInteger(
    process.env.KYC_PROVIDER_MAX_RETRIES,
    DEFAULT_MAX_RETRIES
);

const RETRY_DELAY_MS = normalizeNonNegativeInteger(
    process.env.KYC_PROVIDER_RETRY_DELAY_MS,
    DEFAULT_RETRY_DELAY_MS
);

/**
 * ============================================================================
 * Public Statuses
 * ============================================================================
 */

const KYC_STATUS = Object.freeze({

    VERIFIED:
        'verified',

    FAILED:
        'failed',

    PENDING:
        'pending',

    REJECTED:
        'rejected',

    UNAVAILABLE:
        'unavailable',

    TIMEOUT:
        'timeout',

    ERROR:
        'error'

});

/**
 * ============================================================================
 * Error Codes
 * ============================================================================
 */

const KYC_ERROR_CODES = Object.freeze({

    INVALID_INPUT:
        'KYC_INVALID_INPUT',

    CONFIGURATION_ERROR:
        'KYC_CONFIGURATION_ERROR',

    PROVIDER_TIMEOUT:
        'KYC_PROVIDER_TIMEOUT',

    PROVIDER_UNAVAILABLE:
        'KYC_PROVIDER_UNAVAILABLE',

    PROVIDER_REJECTED:
        'KYC_PROVIDER_REJECTED',

    PROVIDER_ERROR:
        'KYC_PROVIDER_ERROR',

    INVALID_RESPONSE:
        'KYC_INVALID_PROVIDER_RESPONSE',

    INTERNAL_ERROR:
        'KYC_INTERNAL_ERROR'

});

/**
 * ============================================================================
 * Verify Identity
 * ============================================================================
 *
 * Backward-compatible public API.
 *
 * @param {Object} params
 * @param {string} params.firstName
 * @param {string} params.lastName
 * @param {string} params.nin
 * @param {string} [params.tenantId]
 * @param {string} [params.requestId]
 * @param {string} [params.correlationId]
 * @param {string} [params.idempotencyKey]
 *
 * @returns {Promise<Object>}
 */

async function verifyIdentity({

    firstName,

    lastName,

    nin,

    tenantId = null,

    requestId = null,

    correlationId = null,

    idempotencyKey = null

} = {}) {

    const operationId = crypto.randomUUID();

    const startedAt = Date.now();

    const context = {

        operationId,

        tenantId: sanitizeIdentifier(tenantId),

        requestId: sanitizeIdentifier(requestId),

        correlationId:
            sanitizeIdentifier(correlationId),

        idempotencyKey:
            sanitizeIdentifier(idempotencyKey)

    };

    try {

        validateConfiguration();

        const identity = normalizeIdentityInput({

            firstName,

            lastName,

            nin

        });

        logInfo(
            'KYC verification started',
            {
                ...context
            }
        );

        const response =
            await requestProviderVerification({

                identity,

                context

            });

        const normalized =
            normalizeProviderResponse(
                response
            );

        const durationMs =
            Date.now() - startedAt;

        logInfo(
            'KYC verification completed',
            {

                ...context,

                status:
                    normalized.status,

                durationMs

            }
        );

        return {

            success:
                normalized.status ===
                KYC_STATUS.VERIFIED,

            status:
                normalized.status,

            matchScore:
                normalized.matchScore,

            reason:
                normalized.reason,

            providerReference:
                normalized.providerReference,

            operationId,

            durationMs

        };

    } catch (error) {

        return handleVerificationError({

            error,

            context,

            startedAt

        });

    }

}

/**
 * ============================================================================
 * Provider Request
 * ============================================================================
 */

async function requestProviderVerification({

    identity,

    context

}) {

    const url =
        `${BASE_URL}/verify`;

    const payload = {

        firstName:
            identity.firstName,

        lastName:
            identity.lastName,

        idNumber:
            identity.nin

    };

    let attempt = 0;

    while (true) {

        try {

            return await axios.post(

                url,

                payload,

                {

                    timeout:
                        TIMEOUT_MS,

                    headers: {

                        Authorization:
                            `Bearer ${API_KEY}`,

                        'Content-Type':
                            'application/json',

                        Accept:
                            'application/json',

                        'X-Request-Id':
                            context.requestId ||
                            context.operationId,

                        'X-Correlation-Id':
                            context.correlationId ||
                            context.operationId,

                        'X-Idempotency-Key':
                            context.idempotencyKey ||
                            context.operationId

                    },

                    validateStatus:
                        () => true

                }

            );

        } catch (error) {

            if (
                !isRetryableProviderError(error) ||
                attempt >= MAX_RETRIES
            ) {

                throw error;

            }

            attempt += 1;

            const delay =
                calculateRetryDelay(attempt);

            logWarn(
                'Retrying KYC provider request',
                {

                    ...context,

                    attempt,

                    maxRetries:
                        MAX_RETRIES,

                    delayMs:
                        delay,

                    errorCode:
                        error.code || null

                }
            );

            await sleep(delay);

        }

    }

}

/**
 * ============================================================================
 * Normalize Identity Input
 * ============================================================================
 */

function normalizeIdentityInput({

    firstName,

    lastName,

    nin

}) {

    if (
        typeof firstName !== 'string' ||
        typeof lastName !== 'string' ||
        typeof nin !== 'string'
    ) {

        throw createKycError(

            KYC_ERROR_CODES.INVALID_INPUT,

            'Identity verification fields are invalid'

        );

    }

    const normalizedFirstName =
        firstName.trim();

    const normalizedLastName =
        lastName.trim();

    const normalizedNin =
        nin.trim().toUpperCase();

    if (
        !normalizedFirstName ||
        !normalizedLastName ||
        !normalizedNin
    ) {

        throw createKycError(

            KYC_ERROR_CODES.INVALID_INPUT,

            'First name, last name and national ID are required'

        );

    }

    if (
        normalizedFirstName.length > 100 ||
        normalizedLastName.length > 100
    ) {

        throw createKycError(

            KYC_ERROR_CODES.INVALID_INPUT,

            'Identity name exceeds maximum length'

        );

    }

    if (
        normalizedNin.length > 64
    ) {

        throw createKycError(

            KYC_ERROR_CODES.INVALID_INPUT,

            'National ID exceeds maximum length'

        );

    }

    return {

        firstName:
            normalizedFirstName,

        lastName:
            normalizedLastName,

        nin:
            normalizedNin

    };

}

/**
 * ============================================================================
 * Normalize Provider Response
 * ============================================================================
 */

function normalizeProviderResponse(response) {

    if (
        !response ||
        !response.data ||
        typeof response.data !== 'object'
    ) {

        throw createKycError(

            KYC_ERROR_CODES.INVALID_RESPONSE,

            'Invalid response from KYC provider'

        );

    }

    const data =
        response.data;

    const status =
        normalizeStatus(data.status);

    const matchScore =
        normalizeMatchScore(
            data.matchScore
        );

    const providerReference =
        firstDefined(

            data.reference,

            data.referenceId,

            data.transactionId,

            data.requestId

        );

    const reason =
        normalizeProviderReason(data);

    if (
        response.status >= 500
    ) {

        throw createKycError(

            KYC_ERROR_CODES.PROVIDER_UNAVAILABLE,

            'KYC provider temporarily unavailable'

        );

    }

    if (
        response.status === 408 ||
        response.status === 504
    ) {

        throw createKycError(

            KYC_ERROR_CODES.PROVIDER_TIMEOUT,

            'KYC provider request timed out'

        );

    }

    if (
        response.status >= 400
    ) {

        return {

            status:
                KYC_STATUS.FAILED,

            matchScore,

            reason:
                reason ||
                'Identity verification failed',

            providerReference

        };

    }

    return {

        status,

        matchScore,

        reason,

        providerReference

    };

}

/**
 * ============================================================================
 * Normalize Provider Status
 * ============================================================================
 */

function normalizeStatus(status) {

    if (
        typeof status !== 'string'
    ) {

        return KYC_STATUS.FAILED;

    }

    switch (
        status.trim().toUpperCase()
    ) {

        case 'VERIFIED':
        case 'SUCCESS':
        case 'SUCCESSFUL':
        case 'MATCHED':
        case 'APPROVED':
            return KYC_STATUS.VERIFIED;

        case 'PENDING':
        case 'PROCESSING':
        case 'IN_PROGRESS':
            return KYC_STATUS.PENDING;

        case 'REJECTED':
        case 'DECLINED':
        case 'NOT_MATCHED':
            return KYC_STATUS.REJECTED;

        default:
            return KYC_STATUS.FAILED;

    }

}

/**
 * ============================================================================
 * Normalize Match Score
 * ============================================================================
 */

function normalizeMatchScore(value) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return 0;

    }

    const score =
        Number(value);

    if (
        !Number.isFinite(score)
    ) {

        return 0;

    }

    return Math.min(
        100,
        Math.max(
            0,
            Number(score.toFixed(2))
        )
    );

}

/**
 * ============================================================================
 * Normalize Provider Reason
 * ============================================================================
 */

function normalizeProviderReason(data) {

    return firstDefined(

        data.reason,

        data.message,

        data.description,

        data.error?.message,

        null

    );

}

/**
 * ============================================================================
 * Error Handling
 * ============================================================================
 */

function handleVerificationError({

    error,

    context,

    startedAt

}) {

    const durationMs =
        Date.now() - startedAt;

    const normalized =
        normalizeError(error);

    logError(
        'KYC verification failed',
        {

            ...context,

            code:
                normalized.code,

            durationMs,

            /**
             * Deliberately exclude:
             * - NIN
             * - firstName
             * - lastName
             * - provider payload
             * - authorization headers
             */

            providerStatus:
                error?.response?.status ||
                null

        }
    );

    return {

        success:
            false,

        status:
            normalized.status,

        matchScore:
            0,

        reason:
            normalized.reason,

        code:
            normalized.code,

        retryable:
            normalized.retryable,

        operationId:
            context.operationId,

        durationMs

    };

}

/**
 * ============================================================================
 * Error Normalization
 * ============================================================================
 */

function normalizeError(error) {

    if (
        error?.code &&
        Object.values(
            KYC_ERROR_CODES
        ).includes(error.code)
    ) {

        return {

            code:
                error.code,

            status:
                statusForErrorCode(
                    error.code
                ),

            reason:
                error.message ||
                'KYC verification failed',

            retryable:
                isRetryableErrorCode(
                    error.code
                )

        };

    }

    if (
        error?.code ===
        'ECONNABORTED' ||
        error?.code ===
        'ETIMEDOUT'
    ) {

        return {

            code:
                KYC_ERROR_CODES.PROVIDER_TIMEOUT,

            status:
                KYC_STATUS.TIMEOUT,

            reason:
                'KYC provider timeout',

            retryable:
                true

        };

    }

    if (
        error?.response?.status >= 500
    ) {

        return {

            code:
                KYC_ERROR_CODES.PROVIDER_UNAVAILABLE,

            status:
                KYC_STATUS.UNAVAILABLE,

            reason:
                'KYC provider temporarily unavailable',

            retryable:
                true

        };

    }

    if (
        error?.response?.status === 408 ||
        error?.response?.status === 429 ||
        error?.response?.status === 504
    ) {

        return {

            code:
                KYC_ERROR_CODES.PROVIDER_TIMEOUT,

            status:
                KYC_STATUS.TIMEOUT,

            reason:
                'KYC provider request could not be completed',

            retryable:
                true

        };

    }

    return {

        code:
            KYC_ERROR_CODES.INTERNAL_ERROR,

        status:
            KYC_STATUS.ERROR,

        reason:
            'KYC verification could not be completed',

        retryable:
            false

    };

}

/**
 * ============================================================================
 * Retry Classification
 * ============================================================================
 */

function isRetryableProviderError(error) {

    if (
        !error
    ) {

        return false;

    }

    if (
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.code === 'EAI_AGAIN'
    ) {

        return true;

    }

    const status =
        error.response?.status;

    return (
        status === 408 ||
        status === 429 ||
        status >= 500
    );

}

/**
 * ============================================================================
 * Configuration Validation
 * ============================================================================
 */

function validateConfiguration() {

    if (
        !BASE_URL
    ) {

        throw createKycError(

            KYC_ERROR_CODES.CONFIGURATION_ERROR,

            'KYC provider URL is not configured'

        );

    }

    if (
        !API_KEY
    ) {

        throw createKycError(

            KYC_ERROR_CODES.CONFIGURATION_ERROR,

            'KYC provider credentials are not configured'

        );

    }

}

/**
 * ============================================================================
 * Error Factory
 * ============================================================================
 */

function createKycError(

    code,

    message

) {

    const error =
        new Error(message);

    error.code =
        code;

    return error;

}

/**
 * ============================================================================
 * Error Code → Status
 * ============================================================================
 */

function statusForErrorCode(code) {

    switch (code) {

        case KYC_ERROR_CODES.PROVIDER_TIMEOUT:
            return KYC_STATUS.TIMEOUT;

        case KYC_ERROR_CODES.PROVIDER_UNAVAILABLE:
            return KYC_STATUS.UNAVAILABLE;

        case KYC_ERROR_CODES.PROVIDER_REJECTED:
            return KYC_STATUS.REJECTED;

        case KYC_ERROR_CODES.INVALID_INPUT:
        case KYC_ERROR_CODES.CONFIGURATION_ERROR:
        case KYC_ERROR_CODES.INVALID_RESPONSE:
        case KYC_ERROR_CODES.PROVIDER_ERROR:
        case KYC_ERROR_CODES.INTERNAL_ERROR:
        default:
            return KYC_STATUS.ERROR;

    }

}

/**
 * ============================================================================
 * Retryable Error Codes
 * ============================================================================
 */

function isRetryableErrorCode(code) {

    return (

        code ===
            KYC_ERROR_CODES.PROVIDER_TIMEOUT ||

        code ===
            KYC_ERROR_CODES.PROVIDER_UNAVAILABLE

    );

}

/**
 * ============================================================================
 * Logging Helpers
 * ============================================================================
 *
 * IMPORTANT:
 * Never log NIN or complete identity payloads.
 */

function logInfo(message, metadata = {}) {

    if (
        typeof logger?.info === 'function'
    ) {

        logger.info(

            `[${SERVICE_NAME}] ${message}`,

            metadata

        );

    }

}

function logWarn(message, metadata = {}) {

    if (
        typeof logger?.warn === 'function'
    ) {

        logger.warn(

            `[${SERVICE_NAME}] ${message}`,

            metadata

        );

    }

}

function logError(message, metadata = {}) {

    if (
        typeof logger?.error === 'function'
    ) {

        logger.error(

            `[${SERVICE_NAME}] ${message}`,

            metadata

        );

    }

}

/**
 * ============================================================================
 * Identifier Sanitization
 * ============================================================================
 */

function sanitizeIdentifier(value) {

    if (
        value === undefined ||
        value === null
    ) {

        return null;

    }

    const normalized =
        String(value).trim();

    if (
        !normalized
    ) {

        return null;

    }

    return normalized.substring(
        0,
        256
    );

}

/**
 * ============================================================================
 * Generic Helpers
 * ============================================================================
 */

function firstDefined(...values) {

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

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

}

function calculateRetryDelay(attempt) {

    const exponential =
        RETRY_DELAY_MS *
        Math.pow(
            2,
            attempt - 1
        );

    const jitter =
        Math.floor(
            Math.random() *
            Math.max(
                1,
                RETRY_DELAY_MS
            )
        );

    return Math.min(
        5000,
        exponential + jitter
    );

}

function normalizePositiveInteger(

    value,

    fallback

) {

    const parsed =
        Number(value);

    return Number.isInteger(parsed) &&
        parsed > 0

        ? parsed

        : fallback;

}

function normalizeNonNegativeInteger(

    value,

    fallback

) {

    const parsed =
        Number(value);

    return Number.isInteger(parsed) &&
        parsed >= 0

        ? parsed

        : fallback;

}

/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 */

module.exports = {

    verifyIdentity,

    KYC_STATUS,

    KYC_ERROR_CODES

};