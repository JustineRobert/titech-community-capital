'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Autonomous Router
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/intelligence/autonomousRouter.js
 *
 * Architectural Role
 * ------------------
 * Governed routing and workflow orchestration boundary for Airtel operational
 * intelligence.
 *
 * The router may consume AI recommendations, fraud signals, provider health,
 * business rules and workflow metadata to determine the next operational route.
 * It does not independently authorize financial execution.
 *
 * Responsibilities
 * ----------------
 * - Route operational Airtel workflows.
 * - Consume AI-assisted recommendations.
 * - Apply deterministic routing and policy controls.
 * - Enforce tenant isolation.
 * - Propagate correlation/execution/idempotency context.
 * - Route eligible requests to configured workflow services.
 * - Recommend or schedule retries within explicit safety limits.
 * - Integrate provider health/circuit state.
 * - Support manual review and escalation paths.
 * - Record routing decisions.
 * - Publish safe routing lifecycle events.
 * - Provide tracing, metrics, health and diagnostics.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Airtel API communication.
 * - OAuth/token management.
 * - Payment execution.
 * - Ledger posting.
 * - Wallet/balance mutation.
 * - Settlement completion.
 * - Reconciliation repair.
 * - KYC/AML decisions.
 * - Credit decisions.
 * - Autonomous financial authorization.
 *
 * Governance Principles
 * ---------------------
 * 1. "Autonomous" refers to workflow routing, not financial authorization.
 * 2. AI recommendations are advisory inputs.
 * 3. Deterministic policy may override AI.
 * 4. High-risk, ambiguous or unavailable intelligence routes to REVIEW or
 *    ESCALATE rather than silently proceeding.
 * 5. Financial actions must be delegated to an explicit downstream service
 *    that owns its own authorization, idempotency and accounting controls.
 * 6. Provider health may block retry/process routing but cannot authorize money.
 * 7. Every route carries tenant, correlation and execution identity.
 *
 * Reliability Principles
 * ----------------------
 * - No duplicate execution through explicit idempotency hooks.
 * - Retry is bounded and only recommended for eligible failure classes.
 * - Unknown route/action is rejected rather than defaulted into payment flow.
 * - Workflow execution is separate from route selection.
 * - Audit/event failures do not rewrite the underlying routing decision.
 *
 * Security Principles
 * -------------------
 * - Sensitive callback/provider payload fields are sanitized.
 * - Raw requests/responses and credentials are never logged or published.
 * - Tenant context is required.
 * - Actor/approval metadata is bounded.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const PROVIDER = 'AIRTEL';
const COMPONENT = 'AutonomousRouter';
const VERSION = '1.0.0';

const ROUTE_STATUS = Object.freeze({

    CREATED:
        'CREATED',

    ROUTED:
        'ROUTED',

    REVIEW:
        'REVIEW',

    ESCALATED:
        'ESCALATED',

    RETRY:
        'RETRY',

    REJECTED:
        'REJECTED',

    EXECUTED:
        'EXECUTED',

    FAILED:
        'FAILED'

});

const ROUTE = Object.freeze({

    PROCESS_PAYMENT:
        'PROCESS_PAYMENT',

    RETRY_QUEUE:
        'RETRY_QUEUE',

    RECONCILIATION:
        'RECONCILIATION',

    REPAIR_WORKFLOW:
        'REPAIR_WORKFLOW',

    MANUAL_REVIEW:
        'MANUAL_REVIEW',

    ESCALATION:
        'ESCALATION',

    INCIDENT:
        'INCIDENT',

    STANDARD_PROCESSING:
        'STANDARD_PROCESSING',

    REJECT:
        'REJECT'

});

const DECISION = Object.freeze({

    PROCEED:
        'PROCEED',

    REVIEW:
        'REVIEW',

    RETRY:
        'RETRY',

    ESCALATE:
        'ESCALATE',

    REPAIR:
        'REPAIR',

    REJECT:
        'REJECT'

});

const ROUTING_SOURCE = Object.freeze({

    AI:
        'AI',

    RULE:
        'RULE',

    HYBRID:
        'HYBRID',

    MANUAL:
        'MANUAL',

    SYSTEM:
        'SYSTEM'

});

const PROVIDER_HEALTH = Object.freeze({

    UP:
        'UP',

    DEGRADED:
        'DEGRADED',

    DOWN:
        'DOWN',

    UNKNOWN:
        'UNKNOWN'

});

const DEFAULTS = Object.freeze({

    maxRetries:
        5,

    defaultRetryDelayMs:
        2_000,

    minRetryDelayMs:
        250,

    maxRetryDelayMs:
        300_000,

    maxActions:
        20,

    idempotencyTtlSeconds:
        86_400,

    decisionMaxAgeMs:
        15 * 60 * 1000

});

const RETRYABLE_FAILURE_CLASSES = new Set([
    'NETWORK',
    'TIMEOUT',
    'TRANSIENT',
    'RATE_LIMIT',
    'TEMPORARY_PROVIDER_ERROR',
    'SERVICE_UNAVAILABLE'
]);

const NON_RETRYABLE_FAILURE_CLASSES = new Set([
    'FINANCIAL',
    'DUPLICATE',
    'VALIDATION',
    'AUTHENTICATION',
    'AUTHORIZATION',
    'COMPLIANCE',
    'REJECTED',
    'PERMANENT'
]);

const SENSITIVE_KEYS = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'password',
    'passcode',
    'pin',
    'otp',
    'token',
    'access_token',
    'refresh_token',
    'client_secret',
    'clientSecret',
    'secret',
    'api_key',
    'apiKey',
    'signature',
    'x-signature',
    'raw',
    'body',
    'requestBody',
    'responseBody',
    'providerRequest',
    'providerResponse',
    'credentials'
]);

const MAX_STRING_LENGTH = 512;
const MAX_REASON_COUNT = 25;
const MAX_DEPTH = 5;

function truncate(
    value,
    maxLength = MAX_STRING_LENGTH
) {

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const stringValue =
        String(value);

    return stringValue.length <= maxLength
        ? stringValue
        : `${stringValue.slice(0, maxLength)}…`;
}

