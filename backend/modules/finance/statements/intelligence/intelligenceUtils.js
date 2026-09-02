'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Statement Intelligence Utilities
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/statements/intelligence/intelligenceUtils.js
 *
 * Purpose:
 *   Shared utility layer for the Statement Intelligence subsystem.
 *
 * Used By:
 *   - priorityEngine
 *   - severityScorer
 *   - anomalyClassifier
 *   - repairAnalytics
 *   - agingMetrics
 *   - slaMonitor
 *   - recommendationEngine
 *   - riskIndexCalculator
 *   - trendDetector
 *   - executiveDashboard
 *   - forecasting engines
 *   - fraud intelligence engines
 *   - operational intelligence engines
 *
 * Design Principles:
 *   - Stateless
 *   - Deterministic
 *   - Side-effect free
 *   - Defensive
 *   - Immutable where practical
 *   - Audit friendly
 *   - Serialization safe
 *   - Multi-tenant ready
 *   - Financial precision aware
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Dependencies
 * ============================================================================
 */

const {
    PRIORITY,
    SEVERITY,
    RISK,
    SCORE_RANGE,
    SLA_POLICIES,
    AGING_BUCKETS,
    CONFIDENCE
} = require('./intelligenceConstants');

/**
 * ============================================================================
 * Generic Helpers
 * ============================================================================
 */

/**
 * Determine whether a value is a plain object.
 *
 * @param {*} value
 * @returns {boolean}
 */

function isPlainObject(
    value
) {

    if (
        value === null ||
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
        prototype === null
    );

}

/**
 * Determine whether a value is a valid Date.
 *
 * @param {*} value
 * @returns {boolean}
 */

function isValidDate(
    value
) {

    return (
        value instanceof Date &&
        !Number.isNaN(
            value.getTime()
        )
    );

}

/**
 * Convert a value to a valid Date.
 *
 * @param {*} value
 * @param {Date|null} fallback
 * @returns {Date|null}
 */

function toDate(
    value,
    fallback = null
) {

    if (
        value === null ||
        value === undefined
    ) {

        return fallback;

    }

    if (
        isValidDate(
            value
        )
    ) {

        return new Date(
            value.getTime()
        );

    }

    const date =
        new Date(
            value
        );

    if (
        !isValidDate(
            date
        )
    ) {

        return fallback;

    }

    return date;

}

/**
 * Resolve current time.
 *
 * Useful for deterministic tests by passing a fixed `now`.
 *
 * @param {Date|string|number|null} now
 * @returns {Date}
 */

function resolveNow(
    now = null
) {

    if (
        now === null ||
        now === undefined
    ) {

        return new Date();

    }

    const date =
        toDate(
            now
        );

    if (
        !date
    ) {

        throw new TypeError(
            'Invalid date supplied for now.'
        );

    }

    return date;

}

/**
 * ============================================================================
 * Collection Helpers
 * ============================================================================
 */

/**
 * Safely convert a value into an array.
 *
 * @param {*} value
 * @returns {Array}
 */

function asArray(
    value
) {

    if (
        Array.isArray(
            value
        )
    ) {

        return value;

    }

    if (
        value === null ||
        value === undefined
    ) {

        return [];

    }

    return [
        value
    ];

}

/**
 * Return a shallow clone of an array.
 *
 * @param {Array} value
 * @returns {Array}
 */

function cloneArray(
    value
) {

    return [
        ...asArray(
            value
        )
    ];

}

/**
 * Remove null and undefined values from an array.
 *
 * @param {Array} value
 * @returns {Array}
 */

function compact(
    value
) {

    return asArray(
        value
    ).filter(
        item =>
            item !== null &&
            item !== undefined
    );

}

/**
 * ============================================================================
 * Numeric Helpers
 * ============================================================================
 */

/**
 * Safely convert a value to a finite number.
 *
 * @param {*} value
 * @param {number|null} fallback
 * @returns {number|null}
 */

function toNumber(
    value,
    fallback = null
) {

    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {

        return fallback;

    }

    const numeric =
        Number(
            value
        );

    if (
        !Number.isFinite(
            numeric
        )
    ) {

        return fallback;

    }

    return numeric;

}

/**
 * Convert a value to a non-negative number.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */

