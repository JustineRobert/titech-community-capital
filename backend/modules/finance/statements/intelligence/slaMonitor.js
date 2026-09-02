'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Statement Repair SLA Monitor
 * ============================================================================
 *
 * File:
 * backend/modules/finance/statements/intelligence/slaMonitor.js
 *
 * Purpose
 * -------
 * Enterprise SLA evaluation engine for statement repair workflows.
 *
 * Responsibilities
 * ---------------
 * • Evaluate repair SLA compliance
 * • Calculate SLA deadlines
 * • Calculate remaining SLA time
 * • Detect SLA breaches
 * • Determine escalation level
 * • Calculate SLA urgency
 * • Evaluate batches of repairs
 * • Produce explainable SLA decisions
 * • Support dashboard metrics
 * • Support notification engines
 * • Support executive reporting
 *
 * SLA Policy
 * ----------
 * CRITICAL -> 2 Hours
 * HIGH     -> 8 Hours
 * MEDIUM   -> 24 Hours
 * LOW      -> 72 Hours
 *
 * Escalation Policy
 * -----------------
 * Compliant                         -> NONE
 * Breached, < 50% of target overdue -> WARNING
 * Breached, >= 50% overdue          -> ESCALATED
 * Breached, >= 100% overdue         -> CRITICAL
 *
 * Design Principles
 * -----------------
 * • Stateless
 * • Deterministic
 * • Immutable outputs
 * • Audit ready
 * • Multi-tenant ready
 * • No database access
 * • No side effects
 * • Configurable
 * • Explainable
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * SLA Severity
 * ============================================================================
 */

const SLA_SEVERITY = Object.freeze({

    CRITICAL: 'CRITICAL',

    HIGH: 'HIGH',

    MEDIUM: 'MEDIUM',

    LOW: 'LOW'
});

/**
 * ============================================================================
 * Escalation Levels
 * ============================================================================
 */

const ESCALATION_LEVEL = Object.freeze({

    NONE: 'NONE',

    WARNING: 'WARNING',

    ESCALATED: 'ESCALATED',

    CRITICAL: 'CRITICAL'
});

/**
 * ============================================================================
 * Repair Terminal Statuses
 * ============================================================================
 *
 * Completed/rejected/reversed repairs no longer require active SLA tracking.
 * EXECUTED is the primary completed state.
 *
 * ============================================================================
 */

const TERMINAL_STATUS = Object.freeze([

    'EXECUTED',

    'REJECTED',

    'REVERSED',

    'CLOSED',

    'CANCELLED'
]);

/**
 * ============================================================================
 * Default SLA Policy
 * ============================================================================
 *
 * Values are expressed in hours.
 * ============================================================================
 */

const DEFAULT_SLA_POLICY = Object.freeze({

    CRITICAL: 2,

    HIGH: 8,

    MEDIUM: 24,

    LOW: 72
});

/**
 * ============================================================================
 * Default Escalation Policy
 * ============================================================================
 *
 * These values represent the amount of SLA target time that has already
 * elapsed beyond the SLA deadline.
 *
 * Example:
 *
 * Target = 8 hours
 * 50% overdue = 4 additional hours after breach
 * 100% overdue = 8 additional hours after breach
 *
 * ============================================================================
 */

const DEFAULT_ESCALATION_POLICY = Object.freeze({

    warningOverdueRatio: 0,

    escalatedOverdueRatio: 0.5,

    criticalOverdueRatio: 1
});

/**
 * ============================================================================
 * Urgency Thresholds
 * ============================================================================
 */

const URGENCY = Object.freeze({

    LOW_MAX: 50,

    MEDIUM_MAX: 75,

    HIGH_MAX: 90,

    CRITICAL_MIN: 91
});

/**
 * ============================================================================
 * Time Constants
 * ============================================================================
 */

const MINUTES_PER_HOUR =
    60;

const MS_PER_MINUTE =
    60000;

