'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Logger
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionLogger.js
 *
 * Purpose
 * -------
 * Transaction-aware structured logging service for the enterprise financial
 * transaction platform.
 *
 * Features
 * --------
 * ✓ Structured JSON logging
 * ✓ Backward-compatible object logging
 * ✓ Transaction correlation
 * ✓ Parent/child transaction correlation
 * ✓ Tenant awareness
 * ✓ Request correlation
 * ✓ Idempotency correlation
 * ✓ Provider / operation context
 * ✓ Trace correlation
 * ✓ Recursive sensitive-data masking
 * ✓ Circular-reference protection
 * ✓ Error normalization
 * ✓ Child loggers
 * ✓ External logger adapters
 * ✓ Performance logging
 * ✓ Audit integration
 * ✓ Metrics integration
 * ✓ Safe serialization
 * ✓ Logger failure isolation
 * ✓ Audit failure isolation
 * ✓ Metrics failure isolation
 *
 * Security
 * --------
 * Logging must never expose:
 *
 * • passwords
 * • client secrets
 * • access tokens
 * • refresh tokens
 * • authorization headers
 * • API keys
 * • private keys
 * • payment credentials
 * • PINs / OTPs / CVV
 *
 * ============================================================================
 */

const crypto =
    require('crypto');


/**
 * ============================================================================
 * Log Levels
 * ============================================================================
 */

const LogLevel = Object.freeze({

    DEBUG:
        'DEBUG',

    INFO:
        'INFO',

    WARN:
        'WARN',

    ERROR:
        'ERROR',

    CRITICAL:
        'CRITICAL'

});


/**
 * ============================================================================
 * Sensitive Fields
 * ============================================================================
 */

const SENSITIVE_FIELDS = new Set([

    'password',
    'passwd',
    'pwd',

    'token',
    'accesstoken',
    'refresh_token',
    'refreshtoken',
    'idtoken',
    'bearertoken',

    'secret',
    'clientsecret',
    'client_secret',

    'apikey',
    'api_key',

    'authorization',
    'proxyauthorization',

    'cookie',
    'set-cookie',

    'session',
    'sessionid',

    'privatekey',
    'private_key',

    'encryptionkey',
    'encryption_key',

    'signingkey',
    'signing_key',

    'pin',
    'otp',
    'cvv',
    'cvc',

    'cardnumber',
    'card_number',

    'securitycode',
    'security_code',

    'accesscode',
    'access_code',

    'credentials',
    'credential'

]);


/**
 * ============================================================================
 * Default Values
 * ============================================================================
 */

const REDACTED =
    '[REDACTED]';

const CIRCULAR =
    '[CIRCULAR]';

const MAX_STRING_LENGTH =
    10000;

const MAX_DEPTH =
    12;


/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isPlainObject(
    value
) {

    if (
        !value ||
        typeof value !== 'object'
    ) {

        return false;

    }

    const prototype =
        Object.getPrototypeOf(
            value
        );

    return (
        prototype ===
            Object.prototype ||
        prototype ===
            null
    );

}


/**
 * ============================================================================
 * Transaction Logger
 * ============================================================================
 */

class TransactionLogger {

    constructor(
        options = {}
    ) {

        this.logger =
            options.logger ||
            console;

        this.serviceName =
            options.serviceName ||
            'transaction-service';

        this.environment =
            options.environment ||
            process.env.NODE_ENV ||
            'development';

        this.instanceId =
            options.instanceId ||
            crypto.randomUUID();

        this.tracer =
            options.tracer ||
            null;

        this.auditPublisher =
            options.auditPublisher ||
            null;

        this.metrics =
            options.metrics ||
            null;

        this.auditEnabled =
            options.auditEnabled !== false;

        this.maxDepth =
            Number.isFinite(
                Number(
                    options.maxDepth
                )
            )
                ? Number(
                    options.maxDepth
                )
                : MAX_DEPTH;

        this.maxStringLength =
            Number.isFinite(
                Number(
                    options.maxStringLength
                )
            )
                ? Number(
                    options.maxStringLength
                )
                : MAX_STRING_LENGTH;

        this.baseContext =
            this.sanitize(
                options.context ||
                {}
            );

        this.defaultContext =
            Object.freeze({

                instanceId:
                    this.instanceId,

                service:
                    this.serviceName,

                environment:
                    this.environment

            });

    }


