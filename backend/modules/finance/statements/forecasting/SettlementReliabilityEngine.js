'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * SettlementReliabilityEngine
 * ============================================================================
 *
 * Enterprise Settlement Reliability Intelligence Engine
 *
 * Location:
 *   backend/modules/finance/statements/forecasting/SettlementReliabilityEngine.js
 *
 * Purpose:
 *   Measure, score, classify, and forecast settlement reliability using
 *   historical settlement events.
 *
 * Primary responsibilities:
 *
 *   1. Settlement success-rate analysis
 *   2. Settlement failure-rate analysis
 *   3. Settlement latency analysis
 *   4. Settlement amount-variance analysis
 *   5. Reconciliation reliability analysis
 *   6. Provider reliability scoring
 *   7. Provider comparative ranking
 *   8. Reliability trend detection
 *   9. Reliability forecasting
 *  10. Operational risk classification
 *  11. Capacity / SLA risk analysis
 *  12. Explainable recommendations
 *
 * Architectural position:
 *
 *                    Statement Import
 *                           |
 *                           v
 *                    Reconciliation
 *                           |
 *                           v
 *                    Settlement Matching
 *                           |
 *                           v
 *                +------------------------+
 *                | SettlementReliability  |
 *                |       Engine           |
 *                +------------------------+
 *                    |       |       |
 *                    v       v       v
 *                Reliability Risk  Forecast
 *                    |       |       |
 *                    +-------+-------+
 *                            |
 *                            v
 *                 Operational Intelligence
 *
 * IMPORTANT:
 *
 * This engine is analytical only.
 *
 * It MUST NOT:
 *   - mutate settlement records
 *   - post ledger entries
 *   - execute provider payments
 *   - retry settlements
 *   - automatically switch providers
 *   - repair financial transactions
 *
 * Those responsibilities belong to transactional/orchestration services.
 *
 * Expected provider contract:
 *
 *   async getSettlementHistory({
 *       tenantId,
 *       startDate,
 *       endDate,
 *       provider,
 *       limit
 *   })
 *
 * Supported alternative methods:
 *
 *   getSettlementHistory()
 *   findSettlementHistory()
 *   listSettlements()
 *
 * Expected settlement record examples:
 *
 *   {
 *       tenantId: 'tenant-1',
 *       provider: 'MTN_MOMO',
 *       status: 'SUCCESS',
 *       initiatedAt: Date,
 *       completedAt: Date,
 *       expectedAmount: 100000,
 *       settledAmount: 100000,
 *       reconciled: true
 *   }
 *
 * or:
 *
 *   {
 *       provider: 'AIRTEL_MONEY',
 *       status: 'FAILED',
 *       createdAt: Date,
 *       updatedAt: Date,
 *       amount: 50000,
 *       settlementAmount: 0,
 *       reconciliationStatus: 'UNMATCHED'
 *   }
 *
 * ============================================================================
 */

const ENGINE_NAME =
    'SettlementReliabilityEngine';

const ENGINE_VERSION =
    '1.0.0';

/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULTS = Object.freeze({

    historicalDays: 180,

    minimumHistoryDays: 14,

    minimumObservations: 10,

    forecastHorizonDays: 30,

    movingAverageWindow: 14,

    ewmaAlpha: 0.35,

    /*
     * Reliability score weights.
     *
     * These deliberately sum to 1.
     */
    reliabilityWeights: Object.freeze({
        successRate: 0.30,
        failureRate: 0.15,
        latency: 0.15,
        variance: 0.15,
        reconciliation: 0.15,
        consistency: 0.10
    }),

    /*
     * Reliability thresholds.
     */
    thresholds: Object.freeze({

        excellent: 0.95,

        good: 0.85,

        acceptable: 0.70,

        poor: 0.50,

        critical: 0.30
    }),

    /*
     * Failure statuses.
     */
    failureStatuses: Object.freeze([
        'FAILED',
        'FAILURE',
        'ERROR',
        'REJECTED',
        'DECLINED',
        'TIMEOUT',
        'CANCELLED'
    ]),

    successStatuses: Object.freeze([
        'SUCCESS',
        'SUCCEEDED',
        'COMPLETED',
        'SETTLED',
        'POSTED'
    ]),

    pendingStatuses: Object.freeze([
        'PENDING',
        'PROCESSING',
        'INITIATED',
        'QUEUED',
        'IN_PROGRESS'
    ]),

    /*
     * Latency thresholds in milliseconds.
     */
    latency: Object.freeze({

        excellentMs: 60 * 1000,

        goodMs: 5 * 60 * 1000,

        acceptableMs: 15 * 60 * 1000,

        poorMs: 60 * 60 * 1000,

        criticalMs: 24 * 60 * 60 * 1000
    }),

    /*
     * Amount variance tolerance.
     *
     * Example:
     * 0.001 = 0.1%
     */
    amountVarianceTolerance: 0.001,

    /*
     * SLA target.
     */
    defaultSlaMs:
        15 * 60 * 1000,

    /*
     * Outlier protection.
     */
    outlierMultiplier: 5,

    /*
     * Numeric stability.
     */
    epsilon: 0.000001,

    /*
     * Operational limits.
     */
    maxHistoryRecords: 100000,

    maxProviders: 1000,

    maxForecastDays: 365,

    timezone: 'UTC'
});

/**
 * ============================================================================
 * Reliability classifications
 * ============================================================================
 */

const RELIABILITY_LEVEL = Object.freeze({

    EXCELLENT: 'EXCELLENT',

    GOOD: 'GOOD',

    ACCEPTABLE: 'ACCEPTABLE',

    POOR: 'POOR',

    CRITICAL: 'CRITICAL',

    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA'
});

/**
 * ============================================================================
 * Settlement status
 * ============================================================================
 */

const SETTLEMENT_STATUS = Object.freeze({

    SUCCESS: 'SUCCESS',

    FAILED: 'FAILED',

    PENDING: 'PENDING',

    UNKNOWN: 'UNKNOWN'
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isFiniteNumber(value) {

    return Number.isFinite(
        Number(value)
    );
}

function toNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function clamp(
    value,
    min,
    max
) {

    return Math.min(
        Math.max(
            value,
            min
        ),
        max
    );
}

function round(
    value,
    decimals = 4
) {

    const factor =
        Math.pow(
            10,
            decimals
        );

    return Math.round(
        (
            Number(value) +
            Number.EPSILON
        ) * factor
    ) / factor;
}

function sum(values) {

    return values.reduce(
        (total, value) =>
            total + value,
        0
    );
}

function average(values) {

    if (!values.length) {
        return 0;
    }

    return (
        sum(values) /
        values.length
    );
}

function median(values) {

    if (!values.length) {
        return 0;
    }

    const sorted =
        [...values].sort(
            (a, b) => a - b
        );

    const middle =
        Math.floor(
            sorted.length / 2
        );

    if (
        sorted.length % 2 === 0
    ) {

        return average([
            sorted[middle - 1],
            sorted[middle]
        ]);
    }

    return sorted[middle];
}

function variance(values) {

    if (values.length < 2) {
        return 0;
    }

    const mean =
        average(values);

    return (
        values.reduce(
            (total, value) =>
                total +
                Math.pow(
                    value - mean,
                    2
                ),
            0
        ) /
        (values.length - 1)
    );
}

function standardDeviation(values) {

    return Math.sqrt(
        Math.max(
            variance(values),
            0
        )
    );
}

function coefficientOfVariation(values) {

    const mean =
        average(values);

    if (
        Math.abs(mean) <
        DEFAULTS.epsilon
    ) {
        return 0;
    }

    return (
        standardDeviation(values) /
        Math.abs(mean)
    );
}

function safeDate(value) {

    if (!value) {
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

        return null;
    }

    return date;
}

function startOfUtcDay(date) {

    const result =
        new Date(date);

    result.setUTCHours(
        0,
        0,
        0,
        0
    );

    return result;
}

function addDays(
    date,
    days
) {

    const result =
        new Date(date);

    result.setUTCDate(
        result.getUTCDate() +
        days
    );

    return result;
}

function dateKey(date) {

    return startOfUtcDay(
        date
    )
        .toISOString()
        .slice(
            0,
            10
        );
}

function dayOfWeekKey(date) {

    return String(
        date.getUTCDay()
    );
}

function normalizeString(
    value,
    fallback = null
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;
    }

    const result =
        String(value).trim();

    return result.length
        ? result
        : fallback;
}

function normalizeUpperCase(
    value,
    fallback = 'UNKNOWN'
) {

    const result =
        normalizeString(
            value,
            fallback
        );

    return result
        ? result.toUpperCase()
        : fallback;
}

function createId() {

    return (
        'sre_' +
        Date.now().toString(36) +
        '_' +
        Math.random()
            .toString(36)
            .slice(2, 10)
    );
}

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class SettlementReliabilityError
    extends Error {

    constructor(
        message,
        code = 'SETTLEMENT_RELIABILITY_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'SettlementReliabilityError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            SettlementReliabilityError
        );
    }
}

