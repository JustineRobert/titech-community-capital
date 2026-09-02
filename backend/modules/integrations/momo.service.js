
/**
 * ============================================================================
 * TITech Community Capital LTD
 * MoMo Service
 * ============================================================================
 *
 * File:
 *   services/momo.service.js
 *
 * Enterprise Mobile Money Provider Orchestration Service
 *
 * Responsibilities:
 *
 *   - Provider-agnostic mobile-money orchestration.
 *   - Collections.
 *   - Disbursements / withdrawals.
 *   - Transaction status queries.
 *   - Callback/webhook normalization.
 *   - Idempotency enforcement.
 *   - Correlation/request tracking.
 *   - Retry-safe HTTP execution.
 *   - Timeout protection.
 *   - Provider selection.
 *   - Provider failure normalization.
 *   - Audit-safe structured logging.
 *   - Settlement/reconciliation integration hooks.
 *
 * Supported lifecycle:
 *
 *   REQUEST
 *      |
 *      v
 *   IDEMPOTENCY
 *      |
 *      v
 *   PROVIDER SELECTION
 *      |
 *      v
 *   PROVIDER API
 *      |
 *      +--------------------+
 *      |                    |
 *      v                    v
 *   CALLBACK             STATUS QUERY
 *      |                    |
 *      +---------+----------+
 *                |
 *                v
 *          RECONCILIATION
 *                |
 *                v
 *             SETTLEMENT
 *
 * Design principles:
 *
 *   - Provider agnostic.
 *   - Backwards compatible.
 *   - No financial ledger mutation inside provider transport.
 *   - No secrets in logs.
 *   - Explicit idempotency.
 *   - Retry only where safe.
 *   - Distributed-processing aware.
 *   - Tenant isolated.
 *   - Operationally observable.
 *   - Safe for asynchronous callbacks.
 *
 * ============================================================================
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');

const idempotency = require('../utils/idempotency');

let logger;

try {
    // eslint-disable-next-line global-require
    logger = require('../utils/logger');
} catch (error) {
    logger = console;
}

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 86_400;

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

const MAX_AMOUNT = Number(
    process.env.MOMO_MAX_TRANSACTION_AMOUNT || Number.MAX_SAFE_INTEGER
);

const DEFAULT_CURRENCY =
    process.env.MOMO_DEFAULT_CURRENCY || 'UGX';

const DEFAULT_ENVIRONMENT =
    process.env.MOMO_ENV || 'sandbox';

const DEFAULT_PROVIDER =
    process.env.MOMO_PROVIDER || 'mtn';

const MOMO_BASE_URL =
    process.env.MOMO_BASE_URL || '';

const MOMO_API_KEY =
    process.env.MOMO_API_KEY || '';

const MOMO_TOKEN =
    process.env.MTN_TOKEN || '';

/**
 * ============================================================================
 * Lifecycle Constants
 * ============================================================================
 */

const MOMO_STATUS = Object.freeze({

    ACCEPTED: 'ACCEPTED',

    PENDING: 'PENDING',

    SUCCESSFUL: 'SUCCESSFUL',

    FAILED: 'FAILED',

    REVERSED: 'REVERSED',

    UNKNOWN: 'UNKNOWN'

});

const MOMO_OPERATION = Object.freeze({

    COLLECTION: 'COLLECTION',

    DISBURSEMENT: 'DISBURSEMENT',

    STATUS_QUERY: 'STATUS_QUERY',

    CALLBACK: 'CALLBACK',

    REVERSAL: 'REVERSAL'

});

/**
 * ============================================================================
 * Provider Registry
 * ============================================================================
 *
 * Providers may be registered at application bootstrap without modifying
 * this service.
 */

const providers = new Map();

/**
 * ============================================================================
 * Error Classes
 * ============================================================================
 */

class MoMoServiceError extends Error {

    constructor(
        message,
        {
            code = 'MOMO_SERVICE_ERROR',
            provider = null,
            operation = null,
            tenantId = null,
            reference = null,
            correlationId = null,
            retryable = false,
            statusCode = null,
            cause = null,
            details = {}
        } = {}
    ) {

        super(message);

        this.name = 'MoMoServiceError';

        this.code = code;

        this.provider = provider;

        this.operation = operation;

        this.tenantId = tenantId;

        this.reference = reference;

        this.correlationId = correlationId;

        this.retryable = Boolean(retryable);

        this.statusCode = statusCode;

        this.details = details;

        this.cause = cause;

        this.timestamp = new Date();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(
                this,
                this.constructor
            );
        }
    }

    toJSON() {

        return {

            name: this.name,

            code: this.code,

            message: this.message,

            provider: this.provider,

            operation: this.operation,

            tenantId: this.tenantId,

            reference: this.reference,

            correlationId: this.correlationId,

            retryable: this.retryable,

            statusCode: this.statusCode,

            details: this.details,

            timestamp: this.timestamp
        };
    }
}

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function generateReference(prefix = 'MOMO') {

    return `${prefix}-${crypto.randomUUID()}`;
}

