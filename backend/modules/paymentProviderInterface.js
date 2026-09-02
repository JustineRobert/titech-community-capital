'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Payment Provider Interface
 * ============================================================================
 *
 * File:
 * backend/modules/paymentProviderInterface.js
 *
 * Purpose:
 * Enterprise abstract contract for all external payment providers.
 *
 * Supported / Planned Providers:
 *  - MTN Mobile Money
 *  - Airtel Money
 *  - Flutterwave
 *  - Pesapal
 *  - Stripe
 *  - Bank APIs
 *  - Future payment rails
 *
 * Architecture Position:
 *
 * Payment Orchestrator
 *        |
 *        v
 * PaymentProviderInterface
 *        |
 *  +-----+------+-------+--------+
 *  |            |       |        |
 * MTN          Airtel  Bank    Other
 *
 * Design Principles:
 *  - Backward compatible
 *  - Provider agnostic
 *  - Idempotency aware
 *  - Retry aware
 *  - Webhook security aware
 *  - Reconciliation aware
 *  - Settlement aware
 *  - Observability ready
 *  - Multi-tenant ready
 *  - Ledger integration ready
 *  - AML/Fraud integration ready
 *  - Production safe
 *
 * IMPORTANT:
 * Every concrete provider implementation MUST extend this class.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const INTERFACE_VERSION = '2.0.0';

const PROVIDER_STATUS = Object.freeze({
    UNKNOWN: 'UNKNOWN',
    INITIALIZING: 'INITIALIZING',
    READY: 'READY',
    DEGRADED: 'DEGRADED',
    UNAVAILABLE: 'UNAVAILABLE',
    AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
    MAINTENANCE: 'MAINTENANCE',
});

const TRANSACTION_STATUS = Object.freeze({
    UNKNOWN: 'UNKNOWN',
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    REVERSED: 'REVERSED',
    CANCELLED: 'CANCELLED',
    EXPIRED: 'EXPIRED',
    REFUNDED: 'REFUNDED',
    PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
});

const OPERATION = Object.freeze({
    AUTHENTICATE: 'AUTHENTICATE',

    COLLECT: 'COLLECT',
    REVERSE_COLLECTION: 'REVERSE_COLLECTION',

    DISBURSE: 'DISBURSE',
    REVERSE_DISBURSEMENT: 'REVERSE_DISBURSEMENT',

    GET_TRANSACTION_STATUS: 'GET_TRANSACTION_STATUS',
    GET_TRANSACTION: 'GET_TRANSACTION',
    RETRY_TRANSACTION: 'RETRY_TRANSACTION',
    CANCEL_TRANSACTION: 'CANCEL_TRANSACTION',

    GET_BALANCE: 'GET_BALANCE',
    GET_SETTLEMENT_BALANCE: 'GET_SETTLEMENT_BALANCE',

    VERIFY_WEBHOOK: 'VERIFY_WEBHOOK',
    HANDLE_WEBHOOK: 'HANDLE_WEBHOOK',

    RECONCILE: 'RECONCILE',
    GET_SETTLEMENT_REPORT: 'GET_SETTLEMENT_REPORT',

    HEALTH_CHECK: 'HEALTH_CHECK',
    PROVIDER_STATUS: 'PROVIDER_STATUS',
});

const ERROR_CODE = Object.freeze({
    PROVIDER_ERROR: 'PROVIDER_ERROR',
    PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
    PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
    PROVIDER_AUTHENTICATION_FAILED:
        'PROVIDER_AUTHENTICATION_FAILED',

    INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',
    INVALID_REQUEST: 'INVALID_REQUEST',
    INVALID_RESPONSE: 'INVALID_RESPONSE',

    INVALID_AMOUNT: 'INVALID_AMOUNT',
    INVALID_CURRENCY: 'INVALID_CURRENCY',
    INVALID_REFERENCE: 'INVALID_REFERENCE',
    INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',

    UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
    UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',

    DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
    IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',

    TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
    TRANSACTION_FAILED: 'TRANSACTION_FAILED',
    TRANSACTION_TIMEOUT: 'TRANSACTION_TIMEOUT',

    WEBHOOK_INVALID_SIGNATURE: 'WEBHOOK_INVALID_SIGNATURE',
    WEBHOOK_INVALID_PAYLOAD: 'WEBHOOK_INVALID_PAYLOAD',
    WEBHOOK_REPLAY: 'WEBHOOK_REPLAY',

    RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
    SETTLEMENT_FAILED: 'SETTLEMENT_FAILED',
});