function toNonNegativeNumber(
    value,
    fallback = 0
) {

    const numeric =
        toNumber(
            value,
            fallback
        );

    return Math.max(
        0,
        numeric
    );

}

/**
 * Clamp a number to a range.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */

function clamp(
    value,
    min = 0,
    max = 100
) {

    const numeric =
        toNumber(
            value,
            min
        );

    if (
        min >
        max
    ) {

        throw new RangeError(
            'Minimum value cannot exceed maximum value.'
        );

    }

    return Math.min(
        max,
        Math.max(
            min,
            numeric
        )
    );

}

/**
 * Clamp a score to the platform score range.
 *
 * @param {*} value
 * @returns {number}
 */

function clampScore(
    value
) {

    return clamp(
        value,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX
    );

}

/**
 * Round a numeric value.
 *
 * @param {*} value
 * @param {number} decimals
 * @returns {number}
 */

function round(
    value,
    decimals = 2
) {

    const numeric =
        toNumber(
            value,
            0
        );

    const precision =
        Number.isInteger(
            decimals
        ) &&
        decimals >= 0
            ? decimals
            : 2;

    const factor =
        10 ** precision;

    return Number(
        (
            Math.round(
                numeric *
                factor
            ) /
            factor
        ).toFixed(
            precision
        )
    );

}

/**
 * Calculate a safe average.
 *
 * @param {Array<number>} values
 * @param {number} fallback
 * @returns {number}
 */

function average(
    values,
    fallback = 0
) {

    const numbers =
        asArray(
            values
        )
            .map(
                value =>
                    toNumber(
                        value
                    )
            )
            .filter(
                value =>
                    value !== null
            );

    if (
        numbers.length === 0
    ) {

        return fallback;

    }

    return round(
        numbers.reduce(
            (
                sum,
                value
            ) =>
                sum +
                value,
            0
        ) /
        numbers.length
    );

}

/**
 * Sum numeric values.
 *
 * @param {Array<*>} values
 * @returns {number}
 */

function sum(
    values
) {

    return round(
        asArray(
            values
        ).reduce(
            (
                total,
                value
            ) => {

                const numeric =
                    toNumber(
                        value,
                        0
                    );

                return (
                    total +
                    numeric
                );

            },
            0
        )
    );

}

/**
 * ============================================================================
 * Financial Helpers
 * ============================================================================
 */

/**
 * Safely extract a repair amount.
 *
 * @param {Object} repair
 * @returns {number}
 */

function getRepairAmount(
    repair = {}
) {

    const candidates = [

        repair.amount,

        repair.exposureAmount,

        repair.financialImpact,

        repair.evidence &&
            repair.evidence.amount,

        repair.transaction &&
            repair.transaction.amount

    ];

    for (
        const candidate of
        candidates
    ) {

        const amount =
            toNumber(
                candidate
            );

        if (
            amount !== null
        ) {

            return amount;

        }

    }

    return 0;

}

/**
 * Return absolute financial exposure.
 *
 * @param {Object} repair
 * @returns {number}
 */

function getFinancialExposure(
    repair = {}
) {

    return Math.abs(
        getRepairAmount(
            repair
        )
    );

}

/**
 * ============================================================================
 * Severity / Priority / Risk Helpers
 * ============================================================================
 */

/**
 * Normalize severity.
 *
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */

function normalizeSeverity(
    value,
    fallback = SEVERITY.LOW
) {

    if (
        value === null ||
        value === undefined
    ) {

        return fallback;

    }

    const normalized =
        String(
            value
        )
            .trim()
            .toUpperCase();

    return Object.values(
        SEVERITY
    ).includes(
        normalized
    )
        ? normalized
        : fallback;

}

/**
 * Normalize priority.
 *
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */

function normalizePriority(
    value,
    fallback = PRIORITY.LOW
) {

    if (
        value === null ||
        value === undefined
    ) {

        return fallback;

    }

    const normalized =
        String(
            value
        )
            .trim()
            .toUpperCase();

    return Object.values(
        PRIORITY
    ).includes(
        normalized
    )
        ? normalized
        : fallback;

}

/**
 * Normalize risk level.
 *
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */

function normalizeRisk(
    value,
    fallback = RISK.LOW
) {

    if (
        value === null ||
        value === undefined
    ) {

        return fallback;

    }

    const normalized =
        String(
            value
        )
            .trim()
            .toUpperCase();

    return Object.values(
        RISK
    ).includes(
        normalized
    )
        ? normalized
        : fallback;

}

/**
 * Resolve priority from score.
 *
 * @param {*} score
 * @param {Object} thresholds
 * @returns {string}
 */

function priorityFromScore(
    score,
    thresholds = null
) {

    const normalized =
        clampScore(
            score
        );

    const config =
        thresholds || {

            LOW_MAX:
                25,

            MEDIUM_MAX:
                50,

            HIGH_MAX:
                75,

            CRITICAL_MAX:
                100

        };

    if (
        normalized <=
        config.LOW_MAX
    ) {

        return PRIORITY.LOW;

    }

    if (
        normalized <=
        config.MEDIUM_MAX
    ) {

        return PRIORITY.MEDIUM;

    }

    if (
        normalized <=
        config.HIGH_MAX
    ) {

        return PRIORITY.HIGH;

    }

    return PRIORITY.CRITICAL;

}

/**
 * Resolve severity from score.
 *
 * @param {*} score
 * @param {Object} thresholds
 * @returns {string}
 */

function severityFromScore(
    score,
    thresholds = null
) {

    const normalized =
        clampScore(
            score
        );

    const config =
        thresholds || {

            LOW_MAX:
                39,

            MEDIUM_MAX:
                64,

            HIGH_MAX:
                84,

            CRITICAL_MAX:
                100

        };

    if (
        normalized <=
        config.LOW_MAX
    ) {

        return SEVERITY.LOW;

    }

    if (
        normalized <=
        config.MEDIUM_MAX
    ) {

        return SEVERITY.MEDIUM;

    }

    if (
        normalized <=
        config.HIGH_MAX
    ) {

        return SEVERITY.HIGH;

    }

    return SEVERITY.CRITICAL;

}

/**
 * Resolve risk level from score.
 *
 * @param {*} score
 * @param {Object} thresholds
 * @returns {string}
 */

function riskFromScore(
    score,
    thresholds = null
) {

    const normalized =
        clampScore(
            score
        );

    const config =
        thresholds || {

            LOW_MAX:
                25,

            MODERATE_MAX:
                50,

            HIGH_MAX:
                75,

            CRITICAL_MAX:
                100

        };

    if (
        normalized <=
        config.LOW_MAX
    ) {

        return RISK.LOW;

    }

    if (
        normalized <=
        config.MODERATE_MAX
    ) {

        return RISK.MODERATE;

    }

    if (
        normalized <=
        config.HIGH_MAX
    ) {

        return RISK.HIGH;

    }

    return RISK.CRITICAL;

}

/**
 * ============================================================================
 * Confidence Helpers
 * ============================================================================
 */

/**
 * Resolve confidence label from confidence score.
 *
 * @param {*} score
 * @returns {string}
 */

function confidenceFromScore(
    score
) {

    const normalized =
        clampScore(
            score
        );

    if (
        normalized >=
        CONFIDENCE.VERY_HIGH
    ) {

        return 'VERY_HIGH';

    }

    if (
        normalized >=
        CONFIDENCE.HIGH
    ) {

        return 'HIGH';

    }

    if (
        normalized >=
        CONFIDENCE.MEDIUM
    ) {

        return 'MEDIUM';

    }

    return 'LOW';

}

/**
 * ============================================================================
 * Aging Helpers
 * ============================================================================
 */

/**
 * Calculate age in hours.
 *
 * @param {Date|string|number} createdAt
 * @param {Date|string|number|null} now
 * @returns {number}
 */

function calculateAgeHours(
    createdAt,
    now = null
) {

    const created =
        toDate(
            createdAt
        );

    if (
        !created
    ) {

        return 0;

    }

    const current =
        resolveNow(
            now
        );

    const milliseconds =
        current.getTime() -
        created.getTime();

    return round(
        Math.max(
            0,
            milliseconds /
            3600000
        )
    );

}

/**
 * Calculate age in days.
 *
 * @param {Date|string|number} createdAt
 * @param {Date|string|number|null} now
 * @returns {number}
 */