const MS_PER_HOUR =
    3600000;

/**
 * ============================================================================
 * Model Version
 * ============================================================================
 */

const MODEL_VERSION =
    'STATEMENT_REPAIR_SLA_MODEL_V1';

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

/**
 * Convert a value to a finite number.
 *
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

/**
 * Clamp a number.
 *
 * @param {number} value
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function clamp(
    value,
    minimum,
    maximum
) {

    return Math.min(

        maximum,

        Math.max(
            minimum,
            value
        )
    );
}

/**
 * Convert an arbitrary date value to a timestamp.
 *
 * @param {*} value
 * @returns {number|null}
 */
function toTimestamp(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;
    }

    const timestamp =
        new Date(value).getTime();

    return Number.isFinite(timestamp)
        ? timestamp
        : null;
}

/**
 * Normalize enum-like values.
 *
 * @param {*} value
 * @returns {string|null}
 */
function normalizeEnum(
    value
) {

    if (
        typeof value !== 'string'
    ) {

        return null;
    }

    return value
        .trim()
        .toUpperCase();
}

/**
 * Freeze array safely.
 *
 * @param {Array} value
 * @returns {Array}
 */
function freezeArray(
    value
) {

    return Object.freeze([
        ...value
    ]);
}

/**
 * Freeze object safely.
 *
 * @param {object} value
 * @returns {object}
 */
function freezeObject(
    value
) {

    return Object.freeze({
        ...value
    });
}

/**
 * ============================================================================
 * SLA Monitor
 * ============================================================================
 */

class SLAMonitor {

    /**
     * =========================================================================
     * Constructor
     * =========================================================================
     *
     * @param {object} options
     * @param {object} options.policies
     * @param {object} options.escalationPolicy
     * @param {Function} options.clock
     */
    constructor({

        policies =
            DEFAULT_SLA_POLICY,

        escalationPolicy =
            DEFAULT_ESCALATION_POLICY,

        clock =
            () => new Date()

    } = {}) {

        if (
            typeof clock !== 'function'
        ) {

            throw new TypeError(
                'clock must be a function.'
            );
        }

        this.policies =
            freezeObject(
                this.validatePolicies(
                    {
                        ...DEFAULT_SLA_POLICY,
                        ...(policies || {})
                    }
                )
            );

        this.escalationPolicy =
            freezeObject(
                this.validateEscalationPolicy(
                    {
                        ...DEFAULT_ESCALATION_POLICY,
                        ...(escalationPolicy || {})
                    }
                )
            );

        this.clock =
            clock;

        this.modelVersion =
            MODEL_VERSION;
    }