/**
 * ============================================================================
 * SettlementReliabilityEngine
 * ============================================================================
 */

class SettlementReliabilityEngine {

    /**
     * ========================================================================
     * Constructor
     * ========================================================================
     */

    constructor(
        options = {}
    ) {

        this.config =
            Object.freeze({
                ...DEFAULTS,
                ...(options.config || {}),

                reliabilityWeights:
                    Object.freeze({
                        ...DEFAULTS.reliabilityWeights,
                        ...(
                            options.config
                                ?.reliabilityWeights ||
                            {}
                        )
                    }),

                thresholds:
                    Object.freeze({
                        ...DEFAULTS.thresholds,
                        ...(
                            options.config
                                ?.thresholds ||
                            {}
                        )
                    }),

                latency:
                    Object.freeze({
                        ...DEFAULTS.latency,
                        ...(
                            options.config
                                ?.latency ||
                            {}
                        )
                    })
            });

        this.dataProvider =
            options.dataProvider ||
            options.repository ||
            null;

        this.logger =
            options.logger ||
            null;

        this.metrics =
            options.metrics ||
            null;

        this.clock =
            typeof options.clock ===
            'function'
                ? options.clock
                : () => new Date();

        this.engineName =
            ENGINE_NAME;

        this.version =
            ENGINE_VERSION;
    }

    /**
     * ========================================================================
     * Primary API
     * ========================================================================
     */

    async analyze(
        options = {}
    ) {

        const startedAt =
            Date.now();

        const context =
            this._createContext(
                options
            );

        try {

            this._validateContext(
                context
            );

            const history =
                await this._loadHistory(
                    context
                );

            const normalized =
                this._normalizeHistory(
                    history,
                    context
                );

            const dataQuality =
                this._assessDataQuality(
                    normalized,
                    context
                );

            const overallMetrics =
                this._calculateMetrics(
                    normalized
                );

            const trend =
                this._calculateReliabilityTrend(
                    normalized,
                    context
                );

            const providerAnalysis =
                this._analyzeProviders(
                    normalized
                );

            const dailyReliability =
                this._buildDailyReliabilitySeries(
                    normalized,
                    context
                );

            const seasonality =
                this._calculateSeasonality(
                    dailyReliability
                );

            const forecast =
                this._forecastReliability(
                    dailyReliability,
                    trend,
                    seasonality,
                    context
                );

            const score =
                this._calculateReliabilityScore({
                    metrics:
                        overallMetrics,

                    trend,

                    dataQuality
                });

            const risk =
                this._calculateRisk({
                    metrics:
                        overallMetrics,

                    score,

                    trend,

                    dataQuality,

                    forecast
                });

            const sla =
                this._calculateSlaAnalysis(
                    normalized,
                    context
                );

            const recommendations =
                this._generateRecommendations({
                    score,

                    risk,

                    metrics:
                        overallMetrics,

                    trend,

                    dataQuality,

                    sla,

                    providerAnalysis
                });

            const result = {

                analysisId:
                    createId(),

                engine: {
                    name:
                        this.engineName,

                    version:
                        this.version
                },

                tenantId:
                    context.tenantId,

                asOf:
                    context.asOf.toISOString(),

                period: {
                    historicalDays:
                        context.historicalDays,

                    startDate:
                        context.startDate.toISOString(),

                    endDate:
                        context.asOf.toISOString(),

                    forecastDays:
                        context.forecastHorizonDays
                },

                dataQuality,

                reliability: {
                    ...score,

                    metrics:
                        overallMetrics,

                    trend,

                    seasonality
                },

                providers:
                    providerAnalysis,

                sla,

                forecast,

                risk,

                recommendations,

                explainability:
                    this._buildExplainability({
                        score,

                        metrics:
                            overallMetrics,

                        trend,

                        seasonality,

                        dataQuality,

                        risk,

                        forecast,

                        providerAnalysis
                    }),

                generatedAt:
                    this.clock()
                        .toISOString(),

                execution: {
                    durationMs:
                        Date.now() -
                        startedAt
                }
            };

            this._recordMetric(
                'settlement_reliability.analyzed',
                result
            );

            this._logInfo(
                'Settlement reliability analysis generated',
                {
                    analysisId:
                        result.analysisId,

                    tenantId:
                        context.tenantId,

                    reliabilityScore:
                        score.score,

                    reliabilityLevel:
                        score.level,

                    riskLevel:
                        risk.level,

                    durationMs:
                        result.execution
                            .durationMs
                }
            );

            return result;

        } catch (error) {

            this._recordMetric(
                'settlement_reliability.failed',
                {
                    tenantId:
                        context.tenantId,

                    errorCode:
                        error.code
                }
            );

            this._logError(
                'Settlement reliability analysis failed',
                {
                    tenantId:
                        context.tenantId,

                    error
                }
            );

            if (
                error instanceof
                SettlementReliabilityError
            ) {

                throw error;
            }

            throw new SettlementReliabilityError(
                'Unable to generate settlement reliability analysis.',
                'RELIABILITY_ANALYSIS_FAILED',
                {
                    cause:
                        error.message
                }
            );
        }
    }

    /**
     * Backward/semantic alias.
     */
    async forecast(
        options = {}
    ) {

        return this.analyze(
            options
        );
    }

    /**
     * Provider-specific analysis.
     */
    async analyzeProvider(
        options = {}
    ) {

        const result =
            await this.analyze(
                options
            );

        const provider =
            normalizeUpperCase(
                options.provider,
                null
            );

        if (!provider) {
            return result.providers;
        }

        return (
            result.providers.find(
                item =>
                    item.provider ===
                    provider
            ) || null
        );
    }

    /**
     * Provider comparison.
     */
    async compareProviders(
        options = {}
    ) {

        const result =
            await this.analyze(
                options
            );

        return {
            analysisId:
                result.analysisId,

            tenantId:
                result.tenantId,

            asOf:
                result.asOf,

            providers:
                result.providers,

            recommendation:
                this._selectPreferredProvider(
                    result.providers
                )
        };
    }

    /**
     * Reliability score only.
     */
    async getReliabilityScore(
        options = {}
    ) {

        const result =
            await this.analyze(
                options
            );

        return {
            analysisId:
                result.analysisId,

            tenantId:
                result.tenantId,

            score:
                result.reliability.score,

            level:
                result.reliability.level,

            confidence:
                result.reliability.confidence,

            risk:
                result.risk
        };
    }

    /**
     * Dashboard-oriented response.
     */
    async getDashboard(
        options = {}
    ) {

        const result =
            await this.analyze(
                options
            );

        return {

            analysisId:
                result.analysisId,

            tenantId:
                result.tenantId,

            asOf:
                result.asOf,

            summary: {

                reliabilityScore:
                    result.reliability
                        .score,

                reliabilityLevel:
                    result.reliability
                        .level,

                successRate:
                    result.reliability
                        .metrics
                        .successRate,

                failureRate:
                    result.reliability
                        .metrics
                        .failureRate,

                averageLatencyMs:
                    result.reliability
                        .metrics
                        .averageLatencyMs,

                reconciliationRate:
                    result.reliability
                        .metrics
                        .reconciliationRate,

                riskLevel:
                    result.risk.level,

                forecastedReliability:
                    result.forecast
                        .expectedScore
            },

            reliability:
                result.reliability,

            providers:
                result.providers,

            sla:
                result.sla,

            forecast:
                result.forecast,

            risk:
                result.risk,

            recommendations:
                result.recommendations,

            generatedAt:
                result.generatedAt
        };
    }

