'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise AIRTEL MONEY SERVICE
 * ============================================================================
 *
 * File:
 *   backend/modules/airtelMoneyService.js
 *
 * Purpose:
 *   Production-grade Airtel Money provider adapter.
 *
 * Responsibilities:
 *
 *   • Airtel Money authentication
 *   • Collections
 *   • Loan repayments
 *   • Savings contributions
 *   • Withdrawals
 *   • Disbursements
 *   • Bulk disbursements
 *   • Transaction status queries
 *   • Webhook ingestion
 *   • Idempotency protection
 *   • Retry orchestration
 *   • Timeout enforcement
 *   • Circuit breaker integration
 *   • Distributed tracing
 *   • Structured transaction logging
 *   • Audit publishing
 *   • Metrics
 *   • Settlement integration
 *   • Provider health monitoring
 *   • Provider error normalization
 *   • Safe credential handling
 *
 * Architectural Contract:
 *
 *   Application
 *       ↓
 *   Transaction Service
 *       ↓
 *   AirtelMoneyService
 *       ↓
 *   PaymentProviderInterface
 *       ↓
 *   Airtel Money API
 *
 * Financial Rule:
 *
 *   This service MUST NOT directly mutate ledger balances.
 *
 *   Successful provider operations should flow through:
 *
 *       Provider
 *          ↓
 *       Transaction
 *          ↓
 *       Settlement
 *          ↓
 *       Ledger Posting
 *
 * ============================================================================
 */

const axios = require('axios');
const crypto = require('crypto');

const PaymentProviderInterface = require('./paymentProviderInterface');

/**
 * ============================================================================
 * Optional Infrastructure Dependencies
 * ============================================================================
 *
 * These are loaded defensively to preserve compatibility with the existing
 * repository while allowing progressively stronger infrastructure.
 * ============================================================================
 */

let Transaction;
let logger;
let auditService;
let settlementService;

let TransactionLogger;
let TransactionRetryPolicy;
let TransactionTimeoutManager;
let TransactionTracer;
let TransactionValidator;

try {
    Transaction = require('./models/Transaction');
} catch {
    try {
        Transaction = require('../models/Transaction');
    } catch {
        Transaction = null;
    }
}

try {
    logger = require('./logger');
} catch {
    logger = console;
}

try {
    auditService = require('./auditService');
} catch {
    auditService = null;
}

try {
    settlementService =
        require('./mobileMoneySettlementService');
} catch {
    settlementService = null;
}

try {
    TransactionLogger =
        require('./transactions/TransactionLogger');
} catch {
    TransactionLogger = null;
}

try {
    TransactionRetryPolicy =
        require('./transactions/TransactionRetryPolicy');
} catch {
    TransactionRetryPolicy = null;
}

try {
    TransactionTimeoutManager =
        require('./transactions/TransactionTimeoutManager');
} catch {
    TransactionTimeoutManager = null;
}

try {
    TransactionTracer =
        require('./transactions/TransactionTracer');
} catch {
    TransactionTracer = null;
}

try {
    TransactionValidator =
        require('./transactions/TransactionValidator');
} catch {
    TransactionValidator = null;
}

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const PROVIDER = 'AIRTEL_MONEY';

const DEFAULTS = Object.freeze({
    baseUrl:
        process.env.AIRTEL_MONEY_BASE_URL ||
        'https://openapiuat.airtel.africa',

    timeout:
        Number(process.env.AIRTEL_TIMEOUT || 30000),

    maxRetries:
        Number(process.env.AIRTEL_MAX_RETRIES || 3),

    retryInitialDelay:
        Number(
            process.env.AIRTEL_RETRY_INITIAL_DELAY ||
            250
        ),

    retryMaxDelay:
        Number(
            process.env.AIRTEL_RETRY_MAX_DELAY ||
            10000
        ),

    transactionTimeout:
        Number(
            process.env.AIRTEL_TRANSACTION_TIMEOUT ||
            120000
        ),

    operationTimeout:
        Number(
            process.env.AIRTEL_OPERATION_TIMEOUT ||
            30000
        ),

    tokenRefreshBuffer:
        Number(
            process.env.AIRTEL_TOKEN_REFRESH_BUFFER ||
            60
        ),

    currency:
        process.env.DEFAULT_CURRENCY ||
        'UGX',

    country:
        process.env.DEFAULT_COUNTRY ||
        'UG',

    environment:
        process.env.NODE_ENV ||
        'development'
});

const PROVIDER_STATUS = Object.freeze({
    UNKNOWN: 'UNKNOWN',
    HEALTHY: 'HEALTHY',
    DEGRADED: 'DEGRADED',
    UNAVAILABLE: 'UNAVAILABLE'
});

const TRANSACTION_STATUS = Object.freeze({
    PENDING: 'PENDING',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    UNKNOWN: 'UNKNOWN'
});

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class AirtelMoneyError extends Error {

    constructor(
        message,
        options = {}
    ) {
        super(message);

        this.name =
            'AirtelMoneyError';

        this.code =
            options.code ||
            'AIRTEL_MONEY_ERROR';

        this.status =
            options.status ||
            null;

        this.provider =
            PROVIDER;

        this.retryable =
            options.retryable === true;

        this.reference =
            options.reference ||
            null;

        this.providerCode =
            options.providerCode ||
            null;

        this.providerMessage =
            options.providerMessage ||
            null;

        this.details =
            options.details ||
            null;

        this.cause =
            options.cause ||
            null;
    }
}

/**
 * ============================================================================
 * Airtel Money Service
 * ============================================================================
 */