    /**
     * =========================================================================
     * Context Creation
     * =========================================================================
     */

    createContext(
        context = {}
    ) {

        const traceContext =
            this.resolveTraceContext();

        const merged = {

            ...this.defaultContext,

            ...this.baseContext,

            ...this.sanitize(
                context
            )

        };


        /**
         * Explicitly preserve the common transaction propagation contract.
         */

        return {

            ...merged,

            transactionId:
                context.transactionId ??
                merged.transactionId ??
                null,

            parentTransactionId:
                context.parentTransactionId ??
                merged.parentTransactionId ??
                null,

            correlationId:
                context.correlationId ??
                merged.correlationId ??
                null,

            requestId:
                context.requestId ??
                merged.requestId ??
                null,

            idempotencyKey:
                context.idempotencyKey ??
                merged.idempotencyKey ??
                null,

            tenantId:
                context.tenantId ??
                merged.tenantId ??
                null,

            organizationId:
                context.organizationId ??
                merged.organizationId ??
                null,

            userId:
                context.userId ??
                merged.userId ??
                null,

            customerId:
                context.customerId ??
                merged.customerId ??
                null,

            operation:
                context.operation ??
                merged.operation ??
                null,

            provider:
                context.provider ??
                merged.provider ??
                null,

            source:
                context.source ??
                merged.source ??
                null,

            traceId:
                context.traceId ??
                merged.traceId ??
                traceContext.traceId ??
                null,

            spanId:
                context.spanId ??
                merged.spanId ??
                traceContext.spanId ??
                null,

            parentSpanId:
                context.parentSpanId ??
                merged.parentSpanId ??
                traceContext.parentSpanId ??
                null

        };

    }


    /**
     * =========================================================================
     * DEBUG
     * =========================================================================
     */

    debug(
        message,
        context = {},
        data = {}
    ) {

        return this.log(
            LogLevel.DEBUG,
            message,
            context,
            data
        );

    }


    /**
     * =========================================================================
     * INFO
     * =========================================================================
     */

    info(
        message,
        context = {},
        data = {}
    ) {

        return this.log(
            LogLevel.INFO,
            message,
            context,
            data
        );

    }


    /**
     * =========================================================================
     * WARN
     * =========================================================================
     */

    warn(
        message,
        context = {},
        data = {}
    ) {

        return this.log(
            LogLevel.WARN,
            message,
            context,
            data
        );

    }


    /**
     * =========================================================================
     * ERROR
     * =========================================================================
     */

    error(
        message,
        error,
        context = {},
        data = {}
    ) {

        /**
         * Compatibility:
         *
         * logger.error({
         *     message,
         *     tenantId,
         *     error
         * });
         */

        if (
            isPlainObject(message) &&
            (
                message.message ||
                message.error ||
                message.code ||
                message.tenantId
            ) &&
            arguments.length <= 2
        ) {

            const structured =
                message;

            return this.log(
                LogLevel.ERROR,
                structured.message ||
                    'Transaction error',
                structured.context ||
                    structured,
                structured.data ||
                    {
                        error:
                            this.normalizeError(
                                structured.error
                            )
                    }
            );

        }


        return this.log(
            LogLevel.ERROR,
            message,
            context,
            {

                ...data,

                error:
                    this.normalizeError(
                        error
                    )

            }
        );

    }


    /**
     * =========================================================================
     * CRITICAL
     * =========================================================================
     */