function generateCorrelationId(existing) {

    return existing ||
        crypto.randomUUID();
}

function normalizeAmount(amount) {

    const numericAmount = Number(amount);

    if (
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0
    ) {

        throw new MoMoServiceError(
            'Amount must be a positive finite number',
            {
                code: 'INVALID_AMOUNT'
            }
        );
    }

    if (numericAmount > MAX_AMOUNT) {

        throw new MoMoServiceError(
            'Transaction amount exceeds configured limit',
            {
                code: 'AMOUNT_LIMIT_EXCEEDED',
                details: {
                    maximum: MAX_AMOUNT
                }
            }
        );
    }

    return Number(
        numericAmount.toFixed(2)
    );
}

function normalizePhone(phone) {

    if (
        phone === undefined ||
        phone === null
    ) {

        throw new MoMoServiceError(
            'Phone number is required',
            {
                code: 'INVALID_PHONE'
            }
        );
    }

    const normalized =
        String(phone)
            .trim()
            .replace(/\s+/g, '');

    if (!normalized) {

        throw new MoMoServiceError(
            'Phone number is required',
            {
                code: 'INVALID_PHONE'
            }
        );
    }

    return normalized;
}

function normalizeCurrency(currency) {

    const normalized =
        String(
            currency || DEFAULT_CURRENCY
        )
            .trim()
            .toUpperCase();

    if (!/^[A-Z]{3}$/.test(normalized)) {

        throw new MoMoServiceError(
            'Invalid currency code',
            {
                code: 'INVALID_CURRENCY'
            }
        );
    }

    return normalized;
}

function sanitizeError(error) {

    if (!error) {
        return null;
    }

    return {

        message:
            error.message || 'Unknown error',

        status:
            error.response?.status || null,

        providerCode:
            error.response?.data?.code ||
            error.response?.data?.status ||
            null,

        providerMessage:
            error.response?.data?.message ||
            error.response?.data?.reason ||
            null
    };
}

function isRetryableHttpError(error) {

    const status =
        error?.response?.status;

    if (!status) {

        return true;
    }

    return (
        status === 408 ||
        status === 425 ||
        status === 429 ||
        status >= 500
    );
}

function sleep(milliseconds) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );
}

/**
 * ============================================================================
 * Logging Helpers
 * ============================================================================
 *
 * Never log access tokens, API keys, authorization headers, or raw callback
 * payloads.
 */

function safeLogInfo(message, context = {}) {

    try {

        if (
            logger &&
            typeof logger.info === 'function'
        ) {

            logger.info(
                message,
                sanitizeLogContext(context)
            );
        }

    } catch (error) {
        // Logging must never break financial processing.
    }
}

function safeLogError(message, context = {}) {

    try {

        if (
            logger &&
            typeof logger.error === 'function'
        ) {

            logger.error(
                message,
                sanitizeLogContext(context)
            );
        }

    } catch (error) {
        // Logging must never break financial processing.
    }
}

function sanitizeLogContext(context = {}) {

    const output = {
        ...context
    };

    delete output.token;

    delete output.accessToken;

    delete output.apiKey;

    delete output.authorization;

    delete output.headers;

    delete output.payload;

    delete output.rawPayload;

    return output;
}

/**
 * ============================================================================
 * MoMoService
 * ============================================================================
 */

class MoMoService {

    /**
     * @param {Object} options
     */

    constructor({

        provider = DEFAULT_PROVIDER,

        timeoutMs = DEFAULT_TIMEOUT_MS,

        maxRetries = DEFAULT_MAX_RETRIES,

        retryDelayMs = DEFAULT_RETRY_DELAY_MS,

        idempotencyStore = idempotency,

        httpClient = axios,

        auditService = null,

        reconciliationService = null

    } = {}) {

        this.defaultProvider =
            String(provider)
                .trim()
                .toLowerCase();

        this.timeoutMs =
            timeoutMs;

        this.maxRetries =
            maxRetries;

        this.retryDelayMs =
            retryDelayMs;

        this.idempotency =
            idempotencyStore;

        this.http =
            httpClient;

        this.auditService =
            auditService;

        this.reconciliationService =
            reconciliationService;

        this.providers =
            providers;
    }

    /**
     * ========================================================================
     * Provider Registration
     * ========================================================================
     */

