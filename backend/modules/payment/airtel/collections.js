'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collections Module
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/collections.js
 *
 * Architectural Role
 * ------------------
 * Public facade for Airtel Money collection operations.
 *
 * This module is intentionally an orchestration boundary. Provider-specific
 * HTTP/request construction, OAuth handling, callback processing, settlement,
 * reconciliation and financial posting belong to their canonical services.
 *
 * Responsibilities
 * ----------------
 * • Collection request orchestration.
 * • Collection status lookup delegation.
 * • Callback processing delegation.
 * • Tenant-context propagation.
 * • Authorization boundary integration.
 * • Idempotency context propagation.
 * • Configuration validation.
 * • Audit integration.
 * • Outbox/event integration.
 * • Metrics and tracing.
 * • Dependency health reporting.
 * • Capability discovery.
 *
 * Does NOT:
 * ----------
 * • Perform Airtel provider HTTP requests directly.
 * • Manage OAuth tokens.
 * • Modify wallet balances.
 * • Write ledger entries directly.
 * • Decide settlement independently.
 * • Reconcile provider statements.
 * • Process callbacks directly.
 * • Implement payment business rules duplicated from collectionService.
 *
 * Financial Safety Principles
 * ---------------------------
 * • A successful collection request means provider-side submission/acceptance,
 *   not financial settlement.
 * • Idempotency must reach the canonical collection service before any
 *   provider side effect.
 * • Monetary values are passed through without floating-point arithmetic.
 * • Tenant identity must remain explicit and must never be taken solely from
 *   untrusted callback/payment payload content.
 * • Audit/event failures are observable and must not falsify the financial
 *   response.
 * • Provider communication remains inside collectionService.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';

const MODULE_STATUS = Object.freeze({
    CREATED: 'CREATED',
    INITIALIZING: 'INITIALIZING',
    READY: 'READY',
    DEGRADED: 'DEGRADED',
    FAILED: 'FAILED'
});

const COLLECTION_STATUS = Object.freeze({
    ACCEPTED: 'ACCEPTED',
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    UNKNOWN: 'UNKNOWN'
});


function isFunction(value) {
    return typeof value === 'function';
}


function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function generateId() {
    return crypto.randomUUID();
}


function safeError(error) {
    if (!error) {
        return null;
    }

    if (
        isFunction(error.toJSON)
    ) {
        try {
            return error.toJSON();
        } catch (_) {
            // Fall through to controlled fields.
        }
    }

    return {
        name:
            error.name,
        code:
            error.code,
        message:
            error.message
    };
}


function safeStatus(value) {
    const status =
        String(value || '')
            .trim()
            .toUpperCase();

    return Object.values(
        COLLECTION_STATUS
    ).includes(status)
        ? status
        : (
            status
                ? status.slice(0, 64)
                : undefined
        );
}


function safeReference(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    return String(value)
        .trim()
        .slice(0, 256);
}


/**
 * Keep logs free of sensitive identifiers that are not required for
 * operational diagnosis.
 */
function sanitizeMetadata(value) {
    if (!isObject(value)) {
        return value;
    }

    const sensitiveKeys = new Set([
        'authorization',
        'cookie',
        'password',
        'secret',
        'clientSecret',
        'client_secret',
        'apiKey',
        'api_key',
        'accessToken',
        'refreshToken',
        'token',
        'signature',
        'payload',
        'rawPayload',
        'credentials'
    ]);

    const output = {};

    for (
        const [key, item]
        of Object.entries(value)
    ) {
        if (
            sensitiveKeys.has(key)
        ) {
            continue;
        }

        if (
            isObject(item) &&
            !Array.isArray(item)
        ) {
            output[key] =
                sanitizeMetadata(item);
        } else {
            output[key] = item;
        }
    }

    return output;
}


class AirtelCollections {

