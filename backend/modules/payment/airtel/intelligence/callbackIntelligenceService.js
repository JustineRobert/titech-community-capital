'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 *
 * Enterprise Airtel Callback Intelligence Service
 *
 * File
 * ----
 * backend/modules/payment/airtel/intelligence/callbackIntelligenceService.js
 *
 * Architectural Role
 * ------------------
 * Governed callback intelligence, analytics and machine-learning orchestration
 * boundary for the Airtel integration.
 *
 * This service converts callback lifecycle evidence into analytics, features,
 * fraud signals, predictive insights, provider-learning inputs and operational
 * intelligence. It does not become an autonomous financial decision or
 * accounting boundary.
 *
 * Responsibilities
 * ----------------
 * - Securely project/store callback intelligence events.
 * - Coordinate analytics processing.
 * - Generate analytics features.
 * - Coordinate fraud-intelligence evaluation.
 * - Coordinate callback-failure prediction.
 * - Feed provider-behaviour learning systems.
 * - Generate operational optimization recommendations.
 * - Provide executive intelligence dashboard hooks.
 * - Provide regulatory reporting hooks without asserting compliance.
 * - Forward verified outcome data to configured learning systems.
 * - Maintain tenant isolation.
 * - Preserve correlation/execution identifiers.
 * - Instrument metrics, tracing and operational health.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Airtel API communication.
 * - Callback signature verification.
 * - Payment execution.
 * - Settlement execution.
 * - Ledger posting.
 * - Wallet/balance mutation.
 * - Reconciliation decisions.
 * - Financial repair.
 * - KYC/AML decisions.
 * - Regulatory compliance certification.
 * - Autonomous payment blocking.
 * - Autonomous financial authorization.
 *
 * Intelligence Governance
 * -----------------------
 * 1. Intelligence output is advisory unless an explicit downstream policy
 *    boundary authorizes an action.
 * 2. Fraud score is not itself a final compliance/fraud disposition.
 * 3. Predictions are not guaranteed probabilities unless the model contract
 *    establishes calibration.
 * 4. Analytics must not invent evidence.
 * 5. Unknown or incomplete signals remain explicit.
 * 6. Learning inputs require outcome provenance and correlation identity.
 *
 * Data Security Principles
 * ------------------------
 * - Never store or publish raw credentials, access tokens, signatures or
 *   unrestricted provider request/response payloads.
 * - Callback storage contains a bounded safe projection.
 * - Tenant identity is mandatory.
 * - Financial amounts are represented using exact decimal/minor-unit values.
 * - Object/array sizes are bounded to prevent memory/storage abuse.
 *
 * Financial Safety Principles
 * ---------------------------
 * - No direct balance or ledger mutation.
 * - No financial posting.
 * - No payment authorization.
 * - No automatic reconciliation repair.
 * - No automatic blocking solely because an AI/fraud model emits a score.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');

const PROVIDER = 'AIRTEL';
const COMPONENT = 'CallbackIntelligenceService';
const VERSION = '1.0.0';

const SERVICE_STATUS = Object.freeze({

    INITIALIZING:
        'INITIALIZING',

    READY:
        'READY',

    DEGRADED:
        'DEGRADED',

    FAILED:
        'FAILED'

});