    registerProvider(
        name,
        adapter
    ) {

        if (!name) {

            throw new MoMoServiceError(
                'Provider name is required',
                {
                    code: 'PROVIDER_NAME_REQUIRED'
                }
            );
        }

        if (!adapter || typeof adapter !== 'object') {

            throw new MoMoServiceError(
                'Provider adapter is required',
                {
                    code: 'PROVIDER_ADAPTER_REQUIRED'
                }
            );
        }

        this.providers.set(
            String(name).toLowerCase(),
            adapter
        );

        return this;
    }

    unregisterProvider(name) {

        return this.providers.delete(
            String(name).toLowerCase()
        );
    }

    getProvider(name) {

        const providerName =
            String(
                name || this.defaultProvider
            )
                .toLowerCase();

        return (
            this.providers.get(providerName) ||
            null
        );
    }

    /**
     * ========================================================================
     * Initiate Withdrawal
     * ========================================================================
     *
     * Backwards-compatible public API.
     *
     * @param {Object} params
     *
     * @returns {Promise<Object>}
     */

    async initiateWithdraw({

        tenantId,

        phone,

        amount,

        currency = DEFAULT_CURRENCY,

        provider = this.defaultProvider,

        reference = null,

        idempotencyKey = null,

        correlationId = null,

        requestId = null,

        metadata = {},

        description = 'Withdrawal request'

    } = {}) {

        const operation =
            MOMO_OPERATION.DISBURSEMENT;

        const normalizedTenantId =
            this.requireTenantId(tenantId);

        const normalizedPhone =
            normalizePhone(phone);

        const normalizedAmount =
            normalizeAmount(amount);

        const normalizedCurrency =
            normalizeCurrency(currency);

        const resolvedReference =
            reference ||
            generateReference('MOMO-WD');

        const resolvedCorrelationId =
            generateCorrelationId(
                correlationId
            );

        const resolvedIdempotencyKey =
            idempotencyKey ||
            this.generateIdempotencyKey({

                tenantId:
                    normalizedTenantId,

                operation,

                reference:
                    resolvedReference
            });

        const context = {

            tenantId:
                normalizedTenantId,

            provider:
                String(provider).toLowerCase(),

            operation,

            reference:
                resolvedReference,

            correlationId:
                resolvedCorrelationId,

            requestId:
                requestId || null
        };

        try {

            const duplicate =
                await this.checkIdempotency(
                    resolvedIdempotencyKey,
                    context
                );

            if (duplicate) {

                const existing =
                    await this.getIdempotencyRecord(
                        resolvedIdempotencyKey
                    );

                return {

                    accepted: true,

                    duplicate: true,

                    status:
                        existing?.status ||
                        MOMO_STATUS.PENDING,

                    reference:
                        existing?.reference ||
                        resolvedReference,

                    correlationId:
                        resolvedCorrelationId,

                    provider:
                        context.provider
                };
            }

            const providerAdapter =
                this.getProvider(
                    context.provider
                );

            const result =
                providerAdapter
                    ? await this.executeProviderDisbursement(
                        providerAdapter,
                        {
                            tenantId:
                                normalizedTenantId,

                            phone:
                                normalizedPhone,

                            amount:
                                normalizedAmount,

                            currency:
                                normalizedCurrency,

                            reference:
                                resolvedReference,

                            correlationId:
                                resolvedCorrelationId,

                            requestId,

                            metadata,

                            description
                        }
                    )
                    : await this.executeMtnDisbursement({

                        tenantId:
                            normalizedTenantId,

                        phone:
                            normalizedPhone,

                        amount:
                            normalizedAmount,

                        currency:
                            normalizedCurrency,

                        reference:
                            resolvedReference,

                        correlationId:
                            resolvedCorrelationId,

                        requestId,

                        metadata,

                        description
                    });

            const response = {

                accepted: true,

                duplicate: false,

                status:
                    result.status ||
                    MOMO_STATUS.ACCEPTED,

                reference:
                    result.reference ||
                    resolvedReference,

                provider:
                    context.provider,

                correlationId:
                    resolvedCorrelationId,

                requestId:
                    requestId || null,

                transactionId:
                    result.transactionId ||
                    result.financialTransactionId ||
                    null,

                providerTransactionId:
                    result.providerTransactionId ||
                    null
            };

            await this.recordIdempotency(
                resolvedIdempotencyKey,
                response
            );

            await this.audit(
                'MOMO_DISBURSEMENT_INITIATED',
                {
                    ...context,
                    status:
                        response.status
                }
            );

            safeLogInfo(
                '[MoMoService] Withdrawal initiated',
                {
                    ...context,
                    amount:
                        normalizedAmount,
                    currency:
                        normalizedCurrency,
                    phone:
                        this.maskPhone(normalizedPhone),
                    status:
                        response.status
                }
            );

            return response;

        } catch (error) {

            const normalizedError =
                this.normalizeProviderError(
                    error,
                    context
                );

            safeLogError(
                '[MoMoService] Withdrawal failed',
                normalizedError.toJSON()
            );

            throw normalizedError;
        }
    }