    critical(
        message,
        error,
        context = {},
        data = {}
    ) {

        if (
            isPlainObject(message) &&
            arguments.length <= 2
        ) {

            const structured =
                message;

            return this.log(
                LogLevel.CRITICAL,
                structured.message ||
                    'Critical transaction error',
                structured.context ||
                    structured,
                structured.data ||
                    {
                        error:
                            this.normalizeError(
                                structured.error
                            )
                    }
            );

        }


        return this.log(
            LogLevel.CRITICAL,
            message,
            context,
            {

                ...data,

                error:
                    this.normalizeError(
                        error
                    )

            }
        );

    }


    /**
     * =========================================================================
     * CORE LOGGING
     * =========================================================================
     */

    log(
        level,
        message,
        context = {},
        data = {}
    ) {

        const normalizedLevel =
            this.normalizeLevel(
                level
            );


        const normalizedInput =
            this.normalizeLogArguments(
                message,
                context,
                data
            );


        const entryContext =
            this.createContext(
                normalizedInput.context
            );


        const entryData =
            this.sanitize(
                normalizedInput.data
            );


        const entry = {

            timestamp:
                new Date().toISOString(),

            level:
                normalizedLevel,

            service:
                this.serviceName,

            environment:
                this.environment,

            instanceId:
                this.instanceId,

            message:
                this.normalizeMessage(
                    normalizedInput.message
                ),

            context:
                entryContext,

            data:
                entryData

        };


        /**
         * Optional direct fields improve compatibility with log collectors
         * and existing structured-log queries.
         */

        if (
            entryContext.transactionId
        ) {

            entry.transactionId =
                entryContext.transactionId;

        }

        if (
            entryContext.correlationId
        ) {

            entry.correlationId =
                entryContext.correlationId;

        }

        if (
            entryContext.requestId
        ) {

            entry.requestId =
                entryContext.requestId;

        }

        if (
            entryContext.tenantId
        ) {

            entry.tenantId =
                entryContext.tenantId;

        }

        if (
            entryContext.provider
        ) {

            entry.provider =
                entryContext.provider;

        }


        this.write(
            entry
        );


        this.observeMetrics(
            entry
        );


        this.publishAudit(
            entry
        );


        return entry;

    }


    /**
     * =========================================================================
     * Normalize Log Arguments
     * =========================================================================
     *
     * Supports both:
     *
     * logger.info(
     *     'message',
     *     context,
     *     data
     * )
     *
     * and:
     *
     * logger.info({
     *     message: 'message',
     *     tenantId,
     *     correlationId,
     *     ...
     * })
     */

    normalizeLogArguments(
        message,
        context = {},
        data = {}
    ) {

        if (
            isPlainObject(
                message
            )
        ) {

            const structured =
                message;

            const reserved = new Set([

                'message',
                'context',
                'data',
                'error'

            ]);


            const inferredContext = {};

            const inferredData = {};


            for (
                const [
                    key,
                    value
                ]
                of Object.entries(
                    structured
                )
            ) {

                if (
                    reserved.has(
                        key
                    )
                ) {

                    continue;

                }


                if (
                    this.isContextField(
                        key
                    )
                ) {

                    inferredContext[key] =
                        value;

                }
                else {

                    inferredData[key] =
                        value;

                }

            }


            if (
                structured.error !==
                undefined
            ) {

                inferredData.error =
                    this.normalizeError(
                        structured.error
                    );

            }


            return {

                message:
                    structured.message ||
                    '',

                context: {

                    ...inferredContext,

                    ...(structured.context ||
                        {})

                },

                data: {

                    ...inferredData,

                    ...(structured.data ||
                        {})

                }

            };

        }


        return {

            message,

            context:
                context || {},

            data:
                data || {}

        };

    }


    /**
     * =========================================================================
     * Context Field Recognition
     * =========================================================================
     */

    isContextField(
        key
    ) {

        return new Set([

            'transactionId',
            'parentTransactionId',
            'correlationId',
            'requestId',
            'idempotencyKey',
            'tenantId',
            'organizationId',
            'userId',
            'customerId',
            'operation',
            'provider',
            'source',
            'traceId',
            'spanId',
            'parentSpanId',
            'service',
            'environment',
            'instanceId'

        ]).has(
            key
        );

    }