function sanitizeValue(
    value,
    key = '',
    depth = 0
) {

    if (
        depth > MAX_DEPTH
    ) {
        return '[TRUNCATED]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    const normalizedKey =
        String(key || '')
            .toLowerCase();

    if (
        SENSITIVE_KEYS.has(key) ||
        SENSITIVE_KEYS.has(normalizedKey)
    ) {
        return '[REDACTED]';
    }

    if (
        typeof value === 'string'
    ) {
        return truncate(value);
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        typeof value === 'bigint'
    ) {
        return value.toString();
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Array.isArray(value)
    ) {

        return value
            .slice(
                0,
                100
            )
            .map(
                item =>
                    sanitizeValue(
                        item,
                        '',
                        depth + 1
                    )
            );
    }

    if (
        typeof value === 'object'
    ) {

        const output = {};

        for (
            const [
                childKey,
                childValue
            ] of Object.entries(
                value
            ).slice(
                0,
                100
            )
        ) {

            if (
                childKey === '__proto__' ||
                childKey === 'prototype' ||
                childKey === 'constructor'
            ) {
                continue;
            }

            output[childKey] =
                sanitizeValue(
                    childValue,
                    childKey,
                    depth + 1
                );
        }

        return output;
    }

    return truncate(
        value
    );
}

function safeError(
    error
) {

    return {

        name:
            truncate(
                error?.name ||
                'Error',
                128
            ),

        message:
            truncate(
                error?.message ||
                String(
                    error ||
                    'Unknown error'
                ),
                1_000
            ),

        code:
            truncate(
                error?.code,
                128
            ),

        statusCode:
            Number.isFinite(
                error?.statusCode
            )
                ? error.statusCode
                : undefined

    };
}

function normalizeTenantId(
    tenantId
) {

    if (
        tenantId === null ||
        tenantId === undefined
    ) {
        return null;
    }

    const normalized =
        String(
            typeof tenantId === 'object' &&
            typeof tenantId.toString === 'function'
                ? tenantId.toString()
                : tenantId
        )
            .trim();

    return normalized
        ? truncate(
            normalized,
            128
        )
        : null;
}

function requireTenantId(
    tenantId
) {

    const normalized =
        normalizeTenantId(
            tenantId
        );

    if (!normalized) {

        throw new Error(
            'tenantId is required for Airtel autonomous routing'
        );
    }

    return normalized;
}

function normalizeIdentifier(
    value,
    fieldName
) {

    if (
        value === null ||
        value === undefined
    ) {

        throw new Error(
            `${fieldName} is required`
        );
    }

    const normalized =
        String(value)
            .trim();

    if (!normalized) {

        throw new Error(
            `${fieldName} is required`
        );
    }

    return truncate(
        normalized,
        256
    );
}

function normalizeDecision(
    decision
) {

    const normalized =
        String(
            decision ||
            DECISION.REVIEW
        )
            .trim()
            .toUpperCase();

    return Object.values(
        DECISION
    ).includes(
        normalized
    )
        ? normalized
        : DECISION.REVIEW;
}

function normalizeProviderHealth(
    health
) {

    const normalized =
        String(
            health ||
            PROVIDER_HEALTH.UNKNOWN
        )
            .trim()
            .toUpperCase();

    return Object.values(
        PROVIDER_HEALTH
    ).includes(
        normalized
    )
        ? normalized
        : PROVIDER_HEALTH.UNKNOWN;
}

function clamp(
    value,
    min,
    max
) {

    const numeric =
        Number(value);

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return min;
    }

    return Math.min(
        max,
        Math.max(
            min,
            numeric
        )
    );
}

class AutonomousRouter {

    constructor({

        decisionEngine,

        policyEngine,

        approvalService,

        workflowRouter,

        paymentService,

        retryService,

        reconciliationService,

        repairService,

        reviewService,

        escalationService,

        incidentService,

        providerHealthService,

        idempotencyStore,

        repository,

        auditService,

        eventBus,

        outboxService,

        eventPublisher,

        metrics,

        logger,

        tracer,

        clock = Date,

        maxRetries =
            DEFAULTS.maxRetries,

        defaultRetryDelayMs =
            DEFAULTS.defaultRetryDelayMs,

        minRetryDelayMs =
            DEFAULTS.minRetryDelayMs,

        maxRetryDelayMs =
            DEFAULTS.maxRetryDelayMs,

        maxActions =
            DEFAULTS.maxActions,

        idempotencyTtlSeconds =
            DEFAULTS.idempotencyTtlSeconds,

        decisionMaxAgeMs =
            DEFAULTS.decisionMaxAgeMs,

        allowExecution =
            false

    } = {}) {

        this.decisionEngine =
            decisionEngine;

        this.policyEngine =
            policyEngine;

        this.approvalService =
            approvalService;

        this.workflowRouter =
            workflowRouter;

        this.paymentService =
            paymentService;

        this.retryService =
            retryService;

        this.reconciliationService =
            reconciliationService;

        this.repairService =
            repairService;

        this.reviewService =
            reviewService;

        this.escalationService =
            escalationService;

        this.incidentService =
            incidentService;

        this.providerHealthService =
            providerHealthService;

        this.idempotencyStore =
            idempotencyStore;

        this.repository =
            repository;

        this.auditService =
            auditService;

        this.eventBus =
            eventBus;

        this.outboxService =
            outboxService;

        this.eventPublisher =
            eventPublisher;

        this.metrics =
            metrics;

        this.logger =
            logger;

        this.tracer =
            tracer;

        this.clock =
            clock;

        this.maxRetries =
            Math.max(
                0,
                Math.floor(
                    Number(maxRetries) ||
                    DEFAULTS.maxRetries
                )
            );

        this.defaultRetryDelayMs =
            Math.max(
                0,
                Math.floor(
                    Number(defaultRetryDelayMs) ||
                    DEFAULTS.defaultRetryDelayMs
                )
            );

        this.minRetryDelayMs =
            Math.max(
                0,
                Math.floor(
                    Number(minRetryDelayMs) ||
                    DEFAULTS.minRetryDelayMs
                )
            );

        this.maxRetryDelayMs =
            Math.max(
                this.defaultRetryDelayMs,
                Math.floor(
                    Number(maxRetryDelayMs) ||
                    DEFAULTS.maxRetryDelayMs
                )
            );

        this.maxActions =
            Math.max(
                1,
                Math.floor(
                    Number(maxActions) ||
                    DEFAULTS.maxActions
                )
            );

        this.idempotencyTtlSeconds =
            Math.max(
                1,
                Math.floor(
                    Number(idempotencyTtlSeconds) ||
                    DEFAULTS.idempotencyTtlSeconds
                )
            );

        this.decisionMaxAgeMs =
            Math.max(
                0,
                Math.floor(
                    Number(decisionMaxAgeMs) ||
                    DEFAULTS.decisionMaxAgeMs
                )
            );

        this.allowExecution =
            Boolean(
                allowExecution
            );

        this.startedAt =
            this.now();

        this.initialized =
            false;

        this.healthState = {

            status:
                ROUTE_STATUS.CREATED,

            lastRouteAt:
                null,

            lastExecutionAt:
                null,

            lastFailureAt:
                null,

            lastError:
                null

        };

        this.statistics = {

            routeRequests:
                0,

            routed:
                0,

            reviews:
                0,

            escalations:
                0,

            retries:
                0,

            rejected:
                0,

            executed:
                0,

            failed:
                0,

            idempotentHits:
                0,

            policyOverrides:
                0,

            approvalRejected:
                0,

            providerUnavailable:
                0

        };
    }

    /**
     * =========================================================================
     * Initialize
     * =========================================================================
     */

    async initialize() {

        this.validateDependencies();

        this.initialized =
            true;

        this.healthState.status =
            ROUTE_STATUS.CREATED;

        this.logger?.info?.({

            provider:
                PROVIDER,

            component:
                COMPONENT,

            message:
                'Airtel autonomous router initialized',

            allowExecution:
                this.allowExecution

        });

        this.metrics?.counter?.(
            'airtel_autonomous_router_initialized_total',
            1
        );

        return true;
    }