    /**
     * Health endpoint.
     */
    health() {

        return {

            healthy: true,

            engine:
                this.engineName,

            version:
                this.version,

            timestamp:
                this.clock()
                    .toISOString(),

            providerConfigured:
                Boolean(
                    this.dataProvider
                )
        };
    }

    /**
     * Metadata.
     */
    getMetadata() {

        return {

            name:
                this.engineName,

            version:
                this.version,

            capabilities: [

                'settlement_reliability_scoring',

                'provider_reliability_analysis',

                'settlement_success_analysis',

                'settlement_failure_analysis',

                'settlement_latency_analysis',

                'settlement_variance_analysis',

                'reconciliation_reliability',

                'sla_analysis',

                'reliability_forecasting',

                'trend_detection',

                'seasonality_detection',

                'risk_assessment',

                'provider_comparison',

                'explainability'
            ],

            analyticalOnly:
                true
        };
    }

    /**
     * ========================================================================
     * Context
     * ========================================================================
     */

    _createContext(
        options
    ) {

        const asOf =
            safeDate(
                options.asOf
            ) ||
            safeDate(
                this.clock()
            ) ||
            new Date();

        const historicalDays =
            this._positiveInteger(
                options.historicalDays,
                this.config.historicalDays
            );

        const forecastHorizonDays =
            this._positiveInteger(
                options.forecastHorizonDays ||
                options.horizonDays,
                this.config.forecastHorizonDays
            );

        const normalizedAsOf =
            startOfUtcDay(
                asOf
            );

        const startDate =
            addDays(
                normalizedAsOf,
                -historicalDays
            );

        return {

            tenantId:
                normalizeString(
                    options.tenantId
                ),

            provider:
                normalizeString(
                    options.provider
                )
                    ? normalizeUpperCase(
                        options.provider
                    )
                    : null,

            asOf:
                normalizedAsOf,

            startDate,

            historicalDays:
                Math.min(
                    historicalDays,
                    3650
                ),

            forecastHorizonDays:
                Math.min(
                    forecastHorizonDays,
                    this.config.maxForecastDays
                )
        };
    }

    _positiveInteger(
        value,
        fallback
    ) {

        const number =
            Number(value);

        if (
            !Number.isInteger(
                number
            ) ||
            number <= 0
        ) {

            return fallback;
        }

        return number;
    }

    _validateContext(
        context
    ) {

        if (!context.tenantId) {

            throw new SettlementReliabilityError(
                'tenantId is required.',
                'TENANT_ID_REQUIRED'
            );
        }
    }

    /**
     * ========================================================================
     * History Loading
     * ========================================================================
     */

    async _loadHistory(
        context
    ) {

        if (!this.dataProvider) {

            return [];
        }

        const request = {

            tenantId:
                context.tenantId,

            startDate:
                context.startDate,

            endDate:
                context.asOf,

            provider:
                context.provider,

            limit:
                this.config.maxHistoryRecords
        };

        let result;

        if (
            typeof this.dataProvider
                .getSettlementHistory ===
            'function'
        ) {

            result =
                await this.dataProvider
                    .getSettlementHistory(
                        request
                    );

        } else if (
            typeof this.dataProvider
                .findSettlementHistory ===
            'function'
        ) {

            result =
                await this.dataProvider
                    .findSettlementHistory(
                        request
                    );

        } else if (
            typeof this.dataProvider
                .listSettlements ===
            'function'
        ) {

            result =
                await this.dataProvider
                    .listSettlements(
                        request
                    );

        } else {

            throw new SettlementReliabilityError(
                'Configured settlement data provider does not expose a supported history method.',
                'UNSUPPORTED_DATA_PROVIDER'
            );
        }

        if (
            Array.isArray(result)
        ) {

            return result;
        }

        if (
            Array.isArray(
                result?.records
            )
        ) {

            return result.records;
        }

        if (
            Array.isArray(
                result?.items
            )
        ) {

            return result.items;
        }

        return [];
    }

    /**
     * ========================================================================
     * Normalization
     * ========================================================================
     */

    _normalizeHistory(
        history,
        context
    ) {

        if (
            !Array.isArray(history)
        ) {

            return [];
        }

        const normalized = [];

        for (
            let index = 0;
            index < history.length;
            index += 1
        ) {

            const record =
                history[index];

            if (
                !record ||
                typeof record !==
                'object'
            ) {

                continue;
            }

            const initiatedAt =
                safeDate(
                    record.initiatedAt ||
                    record.createdAt ||
                    record.requestedAt ||
                    record.startedAt ||
                    record.timestamp
                );

            const completedAt =
                safeDate(
                    record.completedAt ||
                    record.settledAt ||
                    record.updatedAt ||
                    record.finishedAt ||
                    record.completedOn
                );

            const eventDate =
                initiatedAt ||
                completedAt;

            if (!eventDate) {
                continue;
            }

            if (
                eventDate <
                context.startDate ||
                eventDate >
                context.asOf
            ) {

                continue;
            }

            const provider =
                normalizeUpperCase(
                    record.provider ||
                    record.providerCode ||
                    record.paymentProvider ||
                    record.channel
                );

            if (
                context.provider &&
                provider !==
                context.provider
            ) {

                continue;
            }

            const status =
                this._normalizeStatus(
                    record
                );

            const expectedAmount =
                this._extractAmount(
                    record,
                    [
                        'expectedAmount',
                        'requestedAmount',
                        'amount',
                        'grossAmount'
                    ]
                );

            const settledAmount =
                this._extractAmount(
                    record,
                    [
                        'settledAmount',
                        'settlementAmount',
                        'actualAmount',
                        'postedAmount',
                        'receivedAmount'
                    ]
                );

            const latencyMs =
                this._extractLatency(
                    record,
                    initiatedAt,
                    completedAt
                );

            const variance =
                this._calculateAmountVariance(
                    expectedAmount,
                    settledAmount
                );

            const reconciled =
                this._extractReconciliationState(
                    record
                );

            normalized.push({

                tenantId:
                    normalizeString(
                        record.tenantId
                    ),

                provider,

                status,

                eventDate,

                initiatedAt,

                completedAt,

                expectedAmount,

                settledAmount,

                varianceAmount:
                    variance.amount,

                varianceRatio:
                    variance.ratio,

                varianceWithinTolerance:
                    variance.withinTolerance,

                latencyMs,

                reconciled,

                transactionId:
                    normalizeString(
                        record.transactionId ||
                        record.reference ||
                        record.externalReference
                    )
            });
        }

        return normalized.filter(
            record => {

                if (
                    !record.tenantId
                ) {

                    return true;
                }

                return (
                    record.tenantId ===
                    context.tenantId
                );
            }
        );
    }

    _normalizeStatus(
        record
    ) {

        const raw =
            normalizeUpperCase(
                record.status ||
                record.settlementStatus ||
                record.state
            );

        if (
            this.config.successStatuses
                .includes(raw)
        ) {

            return SETTLEMENT_STATUS.SUCCESS;
        }

        if (
            this.config.failureStatuses
                .includes(raw)
        ) {

            return SETTLEMENT_STATUS.FAILED;
        }

        if (
            this.config.pendingStatuses
                .includes(raw)
        ) {

            return SETTLEMENT_STATUS.PENDING;
        }

        return SETTLEMENT_STATUS.UNKNOWN;
    }

    _extractAmount(
        record,
        fields
    ) {

        for (
            const field of fields
        ) {

            if (
                isFiniteNumber(
                    record[field]
                )
            ) {

                return Number(
                    record[field]
                );
            }
        }

        return null;
    }