    /**
     * =========================================================================
     * Transaction Lifecycle
     * =========================================================================
     */

    transactionCreated(
        context = {},
        data = {}
    ) {

        return this.info(

            'Transaction created',

            context,

            data

        );

    }


    transactionStarted(
        context = {},
        data = {}
    ) {

        return this.info(

            'Transaction started',

            context,

            data

        );

    }


    transactionValidated(
        context = {},
        data = {}
    ) {

        return this.info(

            'Transaction validated',

            context,

            data

        );

    }


    transactionProcessing(
        context = {},
        data = {}
    ) {

        return this.info(

            'Transaction processing',

            context,

            data

        );

    }


    transactionCommitted(
        context = {},
        data = {}
    ) {

        return this.info(

            'Transaction committed',

            context,

            data

        );

    }


    transactionFailed(
        context = {},
        error,
        data = {}
    ) {

        return this.error(

            'Transaction failed',

            error,

            context,

            data

        );

    }


    transactionRollback(
        context = {},
        error,
        data = {}
    ) {

        return this.warn(

            'Transaction rollback executed',

            context,

            {

                ...data,

                error:
                    this.normalizeError(
                        error
                    )

            }

        );

    }


    transactionTimeout(
        context = {},
        data = {}
    ) {

        return this.warn(

            'Transaction timeout',

            context,

            data

        );

    }


    transactionRetry(
        context = {},
        attempt = 0,
        reason = null
    ) {

        return this.warn(

            'Transaction retry scheduled',

            context,

            {

                attempt:
                    Number(
                        attempt
                    ) || 0,

                reason:
                    reason ||
                    null

            }

        );

    }


    transactionRecovered(
        context = {},
        data = {}
    ) {

        return this.info(

            'Transaction recovered',

            context,

            data

        );

    }


    /**
     * =========================================================================
     * Operation Logging
     * =========================================================================
     */

    operationStarted(
        name,
        context = {},
        data = {}
    ) {

        return this.debug(

            `Operation started: ${name}`,

            {

                ...context,

                operation:
                    name

            },

            data

        );

    }


    operationCompleted(
        name,
        duration,
        context = {},
        data = {}
    ) {

        return this.info(

            `Operation completed: ${name}`,

            {

                ...context,

                operation:
                    name

            },

            {

                ...data,

                durationMs:
                    this.normalizeDuration(
                        duration
                    )

            }

        );

    }


    operationFailed(
        name,
        duration,
        error,
        context = {},
        data = {}
    ) {

        return this.error(

            `Operation failed: ${name}`,

            error,

            {

                ...context,

                operation:
                    name

            },

            {

                ...data,

                durationMs:
                    this.normalizeDuration(
                        duration
                    )

            }

        );

    }


    /**
     * =========================================================================
     * Provider Logging
     * =========================================================================
     */

    providerCall(
        provider,
        operation,
        context = {},
        result = {}
    ) {

        return this.info(

            `Provider call: ${provider}.${operation}`,

            {

                ...context,

                provider,

                operation

            },

            result

        );

    }


    providerFailure(
        provider,
        operation,
        error,
        context = {},
        data = {}
    ) {

        return this.error(

            `Provider call failed: ${provider}.${operation}`,

            error,

            {

                ...context,

                provider,

                operation

            },

            data

        );

    }


    /**
     * =========================================================================
     * Outbox Logging
     * =========================================================================
     */

    outboxClaimed(
        context = {},
        data = {}
    ) {

        return this.debug(

            'Transaction outbox event claimed',

            context,

            data

        );

    }


    outboxPublished(
        context = {},
        data = {}
    ) {

        return this.info(

            'Transaction outbox event published',

            context,

            data

        );

    }


    outboxRetry(
        context = {},
        data = {}
    ) {

        return this.warn(

            'Transaction outbox event retry scheduled',

            context,

            data

        );

    }


    outboxDeadLettered(
        context = {},
        data = {}
    ) {

        return this.error(

            'Transaction outbox event dead-lettered',

            null,

            context,

            data

        );

    }