    /**
     * ========================================================================
     * Collection
     * ========================================================================
     *
     * Requests money from a customer/mobile-money account.
     */

    async requestCollection({

        tenantId,

        phone,

        amount,

        currency = DEFAULT_CURRENCY,

        provider = this.defaultProvider,

        reference = null,

        idempotencyKey = null,

        correlationId = null,

        requestId = null,

        metadata = {},

        description = 'Payment request'

    } = {}) {

        const normalizedTenantId =
            this.requireTenantId(tenantId);

        const normalizedPhone =
            normalizePhone(phone);

        const normalizedAmount =
            normalizeAmount(amount);

        const normalizedCurrency =
            normalizeCurrency(currency);

        const resolvedReference =
            reference ||
            generateReference('MOMO-COL');

        const resolvedCorrelationId =
            generateCorrelationId(
                correlationId
            );

        const resolvedIdempotencyKey =
            idempotencyKey ||
            this.generateIdempotencyKey({

                tenantId:
                    normalizedTenantId,

                operation:
                    MOMO_OPERATION.COLLECTION,

                reference:
                    resolvedReference
            });

        const context = {

            tenantId:
                normalizedTenantId,

            provider:
                String(provider).toLowerCase(),

            operation:
                MOMO_OPERATION.COLLECTION,

            reference:
                resolvedReference,

            correlationId:
                resolvedCorrelationId,

            requestId:
                requestId || null
        };

        try {

            const duplicate =
                await this.checkIdempotency(
                    resolvedIdempotencyKey,
                    context
                );

            if (duplicate) {

                return {

                    accepted: true,

                    duplicate: true,

                    status:
                        MOMO_STATUS.PENDING,

                    reference:
                        resolvedReference,

                    provider:
                        context.provider,

                    correlationId:
                        resolvedCorrelationId
                };
            }

            const adapter =
                this.getProvider(
                    context.provider
                );

            let result;

            if (
                adapter &&
                typeof adapter.requestCollection === 'function'
            ) {

                result =
                    await adapter.requestCollection({

                        tenantId:
                            normalizedTenantId,

                        phone:
                            normalizedPhone,

                        amount:
                            normalizedAmount,

                        currency:
                            normalizedCurrency,

                        reference:
                            resolvedReference,

                        correlationId:
                            resolvedCorrelationId,

                        requestId,

                        metadata,

                        description
                    });

            } else {

                result =
                    await this.executeMtnCollection({

                        tenantId:
                            normalizedTenantId,

                        phone:
                            normalizedPhone,

                        amount:
                            normalizedAmount,

                        currency:
                            normalizedCurrency,

                        reference:
                            resolvedReference,

                        correlationId:
                            resolvedCorrelationId,

                        requestId,

                        metadata,

                        description
                    });
            }

            const response = {

                accepted: true,

                duplicate: false,

                status:
                    result.status ||
                    MOMO_STATUS.PENDING,

                reference:
                    result.reference ||
                    resolvedReference,

                provider:
                    context.provider,

                correlationId:
                    resolvedCorrelationId,

                transactionId:
                    result.transactionId ||
                    result.financialTransactionId ||
                    null,

                providerTransactionId:
                    result.providerTransactionId ||
                    null
            };

            await this.recordIdempotency(
                resolvedIdempotencyKey,
                response
            );

            await this.audit(
                'MOMO_COLLECTION_INITIATED',
                context
            );

            return response;

        } catch (error) {

            throw this.normalizeProviderError(
                error,
                context
            );
        }
    }

    /**
     * ========================================================================
     * Transaction Status
     * ========================================================================
     */