const FRAUD_DECISION = Object.freeze({

    REVIEW:
        'REVIEW',

    ALLOW:
        'ALLOW',

    BLOCK_RECOMMENDATION:
        'BLOCK_RECOMMENDATION'

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

    amountScale:
        2,

    defaultCurrency:
        'UGX',

    maxFeatureKeys:
        100,

    maxMetadataKeys:
        100,

    maxTransactions:
        1_000,

    maxArrayItems:
        100,

    maxCallbackPayloadKeys:
        100,

    maxProviderEventSize:
        256 * 1024,

    maxRiskScore:
        100

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
const MAX_REASON_LENGTH = 1_000;
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
                DEFAULTS.maxArrayItems
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
            ] of Object.entries(value)
                .slice(
                    0,
                    DEFAULTS.maxMetadataKeys
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

    return truncate(value);
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
                MAX_REASON_LENGTH
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
            'tenantId is required for Airtel callback intelligence'
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
    fieldName = 'timestamp'
) {

    const date =
        value === undefined ||
        value === null
            ? new Date()
            : new Date(value);

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

function normalizeCurrency(
    currency,
    fallback = DEFAULTS.defaultCurrency
) {

    const normalized =
        String(
            currency ||
            fallback
        )
            .trim()
            .toUpperCase();

    return truncate(
        normalized,
        16
    );
}

function normalizeAmount(
    amount
) {

    if (
        amount === null ||
        amount === undefined
    ) {
        return null;
    }

    const value =
        String(amount)
            .trim();

    if (!value) {
        return null;
    }

    return value;
}

/**
 * Exact decimal conversion for analytics aggregation.
 *
 * This helper intentionally rejects floating-point coercion.
 */
function decimalToMinorUnits(
    amount,
    scale
) {

    const normalized =
        normalizeAmount(
            amount
        );

    if (!normalized) {
        return null;
    }

    if (
        !/^\d+(?:\.\d+)?$/.test(
            normalized
        )
    ) {
        return null;
    }

    const [
        integerPart,
        fractionPart = ''
    ] =
        normalized.split('.');

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

function normalizeRiskScore(
    score
) {

    const numeric =
        Number(score);

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        return 0;
    }

    return Math.min(
        DEFAULTS.maxRiskScore,
        Math.max(
            0,
            numeric
        )
    );
}

class CallbackIntelligenceService {

    constructor({

        warehouse,

        analytics,

        featureStore,

        fraudEngine,

        predictionEngine,

        providerLearning,

        optimizationEngine,

        executiveBI,

        regulatoryEngine,

        learningEngine,

        auditService,

        eventBus,

        outboxService,

        eventPublisher,

        logger,

        metrics,

        tracer,

        tenantResolver,

        clock = Date,

        amountScale =
            process.env.AIRTEL_CALLBACK_INTELLIGENCE_AMOUNT_SCALE ||
            DEFAULTS.amountScale,

        defaultCurrency =
            process.env.AIRTEL_CALLBACK_INTELLIGENCE_CURRENCY ||
            DEFAULTS.defaultCurrency,

        maxFeatureKeys =
            DEFAULTS.maxFeatureKeys,

        maxMetadataKeys =
            DEFAULTS.maxMetadataKeys,

        maxArrayItems =
            DEFAULTS.maxArrayItems,

        maxCallbackPayloadKeys =
            DEFAULTS.maxCallbackPayloadKeys

    } = {}) {

        this.warehouse =
            warehouse;

        this.analytics =
            analytics;

        this.featureStore =
            featureStore;

        this.fraudEngine =
            fraudEngine;

        this.predictionEngine =
            predictionEngine;

        this.providerLearning =
            providerLearning;

        this.optimizationEngine =
            optimizationEngine;

        this.executiveBI =
            executiveBI;

        this.regulatoryEngine =
            regulatoryEngine;

        this.learningEngine =
            learningEngine;

        this.auditService =
            auditService;

        this.eventBus =
            eventBus;

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
                defaultCurrency
            );

        this.maxFeatureKeys =
            this.normalizeLimit(
                maxFeatureKeys,
                DEFAULTS.maxFeatureKeys
            );

        this.maxMetadataKeys =
            this.normalizeLimit(
                maxMetadataKeys,
                DEFAULTS.maxMetadataKeys
            );

        this.maxArrayItems =
            this.normalizeLimit(
                maxArrayItems,
                DEFAULTS.maxArrayItems
            );

        this.maxCallbackPayloadKeys =
            this.normalizeLimit(
                maxCallbackPayloadKeys,
                DEFAULTS.maxCallbackPayloadKeys
            );

        this.startedAt =
            this.now();

        this.initialized =
            false;

        this.healthState = {

            status:
                SERVICE_STATUS.INITIALIZING,

            lastActivity:
                null,

            lastError:
                null

        };

        this.statistics = {

            eventsProcessed:
                0,

            eventsStored:
                0,

            storageFailures:
                0,

            predictionsGenerated:
                0,

            fraudEvaluations:
                0,

            optimizations:
                0,

            featuresGenerated:
                0,

            providerLearningEvents:
                0,

            feedbackEvents:
                0,

            regulatoryReports:
                0,

            dataQualityIssues:
                0,

            failures:
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
            SERVICE_STATUS.READY;

        this.logger?.info?.({

            provider:
                PROVIDER,

            component:
                COMPONENT,

            message:
                'Airtel callback intelligence service initialized'

        });

        this.metrics?.counter?.(
            'airtel_callback_intelligence_service_initialized_total',
            1
        );

        return true;
    }

    /**
     * =========================================================================
     * Store Callback Event
     * =========================================================================
     */

    async storeCallbackEvent({

        callback,

        context = {},

        correlation = null,

        security = null,

        tenantId = null,

        correlationId = null,

        executionId = null,

        eventId =
            crypto.randomUUID(),

        timestamp = null,

        metadata = {},

        verified =
            security?.signatureVerified ??
            security?.verified ??
            false

    } = {}) {

        const resolvedTenantId =
            requireTenantId(
                tenantId ||
                context?.tenantId ||
                context?.tenant?.id ||
                context?.tenant?.tenantId
            );

        const resolvedCorrelationId =
            normalizeIdentifier(
                correlationId ||
                context?.correlationId ||
                correlation?.correlationId ||
                crypto.randomUUID(),
                'correlationId'
            );

        const normalizedTimestamp =
            normalizeDate(
                timestamp ||
                context?.timestamp ||
                new Date(),
                'timestamp'
            );

        const safeCallback =
            this.projectCallback(
                callback
            );

        const safeSecurity =
            this.projectSecurity(
                security
            );

        const safeCorrelation =
            sanitizeValue(
                correlation
            );

        const event = {

            eventId:
                normalizeIdentifier(
                    eventId,
                    'eventId'
                ),

            provider:
                PROVIDER,

            component:
                COMPONENT,

            version:
                VERSION,

            tenantId:
                resolvedTenantId,

            correlationId:
                resolvedCorrelationId,

            executionId:
                executionId
                    ? String(executionId)
                    : undefined,

            callback:
                safeCallback,

            correlation:
                safeCorrelation,

            security:
                safeSecurity,

            metadata:
                this.sanitizeMetadata(
                    metadata
                ),

            signatureVerified:
                Boolean(
                    verified
                ),

            timestamp:
                normalizedTimestamp

        };

        const serializedSize =
            this.estimateSerializedSize(
                event
            );

        if (
            serializedSize >
            DEFAULTS.maxProviderEventSize
        ) {

            throw this.createError(
                'Callback intelligence event exceeds maximum supported size',
                'AIRTEL_CALLBACK_INTELLIGENCE_EVENT_TOO_LARGE'
            );
        }

        try {

            if (
                !verified
            ) {

                /*
                 * Unverified callbacks can be analyzed only if the caller
                 * explicitly permits such operation. They are never promoted
                 * to trusted financial evidence here.
                 */
                event.security =
                    {
                        ...event.security,

                        trustLevel:
                            'UNVERIFIED'

                    };
            } else {

                event.security =
                    {
                        ...event.security,

                        trustLevel:
                            'VERIFIED'

                    };
            }

            await this.persistCallbackEvent(
                event
            );

            this.statistics.eventsProcessed++;
            this.statistics.eventsStored++;

            this.touchActivity();

            this.metrics?.counter?.(
                'airtel_callback_events_stored_total',
                1
            );

            await this.recordAuditSafe({

                action:
                    'AIRTEL_CALLBACK_INTELLIGENCE_EVENT_STORED',

                tenantId:
                    resolvedTenantId,

                eventId:
                    event.eventId,

                correlationId:
                    resolvedCorrelationId,

                executionId,

                signatureVerified:
                    Boolean(
                        verified
                    )

            });

            return event;

        } catch (error) {

            this.statistics.storageFailures++;
            this.statistics.failures++;

            this.setHealthError(
                error
            );

            this.metrics?.counter?.(
                'airtel_callback_intelligence_storage_failure_total',
                1
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * Persist Callback Event
     * =========================================================================
     */

    async persistCallbackEvent(
        event
    ) {

        if (
            !this.warehouse
        ) {

            throw this.createError(
                'Callback intelligence warehouse is not configured',
                'AIRTEL_CALLBACK_INTELLIGENCE_WAREHOUSE_REQUIRED'
            );
        }

        if (
            typeof this.warehouse.insertForTenant ===
            'function'
        ) {

            return this.warehouse.insertForTenant(

                event.tenantId,

                event

            );
        }

        if (
            typeof this.warehouse.insert ===
            'function'
        ) {

            return this.warehouse.insert(
                event
            );
        }

        if (
            typeof this.warehouse.save ===
            'function'
        ) {

            return this.warehouse.save(
                event
            );
        }

        throw this.createError(
            'Callback intelligence warehouse does not expose a persistence operation',
            'AIRTEL_CALLBACK_INTELLIGENCE_WAREHOUSE_INVALID'
        );
    }

    /**
     * =========================================================================
     * Process Intelligence Event
     * =========================================================================
     */

    async processEvent({

        event,

        tenantId = event?.tenantId,

        correlationId =
            event?.correlationId ||
            crypto.randomUUID(),

        executionId =
            event?.executionId ||
            crypto.randomUUID()

    } = {}) {

        const resolvedTenantId =
            requireTenantId(
                tenantId
            );

        const span =
            this.startSpan(
                'airtel.callback.analytics',
                {
                    tenantId:
                        resolvedTenantId,

                    correlationId,

                    executionId

                }
            );

        try {

            const safeEvent =
                this.projectIntelligenceEvent(
                    event
                );

            let analyticsResult =
                null;

            if (
                this.analytics &&
                typeof this.analytics.analyze ===
                'function'
            ) {

                analyticsResult =
                    await this.analytics.analyze({

                        event:
                            safeEvent,

                        tenantId:
                            resolvedTenantId,

                        correlationId,

                        executionId

                    });
            }

            const features =
                await this.generateFeaturesFromEvent({

                    event:
                        safeEvent,

                    analytics:
                        analyticsResult,

                    tenantId:
                        resolvedTenantId,

                    correlationId,

                    executionId

                });

            this.touchActivity();

            return {

                tenantId:
                    resolvedTenantId,

                provider:
                    PROVIDER,

                correlationId,

                executionId,

                analytics:
                    sanitizeValue(
                        analyticsResult
                    ),

                features:
                    sanitizeValue(
                        features
                    )

            };

        } catch (error) {

            this.statistics.failures++;

            this.setHealthError(
                error
            );

            throw error;

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Generate Features
     * =========================================================================
     */

    async generateFeatures({

        event,

        tenantId =
            event?.tenantId,

        correlationId =
            event?.correlationId ||
            crypto.randomUUID(),

        executionId =
            event?.executionId ||
            crypto.randomUUID()

    } = {}) {

        return this.generateFeaturesFromEvent({

            event,

            analytics:
                null,

            tenantId,

            correlationId,

            executionId

        });
    }

    async generateFeaturesFromEvent({

        event,

        analytics = null,

        tenantId,

        correlationId,

        executionId

    }) {

        const resolvedTenantId =
            requireTenantId(
                tenantId
            );

        const callback =
            event?.callback ||
            {};

        const amount =
            normalizeAmount(
                callback.amount
            );

        const amountMinor =
            amount !== null
                ? decimalToMinorUnits(
                    amount,
                    this.amountScale
                )
                : null;

        const occurredAt =
            event?.timestamp ||
            callback.occurredAt ||
            callback.createdAt ||
            this.now();

        const date =
            normalizeDate(
                occurredAt,
                'callback timestamp'
            );

        const retryCount =
            this.normalizeNonNegativeInteger(
                event?.retryCount ||
                callback.retryCount ||
                0
            );

        const duration =
            this.normalizeNonNegativeInteger(
                event?.duration ||
                callback.duration ||
                0
            );

        const riskScore =
            normalizeRiskScore(
                event?.security?.riskScore ??
                callback.riskScore ??
                0
            );

        const features = {

            provider:
                PROVIDER,

            tenantId:
                resolvedTenantId,

            amount,

            amountMinor:
                amountMinor !== null
                    ? amountMinor.toString()
                    : null,

            currency:
                normalizeCurrency(
                    callback.currency ||
                    event?.currency
                ),

            processingTimeMs:
                duration,

            retryCount,

            fraudScore:
                riskScore,

            hour:
                date.getUTCHours(),

            dayOfWeek:
                date.getUTCDay(),

            hasProviderReference:
                Boolean(
                    callback.providerReference ||
                    callback.transactionReference
                ),

            hasTransactionReference:
                Boolean(
                    callback.reference ||
                    callback.transactionReference
                ),

            signatureVerified:
                Boolean(
                    event?.signatureVerified
                ),

            trustLevel:
                event?.security?.trustLevel ||
                'UNKNOWN'

        };

        if (
            analytics &&
            typeof analytics === 'object'
        ) {

            features.analyticsSignalCount =
                Object.keys(
                    analytics
                ).length;
        }

        if (
            this.featureStore
        ) {

            let externalFeatures = null;

            if (
                typeof this.featureStore.save ===
                'function'
            ) {

                externalFeatures =
                    await this.featureStore.save({

                        id:
                            event?.eventId ||
                            correlationId,

                        tenantId:
                            resolvedTenantId,

                        correlationId,

                        executionId,

                        features:
                            sanitizeValue(
                                features
                            )

                    });

            } else if (
                typeof this.featureStore.createFeatures ===
                'function'
            ) {

                externalFeatures =
                    await this.featureStore.createFeatures({

                        event:
                            this.projectIntelligenceEvent(
                                event
                            ),

                        analytics:
                            sanitizeValue(
                                analytics
                            ),

                        tenantId:
                            resolvedTenantId,

                        correlationId,

                        executionId

                    });
            }

            if (
                externalFeatures &&
                typeof externalFeatures === 'object'
            ) {

                Object.assign(
                    features,
                    Object.fromEntries(
                        Object.entries(
                            sanitizeValue(
                                externalFeatures
                            )
                        )
                            .slice(
                                0,
                                this.maxFeatureKeys
                            )
                    )
                );
            }
        }

        this.statistics.featuresGenerated +=
            Object.keys(
                features
            ).length;

        this.metrics?.counter?.(
            'airtel_callback_intelligence_features_generated_total',
            1
        );

        return Object.fromEntries(
            Object.entries(
                features
            ).slice(
                0,
                this.maxFeatureKeys
            )
        );
    }

    /**
     * =========================================================================
     * Fraud Intelligence Prediction
     * =========================================================================
     */

    async evaluateFraudPrediction({

        event,

        features = event?.features,

        tenantId =
            event?.tenantId,

        correlationId =
            event?.correlationId ||
            crypto.randomUUID(),

        executionId =
            event?.executionId ||
            crypto.randomUUID()

    } = {}) {

        const resolvedTenantId =
            requireTenantId(
                tenantId
            );

        if (
            !this.fraudEngine ||
            typeof this.fraudEngine.predict !==
            'function'
        ) {

            return {

                available:
                    false,

                decision:
                    FRAUD_DECISION.REVIEW,

                score:
                    null,

                reason:
                    'FRAUD_ENGINE_UNAVAILABLE'

            };
        }

        const result =
            await this.fraudEngine.predict({

                features:
                    sanitizeValue(
                        features || {}
                    ),

                tenantId:
                    resolvedTenantId,

                correlationId,

                executionId

            });

        this.statistics.fraudEvaluations++;

        const score =
            normalizeRiskScore(
                result?.score
            );

        let decision =
            result?.decision ||
            result?.action;

        if (
            !decision
        ) {

            /*
             * The AI layer reports the model signal but does not independently
             * issue a financial block. HIGH/CRITICAL risk is surfaced as a
             * recommendation for downstream policy.
             */
            decision =
                score >= 80
                    ? FRAUD_DECISION.BLOCK_RECOMMENDATION
                    : FRAUD_DECISION.ALLOW;
        }

        const response = {

            available:
                true,

            score,

            decision:
                String(
                    decision
                )
                    .trim()
                    .toUpperCase(),

            modelVersion:
                truncate(
                    result?.modelVersion,
                    128
                ),

            reason:
                truncate(
                    result?.reason,
                    MAX_REASON_LENGTH
                ),

            reasons:
                Array.isArray(
                    result?.reasons
                )
                    ? result.reasons
                        .slice(
                            0,
                            25
                        )
                        .map(
                            reason =>
                                truncate(
                                    reason
                                )
                        )
                    : []

        };

        this.metrics?.counter?.(
            'airtel_callback_intelligence_fraud_evaluation_total',
            1
        );

        return response;
    }

    /**
     * =========================================================================
     * Predict Callback Failure
     * =========================================================================
     */

    async predictFailure({

        features,

        tenantId = null,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID()

    } = {}) {

        if (
            !this.predictionEngine ||
            typeof this.predictionEngine.predict !==
            'function'
        ) {

            return {

                available:
                    false,

                failureProbability:
                    null,

                risk:
                    'UNKNOWN',

                recommendedAction:
                    'REVIEW'

            };
        }

        const prediction =
            await this.predictionEngine.predict({

                features:
                    sanitizeValue(
                        features || {}
                    ),

                tenantId,

                correlationId,

                executionId

            });

        this.statistics.predictionsGenerated++;

        const response = {

            available:
                true,

            failureProbability:
                this.normalizeProbability(
                    prediction?.probability ??
                    prediction?.failureProbability
                ),

            risk:
                truncate(
                    prediction?.risk,
                    128
                ),

            recommendedAction:
                truncate(
                    prediction?.action ??
                    prediction?.recommendedAction ??
                    'REVIEW',
                    128
                ),

            modelVersion:
                truncate(
                    prediction?.modelVersion,
                    128
                )

        };

        this.metrics?.counter?.(
            'airtel_callback_intelligence_failure_prediction_total',
            1
        );

        return response;
    }

    /**
     * =========================================================================
     * Provider Behaviour Learning
     * =========================================================================
     */

    async learnProviderBehavior({

        event,

        tenantId =
            event?.tenantId,

        correlationId =
            event?.correlationId ||
            crypto.randomUUID(),

        executionId =
            event?.executionId ||
            crypto.randomUUID()

    } = {}) {

        if (
            !this.providerLearning ||
            typeof this.providerLearning.learn !==
            'function'
        ) {

            return null;
        }

        const resolvedTenantId =
            requireTenantId(
                tenantId
            );

        const result =
            await this.providerLearning.learn({

                provider:
                    PROVIDER,

                tenantId:
                    resolvedTenantId,

                event:
                    this.projectIntelligenceEvent(
                        event
                    ),

                correlationId,

                executionId

            });

        this.statistics.providerLearningEvents++;

        this.metrics?.counter?.(
            'airtel_callback_intelligence_provider_learning_total',
            1
        );

        return sanitizeValue(
            result
        );
    }

    /**
     * =========================================================================
     * Optimize Operations
     * =========================================================================
     */

    async optimizeOperations({

        analytics,

        tenantId = null,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID()

    } = {}) {

        if (
            !this.optimizationEngine ||
            typeof this.optimizationEngine.optimize !==
            'function'
        ) {

            return null;
        }

        const result =
            await this.optimizationEngine.optimize({

                provider:
                    PROVIDER,

                tenantId,

                analytics:
                    sanitizeValue(
                        analytics
                    ),

                correlationId,

                executionId

            });

        this.statistics.optimizations++;

        this.metrics?.counter?.(
            'airtel_callback_intelligence_optimization_total',
            1
        );

        return sanitizeValue(
            result
        );
    }

    /**
     * =========================================================================
     * Executive Intelligence Dashboard
     * =========================================================================
     */

    async executiveDashboard({

        tenantId,

        period = null,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        const resolvedTenantId =
            requireTenantId(
                tenantId
            );

        if (
            !this.executiveBI ||
            typeof this.executiveBI.generate !==
            'function'
        ) {

            return null;
        }

        return this.executiveBI.generate({

            provider:
                PROVIDER,

            tenantId:
                resolvedTenantId,

            period,

            statistics:
                this.stats(),

            correlationId

        });
    }

    /**
     * =========================================================================
     * Regulatory Intelligence Hook
     * =========================================================================
     *
     * This function prepares a regulatory reporting request. It deliberately
     * does NOT assert that the tenant or provider is compliant.
     */

    async regulatoryReport({

        tenantId = null,

        period,

        data = {},

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID()

    } = {}) {

        const resolvedTenantId =
            tenantId
                ? requireTenantId(
                    tenantId
                )
                : null;

        if (
            !this.regulatoryEngine ||
            typeof this.regulatoryEngine.generate !==
            'function'
        ) {

            return null;
        }

        const result =
            await this.regulatoryEngine.generate({

                provider:
                    PROVIDER,

                tenantId:
                    resolvedTenantId,

                period,

                data:
                    sanitizeValue(
                        data
                    ),

                correlationId,

                executionId

            });

        this.statistics.regulatoryReports++;

        return sanitizeValue(
            result
        );
    }

    /**
     * =========================================================================
     * Continuous Learning
     * =========================================================================
     */

    async learn({

        outcome,

        prediction,

        actual,

        tenantId = null,

        recommendationId = null,

        decisionId = null,

        correlationId =
            crypto.randomUUID(),

        executionId =
            crypto.randomUUID(),

        metadata = {}

    } = {}) {

        if (
            !this.learningEngine ||
            typeof this.learningEngine.train !==
            'function'
        ) {

            return {

                accepted:
                    false,

                reason:
                    'LEARNING_ENGINE_UNAVAILABLE'

            };
        }

        const result =
            await this.learningEngine.train({

                model:
                    'AIRTEL_CALLBACK_INTELLIGENCE',

                provider:
                    PROVIDER,

                tenantId,

                recommendationId,

                decisionId,

                correlationId,

                executionId,

                outcome:
                    sanitizeValue(
                        outcome
                    ),

                prediction:
                    sanitizeValue(
                        prediction
                    ),

                actual:
                    sanitizeValue(
                        actual
                    ),

                metadata:
                    this.sanitizeMetadata(
                        metadata
                    )

            });

        this.statistics.feedbackEvents++;

        await this.recordAuditSafe({

            action:
                'AIRTEL_CALLBACK_INTELLIGENCE_LEARNING_FEEDBACK',

            tenantId,

            recommendationId,

            decisionId,

            correlationId,

            executionId

        });

        return {

            accepted:
                true,

            result:
                sanitizeValue(
                    result
                ),

            recordedAt:
                this.now()

        };
    }

    /**
     * =========================================================================
     * Composite Intelligence Workflow
     * =========================================================================
     *
     * Provides a single orchestration method while keeping every intelligence
     * stage separately callable and independently observable.
     */

    async analyzeEvent({

        event,

        tenantId =
            event?.tenantId,

        correlationId =
            event?.correlationId ||
            crypto.randomUUID(),

        executionId =
            event?.executionId ||
            crypto.randomUUID()

    } = {}) {

        const resolvedTenantId =
            requireTenantId(
                tenantId
            );

        const span =
            this.startSpan(
                'airtel.callback.intelligence.analyze',
                {
                    tenantId:
                        resolvedTenantId,

                    correlationId,

                    executionId
                }
            );

        try {

            const processed =
                await this.processEvent({

                    event,

                    tenantId:
                        resolvedTenantId,

                    correlationId,

                    executionId

                });

            const fraud =
                await this.evaluateFraudPrediction({

                    event,

                    features:
                        processed.features,

                    tenantId:
                        resolvedTenantId,

                    correlationId,

                    executionId

                });

            const prediction =
                await this.predictFailure({

                    features:
                        processed.features,

                    tenantId:
                        resolvedTenantId,

                    correlationId,

                    executionId

                });

            const providerLearning =
                await this.learnProviderBehavior({

                    event,

                    tenantId:
                        resolvedTenantId,

                    correlationId,

                    executionId

                });

            return {

                provider:
                    PROVIDER,

                tenantId:
                    resolvedTenantId,

                correlationId,

                executionId,

                analytics:
                    processed.analytics,

                features:
                    processed.features,

                fraud,

                failurePrediction:
                    prediction,

                providerLearning:
                    sanitizeValue(
                        providerLearning
                    ),

                advisoryOnly:
                    true,

                analyzedAt:
                    this.now()

            };

        } finally {

            span?.end?.();
        }
    }

    /**
     * =========================================================================
     * Safe Callback Projection
     * =========================================================================
     */

    projectCallback(
        callback
    ) {

        if (
            callback === null ||
            callback === undefined
        ) {
            return {};
        }

        if (
            typeof callback !== 'object'
        ) {

            return {

                value:
                    truncate(
                        callback
                    )

            };
        }

        /*
         * This is intentionally an allow-list projection rather than simply
         * sanitizing the entire provider payload.
         */
        const projected = {

            reference:
                callback.reference,

            providerReference:
                callback.providerReference,

            transactionReference:
                callback.transactionReference,

            transactionId:
                callback.transactionId,

            providerTransactionId:
                callback.providerTransactionId,

            status:
                callback.status,

            state:
                callback.state,

            amount:
                callback.amount !== undefined
                    ? String(
                        callback.amount
                    )
                    : undefined,

            currency:
                callback.currency,

            transactionType:
                callback.transactionType,

            settlementReference:
                callback.settlementReference,

            fee:
                callback.fee !== undefined
                    ? String(
                        callback.fee
                    )
                    : undefined,

            occurredAt:
                callback.occurredAt,

            createdAt:
                callback.createdAt,

            processedAt:
                callback.processedAt,

            retryCount:
                callback.retryCount,

            duration:
                callback.duration

        };

        return sanitizeValue(
            projected
        );
    }

    projectSecurity(
        security
    ) {

        if (
            !security ||
            typeof security !== 'object'
        ) {

            return {

                trustLevel:
                    'UNKNOWN'

            };
        }

        return sanitizeValue({

            signatureVerified:
                Boolean(
                    security.signatureVerified ??
                    security.verified
                ),

            trustLevel:
                security.signatureVerified ??
                security.verified
                    ? 'VERIFIED'
                    : 'UNVERIFIED',

            riskScore:
                normalizeRiskScore(
                    security.riskScore
                ),

            replayDetected:
                Boolean(
                    security.replayDetected
                ),

            idempotencyChecked:
                Boolean(
                    security.idempotencyChecked
                )

        });
    }

    projectIntelligenceEvent(
        event
    ) {

        if (
            !event ||
            typeof event !== 'object'
        ) {
            return {};
        }

        return sanitizeValue({

            eventId:
                event.eventId,

            provider:
                PROVIDER,

            tenantId:
                event.tenantId,

            correlationId:
                event.correlationId,

            executionId:
                event.executionId,

            callback:
                this.projectCallback(
                    event.callback
                ),

            security:
                this.projectSecurity(
                    event.security
                ),

            timestamp:
                event.timestamp,

            retryCount:
                event.retryCount,

            duration:
                event.duration,

            metadata:
                this.sanitizeMetadata(
                    event.metadata
                )

        });
    }

    /**
     * =========================================================================
     * Metadata
     * =========================================================================
     */

    sanitizeMetadata(
        metadata
    ) {

        if (
            !metadata ||
            typeof metadata !== 'object' ||
            Array.isArray(metadata)
        ) {
            return {};
        }

        return Object.fromEntries(
            Object.entries(
                sanitizeValue(
                    metadata
                )
            )
                .slice(
                    0,
                    this.maxMetadataKeys
                )
        );
    }

    /**
     * =========================================================================
     * Metrics Helpers
     * =========================================================================
     */

    calculateRate(
        value,
        total
    ) {

        const normalizedTotal =
            Number(total);

        const normalizedValue =
            Number(value);

        if (
            !Number.isFinite(
                normalizedTotal
            ) ||
            normalizedTotal <= 0 ||
            !Number.isFinite(
                normalizedValue
            )
        ) {
            return 0;
        }

        return Number(
            Math.min(
                100,
                Math.max(
                    0,
                    (
                        normalizedValue /
                        normalizedTotal
                    ) * 100
                )
            ).toFixed(2)
        );
    }

    normalizeProbability(
        probability
    ) {

        const numeric =
            Number(
                probability
            );

        if (
            !Number.isFinite(
                numeric
            )
        ) {
            return null;
        }

        /*
         * Support either a 0..1 probability or a 0..100 percentage while
         * normalizing the returned value to 0..1.
         */
        if (
            numeric > 1 &&
            numeric <= 100
        ) {

            return Number(
                (
                    numeric /
                    100
                ).toFixed(4)
            );
        }

        return Number(
            Math.min(
                1,
                Math.max(
                    0,
                    numeric
                )
            ).toFixed(4)
        );
    }

    normalizeNonNegativeInteger(
        value
    ) {

        const numeric =
            Number(
                value
            );

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

    normalizeLimit(
        value,
        fallback
    ) {

        const numeric =
            Number(
                value
            );

        if (
            !Number.isFinite(
                numeric
            ) ||
            numeric <= 0
        ) {
            return fallback;
        }

        return Math.floor(
            numeric
        );
    }

    normalizeAmountScale(
        value
    ) {

        const numeric =
            Number(
                value
            );

        if (
            !Number.isInteger(
                numeric
            ) ||
            numeric < 0 ||
            numeric > 9
        ) {

            return DEFAULTS.amountScale;
        }

        return numeric;
    }

    /**
     * =========================================================================
     * Size Guard
     * =========================================================================
     */

    estimateSerializedSize(
        value
    ) {

        try {

            return Buffer
                .byteLength(
                    JSON.stringify(
                        value
                    ) || '',
                    'utf8'
                );

        } catch {

            return Number.MAX_SAFE_INTEGER;
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

            this.statistics.auditFailures++;

            this.logger?.warn?.({

                provider:
                    PROVIDER,

                component:
                    COMPONENT,

                message:
                    'Failed to record Airtel callback intelligence audit',

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
                    'Failed to publish Airtel callback intelligence event',

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

        const dependencies = {

            warehouse:
                Boolean(
                    this.warehouse &&
                    (
                        typeof this.warehouse.insert ===
                            'function' ||
                        typeof this.warehouse.insertForTenant ===
                            'function' ||
                        typeof this.warehouse.save ===
                            'function'
                    )
                ),

            analytics:
                Boolean(
                    this.analytics &&
                    typeof this.analytics.analyze ===
                    'function'
                ),

            featureStore:
                Boolean(
                    this.featureStore
                ),

            fraudEngine:
                Boolean(
                    this.fraudEngine &&
                    typeof this.fraudEngine.predict ===
                    'function'
                ),

            predictionEngine:
                Boolean(
                    this.predictionEngine &&
                    typeof this.predictionEngine.predict ===
                    'function'
                ),

            providerLearning:
                Boolean(
                    this.providerLearning &&
                    typeof this.providerLearning.learn ===
                    'function'
                ),

            optimizationEngine:
                Boolean(
                    this.optimizationEngine &&
                    typeof this.optimizationEngine.optimize ===
                    'function'
                ),

            auditService:
                !this.auditService ||
                typeof this.auditService.record ===
                'function'

        };

        let status =
            this.healthState.status;

        if (
            !dependencies.warehouse
        ) {

            status =
                SERVICE_STATUS.FAILED;

        } else if (
            !dependencies.fraudEngine ||
            !dependencies.predictionEngine
        ) {

            status =
                SERVICE_STATUS.DEGRADED;

        } else if (
            status ===
            SERVICE_STATUS.INITIALIZING
        ) {

            status =
                SERVICE_STATUS.DEGRADED;
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

            advisoryOnly:
                true,

            dependencies,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

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

            amountScale:
                this.amountScale,

            defaultCurrency:
                this.defaultCurrency,

            maxFeatureKeys:
                this.maxFeatureKeys,

            maxMetadataKeys:
                this.maxMetadataKeys,

            maxArrayItems:
                this.maxArrayItems,

            maxCallbackPayloadKeys:
                this.maxCallbackPayloadKeys,

            advisoryOnly:
                true

        };
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

                advisoryOnly:
                    true,

                paymentExecution:
                    false,

                ledgerMutation:
                    false,

                autonomousFraudBlocking:
                    false,

                autonomousRepair:
                    false

            },

            configuration: {

                amountScale:
                    this.amountScale,

                defaultCurrency:
                    this.defaultCurrency,

                maxFeatureKeys:
                    this.maxFeatureKeys,

                maxMetadataKeys:
                    this.maxMetadataKeys,

                maxArrayItems:
                    this.maxArrayItems,

                maxCallbackPayloadKeys:
                    this.maxCallbackPayloadKeys

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
     * Activity / Error State
     * =========================================================================
     */

    touchActivity() {

        this.healthState.lastActivity =
            this.now();
    }

    setHealthError(
        error
    ) {

        this.healthState.status =
            SERVICE_STATUS.DEGRADED;

        this.healthState.lastError =
            safeError(
                error
            );
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
                        String(
                            value
                        )
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
            !this.warehouse
        ) {

            throw this.createError(
                'Callback intelligence warehouse dependency missing',
                'AIRTEL_CALLBACK_INTELLIGENCE_WAREHOUSE_REQUIRED'
            );
        }

        const hasPersistence =
            typeof this.warehouse.insertForTenant ===
                'function' ||
            typeof this.warehouse.insert ===
                'function' ||
            typeof this.warehouse.save ===
                'function';

        if (
            !hasPersistence
        ) {

            throw this.createError(
                'Callback intelligence warehouse persistence operation missing',
                'AIRTEL_CALLBACK_INTELLIGENCE_WAREHOUSE_INVALID'
            );
        }

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
}

module.exports = CallbackIntelligenceService;

module.exports.CallbackIntelligenceService =
    CallbackIntelligenceService;

module.exports.PROVIDER =
    PROVIDER;

module.exports.COMPONENT =
    COMPONENT;

module.exports.VERSION =
    VERSION;

module.exports.SERVICE_STATUS =
    SERVICE_STATUS;

module.exports.FRAUD_DECISION =
    FRAUD_DECISION;

module.exports.DATA_QUALITY_STATUS =
    DATA_QUALITY_STATUS;

module.exports.decimalToMinorUnits =
    decimalToMinorUnits;