    /**
     * =========================================================================
     * Public API — Evaluate SLA
     * =========================================================================
     *
     * @param {object} repair
     * @returns {object}
     */
    evaluateSLA(
        repair = {}
    ) {

        this.assertRepairObject(
            repair
        );

        const now =
            this.getCurrentTimestamp();

        const createdAt =
            toTimestamp(
                repair.createdAt
            );

        /**
         * A missing creation timestamp is not silently treated as "now".
         * That would hide data-quality problems and artificially make a repair
         * appear compliant.
         */
        if (
            createdAt === null
        ) {

            return this.buildInvalidEvaluation(
                repair,
                now,
                'INVALID_CREATED_AT'
            );
        }

        /**
         * Future timestamps are invalid for SLA calculations.
         */
        if (
            createdAt > now
        ) {

            return this.buildInvalidEvaluation(
                repair,
                now,
                'CREATED_AT_IN_FUTURE'
            );
        }

        const severity =
            this.resolveSeverity(
                repair
            );

        const targetHours =
            this.resolveTargetHours(
                repair
            );

        const targetMinutes =
            targetHours *
            MINUTES_PER_HOUR;

        const targetMs =
            targetHours *
            MS_PER_HOUR;

        const deadlineAt =
            createdAt +
            targetMs;

        const elapsedMs =
            Math.max(
                0,
                now -
                createdAt
            );

        const elapsedMinutes =
            Math.floor(
                elapsedMs /
                MS_PER_MINUTE
            );

        const elapsedHours =
            elapsedMs /
            MS_PER_HOUR;

        const remainingMs =
            Math.max(
                0,
                deadlineAt -
                now
            );

        const remainingMinutes =
            Math.ceil(
                remainingMs /
                MS_PER_MINUTE
            );

        const overdueMs =
            Math.max(
                0,
                now -
                deadlineAt
            );

        const overdueMinutes =
            Math.floor(
                overdueMs /
                MS_PER_MINUTE
            );

        const terminal =
            this.isTerminalRepair(
                repair
            );

        /**
         * Terminal repairs are considered SLA satisfied when they were
         * completed before or at the deadline.
         *
         * If execution/completion happened after the deadline, the SLA remains
         * breached and the breach is preserved for reporting.
         */
        const completionTimestamp =
            this.resolveCompletionTimestamp(
                repair
            );

        const effectiveEvaluationTime =
            completionTimestamp !== null
                ? Math.min(
                    completionTimestamp,
                    now
                )
                : now;

        const effectiveOverdueMs =
            completionTimestamp !== null
                ? Math.max(
                    0,
                    completionTimestamp -
                    deadlineAt
                )
                : overdueMs;

        const effectiveOverdueMinutes =
            Math.floor(
                effectiveOverdueMs /
                MS_PER_MINUTE
            );

        const breached =
            effectiveOverdueMinutes > 0;

        const compliant =
            !breached;

        const escalation =
            this.resolveEscalation(
                breached,
                effectiveOverdueMinutes,
                targetHours
            );

        const urgency =
            this.resolveUrgency(
                compliant,
                remainingMinutes,
                targetMinutes,
                breached
            );

        const urgencyLevel =
            this.resolveUrgencyLevel(
                urgency,
                breached
            );

        const result = {

            repairId:
                repair.repairId ??
                repair.id ??
                null,

            severity,

            status:
                normalizeEnum(
                    repair.status
                ),

            terminal,

            compliant,

            breached,

            targetHours,

            targetMinutes,

            createdAt:
                new Date(
                    createdAt
                ),

            deadlineAt:
                new Date(
                    deadlineAt
                ),

            completionAt:
                completionTimestamp !== null
                    ? new Date(
                        completionTimestamp
                    )
                    : null,

            elapsedHours:
                Number(
                    elapsedHours.toFixed(2)
                ),

            elapsedMinutes,

            remainingMinutes,

            overdueMinutes:
                effectiveOverdueMinutes,

            escalation,

            urgency,

            urgencyLevel,

            atRisk:
                !terminal &&
                !breached &&
                urgency >=
                    URGENCY.HIGH_MAX,

            terminal,

            evaluationTime:
                new Date(
                    effectiveEvaluationTime
                ),

            evaluatedAt:
                new Date(
                    now
                ),

            modelVersion:
                this.modelVersion
        };

        return Object.freeze(
            result
        );
    }