    async getTransactionStatus({

        reference,

        provider = this.defaultProvider,

        tenantId = null,

        correlationId = null,

        requestId = null

    } = {}) {

        if (!reference) {

            throw new MoMoServiceError(
                'Transaction reference is required',
                {
                    code:
                        'REFERENCE_REQUIRED',

                    operation:
                        MOMO_OPERATION.STATUS_QUERY
                }
            );
        }

        const context = {

            tenantId,

            provider:
                String(provider).toLowerCase(),

            operation:
                MOMO_OPERATION.STATUS_QUERY,

            reference,

            correlationId:
                generateCorrelationId(
                    correlationId
                ),

            requestId
        };

        try {

            const adapter =
                this.getProvider(
                    context.provider
                );

            let result;

            if (
                adapter &&
                typeof adapter.getTransactionStatus === 'function'
            ) {

                result =
                    await adapter.getTransactionStatus(
                        context
                    );

            } else {

                result =
                    await this.executeMtnStatusQuery(
                        context
                    );
            }

            return {

                reference,

                provider:
                    context.provider,

                status:
                    this.normalizeStatus(
                        result?.status
                    ),

                transactionId:
                    result?.transactionId ||
                    null,

                providerTransactionId:
                    result?.providerTransactionId ||
                    null,

                amount:
                    result?.amount ??
                    null,

                currency:
                    result?.currency ||
                    null,

                completedAt:
                    result?.completedAt ||
                    null,

                correlationId:
                    context.correlationId
            };

        } catch (error) {

            throw this.normalizeProviderError(
                error,
                context
            );
        }
    }

    /**
     * ========================================================================
     * Callback / Webhook Normalization
     * ========================================================================
     *
     * Provider adapters should perform provider-specific signature validation
     * before this method is invoked.
     */

    normalizeCallback({

        provider = this.defaultProvider,

        payload,

        headers = {},

        tenantId = null,

        correlationId = null

    } = {}) {

        if (!payload || typeof payload !== 'object') {

            throw new MoMoServiceError(
                'Callback payload required',
                {
                    code:
                        'INVALID_CALLBACK_PAYLOAD',

                    operation:
                        MOMO_OPERATION.CALLBACK
                }
            );
        }

        const adapter =
            this.getProvider(
                provider
            );

        if (
            adapter &&
            typeof adapter.normalizeCallback === 'function'
        ) {

            return adapter.normalizeCallback({

                payload,

                headers,

                tenantId,

                correlationId:
                    generateCorrelationId(
                        correlationId
                    )
            });
        }

        /**
         * Generic normalized callback.
         *
         * Provider-specific adapters should override this.
         */

        return Object.freeze({

            provider:
                String(provider).toLowerCase(),

            tenantId,

            correlationId:
                generateCorrelationId(
                    correlationId
                ),

            reference:
                payload.externalId ||
                payload.reference ||
                payload.transactionId ||
                null,

            providerTransactionId:
                payload.financialTransactionId ||
                payload.transactionId ||
                null,

            status:
                this.normalizeStatus(
                    payload.status
                ),

            amount:
                payload.amount ??
                null,

            currency:
                payload.currency ||
                null,

            receivedAt:
                new Date()
        });
    }

    /**
     * ========================================================================
     * Reconciliation Hook
     * ========================================================================
     */

    async reconcileTransaction({

        tenantId,

        reference,

        provider = this.defaultProvider,

        correlationId = null

    } = {}) {

        const status =
            await this.getTransactionStatus({

                tenantId,

                reference,

                provider,

                correlationId
            });

        if (
            this.reconciliationService &&
            typeof this.reconciliationService.reconcile === 'function'
        ) {

            return this.reconciliationService.reconcile(
                status,
                {
                    tenantId,
                    provider,
                    correlationId:
                        status.correlationId
                }
            );
        }

        return status;
    }

    /**
     * ========================================================================
     * MTN Disbursement
     * ========================================================================
     *
     * Preserves the original implementation's MTN API behavior.
     */

    async executeMtnDisbursement({

        tenantId,

        phone,

        amount,

        currency,

        reference,

        correlationId,

        requestId,

        metadata,

        description

    }) {

        const baseUrl =
            MOMO_BASE_URL;

        const apiKey =
            MOMO_API_KEY;

        const token =
            MOMO_TOKEN;

        if (!baseUrl) {

            throw new MoMoServiceError(
                'MoMo base URL is not configured',
                {
                    code:
                        'MOMO_CONFIGURATION_ERROR',

                    provider:
                        'mtn',

                    operation:
                        MOMO_OPERATION.DISBURSEMENT
                }
            );
        }

        if (!apiKey) {

            throw new MoMoServiceError(
                'MoMo API key is not configured',
                {
                    code:
                        'MOMO_CONFIGURATION_ERROR',

                    provider:
                        'mtn',

                    operation:
                        MOMO_OPERATION.DISBURSEMENT
                }
            );
        }

        if (!token) {

            throw new MoMoServiceError(
                'MoMo access token is not configured',
                {
                    code:
                        'MOMO_CONFIGURATION_ERROR',

                    provider:
                        'mtn',

                    operation:
                        MOMO_OPERATION.DISBURSEMENT
                }
            );
        }

        const payload = {

            amount:
                String(amount),

            currency,

            externalId:
                reference,

            payee: {

                partyIdType:
                    'MSISDN',

                partyId:
                    phone
            },

            payerMessage:
                description,

            payeeNote:
                `Tenant ${tenantId} withdrawal`,

            metadata
        };

        await this.requestWithRetry({

            method:
                'POST',

            url:
                `${baseUrl}/disbursement/v1_0/transfer`,

            data:
                payload,

            headers:
                this.buildMtnHeaders({

                    token,

                    reference,

                    correlationId,

                    requestId,

                    apiKey
                }),

            retryable:
                true,

            provider:
                'mtn',

            operation:
                MOMO_OPERATION.DISBURSEMENT,

            reference
        });

        return {

            accepted: true,

            status:
                MOMO_STATUS.ACCEPTED,

            reference,

            provider:
                'mtn',

            providerTransactionId:
                reference
        };
    }