function calculateAgeDays(
    createdAt,
    now = null
) {

    return round(
        calculateAgeHours(
            createdAt,
            now
        ) /
        24
    );

}

/**
 * Resolve aging bucket.
 *
 * @param {*} days
 * @returns {string}
 */

function agingBucketFromDays(
    days
) {

    const age =
        Math.max(
            0,
            toNumber(
                days,
                0
            )
        );

    const buckets =
        Object.values(
            AGING_BUCKETS
        );

    for (
        let index = 0;
        index < buckets.length;
        index++
    ) {

        const bucket =
            buckets[index];

        if (
            index ===
            0
        ) {

            if (
                age >=
                    bucket.min &&
                age <=
                    bucket.max
            ) {

                return bucket.label;

            }

            continue;

        }

        if (
            age >
                bucket.min &&
            age <=
                bucket.max
        ) {

            return bucket.label;

        }

    }

    return AGING_BUCKETS
        .DAY_30_PLUS
        .label;

}

/**
 * Resolve SLA hours from severity.
 *
 * @param {*} severity
 * @param {Object} policies
 * @returns {number}
 */

function resolveSLAHours(
    severity,
    policies = SLA_POLICIES
) {

    const normalized =
        normalizeSeverity(
            severity
        );

    return (
        policies[normalized] ??
        policies[SEVERITY.LOW]
    );

}

/**
 * Calculate remaining SLA hours.
 *
 * @param {number} ageHours
 * @param {*} severity
 * @param {Object} policies
 * @returns {number}
 */

function calculateRemainingSLAHours(
    ageHours,
    severity,
    policies = SLA_POLICIES
) {

    const slaHours =
        resolveSLAHours(
            severity,
            policies
        );

    return round(
        Math.max(
            0,
            slaHours -
            toNonNegativeNumber(
                ageHours
            )
        )
    );

}

/**
 * Determine whether an SLA is breached.
 *
 * @param {number} ageHours
 * @param {*} severity
 * @param {Object} policies
 * @returns {boolean}
 */

function isSLABreached(
    ageHours,
    severity,
    policies = SLA_POLICIES
) {

    const slaHours =
        resolveSLAHours(
            severity,
            policies
        );

    return (
        toNonNegativeNumber(
            ageHours
        ) >
        slaHours
    );

}

/**
 * ============================================================================
 * Percentage Helpers
 * ============================================================================
 */

/**
 * Calculate percentage safely.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */

function percentage(
    numerator,
    denominator
) {

    const top =
        toNumber(
            numerator,
            0
        );

    const bottom =
        toNumber(
            denominator,
            0
        );

    if (
        bottom ===
        0
    ) {

        return 0;

    }

    return round(
        (
            top /
            bottom
        ) *
        100
    );

}

/**
 * Calculate compliance percentage.
 *
 * @param {number} compliant
 * @param {number} total
 * @returns {number}
 */

function complianceRate(
    compliant,
    total
) {

    return clamp(
        percentage(
            compliant,
            total
        ),
        0,
        100
    );

}

/**
 * ============================================================================
 * Trend Helpers
 * ============================================================================
 */

/**
 * Calculate relative change.
 *
 * @param {*} current
 * @param {*} previous
 * @returns {number}
 */

function calculateChangeRatio(
    current,
    previous
) {

    const currentValue =
        toNumber(
            current,
            0
        );

    const previousValue =
        toNumber(
            previous,
            0
        );

    if (
        previousValue ===
        0
    ) {

        if (
            currentValue ===
            0
        ) {

            return 0;

        }

        return 1;

    }

    return (
        (
            currentValue -
            previousValue
        ) /
        Math.abs(
            previousValue
        )
    );

}

/**
 * Calculate trend percentage.
 *
 * @param {*} current
 * @param {*} previous
 * @returns {number}
 */

function calculateChangePercentage(
    current,
    previous
) {

    return round(
        calculateChangeRatio(
            current,
            previous
        ) *
        100
    );

}

/**
 * ============================================================================
 * Object / Data Helpers
 * ============================================================================
 */

/**
 * Safely retrieve a nested property.
 *
 * @param {Object} object
 * @param {string} path
 * @param {*} fallback
 * @returns {*}
 */