    /**
     * =========================================================================
     * Lock Logging
     * =========================================================================
     */

    lockAcquired(
        resource,
        context = {},
        data = {}
    ) {

        return this.debug(

            `Transaction lock acquired: ${resource}`,

            context,

            data

        );

    }


    lockReleased(
        resource,
        context = {},
        data = {}
    ) {

        return this.debug(

            `Transaction lock released: ${resource}`,

            context,

            data

        );

    }


    lockTimeout(
        resource,
        context = {},
        data = {}
    ) {

        return this.warn(

            `Transaction lock timeout: ${resource}`,

            context,

            data

        );

    }


    lockLeaseLost(
        resource,
        context = {},
        data = {}
    ) {

        return this.error(

            `Transaction lock lease lost: ${resource}`,

            null,

            context,

            data

        );

    }


    /**
     * =========================================================================
     * Error Normalization
     * =========================================================================
     */

    normalizeError(
        error,
        depth = 0
    ) {

        if (
            !error
        ) {

            return null;

        }


        if (
            depth >
            this.maxDepth
        ) {

            return {

                name:
                    'Error',

                message:
                    '[MAX_ERROR_DEPTH]',

                code:
                    null,

                status:
                    null

            };

        }


        if (
            error instanceof Error
        ) {

            return this.sanitize({

                name:
                    error.name ||
                    'Error',

                message:
                    error.message ||
                    String(
                        error
                    ),

                code:
                    error.code ||
                    null,

                category:
                    error.category ||
                    null,

                severity:
                    error.severity ||
                    null,

                status:
                    error.status ??
                    error.statusCode ??
                    null,

                retryable:
                    typeof error.retryable ===
                    'boolean'
                        ? error.retryable
                        : null,

                requiresCompensation:
                    typeof error.requiresCompensation ===
                    'boolean'
                        ? error.requiresCompensation
                        : null,

                transactionId:
                    error.transactionId ||
                    null,

                correlationId:
                    error.correlationId ||
                    null,

                provider:
                    error.provider ||
                    null,

                providerCode:
                    error.providerCode ||
                    null,

                stack:
                    this.isProductionEnvironment()
                        ? undefined
                        : (
                            error.stack ||
                            null
                        ),

                cause:
                    error.cause
                        ? this.normalizeError(
                            error.cause,
                            depth + 1
                        )
                        : null

            });

        }


        if (
            typeof error ===
            'object'
        ) {

            return this.sanitize({

                name:
                    error.name ||
                    'Error',

                message:
                    error.message ||
                    String(
                        error
                    ),

                code:
                    error.code ||
                    null,

                category:
                    error.category ||
                    null,

                severity:
                    error.severity ||
                    null,

                status:
                    error.status ??
                    error.statusCode ??
                    null,

                retryable:
                    typeof error.retryable ===
                    'boolean'
                        ? error.retryable
                        : null,

                provider:
                    error.provider ||
                    null,

                providerCode:
                    error.providerCode ||
                    null

            });

        }


        return {

            name:
                'Error',

            message:
                String(
                    error
                ),

            code:
                null,

            status:
                null

        };

    }


    /**
     * =========================================================================
     * Sensitive Masking
     * =========================================================================
     */

    maskSensitive(
        value
    ) {

        return this.sanitize(
            value
        );

    }


    sanitize(
        value,
        options = {}
    ) {

        const state = {

            seen:
                new WeakSet(),

            depth:
                0

        };


        return this.sanitizeValue(

            value,

            state,

            options

        );

    }