    _extractLatency(
        record,
        initiatedAt,
        completedAt
    ) {

        if (
            isFiniteNumber(
                record.latencyMs
            )
        ) {

            return Math.max(
                0,
                Number(
                    record.latencyMs
                )
            );
        }

        if (
            isFiniteNumber(
                record.processingTimeMs
            )
        ) {

            return Math.max(
                0,
                Number(
                    record.processingTimeMs
                )
            );
        }

        if (
            initiatedAt &&
            completedAt
        ) {

            return Math.max(
                0,
                completedAt.getTime() -
                initiatedAt.getTime()
            );
        }

        return null;
    }

    _calculateAmountVariance(
        expectedAmount,
        settledAmount
    ) {

        if (
            !isFiniteNumber(
                expectedAmount
            ) ||
            !isFiniteNumber(
                settledAmount
            )
        ) {

            return {

                amount: null,

                ratio: null,

                withinTolerance: null
            };
        }

        const amount =
            settledAmount -
            expectedAmount;

        const ratio =
            Math.abs(
                expectedAmount
            ) <
            this.config.epsilon
                ? Math.abs(amount)
                : Math.abs(
                    amount /
                    expectedAmount
                );

        return {

            amount,

            ratio,

            withinTolerance:
                ratio <=
                this.config.amountVarianceTolerance
        };
    }

    _extractReconciliationState(
        record
    ) {

        if (
            typeof record.reconciled ===
            'boolean'
        ) {

            return record.reconciled;
        }

        const status =
            normalizeUpperCase(
                record.reconciliationStatus
            );

        if (
            [
                'RECONCILED',
                'MATCHED',
                'COMPLETED'
            ].includes(status)
        ) {

            return true;
        }

        if (
            [
                'UNMATCHED',
                'UNRECONCILED',
                'FAILED',
                'VARIANCE'
            ].includes(status)
        ) {

            return false;
        }

        return null;
    }

    /**
     * ========================================================================
     * Data Quality
     * ========================================================================
     */

    _assessDataQuality(
        history,
        context
    ) {

        const observations =
            history.length;

        const observationDays =
            new Set(
                history.map(
                    item =>
                        dateKey(
                            item.eventDate
                        )
                )
            ).size;

        const coverageRatio =
            context.historicalDays >
            0
                ? observationDays /
                  context.historicalDays
                : 0;

        const knownStatusRatio =
            observations
                ? history.filter(
                    item =>
                        item.status !==
                        SETTLEMENT_STATUS.UNKNOWN
                ).length /
                  observations
                : 0;

        const latencyCoverageRatio =
            observations
                ? history.filter(
                    item =>
                        item.latencyMs !==
                        null
                ).length /
                  observations
                : 0;

        const reconciliationCoverageRatio =
            observations
                ? history.filter(
                    item =>
                        item.reconciled !==
                        null
                ).length /
                  observations
                : 0;

        const observationScore =
            clamp(
                observations /
                Math.max(
                    this.config
                        .minimumObservations *
                    5,
                    1
                ),
                0,
                1
            );

        const score =
            clamp(
                (
                    observationScore *
                    0.35 +

                    clamp(
                        coverageRatio,
                        0,
                        1
                    ) *
                    0.25 +

                    knownStatusRatio *
                    0.20 +

                    latencyCoverageRatio *
                    0.10 +

                    reconciliationCoverageRatio *
                    0.10
                ),
                0,
                1
            );

        let label =
            'LOW';

        if (
            score >= 0.80
        ) {

            label =
                'HIGH';

        } else if (
            score >= 0.55
        ) {

            label =
                'MEDIUM';
        }

        return {

            score:
                round(score),

            label,

            observations,

            observationDays,

            requestedDays:
                context.historicalDays,

            coverageRatio:
                round(
                    clamp(
                        coverageRatio,
                        0,
                        1
                    )
                ),

            knownStatusRatio:
                round(
                    knownStatusRatio
                ),

            latencyCoverageRatio:
                round(
                    latencyCoverageRatio
                ),

            reconciliationCoverageRatio:
                round(
                    reconciliationCoverageRatio
                ),

            sufficientHistory:
                observationDays >=
                this.config
                    .minimumHistoryDays &&
                observations >=
                this.config
                    .minimumObservations
        };
    }

    /**
     * ========================================================================
     * Core Metrics
     * ========================================================================
     */

    _calculateMetrics(
        history
    ) {

        const total =
            history.length;

        const successful =
            history.filter(
                item =>
                    item.status ===
                    SETTLEMENT_STATUS.SUCCESS
            ).length;

        const failed =
            history.filter(
                item =>
                    item.status ===
                    SETTLEMENT_STATUS.FAILED
            ).length;

        const pending =
            history.filter(
                item =>
                    item.status ===
                    SETTLEMENT_STATUS.PENDING
            ).length;

        const unknown =
            history.filter(
                item =>
                    item.status ===
                    SETTLEMENT_STATUS.UNKNOWN
            ).length;

        const known =
            successful +
            failed +
            pending;

        const completed =
            successful +
            failed;

        const successRate =
            completed > 0
                ? successful /
                  completed
                : 0;

        const failureRate =
            completed > 0
                ? failed /
                  completed
                : 0;

        const pendingRate =
            total > 0
                ? pending /
                  total
                : 0;

        const latencyValues =
            history
                .map(
                    item =>
                        item.latencyMs
                )
                .filter(
                    value =>
                        isFiniteNumber(
                            value
                        )
                );

        const varianceValues =
            history
                .map(
                    item =>
                        item.varianceRatio
                )
                .filter(
                    value =>
                        isFiniteNumber(
                            value
                        )
                );

        const reconciliationValues =
            history
                .map(
                    item =>
                        item.reconciled
                )
                .filter(
                    value =>
                        typeof value ===
                        'boolean'
                );

        const reconciled =
            reconciliationValues.filter(
                value =>
                    value === true
            ).length;

        const reconciliationRate =
            reconciliationValues.length
                ? reconciled /
                  reconciliationValues.length
                : 0;

        const withinTolerance =
            history.filter(
                item =>
                    item.varianceWithinTolerance ===
                    true
            ).length;

        const varianceCoverage =
            varianceValues.length;

        const varianceComplianceRate =
            varianceCoverage > 0
                ? withinTolerance /
                  varianceCoverage
                : 0;

        return {

            total,

            successful,

            failed,

            pending,

            unknown,

            known,

            completed,

            successRate:
                round(
                    successRate
                ),

            failureRate:
                round(
                    failureRate
                ),

            pendingRate:
                round(
                    pendingRate
                ),

            averageLatencyMs:
                round(
                    average(
                        latencyValues
                    ),
                    2
                ),

            medianLatencyMs:
                round(
                    median(
                        latencyValues
                    ),
                    2
                ),

            p95LatencyMs:
                round(
                    this._percentile(
                        latencyValues,
                        0.95
                    ),
                    2
                ),

            latencyStandardDeviationMs:
                round(
                    standardDeviation(
                        latencyValues
                    ),
                    2
                ),

            latencySlaComplianceRate:
                round(
                    this._latencySlaCompliance(
                        latencyValues
                    )
                ),

            averageVarianceRatio:
                round(
                    average(
                        varianceValues
                    )
                ),

            maxVarianceRatio:
                round(
                    Math.max(
                        ...varianceValues,
                        0
                    )
                ),

            varianceComplianceRate:
                round(
                    varianceComplianceRate
                ),

            reconciliationRate:
                round(
                    reconciliationRate
                ),

            reconciliationCoverage:
                reconciliationValues.length,

            varianceCoverage,

            latencyCoverage:
                latencyValues.length,

            completionRate:
                total > 0
                    ? round(
                        completed /
                        total
                    )
                    : 0,

            dataCompleteness:
                total > 0
                    ? round(
                        known /
                        total
                    )
                    : 0
        };
    }

    _percentile(
        values,
        percentile
    ) {

        if (!values.length) {
            return 0;
        }

        const sorted =
            [...values].sort(
                (a, b) => a - b
            );

        const index =
            (
                sorted.length - 1
            ) *
            percentile;

        const lower =
            Math.floor(index);

        const upper =
            Math.ceil(index);

        if (
            lower === upper
        ) {

            return sorted[lower];
        }

        const weight =
            index - lower;

        return (
            sorted[lower] *
            (1 - weight)
        ) +
        (
            sorted[upper] *
            weight
        );
    }