const DEFAULT_CAPABILITIES = Object.freeze({
    collections: false,
    disbursements: false,
    reversals: false,
    reconciliation: false,
    settlements: false,
    balanceInquiry: false,
    webhookVerification: false,
    transactionLookup: false,
    transactionRetry: false,
    cancellation: false,

    refunds: false,
    partialRefunds: false,

    asynchronousTransactions: true,
    synchronousTransactions: false,

    idempotency: false,
    webhookReplayProtection: false,

    multiCurrency: false,
    multiCountry: false,

    sandbox: false,
    production: true,
});

const DEFAULT_RETRY_POLICY = Object.freeze({
    enabled: true,

    maxAttempts: 3,

    initialDelayMs: 500,

    maxDelayMs: 30_000,

    backoffMultiplier: 2,

    jitter: true,

    retryableErrors: Object.freeze([
        ERROR_CODE.PROVIDER_TIMEOUT,
        ERROR_CODE.PROVIDER_UNAVAILABLE,
        ERROR_CODE.TRANSACTION_TIMEOUT,
    ]),
});

const DEFAULT_TIMEOUTS = Object.freeze({
    authenticate: 10_000,
    collect: 30_000,
    reverseCollection: 30_000,
    disburse: 30_000,
    reverseDisbursement: 30_000,

    getTransactionStatus: 15_000,
    getTransaction: 15_000,
    retryTransaction: 30_000,
    cancelTransaction: 30_000,

    getBalance: 15_000,
    getSettlementBalance: 15_000,

    verifyWebhook: 10_000,
    handleWebhook: 15_000,

    reconcile: 60_000,
    getSettlementReport: 60_000,

    healthCheck: 10_000,
    getProviderStatus: 10_000,
});

/**
 * ============================================================================
 * CUSTOM ERROR
 * ============================================================================
 */

class PaymentProviderError extends Error {
    constructor(message, options = {}) {
        super(message);

        this.name = 'PaymentProviderError';

        this.code =
            options.code ||
            ERROR_CODE.PROVIDER_ERROR;

        this.provider =
            options.provider || null;

        this.operation =
            options.operation || null;

        this.retryable =
            Boolean(options.retryable);

        this.httpStatus =
            options.httpStatus || null;

        this.providerCode =
            options.providerCode || null;

        this.providerMessage =
            options.providerMessage || null;

        this.transactionReference =
            options.transactionReference || null;

        this.correlationId =
            options.correlationId || null;

        this.details =
            options.details || null;

        this.timestamp =
            options.timestamp ||
            new Date().toISOString();

        if (Error.captureStackTrace) {
            Error.captureStackTrace(
                this,
                PaymentProviderError
            );
        }
    }
}

/**
 * ============================================================================
 * PAYMENT PROVIDER INTERFACE
 * ============================================================================
 */

class PaymentProviderInterface {
    constructor(config = {}) {
        if (new.target === PaymentProviderInterface) {
            throw new Error(
                'PaymentProviderInterface is abstract and cannot be instantiated directly'
            );
        }

        if (
            config === null ||
            typeof config !== 'object'
        ) {
            throw new TypeError(
                'Payment provider configuration must be an object'
            );
        }

        this.config = {
            ...config,
        };

        this.providerName =
            config.providerName ||
            this.constructor.name ||
            'UNKNOWN_PROVIDER';

        this.providerCode =
            config.providerCode ||
            this.providerName
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, '_');

        this.environment =
            config.environment ||
            process.env.NODE_ENV ||
            'development';

        this.interfaceVersion =
            INTERFACE_VERSION;

        this.providerVersion =
            config.providerVersion ||
            '1.0.0';

        this.tenantAware =
            config.tenantAware !== false;

        this.idempotencyEnabled =
            config.idempotencyEnabled !== false;

        this.defaultCurrency =
            config.defaultCurrency ||
            'UGX';

        this.timeout =
            Number(config.timeout) ||
            30_000;

        this.timeouts = {
            ...DEFAULT_TIMEOUTS,
            ...(config.timeouts || {}),
        };