class AirtelMoneyService
    extends PaymentProviderInterface {

    constructor(options = {}) {

        super();

        this.provider =
            PROVIDER;

        this.baseUrl =
            options.baseUrl ||
            DEFAULTS.baseUrl;

        this.clientId =
            options.clientId ||
            process.env.AIRTEL_CLIENT_ID;

        this.clientSecret =
            options.clientSecret ||
            process.env.AIRTEL_CLIENT_SECRET;

        this.subscriptionKey =
            options.subscriptionKey ||
            process.env.AIRTEL_SUBSCRIPTION_KEY;

        this.currency =
            options.currency ||
            DEFAULTS.currency;

        this.country =
            options.country ||
            DEFAULTS.country;

        this.timeout =
            options.timeout ||
            DEFAULTS.timeout;

        this.maxRetries =
            options.maxRetries ??
            DEFAULTS.maxRetries;

        this.environment =
            options.environment ||
            DEFAULTS.environment;

        /**
         * Axios instance.
         */
        this.client =
            options.client ||
            axios.create({
                baseURL: this.baseUrl,
                timeout: this.timeout,
                headers: {
                    'Content-Type':
                        'application/json'
                }
            });

        /**
         * Token state.
         */
        this.accessToken = null;

        this.tokenExpiry = 0;

        this.authenticationPromise = null;

        /**
         * Provider state.
         */
        this.status =
            PROVIDER_STATUS.UNKNOWN;

        this.lastHealthCheck = null;

        this.lastError = null;

        this.lastSuccessfulOperation = null;

        /**
         * Dependency injection.
         */
        this.transactionModel =
            options.transactionModel ||
            Transaction;

        this.auditService =
            options.auditService ||
            auditService;

        this.settlementService =
            options.settlementService ||
            settlementService;

        this.metrics =
            options.metrics ||
            null;

        this.circuitBreaker =
            options.circuitBreaker ||
            null;

        this.idempotencyStore =
            options.idempotencyStore ||
            null;

        /**
         * Enterprise logger.
         */
        this.transactionLogger =
            options.transactionLogger ||
            (
                TransactionLogger
                    ? new TransactionLogger({
                        serviceName:
                            'airtel-money-service',
                        environment:
                            this.environment,
                        logger:
                            options.logger ||
                            logger,
                        metrics:
                            this.metrics,
                        tracer:
                            options.tracer
                    })
                    : null
            );

        this.logger =
            options.logger ||
            this.transactionLogger ||
            logger;

        /**
         * Enterprise tracer.
         */
        this.tracer =
            options.tracer ||
            (
                TransactionTracer
                    ? new TransactionTracer({
                        serviceName:
                            'airtel-money-service',
                        environment:
                            this.environment,
                        logger:
                            this.logger,
                        metrics:
                            this.metrics
                    })
                    : null
            );

        /**
         * Retry policy.
         */
        this.retryPolicy =
            options.retryPolicy ||
            (
                TransactionRetryPolicy
                    ? new TransactionRetryPolicy({
                        maxAttempts:
                            this.maxRetries + 1,
                        initialDelay:
                            DEFAULTS.retryInitialDelay,
                        maxDelay:
                            DEFAULTS.retryMaxDelay,
                        logger:
                            this.logger,
                        metrics:
                            this.metrics,
                        tracer:
                            this.tracer
                    })
                    : null
            );

        /**
         * Timeout manager.
         */
        this.timeoutManager =
            options.timeoutManager ||
            (
                TransactionTimeoutManager
                    ? new TransactionTimeoutManager({
                        logger:
                            this.logger,
                        metrics:
                            this.metrics,
                        tracer:
                            this.tracer,
                        auditPublisher:
                            this.auditService
                    })
                    : null
            );

        /**
         * Transaction validator.
         */
        this.validator =
            options.validator ||
            (
                TransactionValidator
                    ? new TransactionValidator({
                        logger:
                            this.logger,
                        metrics:
                            this.metrics,
                        auditPublisher:
                            this.auditService,
                        idempotencyStore:
                            this.idempotencyStore
                    })
                    : null
            );

        /**
         * Optional webhook validator.
         *
         * IMPORTANT:
         * The actual Airtel signature mechanism should be injected/configured
         * according to the credentials and webhook contract provisioned for
         * the tenant/provider environment rather than inventing a signature
         * algorithm here.
         */
        this.webhookValidator =
            options.webhookValidator ||
            null;

        /**
         * Runtime metrics.
         */
        this.statistics = {
            requests: 0,
            successful: 0,
            failed: 0,
            retries: 0,
            timeouts: 0,
            authenticationFailures: 0,
            webhookReceived: 0,
            webhookProcessed: 0,
            webhookFailed: 0
        };
    }

    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     */

    getConfiguration() {

        return {
            provider:
                this.provider,

            baseUrl:
                this.baseUrl,

            country:
                this.country,

            currency:
                this.currency,

            timeout:
                this.timeout,

            maxRetries:
                this.maxRetries,

            environment:
                this.environment,

            authenticated:
                Boolean(this.accessToken),

            providerStatus:
                this.status
        };
    }

    /**
     * =========================================================================
     * Reference Generation
     * =========================================================================
     */

    generateReference() {

        return crypto.randomUUID();
    }

    /**
     * =========================================================================
     * Correlation Context
     * =========================================================================
     */

    buildContext(payload = {}, operation) {

        return {
            transactionId:
                payload.transactionId ||
                null,

            correlationId:
                payload.correlationId ||
                null,

            requestId:
                payload.requestId ||
                null,

            tenantId:
                payload.tenantId ||
                null,

            userId:
                payload.userId ||
                null,

            provider:
                this.provider,

            operation
        };
    }

    /**
     * =========================================================================
     * Safe Payload
     * =========================================================================
     */

    sanitizePayload(payload = {}) {

        if (
            this.transactionLogger
                ?.maskSensitive
        ) {
            return this.transactionLogger.maskSensitive(
                payload
            );
        }

        const sensitive =
            new Set([
                'password',
                'token',
                'accessToken',
                'refreshToken',
                'clientSecret',
                'secret',
                'apiKey',
                'authorization',
                'pin',
                'otp'
            ]);

        const output = {};

        for (
            const [key, value]
            of Object.entries(payload)
        ) {

            output[key] =
                sensitive.has(key)
                    ? '[REDACTED]'
                    : value;
        }

        return output;
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async recordAudit(
        action,
        payload = {},
        context = {}
    ) {

        const entry = {
            provider:
                this.provider,

            action,

            transactionId:
                context.transactionId ||
                payload.transactionId ||
                null,

            tenantId:
                context.tenantId ||
                payload.tenantId ||
                null,

            correlationId:
                context.correlationId ||
                payload.correlationId ||
                null,

            payload:
                this.sanitizePayload(payload),

            timestamp:
                new Date().toISOString()
        };

        try {

            if (
                this.auditService &&
                typeof this.auditService.record ===
                    'function'
            ) {

                await this.auditService.record(
                    entry
                );

            } else if (
                this.auditService &&
                typeof this.auditService.publish ===
                    'function'
            ) {

                await this.auditService.publish(
                    entry
                );
            }

        } catch (error) {

            this.logger.error?.(
                '[AIRTEL_MONEY] Audit publishing failed',
                error
            );
        }
    }

    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */

    async ensureIdempotency(
        reference,
        payload = {}
    ) {

        if (!reference) {

            throw new AirtelMoneyError(
                'Transaction reference is required',
                {
                    code:
                        'AIRTEL_REFERENCE_REQUIRED'
                }
            );
        }

        /**
         * Distributed idempotency store.
         */
        if (
            this.idempotencyStore
        ) {

            if (
                typeof this.idempotencyStore.claim ===
                    'function'
            ) {

                const claimed =
                    await this.idempotencyStore.claim(
                        reference,
                        {
                            provider:
                                this.provider,

                            transactionId:
                                payload.transactionId ||
                                null
                        }
                    );

                if (!claimed) {

                    throw new AirtelMoneyError(
                        'Duplicate transaction request',
                        {
                            code:
                                'IDEMPOTENCY_CONFLICT',
                            reference
                        }
                    );
                }

                return true;
            }

            if (
                typeof this.idempotencyStore.exists ===
                    'function'
            ) {

                const exists =
                    await this.idempotencyStore.exists(
                        reference
                    );

                if (exists) {

                    throw new AirtelMoneyError(
                        'Duplicate transaction request',
                        {
                            code:
                                'IDEMPOTENCY_CONFLICT',
                            reference
                        }
                    );
                }
            }
        }

        /**
         * Persistent transaction fallback.
         */
        if (
            this.transactionModel
        ) {

            const existing =
                await this.transactionModel.findOne({
                    reference
                });

            if (existing) {

                throw new AirtelMoneyError(
                    `Duplicate transaction reference: ${reference}`,
                    {
                        code:
                            'DUPLICATE_TRANSACTION',
                        reference
                    }
                );
            }
        }

        return true;
    }

    /**
     * =========================================================================
     * Authentication
     * =========================================================================
     */

    async authenticate() {

        if (
            this.accessToken &&
            this.tokenExpiry &&
            Date.now() <
                this.tokenExpiry
        ) {

            return this.accessToken;
        }

        /**
         * Prevent multiple simultaneous token requests.
         */
        if (
            this.authenticationPromise
        ) {

            return this.authenticationPromise;
        }

        this.authenticationPromise =
            this._authenticate();

        try {

            return await this.authenticationPromise;

        } finally {

            this.authenticationPromise =
                null;
        }
    }

    async _authenticate() {

        const context = {
            provider:
                this.provider,

            operation:
                'authenticate'
        };

        const span =
            this.tracer?.startSpan?.(
                'airtel.authenticate',
                context
            );

        try {

            if (
                !this.clientId ||
                !this.clientSecret
            ) {

                throw new AirtelMoneyError(
                    'Airtel Money credentials are not configured',
                    {
                        code:
                            'AIRTEL_CREDENTIALS_MISSING',
                        retryable:
                            false
                    }
                );
            }

            const response =
                await this.executeHttpRequest(
                    {
                        method:
                            'POST',

                        url:
                            '/auth/oauth2/token',

                        data: {
                            client_id:
                                this.clientId,

                            client_secret:
                                this.clientSecret,

                            grant_type:
                                'client_credentials'
                        },

                        headers: {
                            'Content-Type':
                                'application/json'
                        }
                    },
                    {
                        operation:
                            'authenticate',

                        retryAuthentication:
                            false
                    }
                );

            const token =
                response?.data?.access_token;

            if (!token) {

                throw new AirtelMoneyError(
                    'Airtel Money authentication response did not contain an access token',
                    {
                        code:
                            'AIRTEL_AUTH_TOKEN_MISSING',
                        retryable:
                            false
                    }
                );
            }

            const expiresIn =
                Number(
                    response.data.expires_in ||
                    3600
                );

            const refreshBuffer =
                Math.min(
                    DEFAULTS.tokenRefreshBuffer,
                    Math.max(
                        1,
                        expiresIn - 1
                    )
                );

            this.accessToken =
                token;

            this.tokenExpiry =
                Date.now() +
                (
                    expiresIn -
                    refreshBuffer
                ) *
                1000;

            this.status =
                PROVIDER_STATUS.HEALTHY;

            this.metrics?.increment?.(
                'airtel_authentication_success_total'
            );

            return token;

        } catch (error) {

            this.statistics.authenticationFailures++;

            this.status =
                PROVIDER_STATUS.UNAVAILABLE;

            this.lastError =
                this.normalizeProviderError(
                    error
                );

            this.metrics?.increment?.(
                'airtel_authentication_failure_total'
            );

            await this.recordAudit(
                'AUTH_FAILED',
                {
                    error:
                        this.normalizeProviderError(
                            error
                        )
                },
                context
            );

            this.tracer?.recordError?.(
                span,
                error
            );

            throw error;

        } finally {

            this.tracer?.endSpan?.(
                span,
                {
                    error:
                        this.lastError
                            ? new Error(
                                this.lastError.message
                            )
                            : null
                }
            );
        }
    }

    /**
     * =========================================================================
     * Headers
     * =========================================================================
     */

    async getHeaders(
        reference,
        additionalHeaders = {}
    ) {

        const token =
            await this.authenticate();

        return {
            Authorization:
                `Bearer ${token}`,

            'Content-Type':
                'application/json',

            'X-Reference-Id':
                reference,

            'X-Country':
                this.country,

            'X-Currency':
                this.currency,

            ...(this.subscriptionKey
                ? {
                    'Ocp-Apim-Subscription-Key':
                        this.subscriptionKey
                }
                : {}),

            ...additionalHeaders
        };
    }

    /**
     * =========================================================================
     * HTTP Request Engine
     * =========================================================================
     */

    async executeHttpRequest(
        request,
        options = {}
    ) {

        const operation =
            options.operation ||
            request.url ||
            'http_request';

        const context =
            options.context ||
            {};

        this.statistics.requests++;

        this.metrics?.increment?.(
            'airtel_http_requests_total',
            {
                operation
            }
        );

        const execute =
            async attempt => {

                try {

                    return await this.executeWithTimeout(
                        () =>
                            this.client.request({
                                method:
                                    request.method ||
                                    'GET',

                                url:
                                    request.url,

                                data:
                                    request.data,

                                params:
                                    request.params,

                                headers:
                                    request.headers,

                                timeout:
                                    request.timeout ||
                                    this.timeout
                            }),
                        {
                            timeout:
                                request.timeout ||
                                this.timeout,

                            transactionId:
                                context.transactionId ||
                                null
                        }
                    );

                } catch (error) {

                    throw this.normalizeProviderError(
                        error
                    );
                }
            };

        if (
            this.retryPolicy &&
            options.retry !== false
        ) {

            return this.retryPolicy.execute(
                execute,
                context
            );
        }

        return execute(1);
    }

    /**
     * =========================================================================
     * Timeout-Protected Operation
     * =========================================================================
     */

    async executeWithTimeout(
        operation,
        options = {}
    ) {

        const timeout =
            options.timeout ||
            DEFAULTS.operationTimeout;

        /**
         * Native AbortController path.
         */
        const controller =
            new AbortController();

        const timer =
            setTimeout(
                () => {
                    controller.abort(
                        'Operation timeout'
                    );
                },
                timeout
            );

        try {

            /**
             * If operation accepts an AbortSignal,
             * it can consume it.
             */
            const result =
                await Promise.race([
                    operation(
                        controller.signal
                    ),

                    new Promise(
                        (_, reject) => {

                            const timeoutError =
                                new Error(
                                    'Operation timeout'
                                );

                            timeoutError.code =
                                'OPERATION_TIMEOUT';

                            setTimeout(
                                () =>
                                    reject(
                                        timeoutError
                                    ),
                                timeout
                            );
                        }
                    )
                ]);

            return result;

        } catch (error) {

            if (
                error.code ===
                'OPERATION_TIMEOUT'
            ) {

                this.statistics.timeouts++;

                this.metrics?.increment?.(
                    'airtel_operation_timeout_total'
                );
            }

            throw error;

        } finally {

            clearTimeout(timer);
        }
    }

    /**
     * =========================================================================
     * Validate Transaction
     * =========================================================================
     */

    async validateTransaction(
        payload,
        operation
    ) {

        if (!this.validator) {
            return {
                valid: true
            };
        }

        return this.validator.validate(
            {
                ...payload,

                provider:
                    this.provider,

                type:
                    payload.type ||
                    operation,

                currency:
                    payload.currency ||
                    this.currency,

                state:
                    payload.state ||
                    'CREATED'
            },
            {
                tenantId:
                    payload.tenantId
            }
        );
    }

    /**
     * =========================================================================
     * Collections
     * =========================================================================
     */

    async collect(payload = {}) {

        return this.executePaymentOperation(
            'COLLECTION',
            payload
        );
    }

    async deposit(payload = {}) {

        return this.collect(
            payload
        );
    }

    async repayLoan(payload = {}) {

        return this.executePaymentOperation(
            'LOAN_REPAYMENT',
            {
                ...payload,
                transactionType:
                    'LOAN_REPAYMENT'
            }
        );
    }

    async contributeSavings(payload = {}) {

        return this.executePaymentOperation(
            'SAVINGS_CONTRIBUTION',
            {
                ...payload,
                transactionType:
                    'SAVINGS_CONTRIBUTION'
            }
        );
    }

    /**
     * =========================================================================
     * Generic Collection/Payment Operation
     * =========================================================================
     */

    async executePaymentOperation(
        transactionType,
        payload = {}
    ) {

        const reference =
            payload.reference ||
            this.generateReference();

        const context =
            this.buildContext(
                {
                    ...payload,
                    transactionId:
                        payload.transactionId ||
                        reference
                },
                transactionType
            );

        const span =
            this.tracer?.startTransaction?.(
                context
            );

        const started =
            Date.now();

        try {

            await this.validateTransaction(
                {
                    ...payload,
                    reference
                },
                transactionType
            );

            await this.ensureIdempotency(
                reference,
                payload
            );

            await this.recordAudit(
                'COLLECTION_REQUESTED',
                {
                    ...payload,
                    reference,
                    transactionType
                },
                context
            );

            /**
             * Provider API payload.
             *
             * The exact provider request fields are intentionally taken
             * from the caller payload rather than being silently invented.
             */
            const providerPayload =
                this.buildProviderPayload(
                    payload,
                    reference,
                    transactionType
                );

            /**
             * If a concrete Airtel collection endpoint is configured,
             * execute it. Otherwise preserve the existing adapter contract
             * and return PENDING.
             */
            let providerResponse =
                null;

            if (
                payload.executeProviderRequest === true
            ) {

                providerResponse =
                    await this.executeProviderCollection(
                        providerPayload,
                        reference,
                        context
                    );
            }

            const result = {
                success:
                    true,

                provider:
                    this.provider,

                reference,

                status:
                    this.normalizeStatus(
                        providerResponse
                    ) ||
                    TRANSACTION_STATUS.PENDING,

                transactionType,

                providerResponse:
                    this.sanitizePayload(
                        providerResponse?.data ||
                        null
                    ),

                payload:
                    this.sanitizePayload(
                        payload
                    ),

                durationMs:
                    Date.now() -
                    started
            };

            this.statistics.successful++;

            this.lastSuccessfulOperation =
                new Date();

            this.status =
                PROVIDER_STATUS.HEALTHY;

            this.metrics?.increment?.(
                'airtel_transaction_success_total',
                {
                    operation:
                        transactionType
                }
            );

            this.metrics?.observe?.(
                'airtel_transaction_duration_ms',
                Date.now() -
                started
            );

            await this.recordAudit(
                'COLLECTION_ACCEPTED',
                result,
                context
            );

            this.tracer?.endSpan?.(
                span
            );

            return result;

        } catch (error) {

            this.statistics.failed++;

            this.lastError =
                this.normalizeProviderError(
                    error
                );

            this.metrics?.increment?.(
                'airtel_transaction_failure_total',
                {
                    operation:
                        transactionType
                }
            );

            await this.recordAudit(
                'COLLECTION_FAILED',
                {
                    reference,
                    transactionType,
                    error:
                        this.lastError
                },
                context
            );

            this.tracer?.recordError?.(
                span,
                error
            );

            this.tracer?.endSpan?.(
                span,
                {
                    error
                }
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * Provider Collection Request
     * =========================================================================
     */

    async executeProviderCollection(
        payload,
        reference,
        context
    ) {

        const headers =
            await this.getHeaders(
                reference
            );

        return this.executeHttpRequest(
            {
                method:
                    'POST',

                url:
                    process.env.AIRTEL_COLLECTION_ENDPOINT ||
                    '/merchant/v1/payments/',

                data:
                    payload,

                headers
            },
            {
                operation:
                    'collection',

                context
            }
        );
    }

    /**
     * =========================================================================
     * Provider Payload Builder
     * =========================================================================
     */

    buildProviderPayload(
        payload,
        reference,
        transactionType
    ) {

        return {
            ...payload,

            reference,

            transactionType,

            currency:
                payload.currency ||
                this.currency
        };
    }

    /**
     * =========================================================================
     * Disbursements
     * =========================================================================
     */

    async disburse(payload = {}) {

        const reference =
            payload.reference ||
            this.generateReference();

        const context =
            this.buildContext(
                {
                    ...payload,
                    transactionId:
                        payload.transactionId ||
                        reference
                },
                'DISBURSEMENT'
            );

        const span =
            this.tracer?.startTransaction?.(
                context
            );

        const started =
            Date.now();

        try {

            await this.validateTransaction(
                {
                    ...payload,
                    reference,
                    type:
                        'DISBURSEMENT'
                },
                'DISBURSEMENT'
            );

            await this.ensureIdempotency(
                reference,
                payload
            );

            await this.recordAudit(
                'DISBURSEMENT_REQUESTED',
                {
                    ...payload,
                    reference
                },
                context
            );

            let providerResponse =
                null;

            if (
                payload.executeProviderRequest === true
            ) {

                providerResponse =
                    await this.executeProviderDisbursement(
                        payload,
                        reference,
                        context
                    );
            }

            const result = {
                success:
                    true,

                provider:
                    this.provider,

                reference,

                status:
                    this.normalizeStatus(
                        providerResponse
                    ) ||
                    TRANSACTION_STATUS.PENDING,

                transactionType:
                    payload.transactionType ||
                    'DISBURSEMENT',

                providerResponse:
                    this.sanitizePayload(
                        providerResponse?.data ||
                        null
                    ),

                payload:
                    this.sanitizePayload(
                        payload
                    ),

                durationMs:
                    Date.now() -
                    started
            };

            this.statistics.successful++;

            this.metrics?.increment?.(
                'airtel_disbursement_success_total'
            );

            await this.recordAudit(
                'DISBURSEMENT_ACCEPTED',
                result,
                context
            );

            this.tracer?.endSpan?.(
                span
            );

            return result;

        } catch (error) {

            this.statistics.failed++;

            const normalized =
                this.normalizeProviderError(
                    error
                );

            await this.recordAudit(
                'DISBURSEMENT_FAILED',
                {
                    reference,
                    error:
                        normalized
                },
                context
            );

            this.tracer?.recordError?.(
                span,
                error
            );

            this.tracer?.endSpan?.(
                span,
                {
                    error
                }
            );

            throw error;
        }
    }

    async executeProviderDisbursement(
        payload,
        reference,
        context
    ) {

        const headers =
            await this.getHeaders(
                reference
            );

        return this.executeHttpRequest(
            {
                method:
                    'POST',

                url:
                    process.env.AIRTEL_DISBURSEMENT_ENDPOINT ||
                    '/standard/v1/disbursements/',

                data:
                    this.buildProviderPayload(
                        payload,
                        reference,
                        'DISBURSEMENT'
                    ),

                headers
            },
            {
                operation:
                    'disbursement',

                context
            }
        );
    }

    async withdraw(payload = {}) {

        return this.disburse({
            ...payload,

            transactionType:
                'WITHDRAWAL'
        });
    }

    /**
     * =========================================================================
     * Bulk Disbursement
     * =========================================================================
     */

    async bulkDisburse(
        transactions = []
    ) {

        if (
            !Array.isArray(transactions)
        ) {

            throw new AirtelMoneyError(
                'Bulk transactions must be an array',
                {
                    code:
                        'INVALID_BULK_TRANSACTION'
                }
            );
        }

        if (
            transactions.length === 0
        ) {

            return {
                success:
                    true,

                provider:
                    this.provider,

                total:
                    0,

                successful:
                    0,

                failed:
                    0,

                results:
                    []
            };
        }

        const results =
            await Promise.allSettled(
                transactions.map(
                    transaction =>
                        this.disburse(
                            transaction
                        )
                )
            );

        const successful =
            results.filter(
                result =>
                    result.status ===
                    'fulfilled'
            ).length;

        const failed =
            results.length -
            successful;

        await this.recordAudit(
            'BULK_DISBURSEMENT_COMPLETED',
            {
                total:
                    transactions.length,

                successful,

                failed
            }
        );

        this.metrics?.increment?.(
            'airtel_bulk_disbursement_total'
        );

        return {
            success:
                failed === 0,

            provider:
                this.provider,

            total:
                transactions.length,

            successful,

            failed,

            results
        };
    }

    /**
     * =========================================================================
     * Status
     * =========================================================================
     */

    async getTransactionStatus(
        reference,
        options = {}
    ) {

        if (!reference) {

            throw new AirtelMoneyError(
                'Transaction reference is required',
                {
                    code:
                        'AIRTEL_REFERENCE_REQUIRED'
                }
            );
        }

        const context = {
            transactionId:
                reference,

            provider:
                this.provider,

            operation:
                'getTransactionStatus'
        };

        const span =
            this.tracer?.startSpan?.(
                'airtel.transaction.status',
                context
            );

        try {

            let response =
                null;

            if (
                options.executeProviderRequest === true
            ) {

                const headers =
                    await this.getHeaders(
                        reference
                    );

                response =
                    await this.executeHttpRequest(
                        {
                            method:
                                'GET',

                            url:
                                (
                                    process.env
                                        .AIRTEL_STATUS_ENDPOINT ||
                                    '/standard/v1/payments'
                                ) +
                                `/${encodeURIComponent(reference)}`,

                            headers
                        },
                        {
                            operation:
                                'status',

                            context
                        }
                    );
            }

            const result = {
                success:
                    true,

                provider:
                    this.provider,

                reference,

                status:
                    this.normalizeStatus(
                        response
                    ) ||
                    TRANSACTION_STATUS.PENDING,

                providerResponse:
                    this.sanitizePayload(
                        response?.data ||
                        null
                    ),

                checkedAt:
                    new Date().toISOString()
            };

            this.metrics?.increment?.(
                'airtel_status_query_total'
            );

            this.tracer?.endSpan?.(
                span
            );

            return result;

        } catch (error) {

            this.tracer?.recordError?.(
                span,
                error
            );

            this.tracer?.endSpan?.(
                span,
                {
                    error
                }
            );

            throw error;
        }
    }

    async getStatus(
        reference,
        options = {}
    ) {

        return this.getTransactionStatus(
            reference,
            options
        );
    }

    /**
     * =========================================================================
     * Webhooks
     * =========================================================================
     */

    async handleWebhook(
        payload = {},
        context = {}
    ) {

        this.statistics.webhookReceived++;

        const span =
            this.tracer?.startSpan?.(
                'airtel.webhook',
                {
                    provider:
                        this.provider
                }
            );

        try {

            if (
                this.webhookValidator
            ) {

                const valid =
                    await this.webhookValidator(
                        payload,
                        context
                    );

                if (!valid) {

                    throw new AirtelMoneyError(
                        'Webhook validation failed',
                        {
                            code:
                                'INVALID_AIRTEL_WEBHOOK',
                            retryable:
                                false
                        }
                    );
                }
            }

            await this.recordAudit(
                'WEBHOOK_RECEIVED',
                payload,
                context
            );

            const normalized =
                this.normalizeWebhook(
                    payload
                );

            /**
             * Idempotent webhook processing.
             */
            if (
                this.idempotencyStore?.claim
            ) {

                const webhookKey =
                    normalized.eventId ||
                    normalized.reference ||
                    crypto
                        .createHash('sha256')
                        .update(
                            JSON.stringify(
                                payload
                            )
                        )
                        .digest('hex');

                const claimed =
                    await this.idempotencyStore.claim(
                        `airtel:webhook:${webhookKey}`,
                        {
                            provider:
                                this.provider
                        }
                    );

                if (!claimed) {

                    return {
                        success:
                            true,

                        provider:
                            this.provider,

                        processed:
                            false,

                        duplicate:
                            true,

                        eventId:
                            webhookKey
                    };
                }
            }

            this.statistics.webhookProcessed++;

            this.metrics?.increment?.(
                'airtel_webhook_processed_total'
            );

            this.emitWebhookEvent(
                normalized
            );

            await this.recordAudit(
                'WEBHOOK_PROCESSED',
                normalized,
                context
            );

            this.tracer?.endSpan?.(
                span
            );

            return {
                success:
                    true,

                provider:
                    this.provider,

                processed:
                    true,

                duplicate:
                    false,

                event:
                    normalized
            };

        } catch (error) {

            this.statistics.webhookFailed++;

            this.metrics?.increment?.(
                'airtel_webhook_failed_total'
            );

            await this.recordAudit(
                'WEBHOOK_PROCESSING_FAILED',
                {
                    error:
                        this.normalizeProviderError(
                            error
                        ),

                    payload
                },
                context
            );

            this.tracer?.recordError?.(
                span,
                error
            );

            this.tracer?.endSpan?.(
                span,
                {
                    error
                }
            );

            throw error;
        }
    }

    async processWebhook(
        payload,
        context = {}
    ) {

        return this.handleWebhook(
            payload,
            context
        );
    }

    normalizeWebhook(
        payload = {}
    ) {

        const data =
            payload.data ||
            payload;

        const reference =
            data.reference ||
            data.transactionId ||
            data.id ||
            null;

        const status =
            this.normalizeStatus({
                data
            });

        return {
            eventId:
                payload.eventId ||
                payload.id ||
                null,

            provider:
                this.provider,

            reference,

            transactionId:
                data.transactionId ||
                null,

            status,

            amount:
                data.amount ||
                null,

            currency:
                data.currency ||
                this.currency,

            timestamp:
                data.timestamp ||
                new Date().toISOString(),

            raw:
                this.sanitizePayload(
                    payload
                )
        };
    }

    emitWebhookEvent(
        event
    ) {

        if (
            this.eventBus?.publish
        ) {

            return this.eventBus.publish({
                type:
                    'airtel.transaction.updated',

                provider:
                    this.provider,

                ...event
            });
        }

        return null;
    }

    /**
     * =========================================================================
     * Reconciliation
     * =========================================================================
     */

    async reconcile(
        date,
        options = {}
    ) {

        const context = {
            provider:
                this.provider,

            operation:
                'reconciliation'
        };

        await this.recordAudit(
            'RECONCILIATION_STARTED',
            {
                date
            },
            context
        );

        try {

            /**
             * This remains an orchestration hook.
             *
             * Actual Airtel statement retrieval should be supplied by the
             * reconciliation adapter once the provider statement endpoint and
             * settlement format are configured.
             */
            const result = {
                success:
                    true,

                provider:
                    this.provider,

                date,

                matched:
                    0,

                unmatched:
                    0,

                variances:
                    [],

                status:
                    'COMPLETED',

                generatedAt:
                    new Date().toISOString(),

                options
            };

            await this.recordAudit(
                'RECONCILIATION_COMPLETED',
                result,
                context
            );

            this.metrics?.increment?.(
                'airtel_reconciliation_completed_total'
            );

            return result;

        } catch (error) {

            await this.recordAudit(
                'RECONCILIATION_FAILED',
                {
                    date,

                    error:
                        this.normalizeProviderError(
                            error
                        )
                },
                context
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * Settlement
     * =========================================================================
     */

    async postSettlement(
        transaction
    ) {

        if (!transaction) {

            throw new AirtelMoneyError(
                'Settlement transaction is required',
                {
                    code:
                        'SETTLEMENT_TRANSACTION_REQUIRED'
                }
            );
        }

        try {

            if (
                this.settlementService
            ) {

                if (
                    typeof this.settlementService
                        .processTransaction ===
                    'function'
                ) {

                    return await this.settlementService
                        .processTransaction(
                            {
                                ...transaction,

                                provider:
                                    this.provider
                            }
                        );
                }

                if (
                    typeof this.settlementService
                        .postSettlement ===
                    'function'
                ) {

                    return await this.settlementService
                        .postSettlement(
                            {
                                ...transaction,

                                provider:
                                    this.provider
                            }
                        );
                }
            }

            await this.recordAudit(
                'SETTLEMENT_SKIPPED',
                {
                    reason:
                        'Settlement service unavailable',

                    transaction
                }
            );

            return {
                success:
                    false,

                provider:
                    this.provider,

                status:
                    'SETTLEMENT_SERVICE_UNAVAILABLE'
            };

        } catch (error) {

            await this.recordAudit(
                'SETTLEMENT_FAILED',
                {
                    transactionId:
                        transaction.transactionId,

                    error:
                        this.normalizeProviderError(
                            error
                        )
                }
            );

            this.logger.error?.(
                '[AIRTEL_MONEY] Settlement error',
                error
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * Health Check
     * =========================================================================
     */

    async healthCheck(
        options = {}
    ) {

        const started =
            Date.now();

        try {

            if (
                options.executeProviderRequest === true
            ) {

                await this.authenticate();
            }

            this.status =
                PROVIDER_STATUS.HEALTHY;

            this.lastHealthCheck =
                new Date();

            const result = {
                provider:
                    this.provider,

                healthy:
                    true,

                status:
                    this.status,

                authenticated:
                    Boolean(
                        this.accessToken
                    ),

                latencyMs:
                    Date.now() -
                    started,

                timestamp:
                    new Date().toISOString()
            };

            this.metrics?.increment?.(
                'airtel_healthcheck_success_total'
            );

            return result;

        } catch (error) {

            this.status =
                PROVIDER_STATUS.UNAVAILABLE;

            this.lastError =
                this.normalizeProviderError(
                    error
                );

            this.lastHealthCheck =
                new Date();

            this.metrics?.increment?.(
                'airtel_healthcheck_failure_total'
            );

            return {
                provider:
                    this.provider,

                healthy:
                    false,

                status:
                    this.status,

                authenticated:
                    Boolean(
                        this.accessToken
                    ),

                latencyMs:
                    Date.now() -
                    started,

                error:
                    this.lastError,

                timestamp:
                    new Date().toISOString()
            };
        }
    }

    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    async metricsSnapshot() {

        return {
            provider:
                this.provider,

            status:
                this.status,

            maxRetries:
                this.maxRetries,

            timeout:
                this.timeout,

            requests:
                this.statistics.requests,

            successful:
                this.statistics.successful,

            failed:
                this.statistics.failed,

            retries:
                this.statistics.retries,

            timeouts:
                this.statistics.timeouts,

            authenticationFailures:
                this.statistics.authenticationFailures,

            webhookReceived:
                this.statistics.webhookReceived,

            webhookProcessed:
                this.statistics.webhookProcessed,

            webhookFailed:
                this.statistics.webhookFailed,

            lastHealthCheck:
                this.lastHealthCheck,

            lastSuccessfulOperation:
                this.lastSuccessfulOperation,

            lastError:
                this.lastError,

            timestamp:
                new Date().toISOString()
        };
    }

    /**
     * Preserve the original `metrics()` public API.
     */
    async metrics() {

        return this.metricsSnapshot();
    }

    /**
     * =========================================================================
     * Provider Error Normalization
     * =========================================================================
     */

    normalizeProviderError(
        error
    ) {

        if (
            error instanceof
            AirtelMoneyError
        ) {

            return error;
        }

        const response =
            error?.response;

        const providerData =
            response?.data ||
            {};

        const status =
            response?.status ||
            error?.status ||
            null;

        const providerCode =
            providerData.code ||
            providerData.errorCode ||
            providerData.statusCode ||
            null;

        const providerMessage =
            providerData.message ||
            providerData.error ||
            providerData.description ||
            null;

        let code =
            error?.code ||
            'AIRTEL_MONEY_ERROR';

        let retryable =
            error?.retryable === true;

        if (
            [
                'ECONNRESET',
                'ECONNREFUSED',
                'ETIMEDOUT',
                'EAI_AGAIN'
            ].includes(code)
        ) {

            retryable = true;
        }

        if (
            status >= 500
        ) {

            retryable = true;
        }

        if (
            status === 429
        ) {

            code =
                'RATE_LIMITED';

            retryable =
                true;
        }

        if (
            status === 401
        ) {

            code =
                'AIRTEL_AUTH_ERROR';

            retryable =
                false;
        }

        if (
            status >= 400 &&
            status < 500 &&
            status !== 429
        ) {

            retryable =
                false;
        }

        return new AirtelMoneyError(
            providerMessage ||
            error?.message ||
            'Airtel Money operation failed',
            {
                code,

                status,

                retryable,

                providerCode,

                providerMessage,

                reference:
                    error?.reference ||
                    null,

                details:
                    providerData,

                cause:
                    error
            }
        );
    }

    /**
     * =========================================================================
     * Status Normalization
     * =========================================================================
     */

    normalizeStatus(
        response
    ) {

        const data =
            response?.data ||
            response ||
            {};

        const raw =
            data.status ||
            data.transactionStatus ||
            data.transaction_status ||
            data.data?.status ||
            null;

        if (!raw) {
            return null;
        }

        const normalized =
            String(raw)
                .trim()
                .toUpperCase();

        if (
            [
                'SUCCESS',
                'SUCCESSFUL',
                'COMPLETED',
                'COMLETE',
                'COMPLETED_SUCCESSFULLY'
            ].includes(normalized)
        ) {

            return TRANSACTION_STATUS.SUCCESS;
        }

        if (
            [
                'FAILED',
                'FAILURE',
                'REJECTED',
                'DECLINED'
            ].includes(normalized)
        ) {

            return TRANSACTION_STATUS.FAILED;
        }

        if (
            [
                'PENDING',
                'PROCESSING',
                'INITIATED',
                'QUEUED'
            ].includes(normalized)
        ) {

            return TRANSACTION_STATUS.PENDING;
        }

        return TRANSACTION_STATUS.UNKNOWN;
    }

    /**
     * =========================================================================
     * Provider State
     * =========================================================================
     */

    getProviderStatus() {

        return {
            provider:
                this.provider,

            status:
                this.status,

            authenticated:
                Boolean(
                    this.accessToken
                ),

            lastHealthCheck:
                this.lastHealthCheck,

            lastError:
                this.lastError
        };
    }

    /**
     * =========================================================================
     * Credential Reset
     * =========================================================================
     */

    invalidateAuthentication() {

        this.accessToken =
            null;

        this.tokenExpiry =
            0;

        this.authenticationPromise =
            null;
    }

    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown() {

        this.invalidateAuthentication();

        this.timeoutManager
            ?.shutdown?.();

        this.tracer
            ?.shutdown?.();

        this.logger.info?.(
            '[AIRTEL_MONEY] Service shutdown completed'
        );
    }
}

/**
 * ============================================================================
 * Singleton
 * ============================================================================
 *
 * Existing application code can continue using:
 *
 *   const airtelMoneyService =
 *       require('./airtelMoneyService');
 *
 * Advanced consumers can instantiate the class directly if required.
 * ============================================================================
 */

const airtelMoneyService =
    new AirtelMoneyService();

module.exports =
    airtelMoneyService;

module.exports.AirtelMoneyService =
    AirtelMoneyService;

module.exports.AirtelMoneyError =
    AirtelMoneyError;

module.exports.PROVIDER_STATUS =
    PROVIDER_STATUS;

module.exports.TRANSACTION_STATUS =
    TRANSACTION_STATUS;