    /**
     * ========================================================================
     * MTN Collection
     * ========================================================================
     */

    async executeMtnCollection({

        tenantId,

        phone,

        amount,

        currency,

        reference,

        correlationId,

        requestId,

        metadata,

        description

    }) {

        const baseUrl =
            MOMO_BASE_URL;

        const apiKey =
            MOMO_API_KEY;

        const token =
            MOMO_TOKEN;

        if (!baseUrl || !apiKey || !token) {

            throw new MoMoServiceError(
                'MoMo collection configuration is incomplete',
                {
                    code:
                        'MOMO_CONFIGURATION_ERROR',

                    provider:
                        'mtn',

                    operation:
                        MOMO_OPERATION.COLLECTION
                }
            );
        }

        const payload = {

            amount:
                String(amount),

            currency,

            externalId:
                reference,

            payer: {

                partyIdType:
                    'MSISDN',

                partyId:
                    phone
            },

            payerMessage:
                description,

            payeeNote:
                `Tenant ${tenantId} collection`,

            metadata
        };

        await this.requestWithRetry({

            method:
                'POST',

            url:
                `${baseUrl}/collection/v1_0/requesttopay`,

            data:
                payload,

            headers:
                this.buildMtnHeaders({

                    token,

                    reference,

                    correlationId,

                    requestId,

                    apiKey
                }),

            retryable:
                true,

            provider:
                'mtn',

            operation:
                MOMO_OPERATION.COLLECTION,

            reference
        });

        return {

            accepted: true,

            status:
                MOMO_STATUS.PENDING,

            reference,

            provider:
                'mtn',

            providerTransactionId:
                reference
        };
    }

    /**
     * ========================================================================
     * MTN Status Query
     * ========================================================================
     */

    async executeMtnStatusQuery({

        reference,

        correlationId,

        requestId

    }) {

        const baseUrl =
            MOMO_BASE_URL;

        const apiKey =
            MOMO_API_KEY;

        const token =
            MOMO_TOKEN;

        if (!baseUrl || !apiKey || !token) {

            throw new MoMoServiceError(
                'MoMo status-query configuration is incomplete',
                {
                    code:
                        'MOMO_CONFIGURATION_ERROR',

                    provider:
                        'mtn',

                    operation:
                        MOMO_OPERATION.STATUS_QUERY
                }
            );
        }

        const response =
            await this.requestWithRetry({

                method:
                    'GET',

                url:
                    `${baseUrl}/disbursement/v1_0/transfer/${encodeURIComponent(reference)}`,

                headers:
                    this.buildMtnHeaders({

                        token,

                        reference,

                        correlationId,

                        requestId,

                        apiKey
                    }),

                retryable:
                    true,

                provider:
                    'mtn',

                operation:
                    MOMO_OPERATION.STATUS_QUERY,

                reference
            });

        return {

            status:
                response?.data?.status,

            reference,

            providerTransactionId:
                response?.data?.financialTransactionId ||
                reference,

            amount:
                response?.data?.amount ||
                null,

            currency:
                response?.data?.currency ||
                null
        };
    }

    /**
     * ========================================================================
     * Provider Disbursement Execution
     * ========================================================================
     */

    async executeProviderDisbursement(
        adapter,
        params
    ) {

        if (
            typeof adapter.initiateWithdraw !== 'function' &&
            typeof adapter.disburse !== 'function'
        ) {

            throw new MoMoServiceError(
                'Provider does not support disbursement',
                {
                    code:
                        'PROVIDER_OPERATION_UNSUPPORTED',

                    provider:
                        params.provider ||
                        this.defaultProvider,

                    operation:
                        MOMO_OPERATION.DISBURSEMENT
                }
            );
        }

        if (
            typeof adapter.initiateWithdraw === 'function'
        ) {

            return adapter.initiateWithdraw(
                params
            );
        }

        return adapter.disburse(
            params
        );
    }