    sanitizeValue(
        value,
        state,
        options
    ) {

        const maxDepth =
            options.maxDepth ||
            this.maxDepth;

        if (
            value ===
                null ||
            value ===
                undefined
        ) {

            return value;

        }


        if (
            typeof value ===
            'string'
        ) {

            return value.length >
                this.maxStringLength

                ? (
                    value.slice(
                        0,
                        this.maxStringLength
                    ) +
                    '...[TRUNCATED]'
                )

                : value;

        }


        if (
            typeof value ===
            'bigint'
        ) {

            return value.toString();

        }


        if (
            typeof value !==
            'object'
        ) {

            return value;

        }


        if (
            state.depth >
            maxDepth
        ) {

            return '[MAX_DEPTH]';

        }


        if (
            state.seen.has(
                value
            )
        ) {

            return CIRCULAR;

        }


        state.seen.add(
            value
        );


        if (
            value instanceof Date
        ) {

            return value.toISOString();

        }


        if (
            Buffer.isBuffer(
                value
            )
        ) {

            return '[BUFFER]';

        }


        const nextState = {

            seen:
                state.seen,

            depth:
                state.depth +
                1

        };


        if (
            Array.isArray(
                value
            )
        ) {

            return value.map(

                item =>
                    this.sanitizeValue(
                        item,
                        nextState,
                        options
                    )

            );

        }


        if (
            value instanceof Map
        ) {

            const output = {};


            for (
                const [
                    key,
                    nestedValue
                ]
                of value.entries()
            ) {

                const normalizedKey =
                    String(
                        key
                    );


                output[normalizedKey] =
                    this.isSensitiveField(
                        normalizedKey
                    )

                        ? REDACTED

                        : this.sanitizeValue(
                            nestedValue,
                            nextState,
                            options
                        );

            }


            return output;

        }


        if (
            value instanceof Set
        ) {

            return Array.from(
                value.values()
            )
                .map(

                    item =>
                        this.sanitizeValue(
                            item,
                            nextState,
                            options
                        )

                );

        }


        const output = {};


        for (
            const [
                key,
                nestedValue
            ]
            of Object.entries(
                value
            )
        ) {

            if (
                this.isSensitiveField(
                    key
                )
            ) {

                output[key] =
                    REDACTED;

                continue;

            }


            output[key] =
                this.sanitizeValue(
                    nestedValue,
                    nextState,
                    options
                );

        }


        return output;

    }


    /**
     * =========================================================================
     * Sensitive Field Detection
     * =========================================================================
     */

    isSensitiveField(
        field
    ) {

        if (
            !field
        ) {

            return false;

        }


        const normalized =
            String(
                field
            )
                .trim()
                .toLowerCase()
                .replace(
                    /[\s-]/g,
                    ''
                );


        if (
            SENSITIVE_FIELDS.has(
                normalized
            )
        ) {

            return true;

        }


        const patterns = [

            'password',

            'secret',

            'accesstoken',

            'refreshtoken',

            'idtoken',

            'bearertoken',

            'apikey',

            'privatekey',

            'authorization',

            'proxyauthorization',

            'sessiontoken',

            'encryptionkey',

            'signingkey',

            'cardnumber',

            'securitycode'

        ];


        return patterns.some(

            pattern =>
                normalized.includes(
                    pattern
                )

        );

    }


    /**
     * =========================================================================
     * Child Logger
     * =========================================================================
     */

    child(
        context = {}
    ) {

        return new TransactionLogger({

            logger:
                this.logger,

            serviceName:
                this.serviceName,

            environment:
                this.environment,

            tracer:
                this.tracer,

            auditPublisher:
                this.auditPublisher,

            metrics:
                this.metrics,

            auditEnabled:
                this.auditEnabled,

            instanceId:
                this.instanceId,

            maxDepth:
                this.maxDepth,

            maxStringLength:
                this.maxStringLength,

            context: {

                ...this.baseContext,

                ...this.sanitize(
                    context
                )

            }

        });

    }


    /**
     * =========================================================================
     * Performance Timer
     * =========================================================================
     */

    startTimer(
        context = {}
    ) {

        const startedAt =
            process.hrtime.bigint();

        let ended =
            false;


        return {

            end: () => {

                if (
                    ended
                ) {

                    return 0;

                }


                ended =
                    true;


                const elapsedNs =
                    process.hrtime.bigint() -
                    startedAt;


                const durationMs =
                    Number(
                        elapsedNs
                    ) /
                    1e6;


                this.observeMetric(

                    'transaction_log_operation_duration_ms',

                    durationMs,

                    this.createContext(
                        context
                    )

                );


                return durationMs;

            }

        };

    }