    /**
     * =========================================================================
     * Batch Evaluation
     * =========================================================================
     *
     * @param {Array} repairs
     * @returns {object}
     */
    evaluateBatch(
        repairs = []
    ) {

        if (
            !Array.isArray(
                repairs
            )
        ) {

            throw new TypeError(
                'repairs must be an array.'
            );
        }

        const evaluations =
            repairs.map(
                repair =>
                    this.evaluateSLA(
                        repair
                    )
            );

        const totalRepairs =
            evaluations.length;

        const compliant =
            evaluations.filter(
                evaluation =>
                    evaluation.compliant
            ).length;

        const breached =
            evaluations.filter(
                evaluation =>
                    evaluation.breached
            ).length;

        const atRisk =
            evaluations.filter(
                evaluation =>
                    evaluation.atRisk
            ).length;

        const invalid =
            evaluations.filter(
                evaluation =>
                    evaluation.invalid === true
            ).length;

        const escalated =
            evaluations.filter(
                evaluation =>
                    evaluation.escalation !==
                    ESCALATION_LEVEL.NONE
            ).length;

        const criticalEscalations =
            evaluations.filter(
                evaluation =>
                    evaluation.escalation ===
                    ESCALATION_LEVEL.CRITICAL
            ).length;

        const complianceRate =
            totalRepairs === 0
                ? 100
                : Number(
                    (
                        (
                            compliant /
                            totalRepairs
                        ) *
                        100
                    ).toFixed(2)
                );

        const breachRate =
            totalRepairs === 0
                ? 0
                : Number(
                    (
                        (
                            breached /
                            totalRepairs
                        ) *
                        100
                    ).toFixed(2)
                );

        return Object.freeze({

            totalRepairs,

            compliant,

            breached,

            atRisk,

            invalid,

            escalated,

            criticalEscalations,

            complianceRate,

            breachRate,

            evaluations:
                freezeArray(
                    evaluations
                ),

            evaluatedAt:
                this.clock(),

            modelVersion:
                this.modelVersion
        });
    }

    /**
     * =========================================================================
     * Resolve Severity
     * =========================================================================
     *
     * @param {object} repair
     * @returns {string}
     */
    resolveSeverity(
        repair = {}
    ) {

        const severity =
            normalizeEnum(
                repair.severity
            );

        switch (
            severity
        ) {

            case SLA_SEVERITY.CRITICAL:

                return SLA_SEVERITY.CRITICAL;

            case SLA_SEVERITY.HIGH:

                return SLA_SEVERITY.HIGH;

            case SLA_SEVERITY.MEDIUM:

                return SLA_SEVERITY.MEDIUM;

            case SLA_SEVERITY.LOW:

                return SLA_SEVERITY.LOW;

            default:

                /**
                 * Unknown severity defaults to LOW for backward compatibility.
                 *
                 * The unknown value itself should still be observable through
                 * the source repair record and validation pipeline.
                 */
                return SLA_SEVERITY.LOW;
        }
    }

    /**
     * =========================================================================
     * Resolve Target Hours
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number}
     */
    resolveTargetHours(
        repair = {}
    ) {

        const severity =
            this.resolveSeverity(
                repair
            );

        return this.policies[
            severity
        ];
    }

    /**
     * =========================================================================
     * Resolve Completion Timestamp
     * =========================================================================
     *
     * @param {object} repair
     * @returns {number|null}
     */
    resolveCompletionTimestamp(
        repair = {}
    ) {

        const completionValue =
            repair.executedAt ??
            repair.completedAt ??
            repair.closedAt ??
            repair.resolvedAt;

        return toTimestamp(
            completionValue
        );
    }

    /**
     * =========================================================================
     * Terminal Repair
     * =========================================================================
     *
     * @param {object} repair
     * @returns {boolean}
     */
    isTerminalRepair(
        repair = {}
    ) {

        const status =
            normalizeEnum(
                repair.status
            );

        return TERMINAL_STATUS.includes(
            status
        );
    }

    /**
     * =========================================================================
     * Escalation Logic
     * =========================================================================
     *
     * @param {boolean} breached
     * @param {number} overdueMinutes
     * @param {number} targetHours
     * @returns {string}
     */
    resolveEscalation(
        breached,
        overdueMinutes,
        targetHours
    ) {

        if (
            !breached
        ) {

            return ESCALATION_LEVEL.NONE;
        }

        const overdueHours =
            overdueMinutes /
            MINUTES_PER_HOUR;

        const overdueRatio =
            targetHours > 0
                ? overdueHours /
                    targetHours
                : 1;

        if (
            overdueRatio >=
            this.escalationPolicy
                .criticalOverdueRatio
        ) {

            return ESCALATION_LEVEL.CRITICAL;
        }

        if (
            overdueRatio >=
            this.escalationPolicy
                .escalatedOverdueRatio
        ) {

            return ESCALATION_LEVEL.ESCALATED;
        }

        return ESCALATION_LEVEL.WARNING;
    }

