'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * RepairForecast
 * ============================================================================
 *
 * Enterprise-grade domain model for repair forecasting.
 *
 * Location:
 *   backend/modules/finance/statements/models/RepairForecast.js
 *
 * Purpose
 * -------
 * Represents a generated forecast for future financial-statement repair
 * activity.
 *
 * Consumers:
 *
 *   - RepairForecastEngine
 *   - PredictiveRepairScheduler
 *   - RepairAnalyticsSnapshot
 *   - OperationalMetrics
 *   - AIRepairRecommendationEngine
 *   - AIConfidenceScorer
 *   - SettlementReliabilityEngine
 *   - FraudCorrelationEngine
 *   - ExecutiveReportingExporter
 *
 * Design principles
 * -----------------
 * - Persistence agnostic
 * - Tenant aware
 * - Immutable-by-default analytical record
 * - Versioned
 * - Explainable
 * - Confidence aware
 * - Model provenance aware
 * - Supports multiple forecast horizons
 * - Supports prediction intervals
 * - Supports scenario analysis
 * - Supports feature attribution
 * - Supports forecast validation
 * - Supports model performance tracking
 * - Supports cryptographic integrity fingerprints
 *
 * This model does NOT:
 *   - execute repairs
 *   - schedule repairs
 *   - mutate ledger data
 *   - perform fraud decisions
 *   - call an AI provider
 *   - persist itself
 *
 * Those responsibilities belong to dedicated services.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const MODEL_NAME = 'RepairForecast';

const SCHEMA_VERSION = '1.0.0';

const FORECAST_STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    GENERATED: 'GENERATED',
    VALIDATED: 'VALIDATED',
    ACCEPTED: 'ACCEPTED',
    PUBLISHED: 'PUBLISHED',
    SUPERSEDED: 'SUPERSEDED',
    EXPIRED: 'EXPIRED',
    FAILED: 'FAILED',
    INVALID: 'INVALID'
});

const FORECAST_TYPE = Object.freeze({
    REPAIR_VOLUME: 'REPAIR_VOLUME',
    REPAIR_FAILURE: 'REPAIR_FAILURE',
    REPAIR_BACKLOG: 'REPAIR_BACKLOG',
    REPAIR_AMOUNT: 'REPAIR_AMOUNT',
    VARIANCE_AMOUNT: 'VARIANCE_AMOUNT',
    PROCESSING_TIME: 'PROCESSING_TIME',
    SETTLEMENT_REPAIR: 'SETTLEMENT_REPAIR',
    FINANCIAL_EXPOSURE: 'FINANCIAL_EXPOSURE',
    COMPOSITE: 'COMPOSITE'
});

const FORECAST_DIRECTION = Object.freeze({
    INCREASING: 'INCREASING',
    DECREASING: 'DECREASING',
    STABLE: 'STABLE',
    VOLATILE: 'VOLATILE',
    UNKNOWN: 'UNKNOWN'
});

const CONFIDENCE_LEVEL = Object.freeze({
    VERY_LOW: 'VERY_LOW',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    VERY_HIGH: 'VERY_HIGH',
    UNKNOWN: 'UNKNOWN'
});

const RISK_LEVEL = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const HORIZON_UNIT = Object.freeze({
    MINUTES: 'MINUTES',
    HOURS: 'HOURS',
    DAYS: 'DAYS',
    WEEKS: 'WEEKS',
    MONTHS: 'MONTHS'
});

const GRANULARITY = Object.freeze({
    TRANSACTION: 'TRANSACTION',
    HOURLY: 'HOURLY',
    DAILY: 'DAILY',
    WEEKLY: 'WEEKLY',
    MONTHLY: 'MONTHLY'
});

const MODEL_FAMILY = Object.freeze({
    BASELINE: 'BASELINE',
    MOVING_AVERAGE: 'MOVING_AVERAGE',
    EXPONENTIAL_SMOOTHING: 'EXPONENTIAL_SMOOTHING',
    REGRESSION: 'REGRESSION',
    TIME_SERIES: 'TIME_SERIES',
    ENSEMBLE: 'ENSEMBLE',
    MACHINE_LEARNING: 'MACHINE_LEARNING',
    AI: 'AI',
    HYBRID: 'HYBRID',
    CUSTOM: 'CUSTOM'
});

const VALIDATION_STATUS = Object.freeze({
    NOT_VALIDATED: 'NOT_VALIDATED',
    PASSED: 'PASSED',
    FAILED: 'FAILED',
    PARTIAL: 'PARTIAL'
});

const DATA_QUALITY_LEVEL = Object.freeze({
    EXCELLENT: 'EXCELLENT',
    GOOD: 'GOOD',
    FAIR: 'FAIR',
    POOR: 'POOR',
    UNKNOWN: 'UNKNOWN'
});

const SCENARIO_TYPE = Object.freeze({
    BASELINE: 'BASELINE',
    OPTIMISTIC: 'OPTIMISTIC',
    PESSIMISTIC: 'PESSIMISTIC',
    STRESS: 'STRESS',
    CUSTOM: 'CUSTOM'
});

const DEFAULTS = Object.freeze({
    maximumPredictions: 100,
    maximumIntervals: 100,
    maximumFeatures: 200,
    maximumAttributions: 200,
    maximumScenarios: 50,
    maximumWarnings: 100,
    maximumErrors: 100,
    maximumTags: 50,
    maximumMetrics: 200,
    maximumHistory: 100
});

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}

function clone(value) {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (Array.isArray(value)) {
        return value.map(clone);
    }

    if (isObject(value)) {
        const result = {};

        for (const key of Object.keys(value)) {
            result[key] = clone(value[key]);
        }

        return result;
    }

    return value;
}

function normalizeString(value, fallback = null) {
    if (
        value === null ||
        value === undefined
    ) {
        return fallback;
    }

    const normalized = String(value).trim();

    return normalized.length > 0
        ? normalized
        : fallback;
}

function normalizeEnum(
    value,
    allowed,
    fallback
) {
    const normalized =
        normalizeString(value);

    if (!normalized) {
        return fallback;
    }

    const upper =
        normalized.toUpperCase();

    return allowed.includes(upper)
        ? upper
        : fallback;
}

function toNumber(value, fallback = null) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return fallback;
    }

    const numeric = Number(value);

    return Number.isFinite(numeric)
        ? numeric
        : fallback;
}

function clamp(
    value,
    minimum,
    maximum
) {
    const numeric =
        toNumber(
            value,
            minimum
        );

    return Math.min(
        maximum,
        Math.max(
            minimum,
            numeric
        )
    );
}

function round(
    value,
    decimals = 4
) {
    const numeric =
        toNumber(
            value,
            0
        );

    const factor =
        10 ** decimals;

    return (
        Math.round(
            numeric * factor
        ) / factor
    );
}

function normalizeDate(
    value,
    fallback = null
) {
    if (!value) {
        return fallback;
    }

    if (value instanceof Date) {
        return Number.isNaN(
            value.getTime()
        )
            ? fallback
            : new Date(
                value.getTime()
            );
    }

    const date =
        new Date(value);

    return Number.isNaN(
        date.getTime()
    )
        ? fallback
        : date;
}

function normalizeArray(
    value,
    maximum = Infinity
) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .slice(0, maximum)
        .map(clone);
}

function uniqueStrings(
    values,
    maximum = Infinity
) {
    if (!Array.isArray(values)) {
        return [];
    }

    const result = [];
    const seen = new Set();

    for (const value of values) {

        const normalized =
            normalizeString(value);

        if (!normalized) {
            continue;
        }

        const key =
            normalized.toLowerCase();

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(normalized);

        if (
            result.length >=
            maximum
        ) {
            break;
        }
    }

    return result;
}