    _latencySlaCompliance(
        latencyValues
    ) {

        if (
            !latencyValues.length
        ) {

            return 0;
        }

        const compliant =
            latencyValues.filter(
                value =>
                    value <=
                    this.config
                        .defaultSlaMs
            ).length;

        return (
            compliant /
            latencyValues.length
        );
    }

    /**
     * ========================================================================
     * Reliability Score
     * ========================================================================
     */

    _calculateReliabilityScore({
        metrics,
        trend,
        dataQuality
    }) {

        const successComponent =
            metrics.successRate;

        const failureComponent =
            1 -
            metrics.failureRate;

        const latencyComponent =
            this._latencyScore(
                metrics
                    .averageLatencyMs
            );

        const varianceComponent =
            metrics.varianceCoverage >
            0
                ? metrics
                    .varianceComplianceRate
                : 0.75;

        const reconciliationComponent =
            metrics.reconciliationCoverage >
            0
                ? metrics
                    .reconciliationRate
                : 0.75;

        const consistencyComponent =
            this._consistencyScore(
                metrics
            );

        const weights =
            this.config
                .reliabilityWeights;

        let score =
            (
                successComponent *
                weights.successRate
            ) +

            (
                failureComponent *
                weights.failureRate
            ) +

            (
                latencyComponent *
                weights.latency
            ) +

            (
                varianceComponent *
                weights.variance
            ) +

            (
                reconciliationComponent *
                weights.reconciliation
            ) +

            (
                consistencyComponent *
                weights.consistency
            );

        /*
         * Penalize reliability when the trend is materially deteriorating.
         */
        if (
            trend.direction ===
            'DECREASING'
        ) {

            score -=
                Math.min(
                    trend.strength *
                    0.10,
                    0.10
                );
        }

        score =
            clamp(
                score,
                0,
                1
            );

        const confidence =
            clamp(
                (
                    dataQuality.score *
                    0.70
                ) +
                (
                    metrics.total >
                    this.config
                        .minimumObservations
                        ? 0.30
                        : 0
                ),
                0,
                1
            );

        return {

            score:
                round(score),

            level:
                this._classifyReliability(
                    score
                ),

            confidence:
                round(confidence),

            components: {

                success:
                    round(
                        successComponent
                    ),

                failure:
                    round(
                        failureComponent
                    ),

                latency:
                    round(
                        latencyComponent
                    ),

                variance:
                    round(
                        varianceComponent
                    ),

                reconciliation:
                    round(
                        reconciliationComponent
                    ),

                consistency:
                    round(
                        consistencyComponent
                    )
            },

            weights
        };
    }

    _latencyScore(
        latencyMs
    ) {

        if (
            !isFiniteNumber(
                latencyMs
            ) ||
            latencyMs <= 0
        ) {

            return 0.75;
        }

        const thresholds =
            this.config.latency;

        if (
            latencyMs <=
            thresholds.excellentMs
        ) {

            return 1;
        }

        if (
            latencyMs <=
            thresholds.goodMs
        ) {

            return 0.85;
        }

        if (
            latencyMs <=
            thresholds.acceptableMs
        ) {

            return 0.70;
        }

        if (
            latencyMs <=
            thresholds.poorMs
        ) {

            return 0.45;
        }

        if (
            latencyMs <=
            thresholds.criticalMs
        ) {

            return 0.20;
        }

        return 0;
    }

    _consistencyScore(
        metrics
    ) {

        const successStability =
            1 -
            Math.min(
                metrics.failureRate,
                1
            );

        const latencyStability =
            metrics.latencyStandardDeviationMs >
            0 &&
            metrics.averageLatencyMs >
            0

                ? clamp(
                    1 -
                    (
                        metrics
                            .latencyStandardDeviationMs /
                        metrics
                            .averageLatencyMs
                    ),
                    0,
                    1
                )

                : 0.75;

        return average([
            successStability,
            latencyStability
        ]);
    }

    _classifyReliability(
        score
    ) {

        const thresholds =
            this.config.thresholds;

        if (
            score >=
            thresholds.excellent
        ) {

            return RELIABILITY_LEVEL
                .EXCELLENT;
        }

        if (
            score >=
            thresholds.good
        ) {

            return RELIABILITY_LEVEL
                .GOOD;
        }

        if (
            score >=
            thresholds.acceptable
        ) {

            return RELIABILITY_LEVEL
                .ACCEPTABLE;
        }

        if (
            score >=
            thresholds.poor
        ) {

            return RELIABILITY_LEVEL
                .POOR;
        }

        return RELIABILITY_LEVEL
            .CRITICAL;
    }

    /**
     * ========================================================================
     * Reliability Trend
     * ========================================================================
     */

    _calculateReliabilityTrend(
        history,
        context
    ) {

        const daily =
            this._buildDailyReliabilitySeries(
                history,
                context
            );

        const values =
            daily
                .map(
                    item =>
                        item.score
                )
                .filter(
                    value =>
                        isFiniteNumber(
                            value
                        )
                );

        if (
            values.length < 2
        ) {

            return {

                direction:
                    'INSUFFICIENT_DATA',

                slopePerDay:
                    0,

                strength:
                    0,

                percentagePerPeriod:
                    0
            };
        }

        const x =
            values.map(
                (_, index) =>
                    index
            );

        const xMean =
            average(x);

        const yMean =
            average(values);

        let numerator = 0;

        let denominator = 0;

        for (
            let index = 0;
            index < values.length;
            index += 1
        ) {

            numerator +=
                (
                    x[index] -
                    xMean
                ) *
                (
                    values[index] -
                    yMean
                );

            denominator +=
                Math.pow(
                    x[index] -
                    xMean,
                    2
                );
        }

        const slope =
            denominator === 0
                ? 0
                : numerator /
                  denominator;

        const predicted =
            values.map(
                (_, index) =>
                    yMean +
                    slope *
                    (
                        index -
                        xMean
                    )
            );

        const ssTotal =
            values.reduce(
                (
                    total,
                    value
                ) =>
                    total +
                    Math.pow(
                        value -
                        yMean,
                        2
                    ),
                0
            );

        const ssResidual =
            values.reduce(
                (
                    total,
                    value,
                    index
                ) =>
                    total +
                    Math.pow(
                        value -
                        predicted[index],
                        2
                    ),
                0
            );

        const rSquared =
            ssTotal === 0
                ? 0
                : 1 -
                  (
                      ssResidual /
                      ssTotal
                  );

        const relativeSlope =
            Math.abs(
                yMean
            ) <
            this.config.epsilon
                ? 0
                : slope /
                  Math.abs(
                      yMean
                  );

        let direction =
            'STABLE';

        if (
            relativeSlope >
            0.005
        ) {

            direction =
                'IMPROVING';

        } else if (
            relativeSlope <
            -0.005
        ) {

            direction =
                'DETERIORATING';
        }

        return {

            direction,

            slopePerDay:
                round(
                    slope,
                    6
                ),

            percentagePerPeriod:
                round(
                    relativeSlope *
                    100,
                    4
                ),

            strength:
                round(
                    clamp(
                        rSquared,
                        0,
                        1
                    )
                ),

            rSquared:
                round(
                    clamp(
                        rSquared,
                        0,
                        1
                    )
                ),

            currentScore:
                round(
                    values[
                        values.length - 1
                    ]
                ),

            historicalAverageScore:
                round(
                    yMean
                )
        };
    }

    /**
     * ========================================================================
     * Daily Reliability
     * ========================================================================
     */