    constructor({
        collectionService,

        callbackProcessor,

        configuration,

        tenantResolver,
        authorizationService,
        idempotencyManager,

        auditService,
        outboxService,
        eventPublisher,

        logger,
        metrics,
        tracer
    } = {}) {

        if (!collectionService) {
            throw new Error(
                'collectionService is required'
            );
        }

        this.collectionService =
            collectionService;

        this.callbackProcessor =
            callbackProcessor;

        this.configuration =
            configuration;

        this.tenantResolver =
            tenantResolver;

        this.authorizationService =
            authorizationService;

        this.idempotencyManager =
            idempotencyManager;

        this.auditService =
            auditService;

        this.outboxService =
            outboxService;

        this.eventPublisher =
            eventPublisher;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.startedAt =
            new Date();

        this.state = {
            status:
                MODULE_STATUS.CREATED,

            initialized:
                false,

            initializing:
                false,

            initializedAt:
                null,

            lastFailureAt:
                null
        };

        this.statistics = {
            initialized:
                0,

            collectAttempts:
                0,

            collectSuccesses:
                0,

            collectFailures:
                0,

            queryAttempts:
                0,

            callbackAttempts:
                0,

            callbackSuccesses:
                0,

            callbackFailures:
                0
        };

        this.initializationPromise =
            null;
    }


    /**
     * =========================================================================
     * Initialize
     * =========================================================================
     */
    async initialize(options = {}) {
        if (
            this.state.initialized
        ) {
            return this.initializationResult();
        }

        if (
            this.initializationPromise
        ) {
            return this.initializationPromise;
        }

        const operationId =
            options.operationId ||
            generateId();

        this.initializationPromise =
            this.initializeInternal({
                ...options,
                operationId
            })
                .finally(() => {
                    this.initializationPromise =
                        null;
                });

        return this.initializationPromise;
    }


    async initializeInternal({
        tenantId,
        correlationId,
        operationId,
        context = {}
    } = {}) {
        this.state.status =
            MODULE_STATUS.INITIALIZING;

        this.state.initializing =
            true;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.collections.initialize'
            );