    /**
     * =========================================================================
     * Route
     * =========================================================================
     */

    async route({

        tenantId,

        request = {},

        recommendation = null,

        context = {},

        providerHealth = null,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        idempotencyKey,

        actorId = null,

        policyContext = {}

    } = {}) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedCorrelationId =
            normalizeIdentifier(
                correlationId,
                'correlationId'
            );

        const normalizedExecutionId =
            normalizeIdentifier(
                executionId,
                'executionId'
            );

        const effectiveIdempotencyKey =
            idempotencyKey ||
            this.buildIdempotencyKey({

                tenantId:
                    normalizedTenantId,

                request,

                context

            });

        const span =
            this.startSpan(
                'airtel.autonomous.router.route',
                {
                    tenantId:
                        normalizedTenantId,

                    correlationId:
                        normalizedCorrelationId,

                    executionId:
                        normalizedExecutionId

                }
            );

        try {

            this.statistics.routeRequests++;

            const existing =
                await this.getIdempotentResult({

                    tenantId:
                        normalizedTenantId,

                    idempotencyKey:
                        effectiveIdempotencyKey

                });

            if (
                existing
            ) {

                this.statistics.idempotentHits++;

                return existing;
            }

            const health =
                await this.resolveProviderHealth({
                    tenantId:
                        normalizedTenantId,

                    providerHealth,

                    correlationId:
                        normalizedCorrelationId,

                    executionId:
                        normalizedExecutionId

                });

            let decision =
                recommendation;

            if (
                !decision &&
                this.decisionEngine &&
                typeof this.decisionEngine.recommend ===
                'function'
            ) {

                decision =
                    await this.decisionEngine.recommend({

                        callback:
                            request.callback,

                        context:
                            sanitizeValue(
                                context
                            ),

                        tenantId:
                            normalizedTenantId,

                        correlation:
                            normalizedCorrelationId,

                        executionId:
                            normalizedExecutionId,

                        actorId,

                        policyContext:
                            sanitizeValue(
                                policyContext
                            )

                    });
            }

            const normalizedRecommendation =
                this.normalizeRecommendation(
                    decision
                );

            const policy =
                await this.evaluatePolicy({

                    tenantId:
                        normalizedTenantId,

                    request,

                    context,

                    recommendation:
                        normalizedRecommendation,

                    providerHealth:
                        health,

                    correlationId:
                        normalizedCorrelationId,

                    executionId:
                        normalizedExecutionId,

                    actorId,

                    policyContext

                });

            const routing =
                this.resolveRoute({

                    recommendation:
                        normalizedRecommendation,

                    policy,

                    providerHealth:
                        health,

                    request,

                    context

                });

            const routeRecord = {

                routeId:
                    crypto.randomUUID(),

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                idempotencyKey:
                    effectiveIdempotencyKey,

                decision:
                    routing.decision,

                route:
                    routing.route,

                status:
                    ROUTE_STATUS.ROUTED,

                source:
                    routing.source,

                confidence:
                    routing.confidence,

                reasons:
                    routing.reasons,

                providerHealth:
                    health,

                policy:
                    this.safePolicy(
                        policy
                    ),

                advisoryOnly:
                    !this.allowExecution,

                createdAt:
                    this.now(),

                expiresAt:
                    new Date(
                        Date.now() +
                        this.decisionMaxAgeMs
                    )

            };

            this.healthState.lastRouteAt =
                routeRecord.createdAt;

            this.healthState.lastError =
                null;

            this.recordRouteStatistics(
                routing.route
            );

            await this.persistRoute(
                routeRecord
            );

            await this.recordAuditSafe({

                action:
                    'AIRTEL_AUTONOMOUS_ROUTE_CREATED',

                tenantId:
                    normalizedTenantId,

                routeId:
                    routeRecord.routeId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                decision:
                    routeRecord.decision,

                route:
                    routeRecord.route,

                source:
                    routeRecord.source,

                providerHealth:
                    health

            });

            await this.publishSafeEvent({

                type:
                    'AIRTEL_AUTONOMOUS_ROUTE_CREATED',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                payload: {

                    routeId:
                        routeRecord.routeId,

                    decision:
                        routeRecord.decision,

                    route:
                        routeRecord.route,

                    status:
                        routeRecord.status,

                    source:
                        routeRecord.source,

                    confidence:
                        routeRecord.confidence,

                    providerHealth:
                        health

                }

            });

            await this.storeIdempotentResult({

                tenantId:
                    normalizedTenantId,

                idempotencyKey:
                    effectiveIdempotencyKey,

                result:
                    routeRecord

            });

            this.statistics.routed++;

            return routeRecord;

        } catch (error) {

            this.statistics.failed++;

            this.healthState.status =
                ROUTE_STATUS.FAILED;

            this.healthState.lastFailureAt =
                this.now();

            this.healthState.lastError =
                safeError(
                    error
                );

            this.metrics?.counter?.(
                'airtel_autonomous_router_failed_total',
                1
            );

            this.logger?.error?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Airtel autonomous routing failed',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                error:
                    safeError(
                        error
                    )

            });

            throw error;

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Execute Routed Workflow
     * =========================================================================
     *
     * Route creation and workflow execution are deliberately separate.
     *
     * This prevents an AI recommendation from implicitly becoming an immediate
     * financial side effect.
     */

    async executeRoute({

        tenantId,

        routeRecord,

        request = {},

        context = {},

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        actorId = null,

        approvalContext = {}

    } = {}) {

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        if (
            !routeRecord ||
            typeof routeRecord !== 'object'
        ) {

            throw this.createError(
                'routeRecord is required',
                'AIRTEL_AUTONOMOUS_ROUTE_REQUIRED'
            );
        }

        if (
            routeRecord.tenantId &&
            String(
                routeRecord.tenantId
            ) !== normalizedTenantId
        ) {

            throw this.createError(
                'Route tenant does not match execution tenant',
                'AIRTEL_AUTONOMOUS_ROUTE_TENANT_MISMATCH'
            );
        }

        if (
            !this.allowExecution
        ) {

            this.statistics.rejected++;

            return {

                executed:
                    false,

                status:
                    ROUTE_STATUS.REVIEW,

                route:
                    routeRecord.route,

                reason:
                    'ROUTE_EXECUTION_DISABLED',

                advisoryOnly:
                    true

            };
        }

        if (
            this.isExpiredRoute(
                routeRecord
            )
        ) {

            this.statistics.rejected++;

            throw this.createError(
                'Routing decision has expired',
                'AIRTEL_AUTONOMOUS_ROUTE_EXPIRED'
            );
        }

        const authorized =
            await this.authorizeExecution({

                tenantId:
                    normalizedTenantId,

                routeRecord,

                actorId,

                approvalContext,

                correlationId,

                executionId

            });

        if (
            !authorized
        ) {

            this.statistics.approvalRejected++;

            return {

                executed:
                    false,

                status:
                    ROUTE_STATUS.REVIEW,

                route:
                    routeRecord.route,

                reason:
                    'ROUTE_EXECUTION_NOT_AUTHORIZED',

                advisoryOnly:
                    true

            };
        }

        const span =
            this.startSpan(
                'airtel.autonomous.router.execute',
                {
                    tenantId:
                        normalizedTenantId,

                    routeId:
                        routeRecord.routeId,

                    correlationId,

                    executionId

                }
            );

        try {

            let result;

            switch (
                routeRecord.route
            ) {

                case ROUTE.PROCESS_PAYMENT:

                    result =
                        await this.executePaymentRoute({

                            tenantId:
                                normalizedTenantId,

                            request,

                            context,

                            routeRecord,

                            correlationId,

                            executionId,

                            actorId

                        });

                    break;

                case ROUTE.RETRY_QUEUE:

                    result =
                        await this.executeRetryRoute({

                            tenantId:
                                normalizedTenantId,

                            request,

                            context,

                            routeRecord,

                            correlationId,

                            executionId

                        });

                    break;

                case ROUTE.RECONCILIATION:

                    result =
                        await this.executeReconciliationRoute({

                            tenantId:
                                normalizedTenantId,

                            request,

                            context,

                            routeRecord,

                            correlationId,

                            executionId

                        });

                    break;

                case ROUTE.REPAIR_WORKFLOW:

                    result =
                        await this.executeRepairRoute({

                            tenantId:
                                normalizedTenantId,

                            request,

                            context,

                            routeRecord,

                            correlationId,

                            executionId,

                            actorId

                        });

                    break;

                case ROUTE.MANUAL_REVIEW:

                    result =
                        await this.executeReviewRoute({

                            tenantId:
                                normalizedTenantId,

                            request,

                            context,

                            routeRecord,

                            correlationId,

                            executionId

                        });

                    break;

                case ROUTE.ESCALATION:

                    result =
                        await this.executeEscalationRoute({

                            tenantId:
                                normalizedTenantId,

                            request,

                            context,

                            routeRecord,

                            correlationId,

                            executionId

                        });

                    break;

                case ROUTE.INCIDENT:

                    result =
                        await this.executeIncidentRoute({

                            tenantId:
                                normalizedTenantId,

                            request,

                            context,

                            routeRecord,

                            correlationId,

                            executionId

                        });

                    break;

                case ROUTE.STANDARD_PROCESSING:

                    result =
                        await this.executeStandardRoute({

                            tenantId:
                                normalizedTenantId,

                            request,

                            context,

                            routeRecord,

                            correlationId,

                            executionId

                        });

                    break;

                case ROUTE.REJECT:

                    result = {

                        rejected:
                            true,

                        reason:
                            'ROUTE_REJECTED'

                    };

                    break;

                default:

                    throw this.createError(
                        `Unsupported route ${routeRecord.route}`,
                        'AIRTEL_AUTONOMOUS_ROUTE_UNSUPPORTED'
                    );
            }

            this.statistics.executed++;

            this.healthState.lastExecutionAt =
                this.now();

            await this.recordAuditSafe({

                action:
                    'AIRTEL_AUTONOMOUS_ROUTE_EXECUTED',

                tenantId:
                    normalizedTenantId,

                routeId:
                    routeRecord.routeId,

                correlationId,

                executionId,

                route:
                    routeRecord.route,

                status:
                    ROUTE_STATUS.EXECUTED

            });

            await this.publishSafeEvent({

                type:
                    'AIRTEL_AUTONOMOUS_ROUTE_EXECUTED',

                tenantId:
                    normalizedTenantId,

                correlationId,

                executionId,

                payload: {

                    routeId:
                        routeRecord.routeId,

                    route:
                        routeRecord.route,

                    status:
                        ROUTE_STATUS.EXECUTED,

                    result:
                        this.safeExecutionResult(
                            result
                        )

                }

            });

            return {

                executed:
                    true,

                status:
                    ROUTE_STATUS.EXECUTED,

                route:
                    routeRecord.route,

                routeId:
                    routeRecord.routeId,

                result:
                    sanitizeValue(
                        result
                    )

            };

        } catch (error) {

            this.statistics.failed++;

            this.healthState.lastFailureAt =
                this.now();

            this.healthState.lastError =
                safeError(
                    error
                );

            await this.recordAuditSafe({

                action:
                    'AIRTEL_AUTONOMOUS_ROUTE_EXECUTION_FAILED',

                tenantId:
                    normalizedTenantId,

                routeId:
                    routeRecord.routeId,

                correlationId,

                executionId,

                route:
                    routeRecord.route,

                error:
                    safeError(
                        error
                    )

            });

            throw error;

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Resolve Route
     * =========================================================================
     */

    resolveRoute({

        recommendation = {},

        policy = {},

        providerHealth,

        request = {},

        context = {}

    }) {

        let decision =
            normalizeDecision(
                recommendation.action ||
                recommendation.decision
            );

        let source =
            recommendation.source ||
            ROUTING_SOURCE.AI;

        const reasons =
            Array.isArray(
                recommendation.reasons
            )
                ? recommendation.reasons
                    .map(
                        reason =>
                            truncate(
                                reason
                            )
                    )
                    .slice(
                        0,
                        MAX_REASON_COUNT
                    )
                : [];

        let confidence =
            clamp(
                recommendation.confidence,
                0,
                1
            );

        if (
            policy &&
            policy.allowed === false
        ) {

            decision =
                normalizeDecision(
                    policy.decision ||
                    DECISION.REVIEW
                );

            source =
                ROUTING_SOURCE.HYBRID;

            this.statistics.policyOverrides++;

            reasons.push(
                'POLICY_OVERRIDE'
            );
        }

        /*
         * Provider DOWN must block process/retry routing. It never becomes a
         * basis for autonomous financial execution.
         */
        if (
            providerHealth ===
            PROVIDER_HEALTH.DOWN
        ) {

            this.statistics.providerUnavailable++;

            if (
                decision ===
                DECISION.PROCEED ||
                decision ===
                DECISION.RETRY
            ) {

                decision =
                    DECISION.ESCALATE;

                source =
                    ROUTING_SOURCE.HYBRID;

                reasons.push(
                    'PROVIDER_DOWN'
                );

                confidence =
                    Math.min(
                        confidence,
                        0.5
                    );
            }
        }

        if (
            providerHealth ===
            PROVIDER_HEALTH.DEGRADED &&
            decision ===
            DECISION.PROCEED
        ) {

            decision =
                DECISION.REVIEW;

            source =
                ROUTING_SOURCE.HYBRID;

            reasons.push(
                'PROVIDER_DEGRADED'
            );

            confidence =
                Math.min(
                    confidence,
                    0.75
                );
        }

        if (
            !recommendation ||
            Object.keys(
                recommendation
            ).length === 0
        ) {

            decision =
                DECISION.REVIEW;

            source =
                ROUTING_SOURCE.SYSTEM;

            reasons.push(
                'NO_RECOMMENDATION'
            );

            confidence =
                0;
        }

        const route =
            this.decisionToRoute(
                decision,
                {
                    request,
                    context
                }
            );

        if (
            route ===
            ROUTE.REJECT
        ) {

            confidence =
                Math.min(
                    confidence,
                    0.5
                );
        }

        return {

            decision,

            route,

            source,

            confidence:
                Number(
                    confidence.toFixed(4)
                ),

            reasons:
                [
                    ...new Set(
                        reasons
                    )
                ]
                    .slice(
                        0,
                        MAX_REASON_COUNT
                    )

        };
    }

    decisionToRoute(
        decision,
        {
            request,
            context
        } = {}
    ) {

        switch (
            normalizeDecision(
                decision
            )
        ) {

            case DECISION.PROCEED:

                return ROUTE.PROCESS_PAYMENT;

            case DECISION.RETRY:

                return ROUTE.RETRY_QUEUE;

            case DECISION.REPAIR:

                return ROUTE.REPAIR_WORKFLOW;

            case DECISION.REVIEW:

                return ROUTE.MANUAL_REVIEW;

            case DECISION.ESCALATE:

                return (
                    context?.incident === true
                        ? ROUTE.INCIDENT
                        : ROUTE.ESCALATION
                );

            case DECISION.REJECT:

                return ROUTE.REJECT;

            default:

                return ROUTE.MANUAL_REVIEW;
        }
    }

    /**
     * =========================================================================
     * Recommendation Normalization
     * =========================================================================
     */

    normalizeRecommendation(
        recommendation
    ) {

        if (
            !recommendation ||
            typeof recommendation !== 'object'
        ) {

            return {};
        }

        return {

            decision:
                normalizeDecision(
                    recommendation.decision ||
                    recommendation.action
                ),

            action:
                recommendation.action,

            confidence:
                clamp(
                    recommendation.confidence,
                    0,
                    1
                ),

            reasons:
                Array.isArray(
                    recommendation.reasons
                )
                    ? recommendation.reasons
                        .map(
                            reason =>
                                truncate(
                                    reason
                                )
                        )
                        .slice(
                            0,
                            MAX_REASON_COUNT
                        )
                    : [],

            rationale:
                truncate(
                    recommendation.rationale,
                    1_000
                ),

            source:
                truncate(
                    recommendation.source ||
                    ROUTING_SOURCE.AI,
                    64
                ),

            modelId:
                truncate(
                    recommendation.modelId,
                    256
                ),

            modelVersion:
                truncate(
                    recommendation.modelVersion,
                    128
                ),

            createdAt:
                recommendation.createdAt,

            expiresAt:
                recommendation.expiresAt

        };
    }

    /**
     * =========================================================================
     * Policy
     * =========================================================================
     */

    async evaluatePolicy({

        tenantId,

        request,

        context,

        recommendation,

        providerHealth,

        correlationId,

        executionId,

        actorId,

        policyContext

    }) {

        if (
            !this.policyEngine ||
            typeof this.policyEngine.evaluate !==
            'function'
        ) {

            return {

                allowed:
                    true,

                overridden:
                    false,

                reason:
                    'NO_POLICY_ENGINE'

            };
        }

        return this.policyEngine.evaluate({

            provider:
                PROVIDER,

            tenantId,

            request:
                sanitizeValue(
                    request
                ),

            context:
                sanitizeValue(
                    context
                ),

            recommendation:
                sanitizeValue(
                    recommendation
                ),

            providerHealth,

            correlationId,

            executionId,

            actorId,

            policyContext:
                sanitizeValue(
                    policyContext
                )

        });
    }

    /**
     * =========================================================================
     * Provider Health
     * =========================================================================
     */

    async resolveProviderHealth({

        tenantId,

        providerHealth,

        correlationId,

        executionId

    }) {

        if (
            providerHealth
        ) {

            return normalizeProviderHealth(
                providerHealth
            );
        }

        if (
            !this.providerHealthService
        ) {

            return PROVIDER_HEALTH.UNKNOWN;
        }

        try {

            let result;

            if (
                typeof this.providerHealthService
                    .getProviderStatus ===
                'function'
            ) {

                result =
                    await this.providerHealthService
                        .getProviderStatus({

                            provider:
                                PROVIDER,

                            tenantId,

                            correlationId,

                            executionId

                        });

            } else if (
                typeof this.providerHealthService
                    .health ===
                'function'
            ) {

                result =
                    await this.providerHealthService
                        .health({

                            provider:
                                PROVIDER,

                            tenantId,

                            correlationId,

                            executionId

                        });
            }

            return normalizeProviderHealth(
                typeof result === 'string'
                    ? result
                    : result?.status
            );

        } catch (error) {

            this.logger?.warn?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Unable to resolve Airtel provider health for routing',

                tenantId,

                correlationId,

                executionId,

                error:
                    safeError(
                        error
                    )

            });

            return PROVIDER_HEALTH.UNKNOWN;
        }
    }

    /**
     * =========================================================================
     * Route Execution Authorization
     * =========================================================================
     */

    async authorizeExecution({

        tenantId,

        routeRecord,

        actorId,

        approvalContext,

        correlationId,

        executionId

    }) {

        /*
         * Payment execution always requires an explicit downstream approval or
         * authorization boundary when one is configured.
         */
        if (
            routeRecord.route ===
            ROUTE.PROCESS_PAYMENT
        ) {

            if (
                !this.approvalService ||
                typeof this.approvalService.authorize !==
                'function'
            ) {

                /*
                 * Router itself does not grant financial authorization.
                 */
                return false;
            }
        }

        if (
            this.approvalService &&
            typeof this.approvalService.authorize ===
            'function'
        ) {

            const approved =
                await this.approvalService.authorize({

                    tenantId,

                    provider:
                        PROVIDER,

                    action:
                        routeRecord.route,

                    routeId:
                        routeRecord.routeId,

                    actorId,

                    correlationId,

                    executionId,

                    context:
                        sanitizeValue(
                            approvalContext
                        )

                });

            if (
                approved === false
            ) {

                return false;
            }
        }

        return true;
    }

    /**
     * =========================================================================
     * Payment Route
     * =========================================================================
     */

    async executePaymentRoute({

        tenantId,

        request,

        context,

        routeRecord,

        correlationId,

        executionId,

        actorId

    }) {

        if (
            !this.paymentService ||
            typeof this.paymentService.execute !==
            'function'
        ) {

            throw this.createError(
                'Payment execution service unavailable',
                'AIRTEL_AUTONOMOUS_PAYMENT_SERVICE_UNAVAILABLE'
            );
        }

        return this.paymentService.execute({

            tenantId,

            request:
                sanitizeValue(
                    request
                ),

            context:
                sanitizeValue(
                    context
                ),

            routeId:
                routeRecord.routeId,

            correlationId,

            executionId,

            actorId

        });
    }

    /**
     * =========================================================================
     * Retry Route
     * =========================================================================
     */

    async executeRetryRoute({

        tenantId,

        request,

        context,

        routeRecord,

        correlationId,

        executionId

    }) {

        if (
            !this.retryService ||
            typeof this.retryService.schedule !==
            'function'
        ) {

            throw this.createError(
                'Retry service unavailable',
                'AIRTEL_AUTONOMOUS_RETRY_SERVICE_UNAVAILABLE'
            );
        }

        return this.retryService.schedule({

            tenantId,

            request:
                sanitizeValue(
                    request
                ),

            context:
                sanitizeValue(
                    context
                ),

            routeId:
                routeRecord.routeId,

            correlationId,

            executionId

        });
    }

    /**
     * =========================================================================
     * Reconciliation Route
     * =========================================================================
     */

    async executeReconciliationRoute({

        tenantId,

        request,

        context,

        routeRecord,

        correlationId,

        executionId

    }) {

        if (
            !this.reconciliationService ||
            typeof this.reconciliationService.execute !==
            'function'
        ) {

            throw this.createError(
                'Reconciliation service unavailable',
                'AIRTEL_AUTONOMOUS_RECONCILIATION_SERVICE_UNAVAILABLE'
            );
        }

        return this.reconciliationService.execute({

            tenantId,

            settlementDate:
                context?.settlementDate ||
                this.now(),

            mode:
                'AUTOMATIC',

            correlationId,

            executionId,

            metadata: {

                routeId:
                    routeRecord.routeId,

                source:
                    'AUTONOMOUS_ROUTER'

            }

        });
    }

    /**
     * =========================================================================
     * Repair Route
     * =========================================================================
     */

    async executeRepairRoute({

        tenantId,

        request,

        context,

        routeRecord,

        correlationId,

        executionId,

        actorId

    }) {

        if (
            !this.repairService ||
            typeof this.repairService.execute !==
            'function'
        ) {

            throw this.createError(
                'Repair workflow unavailable',
                'AIRTEL_AUTONOMOUS_REPAIR_SERVICE_UNAVAILABLE'
            );
        }

        return this.repairService.execute({

            tenantId,

            request:
                sanitizeValue(
                    request
                ),

            context:
                sanitizeValue(
                    context
                ),

            routeId:
                routeRecord.routeId,

            correlationId,

            executionId,

            actorId,

            requiresApproval:
                true

        });
    }

    /**
     * =========================================================================
     * Manual Review
     * =========================================================================
     */

    async executeReviewRoute({

        tenantId,

        request,

        context,

        routeRecord,

        correlationId,

        executionId

    }) {

        if (
            !this.reviewService ||
            typeof this.reviewService.create !==
            'function'
        ) {

            throw this.createError(
                'Manual review service unavailable',
                'AIRTEL_AUTONOMOUS_REVIEW_SERVICE_UNAVAILABLE'
            );
        }

        return this.reviewService.create({

            tenantId,

            provider:
                PROVIDER,

            routeId:
                routeRecord.routeId,

            request:
                sanitizeValue(
                    request
                ),

            context:
                sanitizeValue(
                    context
                ),

            reason:
                routeRecord.reasons,

            correlationId,

            executionId

        });
    }

    /**
     * =========================================================================
     * Escalation
     * =========================================================================
     */

    async executeEscalationRoute({

        tenantId,

        request,

        context,

        routeRecord,

        correlationId,

        executionId

    }) {

        if (
            !this.escalationService ||
            typeof this.escalationService.create !==
            'function'
        ) {

            throw this.createError(
                'Escalation service unavailable',
                'AIRTEL_AUTONOMOUS_ESCALATION_SERVICE_UNAVAILABLE'
            );
        }

        return this.escalationService.create({

            tenantId,

            provider:
                PROVIDER,

            routeId:
                routeRecord.routeId,

            reason:
                routeRecord.reasons,

            request:
                sanitizeValue(
                    request
                ),

            context:
                sanitizeValue(
                    context
                ),

            correlationId,

            executionId

        });
    }

    /**
     * =========================================================================
     * Incident Route
     * =========================================================================
     */

    async executeIncidentRoute({

        tenantId,

        request,

        context,

        routeRecord,

        correlationId,

        executionId

    }) {

        if (
            !this.incidentService ||
            typeof this.incidentService.create !==
            'function'
        ) {

            throw this.createError(
                'Incident service unavailable',
                'AIRTEL_AUTONOMOUS_INCIDENT_SERVICE_UNAVAILABLE'
            );
        }

        return this.incidentService.create({

            tenantId,

            provider:
                PROVIDER,

            source:
                COMPONENT,

            routeId:
                routeRecord.routeId,

            severity:
                'HIGH',

            reason:
                routeRecord.reasons,

            request:
                sanitizeValue(
                    request
                ),

            context:
                sanitizeValue(
                    context
                ),

            correlationId,

            executionId

        });
    }

    /**
     * =========================================================================
     * Standard Processing
     * =========================================================================
     */

    async executeStandardRoute({

        tenantId,

        request,

        context,

        routeRecord,

        correlationId,

        executionId

    }) {

        if (
            this.workflowRouter &&
            typeof this.workflowRouter.route ===
            'function'
        ) {

            return this.workflowRouter.route({

                tenantId,

                provider:
                    PROVIDER,

                route:
                    ROUTE.STANDARD_PROCESSING,

                routeId:
                    routeRecord.routeId,

                request:
                    sanitizeValue(
                        request
                    ),

                context:
                    sanitizeValue(
                        context
                    ),

                correlationId,

                executionId

            });
        }

        throw this.createError(
            'Workflow router unavailable',
            'AIRTEL_AUTONOMOUS_WORKFLOW_ROUTER_UNAVAILABLE'
        );
    }

    /**
     * =========================================================================
     * Retry Recommendation
     * =========================================================================
     */

    recommendRetry({

        retryCount = 0,

        providerHealth = PROVIDER_HEALTH.UNKNOWN,

        failureClass = null,

        predictedDelayMs = null

    } = {}) {

        const normalizedRetryCount =
            Math.max(
                0,
                Math.floor(
                    Number(
                        retryCount
                    ) || 0
                )
            );

        const health =
            normalizeProviderHealth(
                providerHealth
            );

        const failure =
            String(
                failureClass ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            normalizedRetryCount >=
            this.maxRetries
        ) {

            return {

                retry:
                    false,

                decision:
                    DECISION.ESCALATE,

                route:
                    ROUTE.ESCALATION,

                retryCount:
                    normalizedRetryCount,

                reason:
                    'RETRY_LIMIT_REACHED'

            };
        }

        if (
            health ===
            PROVIDER_HEALTH.DOWN
        ) {

            return {

                retry:
                    false,

                decision:
                    DECISION.ESCALATE,

                route:
                    ROUTE.ESCALATION,

                retryCount:
                    normalizedRetryCount,

                reason:
                    'PROVIDER_DOWN'

            };
        }

        if (
            NON_RETRYABLE_FAILURE_CLASSES.has(
                failure
            )
        ) {

            return {

                retry:
                    false,

                decision:
                    DECISION.REVIEW,

                route:
                    ROUTE.MANUAL_REVIEW,

                retryCount:
                    normalizedRetryCount,

                reason:
                    'NON_RETRYABLE_FAILURE'

            };
        }

        if (
            failure &&
            !RETRYABLE_FAILURE_CLASSES.has(
                failure
            )
        ) {

            return {

                retry:
                    false,

                decision:
                    DECISION.REVIEW,

                route:
                    ROUTE.MANUAL_REVIEW,

                retryCount:
                    normalizedRetryCount,

                reason:
                    'UNKNOWN_FAILURE_CLASS'

            };
        }

        const predicted =
            Number(
                predictedDelayMs
            );

        const delay =
            Number.isFinite(
                predicted
            )
                ? predicted
                : this.defaultRetryDelayMs;

        const boundedDelay =
            Math.min(
                this.maxRetryDelayMs,
                Math.max(
                    this.minRetryDelayMs,
                    Math.floor(
                        delay
                    )
                )
            );

        this.statistics.retries++;

        return {

            retry:
                true,

            decision:
                DECISION.RETRY,

            route:
                ROUTE.RETRY_QUEUE,

            retryCount:
                normalizedRetryCount,

            delayMs:
                boundedDelay,

            strategy:
                'BOUNDED_BACKOFF',

            reason:
                'RETRY_ELIGIBLE',

            advisoryOnly:
                true

        };
    }

    /**
     * =========================================================================
     * Route Expiry
     * =========================================================================
     */

    isExpiredRoute(
        routeRecord
    ) {

        if (
            !routeRecord.expiresAt
        ) {
            return false;
        }

        const expiry =
            new Date(
                routeRecord.expiresAt
            );

        if (
            Number.isNaN(
                expiry.getTime()
            )
        ) {
            return true;
        }

        return (
            expiry.getTime() <
            Date.now()
        );
    }

    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */

    async persistRoute(
        routeRecord
    ) {

        if (
            !this.repository
        ) {
            return null;
        }

        const safeRecord =
            sanitizeValue(
                routeRecord
            );

        if (
            typeof this.repository.createForTenant ===
            'function'
        ) {

            return this.repository.createForTenant(

                routeRecord.tenantId,

                safeRecord

            );
        }

        if (
            typeof this.repository.create ===
            'function'
        ) {

            return this.repository.create(
                safeRecord
            );
        }

        if (
            typeof this.repository.save ===
            'function'
        ) {

            return this.repository.save(
                safeRecord
            );
        }

        return null;
    }

    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */

    buildIdempotencyKey({

        tenantId,

        request = {},

        context = {}

    }) {

        const material =
            JSON.stringify({

                tenantId,

                reference:
                    request.reference ??
                    request.transactionReference ??
                    request.providerReference,

                operation:
                    request.operation ??
                    context.operation,

                settlementDate:
                    context.settlementDate
                        ? new Date(
                            context.settlementDate
                        )
                            .toISOString()
                            .slice(
                                0,
                                10
                            )
                        : null

            });

        const digest =
            crypto
                .createHash('sha256')
                .update(material)
                .digest('hex');

        return (
            `airtel:router:${tenantId}:${digest}`
        );
    }

    async getIdempotentResult({

        tenantId,

        idempotencyKey

    }) {

        if (
            !this.idempotencyStore
        ) {
            return null;
        }

        const key =
            this.scopeIdempotencyKey(
                tenantId,
                idempotencyKey
            );

        if (
            typeof this.idempotencyStore.get ===
            'function'
        ) {

            return this.idempotencyStore.get(
                key
            );
        }

        if (
            typeof this.idempotencyStore.check ===
            'function'
        ) {

            return this.idempotencyStore.check(
                key
            );
        }

        return null;
    }

    async storeIdempotentResult({

        tenantId,

        idempotencyKey,

        result

    }) {

        if (
            !this.idempotencyStore
        ) {
            return false;
        }

        const key =
            this.scopeIdempotencyKey(
                tenantId,
                idempotencyKey
            );

        const safeResult =
            sanitizeValue(
                result
            );

        if (
            typeof this.idempotencyStore.set ===
            'function'
        ) {

            await this.idempotencyStore.set(

                key,

                safeResult,

                this.idempotencyTtlSeconds

            );

            return true;
        }

        if (
            typeof this.idempotencyStore.store ===
            'function'
        ) {

            await this.idempotencyStore.store(

                key,

                safeResult,

                this.idempotencyTtlSeconds

            );

            return true;
        }

        return false;
    }

    scopeIdempotencyKey(
        tenantId,
        idempotencyKey
    ) {

        const digest =
            crypto
                .createHash('sha256')
                .update(
                    `${tenantId}:${idempotencyKey}`
                )
                .digest('hex');

        return (
            `airtel:autonomous-router:${digest}`
        );
    }

    /**
     * =========================================================================
     * Event Publication
     * =========================================================================
     */

    async publishSafeEvent({

        type,

        tenantId,

        correlationId,

        executionId,

        payload = {}

    }) {

        const event = {

            type,

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            occurredAt:
                this.now().toISOString(),

            tenantId,

            correlationId,

            executionId,

            payload:
                sanitizeValue(
                    payload
                )

        };

        try {

            if (
                this.outboxService &&
                typeof this.outboxService.publish ===
                'function'
            ) {

                await this.outboxService.publish(
                    event
                );

            } else if (
                this.eventPublisher &&
                typeof this.eventPublisher.publish ===
                'function'
            ) {

                await this.eventPublisher.publish(
                    event
                );

            } else if (
                this.eventBus &&
                typeof this.eventBus.publish ===
                'function'
            ) {

                await this.eventBus.publish(
                    event
                );

            } else {

                return false;
            }

            return true;

        } catch (error) {

            this.logger?.warn?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to publish Airtel autonomous router event',

                tenantId,

                correlationId,

                executionId,

                type,

                error:
                    safeError(
                        error
                    )

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async recordAuditSafe(
        record
    ) {

        if (
            !this.auditService ||
            typeof this.auditService.record !==
            'function'
        ) {
            return false;
        }

        try {

            await this.auditService.record(
                sanitizeValue({

                    provider:
                        PROVIDER,

                    component:
                        COMPONENT,

                    occurredAt:
                        this.now(),

                    ...record

                })
            );

            return true;

        } catch (error) {

            this.logger?.warn?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to record Airtel autonomous router audit event',

                error:
                    safeError(
                        error
                    )

            });

            return false;
        }
    }

    /**
     * =========================================================================
     * Safe Projections
     * =========================================================================
     */

    safePolicy(
        policy
    ) {

        if (
            !policy ||
            typeof policy !== 'object'
        ) {
            return null;
        }

        return sanitizeValue({

            allowed:
                policy.allowed,

            decision:
                policy.decision,

            confidence:
                policy.confidence,

            overridden:
                policy.overridden,

            reasons:
                policy.reasons,

            reason:
                policy.reason

        });
    }

    safeExecutionResult(
        result
    ) {

        if (
            !result
        ) {
            return null;
        }

        if (
            typeof result !== 'object'
        ) {

            return truncate(
                result
            );
        }

        return sanitizeValue({

            success:
                result.success,

            accepted:
                result.accepted,

            queued:
                result.queued,

            status:
                result.status,

            id:
                result.id,

            operationId:
                result.operationId,

            transactionId:
                result.transactionId,

            reference:
                result.reference,

            reason:
                result.reason

        });
    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    recordRouteStatistics(
        route
    ) {

        switch (
            route
        ) {

            case ROUTE.MANUAL_REVIEW:

                this.statistics.reviews++;

                break;

            case ROUTE.ESCALATION:
            case ROUTE.INCIDENT:

                this.statistics.escalations++;

                break;

            case ROUTE.RETRY_QUEUE:

                this.statistics.retries++;

                break;

            case ROUTE.REJECT:

                this.statistics.rejected++;

                break;

            default:
                break;
        }
    }

    stats() {

        return {

            ...this.statistics,

            initialized:
                this.initialized,

            allowExecution:
                this.allowExecution,

            maxRetries:
                this.maxRetries,

            minRetryDelayMs:
                this.minRetryDelayMs,

            defaultRetryDelayMs:
                this.defaultRetryDelayMs,

            maxRetryDelayMs:
                this.maxRetryDelayMs,

            decisionMaxAgeMs:
                this.decisionMaxAgeMs,

            idempotencyTtlSeconds:
                this.idempotencyTtlSeconds

        };
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {

        const workflowDependencies = {

            decisionEngine:
                Boolean(
                    this.decisionEngine &&
                    typeof this.decisionEngine.recommend ===
                    'function'
                ),

            policyEngine:
                Boolean(
                    this.policyEngine &&
                    typeof this.policyEngine.evaluate ===
                    'function'
                ),

            approvalService:
                Boolean(
                    this.approvalService &&
                    typeof this.approvalService.authorize ===
                    'function'
                ),

            paymentService:
                Boolean(
                    this.paymentService &&
                    typeof this.paymentService.execute ===
                    'function'
                ),

            retryService:
                Boolean(
                    this.retryService &&
                    typeof this.retryService.schedule ===
                    'function'
                ),

            reviewService:
                Boolean(
                    this.reviewService &&
                    typeof this.reviewService.create ===
                    'function'
                ),

            escalationService:
                Boolean(
                    this.escalationService &&
                    typeof this.escalationService.create ===
                    'function'
                ),

            idempotency:
                Boolean(
                    this.idempotencyStore &&
                    (
                        typeof this.idempotencyStore.get ===
                            'function' ||
                        typeof this.idempotencyStore.check ===
                            'function'
                    )
                )

        };

        let status =
            this.healthState.status;

        if (
            !workflowDependencies.decisionEngine ||
            !workflowDependencies.reviewService
        ) {

            status =
                ROUTE_STATUS.FAILED;

        } else if (
            !workflowDependencies.policyEngine ||
            !workflowDependencies.approvalService
        ) {

            status =
                ROUTE_STATUS.REVIEW;

        } else if (
            !workflowDependencies.idempotency
        ) {

            status =
                ROUTE_STATUS.REVIEW;

        }

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            status,

            initialized:
                this.initialized,

            allowExecution:
                this.allowExecution,

            dependencies:
                workflowDependencies,

            healthState:
                {
                    ...this.healthState
                },

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            statistics:
                this.stats()

        };
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

            component:
                COMPONENT,

            version:
                VERSION,

            governance: {

                routingOnly:
                    true,

                financialAuthorization:
                    false,

                financialMutation:
                    false,

                advisoryExecutionDisabled:
                    !this.allowExecution

            },

            retryControls: {

                maxRetries:
                    this.maxRetries,

                minRetryDelayMs:
                    this.minRetryDelayMs,

                defaultRetryDelayMs:
                    this.defaultRetryDelayMs,

                maxRetryDelayMs:
                    this.maxRetryDelayMs

            },

            statistics:
                this.stats(),

            health:
                {
                    ...this.healthState
                }

        };
    }

    /**
     * =========================================================================
     * Tracing
     * =========================================================================
     */

    startSpan(
        name,
        attributes = {}
    ) {

        if (
            !this.tracer ||
            typeof this.tracer.startSpan !==
            'function'
        ) {
            return null;
        }

        try {

            const span =
                this.tracer.startSpan(
                    name
                );

            span?.setAttribute?.(
                'provider',
                PROVIDER
            );

            span?.setAttribute?.(
                'component',
                COMPONENT
            );

            for (
                const [
                    key,
                    value
                ] of Object.entries(
                    attributes
                )
            ) {

                if (
                    value !== null &&
                    value !== undefined
                ) {

                    span?.setAttribute?.(
                        key,
                        String(value)
                    );
                }
            }

            return span;

        } catch {

            return null;
        }
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateDependencies() {

        if (
            !this.decisionEngine ||
            typeof this.decisionEngine.recommend !==
            'function'
        ) {

            throw this.createError(
                'AI decision engine dependency missing',
                'AIRTEL_AUTONOMOUS_DECISION_ENGINE_REQUIRED'
            );
        }

        if (
            !this.reviewService ||
            typeof this.reviewService.create !==
            'function'
        ) {

            throw this.createError(
                'Manual review service dependency missing',
                'AIRTEL_AUTONOMOUS_REVIEW_SERVICE_REQUIRED'
            );
        }

        /*
         * We do not require paymentService during construction because the
         * router may operate safely in advisory/review mode without executing
         * payment routes.
         */
        return true;
    }

    /**
     * =========================================================================
     * Error Helper
     * =========================================================================
     */

    createError(
        message,
        code
    ) {

        const error =
            new Error(
                message
            );

        error.code =
            code;

        return error;
    }

    /**
     * =========================================================================
     * Clock
     * =========================================================================
     */

    now() {

        return new this.clock();
    }

    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     */

    snapshot() {

        return {

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            startedAt:
                this.startedAt,

            healthState:
                {
                    ...this.healthState
                },

            statistics:
                this.stats()

        };
    }

    /**
     * =========================================================================
     * Shutdown
     * =========================================================================
     */

    async shutdown() {

        this.healthState.status =
            ROUTE_STATUS.FAILED;

        this.initialized =
            false;

        return true;
    }
}

module.exports = AutonomousRouter;

module.exports.AutonomousRouter =
    AutonomousRouter;

module.exports.ROUTE_STATUS =
    ROUTE_STATUS;

module.exports.ROUTE =
    ROUTE;

module.exports.DECISION =
    DECISION;

module.exports.ROUTING_SOURCE =
    ROUTING_SOURCE;

module.exports.PROVIDER_HEALTH =
    PROVIDER_HEALTH;

module.exports.RETRYABLE_FAILURE_CLASSES =
    RETRYABLE_FAILURE_CLASSES;

module.exports.NON_RETRYABLE_FAILURE_CLASSES =
    NON_RETRYABLE_FAILURE_CLASSES;