    /**
     * ========================================================================
     * HTTP Request With Retry
     * ========================================================================
     *
     * Important:
     *
     * Financial operations should only be retried when the request is
     * explicitly idempotent and the provider contract permits retry.
     */

    async requestWithRetry({

        method,

        url,

        data = undefined,

        headers = {},

        retryable = false,

        provider,

        operation,

        reference

    }) {

        let lastError;

        const attempts =
            retryable
                ? this.maxRetries + 1
                : 1;

        for (
            let attempt = 1;
            attempt <= attempts;
            attempt += 1
        ) {

            try {

                return await this.http({

                    method,

                    url,

                    data,

                    headers,

                    timeout:
                        this.timeoutMs,

                    validateStatus:
                        status =>
                            status >= 200 &&
                            status < 300
                });

            } catch (error) {

                lastError =
                    error;

                const shouldRetry =
                    retryable &&
                    attempt < attempts &&
                    isRetryableHttpError(
                        error
                    );

                if (!shouldRetry) {

                    break;
                }

                const delay =
                    this.retryDelayMs *
                    Math.pow(
                        2,
                        attempt - 1
                    );

                await sleep(delay);
            }
        }

        throw new MoMoServiceError(
            'Mobile money provider request failed',
            {
                code:
                    'PROVIDER_REQUEST_FAILED',

                provider,

                operation,

                reference,

                retryable:
                    isRetryableHttpError(
                        lastError
                    ),

                statusCode:
                    lastError?.response?.status ||
                    null,

                details:
                    sanitizeError(
                        lastError
                    ),

                cause:
                    lastError
            }
        );
    }

    /**
     * ========================================================================
     * MTN Headers
     * ========================================================================
     */

    buildMtnHeaders({

        token,

        reference,

        correlationId,

        requestId,

        apiKey

    }) {

        return {

            Authorization:
                `Bearer ${token}`,

            'X-Reference-Id':
                reference,

            'X-Target-Environment':
                DEFAULT_ENVIRONMENT,

            'Ocp-Apim-Subscription-Key':
                apiKey,

            'X-Correlation-Id':
                correlationId,

            'X-Request-Id':
                requestId || correlationId,

            'Content-Type':
                'application/json',

            Accept:
                'application/json'
        };
    }

    /**
     * ========================================================================
     * Idempotency
     * ========================================================================
     */

    generateIdempotencyKey({

        tenantId,

        operation,

        reference

    }) {

        return crypto
            .createHash('sha256')
            .update(
                [
                    tenantId,
                    operation,
                    reference
                ].join('|')
            )
            .digest('hex');
    }

    async checkIdempotency(
        key,
        context
    ) {

        if (
            !this.idempotency ||
            typeof this.idempotency.check !== 'function'
        ) {

            return false;
        }

        const created =
            await this.idempotency.check(
                `momo:${key}`,
                DEFAULT_IDEMPOTENCY_TTL_SECONDS
            );

        if (created) {

            return false;
        }

        safeLogInfo(
            '[MoMoService] Idempotent request detected',
            {
                tenantId:
                    context.tenantId,

                provider:
                    context.provider,

                operation:
                    context.operation,

                reference:
                    context.reference,

                correlationId:
                    context.correlationId
            }
        );

        return true;
    }

    async recordIdempotency(
        key,
        response
    ) {

        if (
            !this.idempotency ||
            typeof this.idempotency.record !== 'function'
        ) {

            return;
        }

        try {

            await this.idempotency.record(

                `momo:${key}`,

                {

                    status:
                        response.status,

                    reference:
                        response.reference,

                    provider:
                        response.provider,

                    transactionId:
                        response.transactionId ||
                        null,

                    providerTransactionId:
                        response.providerTransactionId ||
                        null
                },

                DEFAULT_IDEMPOTENCY_TTL_SECONDS
            );

        } catch (error) {

            /**
             * Do not silently continue in a production financial workflow.
             *
             * The provider request may already have succeeded. Therefore
             * throwing here would create a dangerous "provider succeeded but
             * caller saw failure" scenario.
             *
             * We log the failure for operational reconciliation.
             */

            safeLogError(
                '[MoMoService] Failed recording idempotency metadata',
                {
                    error:
                        sanitizeError(error)
                }
            );
        }
    }

    async getIdempotencyRecord(key) {

        if (
            !this.idempotency ||
            typeof this.idempotency.get !== 'function'
        ) {

            return null;
        }

        try {

            return await this.idempotency.get(
                `momo:${key}`
            );

        } catch (error) {

            safeLogError(
                '[MoMoService] Failed reading idempotency record',
                {
                    error:
                        sanitizeError(error)
                }
            );

            return null;
        }
    }