function getPath(
    object,
    path,
    fallback = undefined
) {

    if (
        object === null ||
        object === undefined
    ) {

        return fallback;

    }

    if (
        typeof path !==
            'string' ||
        path.length ===
            0
    ) {

        return fallback;

    }

    const parts =
        path.split(
            '.'
        );

    let current =
        object;

    for (
        const part of
        parts
    ) {

        if (
            current ===
                null ||
            current ===
                undefined
        ) {

            return fallback;

        }

        if (
            !Object.prototype.hasOwnProperty.call(
                Object(
                    current
                ),
                part
            )
        ) {

            return fallback;

        }

        current =
            current[part];

    }

    return current;

}

/**
 * Return first defined value.
 *
 * @param  {...*} values
 * @returns {*}
 */

function firstDefined(
    ...values
) {

    for (
        const value of
        values
    ) {

        if (
            value !==
                undefined &&
            value !==
                null
        ) {

            return value;

        }

    }

    return undefined;

}

/**
 * Return first non-empty value.
 *
 * @param  {...*} values
 * @returns {*}
 */

function firstNonEmpty(
    ...values
) {

    for (
        const value of
        values
    ) {

        if (
            value ===
                null ||
            value ===
                undefined
        ) {

            continue;

        }

        if (
            typeof value ===
                'string' &&
            value.trim() ===
                ''
        ) {

            continue;

        }

        return value;

    }

    return undefined;

}

/**
 * ============================================================================
 * Immutability Helpers
 * ============================================================================
 */

/**
 * Deep freeze an object.
 *
 * Handles circular references safely.
 *
 * @param {*} value
 * @param {WeakSet} seen
 * @returns {*}
 */

function deepFreeze(
    value,
    seen = new WeakSet()
) {

    if (
        value === null ||
        typeof value !==
            'object'
    ) {

        return value;

    }

    if (
        seen.has(
            value
        )
    ) {

        return value;

    }

    seen.add(
        value
    );

    for (
        const key of
        Reflect.ownKeys(
            value
        )
    ) {

        deepFreeze(
            value[key],
            seen
        );

    }

    return Object.freeze(
        value
    );

}

/**
 * ============================================================================
 * Serialization Helpers
 * ============================================================================
 */

/**
 * Convert an intelligence payload into a JSON-safe structure.
 *
 * Removes functions and symbols, converts Dates to ISO strings and prevents
 * pathological recursive structures.
 *
 * @param {*} value
 * @param {Object} options
 * @returns {*}
 */

function toSerializable(
    value,
    {
        maxDepth = 20,
        _depth = 0,
        _seen = new WeakSet()
    } = {}
) {

    if (
        _depth >
        maxDepth
    ) {

        return '[MAX_DEPTH_EXCEEDED]';

    }

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
            'string' ||
        typeof value ===
            'number' ||
        typeof value ===
            'boolean'
    ) {

        if (
            typeof value ===
                'number' &&
            !Number.isFinite(
                value
            )
        ) {

            return null;

        }

        return value;

    }

    if (
        typeof value ===
            'bigint'
    ) {

        return value.toString();

    }

    if (
        typeof value ===
            'function' ||
        typeof value ===
            'symbol'
    ) {

        return undefined;

    }

    if (
        value instanceof Date
    ) {

        return isValidDate(
            value
        )
            ? value.toISOString()
            : null;

    }

    if (
        value instanceof Error
    ) {

        return {

            name:
                value.name,

            message:
                value.message,

            stack:
                value.stack,

            code:
                value.code,

            retryable:
                value.retryable,

            operational:
                value.operational,

            context:
                toSerializable(
                    value.context,
                    {
                        maxDepth,
                        _depth:
                            _depth + 1,
                        _seen
                    }
                ),

            cause:
                value.cause
                    ? toSerializable(
                        value.cause,
                        {
                            maxDepth,
                            _depth:
                                _depth + 1,
                            _seen
                        }
                    )
                    : undefined

        };

    }

    if (
        _seen.has(
            value
        )
    ) {

        return '[CIRCULAR_REFERENCE]';

    }

    _seen.add(
        value
    );

    if (
        Array.isArray(
            value
        )
    ) {

        return value.map(
            item =>
                toSerializable(
                    item,
                    {
                        maxDepth,
                        _depth:
                            _depth + 1,
                        _seen
                    }
                )
        );

    }

    const result = {};

    for (
        const key of
        Object.keys(
            value
        )
    ) {

        const serialized =
            toSerializable(
                value[key],
                {
                    maxDepth,
                    _depth:
                        _depth + 1,
                    _seen
                }
            );

        if (
            serialized !==
                undefined
        ) {

            result[key] =
                serialized;

        }

    }

    return result;

}