    _buildDailyReliabilitySeries(
        history,
        context
    ) {

        const buckets =
            new Map();

        for (
            let day = 0;
            day < context.historicalDays;
            day += 1
        ) {

            const current =
                addDays(
                    context.startDate,
                    day
                );

            buckets.set(
                dateKey(current),
                {
                    date:
                        dateKey(
                            current
                        ),

                    total: 0,

                    successful: 0,

                    failed: 0,

                    latencies: []
                }
            );
        }

        for (
            const record of history
        ) {

            const key =
                dateKey(
                    record.eventDate
                );

            const bucket =
                buckets.get(key);

            if (!bucket) {
                continue;
            }

            bucket.total += 1;

            if (
                record.status ===
                SETTLEMENT_STATUS.SUCCESS
            ) {

                bucket.successful +=
                    1;
            }

            if (
                record.status ===
                SETTLEMENT_STATUS.FAILED
            ) {

                bucket.failed +=
                    1;
            }

            if (
                isFiniteNumber(
                    record.latencyMs
                )
            ) {

                bucket.latencies.push(
                    record.latencyMs
                );
            }
        }

        return [
            ...buckets.values()
        ].map(
            bucket => {

                const completed =
                    bucket.successful +
                    bucket.failed;

                const successRate =
                    completed > 0
                        ? bucket.successful /
                          completed
                        : null;

                const latencyScore =
                    bucket.latencies.length
                        ? this._latencyScore(
                            average(
                                bucket.latencies
                            )
                        )
                        : 0.75;

                const score =
                    successRate === null
                        ? latencyScore
                        : (
                            successRate *
                            0.70
                        ) +
                        (
                            latencyScore *
                            0.30
                        );

                return {

                    date:
                        bucket.date,

                    total:
                        bucket.total,

                    successful:
                        bucket.successful,

                    failed:
                        bucket.failed,

                    successRate:
                        successRate === null
                            ? null
                            : round(
                                successRate
                            ),

                    averageLatencyMs:
                        round(
                            average(
                                bucket.latencies
                            ),
                            2
                        ),

                    score:
                        round(
                            score
                        )
                };
            }
        );
    }

    /**
     * ========================================================================
     * Seasonality
     * ========================================================================
     */

    _calculateSeasonality(
        dailySeries
    ) {

        const buckets =
            new Map();

        for (
            let day = 0;
            day < 7;
            day += 1
        ) {

            buckets.set(
                String(day),
                []
            );
        }

        for (
            const item of dailySeries
        ) {

            const date =
                safeDate(
                    item.date
                );

            if (!date) {
                continue;
            }

            if (
                !isFiniteNumber(
                    item.score
                )
            ) {

                continue;
            }

            buckets
                .get(
                    dayOfWeekKey(
                        date
                    )
                )
                .push(
                    item.score
                );
        }

        const allScores =
            dailySeries
                .map(
                    item =>
                        item.score
                )
                .filter(
                    value =>
                        isFiniteNumber(
                            value
                        )
                );

        const globalAverage =
            average(
                allScores
            );

        const weekdayIndexes = {};

        for (
            const [
                day,
                values
            ] of buckets
        ) {

            const dayAverage =
                average(values);

            weekdayIndexes[day] =
                globalAverage >
                this.config.epsilon

                    ? round(
                        dayAverage /
                        globalAverage
                    )

                    : 1;
        }

        const indexes =
            Object.values(
                weekdayIndexes
            );

        return {

            detected:
                coefficientOfVariation(
                    indexes
                ) >=
                0.03,

            strength:
                round(
                    clamp(
                        coefficientOfVariation(
                            indexes
                        ),
                        0,
                        1
                    )
                ),

            weekdayIndexes
        };
    }

    /**
     * ========================================================================
     * Reliability Forecast
     * ========================================================================
     */

    _forecastReliability(
        dailySeries,
        trend,
        seasonality,
        context
    ) {

        const values =
            dailySeries
                .map(
                    item =>
                        item.score
                )
                .filter(
                    value =>
                        isFiniteNumber(
                            value
                        )
                );

        const recentValues =
            values.slice(
                -this.config
                    .movingAverageWindow
            );

        const movingAverage =
            average(
                recentValues
            );

        const ewma =
            this._calculateEwma(
                values,
                this.config.ewmaAlpha
            );

        const daily = [];

        let total =
            0;

        for (
            let offset = 1;
            offset <=
            context.forecastHorizonDays;
            offset += 1
        ) {

            const forecastDate =
                addDays(
                    context.asOf,
                    offset
                );

            const seasonalityIndex =
                seasonality.detected
                    ? (
                        seasonality
                            .weekdayIndexes[
                                dayOfWeekKey(
                                    forecastDate
                                )
                            ] ||
                        1
                    )
                    : 1;

            let expected =
                (
                    movingAverage *
                    0.35
                ) +
                (
                    ewma *
                    0.40
                ) +
                (
                    trend.currentScore *
                    0.25
                );

            expected +=
                trend.slopePerDay *
                offset;

            /*
             * Seasonality is deliberately dampened. Reliability should not
             * oscillate aggressively because of normal calendar patterns.
             */
            expected *=
                (
                    1 +
                    (
                        seasonalityIndex -
                        1
                    ) *
                    0.20
                );

            expected =
                clamp(
                    expected,
                    0,
                    1
                );

            expected =
                round(
                    expected
                );

            total +=
                expected;

            daily.push({

                date:
                    dateKey(
                        forecastDate
                    ),

                expectedScore:
                    expected,

                expectedLevel:
                    this._classifyReliability(
                        expected
                    ),

                seasonalityIndex:
                    round(
                        seasonalityIndex
                    )
            });
        }

        return {

            horizonDays:
                context.forecastHorizonDays,

            expectedScore:
                round(
                    total /
                    Math.max(
                        daily.length,
                        1
                    )
                ),

            expectedLevel:
                this._classifyReliability(
                    total /
                    Math.max(
                        daily.length,
                        1
                    )
                ),

            daily
        };
    }

    _calculateEwma(
        values,
        alpha
    ) {

        if (!values.length) {
            return 0;
        }

        let result =
            values[0];

        for (
            let index = 1;
            index < values.length;
            index += 1
        ) {

            result =
                alpha *
                values[index] +
                (
                    1 - alpha
                ) *
                result;
        }

        return result;
    }

    /**
     * ========================================================================
     * Provider Analysis
     * ========================================================================
     */

    _analyzeProviders(
        history
    ) {

        const providers =
            new Map();

        for (
            const record of history
        ) {

            const provider =
                record.provider ||
                'UNKNOWN';

            if (
                !providers.has(
                    provider
                )
            ) {

                providers.set(
                    provider,
                    []
                );
            }

            providers
                .get(provider)
                .push(record);
        }

        const result = [];

        for (
            const [
                provider,
                records
            ] of providers
        ) {

            const metrics =
                this._calculateMetrics(
                    records
                );

            const providerScore =
                this._calculateProviderScore(
                    metrics
                );

            const trend =
                this._calculateProviderTrend(
                    records
                );

            result.push({

                provider,

                observations:
                    records.length,

                reliabilityScore:
                    providerScore.score,

                reliabilityLevel:
                    providerScore.level,

                confidence:
                    providerScore.confidence,

                successRate:
                    metrics.successRate,

                failureRate:
                    metrics.failureRate,

                pendingRate:
                    metrics.pendingRate,

                averageLatencyMs:
                    metrics.averageLatencyMs,

                medianLatencyMs:
                    metrics.medianLatencyMs,

                p95LatencyMs:
                    metrics.p95LatencyMs,

                latencySlaComplianceRate:
                    metrics.latencySlaComplianceRate,

                reconciliationRate:
                    metrics.reconciliationRate,

                varianceComplianceRate:
                    metrics.varianceComplianceRate,

                completionRate:
                    metrics.completionRate,

                trend
            });
        }

        result.sort(
            (
                a,
                b
            ) =>
                b.reliabilityScore -
                a.reliabilityScore
        );

        return result
            .slice(
                0,
                this.config.maxProviders
            )
            .map(
                (
                    item,
                    index
                ) => ({
                    ...item,

                    rank:
                        index + 1
                })
            );
    }

