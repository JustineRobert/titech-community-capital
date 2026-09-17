'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Analytics Pipeline
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/intelligence/analyticsPipeline.js
 *
 * Architectural Role
 * ------------------
 * Enterprise analytics orchestration and data-transformation boundary for the
 * Airtel payment intelligence subsystem.
 *
 * The pipeline prepares operational/payment/reconciliation evidence for
 * analytics, feature engineering, dashboards, intelligence services and
 * downstream decision-support components.
 *
 * It is intentionally separated from:
 * - provider communication,
 * - financial accounting,
 * - payment execution,
 * - settlement execution,
 * - reconciliation decisions,
 * - autonomous AI action.
 *
 * Responsibilities
 * ----------------
 * - Coordinate analytics pipeline stages.
 * - Normalize and validate analytics input.
 * - Enforce tenant isolation.
 * - Perform bounded data transformation.
 * - Build analytics features.
 * - Aggregate transaction/settlement/reconciliation metrics.
 * - Calculate operational indicators.
 * - Invoke configured feature/analytics processors.
 * - Support scheduled/manual/automatic pipeline execution.
 * - Support idempotent pipeline execution when configured.
 * - Expose safe output for AI/analytics consumers.
 * - Instrument metrics and tracing.
 * - Record audit events.
 * - Expose health and diagnostics.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Airtel HTTP/API communication.
 * - Authentication/token management.
 * - Payment execution.
 * - Settlement execution.
 * - Ledger posting.
 * - Wallet/balance mutation.
 * - Reconciliation state mutation.
 * - Financial repair.
 * - Fraud blocking.
 * - Final credit/risk decisions.
 * - Autonomous financial actions.
 *
 * Data Governance Principles
 * --------------------------
 * 1. Analytics output is derived intelligence, not authoritative financial
 *    state.
 * 2. Monetary values remain strings or exact serialized values.
 * 3. JavaScript floating-point arithmetic is not used for financial totals.
 * 4. Tenant identity is mandatory for tenant-scoped pipeline execution.
 * 5. Raw provider request/response payloads are not forwarded blindly.
 * 6. Sensitive fields are removed from analytics projections.
 * 7. Dataset sizes are bounded to prevent unbounded memory growth.
 * 8. Unknown/malformed records are surfaced as data-quality issues rather than
 *    silently discarded.
 *
 * AI Governance Principles
 * ------------------------
 * - Feature generation does not equal a model decision.
 * - Analytics scores are not probabilities unless explicitly defined by the
 *   upstream model contract.
 * - The pipeline must not authorize payments or financial repairs.
 *
 * Reliability Principles
 * ----------------------
 * - Pipeline stages fail explicitly.
 * - Optional processors may degrade gracefully where configured.
 * - Idempotency is checked before side-effecting persistence.
 * - Audit/event publication cannot rewrite an analytics result.
 * - Partial data-quality results are distinguishable from pipeline failure.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const PROVIDER = 'AIRTEL';
const COMPONENT = 'AnalyticsPipeline';
const VERSION = '1.0.0';

const PIPELINE_STATUS = Object.freeze({

    INITIALIZING:
        'INITIALIZING',

    READY:
        'READY',

    RUNNING:
        'RUNNING',

    COMPLETED:
        'COMPLETED',

    PARTIAL:
        'PARTIAL',

    FAILED:
        'FAILED',

    DEGRADED:
        'DEGRADED'

});

const PIPELINE_MODE = Object.freeze({

    AUTOMATIC:
        'AUTOMATIC',

    MANUAL:
        'MANUAL',

    SCHEDULED:
        'SCHEDULED',

    BACKFILL:
        'BACKFILL'

});

const DATA_QUALITY_STATUS = Object.freeze({

    VALID:
        'VALID',

    PARTIAL:
        'PARTIAL',

    INVALID:
        'INVALID'

});

const DEFAULTS = Object.freeze({

    maxTransactions:
        100_000,

    maxExceptions:
        10_000,

    maxFeatureKeys:
        500,

    maxAggregationGroups:
        10_000,

    maxProcessingTimeMs:
        10 * 60 * 1000,

    idempotencyTtlSeconds:
        86_400,

    amountScale:
        2,

    defaultCurrency:
        'UGX'

});

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
const MAX_OBJECT_KEYS = 100;
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
            .slice(0, 100)
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
            ] of Object.entries(value)
                .slice(0, MAX_OBJECT_KEYS)
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

    return truncate(value);
}