/**
 * ============================================================================
 * Sensitive Data Protection
 * ============================================================================
 */

const SENSITIVE_FIELDS =
    Object.freeze(
        new Set([

            'password',

            'passwordHash',

            'token',

            'accessToken',

            'refreshToken',

            'secret',

            'apiKey',

            'privateKey',

            'authorization',

            'cookie',

            'credentials',

            'signature',

            'webhookSecret',

            'clientSecret',

            'encryptionKey',

            'securityToken',

            'sessionToken',

            'otp',

            'pin'

        ])
    );

/**
 * Sanitize an object for audit/reporting output.
 *
 * @param {*} value
 * @param {Object} options
 * @returns {*}
 */

function sanitizeForAudit(
    value,
    {
        maxDepth = 20,
        _depth = 0,
        _seen = new WeakSet()
    } = {}
) {

    if (
        _depth >
        maxDepth
    ) {

        return '[MAX_DEPTH_EXCEEDED]';

    }

    if (
        value ===
            null ||
        value ===
            undefined
    ) {

        return value;

    }

    if (
        typeof value !==
            'object'
    ) {

        return value;

    }

    if (
        value instanceof Date
    ) {

        return isValidDate(
            value
        )
            ? value.toISOString()
            : null;

    }

    if (
        _seen.has(
            value
        )
    ) {

        return '[CIRCULAR_REFERENCE]';

    }

    _seen.add(
        value
    );

    if (
        Array.isArray(
            value
        )
    ) {

        return value.map(
            item =>
                sanitizeForAudit(
                    item,
                    {
                        maxDepth,
                        _depth:
                            _depth + 1,
                        _seen
                    }
                )
        );

    }

    const result = {};

    for (
        const [
            key,
            child
        ]
        of Object.entries(
            value
        )
    ) {

        if (
            SENSITIVE_FIELDS.has(
                key
            )
        ) {

            continue;

        }

        result[key] =
            sanitizeForAudit(
                child,
                {
                    maxDepth,
                    _depth:
                        _depth + 1,
                    _seen
                }
            );

    }

    return result;

}

/**
 * ============================================================================
 * Identifier Helpers
 * ============================================================================
 */

/**
 * Extract a repair identifier.
 *
 * @param {Object} repair
 * @returns {string|null}
 */

function getRepairId(
    repair = {}
) {

    const id =
        firstNonEmpty(

            repair.repairId,

            repair.id,

            repair._id

        );

    if (
        id ===
            undefined ||
        id ===
            null
    ) {

        return null;

    }

    if (
        typeof id ===
            'object' &&
        id.toString
    ) {

        return id.toString();

    }

    return String(
        id
    );

}

/**
 * Extract tenant identifier.
 *
 * @param {Object} value
 * @returns {string|null}
 */

function getTenantId(
    value = {}
) {

    const id =
        firstNonEmpty(

            value.tenantId,

            value.tenant,

            value.organizationId,

            value.organization

        );

    if (
        id ===
            undefined ||
        id ===
            null
    ) {

        return null;

    }

    if (
        typeof id ===
            'object' &&
        id.toString
    ) {

        return id.toString();

    }

    return String(
        id
    );

}

/**
 * ============================================================================
 * Validation Helpers
 * ============================================================================
 */

/**
 * Assert that a value is an object.
 *
 * @param {*} value
 * @param {string} name
 * @throws {TypeError}
 */

function assertObject(
    value,
    name = 'value'
) {

    if (
        !isPlainObject(
            value
        )
    ) {

        throw new TypeError(
            `${name} must be a plain object.`
        );

    }

}

/**
 * Assert an array.
 *
 * @param {*} value
 * @param {string} name
 * @throws {TypeError}
 */