    _calculateProviderScore(
        metrics
    ) {

        const score =
            (
                metrics.successRate *
                0.35
            ) +

            (
                (
                    1 -
                    metrics.failureRate
                ) *
                0.15
            ) +

            (
                this._latencyScore(
                    metrics.averageLatencyMs
                ) *
                0.15
            ) +

            (
                (
                    metrics.varianceCoverage
                        ? metrics
                            .varianceComplianceRate
                        : 0.75
                ) *
                0.15
            ) +

            (
                (
                    metrics.reconciliationCoverage
                        ? metrics
                            .reconciliationRate
                        : 0.75
                ) *
                0.10
            ) +

            (
                this._consistencyScore(
                    metrics
                ) *
                0.10
            );

        const confidence =
            clamp(
                metrics.total /
                (
                    this.config
                        .minimumObservations *
                    5
                ),
                0,
                1
            );

        return {

            score:
                round(
                    clamp(
                        score,
                        0,
                        1
                    )
                ),

            level:
                this._classifyReliability(
                    score
                ),

            confidence:
                round(
                    confidence
                )
        };
    }

    _calculateProviderTrend(
        records
    ) {

        const daily =
            new Map();

        for (
            const record of records
        ) {

            const key =
                dateKey(
                    record.eventDate
                );

            if (
                !daily.has(key)
            ) {

                daily.set(
                    key,
                    []
                );
            }

            daily
                .get(key)
                .push(record);
        }

        const values =
            [
                ...daily.values()
            ]
                .map(
                    recordsForDay =>
                        this._calculateMetrics(
                            recordsForDay
                        ).successRate
                )
                .filter(
                    value =>
                        isFiniteNumber(
                            value
                        )
                );

        if (
            values.length < 2
        ) {

            return {

                direction:
                    'INSUFFICIENT_DATA',

                slope:
                    0,

                strength:
                    0
            };
        }

        const firstHalf =
            average(
                values.slice(
                    0,
                    Math.max(
                        1,
                        Math.floor(
                            values.length /
                            2
                        )
                    )
                )
            );

        const secondHalf =
            average(
                values.slice(
                    Math.floor(
                        values.length /
                        2
                    )
                )
            );

        const delta =
            secondHalf -
            firstHalf;

        let direction =
            'STABLE';

        if (
            delta >
            0.01
        ) {

            direction =
                'IMPROVING';

        } else if (
            delta <
            -0.01
        ) {

            direction =
                'DETERIORATING';
        }

        return {

            direction,

            slope:
                round(
                    delta /
                    Math.max(
                        values.length,
                        1
                    ),
                    6
                ),

            strength:
                round(
                    clamp(
                        Math.abs(delta),
                        0,
                        1
                    )
                )
        };
    }

    _selectPreferredProvider(
        providers
    ) {

        if (
            !providers ||
            !providers.length
        ) {

            return {

                available:
                    false,

                provider:
                    null,

                reason:
                    'No provider reliability data available.'
            };
        }

        const preferred =
            providers.find(
                provider =>
                    provider.confidence >=
                    0.50
            ) ||
            providers[0];

        return {

            available:
                true,

            provider:
                preferred.provider,

            reliabilityScore:
                preferred.reliabilityScore,

            reliabilityLevel:
                preferred.reliabilityLevel,

            confidence:
                preferred.confidence,

            reason:
                'Selected using historical reliability score and data confidence. This result is advisory and does not perform automatic provider failover.'
        };
    }

    /**
     * ========================================================================
     * SLA
     * ========================================================================
     */

    _calculateSlaAnalysis(
        history,
        context
    ) {

        const latencyValues =
            history
                .map(
                    item =>
                        item.latencyMs
                )
                .filter(
                    value =>
                        isFiniteNumber(
                            value
                        )
                );

        const slaMs =
            this.config
                .defaultSlaMs;

        const compliant =
            latencyValues.filter(
                latency =>
                    latency <=
                    slaMs
            ).length;

        const complianceRate =
            latencyValues.length
                ? compliant /
                  latencyValues.length
                : 0;

        const breaches =
            latencyValues.length -
            compliant;

        let status =
            'HEALTHY';

        if (
            complianceRate <
            0.70
        ) {

            status =
                'CRITICAL';

        } else if (
            complianceRate <
            0.85
        ) {

            status =
                'AT_RISK';
        }

        return {

            configured:
                true,

            targetMs:
                slaMs,

            targetMinutes:
                round(
                    slaMs / 60000,
                    2
                ),

            observations:
                latencyValues.length,

            compliant,

            breaches,

            complianceRate:
                round(
                    complianceRate
                ),

            compliancePercentage:
                round(
                    complianceRate *
                    100,
                    2
                ),

            status,

            providerScope:
                context.provider ||
                'ALL'
        };
    }

    /**
     * ========================================================================
     * Risk
     * ========================================================================
     */

    _calculateRisk({
        metrics,
        score,
        trend,
        dataQuality,
        forecast
    }) {

        let riskScore =
            1 -
            score.score;

        if (
            trend.direction ===
            'DETERIORATING'
        ) {

            riskScore +=
                Math.min(
                    trend.strength *
                    0.20,
                    0.20
                );
        }

        if (
            metrics.failureRate >
            0.10
        ) {

            riskScore +=
                0.10;
        }

        if (
            metrics.pendingRate >
            0.10
        ) {

            riskScore +=
                0.05;
        }

        if (
            forecast.expectedScore <
            this.config.thresholds
                .acceptable
        ) {

            riskScore +=
                0.10;
        }

        if (
            !dataQuality.sufficientHistory
        ) {

            riskScore +=
                0.10;
        }

        riskScore =
            clamp(
                riskScore,
                0,
                1
            );

        let level =
            'LOW';

        if (
            riskScore >=
            0.70
        ) {

            level =
                'HIGH';

        } else if (
            riskScore >=
            0.40
        ) {

            level =
                'MEDIUM';
        }

        return {

            score:
                round(
                    riskScore
                ),

            level,

            indicators: {

                highFailureRate:
                    metrics.failureRate >
                    0.10,

                highPendingRate:
                    metrics.pendingRate >
                    0.10,

                deterioratingTrend:
                    trend.direction ===
                    'DETERIORATING',

                weakForecast:
                    forecast.expectedScore <
                    this.config.thresholds
                        .acceptable,

                insufficientHistory:
                    !dataQuality
                        .sufficientHistory
            }
        };
    }

    /**
     * ========================================================================
     * Recommendations
     * ========================================================================
     */