    /**
     * =========================================================================
     * Timed Operation
     * =========================================================================
     */

    async time(
        name,
        context,
        operation
    ) {

        if (
            typeof operation !==
            'function'
        ) {

            throw new TypeError(
                'operation must be a function'
            );

        }


        const timer =
            this.startTimer(
                context
            );


        this.operationStarted(
            name,
            context
        );


        try {

            const result =
                await operation();


            const duration =
                timer.end();


            this.operationCompleted(

                name,

                duration,

                context

            );


            return result;

        }
        catch (error) {

            const duration =
                timer.end();


            this.operationFailed(

                name,

                duration,

                error,

                context

            );


            throw error;

        }

    }


    /**
     * =========================================================================
     * Trace Context
     * =========================================================================
     */

    resolveTraceContext() {

        try {

            if (
                !this.tracer
            ) {

                return {

                    traceId:
                        null,

                    spanId:
                        null,

                    parentSpanId:
                        null

                };

            }


            let span = null;


            if (
                typeof this.tracer.getActiveSpan ===
                'function'
            ) {

                span =
                    this.tracer.getActiveSpan();

            }
            else if (
                this.tracer.currentSpan
            ) {

                span =
                    this.tracer.currentSpan;

            }


            if (
                !span
            ) {

                return {

                    traceId:
                        null,

                    spanId:
                        null,

                    parentSpanId:
                        null

                };

            }


            const spanContext =
                typeof span.spanContext ===
                'function'

                    ? span.spanContext()

                    : null;


            return {

                traceId:
                    spanContext?.traceId ||
                    span.traceId ||
                    null,

                spanId:
                    spanContext?.spanId ||
                    span.spanId ||
                    null,

                parentSpanId:
                    span.parentSpanId ||
                    null

            };

        }
        catch (_) {

            return {

                traceId:
                    null,

                spanId:
                    null,

                parentSpanId:
                    null

            };

        }

    }


    /**
     * =========================================================================
     * Output Writer
     * =========================================================================
     */

    write(
        entry
    ) {

        let serialized;


        try {

            serialized =
                this.safeStringify(
                    entry
                );

        }
        catch (_) {

            serialized =
                JSON.stringify({

                    timestamp:
                        new Date().toISOString(),

                    level:
                        LogLevel.ERROR,

                    message:
                        'Log serialization failed',

                    service:
                        this.serviceName,

                    instanceId:
                        this.instanceId

                });

        }


        try {

            switch (
                entry.level
            ) {

                case LogLevel.CRITICAL:

                case LogLevel.ERROR:

                    this.logger?.error?.(
                        serialized
                    );

                    break;

                case LogLevel.WARN:

                    this.logger?.warn?.(
                        serialized
                    );

                    break;

                case LogLevel.DEBUG:

                    this.logger?.debug?.(
                        serialized
                    );

                    break;

                default:

                    this.logger?.info?.(
                        serialized
                    );

            }

        }
        catch (_) {

            /**
             * Logging must never alter transaction semantics.
             */

        }

    }


    /**
     * =========================================================================
     * Safe JSON Stringify
     * =========================================================================
     */