        try {
            this.validateDependencies();

            const resolvedTenantId =
                await this.resolveTenant({
                    tenantId,
                    context
                });

            if (
                isFunction(
                    this.collectionService.initialize
                )
            ) {
                await this.collectionService.initialize({
                    tenantId:
                        resolvedTenantId,
                    correlationId,
                    operationId,
                    context
                });
            }

            this.state.initialized =
                true;

            this.state.initializing =
                false;

            this.state.status =
                MODULE_STATUS.READY;

            this.state.initializedAt =
                new Date();

            this.statistics.initialized++;

            this.metrics?.increment?.(
                'payment_airtel_collections_initialized_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_collections_initialized_total'
            );

            await this.audit({
                action:
                    'AIRTEL_COLLECTIONS_INITIALIZED',
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId
            });

            this.logger?.info?.({
                message:
                    'Airtel Collections initialized',
                provider:
                    PROVIDER,
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId
            });

            return this.initializationResult();
        } catch (error) {
            this.state.initialized =
                false;

            this.state.initializing =
                false;

            this.state.status =
                MODULE_STATUS.FAILED;

            this.state.lastFailureAt =
                new Date();

            this.metrics?.increment?.(
                'payment_airtel_collections_initialization_failure_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_collections_initialization_failure_total'
            );

            this.logger?.error?.({
                message:
                    'Airtel Collections initialization failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Request To Pay / Collection
     * =========================================================================
     */
    async collect(request = {}) {
        this.statistics.collectAttempts++;

        const correlationId =
            request.correlationId ||
            request.context?.correlationId ||
            generateId();

        const operationId =
            request.operationId ||
            request.context?.operationId ||
            generateId();

        const started =
            Date.now();

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.collections.collect'
            );

        try {
            const context =
                isObject(request.context)
                    ? request.context
                    : {};

            const tenantId =
                await this.resolveTenant({
                    tenantId:
                        request.tenantId,
                    context
                });

            await this.ensureInitialized({
                tenantId,
                correlationId,
                operationId,
                context
            });

            await this.assertAuthorized({
                tenantId,
                actor:
                    request.actor,
                action:
                    'CREATE_AIRTEL_COLLECTION',
                context: {
                    ...context,
                    correlationId,
                    operationId
                }
            });

            this.validateCollectionRequest({
                ...request,
                tenantId
            });

            const idempotencyKey =
                this.resolveIdempotencyKey({
                    request,
                    tenantId
                });

            const duplicate =
                await this.checkIdempotency({
                    tenantId,
                    key:
                        idempotencyKey,
                    correlationId,
                    operationId,
                    context
                });

            if (
                duplicate
            ) {
                this.statistics.collectSuccesses++;

                this.metrics?.increment?.(
                    'payment_airtel_collection_duplicate_total'
                );

                return {
                    ...duplicate,
                    duplicate:
                        true,
                    provider:
                        PROVIDER,
                    correlationId,
                    operationId
                };
            }

            this.logger?.info?.({
                message:
                    'Starting Airtel collection',
                provider:
                    PROVIDER,
                tenantId,
                reference:
                    safeReference(
                        request.reference ||
                        request.externalId
                    ),
                amount:
                    this.safeAmountMetadata(
                        request.amount
                    ),
                currency:
                    request.currency,
                correlationId,
                operationId
            });

            const response =
                await this.collectionService.collect({
                    ...request,

                    tenantId,

                    correlationId,

                    operationId,

                    idempotencyKey,

                    context: {
                        ...context,

                        provider:
                            PROVIDER
                    }
                });

            this.statistics.collectSuccesses++;

            const durationMs =
                Date.now() - started;

            this.metrics?.increment?.(
                'payment_airtel_collection_success_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_collection_success_total'
            );

            this.metrics?.histogram?.(
                'payment_airtel_collection_duration_ms',
                durationMs
            );

            await this.audit({
                action:
                    'AIRTEL_COLLECTION_CREATED',
                tenantId,
                reference:
                    response?.reference ||
                    response?.externalId ||
                    request.reference,
                correlationId,
                operationId,
                metadata: {
                    status:
                        safeStatus(
                            response?.status
                        ),
                    idempotencyKey,
                    durationMs
                }
            });

            await this.publishEvent({
                eventType:
                    'AIRTEL_COLLECTION_CREATED',
                tenantId,
                correlationId,
                operationId,
                payload: {
                    provider:
                        PROVIDER,
                    status:
                        safeStatus(
                            response?.status
                        ),
                    reference:
                        response?.reference ||
                        response?.externalId ||
                        request.reference,
                    externalId:
                        response?.externalId
                },
                context
            });

            await this.registerIdempotency({
                tenantId,
                key:
                    idempotencyKey,
                operationId,
                response,
                context
            });

            return {
                ...response,

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                operationId
            };
        } catch (error) {
            this.statistics.collectFailures++;

            const durationMs =
                Date.now() - started;

            this.metrics?.increment?.(
                'payment_airtel_collection_failure_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_collection_failure_total'
            );

            this.metrics?.histogram?.(
                'payment_airtel_collection_duration_ms',
                durationMs
            );

            this.logger?.error?.({
                message:
                    'Airtel collection failed',
                provider:
                    PROVIDER,
                tenantId:
                    request.tenantId,
                correlationId,
                operationId,
                reference:
                    safeReference(
                        request.reference ||
                        request.externalId
                    ),
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Query Collection Status
     * =========================================================================
     */
    async query(
        reference,
        options = {}
    ) {
        this.statistics.queryAttempts++;

        const correlationId =
            options.correlationId ||
            options.context?.correlationId ||
            generateId();

        const operationId =
            options.operationId ||
            options.context?.operationId ||
            generateId();

        const context =
            isObject(options.context)
                ? options.context
                : {};

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.collections.query'
            );

        try {
            const normalizedReference =
                safeReference(reference);

            if (
                !normalizedReference
            ) {
                const error =
                    new Error(
                        'collection reference is required'
                    );

                error.code =
                    'AIRTEL_COLLECTION_REFERENCE_REQUIRED';

                throw error;
            }

            const tenantId =
                await this.resolveTenant({
                    tenantId:
                        options.tenantId,
                    context
                });

            await this.ensureInitialized({
                tenantId,
                correlationId,
                operationId,
                context
            });

            await this.assertAuthorized({
                tenantId,
                actor:
                    options.actor,
                action:
                    'QUERY_AIRTEL_COLLECTION',
                context: {
                    ...context,
                    correlationId,
                    operationId
                }
            });

            const response =
                await this.collectionService.query({
                    reference:
                        normalizedReference,

                    ...options,

                    tenantId,

                    correlationId,

                    operationId,

                    context: {
                        ...context,
                        provider:
                            PROVIDER
                    }
                });

            return {
                ...response,

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                operationId
            };
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Callback Processing Delegation
     * =========================================================================
     */
    async processCallback(
        callback = {}
    ) {
        this.statistics.callbackAttempts++;

        const correlationId =
            callback.correlationId ||
            callback.context?.correlationId ||
            generateId();

        const operationId =
            callback.operationId ||
            callback.context?.operationId ||
            generateId();

        if (
            !this.callbackProcessor
        ) {
            this.statistics.callbackFailures++;

            const error =
                new Error(
                    'callbackProcessor not configured'
                );

            error.code =
                'AIRTEL_CALLBACK_PROCESSOR_UNAVAILABLE';

            throw error;
        }

        const context =
            isObject(callback.context)
                ? callback.context
                : {};

        const tenantId =
            await this.resolveTenant({
                tenantId:
                    callback.tenantId,
                context
            });

        await this.ensureInitialized({
            tenantId,
            correlationId,
            operationId,
            context
        });

        try {
            const result =
                await this.callbackProcessor.process({
                    ...callback,

                    tenantId,

                    correlationId,

                    operationId,

                    context: {
                        ...context,
                        provider:
                            PROVIDER
                    }
                });

            this.statistics.callbackSuccesses++;

            this.metrics?.increment?.(
                'payment_airtel_callback_delegated_total'
            );

            return {
                ...result,

                provider:
                    PROVIDER,

                tenantId,

                correlationId,

                operationId
            };
        } catch (error) {
            this.statistics.callbackFailures++;

            throw error;
        }
    }


    /**
     * =========================================================================
     * Configuration / Request Validation
     * =========================================================================
     */
    validateCollectionRequest(
        request = {}
    ) {
        const {
            tenantId,
            amount,
            currency
        } = request;

        if (
            !tenantId
        ) {
            const error =
                new Error(
                    'tenantId is required for Airtel collections'
                );

            error.code =
                'AIRTEL_COLLECTION_TENANT_REQUIRED';

            throw error;
        }

        if (
            amount === undefined ||
            amount === null ||
            String(amount).trim() === ''
        ) {
            const error =
                new Error(
                    'collection amount is required'
                );

            error.code =
                'AIRTEL_COLLECTION_AMOUNT_REQUIRED';

            throw error;
        }

        /**
         * Do not convert monetary values to Number here. Validation belongs
         * to the canonical collection service, while this facade only rejects
         * obviously malformed input.
         */
        if (
            !/^\d+(?:\.\d+)?$/.test(
                String(amount).trim()
            )
        ) {
            const error =
                new Error(
                    'collection amount has an invalid monetary format'
                );

            error.code =
                'AIRTEL_COLLECTION_AMOUNT_INVALID';

            throw error;
        }

        if (
            !currency ||
            !/^[A-Za-z]{3}$/.test(
                String(currency).trim()
            )
        ) {
            const error =
                new Error(
                    'collection currency must be a valid 3-letter currency code'
                );

            error.code =
                'AIRTEL_COLLECTION_CURRENCY_INVALID';

            throw error;
        }

        return true;
    }


    validateConfiguration() {
        if (
            !this.configuration
        ) {
            return true;
        }

        if (
            isFunction(
                this.configuration.validate
            )
        ) {
            return this.configuration.validate();
        }

        return true;
    }


    /**
     * =========================================================================
     * Tenant Context
     * =========================================================================
     */
    async resolveTenant({
        tenantId,
        context = {}
    } = {}) {
        if (
            tenantId !== undefined &&
            tenantId !== null &&
            String(tenantId).trim() !== ''
        ) {
            return String(
                tenantId
            );
        }

        if (
            this.tenantResolver &&
            isFunction(
                this.tenantResolver.resolve
            )
        ) {
            const resolved =
                await this.tenantResolver.resolve(
                    context
                );

            if (
                resolved !== undefined &&
                resolved !== null &&
                String(resolved).trim() !== ''
            ) {
                return String(
                    resolved
                );
            }
        }

        return null;
    }


    /**
     * =========================================================================
     * Authorization Boundary
     * =========================================================================
     */
    async assertAuthorized({
        tenantId,
        actor,
        action,
        context
    } = {}) {
        if (
            !this.authorizationService
        ) {
            return true;
        }

        if (
            isFunction(
                this.authorizationService.assertAuthorized
            )
        ) {
            await this.authorizationService.assertAuthorized({
                tenantId,
                actor,
                action,
                context
            });

            return true;
        }

        if (
            isFunction(
                this.authorizationService.authorize
            )
        ) {
            const authorized =
                await this.authorizationService.authorize({
                    tenantId,
                    actor,
                    action,
                    context
                });

            if (
                authorized === false
            ) {
                const error =
                    new Error(
                        'Airtel collection operation is not authorized'
                    );

                error.code =
                    'AIRTEL_COLLECTION_UNAUTHORIZED';

                throw error;
            }
        }

        return true;
    }


    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */
    resolveIdempotencyKey({
        request,
        tenantId
    } = {}) {
        const supplied =
            request.idempotencyKey ||
            request.headers?.['idempotency-key'] ||
            request.headers?.['Idempotency-Key'];

        if (
            supplied &&
            String(supplied).trim()
        ) {
            return String(
                supplied
            ).trim();
        }

        /**
         * The deterministic fallback is scoped to tenant/provider/business
         * reference. The preferred contract remains caller-supplied
         * idempotencyKey.
         */
        const reference =
            request.reference ||
            request.externalId;

        if (
            !reference
        ) {
            return undefined;
        }

        return crypto
            .createHash('sha256')
            .update(
                [
                    PROVIDER,
                    tenantId,
                    String(reference)
                ].join(':')
            )
            .digest('hex');
    }


    async checkIdempotency({
        tenantId,
        key,
        correlationId,
        operationId,
        context
    } = {}) {
        if (
            !key ||
            !this.idempotencyManager
        ) {
            return null;
        }

        if (
            isFunction(
                this.idempotencyManager.get
            )
        ) {
            return this.idempotencyManager.get({
                tenantId,
                key,
                correlationId,
                operationId,
                context
            });
        }

        if (
            isFunction(
                this.idempotencyManager.find
            )
        ) {
            return this.idempotencyManager.find({
                tenantId,
                key
            });
        }

        return null;
    }


    async registerIdempotency({
        tenantId,
        key,
        response,
        operationId,
        context
    } = {}) {
        if (
            !key ||
            !this.idempotencyManager
        ) {
            return;
        }

        const payload = {
            tenantId,
            key,
            response,
            operationId,
            context
        };

        if (
            isFunction(
                this.idempotencyManager.register
            )
        ) {
            await this.idempotencyManager.register(
                payload
            );
            return;
        }

        if (
            isFunction(
                this.idempotencyManager.set
            )
        ) {
            await this.idempotencyManager.set(
                payload
            );
        }
    }


    /**
     * =========================================================================
     * Initialization Guard
     * =========================================================================
     */
    async ensureInitialized(
        options = {}
    ) {
        if (
            this.state.initialized
        ) {
            return true;
        }

        await this.initialize(
            options
        );

        return true;
    }


    initializationResult() {
        return {
            provider:
                PROVIDER,

            module:
                'collections',

            initialized:
                this.state.initialized,

            status:
                this.state.status,

            initializedAt:
                this.state.initializedAt
        };
    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */
    async audit({
        action,
        tenantId,
        reference,
        correlationId,
        operationId,
        metadata = {}
    } = {}) {
        if (
            !this.auditService ||
            !isFunction(
                this.auditService.record
            )
        ) {
            return;
        }

        try {
            await this.auditService.record({
                action,
                provider:
                    PROVIDER,
                tenantId,
                reference:
                    safeReference(reference),
                correlationId,
                operationId,
                metadata:
                    sanitizeMetadata(
                        metadata
                    )
            });
        } catch (error) {
            this.logger?.error?.({
                message:
                    'Airtel collection audit recording failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                action,
                error:
                    safeError(error)
            });
        }
    }


    /**
     * =========================================================================
     * Event / Outbox
     * =========================================================================
     */
    async publishEvent({
        eventType,
        tenantId,
        correlationId,
        operationId,
        payload = {},
        context = {}
    } = {}) {
        const eventPayload = {
            provider:
                PROVIDER,

            tenantId,

            correlationId,

            operationId,

            ...sanitizeMetadata(
                payload
            )
        };

        if (
            this.outboxService
        ) {
            if (
                isFunction(
                    this.outboxService.enqueue
                )
            ) {
                await this.outboxService.enqueue({
                    tenantId,
                    aggregateType:
                        'AIRTEL_COLLECTION',
                    aggregateId:
                        payload.reference ||
                        payload.externalId ||
                        operationId,
                    eventType,
                    payload:
                        eventPayload,
                    idempotencyKey:
                        `${eventType}:${tenantId || 'unknown'}:${payload.reference || operationId}`,
                    context
                });

                return;
            }

            if (
                isFunction(
                    this.outboxService.publish
                )
            ) {
                await this.outboxService.publish({
                    tenantId,
                    eventType,
                    payload:
                        eventPayload,
                    idempotencyKey:
                        `${eventType}:${tenantId || 'unknown'}:${payload.reference || operationId}`,
                    context
                });

                return;
            }
        }

        if (
            this.eventPublisher &&
            isFunction(
                this.eventPublisher.publish
            )
        ) {
            await this.eventPublisher.publish({
                type:
                    eventType,
                payload:
                    eventPayload,
                correlationId,
                operationId
            });
        }
    }


    /**
     * =========================================================================
     * Observability
     * =========================================================================
     */
    safeAmountMetadata(
        amount
    ) {
        if (
            amount === undefined ||
            amount === null
        ) {
            return undefined;
        }

        /**
         * Monetary amounts are intentionally represented as strings in
         * operational metadata rather than converted through Number().
         */
        return String(
            amount
        );
    }


    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */
    validateDependencies() {
        if (
            !this.collectionService
        ) {
            throw new Error(
                'collectionService is required'
            );
        }

        if (
            !isFunction(
                this.collectionService.collect
            )
        ) {
            const error =
                new Error(
                    'collectionService.collect is not available'
                );

            error.code =
                'AIRTEL_COLLECTION_SERVICE_CONTRACT_INVALID';

            throw error;
        }

        if (
            !isFunction(
                this.collectionService.query
            )
        ) {
            const error =
                new Error(
                    'collectionService.query is not available'
                );

            error.code =
                'AIRTEL_COLLECTION_SERVICE_QUERY_CONTRACT_INVALID';

            throw error;
        }

        this.validateConfiguration();

        return true;
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    async health() {
        const serviceHealth =
            await this.safeHealth(
                this.collectionService
            );

        const callbackHealth =
            await this.safeHealth(
                this.callbackProcessor
            );

        const configurationHealth =
            await this.safeHealth(
                this.configuration
            );

        const serviceStatus =
            serviceHealth?.status ||
            'UNKNOWN';

        const hasDown =
            [
                serviceHealth,
                callbackHealth,
                configurationHealth
            ].some(
                health =>
                    health?.status === 'DOWN'
            );

        let overallStatus;

        if (
            hasDown
        ) {
            overallStatus =
                'DOWN';
        } else if (
            !this.state.initialized ||
            serviceStatus === 'UNKNOWN' ||
            serviceStatus === 'DEGRADED'
        ) {
            overallStatus =
                'DEGRADED';
        } else {
            overallStatus =
                'UP';
        }

        return {
            provider:
                PROVIDER,

            module:
                'collections',

            status:
                overallStatus,

            initialized:
                this.state.initialized,

            state:
                this.state.status,

            startedAt:
                this.startedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            dependencies: {
                collectionService:
                    Boolean(
                        this.collectionService
                    ),

                callbackProcessor:
                    Boolean(
                        this.callbackProcessor
                    ),

                configuration:
                    Boolean(
                        this.configuration
                    ),

                tenantResolver:
                    Boolean(
                        this.tenantResolver
                    ),

                authorizationService:
                    Boolean(
                        this.authorizationService
                    ),

                idempotencyManager:
                    Boolean(
                        this.idempotencyManager
                    ),

                auditService:
                    Boolean(
                        this.auditService
                    ),

                outboxService:
                    Boolean(
                        this.outboxService
                    )
            },

            service:
                serviceHealth,

            callback:
                callbackHealth,

            configurationHealth,

            statistics: {
                ...this.statistics
            }
        };
    }


    async safeHealth(
        dependency
    ) {
        if (
            !dependency
        ) {
            return {
                status:
                    'NOT_CONFIGURED'
            };
        }

        try {
            if (
                isFunction(
                    dependency.health
                )
            ) {
                return sanitizeMetadata(
                    await dependency.health()
                );
            }

            return {
                status:
                    'AVAILABLE'
            };
        } catch (error) {
            return {
                status:
                    'DOWN',

                error:
                    safeError(error)
            };
        }
    }


    /**
     * =========================================================================
     * Capability Discovery
     * =========================================================================
     */
    capabilities() {
        return Object.freeze({
            provider:
                PROVIDER,

            collections:
                true,

            callbacks:
                Boolean(
                    this.callbackProcessor
                ),

            reconciliation:
                false,

            settlement:
                false,

            disbursements:
                false,

            supportsAsyncCallbacks:
                Boolean(
                    this.callbackProcessor
                ),

            supportsStatusQuery:
                Boolean(
                    isFunction(
                        this.collectionService?.query
                    )
                ),

            providerHttpInFacade:
                false,

            directLedgerMutation:
                false,

            tenantAware:
                Boolean(
                    this.tenantResolver
                ),

            idempotencyAware:
                Boolean(
                    this.idempotencyManager
                ),

            transactionalOutbox:
                Boolean(
                    this.outboxService
                )
        });
    }


    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */
    diagnostics() {
        return {
            provider:
                PROVIDER,

            module:
                'collections',

            state:
                this.state.status,

            initialized:
                this.state.initialized,

            architecture: {
                providerHttpInFacade:
                    false,

                collectionService:
                    Boolean(
                        this.collectionService
                    ),

                callbackProcessor:
                    Boolean(
                        this.callbackProcessor
                    ),

                tenantResolution:
                    Boolean(
                        this.tenantResolver
                    ),

                authorization:
                    Boolean(
                        this.authorizationService
                    ),

                idempotency:
                    Boolean(
                        this.idempotencyManager
                    ),

                audit:
                    Boolean(
                        this.auditService
                    ),

                outbox:
                    Boolean(
                        this.outboxService
                    )
            },

            statistics: {
                ...this.statistics
            },

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            timestamps: {
                startedAt:
                    this.startedAt,

                initializedAt:
                    this.state.initializedAt,

                lastFailureAt:
                    this.state.lastFailureAt
            }
        };
    }
}


module.exports =
    AirtelCollections;

module.exports.AirtelCollections =
    AirtelCollections;

module.exports.PROVIDER =
    PROVIDER;

module.exports.MODULE_STATUS =
    MODULE_STATUS;

module.exports.COLLECTION_STATUS =
    COLLECTION_STATUS;