    _generateRecommendations({
        score,
        risk,
        metrics,
        trend,
        dataQuality,
        sla,
        providerAnalysis
    }) {

        const recommendations = [];

        if (
            score.level ===
            RELIABILITY_LEVEL.CRITICAL
        ) {

            recommendations.push({

                code:
                    'CRITICAL_SETTLEMENT_RELIABILITY',

                priority:
                    'CRITICAL',

                message:
                    'Settlement reliability is critically low. Review provider failures, settlement queues, reconciliation exceptions, and upstream transaction controls before financial period close.'
            });
        }

        if (
            metrics.failureRate >
            0.10
        ) {

            recommendations.push({

                code:
                    'HIGH_SETTLEMENT_FAILURE_RATE',

                priority:
                    'HIGH',

                message:
                    'Settlement failure rate is elevated. Investigate provider errors, timeout patterns, rejected transactions, and retry effectiveness.'
            });
        }

        if (
            metrics.pendingRate >
            0.10
        ) {

            recommendations.push({

                code:
                    'HIGH_PENDING_SETTLEMENT_RATE',

                priority:
                    'HIGH',

                message:
                    'A significant proportion of settlements remain pending. Review settlement queues, callback processing, provider latency, and stale transaction handling.'
            });
        }

        if (
            metrics.averageLatencyMs >
            this.config
                .latency
                .acceptableMs
        ) {

            recommendations.push({

                code:
                    'SETTLEMENT_LATENCY_DETERIORATION',

                priority:
                    'HIGH',

                message:
                    'Average settlement latency exceeds the acceptable operational threshold. Review provider response times and asynchronous settlement processing.'
            });
        }

        if (
            metrics.varianceComplianceRate <
            0.95 &&
            metrics.varianceCoverage > 0
        ) {

            recommendations.push({

                code:
                    'SETTLEMENT_AMOUNT_VARIANCE',

                priority:
                    'HIGH',

                message:
                    'Settlement amount variance exceeds the configured tolerance for a material portion of observed settlements. Reconcile provider reports against the internal ledger and settlement records.'
            });
        }

        if (
            metrics.reconciliationCoverage > 0 &&
            metrics.reconciliationRate <
            0.95
        ) {

            recommendations.push({

                code:
                    'RECONCILIATION_RELIABILITY',

                priority:
                    'HIGH',

                message:
                    'Settlement reconciliation reliability is below target. Review unmatched settlements, missing ledger postings, and settlement reference mappings.'
            });
        }

        if (
            trend.direction ===
            'DETERIORATING'
        ) {

            recommendations.push({

                code:
                    'RELIABILITY_TREND_DETERIORATING',

                priority:
                    'HIGH',

                message:
                    'Settlement reliability is deteriorating over time. Identify the operational or provider-level driver before the trend becomes a financial control issue.'
            });
        }

        if (
            sla.status ===
            'AT_RISK' ||
            sla.status ===
            'CRITICAL'
        ) {

            recommendations.push({

                code:
                    'SETTLEMENT_SLA_RISK',

                priority:
                    sla.status ===
                    'CRITICAL'
                        ? 'CRITICAL'
                        : 'HIGH',

                message:
                    'Settlement processing is breaching the configured SLA at an elevated rate. Review provider reliability and settlement queue performance.'
            });
        }

        if (
            !dataQuality.sufficientHistory
        ) {

            recommendations.push({

                code:
                    'INSUFFICIENT_SETTLEMENT_HISTORY',

                priority:
                    'MEDIUM',

                message:
                    'Reliability conclusions are constrained by insufficient historical settlement data. Continue collecting settlement and reconciliation outcomes before making high-impact routing decisions.'
            });
        }

        if (
            providerAnalysis.length > 1
        ) {

            const preferred =
                this._selectPreferredProvider(
                    providerAnalysis
                );

            if (
                preferred.available
            ) {

                recommendations.push({

                    code:
                        'PROVIDER_RELIABILITY_COMPARISON',

                    priority:
                        'MEDIUM',

                    message:
                        `Provider ${preferred.provider} currently has the strongest observed reliability profile. Use this as advisory intelligence only; provider failover decisions should remain with the provider orchestration policy.`
                });
            }
        }

        if (
            !recommendations.length
        ) {

            recommendations.push({

                code:
                    'SETTLEMENT_RELIABILITY_STABLE',

                priority:
                    'LOW',

                message:
                    'Settlement reliability is currently within acceptable operational parameters. Continue monitoring provider performance, reconciliation quality, latency, and variance.'
            });
        }

        return recommendations;
    }

    /**
     * ========================================================================
     * Explainability
     * ========================================================================
     */

    _buildExplainability({
        score,
        metrics,
        trend,
        seasonality,
        dataQuality,
        risk,
        forecast,
        providerAnalysis
    }) {

        const factors = [];

        factors.push({

            factor:
                'SUCCESS_RATE',

            contribution:
                score.components.success,

            explanation:
                'Historical settlement completion success is a primary reliability signal.'
        });

        factors.push({

            factor:
                'FAILURE_RATE',

            contribution:
                score.components.failure,

            explanation:
                'Settlement failures reduce the overall reliability score.'
        });

        factors.push({

            factor:
                'LATENCY',

            contribution:
                score.components.latency,

            explanation:
                'Settlement processing latency is compared against operational latency thresholds.'
        });

        factors.push({

            factor:
                'RECONCILIATION',

            contribution:
                score.components.reconciliation,

            explanation:
                'Successful reconciliation indicates that settlement activity can be reliably matched to expected financial records.'
        });

        factors.push({

            factor:
                'AMOUNT_VARIANCE',

            contribution:
                score.components.variance,

            explanation:
                'Settlement amount compliance measures whether settled values remain within the configured variance tolerance.'
        });

        factors.push({

            factor:
                'CONSISTENCY',

            contribution:
                score.components.consistency,

            explanation:
                'Consistency measures stability across failure and latency behavior.'
        });

        factors.push({

            factor:
                'TREND',

            contribution:
                trend.direction,

            explanation:
                `Historical settlement reliability is currently ${trend.direction.toLowerCase()}.`
        });

        factors.push({

            factor:
                'SEASONALITY',

            contribution:
                seasonality.strength,

            explanation:
                'Recurring calendar patterns are considered when forecasting future reliability.'
        });

        factors.push({

            factor:
                'DATA_QUALITY',

            contribution:
                dataQuality.score,

            explanation:
                'Historical coverage and completeness influence forecast confidence.'
        });

        factors.push({

            factor:
                'FORECAST',

            contribution:
                forecast.expectedScore,

            explanation:
                'Future reliability is estimated from recent reliability, exponentially weighted history, trend, and dampened seasonality.'
        });

        return {

            summary:
                `Current settlement reliability is ${score.level.toLowerCase()} with a score of ${round(score.score * 100, 2)}%.`,

            factors,

            providerCount:
                providerAnalysis.length,

            analyticalDisclaimer:
                'Reliability results are analytical and advisory. They must not directly execute payment routing, provider failover, ledger posting, or settlement repair.'
        };
    }

    /**
     * ========================================================================
     * Metrics
     * ========================================================================
     */

    _recordMetric(
        name,
        payload
    ) {

        if (!this.metrics) {
            return;
        }

        try {

            if (
                typeof this.metrics
                    .increment ===
                'function'
            ) {

                this.metrics.increment(
                    name
                );

                return;
            }

            if (
                typeof this.metrics
                    .count ===
                'function'
            ) {

                this.metrics.count(
                    name,
                    1
                );
            }

        } catch (error) {

            this._logWarn(
                'Unable to record settlement reliability metric',
                {
                    metric:
                        name,

                    error:
                        error.message
                }
            );
        }
    }

    /**
     * ========================================================================
     * Logging
     * ========================================================================
     */

    _logInfo(
        message,
        metadata = {}
    ) {

        if (!this.logger) {
            return;
        }

        try {

            if (
                typeof this.logger.info ===
                'function'
            ) {

                this.logger.info(
                    message,
                    metadata
                );
            }

        } catch (_) {
            // Logging must never break financial intelligence.
        }
    }

    _logWarn(
        message,
        metadata = {}
    ) {

        if (!this.logger) {
            return;
        }

        try {

            if (
                typeof this.logger.warn ===
                'function'
            ) {

                this.logger.warn(
                    message,
                    metadata
                );
            }

        } catch (_) {
            // Logging must never break financial intelligence.
        }
    }

    _logError(
        message,
        metadata = {}
    ) {

        if (!this.logger) {
            return;
        }

        try {

            if (
                typeof this.logger.error ===
                'function'
            ) {

                this.logger.error(
                    message,
                    metadata
                );
            }

        } catch (_) {
            // Logging must never break financial intelligence.
        }
    }
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createSettlementReliabilityEngine(
    options = {}
) {

    return new SettlementReliabilityEngine(
        options
    );
}

/**
 * ============================================================================
 * Static Metadata
 * ============================================================================
 */

SettlementReliabilityEngine.ENGINE_NAME =
    ENGINE_NAME;

SettlementReliabilityEngine.ENGINE_VERSION =
    ENGINE_VERSION;

SettlementReliabilityEngine.DEFAULTS =
    DEFAULTS;

SettlementReliabilityEngine.RELIABILITY_LEVEL =
    RELIABILITY_LEVEL;

SettlementReliabilityEngine.SETTLEMENT_STATUS =
    SETTLEMENT_STATUS;

SettlementReliabilityEngine.SettlementReliabilityError =
    SettlementReliabilityError;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    SettlementReliabilityEngine;

module.exports.SettlementReliabilityEngine =
    SettlementReliabilityEngine;

module.exports.SettlementReliabilityError =
    SettlementReliabilityError;

module.exports.createSettlementReliabilityEngine =
    createSettlementReliabilityEngine;