    /**
     * ========================================================================
     * Audit
     * ========================================================================
     */

    async audit(
        action,
        data
    ) {

        if (
            !this.auditService ||
            typeof this.auditService.log !== 'function'
        ) {

            return;
        }

        try {

            await this.auditService.log({

                action,

                data:
                    sanitizeLogContext(
                        data
                    )
            });

        } catch (error) {

            safeLogError(
                '[MoMoService] Audit logging failed',
                {
                    action,

                    error:
                        sanitizeError(error)
                }
            );
        }
    }

    /**
     * ========================================================================
     * Error Normalization
     * ========================================================================
     */

    normalizeProviderError(
        error,
        context = {}
    ) {

        if (
            error instanceof MoMoServiceError
        ) {

            return error;
        }

        const providerError =
            sanitizeError(error);

        return new MoMoServiceError(

            providerError?.providerMessage ||
            providerError?.message ||
            'Mobile money operation failed',

            {

                code:
                    'MOMO_PROVIDER_ERROR',

                provider:
                    context.provider ||
                    null,

                operation:
                    context.operation ||
                    null,

                tenantId:
                    context.tenantId ||
                    null,

                reference:
                    context.reference ||
                    null,

                correlationId:
                    context.correlationId ||
                    null,

                retryable:
                    isRetryableHttpError(
                        error
                    ),

                statusCode:
                    providerError?.status ||
                    null,

                details:
                    providerError,

                cause:
                    error
            }
        );
    }

    /**
     * ========================================================================
     * Status Normalization
     * ========================================================================
     */

    normalizeStatus(status) {

        const value =
            String(
                status || ''
            )
                .trim()
                .toUpperCase();

        switch (value) {

            case 'SUCCESS':
            case 'SUCCESSFUL':
            case 'COMPLETED':
                return MOMO_STATUS.SUCCESSFUL;

            case 'PENDING':
            case 'PROCESSING':
                return MOMO_STATUS.PENDING;

            case 'ACCEPTED':
                return MOMO_STATUS.ACCEPTED;

            case 'FAILED':
            case 'FAILURE':
                return MOMO_STATUS.FAILED;

            case 'REVERSED':
            case 'REVERSAL':
                return MOMO_STATUS.REVERSED;

            default:
                return MOMO_STATUS.UNKNOWN;
        }
    }

    /**
     * ========================================================================
     * Validation
     * ========================================================================
     */

    requireTenantId(tenantId) {

        if (
            tenantId === undefined ||
            tenantId === null ||
            String(tenantId).trim() === ''
        ) {

            throw new MoMoServiceError(
                'TenantId is required',
                {
                    code:
                        'TENANT_ID_REQUIRED'
                }
            );
        }

        return String(
            tenantId
        ).trim();
    }

    /**
     * ========================================================================
     * Safe Phone Masking
     * ========================================================================
     */

    maskPhone(phone) {

        const value =
            String(phone || '');

        if (value.length <= 4) {
            return '****';
        }

        return (
            '*'.repeat(
                Math.max(
                    value.length - 4,
                    0
                )
            ) +
            value.slice(-4)
        );
    }
}

/**
 * ============================================================================
 * Default Singleton
 * ============================================================================
 *
 * Existing code can continue using:
 *
 *   const momoService = require('./momo.service');
 *   momoService.initiateWithdraw(...)
 *
 * while advanced deployments may instantiate MoMoService directly.
 * ============================================================================
 */

const defaultService =
    new MoMoService();

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

module.exports = {

    /**
     * Existing API.
     */
    initiateWithdraw:
        defaultService.initiateWithdraw.bind(
            defaultService
        ),

    /**
     * Full lifecycle APIs.
     */
    requestCollection:
        defaultService.requestCollection.bind(
            defaultService
        ),

    getTransactionStatus:
        defaultService.getTransactionStatus.bind(
            defaultService
        ),

    normalizeCallback:
        defaultService.normalizeCallback.bind(
            defaultService
        ),

    reconcileTransaction:
        defaultService.reconcileTransaction.bind(
            defaultService
        ),

    /**
     * Provider management.
     */
    registerProvider:
        defaultService.registerProvider.bind(
            defaultService
        ),

    unregisterProvider:
        defaultService.unregisterProvider.bind(
            defaultService
        ),

    getProvider:
        defaultService.getProvider.bind(
            defaultService
        ),

    /**
     * Advanced construction.
     */
    MoMoService,

    MoMoServiceError,

    MOMO_STATUS,

    MOMO_OPERATION,

    /**
     * Singleton for dependency injection / bootstrap configuration.
     */
    service:
        defaultService
};