function safeError(
    error
) {

    return {

        name:
            truncate(
                error?.name || 'Error',
                128
            ),

        message:
            truncate(
                error?.message ||
                String(error || 'Unknown error'),
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
            'tenantId is required for Airtel analytics pipeline execution'
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

function normalizeDate(
    value,
    fieldName
) {

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        throw new Error(
            `${fieldName} must be a valid date`
        );
    }

    return date;
}

function normalizeMode(
    mode
) {

    const normalized =
        String(
            mode ||
            PIPELINE_MODE.AUTOMATIC
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            PIPELINE_MODE
        ).includes(
            normalized
        )
    ) {

        throw new Error(
            `Unsupported analytics pipeline mode: ${normalized}`
        );
    }

    return normalized;
}

function normalizeCount(
    value
) {

    const numeric =
        Number(value);

    if (
        !Number.isFinite(
            numeric
        ) ||
        numeric < 0
    ) {
        return 0;
    }

    return Math.floor(
        numeric
    );
}

function normalizeCurrency(
    value,
    fallback
) {

    const normalized =
        String(
            value ||
            fallback ||
            DEFAULTS.defaultCurrency
        )
            .trim()
            .toUpperCase();

    return truncate(
        normalized,
        16
    );
}

function normalizeAmountString(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const normalized =
        String(value).trim();

    return normalized || null;
}

function decimalToMinorUnits(
    value,
    scale
) {

    const amount =
        normalizeAmountString(
            value
        );

    if (!amount) {
        return null;
    }

    if (
        !/^\d+(?:\.\d+)?$/.test(
            amount
        )
    ) {
        return null;
    }

    const [
        integerPart,
        fractionPart = ''
    ] =
        amount.split('.');

    if (
        fractionPart.length > scale
    ) {
        return null;
    }

    const normalizedFraction =
        fractionPart.padEnd(
            scale,
            '0'
        );

    return BigInt(
        `${integerPart}${normalizedFraction}`
    );
}

function extractAmount(
    transaction
) {

    return (
        transaction?.amount ??
        transaction?.value ??
        transaction?.amountDecimal ??
        null
    );
}

function extractReference(
    transaction
) {

    if (!transaction) {
        return null;
    }

    const candidates = [

        transaction.reference,

        transaction.providerReference,

        transaction.transactionReference,

        transaction.externalReference,

        transaction.transactionId,

        transaction.providerTransactionId

    ];

    for (
        const candidate of candidates
    ) {

        if (
            candidate !== null &&
            candidate !== undefined &&
            String(candidate).trim()
        ) {

            return truncate(
                String(candidate).trim(),
                256
            );
        }
    }

    return null;
}

class AnalyticsPipeline {

    constructor({

        analyticsRepository,

        featureStore,

        analyticsProcessor,

        aggregationEngine,

        transactionRepository,

        settlementRepository,

        reconciliationService,

        providerAdapter,

        cache,

        idempotencyStore,

        auditService,

        eventBus,

        outboxService,

        eventPublisher,

        metrics,

        logger,

        tracer,

        tenantResolver,

        clock = Date,

        amountScale =
            process.env.AIRTEL_ANALYTICS_AMOUNT_SCALE ||
            DEFAULTS.amountScale,

        defaultCurrency =
            process.env.AIRTEL_ANALYTICS_CURRENCY ||
            DEFAULTS.defaultCurrency,

        maxTransactions =
            DEFAULTS.maxTransactions,

        maxExceptions =
            DEFAULTS.maxExceptions,

        maxFeatureKeys =
            DEFAULTS.maxFeatureKeys,

        maxAggregationGroups =
            DEFAULTS.maxAggregationGroups,

        maxProcessingTimeMs =
            DEFAULTS.maxProcessingTimeMs,

        idempotencyTtlSeconds =
            DEFAULTS.idempotencyTtlSeconds,

        continueOnStageFailure =
            false

    } = {}) {

        this.analyticsRepository =
            analyticsRepository;

        this.featureStore =
            featureStore;

        this.analyticsProcessor =
            analyticsProcessor;

        this.aggregationEngine =
            aggregationEngine;

        this.transactionRepository =
            transactionRepository;

        this.settlementRepository =
            settlementRepository;

        this.reconciliationService =
            reconciliationService;

        this.providerAdapter =
            providerAdapter;

        this.cache =
            cache;

        this.idempotencyStore =
            idempotencyStore;

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

        this.tenantResolver =
            tenantResolver;

        this.clock =
            clock;

        this.amountScale =
            this.normalizeAmountScale(
                amountScale
            );

        this.defaultCurrency =
            normalizeCurrency(
                defaultCurrency,
                DEFAULTS.defaultCurrency
            );

        this.maxTransactions =
            this.normalizeLimit(
                maxTransactions,
                DEFAULTS.maxTransactions
            );

        this.maxExceptions =
            this.normalizeLimit(
                maxExceptions,
                DEFAULTS.maxExceptions
            );

        this.maxFeatureKeys =
            this.normalizeLimit(
                maxFeatureKeys,
                DEFAULTS.maxFeatureKeys
            );

        this.maxAggregationGroups =
            this.normalizeLimit(
                maxAggregationGroups,
                DEFAULTS.maxAggregationGroups
            );

        this.maxProcessingTimeMs =
            this.normalizeLimit(
                maxProcessingTimeMs,
                DEFAULTS.maxProcessingTimeMs
            );

        this.idempotencyTtlSeconds =
            this.normalizeLimit(
                idempotencyTtlSeconds,
                DEFAULTS.idempotencyTtlSeconds
            );

        this.continueOnStageFailure =
            Boolean(
                continueOnStageFailure
            );

        this.startedAt =
            this.now();

        this.initialized =
            false;

        this.running =
            false;

        this.activeRunId =
            null;

        this.healthState = {

            status:
                PIPELINE_STATUS.INITIALIZING,

            lastRun:
                null,

            lastFailure:
                null,

            lastError:
                null

        };

        this.statistics = {

            executions:
                0,

            completed:
                0,

            partial:
                0,

            failed:
                0,

            idempotentHits:
                0,

            transactionsProcessed:
                0,

            transactionsRejected:
                0,

            featuresGenerated:
                0,

            aggregationRuns:
                0,

            dataQualityIssues:
                0,

            processorFailures:
                0,

            auditFailures:
                0,

            eventFailures:
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
            PIPELINE_STATUS.READY;

        this.logger?.info?.({

            provider:
                PROVIDER,

            component:
                COMPONENT,

            message:
                'Airtel analytics pipeline initialized'

        });

        this.metrics?.counter?.(
            'airtel_analytics_pipeline_initialized_total',
            1
        );

        return true;
    }

    /**
     * =========================================================================
     * Execute Pipeline
     * =========================================================================
     */

    async execute({

        tenantId,

        settlementDate =
            this.now(),

        mode =
            PIPELINE_MODE.AUTOMATIC,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        idempotencyKey,

        input = {},

        metadata = {},

        session = null

    } = {}) {

        if (this.running) {

            throw this.createError(
                'An Airtel analytics pipeline execution is already active',
                'AIRTEL_ANALYTICS_PIPELINE_BUSY'
            );
        }

        const normalizedTenantId =
            requireTenantId(
                tenantId
            );

        const normalizedDate =
            normalizeDate(
                settlementDate,
                'settlementDate'
            );

        const normalizedMode =
            normalizeMode(
                mode
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

                settlementDate:
                    normalizedDate,

                mode:
                    normalizedMode

            });

        const span =
            this.startSpan(
                'airtel.analytics.pipeline.execute',
                {
                    tenantId:
                        normalizedTenantId,

                    correlationId:
                        normalizedCorrelationId,

                    executionId:
                        normalizedExecutionId,

                    mode:
                        normalizedMode

                }
            );

        const startedAt =
            Date.now();

        this.running =
            true;

        this.activeRunId =
            normalizedExecutionId;

        try {

            const existing =
                await this.getIdempotentResult({

                    tenantId:
                        normalizedTenantId,

                    idempotencyKey:
                        effectiveIdempotencyKey

                });

            if (existing) {

                this.statistics.idempotentHits++;

                this.metrics?.counter?.(
                    'airtel_analytics_pipeline_idempotent_hit_total',
                    1
                );

                return existing;
            }

            this.healthState.status =
                PIPELINE_STATUS.RUNNING;

            this.statistics.executions++;

            const context = {

                provider:
                    PROVIDER,

                tenantId:
                    normalizedTenantId,

                settlementDate:
                    normalizedDate,

                mode:
                    normalizedMode,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                idempotencyKey:
                    effectiveIdempotencyKey,

                metadata:
                    sanitizeValue(
                        metadata
                    ),

                session

            };

            const sourceData =
                await this.collectSourceData({
                    context,
                    input
                });

            const normalizedData =
                this.normalizeDataset({
                    context,
                    sourceData
                });

            const quality =
                this.assessDataQuality(
                    normalizedData
                );

            this.statistics.dataQualityIssues +=
                quality.issueCount;

            const features =
                await this.buildFeatures({
                    context,
                    normalizedData
                });

            const aggregates =
                await this.buildAggregates({
                    context,
                    normalizedData
                });

            const analytics =
                await this.processAnalytics({
                    context,
                    normalizedData,
                    features,
                    aggregates
                });

            const resultStatus =
                this.determinePipelineStatus(
                    quality,
                    analytics
                );

            const result = {

                pipelineId:
                    normalizedExecutionId,

                executionId:
                    normalizedExecutionId,

                provider:
                    PROVIDER,

                tenantId:
                    normalizedTenantId,

                settlementDate:
                    normalizedDate,

                mode:
                    normalizedMode,

                correlationId:
                    normalizedCorrelationId,

                idempotencyKey:
                    effectiveIdempotencyKey,

                status:
                    resultStatus,

                quality,

                summary:
                    this.buildSummary({
                        normalizedData,
                        features,
                        aggregates,
                        analytics
                    }),

                features:
                    this.safeFeatureProjection(
                        features
                    ),

                aggregates:
                    this.safeAggregateProjection(
                        aggregates
                    ),

                analytics:
                    this.safeAnalyticsProjection(
                        analytics
                    ),

                completedAt:
                    this.now(),

                durationMs:
                    Date.now() - startedAt

            };

            await this.persistResult(
                result,
                {
                    session
                }
            );

            await this.storeIdempotentResult({
                context,
                result
            });

            await this.recordAuditSafe({

                action:
                    'AIRTEL_ANALYTICS_PIPELINE_COMPLETED',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                mode:
                    normalizedMode,

                status:
                    result.status,

                summary:
                    result.summary

            });

            await this.publishSafeEvent({

                type:
                    'AIRTEL_ANALYTICS_PIPELINE_COMPLETED',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                payload: {

                    pipelineId:
                        normalizedExecutionId,

                    status:
                        result.status,

                    mode:
                        normalizedMode,

                    summary:
                        result.summary

                }

            });

            if (
                result.status ===
                PIPELINE_STATUS.COMPLETED
            ) {

                this.statistics.completed++;

            } else {

                this.statistics.partial++;
            }

            this.statistics.transactionsProcessed +=
                normalizedData.transactions.length;

            this.statistics.featuresGenerated +=
                Object.keys(
                    features || {}
                ).length;

            this.statistics.aggregationRuns++;

            this.healthState.status =
                result.status ===
                PIPELINE_STATUS.COMPLETED
                    ? PIPELINE_STATUS.READY
                    : PIPELINE_STATUS.DEGRADED;

            this.healthState.lastRun =
                result.completedAt;

            this.healthState.lastError =
                null;

            this.metrics?.counter?.(
                'airtel_analytics_pipeline_completed_total',
                1
            );

            this.metrics?.histogram?.(
                'airtel_analytics_pipeline_duration_ms',
                Date.now() - startedAt
            );

            return result;

        } catch (error) {

            this.statistics.failed++;

            this.healthState.status =
                PIPELINE_STATUS.DEGRADED;

            this.healthState.lastFailure =
                this.now();

            this.healthState.lastError =
                safeError(
                    error
                );

            this.metrics?.counter?.(
                'airtel_analytics_pipeline_failed_total',
                1
            );

            this.metrics?.histogram?.(
                'airtel_analytics_pipeline_duration_ms',
                Date.now() - startedAt
            );

            await this.recordAuditSafe({

                action:
                    'AIRTEL_ANALYTICS_PIPELINE_FAILED',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                mode:
                    normalizedMode,

                error:
                    safeError(
                        error
                    )

            });

            await this.publishSafeEvent({

                type:
                    'AIRTEL_ANALYTICS_PIPELINE_FAILED',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                executionId:
                    normalizedExecutionId,

                payload: {

                    pipelineId:
                        normalizedExecutionId,

                    mode:
                        normalizedMode,

                    error: {

                        name:
                            error?.name,

                        code:
                            error?.code

                    }

                }

            });

            this.logger?.error?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Airtel analytics pipeline execution failed',

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

            this.running =
                false;

            this.activeRunId =
                null;

            span?.end?.();

        }
    }

    /**
     * =========================================================================
     * Source Data Collection
     * =========================================================================
     */

    async collectSourceData({

        context,

        input = {}

    }) {

        const suppliedTransactions =
            Array.isArray(
                input.transactions
            )
                ? input.transactions
                : null;

        const suppliedExceptions =
            Array.isArray(
                input.exceptions
            )
                ? input.exceptions
                : null;

        let transactions =
            suppliedTransactions;

        if (
            !transactions &&
            this.transactionRepository
        ) {

            transactions =
                await this.loadTransactions(
                    context
                );
        }

        if (
            !transactions &&
            this.providerAdapter &&
            typeof this.providerAdapter
                .getSettlementTransactions ===
            'function'
        ) {

            transactions =
                await this.providerAdapter
                    .getSettlementTransactions({

                        tenantId:
                            context.tenantId,

                        settlementDate:
                            context.settlementDate,

                        correlationId:
                            context.correlationId,

                        executionId:
                            context.executionId,

                        session:
                            context.session

                    });
        }

        let exceptions =
            suppliedExceptions;

        if (
            !exceptions &&
            context.inputExceptions
        ) {

            exceptions =
                context.inputExceptions;
        }

        return {

            transactions:
                Array.isArray(
                    transactions
                )
                    ? transactions
                    : [],

            exceptions:
                Array.isArray(
                    exceptions
                )
                    ? exceptions
                    : [],

            settlement:
                input.settlement || null,

            reconciliation:
                input.reconciliation || null,

            metadata:
                sanitizeValue(
                    input.metadata || {}
                )

        };
    }

    async loadTransactions(
        context
    ) {

        if (
            !this.transactionRepository
        ) {
            return [];
        }

        if (
            typeof this.transactionRepository
                .findForAnalytics ===
            'function'
        ) {

            return this.transactionRepository
                .findForAnalytics({

                    tenantId:
                        context.tenantId,

                    settlementDate:
                        context.settlementDate,

                    session:
                        context.session

                });
        }

        if (
            typeof this.transactionRepository
                .findSettlementTransactions ===
            'function'
        ) {

            return this.transactionRepository
                .findSettlementTransactions({

                    tenantId:
                        context.tenantId,

                    settlementDate:
                        context.settlementDate,

                    session:
                        context.session

                });
        }

        if (
            typeof this.transactionRepository
                .find ===
            'function'
        ) {

            return this.transactionRepository.find({

                tenantId:
                    context.tenantId

            }, {

                settlementDate:
                    context.settlementDate,

                session:
                    context.session

            });
        }

        return [];
    }

    /**
     * =========================================================================
     * Dataset Normalization
     * =========================================================================
     */

    normalizeDataset({

        context,

        sourceData

    }) {

        const transactions =
            Array.isArray(
                sourceData.transactions
            )
                ? sourceData.transactions
                    .slice(
                        0,
                        this.maxTransactions
                    )
                    .map(
                        tx =>
                            this.normalizeTransaction(
                                tx
                            )
                    )
                    .filter(
                        Boolean
                    )
                : [];

        const exceptions =
            Array.isArray(
                sourceData.exceptions
            )
                ? sourceData.exceptions
                    .slice(
                        0,
                        this.maxExceptions
                    )
                    .map(
                        exception =>
                            sanitizeValue(
                                exception
                            )
                    )
                : [];

        return {

            tenantId:
                context.tenantId,

            settlementDate:
                context.settlementDate,

            transactions,

            exceptions,

            settlement:
                sanitizeValue(
                    sourceData.settlement
                ),

            reconciliation:
                sanitizeValue(
                    sourceData.reconciliation
                ),

            metadata:
                sanitizeValue(
                    sourceData.metadata
                )

        };
    }

    normalizeTransaction(
        transaction
    ) {

        if (
            !transaction ||
            typeof transaction !== 'object'
        ) {

            this.statistics.transactionsRejected++;

            return null;
        }

        const reference =
            extractReference(
                transaction
            );

        const amount =
            normalizeAmountString(
                extractAmount(
                    transaction
                )
            );

        const currency =
            normalizeCurrency(
                transaction.currency,
                this.defaultCurrency
            );

        if (!reference) {

            this.statistics.transactionsRejected++;

            return {

                dataQualityStatus:
                    DATA_QUALITY_STATUS.INVALID,

                reference:
                    null,

                amount,

                currency,

                status:
                    transaction.status ??
                    transaction.state,

                reason:
                    'MISSING_TRANSACTION_REFERENCE'

            };
        }

        return {

            dataQualityStatus:
                DATA_QUALITY_STATUS.VALID,

            id:
                transaction.id ??
                transaction._id ??
                transaction.transactionId,

            reference,

            providerReference:
                transaction.providerReference,

            transactionReference:
                transaction.transactionReference,

            externalReference:
                transaction.externalReference,

            amount,

            amountMinor:
                amount !== null
                    ? decimalToMinorUnits(
                        amount,
                        this.amountScale
                    )
                    : null,

            currency,

            status:
                transaction.status ??
                transaction.state,

            transactionType:
                transaction.transactionType,

            provider:
                transaction.provider ||
                PROVIDER,

            settlementReference:
                transaction.settlementReference,

            createdAt:
                transaction.createdAt,

            occurredAt:
                transaction.occurredAt,

            processedAt:
                transaction.processedAt

        };
    }

    /**
     * =========================================================================
     * Data Quality
     * =========================================================================
     */

    assessDataQuality(
        dataset
    ) {

        const invalidTransactions =
            dataset.transactions
                .filter(
                    transaction =>
                        transaction.dataQualityStatus !==
                        DATA_QUALITY_STATUS.VALID
                )
                .length;

        const issueCount =
            invalidTransactions +
            dataset.exceptions.filter(
                exception =>
                    !exception ||
                    typeof exception !== 'object'
            ).length;

        let status =
            DATA_QUALITY_STATUS.VALID;

        if (
            issueCount > 0
        ) {

            status =
                invalidTransactions ===
                    dataset.transactions.length &&
                dataset.transactions.length > 0
                    ? DATA_QUALITY_STATUS.INVALID
                    : DATA_QUALITY_STATUS.PARTIAL;
        }

        return {

            status,

            issueCount,

            invalidTransactions,

            transactionCount:
                dataset.transactions.length,

            exceptionCount:
                dataset.exceptions.length

        };
    }

    /**
     * =========================================================================
     * Feature Generation
     * =========================================================================
     */

    async buildFeatures({

        context,

        normalizedData

    }) {

        const generated = {

            transactionCount:
                normalizedData.transactions.length,

            exceptionCount:
                normalizedData.exceptions.length,

            matchedCount:
                this.countStatuses(
                    normalizedData.transactions,
                    [
                        'MATCHED',
                        'SUCCESS',
                        'COMPLETED',
                        'SETTLED'
                    ]
                ),

            failedCount:
                this.countStatuses(
                    normalizedData.transactions,
                    [
                        'FAILED',
                        'ERROR'
                    ]
                ),

            pendingCount:
                this.countStatuses(
                    normalizedData.transactions,
                    [
                        'PENDING',
                        'PROCESSING'
                    ]
                ),

            reversedCount:
                this.countStatuses(
                    normalizedData.transactions,
                    [
                        'REVERSED'
                    ]
                ),

            totalAmountByCurrency:
                this.aggregateAmountsByCurrency(
                    normalizedData.transactions
                )

        };

        if (
            this.featureStore &&
            typeof this.featureStore.build ===
            'function'
        ) {

            const externalFeatures =
                await this.featureStore.build({

                    tenantId:
                        context.tenantId,

                    settlementDate:
                        context.settlementDate,

                    transactions:
                        this.safeTransactionsForAnalytics(
                            normalizedData.transactions
                        ),

                    exceptions:
                        normalizedData.exceptions,

                    correlationId:
                        context.correlationId,

                    executionId:
                        context.executionId

                });

            Object.assign(
                generated,
                sanitizeValue(
                    externalFeatures || {}
                )
            );
        }

        const bounded =
            Object.fromEntries(
                Object.entries(
                    generated
                )
                    .slice(
                        0,
                        this.maxFeatureKeys
                    )
            );

        return bounded;
    }

    /**
     * =========================================================================
     * Aggregation
     * =========================================================================
     */

    async buildAggregates({

        context,

        normalizedData

    }) {

        if (
            this.aggregationEngine &&
            typeof this.aggregationEngine.aggregate ===
            'function'
        ) {

            const result =
                await this.aggregationEngine.aggregate({

                    tenantId:
                        context.tenantId,

                    settlementDate:
                        context.settlementDate,

                    transactions:
                        this.safeTransactionsForAnalytics(
                            normalizedData.transactions
                        ),

                    exceptions:
                        normalizedData.exceptions,

                    correlationId:
                        context.correlationId,

                    executionId:
                        context.executionId,

                    maxGroups:
                        this.maxAggregationGroups

                });

            return sanitizeValue(
                result || {}
            );
        }

        const groups =
            new Map();

        for (
            const transaction of
            normalizedData.transactions
        ) {

            const key =
                [
                    transaction.currency ||
                    this.defaultCurrency,

                    transaction.status ||
                    'UNKNOWN'
                ].join(':');

            if (
                !groups.has(key) &&
                groups.size >=
                this.maxAggregationGroups
            ) {
                break;
            }

            const group =
                groups.get(
                    key
                ) || {

                    currency:
                        transaction.currency ||
                        this.defaultCurrency,

                    status:
                        transaction.status ||
                        'UNKNOWN',

                    count:
                        0,

                    totalAmountMinor:
                        BigInt(0)

                };

            group.count++;

            if (
                transaction.amountMinor !== null &&
                transaction.amountMinor !== undefined
            ) {

                group.totalAmountMinor +=
                    transaction.amountMinor;
            }

            groups.set(
                key,
                group
            );
        }

        const output = {};

        for (
            const [
                key,
                group
            ] of groups.entries()
        ) {

            output[key] = {

                currency:
                    group.currency,

                status:
                    group.status,

                count:
                    group.count,

                totalAmountMinor:
                    group.totalAmountMinor
                        .toString()

            };
        }

        return output;
    }

    /**
     * =========================================================================
     * Analytics Processor
     * =========================================================================
     */

    async processAnalytics({

        context,

        normalizedData,

        features,

        aggregates

    }) {

        if (
            !this.analyticsProcessor ||
            typeof this.analyticsProcessor.process !==
            'function'
        ) {

            return {

                status:
                    'BUILT_IN',

                metrics:
                    this.buildOperationalMetrics(
                        normalizedData
                    )

            };
        }

        try {

            const result =
                await this.analyticsProcessor.process({

                    tenantId:
                        context.tenantId,

                    settlementDate:
                        context.settlementDate,

                    features:
                        sanitizeValue(
                            features
                        ),

                    aggregates:
                        sanitizeValue(
                            aggregates
                        ),

                    correlationId:
                        context.correlationId,

                    executionId:
                        context.executionId

                });

            return sanitizeValue(
                result || {}
            );

        } catch (error) {

            this.statistics.processorFailures++;

            if (
                !this.continueOnStageFailure
            ) {

                throw error;
            }

            return {

                status:
                    'DEGRADED',

                error:
                    safeError(
                        error
                    )

            };
        }
    }

    /**
     * =========================================================================
     * Operational Metrics
     * =========================================================================
     */

    buildOperationalMetrics(
        dataset
    ) {

        const transactions =
            dataset.transactions;

        const total =
            transactions.length;

        const successful =
            this.countStatuses(
                transactions,
                [
                    'SUCCESS',
                    'COMPLETED',
                    'SETTLED',
                    'MATCHED'
                ]
            );

        const failed =
            this.countStatuses(
                transactions,
                [
                    'FAILED',
                    'ERROR'
                ]
            );

        const pending =
            this.countStatuses(
                transactions,
                [
                    'PENDING',
                    'PROCESSING'
                ]
            );

        return {

            totalTransactions:
                total,

            successfulTransactions:
                successful,

            failedTransactions:
                failed,

            pendingTransactions:
                pending,

            successRate:
                this.calculateRate(
                    successful,
                    total
                ),

            failureRate:
                this.calculateRate(
                    failed,
                    total
                ),

            pendingRate:
                this.calculateRate(
                    pending,
                    total
                )

        };
    }

    countStatuses(
        transactions,
        statuses
    ) {

        const statusSet =
            new Set(
                statuses.map(
                    status =>
                        String(
                            status
                        )
                            .toUpperCase()
                )
            );

        return transactions.filter(
            transaction =>
                statusSet.has(
                    String(
                        transaction?.status ||
                        ''
                    )
                        .toUpperCase()
                )
        ).length;
    }

    aggregateAmountsByCurrency(
        transactions
    ) {

        const totals =
            {};

        for (
            const transaction of
            transactions
        ) {

            const currency =
                transaction.currency ||
                this.defaultCurrency;

            if (
                transaction.amountMinor === null ||
                transaction.amountMinor === undefined
            ) {
                continue;
            }

            const current =
                BigInt(
                    totals[currency] ||
                    '0'
                );

            totals[currency] =
                (
                    current +
                    transaction.amountMinor
                ).toString();
        }

        return totals;
    }

    /**
     * =========================================================================
     * Determine Pipeline Status
     * =========================================================================
     */

    determinePipelineStatus(
        quality,
        analytics
    ) {

        if (
            analytics?.status ===
            'DEGRADED' ||
            quality.status ===
            DATA_QUALITY_STATUS.PARTIAL
        ) {

            return PIPELINE_STATUS.PARTIAL;
        }

        if (
            quality.status ===
            DATA_QUALITY_STATUS.INVALID
        ) {

            return PIPELINE_STATUS.PARTIAL;
        }

        return PIPELINE_STATUS.COMPLETED;
    }

    /**
     * =========================================================================
     * Summary
     * =========================================================================
     */

    buildSummary({

        normalizedData,

        features,

        aggregates,

        analytics

    }) {

        return {

            transactionCount:
                normalizedData.transactions.length,

            exceptionCount:
                normalizedData.exceptions.length,

            featureCount:
                Object.keys(
                    features || {}
                ).length,

            aggregationGroupCount:
                Object.keys(
                    aggregates || {}
                ).length,

            analyticsStatus:
                analytics?.status ||
                'UNKNOWN',

            dataQualityIssues:
                normalizedData.transactions
                    .filter(
                        transaction =>
                            transaction.dataQualityStatus !==
                            DATA_QUALITY_STATUS.VALID
                    )
                    .length

        };
    }

    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */

    async persistResult(
        result,
        {
            session = null
        } = {}
    ) {

        if (
            !this.analyticsRepository
        ) {
            return false;
        }

        const safeResult =
            sanitizeValue(
                result
            );

        if (
            typeof this.analyticsRepository
                .createForTenant ===
            'function'
        ) {

            await this.analyticsRepository
                .createForTenant(
                    result.tenantId,
                    safeResult,
                    {
                        session
                    }
                );

            return true;
        }

        if (
            typeof this.analyticsRepository
                .create ===
            'function'
        ) {

            await this.analyticsRepository.create(
                safeResult,
                {
                    session
                }
            );

            return true;
        }

        if (
            typeof this.analyticsRepository
                .save ===
            'function'
        ) {

            await this.analyticsRepository.save(
                safeResult,
                {
                    session
                }
            );

            return true;
        }

        return false;
    }

    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */

    buildIdempotencyKey({

        tenantId,

        settlementDate,

        mode

    }) {

        return (
            `airtel:analytics:${tenantId}:` +
            `${settlementDate.toISOString().slice(0, 10)}:` +
            `${mode}`
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
            this.scopedIdempotencyKey(
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

        context,

        result

    }) {

        if (
            !this.idempotencyStore
        ) {
            return false;
        }

        const key =
            this.scopedIdempotencyKey(
                context.tenantId,
                context.idempotencyKey
            );

        const value =
            sanitizeValue(
                result
            );

        if (
            typeof this.idempotencyStore.set ===
            'function'
        ) {

            await this.idempotencyStore.set(
                key,
                value,
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
                value,
                this.idempotencyTtlSeconds
            );

            return true;
        }

        return false;
    }

    scopedIdempotencyKey(
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
            `airtel:analytics:pipeline:${digest}`
        );
    }

    /**
     * =========================================================================
     * Safe Projections
     * =========================================================================
     */

    safeTransactionsForAnalytics(
        transactions
    ) {

        return transactions.map(
            transaction => ({

                id:
                    transaction.id,

                reference:
                    transaction.reference,

                providerReference:
                    transaction.providerReference,

                transactionReference:
                    transaction.transactionReference,

                amount:
                    transaction.amount,

                currency:
                    transaction.currency,

                status:
                    transaction.status,

                transactionType:
                    transaction.transactionType,

                settlementReference:
                    transaction.settlementReference,

                createdAt:
                    transaction.createdAt,

                occurredAt:
                    transaction.occurredAt

            })
        );
    }

    safeFeatureProjection(
        features
    ) {

        return sanitizeValue(
            features || {}
        );
    }

    safeAggregateProjection(
        aggregates
    ) {

        return sanitizeValue(
            aggregates || {}
        );
    }

    safeAnalyticsProjection(
        analytics
    ) {

        return sanitizeValue(
            analytics || {}
        );
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

            this.statistics.auditFailures++;

            this.logger?.warn?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to record Airtel analytics pipeline audit event',

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

            this.statistics.eventFailures++;

            this.logger?.warn?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to publish Airtel analytics pipeline event',

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
     * Health
     * =========================================================================
     */

    async health() {

        const repositoryAvailable =
            Boolean(
                this.analyticsRepository
            );

        const featureStoreAvailable =
            Boolean(
                this.featureStore &&
                typeof this.featureStore.build ===
                'function'
            );

        const idempotencyAvailable =
            Boolean(
                this.idempotencyStore &&
                (
                    typeof this.idempotencyStore.get ===
                        'function' ||
                    typeof this.idempotencyStore.check ===
                        'function'
                )
            );

        const transactionSourceAvailable =
            Boolean(
                this.transactionRepository ||
                (
                    this.providerAdapter &&
                    typeof this.providerAdapter
                        .getSettlementTransactions ===
                    'function'
                )
            );

        let status =
            this.healthState.status;

        if (
            !transactionSourceAvailable
        ) {

            status =
                PIPELINE_STATUS.FAILED;

        } else if (
            !featureStoreAvailable
        ) {

            /*
             * Built-in feature construction still permits operation, so this
             * is degraded rather than failed.
             */
            status =
                PIPELINE_STATUS.DEGRADED;

        } else if (
            !idempotencyAvailable
        ) {

            status =
                PIPELINE_STATUS.DEGRADED;

        } else if (
            status ===
            PIPELINE_STATUS.INITIALIZING
        ) {

            status =
                PIPELINE_STATUS.DEGRADED;
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

            running:
                this.running,

            activeRunId:
                this.activeRunId,

            dependencies: {

                analyticsRepository:
                    repositoryAvailable,

                transactionRepository:
                    Boolean(
                        this.transactionRepository
                    ),

                providerAdapter:
                    Boolean(
                        this.providerAdapter
                    ),

                featureStore:
                    featureStoreAvailable,

                aggregationEngine:
                    Boolean(
                        this.aggregationEngine
                    ),

                analyticsProcessor:
                    Boolean(
                        this.analyticsProcessor
                    ),

                idempotencyStore:
                    idempotencyAvailable,

                auditService:
                    !this.auditService ||
                    typeof this.auditService.record ===
                    'function',

                eventPublisher:
                    Boolean(
                        (
                            this.outboxService &&
                            typeof this.outboxService.publish ===
                            'function'
                        ) ||
                        (
                            this.eventPublisher &&
                            typeof this.eventPublisher.publish ===
                            'function'
                        ) ||
                        (
                            this.eventBus &&
                            typeof this.eventBus.publish ===
                            'function'
                        )
                    )

            },

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
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            initialized:
                this.initialized,

            running:
                this.running,

            amountScale:
                this.amountScale,

            defaultCurrency:
                this.defaultCurrency,

            maxTransactions:
                this.maxTransactions,

            maxExceptions:
                this.maxExceptions,

            maxFeatureKeys:
                this.maxFeatureKeys,

            maxAggregationGroups:
                this.maxAggregationGroups,

            maxProcessingTimeMs:
                this.maxProcessingTimeMs,

            idempotencyTtlSeconds:
                this.idempotencyTtlSeconds

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

                analyticsOnly:
                    true,

                financialMutation:
                    false,

                autonomousFinancialAction:
                    false

            },

            configuration: {

                amountScale:
                    this.amountScale,

                defaultCurrency:
                    this.defaultCurrency,

                maxTransactions:
                    this.maxTransactions,

                maxExceptions:
                    this.maxExceptions,

                maxFeatureKeys:
                    this.maxFeatureKeys,

                maxAggregationGroups:
                    this.maxAggregationGroups,

                maxProcessingTimeMs:
                    this.maxProcessingTimeMs,

                continueOnStageFailure:
                    this.continueOnStageFailure

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
     * Configuration
     * =========================================================================
     */

    normalizeAmountScale(
        value
    ) {

        const numeric =
            Number(value);

        if (
            !Number.isInteger(numeric) ||
            numeric < 0 ||
            numeric > 9
        ) {

            return DEFAULTS.amountScale;
        }

        return numeric;
    }

    normalizeLimit(
        value,
        fallback
    ) {

        const numeric =
            Number(value);

        if (
            !Number.isFinite(numeric) ||
            numeric <= 0
        ) {
            return fallback;
        }

        return Math.floor(
            numeric
        );
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
     * Validation
     * =========================================================================
     */

    validateDependencies() {

        const hasTransactionSource =
            Boolean(
                this.transactionRepository ||
                (
                    this.providerAdapter &&
                    typeof this.providerAdapter
                        .getSettlementTransactions ===
                    'function'
                )
            );

        if (
            !hasTransactionSource
        ) {

            throw this.createError(
                'Analytics pipeline transaction source missing',
                'AIRTEL_ANALYTICS_TRANSACTION_SOURCE_REQUIRED'
            );
        }

        if (
            this.analyticsRepository &&
            typeof this.analyticsRepository.create !==
            'function' &&
            typeof this.analyticsRepository.createForTenant !==
            'function' &&
            typeof this.analyticsRepository.save !==
            'function'
        ) {

            throw this.createError(
                'Analytics repository does not expose a supported persistence operation',
                'AIRTEL_ANALYTICS_REPOSITORY_INVALID'
            );
        }

        return true;
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

        if (
            this.running
        ) {

            this.logger?.warn?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Airtel analytics pipeline shutdown requested while execution is active',

                activeRunId:
                    this.activeRunId

            });
        }

        this.healthState.status =
            PIPELINE_STATUS.DEGRADED;

        this.initialized =
            false;

        return true;
    }
}

module.exports = AnalyticsPipeline;

module.exports.AnalyticsPipeline =
    AnalyticsPipeline;

module.exports.PIPELINE_STATUS =
    PIPELINE_STATUS;

module.exports.PIPELINE_MODE =
    PIPELINE_MODE;

module.exports.DATA_QUALITY_STATUS =
    DATA_QUALITY_STATUS;

module.exports.PROVIDER =
    PROVIDER;

module.exports.COMPONENT =
    COMPONENT;

module.exports.VERSION =
    VERSION;

module.exports.decimalToMinorUnits =
    decimalToMinorUnits;