    /**
     * =========================================================================
     * Urgency Calculation
     * =========================================================================
     *
     * Returns 0–100.
     *
     * 0   = just created
     * 50  = halfway through SLA
     * 90  = highly urgent
     * 100 = breached
     *
     * @param {boolean} compliant
     * @param {number} remainingMinutes
     * @param {number} targetMinutes
     * @param {boolean} breached
     * @returns {number}
     */
    resolveUrgency(
        compliant,
        remainingMinutes,
        targetMinutes,
        breached
    ) {

        if (
            breached ||
            !compliant
        ) {

            return 100;
        }

        if (
            targetMinutes <= 0
        ) {

            return 100;
        }

        const consumed =
            Math.max(
                0,
                targetMinutes -
                remainingMinutes
            );

        return Number(

            clamp(

                (
                    consumed /
                    targetMinutes
                ) *
                100,

                0,

                100

            ).toFixed(2)
        );
    }

    /**
     * =========================================================================
     * Urgency Level
     * =========================================================================
     *
     * @param {number} urgency
     * @param {boolean} breached
     * @returns {string}
     */
    resolveUrgencyLevel(
        urgency,
        breached
    ) {

        if (
            breached
        ) {

            return 'BREACHED';
        }

        if (
            urgency >=
            URGENCY.CRITICAL_MIN
        ) {

            return 'CRITICAL';
        }

        if (
            urgency >=
            URGENCY.HIGH_MAX
        ) {

            return 'HIGH';
        }

        if (
            urgency >=
            URGENCY.MEDIUM_MAX
        ) {

            return 'MEDIUM';
        }

        return 'LOW';
    }

    /**
     * =========================================================================
     * Invalid Evaluation
     * =========================================================================
     *
     * Invalid timestamps must not silently become compliant SLAs.
     *
     * @param {object} repair
     * @param {number} now
     * @param {string} reason
     * @returns {object}
     */
    buildInvalidEvaluation(
        repair,
        now,
        reason
    ) {

        return Object.freeze({

            repairId:
                repair.repairId ??
                repair.id ??
                null,

            severity:
                this.resolveSeverity(
                    repair
                ),

            compliant:
                false,

            breached:
                false,

            invalid:
                true,

            invalidReason:
                reason,

            targetHours:
                this.resolveTargetHours(
                    repair
                ),

            targetMinutes:
                this.resolveTargetHours(
                    repair
                ) *
                MINUTES_PER_HOUR,

            elapsedHours:
                0,

            elapsedMinutes:
                0,

            remainingMinutes:
                0,

            overdueMinutes:
                0,

            escalation:
                ESCALATION_LEVEL.CRITICAL,

            urgency:
                100,

            urgencyLevel:
                'CRITICAL',

            atRisk:
                true,

            evaluatedAt:
                new Date(
                    now
                ),

            modelVersion:
                this.modelVersion
        });
    }

    /**
     * =========================================================================
     * Policy Validation
     * =========================================================================
     *
     * @param {object} policies
     * @returns {object}
     */
    validatePolicies(
        policies
    ) {

        const normalized = {};

        for (
            const severity
            of Object.values(
                SLA_SEVERITY
            )
        ) {

            const value =
                toFiniteNumber(
                    policies[
                        severity
                    ],
                    NaN
                );

            if (
                !Number.isFinite(
                    value
                )
            ) {

                throw new TypeError(
                    `SLA policy "${severity}" must be a finite number.`
                );
            }

            if (
                value <= 0
            ) {

                throw new RangeError(
                    `SLA policy "${severity}" must be greater than zero.`
                );
            }

            normalized[
                severity
            ] =
                value;
        }

        return normalized;
    }