function assertArray(
    value,
    name = 'value'
) {

    if (
        !Array.isArray(
            value
        )
    ) {

        throw new TypeError(
            `${name} must be an array.`
        );

    }

}

/**
 * ============================================================================
 * Safe Execution
 * ============================================================================
 */

/**
 * Execute a function and return a fallback if it fails.
 *
 * Useful for optional intelligence engines.
 *
 * @param {Function} operation
 * @param {*} fallback
 * @param {Function|null} onError
 * @returns {*}
 */

function safeExecute(
    operation,
    fallback = null,
    onError = null
) {

    if (
        typeof operation !==
            'function'
    ) {

        return fallback;

    }

    try {

        return operation();

    } catch (
        error
    ) {

        if (
            typeof onError ===
                'function'
        ) {

            try {

                onError(
                    error
                );

            } catch (
                loggingError
            ) {

                /**
                 * Error handling must never mask the original operation
                 * failure.
                 */

            }

        }

        return fallback;

    }

}

/**
 * ============================================================================
 * Weighted Score Helper
 * ============================================================================
 */

/**
 * Calculate a weighted score.
 *
 * @param {Object} factors
 * @param {Object} weights
 * @returns {number}
 */

function weightedScore(
    factors = {},
    weights = {}
) {

    const entries =
        Object.entries(
            weights
        );

    if (
        entries.length ===
        0
    ) {

        return 0;

    }

    let weightedTotal =
        0;

    let weightTotal =
        0;

    for (
        const [
            key,
            weight
        ]
        of entries
    ) {

        const factor =
            clampScore(
                factors[key] ??
                0
            );

        const normalizedWeight =
            toNonNegativeNumber(
                weight
            );

        weightedTotal +=
            factor *
            normalizedWeight;

        weightTotal +=
            normalizedWeight;

    }

    if (
        weightTotal ===
        0
    ) {

        return 0;

    }

    return clampScore(
        weightedTotal /
        weightTotal
    );

}

/**
 * ============================================================================
 * Ranking Helpers
 * ============================================================================
 */

/**
 * Rank an array by numeric property.
 *
 * @param {Array} items
 * @param {string} property
 * @param {number} limit
 * @returns {Array}
 */

function rankBy(
    items,
    property,
    limit = 10
) {

    const safeLimit =
        Math.max(
            0,
            Math.min(
                100,
                Math.floor(
                    toNumber(
                        limit,
                        10
                    )
                )
            )
        );

    return asArray(
        items
    )
        .filter(
            item =>
                item &&
                typeof item ===
                    'object'
        )
        .slice()
        .sort(
            (
                a,
                b
            ) =>
                toNumber(
                    b[property],
                    0
                ) -
                toNumber(
                    a[property],
                    0
                )
        )
        .slice(
            0,
            safeLimit
        );

}

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    /**
     * Generic
     */
    isPlainObject,

    isValidDate,

    toDate,

    resolveNow,

    asArray,

    cloneArray,

    compact,

    /**
     * Numeric
     */
    toNumber,

    toNonNegativeNumber,

    clamp,

    clampScore,

    round,

    average,

    sum,

    /**
     * Financial
     */
    getRepairAmount,

    getFinancialExposure,

    /**
     * Classification
     */
    normalizeSeverity,

    normalizePriority,

    normalizeRisk,

    priorityFromScore,

    severityFromScore,

    riskFromScore,

    /**
     * Confidence
     */
    confidenceFromScore,

    /**
     * Aging / SLA
     */
    calculateAgeHours,

    calculateAgeDays,

    agingBucketFromDays,

    resolveSLAHours,

    calculateRemainingSLAHours,

    isSLABreached,

    /**
     * Percentage / trends
     */
    percentage,

    complianceRate,

    calculateChangeRatio,

    calculateChangePercentage,

    /**
     * Object access
     */
    getPath,

    firstDefined,

    firstNonEmpty,

    /**
     * Immutability
     */
    deepFreeze,

    /**
     * Serialization / security
     */
    toSerializable,

    sanitizeForAudit,

    /**
     * Identifiers
     */
    getRepairId,

    getTenantId,

    /**
     * Validation
     */
    assertObject,

    assertArray,

    /**
     * Execution
     */
    safeExecute,

    /**
     * Scoring / ranking
     */
    weightedScore,

    rankBy

});