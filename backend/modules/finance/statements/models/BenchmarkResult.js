'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * BenchmarkResult
 * ============================================================================
 *
 * Enterprise-grade domain model for financial statement benchmarking.
 *
 * Location:
 *   backend/modules/finance/statements/models/BenchmarkResult.js
 *
 * Purpose
 * -------
 * Represents the normalized result of comparing a financial statement,
 * account, branch, tenant, settlement stream, repair process, or other
 * financial operational metric against one or more benchmark baselines.
 *
 * Design goals
 * ------------
 * - Deterministic normalization
 * - Strong input validation
 * - Tenant isolation awareness
 * - Auditability
 * - Versioned result schema
 * - Explainable benchmark outcomes
 * - Safe handling of incomplete benchmark data
 * - Backward-compatible construction
 * - Serialization support
 * - No database or infrastructure coupling
 * - No mutation of caller-owned objects
 * - Suitable for persistence, events, APIs, reporting and analytics
 *
 * This class is intentionally persistence-agnostic.
 *
 * Repository/services are responsible for:
 *   - MongoDB/Mongoose persistence
 *   - transactions
 *   - event publishing
 *   - authorization
 *   - tenant enforcement
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const MODEL_NAME = 'BenchmarkResult';

const SCHEMA_VERSION = '1.0.0';

const STATUS = Object.freeze({
    PENDING: 'PENDING',
    CALCULATED: 'CALCULATED',
    PARTIAL: 'PARTIAL',
    FAILED: 'FAILED',
    INVALID: 'INVALID'
});

const PERFORMANCE = Object.freeze({
    EXCEPTIONAL: 'EXCEPTIONAL',
    ABOVE_BENCHMARK: 'ABOVE_BENCHMARK',
    WITHIN_BENCHMARK: 'WITHIN_BENCHMARK',
    BELOW_BENCHMARK: 'BELOW_BENCHMARK',
    CRITICAL: 'CRITICAL',
    UNKNOWN: 'UNKNOWN'
});

const BENCHMARK_TYPE = Object.freeze({
    INTERNAL: 'INTERNAL',
    HISTORICAL: 'HISTORICAL',
    PEER: 'PEER',
    INDUSTRY: 'INDUSTRY',
    TARGET: 'TARGET',
    REGULATORY: 'REGULATORY',
    SYSTEM: 'SYSTEM',
    CUSTOM: 'CUSTOM'
});

const METRIC_DIRECTION = Object.freeze({
    HIGHER_IS_BETTER: 'HIGHER_IS_BETTER',
    LOWER_IS_BETTER: 'LOWER_IS_BETTER',
    TARGET_RANGE: 'TARGET_RANGE',
    NEUTRAL: 'NEUTRAL'
});

const SEVERITY = Object.freeze({
    INFO: 'INFO',
    LOW: 'LOW',
    MODERATE: 'MODERATE',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL'
});