        this.retryPolicy = {
            ...DEFAULT_RETRY_POLICY,
            ...(config.retryPolicy || {}),
        };

        this.logger =
            config.logger ||
            console;

        this.metrics =
            config.metrics || null;

        this.auditService =
            config.auditService || null;

        this.eventPublisher =
            config.eventPublisher || null;

        this.status =
            PROVIDER_STATUS.INITIALIZING;

        this.createdAt =
            new Date().toISOString();

        this.initializedAt = null;
    }

    /**
     * =========================================================================
     * PROVIDER LIFECYCLE
     * =========================================================================
     */

    async initialize() {
        this.status =
            PROVIDER_STATUS.INITIALIZING;

        this.validateConfiguration();

        this.initializedAt =
            new Date().toISOString();

        this.status =
            PROVIDER_STATUS.READY;

        return this.success({
            status: this.status,
        });
    }

    async shutdown() {
        this.status =
            PROVIDER_STATUS.UNAVAILABLE;

        return this.success({
            status: this.status,
        });
    }

    validateConfiguration() {
        if (
            !this.providerName ||
            this.providerName ===
                'UNKNOWN_PROVIDER'
        ) {
            throw new PaymentProviderError(
                'Provider name is required',
                {
                    code:
                        ERROR_CODE.INVALID_CONFIGURATION,
                    provider: this.providerName,
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * AUTHENTICATION
     * =========================================================================
     */

    async authenticate() {
        return this.notImplemented(
            OPERATION.AUTHENTICATE
        );
    }

    async refreshToken() {
        return this.notImplemented(
            'REFRESH_TOKEN'
        );
    }

    /**
     * =========================================================================
     * COLLECTIONS
     * =========================================================================
     */

    async collect(payload) {
        return this.notImplemented(
            OPERATION.COLLECT,
            payload
        );
    }

    async reverseCollection(payload) {
        return this.notImplemented(
            OPERATION.REVERSE_COLLECTION,
            payload
        );
    }

    /**
     * =========================================================================
     * DISBURSEMENTS
     * =========================================================================
     */

    async disburse(payload) {
        return this.notImplemented(
            OPERATION.DISBURSE,
            payload
        );
    }

    async reverseDisbursement(payload) {
        return this.notImplemented(
            OPERATION.REVERSE_DISBURSEMENT,
            payload
        );
    }

    /**
     * =========================================================================
     * TRANSACTION MANAGEMENT
     * =========================================================================
     */

    async getTransactionStatus(reference) {
        this.validateReference(reference);

        return this.notImplemented(
            OPERATION.GET_TRANSACTION_STATUS,
            reference
        );
    }

    async getTransaction(reference) {
        this.validateReference(reference);

        return this.notImplemented(
            OPERATION.GET_TRANSACTION,
            reference
        );
    }

    async retryTransaction(reference) {
        this.validateReference(reference);

        return this.notImplemented(
            OPERATION.RETRY_TRANSACTION,
            reference
        );
    }

    async cancelTransaction(reference) {
        this.validateReference(reference);

        return this.notImplemented(
            OPERATION.CANCEL_TRANSACTION,
            reference
        );
    }

    /**
     * =========================================================================
     * ACCOUNT / BALANCE
     * =========================================================================
     */

    async getBalance() {
        return this.notImplemented(
            OPERATION.GET_BALANCE
        );
    }

    async getSettlementBalance() {
        return this.notImplemented(
            OPERATION.GET_SETTLEMENT_BALANCE
        );
    }

    /**
     * =========================================================================
     * WEBHOOKS
     * =========================================================================
     */

    async verifyWebhook(
        headers,
        payload
    ) {
        if (
            !headers ||
            typeof headers !== 'object'
        ) {
            throw new PaymentProviderError(
                'Webhook headers are required',
                {
                    code:
                        ERROR_CODE.WEBHOOK_INVALID_PAYLOAD,
                    provider: this.providerName,
                    operation:
                        OPERATION.VERIFY_WEBHOOK,
                }
            );
        }

        return this.notImplemented(
            OPERATION.VERIFY_WEBHOOK,
            {
                headers,
                payload,
            }
        );
    }

    async handleWebhook(payload) {
        if (
            payload === undefined ||
            payload === null
        ) {
            throw new PaymentProviderError(
                'Webhook payload is required',
                {
                    code:
                        ERROR_CODE.WEBHOOK_INVALID_PAYLOAD,
                    provider: this.providerName,
                    operation:
                        OPERATION.HANDLE_WEBHOOK,
                }
            );
        }

        return this.notImplemented(
            OPERATION.HANDLE_WEBHOOK,
            payload
        );
    }

    /**
     * =========================================================================
     * RECONCILIATION
     * =========================================================================
     */

    async reconcile(date) {
        const normalizedDate =
            this.normalizeDate(date);

        return this.notImplemented(
            OPERATION.RECONCILE,
            normalizedDate
        );
    }

    async getSettlementReport(date) {
        const normalizedDate =
            this.normalizeDate(date);

        return this.notImplemented(
            OPERATION.GET_SETTLEMENT_REPORT,
            normalizedDate
        );
    }

    /**
     * =========================================================================
     * HEALTH & MONITORING
     * =========================================================================
     */

    async healthCheck() {
        return this.notImplemented(
            OPERATION.HEALTH_CHECK
        );
    }

    async getProviderStatus() {
        return this.success({
            status: this.status,

            provider: this.providerName,

            providerCode:
                this.providerCode,

            environment:
                this.environment,

            interfaceVersion:
                this.interfaceVersion,

            providerVersion:
                this.providerVersion,

            capabilities:
                this.getCapabilities(),

            timestamp:
                new Date().toISOString(),
        });
    }

    /**
     * =========================================================================
     * PROVIDER CAPABILITIES
     * =========================================================================
     */

    getCapabilities() {
        return {
            ...DEFAULT_CAPABILITIES,
        };
    }

    supports(capability) {
        const capabilities =
            this.getCapabilities();

        return (
            Object.prototype.hasOwnProperty.call(
                capabilities,
                capability
            ) &&
            capabilities[capability] === true
        );
    }

    assertCapability(capability) {
        if (!this.supports(capability)) {
            throw new PaymentProviderError(
                `${this.providerName} does not support capability: ${capability}`,
                {
                    code:
                        ERROR_CODE.UNSUPPORTED_OPERATION,
                    provider: this.providerName,
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * IDEMPOTENCY
     * =========================================================================
     */

    generateIdempotencyKey(
        operation,
        payload = {}
    ) {
        const serialized =
            JSON.stringify(
                this.sortObject(payload)
            );

        return crypto
            .createHash('sha256')
            .update(
                `${this.providerCode}:${operation}:${serialized}`
            )
            .digest('hex');
    }

    getIdempotencyKey(payload = {}) {
        return (
            payload.idempotencyKey ||
            payload.idempotency_key ||
            this.generateIdempotencyKey(
                payload.operation ||
                    'PAYMENT',
                payload
            )
        );
    }

    /**
     * =========================================================================
     * REQUEST VALIDATION
     * =========================================================================
     */

    validatePayload(
        payload,
        operation = 'UNKNOWN'
    ) {
        if (
            !payload ||
            typeof payload !== 'object'
        ) {
            throw new PaymentProviderError(
                `${operation}: payload must be an object`,
                {
                    code:
                        ERROR_CODE.INVALID_REQUEST,
                    provider: this.providerName,
                    operation,
                }
            );
        }

        return true;
    }

    validateReference(reference) {
        if (
            reference === undefined ||
            reference === null ||
            String(reference).trim() === ''
        ) {
            throw new PaymentProviderError(
                'Transaction reference is required',
                {
                    code:
                        ERROR_CODE.INVALID_REFERENCE,
                    provider: this.providerName,
                }
            );
        }

        return true;
    }

    validateAmount(amount) {
        const numericAmount =
            Number(amount);

        if (
            !Number.isFinite(numericAmount) ||
            numericAmount <= 0
        ) {
            throw new PaymentProviderError(
                'Transaction amount must be greater than zero',
                {
                    code:
                        ERROR_CODE.INVALID_AMOUNT,
                    provider: this.providerName,
                }
            );
        }

        return numericAmount;
    }

    validateCurrency(currency) {
        const normalized =
            String(
                currency ||
                    this.defaultCurrency
            )
                .trim()
                .toUpperCase();

        if (
            !/^[A-Z]{3}$/.test(normalized)
        ) {
            throw new PaymentProviderError(
                `Invalid currency: ${currency}`,
                {
                    code:
                        ERROR_CODE.INVALID_CURRENCY,
                    provider: this.providerName,
                }
            );
        }

        return normalized;
    }

    /**
     * =========================================================================
     * NORMALIZATION
     * =========================================================================
     */

    normalizeResponse(response) {
        if (
            response === null ||
            response === undefined
        ) {
            throw new PaymentProviderError(
                'Provider returned an empty response',
                {
                    code:
                        ERROR_CODE.INVALID_RESPONSE,
                    provider: this.providerName,
                }
            );
        }

        return response;
    }

    normalizeTransactionStatus(status) {
        if (!status) {
            return TRANSACTION_STATUS.UNKNOWN;
        }

        const normalized =
            String(status)
                .trim()
                .toUpperCase();

        const aliases = {
            SUCCESSFUL:
                TRANSACTION_STATUS.SUCCESS,

            COMPLETED:
                TRANSACTION_STATUS.SUCCESS,

            COMPLETE:
                TRANSACTION_STATUS.SUCCESS,

            PAID:
                TRANSACTION_STATUS.SUCCESS,

            PENDING:
                TRANSACTION_STATUS.PENDING,

            PROCESSING:
                TRANSACTION_STATUS.PROCESSING,

            FAILED:
                TRANSACTION_STATUS.FAILED,

            FAILURE:
                TRANSACTION_STATUS.FAILED,

            REVERSED:
                TRANSACTION_STATUS.REVERSED,

            CANCELLED:
                TRANSACTION_STATUS.CANCELLED,

            CANCELED:
                TRANSACTION_STATUS.CANCELLED,

            EXPIRED:
                TRANSACTION_STATUS.EXPIRED,

            REFUNDED:
                TRANSACTION_STATUS.REFUNDED,
        };

        return (
            aliases[normalized] ||
            TRANSACTION_STATUS.UNKNOWN
        );
    }

    normalizeAmount(amount) {
        return this.validateAmount(
            amount
        );
    }

    normalizeCurrency(currency) {
        return this.validateCurrency(
            currency
        );
    }

    normalizeDate(date) {
        if (!date) {
            return new Date();
        }

        const normalized =
            date instanceof Date
                ? date
                : new Date(date);

        if (
            Number.isNaN(
                normalized.getTime()
            )
        ) {
            throw new PaymentProviderError(
                `Invalid date: ${date}`,
                {
                    code:
                        ERROR_CODE.INVALID_REQUEST,
                    provider: this.providerName,
                }
            );
        }

        return normalized;
    }

    /**
     * =========================================================================
     * ERROR NORMALIZATION
     * =========================================================================
     */

    normalizeError(
        error,
        context = {}
    ) {
        if (
            error instanceof
            PaymentProviderError
        ) {
            return {
                success: false,

                provider:
                    this.providerName,

                providerCode:
                    this.providerCode,

                code:
                    error.code,

                message:
                    error.message,

                retryable:
                    error.retryable,

                operation:
                    context.operation ||
                    error.operation ||
                    null,

                correlationId:
                    context.correlationId ||
                    error.correlationId ||
                    null,

                transactionReference:
                    context.transactionReference ||
                    error.transactionReference ||
                    null,

                timestamp:
                    error.timestamp ||
                    new Date().toISOString(),
            };
        }

        return {
            success: false,

            provider:
                this.providerName,

            providerCode:
                this.providerCode,

            code:
                error?.code ||
                ERROR_CODE.PROVIDER_ERROR,

            message:
                error?.message ||
                'Payment provider error',

            retryable:
                Boolean(
                    error?.retryable
                ),

            operation:
                context.operation ||
                null,

            correlationId:
                context.correlationId ||
                null,

            transactionReference:
                context.transactionReference ||
                null,

            timestamp:
                new Date().toISOString(),
        };
    }

    createError(
        message,
        options = {}
    ) {
        return new PaymentProviderError(
            message,
            {
                provider:
                    this.providerName,

                ...options,
            }
        );
    }

    /**
     * =========================================================================
     * RETRY POLICY
     * =========================================================================
     */

    getRetryPolicy() {
        return {
            ...this.retryPolicy,
            retryableErrors: [
                ...this.retryPolicy
                    .retryableErrors,
            ],
        };
    }

    isRetryableError(error) {
        if (
            error?.retryable === true
        ) {
            return true;
        }

        const code =
            error?.code;

        return this.retryPolicy
            .retryableErrors
            .includes(code);
    }

    calculateRetryDelay(
        attempt = 1
    ) {
        const policy =
            this.retryPolicy;

        const exponentialDelay =
            policy.initialDelayMs *
            Math.pow(
                policy.backoffMultiplier,
                Math.max(
                    0,
                    attempt - 1
                )
            );

        let delay =
            Math.min(
                exponentialDelay,
                policy.maxDelayMs
            );

        if (policy.jitter) {
            delay =
                Math.floor(
                    delay *
                        (0.5 +
                            Math.random())
                );
        }

        return delay;
    }

    /**
     * =========================================================================
     * TIMEOUT CONFIGURATION
     * =========================================================================
     */

    getTimeout(operation) {
        return (
            this.timeouts[operation] ||
            this.timeout
        );
    }

    /**
     * =========================================================================
     * STANDARD SUCCESS / FAILURE
     * =========================================================================
     */

    success(data = {}) {
        return {
            success: true,

            provider:
                this.providerName,

            providerCode:
                this.providerCode,

            interfaceVersion:
                this.interfaceVersion,

            timestamp:
                new Date().toISOString(),

            ...data,
        };
    }

    failure(
        message,
        code = ERROR_CODE.PROVIDER_ERROR,
        data = {}
    ) {
        return {
            success: false,

            provider:
                this.providerName,

            providerCode:
                this.providerCode,

            interfaceVersion:
                this.interfaceVersion,

            code,

            message,

            timestamp:
                new Date().toISOString(),

            ...data,
        };
    }

    /**
     * =========================================================================
     * CORRELATION / REQUEST CONTEXT
     * =========================================================================
     */

    createRequestContext(
        context = {}
    ) {
        return {
            correlationId:
                context.correlationId ||
                crypto.randomUUID(),

            requestId:
                context.requestId ||
                crypto.randomUUID(),

            tenantId:
                context.tenantId ||
                null,

            customerId:
                context.customerId ||
                null,

            transactionId:
                context.transactionId ||
                null,

            idempotencyKey:
                context.idempotencyKey ||
                null,

            operation:
                context.operation ||
                null,

            provider:
                this.providerName,

            providerCode:
                this.providerCode,

            createdAt:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * SAFE LOGGING / DATA REDACTION
     * =========================================================================
     *
     * Payment providers frequently handle:
     *  - phone numbers
     *  - access tokens
     *  - secrets
     *  - API keys
     *  - account numbers
     *  - payment references
     *
     * Never log these blindly.
     */

    redact(value, options = {}) {
        const sensitiveKeys =
            new Set([
                'password',
                'token',
                'accessToken',
                'refreshToken',
                'clientSecret',
                'client_secret',
                'apiKey',
                'api_key',
                'secret',
                'authorization',
                'signature',
                'phone',
                'phoneNumber',
                'msisdn',
                'accountNumber',
                'cardNumber',
                ...(options.sensitiveKeys || []),
            ]);

        const redactValue =
            (input) => {
                if (
                    input === null ||
                    input === undefined
                ) {
                    return input;
                }

                if (
                    typeof input !==
                    'object'
                ) {
                    return input;
                }

                if (
                    Array.isArray(input)
                ) {
                    return input.map(
                        redactValue
                    );
                }

                const output = {};

                for (
                    const [
                        key,
                        currentValue,
                    ] of Object.entries(
                        input
                    )
                ) {
                    if (
                        sensitiveKeys.has(
                            key
                        )
                    ) {
                        output[key] =
                            '[REDACTED]';
                        continue;
                    }

                    output[key] =
                        typeof currentValue ===
                        'object'
                            ? redactValue(
                                  currentValue
                              )
                            : currentValue;
                }

                return output;
            };

        return redactValue(value);
    }

    /**
     * =========================================================================
     * OBJECT UTILITIES
     * =========================================================================
     */

    sortObject(object) {
        if (
            object === null ||
            typeof object !== 'object'
        ) {
            return object;
        }

        if (
            Array.isArray(object)
        ) {
            return object.map(
                (item) =>
                    this.sortObject(item)
            );
        }

        return Object.keys(object)
            .sort()
            .reduce(
                (result, key) => {
                    result[key] =
                        this.sortObject(
                            object[key]
                        );

                    return result;
                },
                {}
            );
    }

    /**
     * =========================================================================
     * OPERATION GUARD
     * =========================================================================
     */

    assertOperationSupported(
        operation
    ) {
        const operationMap = {
            [OPERATION.COLLECT]:
                'collections',

            [OPERATION.REVERSE_COLLECTION]:
                'reversals',

            [OPERATION.DISBURSE]:
                'disbursements',

            [OPERATION.REVERSE_DISBURSEMENT]:
                'reversals',

            [OPERATION.GET_TRANSACTION_STATUS]:
                'transactionLookup',

            [OPERATION.GET_TRANSACTION]:
                'transactionLookup',

            [OPERATION.RETRY_TRANSACTION]:
                'transactionRetry',

            [OPERATION.CANCEL_TRANSACTION]:
                'cancellation',

            [OPERATION.GET_BALANCE]:
                'balanceInquiry',

            [OPERATION.GET_SETTLEMENT_BALANCE]:
                'balanceInquiry',

            [OPERATION.VERIFY_WEBHOOK]:
                'webhookVerification',

            [OPERATION.RECONCILE]:
                'reconciliation',

            [OPERATION.GET_SETTLEMENT_REPORT]:
                'settlements',
        };

        const capability =
            operationMap[operation];

        if (
            capability &&
            !this.supports(capability)
        ) {
            throw this.createError(
                `${this.providerName} does not support operation: ${operation}`,
                {
                    code:
                        ERROR_CODE.UNSUPPORTED_OPERATION,
                    operation,
                }
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * ABSTRACT METHOD HELPER
     * =========================================================================
     */

    notImplemented(
        operation,
        payload
    ) {
        throw this.createError(
            `${operation} must be implemented by ${this.providerName}`,
            {
                code:
                    ERROR_CODE.UNSUPPORTED_OPERATION,
                operation,
                details:
                    payload !== undefined
                        ? {
                              received:
                                  true,
                          }
                        : null,
            }
        );
    }

    /**
     * =========================================================================
     * PROVIDER METADATA
     * =========================================================================
     */

    getMetadata() {
        return {
            providerName:
                this.providerName,

            providerCode:
                this.providerCode,

            providerVersion:
                this.providerVersion,

            interfaceVersion:
                this.interfaceVersion,

            environment:
                this.environment,

            status:
                this.status,

            tenantAware:
                this.tenantAware,

            idempotencyEnabled:
                this.idempotencyEnabled,

            defaultCurrency:
                this.defaultCurrency,

            capabilities:
                this.getCapabilities(),

            retryPolicy:
                this.getRetryPolicy(),

            timeouts:
                {
                    ...this.timeouts,
                },

            initializedAt:
                this.initializedAt,
        };
    }
}

/**
 * ============================================================================
 * STATIC EXPORTS
 * ============================================================================
 *
 * Preserve:
 *
 * const PaymentProviderInterface =
 *     require('./paymentProviderInterface');
 *
 * while also exposing enterprise constants/errors for advanced integrations.
 * ============================================================================
 */

PaymentProviderInterface.PaymentProviderError =
    PaymentProviderError;

PaymentProviderInterface.PROVIDER_STATUS =
    PROVIDER_STATUS;

PaymentProviderInterface.TRANSACTION_STATUS =
    TRANSACTION_STATUS;

PaymentProviderInterface.OPERATION =
    OPERATION;

PaymentProviderInterface.ERROR_CODE =
    ERROR_CODE;

PaymentProviderInterface.DEFAULT_CAPABILITIES =
    DEFAULT_CAPABILITIES;

PaymentProviderInterface.DEFAULT_RETRY_POLICY =
    DEFAULT_RETRY_POLICY;

PaymentProviderInterface.DEFAULT_TIMEOUTS =
    DEFAULT_TIMEOUTS;

PaymentProviderInterface.INTERFACE_VERSION =
    INTERFACE_VERSION;

module.exports =
    PaymentProviderInterface;