    safeStringify(
        value
    ) {

        const sanitized =
            this.sanitize(
                value
            );


        return JSON.stringify(
            sanitized
        );

    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    publishAudit(
        entry
    ) {

        if (
            !this.auditEnabled ||
            !this.auditPublisher
        ) {

            return;

        }


        try {

            let result;


            if (
                typeof this.auditPublisher.publish ===
                'function'
            ) {

                result =
                    this.auditPublisher.publish(
                        entry
                    );

            }
            else if (
                typeof this.auditPublisher ===
                'function'
            ) {

                result =
                    this.auditPublisher(
                        entry
                    );

            }


            if (
                result &&
                typeof result.catch ===
                'function'
            ) {

                result.catch(
                    () => {

                        this.metrics?.increment?.(
                            'transaction_log_audit_failure_total'
                        );

                    }
                );

            }

        }
        catch (_) {

            this.metrics?.increment?.(
                'transaction_log_audit_failure_total'
            );

        }

    }


    /**
     * =========================================================================
     * Metrics
     * =========================================================================
     */

    observeMetrics(
        entry
    ) {

        try {

            this.observeMetric(

                'transaction_log_entries_total',

                1,

                {

                    level:
                        entry.level,

                    service:
                        this.serviceName,

                    environment:
                        this.environment

                }

            );

        }
        catch (_) {

            // Metrics are best effort.

        }

    }


    observeMetric(
        metricName,
        value,
        labels = {}
    ) {

        try {

            if (
                !this.metrics
            ) {

                return;

            }


            if (
                typeof this.metrics.observe ===
                'function'
            ) {

                this.metrics.observe(

                    metricName,

                    value,

                    labels

                );

                return;

            }


            if (
                typeof this.metrics.histogram ===
                'function'
            ) {

                this.metrics.histogram(

                    metricName,

                    value,

                    labels

                );

                return;

            }


            if (
                typeof this.metrics.increment ===
                'function'
            ) {

                this.metrics.increment(

                    metricName,

                    value,
                    labels

                );

            }

        }
        catch (_) {

            // Metrics must never break logging.

        }

    }


    /**
     * =========================================================================
     * Message Normalization
     * =========================================================================
     */

    normalizeMessage(
        message
    ) {

        if (
            message === null ||
            message === undefined
        ) {

            return '';

        }


        if (
            typeof message ===
            'string'
        ) {

            return message.slice(
                0,
                this.maxStringLength
            );

        }


        try {

            return JSON.stringify(
                this.sanitize(
                    message
                )
            );

        }
        catch (_) {

            return String(
                message
            )
                .slice(
                    0,
                    this.maxStringLength
                );

        }

    }


    /**
     * =========================================================================
     * Duration
     * =========================================================================
     */

    normalizeDuration(
        duration
    ) {

        const value =
            Number(
                duration
            );


        if (
            !Number.isFinite(
                value
            ) ||
            value < 0
        ) {

            return null;

        }


        return value;

    }


    /**
     * =========================================================================
     * Level
     * =========================================================================
     */

    normalizeLevel(
        level
    ) {

        const normalized =
            String(
                level ||
                LogLevel.INFO
            )
                .trim()
                .toUpperCase();


        return Object.values(
            LogLevel
        )
            .includes(
                normalized
            )
                ? normalized
                : LogLevel.INFO;

    }


    /**
     * =========================================================================
     * Environment
     * =========================================================================
     */

    isProductionEnvironment() {

        return (

            String(
                this.environment
            )
                .toLowerCase() ===
            'production'

        );

    }


    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     */

    getConfiguration() {

        return {

            service:
                this.serviceName,

            environment:
                this.environment,

            instanceId:
                this.instanceId,

            auditEnabled:
                this.auditEnabled,

            hasTracer:
                Boolean(
                    this.tracer
                ),

            hasMetrics:
                Boolean(
                    this.metrics
                ),

            hasAuditPublisher:
                Boolean(
                    this.auditPublisher
                ),

            maxDepth:
                this.maxDepth,

            maxStringLength:
                this.maxStringLength

        };

    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        return {

            status:
                'UP',

            component:
                'transaction-logger',

            service:
                this.serviceName,

            environment:
                this.environment,

            instanceId:
                this.instanceId,

            auditEnabled:
                this.auditEnabled,

            metricsEnabled:
                Boolean(
                    this.metrics
                ),

            tracingEnabled:
                Boolean(
                    this.tracer
                )

        };

    }

}


/**
 * ============================================================================
 * Static API
 * ============================================================================
 */

TransactionLogger.Levels =
    LogLevel;

TransactionLogger.SENSITIVE_FIELDS =
    SENSITIVE_FIELDS;

TransactionLogger.REDACTED =
    REDACTED;

TransactionLogger.CIRCULAR =
    CIRCULAR;


/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    TransactionLogger;