const DEFAULTS = Object.freeze({
    tolerancePercent: 5,
    warningThresholdPercent: 10,
    criticalThresholdPercent: 25,

    minimumConfidence: 0,
    maximumConfidence: 1,

    minimumScore: 0,
    maximumScore: 100,

    maximumDimensions: 100,
    maximumIndicators: 100,
    maximumExplanations: 100,
    maximumTags: 50
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

function toNumber(value, fallback = null) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return fallback;
    }

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function clamp(value, minimum, maximum) {
    const numeric = toNumber(value, minimum);

    return Math.min(
        maximum,
        Math.max(minimum, numeric)
    );
}

function round(value, decimals = 4) {
    const numeric = toNumber(value, 0);

    const factor = 10 ** decimals;

    return Math.round(
        numeric * factor
    ) / factor;
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

function normalizeEnum(value, allowed, fallback) {
    const normalized = normalizeString(value);

    if (!normalized) {
        return fallback;
    }

    const upper = normalized.toUpperCase();

    return allowed.includes(upper)
        ? upper
        : fallback;
}

function normalizeDate(value, fallback = null) {
    if (!value) {
        return fallback;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? fallback
            : new Date(value.getTime());
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? fallback
        : date;
}

function normalizeArray(value, max = Infinity) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .slice(0, max)
        .map(clone);
}

function uniqueStrings(values, max = Infinity) {
    if (!Array.isArray(values)) {
        return [];
    }

    const result = [];
    const seen = new Set();

    for (const value of values) {
        const normalized = normalizeString(value);

        if (!normalized) {
            continue;
        }

        const key = normalized.toLowerCase();

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push(normalized);

        if (result.length >= max) {
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
        return `[${value.map(stableSerialize).join(',')}]`;
    }

    if (isObject(value)) {
        return `{${Object.keys(value)
            .sort()
            .map(key => (
                `${JSON.stringify(key)}:${stableSerialize(value[key])}`
            ))
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

function sha256(value) {
    return crypto
        .createHash('sha256')
        .update(stableSerialize(value))
        .digest('hex');
}

function now() {
    return new Date();
}

/**
 * ============================================================================
 * BenchmarkResult
 * ============================================================================
 */

class BenchmarkResult {

    /**
     * @param {Object} data
     */
    constructor(data = {}) {

        if (!isObject(data)) {
            throw new TypeError(
                'BenchmarkResult data must be an object.'
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

        const source = clone(data);

        this.model = MODEL_NAME;

        this.schemaVersion =
            normalizeString(
                source.schemaVersion,
                SCHEMA_VERSION
            );

        this.id =
            normalizeString(
                source.id ||
                source._id ||
                source.resultId
            );

        this.resultId =
            this.id ||
            normalizeString(source.resultId);

        /**
         * Multi-tenancy.
         *
         * tenantId is intentionally represented but not enforced here.
         * Authorization and tenant ownership belong to the service/repository
         * boundary.
         */
        this.tenantId =
            normalizeString(source.tenantId);

        this.organizationId =
            normalizeString(source.organizationId);

        this.groupId =
            normalizeString(source.groupId);

        this.branchId =
            normalizeString(source.branchId);

        this.accountId =
            normalizeString(source.accountId);

        this.statementId =
            normalizeString(source.statementId);

        this.batchId =
            normalizeString(source.batchId);

        this.metricId =
            normalizeString(
                source.metricId ||
                source.metric
            );

        this.metricName =
            normalizeString(
                source.metricName ||
                source.name
            );

        this.metricCategory =
            normalizeString(
                source.metricCategory ||
                source.category
            );

        this.metricUnit =
            normalizeString(
                source.metricUnit ||
                source.unit
            );

        this.benchmarkType =
            normalizeEnum(
                source.benchmarkType ||
                source.type,
                Object.values(BENCHMARK_TYPE),
                BENCHMARK_TYPE.CUSTOM
            );

        this.direction =
            normalizeEnum(
                source.direction ||
                source.metricDirection,
                Object.values(METRIC_DIRECTION),
                METRIC_DIRECTION.NEUTRAL
            );

        this.status =
            normalizeEnum(
                source.status,
                Object.values(STATUS),
                STATUS.CALCULATED
            );

        /**
         * Actual observed value.
         */
        this.actual = toNumber(
            source.actual !== undefined
                ? source.actual
                : source.actualValue
        );

        /**
         * Primary benchmark/reference value.
         */
        this.benchmark = toNumber(
            source.benchmark !== undefined
                ? source.benchmark
                : source.benchmarkValue
        );

        this.target = toNumber(
            source.target !== undefined
                ? source.target
                : source.targetValue
        );

        this.minimum = toNumber(
            source.minimum !== undefined
                ? source.minimum
                : source.min
        );

        this.maximum = toNumber(
            source.maximum !== undefined
                ? source.maximum
                : source.max
        );

        this.peerAverage =
            toNumber(source.peerAverage);

        this.peerMedian =
            toNumber(source.peerMedian);

        this.historicalAverage =
            toNumber(source.historicalAverage);

        this.industryAverage =
            toNumber(source.industryAverage);

        /**
         * Absolute and relative variance.
         */
        this.absoluteVariance =
            toNumber(
                source.absoluteVariance
            );

        this.variancePercent =
            toNumber(
                source.variancePercent
            );

        this.normalizedVariance =
            toNumber(
                source.normalizedVariance
            );

        /**
         * Performance score.
         *
         * 0   = materially poor
         * 100 = materially strong
         *
         * Interpretation depends on direction.
         */
        this.score =
            toNumber(source.score);

        this.confidence =
            clamp(
                firstNumber(
                    source.confidence,
                    source.confidenceScore
                ),
                DEFAULTS.minimumConfidence,
                DEFAULTS.maximumConfidence
            );

        this.performance =
            normalizeEnum(
                source.performance ||
                source.performanceBand ||
                source.classification,
                Object.values(PERFORMANCE),
                PERFORMANCE.UNKNOWN
            );

        this.severity =
            normalizeEnum(
                source.severity ||
                source.riskLevel,
                Object.values(SEVERITY),
                SEVERITY.INFO
            );

        this.tolerancePercent =
            Math.max(
                0,
                toNumber(
                    source.tolerancePercent,
                    DEFAULTS.tolerancePercent
                )
            );

        this.warningThresholdPercent =
            Math.max(
                this.tolerancePercent,
                toNumber(
                    source.warningThresholdPercent,
                    DEFAULTS.warningThresholdPercent
                )
            );

        this.criticalThresholdPercent =
            Math.max(
                this.warningThresholdPercent,
                toNumber(
                    source.criticalThresholdPercent,
                    DEFAULTS.criticalThresholdPercent
                )
            );

        /**
         * Dimensional benchmark context.
         */
        this.dimensions =
            normalizeArray(
                source.dimensions,
                DEFAULTS.maximumDimensions
            );

        this.indicators =
            normalizeArray(
                source.indicators,
                DEFAULTS.maximumIndicators
            );

        this.peerGroup =
            normalizeArray(
                source.peerGroup,
                DEFAULTS.maximumDimensions
            );

        this.explanations =
            normalizeArray(
                source.explanations ||
                source.reasons,
                DEFAULTS.maximumExplanations
            );

        this.recommendations =
            normalizeArray(
                source.recommendations,
                DEFAULTS.maximumExplanations
            );

        this.tags =
            uniqueStrings(
                source.tags,
                DEFAULTS.maximumTags
            );

        /**
         * Data quality metadata.
         */
        this.dataQuality = this._normalizeDataQuality(
            source.dataQuality ||
            source.quality
        );

        /**
         * Benchmark provenance.
         */
        this.provenance = this._normalizeProvenance(
            source.provenance ||
            source.source
        );

        /**
         * Calculation metadata.
         */
        this.calculation = this._normalizeCalculation(
            source.calculation
        );

        /**
         * Period information.
         */
        this.period = this._normalizePeriod(
            source.period
        );

        /**
         * Lifecycle timestamps.
         */
        const createdAt =
            normalizeDate(source.createdAt) ||
            now();

        this.createdAt = createdAt;

        this.updatedAt =
            normalizeDate(source.updatedAt) ||
            new Date(createdAt.getTime());

        this.calculatedAt =
            normalizeDate(source.calculatedAt) ||
            (
                this.status === STATUS.CALCULATED ||
                this.status === STATUS.PARTIAL
                    ? new Date(createdAt.getTime())
                    : null
            );

        this.expiresAt =
            normalizeDate(source.expiresAt);

        /**
         * Correlation and observability metadata.
         */
        this.correlationId =
            normalizeString(source.correlationId);

        this.requestId =
            normalizeString(source.requestId);

        this.traceId =
            normalizeString(source.traceId);

        this.createdBy =
            normalizeString(source.createdBy);

        this.updatedBy =
            normalizeString(source.updatedBy);

        /**
         * Extensible metadata.
         *
         * Kept deliberately separate from financial facts.
         */
        this.metadata =
            isObject(source.metadata)
                ? clone(source.metadata)
                : {};

        /**
         * Integrity fingerprint is calculated after normalization.
         */
        this.fingerprint =
            normalizeString(source.fingerprint) ||
            this.generateFingerprint();
    }

    /**
     * =========================================================================
     * Normalization Helpers
     * =========================================================================
     */

    _normalizeDataQuality(data = {}) {

        if (!isObject(data)) {
            return {
                score: null,
                completeness: null,
                reliability: null,
                warnings: [],
                missingFields: []
            };
        }

        return {
            score: clamp(
                toNumber(data.score, 0),
                0,
                100
            ),

            completeness: clamp(
                toNumber(data.completeness, 0),
                0,
                100
            ),

            reliability: clamp(
                toNumber(data.reliability, 0),
                0,
                100
            ),

            warnings: uniqueStrings(
                data.warnings,
                DEFAULTS.maximumExplanations
            ),

            missingFields: uniqueStrings(
                data.missingFields,
                DEFAULTS.maximumExplanations
            )
        };
    }

    _normalizeProvenance(data = {}) {

        if (!isObject(data)) {
            return {
                source: null,
                sourceId: null,
                sourceVersion: null,
                benchmarkId: null,
                modelVersion: null,
                generatedBy: null
            };
        }

        return {
            source: normalizeString(
                data.source
            ),

            sourceId: normalizeString(
                data.sourceId
            ),

            sourceVersion: normalizeString(
                data.sourceVersion
            ),

            benchmarkId: normalizeString(
                data.benchmarkId
            ),

            modelVersion: normalizeString(
                data.modelVersion
            ),

            generatedBy: normalizeString(
                data.generatedBy
            )
        };
    }

    _normalizeCalculation(data = {}) {

        if (!isObject(data)) {
            return {
                method: null,
                formula: null,
                version: null,
                durationMs: null,
                inputCount: null,
                sampleSize: null
            };
        }

        return {
            method: normalizeString(
                data.method
            ),

            formula: normalizeString(
                data.formula
            ),

            version: normalizeString(
                data.version
            ),

            durationMs: toNumber(
                data.durationMs
            ),

            inputCount: toNumber(
                data.inputCount
            ),

            sampleSize: toNumber(
                data.sampleSize
            )
        };
    }

    _normalizePeriod(data = {}) {

        if (!isObject(data)) {
            return {
                start: null,
                end: null,
                fiscalYear: null,
                fiscalPeriod: null,
                timezone: null
            };
        }

        return {
            start: normalizeDate(data.start),
            end: normalizeDate(data.end),

            fiscalYear:
                toNumber(data.fiscalYear),

            fiscalPeriod:
                normalizeString(data.fiscalPeriod),

            timezone:
                normalizeString(data.timezone)
        };
    }

    /**
     * =========================================================================
     * Calculation
     * =========================================================================
     */

    calculate() {

        if (
            this.actual === null ||
            this.benchmark === null
        ) {
            this.status = STATUS.PARTIAL;
            this.performance = PERFORMANCE.UNKNOWN;
            this.severity = SEVERITY.INFO;

            return this;
        }

        this.absoluteVariance =
            round(
                this.actual -
                this.benchmark
            );

        this.variancePercent =
            this._calculateVariancePercent(
                this.actual,
                this.benchmark
            );

        this.normalizedVariance =
            this._normalizeVariance(
                this.variancePercent
            );

        this.score =
            this._calculatePerformanceScore();

        this.performance =
            this._classifyPerformance(
                this.variancePercent
            );

        this.severity =
            this._classifySeverity(
                this.variancePercent
            );

        this.confidence =
            this._calculateConfidence();

        this.status =
            this._hasCompleteBenchmarkContext()
                ? STATUS.CALCULATED
                : STATUS.PARTIAL;

        this.calculatedAt = now();
        this.updatedAt = new Date(
            this.calculatedAt.getTime()
        );

        this.fingerprint =
            this.generateFingerprint();

        return this;
    }

    _calculateVariancePercent(
        actual,
        benchmark
    ) {

        if (benchmark === 0) {

            if (actual === 0) {
                return 0;
            }

            return actual > 0
                ? 100
                : -100;
        }

        return round(
            (
                (actual - benchmark) /
                Math.abs(benchmark)
            ) * 100
        );
    }

    _normalizeVariance(variancePercent) {

        const threshold =
            Math.max(
                this.criticalThresholdPercent,
                1
            );

        return round(
            clamp(
                variancePercent /
                threshold,
                -1,
                1
            )
        );
    }

    _calculatePerformanceScore() {

        if (
            this.actual === null ||
            this.benchmark === null
        ) {
            return null;
        }

        const variance =
            Math.abs(
                toNumber(
                    this.variancePercent,
                    0
                )
            );

        const tolerance =
            Math.max(
                this.tolerancePercent,
                0
            );

        const critical =
            Math.max(
                this.criticalThresholdPercent,
                tolerance + 1
            );

        if (
            this.direction ===
            METRIC_DIRECTION.NEUTRAL
        ) {
            return round(
                clamp(
                    100 -
                    (
                        variance /
                        critical
                    ) * 50,
                    0,
                    100
                ),
                2
            );
        }

        let performanceVariance;

        if (
            this.direction ===
            METRIC_DIRECTION.HIGHER_IS_BETTER
        ) {
            performanceVariance =
                this.actual -
                this.benchmark;
        } else if (
            this.direction ===
            METRIC_DIRECTION.LOWER_IS_BETTER
        ) {
            performanceVariance =
                this.benchmark -
                this.actual;
        } else {
            /**
             * TARGET_RANGE.
             *
             * Being inside the target range receives a full score.
             * Outside the range is penalized progressively.
             */
            if (
                this.minimum !== null &&
                this.maximum !== null &&
                this.actual >= this.minimum &&
                this.actual <= this.maximum
            ) {
                return 100;
            }

            const distance =
                this._distanceFromTargetRange();

            return round(
                clamp(
                    100 -
                    (
                        distance /
                        Math.max(
                            Math.abs(this.benchmark),
                            1
                        )
                    ) * 100,
                    0,
                    100
                ),
                2
            );
        }

        const base =
            Math.abs(this.benchmark) > 0
                ? Math.abs(this.benchmark)
                : 1;

        const normalized =
            performanceVariance /
            base;

        return round(
            clamp(
                50 +
                (
                    normalized *
                    50
                ),
                0,
                100
            ),
            2
        );
    }

    _distanceFromTargetRange() {

        if (
            this.actual === null
        ) {
            return 0;
        }

        if (
            this.minimum !== null &&
            this.actual < this.minimum
        ) {
            return this.minimum - this.actual;
        }

        if (
            this.maximum !== null &&
            this.actual > this.maximum
        ) {
            return this.actual - this.maximum;
        }

        return 0;
    }

    _classifyPerformance(variancePercent) {

        const variance =
            toNumber(
                variancePercent,
                0
            );

        if (
            this.direction ===
            METRIC_DIRECTION.HIGHER_IS_BETTER
        ) {
            if (
                variance >=
                this.criticalThresholdPercent
            ) {
                return PERFORMANCE.EXCEPTIONAL;
            }

            if (
                variance >=
                this.tolerancePercent
            ) {
                return PERFORMANCE.ABOVE_BENCHMARK;
            }

            if (
                variance >=
                -this.tolerancePercent
            ) {
                return PERFORMANCE.WITHIN_BENCHMARK;
            }

            if (
                variance >=
                -this.criticalThresholdPercent
            ) {
                return PERFORMANCE.BELOW_BENCHMARK;
            }

            return PERFORMANCE.CRITICAL;
        }

        if (
            this.direction ===
            METRIC_DIRECTION.LOWER_IS_BETTER
        ) {
            if (
                variance <=
                -this.criticalThresholdPercent
            ) {
                return PERFORMANCE.EXCEPTIONAL;
            }

            if (
                variance <=
                -this.tolerancePercent
            ) {
                return PERFORMANCE.ABOVE_BENCHMARK;
            }

            if (
                Math.abs(variance) <=
                this.tolerancePercent
            ) {
                return PERFORMANCE.WITHIN_BENCHMARK;
            }

            if (
                variance <=
                this.criticalThresholdPercent
            ) {
                return PERFORMANCE.BELOW_BENCHMARK;
            }

            return PERFORMANCE.CRITICAL;
        }

        /**
         * TARGET_RANGE and NEUTRAL.
         */
        if (
            this.minimum !== null &&
            this.maximum !== null &&
            this.actual >= this.minimum &&
            this.actual <= this.maximum
        ) {
            return PERFORMANCE.WITHIN_BENCHMARK;
        }

        return Math.abs(variance) >=
            this.criticalThresholdPercent
            ? PERFORMANCE.CRITICAL
            : PERFORMANCE.BELOW_BENCHMARK;
    }

    _classifySeverity(variancePercent) {

        const absolute =
            Math.abs(
                toNumber(
                    variancePercent,
                    0
                )
            );

        if (
            absolute >=
            this.criticalThresholdPercent
        ) {
            return SEVERITY.CRITICAL;
        }

        if (
            absolute >=
            this.warningThresholdPercent
        ) {
            return SEVERITY.HIGH;
        }

        if (
            absolute >=
            this.tolerancePercent
        ) {
            return SEVERITY.MODERATE;
        }

        if (absolute > 0) {
            return SEVERITY.LOW;
        }

        return SEVERITY.INFO;
    }

    _calculateConfidence() {

        let confidence = 0.50;

        if (
            this.actual !== null
        ) {
            confidence += 0.10;
        }

        if (
            this.benchmark !== null
        ) {
            confidence += 0.10;
        }

        if (
            this.provenance.benchmarkId
        ) {
            confidence += 0.10;
        }

        if (
            this.dataQuality &&
            this.dataQuality.reliability !== null
        ) {
            confidence +=
                (
                    this.dataQuality.reliability /
                    100
                ) * 0.10;
        }

        if (
            this.calculation &&
            this.calculation.sampleSize !== null &&
            this.calculation.sampleSize >= 10
        ) {
            confidence += 0.05;
        }

        if (
            this.period.start &&
            this.period.end
        ) {
            confidence += 0.05;
        }

        return round(
            clamp(
                confidence,
                0,
                1
            ),
            4
        );
    }

    _hasCompleteBenchmarkContext() {

        return (
            this.actual !== null &&
            this.benchmark !== null &&
            this.metricName !== null
        );
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validate(options = {}) {

        const errors = [];
        const warnings = [];

        const requireTenant =
            options.requireTenant !== false;

        if (
            requireTenant &&
            !this.tenantId
        ) {
            errors.push({
                code: 'TENANT_ID_REQUIRED',
                field: 'tenantId',
                message: 'tenantId is required.'
            });
        }

        if (!this.metricName) {
            errors.push({
                code: 'METRIC_NAME_REQUIRED',
                field: 'metricName',
                message: 'metricName is required.'
            });
        }

        if (
            this.actual === null &&
            this.status === STATUS.CALCULATED
        ) {
            errors.push({
                code: 'ACTUAL_VALUE_REQUIRED',
                field: 'actual',
                message: 'A calculated benchmark requires an actual value.'
            });
        }

        if (
            this.benchmark === null &&
            this.status === STATUS.CALCULATED
        ) {
            errors.push({
                code: 'BENCHMARK_VALUE_REQUIRED',
                field: 'benchmark',
                message: 'A calculated benchmark requires a benchmark value.'
            });
        }

        if (
            this.minimum !== null &&
            this.maximum !== null &&
            this.minimum > this.maximum
        ) {
            errors.push({
                code: 'INVALID_TARGET_RANGE',
                field: 'minimum',
                message: 'minimum cannot be greater than maximum.'
            });
        }

        if (
            this.period.start &&
            this.period.end &&
            this.period.start > this.period.end
        ) {
            errors.push({
                code: 'INVALID_PERIOD',
                field: 'period',
                message: 'Period start cannot be after period end.'
            });
        }

        if (
            this.confidence < 0 ||
            this.confidence > 1
        ) {
            errors.push({
                code: 'INVALID_CONFIDENCE',
                field: 'confidence',
                message: 'confidence must be between 0 and 1.'
            });
        }

        if (
            this.status === STATUS.PARTIAL
        ) {
            warnings.push({
                code: 'PARTIAL_RESULT',
                message: 'Benchmark result contains incomplete benchmark context.'
            });
        }

        if (
            this.performance === PERFORMANCE.UNKNOWN
        ) {
            warnings.push({
                code: 'UNKNOWN_PERFORMANCE',
                message: 'Performance classification is unavailable.'
            });
        }

        if (
            this.dataQuality &&
            this.dataQuality.missingFields.length > 0
        ) {
            warnings.push({
                code: 'MISSING_SOURCE_FIELDS',
                fields: clone(
                    this.dataQuality.missingFields
                ),
                message: 'Source data contains missing fields.'
            });
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    isValid(options = {}) {
        return this.validate(options).valid;
    }

    assertValid(options = {}) {

        const validation =
            this.validate(options);

        if (!validation.valid) {

            const error =
                new Error(
                    'Invalid BenchmarkResult.'
                );

            error.code =
                'INVALID_BENCHMARK_RESULT';

            error.details =
                validation.errors;

            throw error;
        }

        return this;
    }

    /**
     * =========================================================================
     * Status Helpers
     * =========================================================================
     */

    isCalculated() {
        return this.status === STATUS.CALCULATED;
    }

    isPartial() {
        return this.status === STATUS.PARTIAL;
    }

    isFailed() {
        return this.status === STATUS.FAILED;
    }

    isComplete() {
        return (
            this.status === STATUS.CALCULATED &&
            this.actual !== null &&
            this.benchmark !== null
        );
    }

    /**
     * =========================================================================
     * Performance Helpers
     * =========================================================================
     */

    isAboveBenchmark() {
        return (
            this.performance ===
                PERFORMANCE.ABOVE_BENCHMARK ||
            this.performance ===
                PERFORMANCE.EXCEPTIONAL
        );
    }

    isWithinBenchmark() {
        return (
            this.performance ===
            PERFORMANCE.WITHIN_BENCHMARK
        );
    }

    isBelowBenchmark() {
        return (
            this.performance ===
                PERFORMANCE.BELOW_BENCHMARK ||
            this.performance ===
                PERFORMANCE.CRITICAL
        );
    }

    isCritical() {
        return (
            this.severity ===
            SEVERITY.CRITICAL ||
            this.performance ===
            PERFORMANCE.CRITICAL
        );
    }

    /**
     * =========================================================================
     * Freshness
     * =========================================================================
     */

    isExpired(referenceDate = new Date()) {

        if (!this.expiresAt) {
            return false;
        }

        const reference =
            normalizeDate(referenceDate);

        if (!reference) {
            return false;
        }

        return (
            this.expiresAt.getTime() <=
            reference.getTime()
        );
    }

    isFresh(referenceDate = new Date()) {
        return !this.isExpired(referenceDate);
    }

    /**
     * =========================================================================
     * Fingerprinting / Integrity
     * =========================================================================
     */

    generateFingerprint() {

        return sha256({
            model: MODEL_NAME,
            schemaVersion: this.schemaVersion,

            tenantId: this.tenantId,
            organizationId: this.organizationId,
            groupId: this.groupId,
            branchId: this.branchId,

            accountId: this.accountId,
            statementId: this.statementId,
            metricId: this.metricId,

            metricName: this.metricName,
            benchmarkType: this.benchmarkType,
            direction: this.direction,

            actual: this.actual,
            benchmark: this.benchmark,
            target: this.target,

            minimum: this.minimum,
            maximum: this.maximum,

            absoluteVariance:
                this.absoluteVariance,

            variancePercent:
                this.variancePercent,

            score: this.score,

            confidence:
                this.confidence,

            performance:
                this.performance,

            severity:
                this.severity,

            calculation:
                this.calculation,

            period:
                this.period,

            provenance:
                this.provenance
        });
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

    refreshFingerprint() {

        this.fingerprint =
            this.generateFingerprint();

        return this.fingerprint;
    }

    /**
     * =========================================================================
     * Serialization
     * =========================================================================
     */

    toObject(options = {}) {

        const includeMetadata =
            options.includeMetadata !== false;

        const includeFingerprint =
            options.includeFingerprint !== false;

        const result = {
            model: this.model,

            schemaVersion:
                this.schemaVersion,

            id: this.id,
            resultId: this.resultId,

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

            statementId:
                this.statementId,

            batchId:
                this.batchId,

            metricId:
                this.metricId,

            metricName:
                this.metricName,

            metricCategory:
                this.metricCategory,

            metricUnit:
                this.metricUnit,

            benchmarkType:
                this.benchmarkType,

            direction:
                this.direction,

            status:
                this.status,

            actual:
                this.actual,

            benchmark:
                this.benchmark,

            target:
                this.target,

            minimum:
                this.minimum,

            maximum:
                this.maximum,

            peerAverage:
                this.peerAverage,

            peerMedian:
                this.peerMedian,

            historicalAverage:
                this.historicalAverage,

            industryAverage:
                this.industryAverage,

            absoluteVariance:
                this.absoluteVariance,

            variancePercent:
                this.variancePercent,

            normalizedVariance:
                this.normalizedVariance,

            score:
                this.score,

            confidence:
                this.confidence,

            performance:
                this.performance,

            severity:
                this.severity,

            tolerancePercent:
                this.tolerancePercent,

            warningThresholdPercent:
                this.warningThresholdPercent,

            criticalThresholdPercent:
                this.criticalThresholdPercent,

            dimensions:
                clone(this.dimensions),

            indicators:
                clone(this.indicators),

            peerGroup:
                clone(this.peerGroup),

            explanations:
                clone(this.explanations),

            recommendations:
                clone(this.recommendations),

            tags:
                clone(this.tags),

            dataQuality:
                clone(this.dataQuality),

            provenance:
                clone(this.provenance),

            calculation:
                clone(this.calculation),

            period:
                clone(this.period),

            correlationId:
                this.correlationId,

            requestId:
                this.requestId,

            traceId:
                this.traceId,

            createdBy:
                this.createdBy,

            updatedBy:
                this.updatedBy,

            createdAt:
                this.createdAt
                    ? new Date(this.createdAt.getTime())
                    : null,

            updatedAt:
                this.updatedAt
                    ? new Date(this.updatedAt.getTime())
                    : null,

            calculatedAt:
                this.calculatedAt
                    ? new Date(this.calculatedAt.getTime())
                    : null,

            expiresAt:
                this.expiresAt
                    ? new Date(this.expiresAt.getTime())
                    : null
        };

        if (includeMetadata) {
            result.metadata =
                clone(this.metadata);
        }

        if (includeFingerprint) {
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
            includeMetadata: true,
            includeFingerprint: true
        });
    }

    /**
     * =========================================================================
     * Static Constructors
     * =========================================================================
     */

    static create(data = {}) {
        return new BenchmarkResult(data);
    }

    static from(data = {}) {

        if (
            data instanceof BenchmarkResult
        ) {
            return new BenchmarkResult(
                data.toObject()
            );
        }

        return new BenchmarkResult(data);
    }

    static fromBenchmark({
        tenantId,
        metricName,
        metricCategory,
        actual,
        benchmark,
        direction =
            METRIC_DIRECTION.NEUTRAL,
        benchmarkType =
            BENCHMARK_TYPE.CUSTOM,
        options = {}
    } = {}) {

        const result =
            new BenchmarkResult({
                tenantId,
                metricName,
                metricCategory,

                actual,
                benchmark,

                direction,
                benchmarkType,

                ...options
            });

        return result.calculate();
    }

    static pending(data = {}) {

        return new BenchmarkResult({
            ...data,
            status: STATUS.PENDING
        });
    }

    static failed(data = {}) {

        return new BenchmarkResult({
            ...data,
            status: STATUS.FAILED
        });
    }

    static partial(data = {}) {

        return new BenchmarkResult({
            ...data,
            status: STATUS.PARTIAL
        });
    }

    /**
     * =========================================================================
     * Static Constants
     * =========================================================================
     */

    static get MODEL_NAME() {
        return MODEL_NAME;
    }

    static get SCHEMA_VERSION() {
        return SCHEMA_VERSION;
    }

    static get STATUS() {
        return STATUS;
    }

    static get PERFORMANCE() {
        return PERFORMANCE;
    }

    static get BENCHMARK_TYPE() {
        return BENCHMARK_TYPE;
    }

    static get METRIC_DIRECTION() {
        return METRIC_DIRECTION;
    }

    static get SEVERITY() {
        return SEVERITY;
    }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 *
 * Primary compatibility:
 *
 *   const BenchmarkResult =
 *       require('./BenchmarkResult');
 *
 * Named compatibility:
 *
 *   const {
 *       BenchmarkResult,
 *       STATUS,
 *       PERFORMANCE
 *   } = require('./BenchmarkResult');
 *
 * ============================================================================
 */

module.exports = BenchmarkResult;

module.exports.BenchmarkResult =
    BenchmarkResult;

module.exports.STATUS =
    STATUS;

module.exports.PERFORMANCE =
    PERFORMANCE;

module.exports.BENCHMARK_TYPE =
    BENCHMARK_TYPE;

module.exports.METRIC_DIRECTION =
    METRIC_DIRECTION;

module.exports.SEVERITY =
    SEVERITY;

module.exports.SCHEMA_VERSION =
    SCHEMA_VERSION;