    /**
     * =========================================================================
     * Escalation Policy Validation
     * =========================================================================
     *
     * @param {object} policy
     * @returns {object}
     */
    validateEscalationPolicy(
        policy
    ) {

        const warning =
            toFiniteNumber(
                policy.warningOverdueRatio,
                NaN
            );

        const escalated =
            toFiniteNumber(
                policy.escalatedOverdueRatio,
                NaN
            );

        const critical =
            toFiniteNumber(
                policy.criticalOverdueRatio,
                NaN
            );

        if (
            !Number.isFinite(
                warning
            ) ||
            !Number.isFinite(
                escalated
            ) ||
            !Number.isFinite(
                critical
            )
        ) {

            throw new TypeError(
                'SLA escalation thresholds must be finite numbers.'
            );
        }

        if (
            warning < 0 ||
            escalated < 0 ||
            critical < 0
        ) {

            throw new RangeError(
                'SLA escalation thresholds cannot be negative.'
            );
        }

        if (
            escalated <
            warning
        ) {

            throw new RangeError(
                'Escalated threshold cannot be below warning threshold.'
            );
        }

        if (
            critical <
            escalated
        ) {

            throw new RangeError(
                'Critical threshold cannot be below escalated threshold.'
            );
        }

        return {

            warningOverdueRatio:
                warning,

            escalatedOverdueRatio:
                escalated,

            criticalOverdueRatio:
                critical
        };
    }

    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     *
     * @returns {object}
     */
    getConfiguration() {

        return Object.freeze({

            modelVersion:
                this.modelVersion,

            policies:
                freezeObject({
                    ...this.policies
                }),

            escalationPolicy:
                freezeObject({
                    ...this.escalationPolicy
                }),

            terminalStatuses:
                freezeArray(
                    TERMINAL_STATUS
                ),

            urgency:
                freezeObject({
                    ...URGENCY
                })
        });
    }

    /**
     * =========================================================================
     * Current Time
     * =========================================================================
     *
     * @returns {number}
     */
    getCurrentTimestamp() {

        const timestamp =
            toTimestamp(
                this.clock()
            );

        if (
            timestamp === null
        ) {

            throw new Error(
                'SLA monitor clock returned an invalid date.'
            );
        }

        return timestamp;
    }

    /**
     * =========================================================================
     * Input Validation
     * =========================================================================
     *
     * @param {*} repair
     */
    assertRepairObject(
        repair
    ) {

        if (
            repair === null ||
            typeof repair !== 'object' ||
            Array.isArray(repair)
        ) {

            throw new TypeError(
                'Repair must be a non-null object.'
            );
        }
    }
}

/**
 * ============================================================================
 * Static Metadata
 * ============================================================================
 */

SLAMonitor.SLA_SEVERITY =
    SLA_SEVERITY;

SLAMonitor.ESCALATION_LEVEL =
    ESCALATION_LEVEL;

SLAMonitor.DEFAULT_SLA_POLICY =
    DEFAULT_SLA_POLICY;

SLAMonitor.DEFAULT_ESCALATION_POLICY =
    DEFAULT_ESCALATION_POLICY;

SLAMonitor.TERMINAL_STATUS =
    TERMINAL_STATUS;

SLAMonitor.URGENCY =
    URGENCY;

SLAMonitor.MODEL_VERSION =
    MODEL_VERSION;

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports =
    SLAMonitor;

module.exports.DEFAULT_SLA_POLICY =
    DEFAULT_SLA_POLICY;

module.exports.DEFAULT_ESCALATION_POLICY =
    DEFAULT_ESCALATION_POLICY;

module.exports.SLA_SEVERITY =
    SLA_SEVERITY;

module.exports.ESCALATION_LEVEL =
    ESCALATION_LEVEL;

module.exports.TERMINAL_STATUS =
    TERMINAL_STATUS;

module.exports.URGENCY =
    URGENCY;

module.exports.MODEL_VERSION =
    MODEL_VERSION;