function stableSerialize(value) {

    if (value === null) {
        return 'null';
    }

    if (value === undefined) {
        return 'undefined';
    }

    if (value instanceof Date) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (Array.isArray(value)) {
        return `[${value
            .map(stableSerialize)
            .join(',')}]`;
    }

    if (isObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function sha256(value) {
    return crypto
        .createHash('sha256')
        .update(
            stableSerialize(value)
        )
        .digest('hex');
}

/**
 * ============================================================================
 * RepairForecast
 * ============================================================================
 */

class RepairForecast {

    /**
     * @param {Object} data
     */
    constructor(data = {}) {

        if (!isObject(data)) {
            throw new TypeError(
                'RepairForecast data must be an object.'
            );
        }

        this._initialize(data);
    }

    /**
     * =========================================================================
     * Initialization
     * =========================================================================
     */

    _initialize(data) {

        const source =
            clone(data);

        this.model =
            MODEL_NAME;

        this.schemaVersion =
            normalizeString(
                source.schemaVersion,
                SCHEMA_VERSION
            );

        /**
         * ---------------------------------------------------------------------
         * Identity
         * ---------------------------------------------------------------------
         */

        this.id =
            normalizeString(
                source.id ||
                source._id
            );

        this.forecastId =
            normalizeString(
                source.forecastId
            ) ||
            this._generateForecastId();

        this.forecastRunId =
            normalizeString(
                source.forecastRunId
            );

        this.correlationId =
            normalizeString(
                source.correlationId
            );

        this.parentForecastId =
            normalizeString(
                source.parentForecastId
            );

        this.supersedesForecastId =
            normalizeString(
                source.supersedesForecastId
            );

        /**
         * ---------------------------------------------------------------------
         * Tenant / scope
         * ---------------------------------------------------------------------
         */

        this.tenantId =
            normalizeString(
                source.tenantId
            );

        this.organizationId =
            normalizeString(
                source.organizationId
            );

        this.groupId =
            normalizeString(
                source.groupId
            );

        this.branchId =
            normalizeString(
                source.branchId
            );

        this.accountId =
            normalizeString(
                source.accountId
            );

        this.scope =
            normalizeString(
                source.scope
            );

        this.scopeType =
            normalizeString(
                source.scopeType
            );

        this.environment =
            normalizeString(
                source.environment,
                'production'
            );

        /**
         * ---------------------------------------------------------------------
         * Forecast classification
         * ---------------------------------------------------------------------
         */

        this.forecastType =
            normalizeEnum(
                source.forecastType,
                Object.values(
                    FORECAST_TYPE
                ),
                FORECAST_TYPE.COMPOSITE
            );

        this.status =
            normalizeEnum(
                source.status,
                Object.values(
                    FORECAST_STATUS
                ),
                FORECAST_STATUS.GENERATED
            );

        this.direction =
            normalizeEnum(
                source.direction,
                Object.values(
                    FORECAST_DIRECTION
                ),
                FORECAST_DIRECTION.UNKNOWN
            );

        this.modelFamily =
            normalizeEnum(
                source.modelFamily,
                Object.values(
                    MODEL_FAMILY
                ),
                MODEL_FAMILY.BASELINE
            );

        /**
         * ---------------------------------------------------------------------
         * Observation period
         * ---------------------------------------------------------------------
         */

        this.observationPeriod =
            this._normalizePeriod(
                source.observationPeriod
            );

        /**
         * ---------------------------------------------------------------------
         * Forecast horizon
         * ---------------------------------------------------------------------
         */

        this.horizon =
            this._normalizeHorizon(
                source.horizon
            );

        /**
         * ---------------------------------------------------------------------
         * Forecast period
         * ---------------------------------------------------------------------
         */

        this.forecastPeriod =
            this._normalizePeriod(
                source.forecastPeriod
            );

        /**
         * ---------------------------------------------------------------------
         * Primary prediction
         * ---------------------------------------------------------------------
         */

        this.prediction =
            this._normalizePrediction(
                source.prediction
            );

        /**
         * ---------------------------------------------------------------------
         * Prediction series
         * ---------------------------------------------------------------------
         */

        this.predictions =
            this._normalizePredictions(
                source.predictions
            );

        /**
         * ---------------------------------------------------------------------
         * Confidence
         * ---------------------------------------------------------------------
         */

        this.confidence =
            this._normalizeConfidence(
                source.confidence
            );

        /**
         * ---------------------------------------------------------------------
         * Prediction intervals
         * ---------------------------------------------------------------------
         */

        this.intervals =
            this._normalizeIntervals(
                source.intervals
            );

        /**
         * ---------------------------------------------------------------------
         * Model metadata
         * ---------------------------------------------------------------------
         */

        this.model =
            this._normalizeModel(
                source.model
            );

        /**
         * ---------------------------------------------------------------------
         * Training / reference dataset
         * ---------------------------------------------------------------------
         */

        this.training =
            this._normalizeTraining(
                source.training
            );

        /**
         * ---------------------------------------------------------------------
         * Feature metadata
         * ---------------------------------------------------------------------
         */

        this.features =
            this._normalizeFeatures(
                source.features
            );

        /**
         * ---------------------------------------------------------------------
         * Explainability
         * ---------------------------------------------------------------------
         */

        this.explainability =
            this._normalizeExplainability(
                source.explainability
            );

        /**
         * ---------------------------------------------------------------------
         * Scenario analysis
         * ---------------------------------------------------------------------
         */

        this.scenarios =
            this._normalizeScenarios(
                source.scenarios
            );

        /**
         * ---------------------------------------------------------------------
         * Financial impact
         * ---------------------------------------------------------------------
         */

        this.financialImpact =
            this._normalizeFinancialImpact(
                source.financialImpact
            );

        /**
         * ---------------------------------------------------------------------
         * Operational impact
         * ---------------------------------------------------------------------
         */

        this.operationalImpact =
            this._normalizeOperationalImpact(
                source.operationalImpact
            );

        /**
         * ---------------------------------------------------------------------
         * Risk
         * ---------------------------------------------------------------------
         */

        this.risk =
            this._normalizeRisk(
                source.risk
            );

        /**
         * ---------------------------------------------------------------------
         * Data quality
         * ---------------------------------------------------------------------
         */

        this.dataQuality =
            this._normalizeDataQuality(
                source.dataQuality
            );

        /**
         * ---------------------------------------------------------------------
         * Validation
         * ---------------------------------------------------------------------
         */

        this.validation =
            this._normalizeValidation(
                source.validation
            );

        /**
         * ---------------------------------------------------------------------
         * Accuracy / realized results
         * ---------------------------------------------------------------------
         */

        this.performance =
            this._normalizePerformance(
                source.performance
            );

        /**
         * ---------------------------------------------------------------------
         * Scheduling guidance
         * ---------------------------------------------------------------------
         */

        this.scheduling =
            this._normalizeScheduling(
                source.scheduling
            );

        /**
         * ---------------------------------------------------------------------
         * Alerts / warnings
         * ---------------------------------------------------------------------
         */

        this.alerts =
            normalizeArray(
                source.alerts,
                DEFAULTS.maximumWarnings
            );

        this.warnings =
            normalizeArray(
                source.warnings,
                DEFAULTS.maximumWarnings
            );

        this.errors =
            normalizeArray(
                source.errors,
                DEFAULTS.maximumErrors
            );

        /**
         * ---------------------------------------------------------------------
         * Custom metrics
         * ---------------------------------------------------------------------
         */

        this.customMetrics =
            this._normalizeCustomMetrics(
                source.customMetrics
            );

        /**
         * ---------------------------------------------------------------------
         * Provenance
         * ---------------------------------------------------------------------
         */

        this.provenance =
            this._normalizeProvenance(
                source.provenance
            );

        /**
         * ---------------------------------------------------------------------
         * Tags
         * ---------------------------------------------------------------------
         */

        this.tags =
            uniqueStrings(
                source.tags,
                DEFAULTS.maximumTags
            );

        /**
         * ---------------------------------------------------------------------
         * History
         * ---------------------------------------------------------------------
         */

        this.history =
            normalizeArray(
                source.history,
                DEFAULTS.maximumHistory
            );

        /**
         * ---------------------------------------------------------------------
         * Observability
         * ---------------------------------------------------------------------
         */

        this.requestId =
            normalizeString(
                source.requestId
            );

        this.traceId =
            normalizeString(
                source.traceId
            );

        this.createdBy =
            normalizeString(
                source.createdBy
            );

        this.updatedBy =
            normalizeString(
                source.updatedBy
            );

        /**
         * ---------------------------------------------------------------------
         * Timestamps
         * ---------------------------------------------------------------------
         */

        this.createdAt =
            normalizeDate(
                source.createdAt
            ) ||
            new Date();

        this.updatedAt =
            normalizeDate(
                source.updatedAt
            ) ||
            new Date(
                this.createdAt.getTime()
            );

        this.generatedAt =
            normalizeDate(
                source.generatedAt
            ) ||
            new Date();

        this.validFrom =
            normalizeDate(
                source.validFrom
            ) ||
            new Date(
                this.generatedAt.getTime()
            );

        this.validUntil =
            normalizeDate(
                source.validUntil
            );

        this.publishedAt =
            normalizeDate(
                source.publishedAt
            );

        this.validatedAt =
            normalizeDate(
                source.validatedAt
            );

        this.actualizedAt =
            normalizeDate(
                source.actualizedAt
            );

        /**
         * ---------------------------------------------------------------------
         * Metadata
         * ---------------------------------------------------------------------
         */

        this.metadata =
            isObject(
                source.metadata
            )
                ? clone(
                    source.metadata
                )
                : {};

        /**
         * ---------------------------------------------------------------------
         * Integrity
         * ---------------------------------------------------------------------
         */

        this.fingerprint =
            normalizeString(
                source.fingerprint
            ) ||
            this.generateFingerprint();
    }

    /**
     * =========================================================================
     * Period
     * =========================================================================
     */

    _normalizePeriod(period) {

        const source =
            isObject(period)
                ? period
                : {};

        return {

            start:
                normalizeDate(
                    source.start
                ),

            end:
                normalizeDate(
                    source.end
                ),

            timezone:
                normalizeString(
                    source.timezone
                ),

            durationMs:
                toNumber(
                    source.durationMs
                ),

            granularity:
                normalizeEnum(
                    source.granularity,
                    Object.values(
                        GRANULARITY
                    ),
                    GRANULARITY.DAILY
                ),

            label:
                normalizeString(
                    source.label
                )
        };
    }

    /**
     * =========================================================================
     * Horizon
     * =========================================================================
     */

    _normalizeHorizon(horizon) {

        const source =
            isObject(horizon)
                ? horizon
                : {};

        return {

            value:
                toNumber(
                    source.value
                ),

            unit:
                normalizeEnum(
                    source.unit,
                    Object.values(
                        HORIZON_UNIT
                    ),
                    HORIZON_UNIT.DAYS
                ),

            periods:
                toNumber(
                    source.periods
                ),

            label:
                normalizeString(
                    source.label
                )
        };
    }

    /**
     * =========================================================================
     * Prediction
     * =========================================================================
     */

    _normalizePrediction(prediction) {

        const source =
            isObject(prediction)
                ? prediction
                : {};

        return {

            value:
                toNumber(
                    source.value
                ),

            lowerBound:
                toNumber(
                    source.lowerBound
                ),

            upperBound:
                toNumber(
                    source.upperBound
                ),

            expectedValue:
                toNumber(
                    source.expectedValue
                ),

            baselineValue:
                toNumber(
                    source.baselineValue
                ),

            change:
                toNumber(
                    source.change
                ),

            changePercent:
                toNumber(
                    source.changePercent
                ),

            unit:
                normalizeString(
                    source.unit
                ),

            currency:
                normalizeString(
                    source.currency
                ),

            direction:
                normalizeEnum(
                    source.direction,
                    Object.values(
                        FORECAST_DIRECTION
                    ),
                    thisDirection(
                        source.direction
                    )
                )
        };
    }

    /**
     * =========================================================================
     * Prediction Series
     * =========================================================================
     */

    _normalizePredictions(predictions) {

        if (!Array.isArray(predictions)) {
            return [];
        }

        return predictions
            .slice(
                0,
                DEFAULTS.maximumPredictions
            )
            .map(
                item => {

                    const source =
                        isObject(item)
                            ? item
                            : {};

                    return {

                        timestamp:
                            normalizeDate(
                                source.timestamp
                            ),

                        periodStart:
                            normalizeDate(
                                source.periodStart
                            ),

                        periodEnd:
                            normalizeDate(
                                source.periodEnd
                            ),

                        value:
                            toNumber(
                                source.value
                            ),

                        expectedValue:
                            toNumber(
                                source.expectedValue
                            ),

                        lowerBound:
                            toNumber(
                                source.lowerBound
                            ),

                        upperBound:
                            toNumber(
                                source.upperBound
                            ),

                        confidence:
                            toNumber(
                                source.confidence
                            ),

                        direction:
                            normalizeEnum(
                                source.direction,
                                Object.values(
                                    FORECAST_DIRECTION
                                ),
                                FORECAST_DIRECTION.UNKNOWN
                            ),

                        unit:
                            normalizeString(
                                source.unit
                            ),

                        currency:
                            normalizeString(
                                source.currency
                            ),

                        rank:
                            toNumber(
                                source.rank
                            )
                    };
                }
            );
    }

    /**
     * =========================================================================
     * Confidence
     * =========================================================================
     */

    _normalizeConfidence(confidence) {

        const source =
            isObject(confidence)
                ? confidence
                : {};

        const score =
            toNumber(
                source.score
            );

        return {

            score:
                score === null
                    ? null
                    : clamp(
                        score,
                        0,
                        100
                    ),

            level:
                normalizeEnum(
                    source.level,
                    Object.values(
                        CONFIDENCE_LEVEL
                    ),
                    this._confidenceLevel(
                        score
                    )
                ),

            lowerBound:
                toNumber(
                    source.lowerBound
                ),

            upperBound:
                toNumber(
                    source.upperBound
                ),

            calibrationScore:
                toNumber(
                    source.calibrationScore
                ),

            uncertainty:
                toNumber(
                    source.uncertainty
                ),

            sampleAdequacy:
                toNumber(
                    source.sampleAdequacy
                ),

            modelAgreement:
                toNumber(
                    source.modelAgreement
                ),

            historicalAccuracy:
                toNumber(
                    source.historicalAccuracy
                )
        };
    }

    _confidenceLevel(score) {

        if (
            score === null ||
            score === undefined
        ) {
            return CONFIDENCE_LEVEL.UNKNOWN;
        }

        if (score >= 90) {
            return CONFIDENCE_LEVEL.VERY_HIGH;
        }

        if (score >= 75) {
            return CONFIDENCE_LEVEL.HIGH;
        }

        if (score >= 60) {
            return CONFIDENCE_LEVEL.MEDIUM;
        }

        if (score >= 40) {
            return CONFIDENCE_LEVEL.LOW;
        }

        return CONFIDENCE_LEVEL.VERY_LOW;
    }

    /**
     * =========================================================================
     * Prediction Intervals
     * =========================================================================
     */

    _normalizeIntervals(intervals) {

        if (!Array.isArray(intervals)) {
            return [];
        }

        return intervals
            .slice(
                0,
                DEFAULTS.maximumIntervals
            )
            .map(
                item => {

                    const source =
                        isObject(item)
                            ? item
                            : {};

                    return {

                        level:
                            toNumber(
                                source.level
                            ),

                        lower:
                            toNumber(
                                source.lower
                            ),

                        upper:
                            toNumber(
                                source.upper
                            ),

                        width:
                            toNumber(
                                source.width
                            ),

                        midpoint:
                            toNumber(
                                source.midpoint
                            ),

                        calibrated:
                            Boolean(
                                source.calibrated
                            )
                    };
                }
            );
    }

    /**
     * =========================================================================
     * Model
     * =========================================================================
     */

    _normalizeModel(model) {

        const source =
            isObject(model)
                ? model
                : {};

        return {

            name:
                normalizeString(
                    source.name
                ),

            version:
                normalizeString(
                    source.version
                ),

            family:
                normalizeEnum(
                    source.family,
                    Object.values(
                        MODEL_FAMILY
                    ),
                    this.modelFamily
                ),

            provider:
                normalizeString(
                    source.provider
                ),

            registryId:
                normalizeString(
                    source.registryId
                ),

            artifactId:
                normalizeString(
                    source.artifactId
                ),

            featureVersion:
                normalizeString(
                    source.featureVersion
                ),

            promptVersion:
                normalizeString(
                    source.promptVersion
                ),

            algorithm:
                normalizeString(
                    source.algorithm
                ),

            ensembleSize:
                toNumber(
                    source.ensembleSize
                ),

            deterministic:
                source.deterministic !== undefined
                    ? Boolean(
                        source.deterministic
                    )
                    : true
        };
    }

    /**
     * =========================================================================
     * Training / Reference Data
     * =========================================================================
     */

    _normalizeTraining(training) {

        const source =
            isObject(training)
                ? training
                : {};

        return {

            datasetId:
                normalizeString(
                    source.datasetId
                ),

            datasetVersion:
                normalizeString(
                    source.datasetVersion
                ),

            sampleCount:
                toNumber(
                    source.sampleCount,
                    0
                ),

            positiveSamples:
                toNumber(
                    source.positiveSamples,
                    0
                ),

            negativeSamples:
                toNumber(
                    source.negativeSamples,
                    0
                ),

            lookbackPeriods:
                toNumber(
                    source.lookbackPeriods
                ),

            lookbackDurationMs:
                toNumber(
                    source.lookbackDurationMs
                ),

            trainingStart:
                normalizeDate(
                    source.trainingStart
                ),

            trainingEnd:
                normalizeDate(
                    source.trainingEnd
                ),

            lastTrainingAt:
                normalizeDate(
                    source.lastTrainingAt
                ),

            driftScore:
                toNumber(
                    source.driftScore
                ),

            leakageDetected:
                Boolean(
                    source.leakageDetected
                )
        };
    }

    /**
     * =========================================================================
     * Features
     * =========================================================================
     */

    _normalizeFeatures(features) {

        const source =
            isObject(features)
                ? features
                : {};

        const names =
            uniqueStrings(
                source.names,
                DEFAULTS.maximumFeatures
            );

        return {

            version:
                normalizeString(
                    source.version
                ),

            count:
                toNumber(
                    source.count,
                    names.length
                ),

            names,

            missingCount:
                toNumber(
                    source.missingCount,
                    0
                ),

            missingRate:
                toNumber(
                    source.missingRate
                ),

            imputedCount:
                toNumber(
                    source.imputedCount,
                    0
                ),

            normalized:
                source.normalized !== undefined
                    ? Boolean(
                        source.normalized
                    )
                    : true,

            featureHash:
                normalizeString(
                    source.featureHash
                )
        };
    }

    /**
     * =========================================================================
     * Explainability
     * =========================================================================
     */

    _normalizeExplainability(
        explainability
    ) {

        const source =
            isObject(explainability)
                ? explainability
                : {};

        return {

            method:
                normalizeString(
                    source.method
                ),

            summary:
                normalizeString(
                    source.summary
                ),

            topFeatures:
                normalizeArray(
                    source.topFeatures,
                    DEFAULTS.maximumAttributions
                ),

            attributions:
                normalizeArray(
                    source.attributions,
                    DEFAULTS.maximumAttributions
                ),

            explanationVersion:
                normalizeString(
                    source.explanationVersion
                ),

            generatedAt:
                normalizeDate(
                    source.generatedAt
                )
        };
    }

    /**
     * =========================================================================
     * Scenarios
     * =========================================================================
     */

    _normalizeScenarios(scenarios) {

        if (!Array.isArray(scenarios)) {
            return [];
        }

        return scenarios
            .slice(
                0,
                DEFAULTS.maximumScenarios
            )
            .map(
                item => {

                    const source =
                        isObject(item)
                            ? item
                            : {};

                    return {

                        id:
                            normalizeString(
                                source.id
                            ),

                        name:
                            normalizeString(
                                source.name
                            ),

                        type:
                            normalizeEnum(
                                source.type,
                                Object.values(
                                    SCENARIO_TYPE
                                ),
                                SCENARIO_TYPE.CUSTOM
                            ),

                        probability:
                            toNumber(
                                source.probability
                            ),

                        predictedValue:
                            toNumber(
                                source.predictedValue
                            ),

                        lowerBound:
                            toNumber(
                                source.lowerBound
                            ),

                        upperBound:
                            toNumber(
                                source.upperBound
                            ),

                        changePercent:
                            toNumber(
                                source.changePercent
                            ),

                        assumptions:
                            normalizeArray(
                                source.assumptions,
                                50
                            ),

                        riskScore:
                            toNumber(
                                source.riskScore
                            )
                    };
                }
            );
    }

    /**
     * =========================================================================
     * Financial Impact
     * =========================================================================
     */

    _normalizeFinancialImpact(
        financialImpact
    ) {

        const source =
            isObject(financialImpact)
                ? financialImpact
                : {};

        return {

            currency:
                normalizeString(
                    source.currency
                ),

            predictedRepairAmount:
                toNumber(
                    source.predictedRepairAmount
                ),

            predictedVarianceAmount:
                toNumber(
                    source.predictedVarianceAmount
                ),

            predictedExposureAmount:
                toNumber(
                    source.predictedExposureAmount
                ),

            predictedRecoveryAmount:
                toNumber(
                    source.predictedRecoveryAmount
                ),

            predictedLossAmount:
                toNumber(
                    source.predictedLossAmount
                ),

            baselineAmount:
                toNumber(
                    source.baselineAmount
                ),

            changeAmount:
                toNumber(
                    source.changeAmount
                ),

            changePercent:
                toNumber(
                    source.changePercent
                ),

            materialityScore:
                toNumber(
                    source.materialityScore
                )
        };
    }

    /**
     * =========================================================================
     * Operational Impact
     * =========================================================================
     */

    _normalizeOperationalImpact(
        operationalImpact
    ) {

        const source =
            isObject(operationalImpact)
                ? operationalImpact
                : {};

        return {

            predictedRepairVolume:
                toNumber(
                    source.predictedRepairVolume
                ),

            predictedFailureVolume:
                toNumber(
                    source.predictedFailureVolume
                ),

            predictedBacklog:
                toNumber(
                    source.predictedBacklog
                ),

            predictedProcessingTimeMs:
                toNumber(
                    source.predictedProcessingTimeMs
                ),

            predictedQueueDepth:
                toNumber(
                    source.predictedQueueDepth
                ),

            predictedSlaBreaches:
                toNumber(
                    source.predictedSlaBreaches
                ),

            capacityRequired:
                toNumber(
                    source.capacityRequired
                ),

            capacityAvailable:
                toNumber(
                    source.capacityAvailable
                ),

            capacityUtilization:
                toNumber(
                    source.capacityUtilization
                )
        };
    }

    /**
     * =========================================================================
     * Risk
     * =========================================================================
     */

    _normalizeRisk(risk) {

        const source =
            isObject(risk)
                ? risk
                : {};

        return {

            overallScore:
                toNumber(
                    source.overallScore
                ),

            financialRiskScore:
                toNumber(
                    source.financialRiskScore
                ),

            operationalRiskScore:
                toNumber(
                    source.operationalRiskScore
                ),

            settlementRiskScore:
                toNumber(
                    source.settlementRiskScore
                ),

            fraudRiskScore:
                toNumber(
                    source.fraudRiskScore
                ),

            forecastUncertaintyScore:
                toNumber(
                    source.forecastUncertaintyScore
                ),

            riskLevel:
                normalizeEnum(
                    source.riskLevel,
                    Object.values(
                        RISK_LEVEL
                    ),
                    RISK_LEVEL.UNKNOWN
                )
        };
    }

    /**
     * =========================================================================
     * Data Quality
     * =========================================================================
     */

    _normalizeDataQuality(
        dataQuality
    ) {

        const source =
            isObject(dataQuality)
                ? dataQuality
                : {};

        return {

            score:
                toNumber(
                    source.score
                ),

            level:
                normalizeEnum(
                    source.level,
                    Object.values(
                        DATA_QUALITY_LEVEL
                    ),
                    DATA_QUALITY_LEVEL.UNKNOWN
                ),

            completeness:
                toNumber(
                    source.completeness
                ),

            consistency:
                toNumber(
                    source.consistency
                ),

            freshness:
                toNumber(
                    source.freshness
                ),

            accuracy:
                toNumber(
                    source.accuracy
                ),

            sampleAdequacy:
                toNumber(
                    source.sampleAdequacy
                ),

            stale:
                Boolean(
                    source.stale
                ),

            missingCriticalInputs:
                Boolean(
                    source.missingCriticalInputs
                )
        };
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    _normalizeValidation(validation) {

        const source =
            isObject(validation)
                ? validation
                : {};

        return {

            status:
                normalizeEnum(
                    source.status,
                    Object.values(
                        VALIDATION_STATUS
                    ),
                    VALIDATION_STATUS.NOT_VALIDATED
                ),

            validatedAt:
                normalizeDate(
                    source.validatedAt
                ),

            validator:
                normalizeString(
                    source.validator
                ),

            validationVersion:
                normalizeString(
                    source.validationVersion
                ),

            actualValue:
                toNumber(
                    source.actualValue
                ),

            absoluteError:
                toNumber(
                    source.absoluteError
                ),

            percentageError:
                toNumber(
                    source.percentageError
                ),

            meanAbsoluteError:
                toNumber(
                    source.meanAbsoluteError
                ),

            meanSquaredError:
                toNumber(
                    source.meanSquaredError
                ),

            rootMeanSquaredError:
                toNumber(
                    source.rootMeanSquaredError
                ),

            meanAbsolutePercentageError:
                toNumber(
                    source.meanAbsolutePercentageError
                ),

            bias:
                toNumber(
                    source.bias
                ),

            withinInterval:
                source.withinInterval !== undefined
                    ? Boolean(
                        source.withinInterval
                    )
                    : null,

            notes:
                normalizeArray(
                    source.notes,
                    50
                )
        };
    }

    /**
     * =========================================================================
     * Forecast Performance
     * =========================================================================
     */

    _normalizePerformance(
        performance
    ) {

        const source =
            isObject(performance)
                ? performance
                : {};

        return {

            actualValue:
                toNumber(
                    source.actualValue
                ),

            error:
                toNumber(
                    source.error
                ),

            absoluteError:
                toNumber(
                    source.absoluteError
                ),

            percentageError:
                toNumber(
                    source.percentageError
                ),

            directionalAccuracy:
                toNumber(
                    source.directionalAccuracy
                ),

            intervalCoverage:
                toNumber(
                    source.intervalCoverage
                ),

            calibrationScore:
                toNumber(
                    source.calibrationScore
                ),

            accuracyScore:
                toNumber(
                    source.accuracyScore
                ),

            validated:
                Boolean(
                    source.validated
                )
        };
    }

    /**
     * =========================================================================
     * Scheduling Guidance
     * =========================================================================
     */

    _normalizeScheduling(
        scheduling
    ) {

        const source =
            isObject(scheduling)
                ? scheduling
                : {};

        return {

            recommended:
                Boolean(
                    source.recommended
                ),

            priority:
                toNumber(
                    source.priority
                ),

            recommendedStart:
                normalizeDate(
                    source.recommendedStart
                ),

            recommendedEnd:
                normalizeDate(
                    source.recommendedEnd
                ),

            recommendedCapacity:
                toNumber(
                    source.recommendedCapacity
                ),

            urgencyScore:
                toNumber(
                    source.urgencyScore
                ),

            reason:
                normalizeString(
                    source.reason
                ),

            constraints:
                normalizeArray(
                    source.constraints,
                    50
                )
        };
    }

    /**
     * =========================================================================
     * Custom Metrics
     * =========================================================================
     */

    _normalizeCustomMetrics(
        metrics
    ) {

        if (!isObject(metrics)) {
            return {};
        }

        const result = {};

        const keys =
            Object.keys(metrics)
                .slice(
                    0,
                    DEFAULTS.maximumMetrics
                );

        for (
            const key of keys
        ) {

            const normalizedKey =
                normalizeString(
                    key
                );

            if (!normalizedKey) {
                continue;
            }

            result[
                normalizedKey
            ] =
                clone(
                    metrics[key]
                );
        }

        return result;
    }

    /**
     * =========================================================================
     * Provenance
     * =========================================================================
     */

    _normalizeProvenance(
        provenance
    ) {

        const source =
            isObject(provenance)
                ? provenance
                : {};

        return {

            source:
                normalizeString(
                    source.source
                ),

            sourceSystem:
                normalizeString(
                    source.sourceSystem
                ),

            engine:
                normalizeString(
                    source.engine
                ),

            engineVersion:
                normalizeString(
                    source.engineVersion
                ),

            modelRegistryId:
                normalizeString(
                    source.modelRegistryId
                ),

            modelVersion:
                normalizeString(
                    source.modelVersion
                ),

            featureExtractorVersion:
                normalizeString(
                    source.featureExtractorVersion
                ),

            generatedBy:
                normalizeString(
                    source.generatedBy
                ),

            generatedAt:
                normalizeDate(
                    source.generatedAt
                )
        };
    }

    /**
     * =========================================================================
     * Forecast Status
     * =========================================================================
     */

    markGenerated() {

        this.status =
            FORECAST_STATUS.GENERATED;

        this.generatedAt =
            new Date();

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    markValidated(
        validation = {}
    ) {

        this.validation =
            this._normalizeValidation(
                {
                    ...this.validation,
                    ...validation,
                    status:
                        VALIDATION_STATUS.PASSED,
                    validatedAt:
                        new Date()
                }
            );

        this.status =
            FORECAST_STATUS.VALIDATED;

        this.validatedAt =
            new Date();

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    markPublished() {

        this.status =
            FORECAST_STATUS.PUBLISHED;

        this.publishedAt =
            new Date();

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    markSuperseded(
        replacementForecastId = null
    ) {

        this.status =
            FORECAST_STATUS.SUPERSEDED;

        this.supersedesForecastId =
            normalizeString(
                replacementForecastId
            );

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    markExpired() {

        this.status =
            FORECAST_STATUS.EXPIRED;

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    markFailed(
        error = {}
    ) {

        this.status =
            FORECAST_STATUS.FAILED;

        if (isObject(error)) {
            this.errors.push(
                clone(error)
            );
        } else if (error) {
            this.errors.push({
                code:
                    'FORECAST_GENERATION_FAILED',
                message:
                    String(error)
            });
        }

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    /**
     * =========================================================================
     * Forecast Calculations
     * =========================================================================
     */

    calculateChange(
        baseline
    ) {

        const forecastValue =
            toNumber(
                this.prediction.value
            );

        const baselineValue =
            toNumber(
                baseline
            );

        if (
            forecastValue === null ||
            baselineValue === null
        ) {
            return null;
        }

        const change =
            forecastValue -
            baselineValue;

        const changePercent =
            baselineValue === 0
                ? null
                : (
                    change /
                    Math.abs(
                        baselineValue
                    )
                ) * 100;

        this.prediction.baselineValue =
            baselineValue;

        this.prediction.change =
            round(
                change,
                4
            );

        this.prediction.changePercent =
            changePercent === null
                ? null
                : round(
                    changePercent,
                    4
                );

        this.direction =
            this._classifyDirection(
                changePercent
            );

        this.prediction.direction =
            this.direction;

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return {
            change:
                this.prediction.change,

            changePercent:
                this.prediction.changePercent,

            direction:
                this.direction
        };
    }

    _classifyDirection(
        changePercent
    ) {

        if (
            changePercent === null ||
            changePercent === undefined
        ) {
            return FORECAST_DIRECTION.UNKNOWN;
        }

        const absolute =
            Math.abs(
                changePercent
            );

        if (
            absolute <= 2
        ) {
            return FORECAST_DIRECTION.STABLE;
        }

        return changePercent > 0
            ? FORECAST_DIRECTION.INCREASING
            : FORECAST_DIRECTION.DECREASING;
    }

    /**
     * =========================================================================
     * Confidence
     * =========================================================================
     */

    setConfidence(
        score,
        details = {}
    ) {

        const normalizedScore =
            clamp(
                score,
                0,
                100
            );

        this.confidence = {
            ...this.confidence,
            ...clone(details),
            score:
                round(
                    normalizedScore,
                    2
                ),
            level:
                this._confidenceLevel(
                    normalizedScore
                )
        };

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this.confidence;
    }

    isHighConfidence(
        threshold = 75
    ) {

        const score =
            toNumber(
                this.confidence.score
            );

        return (
            score !== null &&
            score >= threshold
        );
    }

    isLowConfidence(
        threshold = 50
    ) {

        const score =
            toNumber(
                this.confidence.score
            );

        return (
            score === null ||
            score < threshold
        );
    }

    /**
     * =========================================================================
     * Interval Management
     * =========================================================================
     */

    addPredictionInterval(
        interval
    ) {

        if (
            this.intervals.length >=
            DEFAULTS.maximumIntervals
        ) {
            return false;
        }

        const source =
            isObject(interval)
                ? interval
                : {};

        const lower =
            toNumber(
                source.lower
            );

        const upper =
            toNumber(
                source.upper
            );

        this.intervals.push({

            level:
                toNumber(
                    source.level
                ),

            lower,

            upper,

            width:
                lower !== null &&
                upper !== null
                    ? round(
                        upper - lower,
                        4
                    )
                    : null,

            midpoint:
                lower !== null &&
                upper !== null
                    ? round(
                        (
                            lower +
                            upper
                        ) / 2,
                        4
                    )
                    : null,

            calibrated:
                Boolean(
                    source.calibrated
                )
        });

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return true;
    }

    intervalContains(
        value,
        confidenceLevel = null
    ) {

        const numericValue =
            toNumber(
                value
            );

        if (
            numericValue === null
        ) {
            return false;
        }

        const interval =
            confidenceLevel === null
                ? this.intervals[0]
                : this.intervals.find(
                    item =>
                        item.level ===
                        Number(
                            confidenceLevel
                        )
                );

        if (!interval) {
            return false;
        }

        return (
            numericValue >=
                interval.lower &&
            numericValue <=
                interval.upper
        );
    }

    /**
     * =========================================================================
     * Scenario Management
     * =========================================================================
     */

    addScenario(
        scenario
    ) {

        if (
            this.scenarios.length >=
            DEFAULTS.maximumScenarios
        ) {
            return false;
        }

        this.scenarios.push(
            clone(
                scenario
            )
        );

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return true;
    }

    getScenario(
        type
    ) {

        const normalized =
            normalizeEnum(
                type,
                Object.values(
                    SCENARIO_TYPE
                ),
                null
            );

        if (!normalized) {
            return null;
        }

        return (
            this.scenarios.find(
                scenario =>
                    scenario.type ===
                    normalized
            ) ||
            null
        );
    }

    /**
     * =========================================================================
     * Feature / Explainability Management
     * =========================================================================
     */

    addFeatureAttribution(
        attribution
    ) {

        if (
            this.explainability
                .attributions
                .length >=
            DEFAULTS.maximumAttributions
        ) {
            return false;
        }

        this.explainability
            .attributions
            .push(
                clone(
                    attribution
                )
            );

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return true;
    }

    /**
     * =========================================================================
     * Actualization
     * =========================================================================
     */

    actualize(
        actualValue
    ) {

        const actual =
            toNumber(
                actualValue
            );

        const predicted =
            toNumber(
                this.prediction.value
            );

        if (
            actual === null ||
            predicted === null
        ) {
            throw new TypeError(
                'Both actualValue and prediction.value must be numeric.'
            );
        }

        const error =
            actual -
            predicted;

        const absoluteError =
            Math.abs(
                error
            );

        const percentageError =
            predicted === 0
                ? null
                : (
                    absoluteError /
                    Math.abs(
                        predicted
                    )
                ) * 100;

        this.validation =
            this._normalizeValidation({

                ...this.validation,

                status:
                    VALIDATION_STATUS.PASSED,

                actualValue:
                    actual,

                absoluteError:
                    round(
                        absoluteError,
                        4
                    ),

                percentageError:
                    percentageError === null
                        ? null
                        : round(
                            percentageError,
                            4
                        ),

                validatedAt:
                    new Date()
            });

        this.performance =
            this._normalizePerformance({

                ...this.performance,

                actualValue:
                    actual,

                error:
                    round(
                        error,
                        4
                    ),

                absoluteError:
                    round(
                        absoluteError,
                        4
                    ),

                percentageError:
                    percentageError === null
                        ? null
                        : round(
                            percentageError,
                            4
                        ),

                validated:
                    true
            });

        this.actualizedAt =
            new Date();

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this.performance;
    }

    /**
     * =========================================================================
     * Accuracy
     * =========================================================================
     */

    calculateAccuracyScore() {

        const error =
            toNumber(
                this.performance.percentageError
            );

        if (error === null) {
            return null;
        }

        const score =
            clamp(
                100 -
                error,
                0,
                100
            );

        this.performance.accuracyScore =
            round(
                score,
                2
            );

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this.performance.accuracyScore;
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validate(
        options = {}
    ) {

        const errors = [];
        const warnings = [];

        const requireTenant =
            options.requireTenant !== false;

        if (
            requireTenant &&
            !this.tenantId
        ) {
            errors.push({
                code:
                    'TENANT_ID_REQUIRED',
                field:
                    'tenantId',
                message:
                    'tenantId is required for tenant-scoped forecasts.'
            });
        }

        if (
            !this.forecastId
        ) {
            errors.push({
                code:
                    'FORECAST_ID_REQUIRED',
                field:
                    'forecastId',
                message:
                    'forecastId is required.'
            });
        }

        if (
            this.observationPeriod.start &&
            this.observationPeriod.end &&
            this.observationPeriod.start >
                this.observationPeriod.end
        ) {
            errors.push({
                code:
                    'INVALID_OBSERVATION_PERIOD',
                field:
                    'observationPeriod',
                message:
                    'Observation period start cannot be after end.'
            });
        }

        if (
            this.forecastPeriod.start &&
            this.forecastPeriod.end &&
            this.forecastPeriod.start >
                this.forecastPeriod.end
        ) {
            errors.push({
                code:
                    'INVALID_FORECAST_PERIOD',
                field:
                    'forecastPeriod',
                message:
                    'Forecast period start cannot be after end.'
            });
        }

        if (
            this.prediction.value === null &&
            this.predictions.length === 0
        ) {
            errors.push({
                code:
                    'PREDICTION_REQUIRED',
                field:
                    'prediction',
                message:
                    'A primary prediction or prediction series is required.'
            });
        }

        if (
            this.confidence.score !== null &&
            (
                this.confidence.score < 0 ||
                this.confidence.score > 100
            )
        ) {
            errors.push({
                code:
                    'INVALID_CONFIDENCE',
                field:
                    'confidence.score',
                message:
                    'Confidence score must be between 0 and 100.'
            });
        }

        if (
            this.training.sampleCount !== null &&
            this.training.sampleCount < 0
        ) {
            errors.push({
                code:
                    'INVALID_SAMPLE_COUNT',
                field:
                    'training.sampleCount',
                message:
                    'Training sample count cannot be negative.'
            });
        }

        if (
            this.training.leakageDetected
        ) {
            errors.push({
                code:
                    'DATA_LEAKAGE_DETECTED',
                field:
                    'training.leakageDetected',
                message:
                    'Forecast cannot be considered production-valid when data leakage is detected.'
            });
        }

        if (
            this.dataQuality.missingCriticalInputs
        ) {
            warnings.push({
                code:
                    'MISSING_CRITICAL_INPUTS',
                field:
                    'dataQuality',
                message:
                    'One or more critical forecast inputs are missing.'
            });
        }

        if (
            this.dataQuality.stale
        ) {
            warnings.push({
                code:
                    'STALE_DATA',
                field:
                    'dataQuality.stale',
                message:
                    'Forecast input data is considered stale.'
            });
        }

        if (
            this.isLowConfidence()
        ) {
            warnings.push({
                code:
                    'LOW_FORECAST_CONFIDENCE',
                field:
                    'confidence.score',
                message:
                    'Forecast confidence is below the normal operational threshold.'
            });
        }

        if (
            this.model.version === null
        ) {
            warnings.push({
                code:
                    'MODEL_VERSION_MISSING',
                field:
                    'model.version',
                message:
                    'Forecast model version is not recorded.'
            });
        }

        if (
            this.features.version === null
        ) {
            warnings.push({
                code:
                    'FEATURE_VERSION_MISSING',
                field:
                    'features.version',
                message:
                    'Feature version is not recorded.'
            });
        }

        if (
            this.status ===
                FORECAST_STATUS.PUBLISHED &&
            !this.publishedAt
        ) {
            errors.push({
                code:
                    'PUBLISHED_TIMESTAMP_REQUIRED',
                field:
                    'publishedAt',
                message:
                    'Published forecasts must have publishedAt.'
            });
        }

        return {

            valid:
                errors.length === 0,

            errors,

            warnings
        };
    }

    isValid(options = {}) {

        return this.validate(
            options
        ).valid;
    }

    assertValid(options = {}) {

        const validation =
            this.validate(
                options
            );

        if (
            !validation.valid
        ) {

            const error =
                new Error(
                    'Invalid RepairForecast.'
                );

            error.code =
                'INVALID_REPAIR_FORECAST';

            error.details =
                validation.errors;

            throw error;
        }

        return this;
    }

    /**
     * =========================================================================
     * Expiration
     * =========================================================================
     */

    isExpired(
        referenceDate = new Date()
    ) {

        if (!this.validUntil) {
            return false;
        }

        const reference =
            normalizeDate(
                referenceDate
            );

        if (!reference) {
            return false;
        }

        return (
            this.validUntil.getTime() <=
            reference.getTime()
        );
    }

    isActive(
        referenceDate = new Date()
    ) {

        const reference =
            normalizeDate(
                referenceDate
            );

        if (!reference) {
            return false;
        }

        if (
            this.status ===
                FORECAST_STATUS.EXPIRED ||
            this.status ===
                FORECAST_STATUS.SUPERSEDED ||
            this.status ===
                FORECAST_STATUS.FAILED ||
            this.status ===
                FORECAST_STATUS.INVALID
        ) {
            return false;
        }

        if (
            this.validFrom &&
            reference <
                this.validFrom
        ) {
            return false;
        }

        if (
            this.validUntil &&
            reference >
                this.validUntil
        ) {
            return false;
        }

        return true;
    }

    /**
     * =========================================================================
     * Scheduling Helpers
     * =========================================================================
     */

    isSchedulingEligible(
        minimumConfidence = 70
    ) {

        return (
            this.isActive() &&
            this.isHighConfidence(
                minimumConfidence
            ) &&
            !this.dataQuality.stale &&
            !this.dataQuality.missingCriticalInputs &&
            this.status !==
                FORECAST_STATUS.FAILED &&
            this.status !==
                FORECAST_STATUS.INVALID
        );
    }

    /**
     * =========================================================================
     * Risk Helpers
     * =========================================================================
     */

    isHighRisk() {

        return [
            RISK_LEVEL.HIGH,
            RISK_LEVEL.CRITICAL
        ].includes(
            this.risk.riskLevel
        );
    }

    requiresReview() {

        return (
            this.isHighRisk() ||
            this.isLowConfidence() ||
            this.dataQuality.stale ||
            this.dataQuality.missingCriticalInputs ||
            this.validation.status ===
                VALIDATION_STATUS.FAILED
        );
    }

    /**
     * =========================================================================
     * Tags
     * =========================================================================
     */

    addTag(tag) {

        const normalized =
            normalizeString(
                tag
            );

        if (!normalized) {
            return false;
        }

        const exists =
            this.tags.some(
                existing =>
                    existing.toLowerCase() ===
                    normalized.toLowerCase()
            );

        if (exists) {
            return false;
        }

        if (
            this.tags.length >=
            DEFAULTS.maximumTags
        ) {
            return false;
        }

        this.tags.push(
            normalized
        );

        this.refreshFingerprint();

        return true;
    }

    /**
     * =========================================================================
     * Custom Metrics
     * =========================================================================
     */

    setCustomMetric(
        name,
        value
    ) {

        const normalized =
            normalizeString(
                name
            );

        if (!normalized) {
            return false;
        }

        const exists =
            Object.prototype.hasOwnProperty.call(
                this.customMetrics,
                normalized
            );

        if (
            !exists &&
            Object.keys(
                this.customMetrics
            ).length >=
                DEFAULTS.maximumMetrics
        ) {
            return false;
        }

        this.customMetrics[
            normalized
        ] =
            clone(value);

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return true;
    }

    /**
     * =========================================================================
     * History
     * =========================================================================
     */

    addHistory(
        event,
        details = {}
    ) {

        if (
            this.history.length >=
            DEFAULTS.maximumHistory
        ) {
            this.history.shift();
        }

        this.history.push({

            event:
                normalizeString(
                    event
                ),

            timestamp:
                new Date(),

            status:
                this.status,

            details:
                clone(
                    details
                )
        });

        this.updatedAt =
            new Date();

        this.refreshFingerprint();

        return this;
    }

    /**
     * =========================================================================
     * Forecast ID
     * =========================================================================
     */

    _generateForecastId() {

        const timestamp =
            Date.now()
                .toString(36);

        const entropy =
            crypto
                .randomBytes(12)
                .toString('hex');

        return (
            `repair-forecast-${timestamp}-${entropy}`
        );
    }

    /**
     * =========================================================================
     * Integrity
     * =========================================================================
     */

    generateFingerprint() {

        return sha256({

            model:
                MODEL_NAME,

            schemaVersion:
                this.schemaVersion,

            forecastId:
                this.forecastId,

            forecastRunId:
                this.forecastRunId,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            groupId:
                this.groupId,

            branchId:
                this.branchId,

            accountId:
                this.accountId,

            scope:
                this.scope,

            scopeType:
                this.scopeType,

            forecastType:
                this.forecastType,

            status:
                this.status,

            direction:
                this.direction,

            modelFamily:
                this.modelFamily,

            observationPeriod:
                this.observationPeriod,

            horizon:
                this.horizon,

            forecastPeriod:
                this.forecastPeriod,

            prediction:
                this.prediction,

            predictions:
                this.predictions,

            confidence:
                this.confidence,

            intervals:
                this.intervals,

            model:
                this.model,

            training:
                this.training,

            features:
                this.features,

            explainability:
                this.explainability,

            scenarios:
                this.scenarios,

            financialImpact:
                this.financialImpact,

            operationalImpact:
                this.operationalImpact,

            risk:
                this.risk,

            dataQuality:
                this.dataQuality,

            validation:
                this.validation,

            performance:
                this.performance,

            scheduling:
                this.scheduling,

            customMetrics:
                this.customMetrics
        });
    }

    refreshFingerprint() {

        this.fingerprint =
            this.generateFingerprint();

        return this.fingerprint;
    }

    verifyFingerprint() {

        if (!this.fingerprint) {
            return false;
        }

        return (
            this.fingerprint ===
            this.generateFingerprint()
        );
    }

    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     */

    toObject(options = {}) {

        const includeHistory =
            options.includeHistory !== false;

        const includeDiagnostics =
            options.includeDiagnostics !== false;

        const includeMetadata =
            options.includeMetadata !== false;

        const includeFingerprint =
            options.includeFingerprint !== false;

        const result = {

            model:
                this.model,

            schemaVersion:
                this.schemaVersion,

            id:
                this.id,

            forecastId:
                this.forecastId,

            forecastRunId:
                this.forecastRunId,

            correlationId:
                this.correlationId,

            parentForecastId:
                this.parentForecastId,

            supersedesForecastId:
                this.supersedesForecastId,

            tenantId:
                this.tenantId,

            organizationId:
                this.organizationId,

            groupId:
                this.groupId,

            branchId:
                this.branchId,

            accountId:
                this.accountId,

            scope:
                this.scope,

            scopeType:
                this.scopeType,

            environment:
                this.environment,

            forecastType:
                this.forecastType,

            status:
                this.status,

            direction:
                this.direction,

            modelFamily:
                this.modelFamily,

            observationPeriod:
                clone(
                    this.observationPeriod
                ),

            horizon:
                clone(
                    this.horizon
                ),

            forecastPeriod:
                clone(
                    this.forecastPeriod
                ),

            prediction:
                clone(
                    this.prediction
                ),

            predictions:
                clone(
                    this.predictions
                ),

            confidence:
                clone(
                    this.confidence
                ),

            intervals:
                clone(
                    this.intervals
                ),

            model:
                clone(
                    this.model
                ),

            training:
                clone(
                    this.training
                ),

            features:
                clone(
                    this.features
                ),

            explainability:
                clone(
                    this.explainability
                ),

            scenarios:
                clone(
                    this.scenarios
                ),

            financialImpact:
                clone(
                    this.financialImpact
                ),

            operationalImpact:
                clone(
                    this.operationalImpact
                ),

            risk:
                clone(
                    this.risk
                ),

            dataQuality:
                clone(
                    this.dataQuality
                ),

            validation:
                clone(
                    this.validation
                ),

            performance:
                clone(
                    this.performance
                ),

            scheduling:
                clone(
                    this.scheduling
                ),

            tags:
                clone(
                    this.tags
                ),

            provenance:
                clone(
                    this.provenance
                ),

            requestId:
                this.requestId,

            traceId:
                this.traceId,

            createdBy:
                this.createdBy,

            updatedBy:
                this.updatedBy,

            createdAt:
                clone(
                    this.createdAt
                ),

            updatedAt:
                clone(
                    this.updatedAt
                ),

            generatedAt:
                clone(
                    this.generatedAt
                ),

            validFrom:
                clone(
                    this.validFrom
                ),

            validUntil:
                clone(
                    this.validUntil
                ),

            publishedAt:
                clone(
                    this.publishedAt
                ),

            validatedAt:
                clone(
                    this.validatedAt
                ),

            actualizedAt:
                clone(
                    this.actualizedAt
                )
        };

        if (
            includeDiagnostics
        ) {

            result.alerts =
                clone(
                    this.alerts
                );

            result.warnings =
                clone(
                    this.warnings
                );

            result.errors =
                clone(
                    this.errors
                );
        }

        if (
            includeHistory
        ) {

            result.history =
                clone(
                    this.history
                );
        }

        if (
            includeMetadata
        ) {

            result.metadata =
                clone(
                    this.metadata
                );
        }

        if (
            includeFingerprint
        ) {

            result.fingerprint =
                this.fingerprint;
        }

        return result;
    }

    toJSON() {

        return this.toObject();
    }

    toPersistence() {

        return this.toObject({

            includeHistory:
                true,

            includeDiagnostics:
                true,

            includeMetadata:
                true,

            includeFingerprint:
                true
        });
    }

    /**
     * =========================================================================
     * Static Constructors
     * =========================================================================
     */

    static create(data = {}) {

        return new RepairForecast(
            data
        );
    }

    static from(data = {}) {

        if (
            data instanceof
            RepairForecast
        ) {
            return new RepairForecast(
                data.toObject()
            );
        }

        return new RepairForecast(
            data
        );
    }

    static volume(data = {}) {

        return new RepairForecast({

            ...data,

            forecastType:
                FORECAST_TYPE.REPAIR_VOLUME
        });
    }

    static failure(data = {}) {

        return new RepairForecast({

            ...data,

            forecastType:
                FORECAST_TYPE.REPAIR_FAILURE
        });
    }

    static backlog(data = {}) {

        return new RepairForecast({

            ...data,

            forecastType:
                FORECAST_TYPE.REPAIR_BACKLOG
        });
    }

    static amount(data = {}) {

        return new RepairForecast({

            ...data,

            forecastType:
                FORECAST_TYPE.REPAIR_AMOUNT
        });
    }

    static variance(data = {}) {

        return new RepairForecast({

            ...data,

            forecastType:
                FORECAST_TYPE.VARIANCE_AMOUNT
        });
    }

    static composite(data = {}) {

        return new RepairForecast({

            ...data,

            forecastType:
                FORECAST_TYPE.COMPOSITE
        });
    }

    /**
     * =========================================================================
     * Constants
     * =========================================================================
     */

    static get MODEL_NAME() {
        return MODEL_NAME;
    }

    static get SCHEMA_VERSION() {
        return SCHEMA_VERSION;
    }

    static get FORECAST_STATUS() {
        return FORECAST_STATUS;
    }

    static get FORECAST_TYPE() {
        return FORECAST_TYPE;
    }

    static get FORECAST_DIRECTION() {
        return FORECAST_DIRECTION;
    }

    static get CONFIDENCE_LEVEL() {
        return CONFIDENCE_LEVEL;
    }

    static get RISK_LEVEL() {
        return RISK_LEVEL;
    }

    static get HORIZON_UNIT() {
        return HORIZON_UNIT;
    }

    static get GRANULARITY() {
        return GRANULARITY;
    }

    static get MODEL_FAMILY() {
        return MODEL_FAMILY;
    }

    static get VALIDATION_STATUS() {
        return VALIDATION_STATUS;
    }

    static get DATA_QUALITY_LEVEL() {
        return DATA_QUALITY_LEVEL;
    }

    static get SCENARIO_TYPE() {
        return SCENARIO_TYPE;
    }
}

/**
 * ============================================================================
 * Internal compatibility helper
 * ============================================================================
 *
 * Kept outside the class so malformed direction values cannot break
 * construction of the prediction object.
 * ============================================================================
 */

function thisDirection(value) {

    const normalized =
        normalizeString(value);

    if (!normalized) {
        return FORECAST_DIRECTION.UNKNOWN;
    }

    const upper =
        normalized.toUpperCase();

    return Object.values(
        FORECAST_DIRECTION
    ).includes(upper)
        ? upper
        : FORECAST_DIRECTION.UNKNOWN;
}

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 *
 * Supports:
 *
 *   const RepairForecast =
 *       require('./RepairForecast');
 *
 * and:
 *
 *   const {
 *       RepairForecast,
 *       FORECAST_TYPE,
 *       FORECAST_STATUS
 *   } = require('./RepairForecast');
 *
 * ============================================================================
 */

module.exports =
    RepairForecast;

module.exports.RepairForecast =
    RepairForecast;

module.exports.FORECAST_STATUS =
    FORECAST_STATUS;

module.exports.FORECAST_TYPE =
    FORECAST_TYPE;

module.exports.FORECAST_DIRECTION =
    FORECAST_DIRECTION;

module.exports.CONFIDENCE_LEVEL =
    CONFIDENCE_LEVEL;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.HORIZON_UNIT =
    HORIZON_UNIT;

module.exports.GRANULARITY =
    GRANULARITY;

module.exports.MODEL_FAMILY =
    MODEL_FAMILY;

module.exports.VALIDATION_STATUS =
    VALIDATION_STATUS;

module.exports.DATA_QUALITY_LEVEL =
    DATA_QUALITY_LEVEL;

module.exports.SCENARIO_TYPE =
    SCENARIO_TYPE;

module.exports.SCHEMA_VERSION =
    SCHEMA_VERSION;
